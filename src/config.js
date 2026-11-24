import fs from 'node:fs'
import path from 'node:path'

const CONFIG_FILE = path.resolve('config.json')

const DEFAULTS = {
  host: 'localhost',
  port: 25565,
  username: 'BuilderBot',
  auth: 'offline',
  version: false,
  owner: '',
  defaultSize: 24,
  maxSize: 48,
  anthropicApiKey: ''
}

export function loadConfig () {
  let user = {}
  if (fs.existsSync(CONFIG_FILE)) user = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'))
  const config = { ...DEFAULTS, ...user }
  if (config.anthropicApiKey && !process.env.ANTHROPIC_API_KEY) process.env.ANTHROPIC_API_KEY = config.anthropicApiKey
  return config
}
