// Turns an image into a 3D Minecraft blueprint using Claude's vision.
// Claude returns a compact list of shape operations (boxes, walls, single blocks),
// which we expand locally into individual block positions.

import fs from 'node:fs'
import path from 'node:path'
import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod'

const MEDIA_TYPES = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp'
}

const Op = z.object({
  shape: z.enum(['fill', 'hollow_box', 'walls', 'block']).describe(
    'fill = solid box; hollow_box = box shell (walls+floor+ceiling); walls = 4 vertical walls only, open top/bottom; block = single block at (x1,y1,z1)'
  ),
  block: z.string().describe('Minecraft Java block id without namespace, e.g. oak_planks, stone_bricks, glass, air'),
  x1: z.number().int(), y1: z.number().int(), z1: z.number().int(),
  x2: z.number().int(), y2: z.number().int(), z2: z.number().int(),
  note: z.string().describe('Very short label, e.g. "front wall" or "roof layer 2"')
})

const Blueprint = z.object({
  name: z.string().describe('Short snake_case name for the build'),
  description: z.string().describe('One sentence describing what will be built'),
  ops: z.array(Op).describe('Applied in order; later ops overwrite earlier ones. Use block "air" to carve doors/windows/interiors.')
})

function systemPrompt (maxSize, validBlocks) {
  return `You are an expert Minecraft (Java Edition) builder. You look at an image and design a 3D build that recreates it in Minecraft blocks.

Coordinate system (relative to the build origin):
- x goes left->right across the front of the build (0 to ${maxSize - 1})
- y goes up (0 is the ground layer, max ${maxSize - 1})
- z goes front->back, away from the viewer (0 to ${maxSize - 1})
- The front of the build (z = 0) faces the player who asked for it.

Rules:
- Stay inside 0..${maxSize - 1} on every axis. Use the space well: an impressive, recognizable build, not a tiny one.
- Capture the subject's silhouette, proportions, colors and signature details (roof shape, towers, windows, trim, colors of a character).
- Prefer full solid blocks. You may use slabs, stairs, fences, walls, glass_pane and leaves, but avoid blocks that need special placement or support (doors, beds, torches, signs, buttons, flowers, carpets, rails, redstone, water, lava, sand, gravel, concrete_powder).
- Use "air" ops to carve interiors, doorways and windows. hollow_box/walls are great for buildings.
- Everything must be connected and supported: every block should touch the ground or another block (no floating parts).
- Use 20 to 250 ops. Prefer big shapes over many single blocks.
- Only use valid Minecraft Java block ids. Some valid ids: ${validBlocks}`
}

export const IMAGES_DIR = path.resolve('images')

// Accepts a web link, a full path, or a file name inside the images/ folder.
export async function loadImage (source) {
  if (/^https?:\/\//i.test(source)) {
    const res = await fetch(source)
    if (!res.ok) throw new Error(`Could not download image (HTTP ${res.status})`)
    const mediaType = (res.headers.get('content-type') || '').split(';')[0].trim()
    if (!Object.values(MEDIA_TYPES).includes(mediaType)) throw new Error(`That link is not a png/jpg/gif/webp image (${mediaType || 'unknown type'})`)
    return { mediaType, data: Buffer.from(await res.arrayBuffer()).toString('base64') }
  }
  let file = source
  if (!fs.existsSync(file)) file = path.join(IMAGES_DIR, source)
  if (!fs.existsSync(file)) {
    // Allow leaving off the extension: "castle" -> images/castle.png
    const match = fs.existsSync(IMAGES_DIR) && fs.readdirSync(IMAGES_DIR).find(f => path.parse(f).name.toLowerCase() === source.toLowerCase())
    if (!match) throw new Error(`Image "${source}" not found. Put it in the images folder.`)
    file = path.join(IMAGES_DIR, match)
  }
  const ext = path.extname(file).toLowerCase()
  const mediaType = MEDIA_TYPES[ext]
  if (!mediaType) throw new Error(`Unsupported image type "${ext}". Use png, jpg, gif or webp.`)
  return { mediaType, data: fs.readFileSync(file).toString('base64') }
}

export async function designFromImage ({ imagePath, prompt, maxSize, validBlocks, apiKey, log = console.log }) {
  const client = apiKey ? new Anthropic({ apiKey }) : new Anthropic()
  const image = await loadImage(imagePath)

  log('Asking Claude to design the build (this can take a minute)...')
  const response = await client.beta.messages.parse({
    model: 'claude-opus-5-5',
    max_tokens: 32000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'high', format: betaZodOutputFormat(Blueprint) },
    system: systemPrompt(maxSize, validBlocks),
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: image.mediaType, data: image.data } },
        { type: 'text', text: `Design a Minecraft build of this image, at most ${maxSize} blocks on each side.${prompt ? `\nExtra instructions from the player: ${prompt}` : ''}` }
      ]
    }]
  })

  if (response.stop_reason === 'refusal') throw new Error('Claude declined to design this image.')
  if (response.stop_reason === 'max_tokens') throw new Error('The design was too long and got cut off. Try a smaller size.')
  if (!response.parsed_output) throw new Error('Claude did not return a valid blueprint.')
  return response.parsed_output
}
