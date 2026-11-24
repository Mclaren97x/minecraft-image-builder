// Places a design in the world block by block, like a player.
// Creative: flies over each spot and takes blocks from the creative inventory.
// Survival: walks (and pillars up) with pathfinding and uses blocks from its inventory.

import { Vec3 } from 'vec3'
import prismarineItem from 'prismarine-item'
import pathfinderPkg from 'mineflayer-pathfinder'

const { pathfinder, Movements, goals } = pathfinderPkg

const NEIGHBORS = [
  new Vec3(0, -1, 0), new Vec3(1, 0, 0), new Vec3(-1, 0, 0),
  new Vec3(0, 0, 1), new Vec3(0, 0, -1), new Vec3(0, 1, 0)
]
const REACH = 4.2
const HOVER = 2
const SCAFFOLD = ['dirt', 'cobblestone', 'cobbled_deepslate', 'netherrack', 'stone']

function isReplaceable (block) {
  if (!block) return true
  return block.boundingBox === 'empty' || ['air', 'cave_air', 'void_air', 'water', 'lava'].includes(block.name)
}
const isSolidSupport = block => block && block.boundingBox === 'block'

const FACINGS = { north: new Vec3(0, 0, -1), south: new Vec3(0, 0, 1), east: new Vec3(1, 0, 0), west: new Vec3(-1, 0, 0) }

export function yawToFacing (yaw) {
  const fx = -Math.sin(yaw); const fz = -Math.cos(yaw)
  if (Math.abs(fx) > Math.abs(fz)) return fx > 0 ? 'east' : 'west'
  return fz > 0 ? 'south' : 'north'
}

/**
 * Where the build goes. `feet` is the block position to build in front of,
 * `facing` is north/south/east/west (the build extends away in that direction).
 */
export function placementFrame (feet, facing, size, distance = 3) {
  const forward = FACINGS[facing]
  const right = new Vec3(-forward.z, 0, forward.x)
  const origin = feet.floored().plus(forward.scaled(distance)).minus(right.scaled(Math.floor(size.x / 2)))
  return { origin, forward, right }
}

export function toWorld ({ origin, forward, right }, x, y, z) {
  return origin.plus(right.scaled(x)).plus(new Vec3(0, y, 0)).plus(forward.scaled(z))
}

export class Builder {
  constructor (bot, log) {
    this.bot = bot
    this.log = log
    this.Item = prismarineItem(bot.registry)
    this.stopRequested = false
    this.busy = false
    if (!bot.pathfinder) bot.loadPlugin(pathfinder)
  }

  stop () {
    this.stopRequested = true
    try { this.bot.pathfinder.stop() } catch {}
  }

  get creative () { return this.bot.game.gameMode === 'creative' }

  inventoryCounts () {
    const counts = new Map()
    for (const item of this.bot.inventory.items()) counts.set(item.name, (counts.get(item.name) || 0) + item.count)
    return counts
  }

  /** In survival: which blocks are missing from the inventory. [{ name, need, have }] */
  missingMaterials (blocks) {
    if (this.creative) return []
    const need = new Map()
    for (const name of blocks.values()) need.set(name, (need.get(name) || 0) + 1)
    const have = this.inventoryCounts()
    return [...need].filter(([name, n]) => (have.get(name) || 0) < n)
      .map(([name, n]) => ({ name, need: n, have: have.get(name) || 0 }))
  }

  async hold (blockName) {
    const bot = this.bot
    if (bot.heldItem?.name === blockName) return true
    if (this.creative) {
      const itemInfo = bot.registry.itemsByName[blockName]
      if (!itemInfo) return false
      await bot.creative.setInventorySlot(36, new this.Item(itemInfo.id, 64))
      bot.setQuickBarSlot(0)
      return true
    }
    const item = bot.inventory.items().find(i => i.name === blockName)
    if (!item) return false
    await bot.equip(item, 'hand')
    return true
  }

  setupMovements () {
    const bot = this.bot
    const moves = new Movements(bot)
    moves.canDig = false // never break the build (or anyone's stuff) to get somewhere
    moves.allow1by1towers = true
    moves.allowSprinting = true
    moves.scafoldingBlocks = SCAFFOLD.map(n => bot.registry.itemsByName[n]?.id).filter(Boolean)
    bot.pathfinder.setMovements(moves)
  }

