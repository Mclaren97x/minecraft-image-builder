// Builds the installer and publishes it as a GitHub Release.
// Installed copies of the app see the new release and update themselves.
//   1. Raise "version" in package.json (e.g. 1.1.0 -> 1.2.0) and commit
//   2. npm run release -- "What changed in this version"
// Uses your GitHub CLI login (gh auth login) to upload.

import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'

const run = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8' }).trim()
const { version } = JSON.parse(fs.readFileSync('package.json', 'utf8'))
const tag = `v${version}`
const notes = process.argv.slice(2).join(' ') || `Image Builder ${version}`

try { run('gh', ['auth', 'status']) } catch {
  console.error('Sign in to GitHub first: gh auth login')
  process.exit(1)
}
if (run('gh', ['release', 'list', '--json', 'tagName', '--jq', '.[].tagName']).split('\n').includes(tag)) {
  console.error(`Version ${version} is already released. Raise "version" in package.json first.`)
  process.exit(1)
}
if (run('git', ['status', '--porcelain'])) {
  console.error('Commit your changes first, so the release matches the code.')
  process.exit(1)
}

console.log(`Building version ${version}...`)
fs.rmSync('dist', { recursive: true, force: true })
const build = spawnSync('npx', ['electron-builder', '--win', 'nsis', '--publish', 'never'], { stdio: 'inherit', shell: true })
if (build.status !== 0) process.exit(build.status ?? 1)

const files = [`dist/Image-Builder-Setup-${version}.exe`, `dist/Image-Builder-Setup-${version}.exe.blockmap`, 'dist/latest.yml']
for (const f of files) if (!fs.existsSync(f)) { console.error(`Missing ${f}`); process.exit(1) }

if (!run('git', ['tag', '--list', tag])) run('git', ['tag', tag])
execFileSync('git', ['push', 'origin', 'HEAD', tag], { stdio: 'inherit' })
console.log('Uploading to GitHub...')
execFileSync('gh', ['release', 'create', tag, ...files, '--title', tag, '--notes', notes, '--latest'], { stdio: 'inherit' })
console.log(`\nPublished ${tag}. Installed apps pick it up on their next check (at launch and every 4 hours).`)
