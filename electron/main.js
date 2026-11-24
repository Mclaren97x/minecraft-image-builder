// Desktop app: main process. Owns settings, designs, schematic export and the bot.

import { app, BrowserWindow, ipcMain, dialog, shell, safeStorage } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import minecraftData from 'minecraft-data'
import mineflayer from 'mineflayer'
import { designFromImage } from '../src/designer.js'
import { expandBlueprint, saveDesign, loadDesign, listDesigns, setDesignsDir, suggestedBlocks, DESIGNS_DIR } from '../src/blueprint.js'
import { toLitematic, materialsList } from '../src/litematic.js'
import { BotSession } from '../src/session.js'
import updaterPkg from 'electron-updater'

const { autoUpdater } = updaterPkg

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const USER_DIR = app.getPath('userData')
const SETTINGS_FILE = path.join(USER_DIR, 'settings.json')
setDesignsDir(path.join(USER_DIR, 'designs'))

const DEFAULT_SETTINGS = {
  apiKey: '',
  defaultSize: 24,
  maxSize: 64,
  version: '',
  connection: { host: 'localhost', port: 25565, auth: 'offline', username: 'BuilderBot', version: '' },
  chatCommands: false,
  chatReplies: false,
  owner: ''
}

// ---- settings (API key stored encrypted with Windows' account protection) ----

async function readSettings () {
  let s = {}
  try { s = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')) } catch {}
  const settings = { ...DEFAULT_SETTINGS, ...s, connection: { ...DEFAULT_SETTINGS.connection, ...(s.connection || {}) } }
  if (s.apiKeyEnc && await safeStorage.isAsyncEncryptionAvailable()) {
    try { settings.apiKey = (await safeStorage.decryptStringAsync(Buffer.from(s.apiKeyEnc, 'base64'))).result } catch { settings.apiKey = '' }
  }
  delete settings.apiKeyEnc
  return settings
}

async function writeSettings (settings) {
  const toSave = { ...settings }
  if (toSave.apiKey && await safeStorage.isAsyncEncryptionAvailable()) {
    toSave.apiKeyEnc = (await safeStorage.encryptStringAsync(toSave.apiKey)).toString('base64')
    delete toSave.apiKey
  }
  fs.mkdirSync(USER_DIR, { recursive: true })
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(toSave, null, 2))
}

// Block data for checking names when no bot is connected.
async function registry () {
  if (session?.bot?.registry) return session.bot.registry
  const s = await readSettings()
  return minecraftData(s.version || s.connection.version || mineflayer.latestSupportedVersion)
}

async function designView (blueprint) {
  const size = blueprint.maxSize || (await readSettings()).maxSize
  const expanded = expandBlueprint(blueprint, await registry(), size)
  return {
    name: blueprint.savedAs || blueprint.name,
    description: blueprint.description,
    size: expanded.size,
    blockCount: expanded.blocks.size,
    warnings: expanded.warnings,
    materials: materialsList(expanded.blocks),
    blocks: [...expanded.blocks].map(([k, n]) => [...k.split(',').map(Number), n])
  }
}

async function runDesign (image, size, notes, validBlocks) {
  const settings = await readSettings()
  if (!settings.apiKey) throw new Error('Add your Anthropic API key in Settings first.')
  const blueprint = await designFromImage({
    imagePath: image,
    prompt: notes,
    maxSize: size,
    validBlocks: validBlocks || suggestedBlocks(await registry()),
    apiKey: settings.apiKey,
    log: m => send('log', m)
  })
  blueprint.maxSize = size
  return blueprint
}

// ---- window ----

let win = null
let session = null
const send = (channel, data) => { if (win && !win.isDestroyed()) win.webContents.send(channel, data) }

function createWindow () {
  win = new BrowserWindow({
    width: 1200,
    height: 820,
    minWidth: 900,
    minHeight: 640,
    title: 'Image Builder',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    backgroundColor: '#14161a',
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true }
  })
  win.loadFile(path.join(__dirname, '..', 'ui', 'index.html'))
  // Open web links in the normal browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\//.test(url)) shell.openExternal(url); return { action: 'deny' } })
  win.webContents.on('will-navigate', e => e.preventDefault())
}

app.whenReady().then(() => {
  fs.mkdirSync(DESIGNS_DIR, { recursive: true })
  createWindow()
  setupAutoUpdates()
})

// ---- auto-updates (from the GitHub Releases page set in package.json "publish") ----
// New versions download in the background and install when the app closes,
// or right away if you click "Restart" in the app.

let updateInfo = { state: 'idle', current: app.getVersion() }
function setUpdate (patch) {
  updateInfo = { ...updateInfo, ...patch }
  send('update', updateInfo)
}

function setupAutoUpdates () {
  if (!app.isPackaged) return // only the installed app updates itself
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.on('checking-for-update', () => setUpdate({ state: 'checking' }))
  autoUpdater.on('update-not-available', () => setUpdate({ state: 'latest' }))
  autoUpdater.on('update-available', info => setUpdate({ state: 'downloading', version: info.version, percent: 0 }))
  autoUpdater.on('download-progress', p => setUpdate({ state: 'downloading', percent: Math.round(p.percent) }))
  autoUpdater.on('update-downloaded', info => setUpdate({ state: 'ready', version: info.version }))
  autoUpdater.on('error', err => setUpdate({ state: 'error', error: err?.message || String(err) }))
  const check = () => autoUpdater.checkForUpdates().catch(() => {})
  setTimeout(check, 5000)
  setInterval(check, 4 * 60 * 60 * 1000) // and every 4 hours while it's open
}

