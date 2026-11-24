// Safe bridge between the window and the app. The window can only call these functions.
const { contextBridge, ipcRenderer, webUtils } = require('electron')

const call = async (channel, ...args) => {
  const r = await ipcRenderer.invoke(channel, ...args)
  if (!r.ok) throw new Error(r.error)
  return r.value
}
const on = channel => cb => ipcRenderer.on(channel, (_e, data) => cb(data))

contextBridge.exposeInMainWorld('api', {
  getSettings: () => call('settings:get'),
  setSettings: s => call('settings:set', s),
  pickImage: () => call('image:pick'),
  imagePreview: p => call('image:preview', p),
  pathForFile: file => webUtils.getPathForFile(file),
  createDesign: opts => call('design:create', opts),
  listDesigns: () => call('designs:list'),
  loadDesign: name => call('designs:load', name),
  deleteDesign: name => call('designs:delete', name),
  openDesignsFolder: () => call('designs:openFolder'),
  exportLitematic: name => call('export:litematic', name),
  showFile: p => call('shell:showFile', p),
  connect: () => call('bot:connect'),
  disconnect: () => call('bot:disconnect'),
  status: () => call('bot:status'),
  stop: () => call('bot:stop'),
  build: opts => call('bot:build', opts),
  materials: name => call('bot:materials', name),
  getUpdate: () => call('update:get'),
  checkUpdate: () => call('update:check'),
  installUpdate: () => call('update:install'),
  onUpdate: on('update'),
  onLog: on('log'),
  onStatus: on('status'),
  onProgress: on('progress'),
  onMsaCode: on('msaCode')
})
