import { Preview, blockColor } from './preview.js'

const $ = id => document.getElementById(id)
const api = window.api
let settings = null
let current = null // design shown in the viewer
let imagePath = null
let preview = null
let botStatus = { connected: false }

// ---- navigation ----
function showPage (name) {
  document.querySelectorAll('.nav').forEach(b => b.classList.toggle('active', b.dataset.page === name))
  document.querySelectorAll('.page').forEach(p => p.classList.toggle('active', p.id === `page-${name}`))
  if (name === 'designs') refreshDesigns()
  if (name === 'bot') refreshBuildDesigns()
  if (name === 'create') preview?.resize()
}
document.querySelectorAll('.nav').forEach(b => b.addEventListener('click', () => showPage(b.dataset.page)))

function segmented (el, attr, onChange) {
  const set = value => {
    el.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset[attr] === value))
    onChange(value)
  }
  el.querySelectorAll('button').forEach(b => b.addEventListener('click', () => set(b.dataset[attr])))
  return set
}

// ---- create ----
const drop = $('drop')
async function setImage (p) {
  imagePath = p
  $('imgUrl').value = ''
  $('imgPreview').src = await api.imagePreview(p)
  $('imgPreview').hidden = false
  $('dropHint').hidden = true
}
drop.addEventListener('click', async () => { const p = await api.pickImage(); if (p) setImage(p) })
drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over') })
drop.addEventListener('dragleave', () => drop.classList.remove('over'))
drop.addEventListener('drop', e => {
  e.preventDefault(); drop.classList.remove('over')
  const file = e.dataTransfer.files[0]
  if (file) setImage(api.pathForFile(file))
})
$('imgUrl').addEventListener('input', () => {
  const url = $('imgUrl').value.trim()
  if (/^https:\/\/\S+$/.test(url)) {
    imagePath = url
    $('imgPreview').hidden = true
    $('dropHint').hidden = false
    $('dropHint').innerHTML = 'Using the image link below'
  }
})
$('size').addEventListener('input', () => { $('sizeVal').textContent = $('size').value })

$('designBtn').addEventListener('click', async () => {
  if (!imagePath) return status('Pick an image first.', true)
  const btn = $('designBtn')
  btn.disabled = true
  btn.textContent = 'Designing...'
  status('Claude is studying your image and designing the build. This usually takes 1–3 minutes.')
  try {
    const design = await api.createDesign({ image: imagePath, size: Number($('size').value), notes: $('notes').value.trim() })
    showDesign(design)
    status(`Done! Saved as "${design.name}".`)
  } catch (err) {
    status(err.message, true)
  } finally {
    btn.disabled = false
    btn.textContent = 'Design it'
  }
})
function status (msg, isError = false) {
  $('designStatus').textContent = msg
  $('designStatus').classList.toggle('error', isError)
}

function showDesign (design) {
  current = design
  $('viewerEmpty').hidden = true
  $('viewerWrap').hidden = false
  $('dName').textContent = design.name.replace(/_/g, ' ')
  $('dDesc').textContent = design.description
  $('dStats').innerHTML = `<span><b>${design.blockCount.toLocaleString()}</b> blocks</span><span><b>${design.size.x}×${design.size.y}×${design.size.z}</b></span>`
  $('dMaterials').innerHTML = design.materials.map(m => {
    const stacks = m.count >= 64 ? ` <small>(${Math.floor(m.count / 64)} stacks${m.count % 64 ? ` + ${m.count % 64}` : ''})</small>` : ''
    return `<li><span class="swatch" style="background:#${blockColor(m.name).toString(16).padStart(6, '0')}"></span>${m.name.replace(/_/g, ' ')}<b>${m.count}</b>${stacks}</li>`
  }).join('')
  if (!preview) preview = new Preview($('viewer'))
  preview.show(design)
  $('layerSlider').max = design.size.y
  $('layerSlider').value = design.size.y
  $('layerVal').textContent = `${design.size.y} / ${design.size.y}`
}
$('layerSlider').addEventListener('input', () => {
  const n = Number($('layerSlider').value)
  $('layerVal').textContent = `${n} / ${current.size.y}`
  preview.setMaxLayer(n)
})

$('exportBtn').addEventListener('click', async () => {
  if (!current) return
  try {
    const file = await api.exportLitematic(current.name)
    if (file) { status(`Saved ${file}`); api.showFile(file) }
  } catch (err) { status(err.message, true) }
})
$('buildBtn').addEventListener('click', () => {
  showPage('bot')
  $('buildDesign').value = current.name
  checkMaterials()
})