  async moveNear (target) {
    const bot = this.bot
    const center = target.offset(0.5, 0.5, 0.5)
    const eye = bot.entity.position.offset(0, bot.entity.height * 0.9, 0)
    const feet = bot.entity.position.floored()
    const blockingMe = target.equals(feet) || target.equals(feet.offset(0, 1, 0))

    if (this.creative) {
      const pos = bot.entity.position
      if (eye.distanceTo(center) <= REACH && pos.y >= target.y + 1) return
      const hover = new Vec3(target.x + 0.5, target.y + HOVER, target.z + 0.5)
      // Rise first (nothing above the current layer is built yet), then move across.
      if (pos.y < hover.y - 0.1) await bot.creative.flyTo(new Vec3(pos.x, hover.y, pos.z))
      await bot.creative.flyTo(hover)
      return
    }

    if (!blockingMe && eye.distanceTo(center) <= REACH) return
    await bot.pathfinder.goto(new goals.GoalPlaceBlock(target, bot.world, { range: REACH }))
  }

  findSupport (pos) {
    for (const dir of NEIGHBORS) {
      const ref = this.bot.blockAt(pos.plus(dir))
      if (isSolidSupport(ref)) return { ref, face: dir.scaled(-1) }
    }
    return null
  }

  async placeOne (pos, blockName) {
    const bot = this.bot
    const existing = bot.blockAt(pos)
    if (existing?.name === blockName) return 'already'
    if (existing && !isReplaceable(existing)) {
      if (!this.creative) return 'blocked' // don't mine things in survival
    }
    if (!(await this.hold(blockName))) return 'missing'
    await this.moveNear(pos)
    if (existing && !isReplaceable(existing)) await bot.dig(existing, true)
    const support = this.findSupport(pos)
    if (!support) return 'unsupported'
    await this.hold(blockName)
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await bot.placeBlock(support.ref, support.face)
        return 'placed'
      } catch (err) {
        if (bot.blockAt(pos)?.name === blockName) return 'placed'
        if (attempt === 3) throw err
        await bot.waitForTicks(4)
      }
    }
  }

  /** blocks: Map "x,y,z" -> blockName (relative). frame: from placementFrame. */
  async build (blocks, frame, onProgress = () => {}) {
    const bot = this.bot
    const mode = bot.game.gameMode
    if (mode !== 'creative' && mode !== 'survival') {
      throw new Error(`I can't build in ${mode} mode. Switch to survival or creative.`)
    }
    this.busy = true
    this.stopRequested = false
    const startTime = Date.now()
    const total = blocks.size
    let done = 0; let placed = 0
    const failed = []

    const layers = new Map()
    for (const [key, name] of blocks) {
      const [x, y, z] = key.split(',').map(Number)
      if (!layers.has(y)) layers.set(y, [])
      layers.get(y).push({ pos: toWorld(frame, x, y, z), name })
    }
    const ys = [...layers.keys()].sort((a, b) => a - b)

    try {
      if (this.creative) bot.creative.startFlying()
      else this.setupMovements()
      let carryOver = []
      for (const y of ys) {
        let pending = [...carryOver, ...layers.get(y)]
        carryOver = []
        while (pending.length && !this.stopRequested) {
          const here = bot.entity.position
          let bestIdx = -1; let bestDist = Infinity
          for (let i = 0; i < pending.length; i++) {
            const p = pending[i].pos
            const d = p.distanceSquared(here)
            if (d < bestDist && (bot.blockAt(p)?.name === pending[i].name || this.findSupport(p))) { bestDist = d; bestIdx = i }
          }
          if (bestIdx === -1) { carryOver = pending; break }
          const { pos, name } = pending.splice(bestIdx, 1)[0]
          try {
            const result = await this.placeOne(pos, name)
            if (result === 'placed') placed++
            else if (result === 'unsupported') { carryOver.push({ pos, name }); continue } else if (result === 'missing') failed.push({ pos, name, error: 'not in inventory' })
            else if (result === 'blocked') failed.push({ pos, name, error: 'something is already there' })
          } catch (err) {
            if (this.stopRequested) break
            failed.push({ pos, name, error: err.message })
          }
          done++
          onProgress(done, total)
        }
        if (this.stopRequested) break
      }
      for (const { pos, name } of carryOver) failed.push({ pos, name, error: 'nothing to attach to' })
    } finally {
      if (this.creative) bot.creative.stopFlying()
      try { bot.pathfinder.stop() } catch {}
      this.busy = false
    }

    return { placed, total, failed, stopped: this.stopRequested, seconds: Math.round((Date.now() - startTime) / 1000) }
  }
}
