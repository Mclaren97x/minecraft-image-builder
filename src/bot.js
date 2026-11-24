// Command-line version of the bot (the desktop app does the same with a window).
//   npm start
// Then in Minecraft chat (from the "owner" player in config.json):
//   !build <image> [size] [notes]   !rebuild <design>   !designs   !stop   !help

import path from 'node:path'
import { loadConfig } from './config.js'
import { designFromImage } from './designer.js'
import { BotSession } from './session.js'

const config = loadConfig()
if (!config.owner) {
  console.log('Set "owner" in config.json to your Minecraft name so the bot knows whose chat commands to follow.')
  process.exit(1)
}

const session = new BotSession({
  ...config,
  chatCommands: true,
  chatReplies: config.chatReplies ?? true,
  profilesFolder: path.resolve('.auth'),
  designImage: (image, size, notes, validBlocks) =>
    designFromImage({ imagePath: image, prompt: notes, maxSize: size, validBlocks, log: m => session.log(m) })
})

session.on('log', msg => console.log(`[${new Date().toLocaleTimeString()}] ${msg}`))
session.on('msaCode', d => console.log(`\nSign in to Microsoft: open ${d.verification_uri} and enter code ${d.user_code}\n`))

session.connect().then(() => session.say('Builder bot ready! Type !help')).catch(err => {
  console.log(err.message)
  process.exit(1)
})