app.on('window-all-closed', () => { session?.disconnect(); app.quit() })

// ---- IPC ----

const handle = (channel, fn) => ipcMain.handle(channel, async (_e, ...args) => {
  try { return { ok: true, value: await fn(...args) } } catch (err) { return { ok: false, error: err.message } }
})

handle('settings:get', () => readSettings())
handle('settings:set', async s => { await writeSettings({ ...(await readSettings()), ...s }); return readSettings() })

handle('image:pick', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }] })
  return r.canceled ? null : r.filePaths[0]
})
handle('image:preview', p => {
  const ext = path.extname(p).slice(1).toLowerCase().replace('jpg', 'jpeg')
  return `data:image/${ext};base64,${fs.readFileSync(p).toString('base64')}`
})

handle('design:create', async ({ image, size, notes }) => {
  const blueprint = await runDesign(image, size, notes)
  blueprint.savedAs = saveDesign(blueprint)
  fs.writeFileSync(path.join(DESIGNS_DIR, `${blueprint.savedAs}.json`), JSON.stringify(blueprint, null, 2))
  return designView(blueprint)
})
handle('designs:list', () => listDesigns().map(name => {
  const file = path.join(DESIGNS_DIR, `${name}.json`)
  let description = ''
  try { description = JSON.parse(fs.readFileSync(file, 'utf8')).description } catch {}
  return { name, description, modified: fs.statSync(file).mtimeMs }
}).sort((a, b) => b.modified - a.modified))
handle('designs:load', name => designView({ ...loadDesign(name), savedAs: name }))
handle('designs:delete', name => { fs.rmSync(path.join(DESIGNS_DIR, `${name}.json`), { force: true }); return true })
handle('designs:openFolder', () => shell.openPath(DESIGNS_DIR))

handle('export:litematic', async name => {
  const blueprint = loadDesign(name)
  const reg = await registry()
  const expanded = expandBlueprint(blueprint, reg, blueprint.maxSize || (await readSettings()).maxSize)
  const schematicsDir = path.join(app.getPath('appData'), '.minecraft', 'schematics')
  const defaultDir = fs.existsSync(path.dirname(schematicsDir)) ? schematicsDir : app.getPath('documents')
  fs.mkdirSync(defaultDir, { recursive: true })
  const r = await dialog.showSaveDialog(win, {
    title: 'Save Litematica schematic',
    defaultPath: path.join(defaultDir, `${name}.litematic`),
    filters: [{ name: 'Litematica schematic', extensions: ['litematic'] }]
  })
  if (r.canceled) return null
  fs.writeFileSync(r.filePath, toLitematic(expanded, { name, description: blueprint.description, dataVersion: reg.version.dataVersion }))
  return r.filePath
})
handle('shell:showFile', p => shell.showItemInFolder(p))

// ---- bot ----

handle('bot:connect', async () => {
  if (session?.bot) throw new Error('Already connected. Disconnect first.')
  const s = await readSettings()
  const c = s.connection
  session = new BotSession({
    host: c.host,
    port: c.port,
    auth: c.auth,
    username: c.auth === 'microsoft' ? (c.email || 'me') : c.username,
    version: c.version || undefined,
    profilesFolder: path.join(USER_DIR, 'auth'),
    owner: s.owner,
    chatCommands: s.chatCommands,
    chatReplies: s.chatReplies,
    defaultSize: s.defaultSize,
    maxSize: s.maxSize,
    designImage: runDesign
  })
  session.on('log', m => send('log', m))
  session.on('status', st => send('status', st))
  session.on('progress', p => send('progress', p))
  session.on('msaCode', d => {
    send('msaCode', { url: d.verification_uri, code: d.user_code })
    if (/^https:\/\/((www\.)?microsoft\.com|login\.live\.com|login\.microsoftonline\.com)\//.test(d.verification_uri)) shell.openExternal(d.verification_uri)
  })
  try {
    return await session.connect()
  } catch (err) {
    session = null
    throw err
  }
})
handle('bot:disconnect', () => { session?.disconnect(); session = null; send('status', { connected: false }); return true })
handle('bot:status', () => session?.status() || { connected: false })
handle('bot:stop', () => { session?.stop(); return true })
handle('bot:build', async ({ name, placement }) => {
  if (!session?.bot) throw new Error('Connect the bot first.')
  const blueprint = loadDesign(name)
  return session.build(blueprint, { size: blueprint.maxSize || (await readSettings()).maxSize, placement })
})
handle('bot:materials', name => {
  if (!session?.builder) return null
  const blueprint = loadDesign(name)
  const expanded = expandBlueprint(blueprint, session.bot.registry, blueprint.maxSize || 64)
  return { gameMode: session.bot.game.gameMode, missing: session.builder.missingMaterials(expanded.blocks) }
})

// ---- updates ----

handle('update:get', () => updateInfo)
handle('update:check', () => { if (app.isPackaged) autoUpdater.checkForUpdates().catch(() => {}); else setUpdate({ state: 'dev' }); return true })
handle('update:install', () => {
  if (session?.builder?.busy) throw new Error('The bot is building. Stop it before restarting.')
  session?.disconnect()
  setImmediate(() => autoUpdater.quitAndInstall(true, true)) // silent install, then reopen the app
  return true
})
