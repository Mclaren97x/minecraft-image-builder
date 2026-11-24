// Design a build without Minecraft running, and preview it layer by layer.
//   npm run design -- <image> [size] [extra instructions]
// The design is saved in designs/ and can be built in-game with !rebuild <name>.

import minecraftData from 'minecraft-data'
import mineflayer from 'mineflayer'
import { loadConfig } from './config.js'
import { designFromImage } from './designer.js'
import { expandBlueprint, saveDesign, suggestedBlocks, layerPreview } from './blueprint.js'

const config = loadConfig()
const [image, maybeSize, ...rest] = process.argv.slice(2)
if (!image) {
  console.log('Usage: npm run design -- <image> [size] [extra instructions]')
  process.exit(1)
}
let size = config.defaultSize
let notes = [maybeSize, ...rest].filter(Boolean).join(' ')
if (Number.isInteger(Number(maybeSize))) { size = Number(maybeSize); notes = rest.join(' ') }

const mcData = minecraftData(config.version || mineflayer.latestSupportedVersion)
const blueprint = await designFromImage({ imagePath: image, prompt: notes, maxSize: size, validBlocks: suggestedBlocks(mcData) })
const expanded = expandBlueprint(blueprint, mcData, size)
console.log(layerPreview(expanded))
expanded.warnings.forEach(w => console.log('Warning:', w))
const name = saveDesign(blueprint)
console.log(`${blueprint.description}\n${expanded.blocks.size} blocks, ${expanded.size.x}x${expanded.size.y}x${expanded.size.z}`)
console.log(`Saved as "${name}". In game, type: !rebuild ${name}`)
