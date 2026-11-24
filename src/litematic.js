// Writes a design as a Litematica schematic (.litematic), so the Litematica mod can
// show it as a hologram in your own game and Litematica Printer can place it for you.

import zlib from 'node:zlib'
import nbt from 'prismarine-nbt'

const LITEMATIC_VERSION = 7
const LITEMATIC_SUBVERSION = 1

// Packs values tightly into 64-bit longs, the way Litematica's bit array does
// (values may span two longs).
function packBits (values, bits) {
  const longs = new Array(Math.ceil((values.length * bits) / 64)).fill(0n)
  const mask = (1n << BigInt(bits)) - 1n
  values.forEach((value, i) => {
    const bitIndex = i * bits
    const start = bitIndex >> 6
    const end = (bitIndex + bits - 1) >> 6
    const offset = BigInt(bitIndex & 63)
    const v = BigInt(value) & mask
    longs[start] = (longs[start] | (v << offset)) & 0xFFFFFFFFFFFFFFFFn
    if (start !== end) longs[end] = longs[end] | (v >> (64n - offset))
  })
  return longs.map(l => BigInt.asIntN(64, l))
}

/**
 * expanded: result of expandBlueprint ({ blocks: Map "x,y,z" -> name, size }).
 * Returns a Buffer with the gzipped .litematic file.
 */
export function toLitematic (expanded, { name, description = '', author = 'Image Builder', dataVersion }) {
  const { blocks, size } = expanded
  const palette = ['air']
  const paletteIndex = new Map([['air', 0]])
  for (const blockName of blocks.values()) {
    if (!paletteIndex.has(blockName)) { paletteIndex.set(blockName, palette.length); palette.push(blockName) }
  }

  const volume = size.x * size.y * size.z
  const states = new Array(volume).fill(0)
  for (const [key, blockName] of blocks) {
    const [x, y, z] = key.split(',').map(Number)
    states[(y * size.z + z) * size.x + x] = paletteIndex.get(blockName)
  }
  const bits = Math.max(2, Math.ceil(Math.log2(palette.length)))
  const now = BigInt(Date.now())
  const vec = ({ x, y, z }) => nbt.comp({ x: nbt.int(x), y: nbt.int(y), z: nbt.int(z) })

  const region = nbt.comp({
    Position: vec({ x: 0, y: 0, z: 0 }),
    Size: vec(size),
    BlockStatePalette: nbt.list(nbt.comp(palette.map(b => ({ Name: nbt.string(`minecraft:${b}`) })))),
    BlockStates: nbt.longArray(packBits(states, bits)),
    TileEntities: nbt.list(),
    Entities: nbt.list(),
    PendingBlockTicks: nbt.list(),
    PendingFluidTicks: nbt.list()
  })

  const root = nbt.comp({
    MinecraftDataVersion: nbt.int(dataVersion),
    Version: nbt.int(LITEMATIC_VERSION),
    SubVersion: nbt.int(LITEMATIC_SUBVERSION),
    Metadata: nbt.comp({
      Name: nbt.string(name),
      Author: nbt.string(author),
      Description: nbt.string(description),
      RegionCount: nbt.int(1),
      TotalBlocks: nbt.int(blocks.size),
      TotalVolume: nbt.int(volume),
      TimeCreated: nbt.long(now),
      TimeModified: nbt.long(now),
      EnclosingSize: vec(size)
    }),
    Regions: nbt.comp({ [name]: region })
  }, '')

  return zlib.gzipSync(nbt.writeUncompressed(root, 'big'))
}

/** Counts blocks by type, most used first: [{ name, count }]. */
export function materialsList (blocks) {
  const counts = new Map()
  for (const name of blocks.values()) counts.set(name, (counts.get(name) || 0) + 1)
  return [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count)
}
