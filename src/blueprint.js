// Expands a blueprint (list of shape ops) into individual blocks,
// checks block names, and saves/loads designs.

import fs from 'node:fs'
import path from 'node:path'

export let DESIGNS_DIR = path.resolve('designs')
export function setDesignsDir (dir) { DESIGNS_DIR = dir }

// Blocks that look fine as plain blocks but need special handling in the world.
const REPLACEMENTS = {
  sand: 'sandstone',
  red_sand: 'red_sandstone',
  gravel: 'stone',
  water: 'light_blue_stained_glass',
  lava: 'orange_concrete',
  grass: 'grass_block',
  short_grass: 'grass_block'
}

// A sample of common block ids we show Claude (all must exist in the game version).
const SUGGESTED = [
  'stone', 'cobblestone', 'stone_bricks', 'mossy_stone_bricks', 'smooth_stone', 'andesite', 'polished_andesite',
  'deepslate_bricks', 'bricks', 'sandstone', 'smooth_sandstone', 'quartz_block', 'blackstone', 'polished_blackstone_bricks',
  'oak_planks', 'spruce_planks', 'birch_planks', 'dark_oak_planks', 'jungle_planks', 'acacia_planks', 'cherry_planks',
  'oak_log', 'spruce_log', 'dark_oak_log', 'stripped_oak_log', 'glass', 'glass_pane', 'oak_leaves', 'spruce_leaves',
  'oak_slab', 'stone_brick_slab', 'oak_stairs', 'stone_brick_stairs', 'oak_fence', 'cobblestone_wall',
  'white_wool', 'red_wool', 'blue_wool', 'yellow_wool', 'black_wool', 'green_wool', 'orange_wool', 'pink_wool',
  'white_concrete', 'gray_concrete', 'black_concrete', 'red_concrete', 'orange_concrete', 'yellow_concrete',
  'lime_concrete', 'green_concrete', 'cyan_concrete', 'light_blue_concrete', 'blue_concrete', 'purple_concrete',
  'magenta_concrete', 'pink_concrete', 'brown_concrete', 'white_terracotta', 'terracotta', 'gold_block', 'iron_block',
  'diamond_block', 'emerald_block', 'lapis_block', 'redstone_block', 'coal_block', 'copper_block', 'obsidian',
  'snow_block', 'packed_ice', 'glowstone', 'sea_lantern', 'bookshelf', 'hay_block', 'mud_bricks', 'prismarine'
]

export function suggestedBlocks (mcData) {
  return SUGGESTED.filter(name => mcData.blocksByName[name] && mcData.itemsByName[name]).join(', ')
}

function cleanName (name) {
  let n = String(name).trim().toLowerCase().replace(/^minecraft:/, '').replace(/\[.*$/, '').replace(/\s+/g, '_')
  if (REPLACEMENTS[n]) n = REPLACEMENTS[n]
  return n
}

/**
 * Returns { blocks: Map<"x,y,z", blockName>, size: {x,y,z}, warnings: string[] }
 * Coordinates are relative: x right, y up, z away from the viewer.
 */
export function expandBlueprint (blueprint, mcData, maxSize) {
  const grid = new Map()
  const warnings = new Set()
  const clamp = v => Math.max(0, Math.min(maxSize - 1, v))

  for (const op of blueprint.ops) {
    let name = cleanName(op.block)
    if (name !== 'air' && (!mcData.blocksByName[name] || !mcData.itemsByName[name])) {
      warnings.add(`Unknown block "${op.block}" replaced with stone`)
      name = 'stone'
    }
    const [xa, xb] = [clamp(Math.min(op.x1, op.x2)), clamp(Math.max(op.x1, op.x2))]
    const [ya, yb] = [clamp(Math.min(op.y1, op.y2)), clamp(Math.max(op.y1, op.y2))]
    const [za, zb] = [clamp(Math.min(op.z1, op.z2)), clamp(Math.max(op.z1, op.z2))]
    const shape = op.shape === 'block' ? 'block' : op.shape

    const put = (x, y, z) => {
      const key = `${x},${y},${z}`
      if (name === 'air') grid.delete(key)
      else grid.set(key, name)
    }

    if (shape === 'block') {
      const inside = [op.x1, op.y1, op.z1].every(v => v >= 0 && v < maxSize)
      if (inside) put(op.x1, op.y1, op.z1)
      continue
    }

    for (let x = xa; x <= xb; x++) {
      for (let y = ya; y <= yb; y++) {
        for (let z = za; z <= zb; z++) {
          const onX = x === xa || x === xb
          const onY = y === ya || y === yb
          const onZ = z === za || z === zb
          if (shape === 'fill') put(x, y, z)
          else if (shape === 'hollow_box' && (onX || onY || onZ)) put(x, y, z)
          else if (shape === 'walls' && (onX || onZ)) put(x, y, z)
        }
      }
    }
  }

  let sx = 0; let sy = 0; let sz = 0
  for (const key of grid.keys()) {
    const [x, y, z] = key.split(',').map(Number)
    sx = Math.max(sx, x + 1); sy = Math.max(sy, y + 1); sz = Math.max(sz, z + 1)
  }
  return { blocks: grid, size: { x: sx, y: sy, z: sz }, warnings: [...warnings] }
}

export function saveDesign (blueprint) {
  fs.mkdirSync(DESIGNS_DIR, { recursive: true })
  const base = (blueprint.name || 'build').replace(/[^a-z0-9_-]/gi, '_').toLowerCase()
  let file = path.join(DESIGNS_DIR, `${base}.json`)
  for (let i = 2; fs.existsSync(file); i++) file = path.join(DESIGNS_DIR, `${base}_${i}.json`)
  fs.writeFileSync(file, JSON.stringify(blueprint, null, 2))
  return path.basename(file, '.json')
}

export function loadDesign (name) {
  const file = path.join(DESIGNS_DIR, `${name.replace(/\.json$/, '')}.json`)
  if (!fs.existsSync(file)) throw new Error(`No saved design called "${name}"`)
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

export function listDesigns () {
  if (!fs.existsSync(DESIGNS_DIR)) return []
  return fs.readdirSync(DESIGNS_DIR).filter(f => f.endsWith('.json')).map(f => f.slice(0, -5))
}

/** Text preview of each layer, viewed from above (front row at the bottom). */
export function layerPreview ({ blocks, size }) {
  const symbols = new Map()
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789#@%&*+=?'
  let out = ''
  for (let y = 0; y < size.y; y++) {
    out += `\nLayer y=${y}\n`
    for (let z = size.z - 1; z >= 0; z--) {
      let row = ''
      for (let x = 0; x < size.x; x++) {
        const b = blocks.get(`${x},${y},${z}`)
        if (!b) { row += '.'; continue }
        if (!symbols.has(b)) symbols.set(b, chars[symbols.size % chars.length])
        row += symbols.get(b)
      }
      out += row + '\n'
    }
  }
  out += '\nKey: ' + [...symbols].map(([b, c]) => `${c}=${b}`).join('  ') + '\n'
  return out
}
