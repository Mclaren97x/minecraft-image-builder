// One bot connection: joining a world or server, chat commands, and running builds.
// Used by both the desktop app and the command-line bot.

import { EventEmitter } from 'node:events'
import mineflayer from 'mineflayer'
import { Vec3 } from 'vec3'
import { expandBlueprint, loadDesign, listDesigns, saveDesign, suggestedBlocks } from './blueprint.js'
import { Builder, placementFrame, yawToFacing } from './builder.js'

export class BotSession extends EventEmitter {
  /**
   * options: { host, port, username, auth: 'offline'|'microsoft', version, profilesFolder,
   *            owner, chatCommands, chatReplies, maxSize, designImage(image, size, notes) }
   */
  constructor (options) {
    super()
    this.options = options
    this.bot = null
    this.builder = null
    this.designing = false
  }

  log (msg) { this.emit('log', msg) }

  say (msg) {
    this.log(msg)
    if (this.options.chatReplies && this.bot?.entity) this.bot.chat(String(msg).slice(0, 250))
  }

  get busy () { return this.designing || !!this.builder?.busy }

  status () {
    const bot = this.bot
    return {
      connected: !!bot?.entity,
      username: bot?.username,
      version: bot?.version,
      gameMode: bot?.game?.gameMode,
      position: bot?.entity ? bot.entity.position.floored() : null,
      facing: bot?.entity ? yawToFacing(bot.entity.yaw) : null,
      building: !!this.builder?.busy,
      designing: this.designing
    }
  }

  connect () {
    const o = this.options
    return new Promise((resolve, reject) => {
      let settled = false
      const fail = err => { if (!settled) { settled = true; reject(err) } }

      const bot = mineflayer.createBot({
        host: o.host,
        port: Number(o.port) || 25565,
        username: o.username,
        auth: o.auth,
        version: o.version || undefined,
        profilesFolder: o.profilesFolder,
        onMsaCode: data => this.emit('msaCode', data),
        hideErrors: true
      })
      this.bot = bot

      bot.once('spawn', () => {
        this.builder = new Builder(bot, m => this.log(m))
        settled = true
        this.log(`Joined as ${bot.username} (Minecraft ${bot.version}, ${bot.game.gameMode} mode).`)
        this.emit('status', this.status())
        resolve(this.status())
      })
      bot.on('game', () => this.emit('status', this.status()))
      bot.on('kicked', reason => {
        const text = typeof reason === 'string' ? reason : JSON.stringify(reason)
        this.log(`Kicked: ${text}`)
        fail(new Error(`Kicked by server: ${text}`))
      })
      bot.on('error', err => {
        const msg = err?.code === 'ECONNREFUSED'
          ? `Could not connect to ${o.host}:${o.port}. Is the world open to LAN / server running, and is the port right?`
          : (err?.message || String(err))
        if (msg !== this.lastError) this.log(`Error: ${msg}`)
        this.lastError = msg
        fail(new Error(msg))
      })
      bot.on('end', reason => {
        this.log(`Disconnected (${reason}).`)
        this.bot = null
        this.builder = null
        this.emit('status', this.status())
        fail(new Error(`Disconnected (${reason})`))
      })
      bot.on('chat', (username, message) => this.onChat(username, message))
    })
  }

  disconnect () {
    this.builder?.stop()
    this.bot?.quit()
  }

  stop () {
    if (this.builder?.busy) { this.builder.stop(); this.say('Stopping...') }
  }

  // ---- chat commands -------------------------------------------------------

  onChat (username, message) {
    const o = this.options
    if (!o.chatCommands || username === this.bot?.username || !message.startsWith('!')) return
    if (!o.owner || username.toLowerCase() !== o.owner.toLowerCase()) return // only the owner, ever
    this.handleCommand(username, message.slice(1).trim()).catch(err => this.say(`Error: ${err.message}`))
  }

