// Builds the installer and publishes it as a GitHub Release.
// Installed copies of the app see the new release and update themselves.
//   1. Raise "version" in package.json (e.g. 1.1.0 -> 1.2.0)
//   2. npm run release
// Uses your GitHub CLI login (gh auth login) to upload.

import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'

const { version } = JSON.parse(fs.readFileSync('package.json', 'utf8'))
let token
try {
  token = execFileSync('gh', ['auth', 'token'], { encoding: 'utf8' }).trim()
} catch {
  console.error('Sign in to GitHub first: gh auth login')
  process.exit(1)
}

const tags = execFileSync('gh', ['release', 'list', '--json', 'tagName', '--jq', '.[].tagName'], { encoding: 'utf8' }).split('\n')
if (tags.includes(`v${version}`)) {
  console.error(`Version ${version} is already released. Raise "version" in package.json first.`)
  process.exit(1)
}

console.log(`Building and publishing version ${version}...`)
const r = spawnSync('npx', ['electron-builder', '--win', 'nsis', '--publish', 'always'], {
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, GH_TOKEN: token }
})
if (r.status !== 0) process.exit(r.status ?? 1)
console.log(`\nPublished v${version}. Installed apps will pick it up within a few hours (or on next launch).`)