// ---- designs ----
async function refreshDesigns () {
  const list = await api.listDesigns()
  const el = $('designList')
  if (!list.length) { el.innerHTML = '<p class="hint">No designs yet. Make one on the Create page.</p>'; return }
  el.innerHTML = ''
  for (const d of list) {
    const card = document.createElement('div')
    card.className = 'design-card'
    card.innerHTML = `<div><h3></h3><p class="hint"></p><small></small></div>
      <div class="row"><button class="primary small" data-a="open">Open</button><button class="small" data-a="del">Delete</button></div>`
    card.querySelector('h3').textContent = d.name.replace(/_/g, ' ')
    card.querySelector('p').textContent = d.description
    card.querySelector('small').textContent = new Date(d.modified).toLocaleString()
    card.querySelector('[data-a=open]').addEventListener('click', async () => {
      showPage('create')
      showDesign(await api.loadDesign(d.name))
    })
    card.querySelector('[data-a=del]').addEventListener('click', async () => {
      if (!confirm(`Delete "${d.name}"? This can't be undone.`)) return
      await api.deleteDesign(d.name)
      refreshDesigns()
    })
    el.appendChild(card)
  }
}
$('openFolderBtn').addEventListener('click', () => api.openDesignsFolder())

// ---- bot ----
let auth = 'offline'
const setAuth = segmented($('authSeg'), 'auth', v => {
  auth = v
  $('offlineFields').hidden = v !== 'offline'
  $('msFields').hidden = v !== 'microsoft'
})
let place = 'bot'
const setPlace = segmented($('placeSeg'), 'place', v => {
  place = v
  $('placePlayer').hidden = v !== 'player'
  $('placeCoords').hidden = v !== 'coords'
})

const log = msg => {
  const el = $('log')
  el.textContent += `[${new Date().toLocaleTimeString()}] ${msg}\n`
  el.scrollTop = el.scrollHeight
}
api.onLog(log)
api.onMsaCode(({ url, code }) => {
  $('msaBox').hidden = false
  $('msaLink').href = url
  $('msaLink').textContent = url
  $('msaCode').textContent = code
  log(`Sign in to Microsoft at ${url} with code ${code}`)
})
api.onStatus(updateStatus)
api.onProgress(({ done, total }) => {
  $('progressBar').style.width = `${(done / total) * 100}%`
  $('progressText').textContent = `${done} / ${total} blocks`
})

function updateStatus (st) {
  botStatus = st
  const on = !!st.connected
  $('botPill').classList.toggle('on', on)
  $('botPillText').textContent = on ? `${st.username} · ${st.gameMode}` : 'Bot offline'
  $('connectBtn').hidden = on
  $('disconnectBtn').hidden = !on
  if (on) $('connStatus').textContent = `Connected as ${st.username} (Minecraft ${st.version}, ${st.gameMode} mode)${st.position ? ` at ${st.position.x}, ${st.position.y}, ${st.position.z}` : ''}`
  $('startBuildBtn').disabled = !on || st.building || st.designing
  $('stopBtn').disabled = !st.building
  if (on) $('msaBox').hidden = true
}

async function saveConnection () {
  settings = await api.setSettings({
    connection: {
      ...settings.connection,
      host: $('host').value.trim() || 'localhost',
      port: Number($('port').value) || 25565,
      auth,
      username: $('botName').value.trim() || 'BuilderBot',
      version: $('mcVersion').value.trim()
    }
  })
}

$('connectBtn').addEventListener('click', async () => {
  await saveConnection()
  $('connectBtn').disabled = true
  $('connStatus').textContent = 'Connecting...'
  try {
    updateStatus(await api.connect())
    checkMaterials()
  } catch (err) {
    $('connStatus').textContent = err.message
  } finally {
    $('connectBtn').disabled = false
  }
})
$('disconnectBtn').addEventListener('click', async () => { await api.disconnect(); updateStatus({ connected: false }); $('connStatus').textContent = 'Disconnected.' })
$('stopBtn').addEventListener('click', () => api.stop())
$('useBotPos').addEventListener('click', () => {
  if (!botStatus.position) return
  $('cx').value = botStatus.position.x; $('cy').value = botStatus.position.y; $('cz').value = botStatus.position.z
  $('cfacing').value = botStatus.facing || 'north'
})