  async handleCommand (username, text) {
    const [cmd, ...args] = text.split(/\s+/)
    switch ((cmd || '').toLowerCase()) {
      case 'help':
        this.say('!build <image or link> [size] [notes] | !rebuild <design> | !designs | !stop')
        return
      case 'designs': {
        const names = listDesigns()
        this.say(names.length ? `Saved designs: ${names.join(', ')}` : 'No saved designs yet.')
        return
      }
      case 'stop': this.stop(); return
      case 'build': {
        if (!args[0]) return this.say('Usage: !build <image> [size] [extra instructions]')
        let rest = args.slice(1)
        let size = this.options.defaultSize || 24
        if (rest.length && Number.isInteger(Number(rest[0]))) { size = Number(rest[0]); rest = rest.slice(1) }
        const placement = this.placementFromPlayer(username)
        const blueprint = await this.design(args[0], size, rest.join(' '))
        await this.build(blueprint, { size, placement })
        return
      }
      case 'rebuild': {
        if (!args[0]) return this.say('Usage: !rebuild <design>')
        await this.build(loadDesign(args[0]), { size: this.options.maxSize, placement: this.placementFromPlayer(username) })
        return
      }
      default: this.say('Unknown command. Type !help')
    }
  }

  placementFromPlayer (username) {
    const entity = this.bot.players[username]?.entity
    if (!entity) throw new Error(`I can't see ${username}. Come closer to the bot.`)
    return { mode: 'coords', ...entity.position.floored(), facing: yawToFacing(entity.yaw) }
  }

  // ---- design & build ------------------------------------------------------

  async design (image, size, notes) {
    if (this.busy) throw new Error('Already busy. Stop the current job first.')
    this.designing = true
    this.emit('status', this.status())
    try {
      this.say(`Designing a build from ${image}...`)
      const blueprint = await this.options.designImage(image, size, notes, this.bot ? suggestedBlocks(this.bot.registry) : undefined)
      const name = saveDesign(blueprint)
      this.say(`Design ready: ${blueprint.description} (saved as "${name}")`)
      return blueprint
    } finally {
      this.designing = false
      this.emit('status', this.status())
    }
  }

  /**
   * placement: { mode: 'bot' } builds in front of the bot, facing where it looks.
   *            { mode: 'player', player } builds in front of that player.
   *            { mode: 'coords', x, y, z, facing } builds at a spot.
   */
  async build (blueprint, { size, placement }) {
    const bot = this.bot
    if (!bot?.entity) throw new Error('The bot is not connected.')
    if (this.builder.busy) throw new Error('Already building. Stop first.')

    let feet; let facing
    if (placement.mode === 'player') {
      placement = this.placementFromPlayer(placement.player)
    }
    if (placement.mode === 'coords') {
      feet = new Vec3(Number(placement.x), Number(placement.y), Number(placement.z))
      facing = placement.facing || 'north'
    } else {
      feet = bot.entity.position.floored()
      facing = yawToFacing(bot.entity.yaw)
    }

    const expanded = expandBlueprint(blueprint, bot.registry, size || this.options.maxSize || 64)
    expanded.warnings.forEach(w => this.log(w))
    if (!expanded.blocks.size) throw new Error('That design is empty.')

    const missing = this.builder.missingMaterials(expanded.blocks)
    if (missing.length) {
      this.say(`Survival mode: missing ${missing.length} kinds of blocks. Those spots will be skipped.`)
      for (const m of missing) this.log(`  ${m.name}: need ${m.need}, have ${m.have}`)
    }

    const frame = placementFrame(feet, facing, expanded.size)
    this.say(`Building ${expanded.blocks.size} blocks (${expanded.size.x}x${expanded.size.y}x${expanded.size.z}) facing ${facing}.`)
    this.emit('status', this.status())
    let lastPct = -1
    const result = await this.builder.build(expanded.blocks, frame, (done, total) => {
      this.emit('progress', { done, total })
      const pct = Math.floor((done / total) * 4) * 25
      if (pct > lastPct && pct > 0 && pct < 100) { lastPct = pct; this.say(`${pct}% done`) }
    })
    this.emit('status', this.status())
    const note = result.failed.length ? `, ${result.failed.length} skipped` : ''
    this.say(`${result.stopped ? 'Stopped' : 'Finished'}! Placed ${result.placed} blocks in ${result.seconds}s${note}.`)
    const reasons = new Map()
    for (const f of result.failed) reasons.set(f.error, (reasons.get(f.error) || 0) + 1)
    for (const [why, n] of reasons) this.log(`  ${n} skipped: ${why}`)
    return result
  }
}
