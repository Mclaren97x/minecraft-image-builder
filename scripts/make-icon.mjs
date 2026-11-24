// Renders build/icon.svg (crossed shovel and pickaxe) into the app icon files:
// build/icon.png (256x256) and build/icon.ico (16-256 px).
//   npm run icon        (runs this with Electron, which draws the SVG smoothly)

import { app, BrowserWindow } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const svg = fs.readFileSync(path.join(root, 'build', 'icon.svg'), 'utf8')
const sizes = [16, 24, 32, 48, 64, 128, 256]

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } })
  await win.loadURL('data:text/html,<canvas></canvas>')
  const dataUrls = await win.webContents.executeJavaScript(`(async () => {
    const img = new Image()
    img.src = 'data:image/svg+xml;base64,' + ${JSON.stringify(Buffer.from(svg).toString('base64'))}
    await img.decode()
    const out = []
    for (const size of ${JSON.stringify(sizes)}) {
      const c = document.createElement('canvas')
      c.width = c.height = size
      const ctx = c.getContext('2d')
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(img, 0, 0, size, size)
      out.push(c.toDataURL('image/png'))
    }
    return out
  })()`)
  const pngs = dataUrls.map(u => Buffer.from(u.split(',')[1], 'base64'))

  // ICO file holding each size as a PNG
  const header = Buffer.alloc(6); header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4)
  let offset = 6 + 16 * sizes.length
  const entries = sizes.map((s, i) => {
    const e = Buffer.alloc(16)
    e[0] = s === 256 ? 0 : s; e[1] = s === 256 ? 0 : s
    e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6)
    e.writeUInt32LE(pngs[i].length, 8); e.writeUInt32LE(offset, 12)
    offset += pngs[i].length
    return e
  })
  fs.writeFileSync(path.join(root, 'build', 'icon.png'), pngs[sizes.length - 1])
  fs.writeFileSync(path.join(root, 'build', 'icon.ico'), Buffer.concat([header, ...entries, ...pngs]))
  console.log('Wrote build/icon.png and build/icon.ico')
  app.exit(0)
})