async function refreshBuildDesigns () {
  const list = await api.listDesigns()
  const sel = $('buildDesign')
  const keep = sel.value || current?.name
  sel.innerHTML = list.map(d => `<option value="${d.name}">${d.name.replace(/_/g, ' ')}</option>`).join('')
  if (keep && list.some(d => d.name === keep)) sel.value = keep
  checkMaterials()
}
$('buildDesign').addEventListener('change', checkMaterials)

async function checkMaterials () {
  const el = $('matCheck')
  el.textContent = ''
  el.classList.remove('warn')
  const name = $('buildDesign').value
  if (!name || !botStatus.connected) return
  const r = await api.materials(name)
  if (!r) return
  if (r.gameMode === 'creative') { el.textContent = 'Creative mode: blocks are free.'; return }
  if (!r.missing.length) { el.textContent = 'Survival mode: the bot has every block it needs.'; return }
  el.classList.add('warn')
  el.innerHTML = '<b>Survival mode: the bot is missing blocks</b> (those spots get skipped):<br>' +
    r.missing.map(m => `${m.name.replace(/_/g, ' ')}: ${m.have}/${m.need}`).join(', ')
}

$('startBuildBtn').addEventListener('click', async () => {
  const name = $('buildDesign').value
  if (!name) return log('Pick a design first.')
  let placement = { mode: place }
  if (place === 'player') placement.player = $('placePlayerName').value.trim()
  if (place === 'coords') {
    placement = { mode: 'coords', x: Number($('cx').value), y: Number($('cy').value), z: Number($('cz').value), facing: $('cfacing').value }
    if (['cx', 'cy', 'cz'].some(id => $(id).value === '')) return log('Fill in X, Y and Z.')
  }
  $('progressBar').style.width = '0%'
  try {
    await api.build({ name, placement })
  } catch (err) { log(`Error: ${err.message}`) }
})

// ---- settings ----
function fillSettings () {
  $('apiKey').value = settings.apiKey
  $('defSize').value = settings.defaultSize
  $('setVersion').value = settings.version
  $('chatCommands').checked = settings.chatCommands
  $('chatReplies').checked = settings.chatReplies
  $('owner').value = settings.owner
  $('size').value = settings.defaultSize
  $('sizeVal').textContent = settings.defaultSize
  const c = settings.connection
  $('host').value = c.host; $('port').value = c.port; $('botName').value = c.username; $('mcVersion').value = c.version
  setAuth(c.auth)
}
$('saveSettings').addEventListener('click', async () => {
  settings = await api.setSettings({
    apiKey: $('apiKey').value.trim(),
    defaultSize: Math.min(64, Math.max(8, Number($('defSize').value) || 24)),
    version: $('setVersion').value.trim(),
    chatCommands: $('chatCommands').checked,
    chatReplies: $('chatReplies').checked,
    owner: $('owner').value.trim()
  })
  fillSettings()
  $('settingsSaved').textContent = 'Saved. Chat command changes apply the next time the bot connects.'
})

// ---- updates ----
function showUpdate (u) {
  $('appVersion').textContent = u.current
  const card = $('updateCard')
  const text = {
    idle: '', dev: 'Updates only work in the installed app.', checking: 'Checking for updates...',
    latest: 'You have the latest version.', downloading: `Downloading version ${u.version || ''}... ${u.percent ?? 0}%`,
    ready: `Version ${u.version} is ready. It installs when you close the app.`, error: `Couldn't check for updates: ${u.error}`
  }[u.state] || ''
  $('updateStatusText').textContent = text
  card.hidden = !(u.state === 'downloading' || u.state === 'ready')
  $('updateTitle').textContent = u.state === 'ready' ? 'Update ready' : 'Updating'
  $('updateText').textContent = u.state === 'ready' ? `Version ${u.version} installs when you close the app.` : `Downloading ${u.version || ''}... ${u.percent ?? 0}%`
  $('restartBtn').hidden = u.state !== 'ready'
}
api.onUpdate(showUpdate)
$('checkUpdateBtn').addEventListener('click', () => api.checkUpdate())
$('restartBtn').addEventListener('click', async () => {
  try { await api.installUpdate() } catch (err) { $('updateText').textContent = err.message }
})

// ---- start ----
showUpdate(await api.getUpdate())
settings = await api.getSettings()
fillSettings()
setPlace('bot')
updateStatus(await api.status())
if (!settings.apiKey) showPage('settings')
