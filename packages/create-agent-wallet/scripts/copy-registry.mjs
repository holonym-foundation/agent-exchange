#!/usr/bin/env node
/**
 * Post-build step:
 *   1. Assemble dist/registry/ from the monorepo agents/ directory (primary)
 *      or the local registry/activities/ fallback.
 *   2. Copy registry/build/ into dist/registry/build/ (needed by the builder).
 *   3. Run the TypeScript registry builder via tsx to produce
 *      dist/registry.json (offline fallback for `npx`).
 */
import { cp, rm, mkdir, readdir, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const here = dirname(fileURLToPath(import.meta.url))
const pkgRoot = resolve(here, '..')
const distRegistry = resolve(pkgRoot, 'dist/registry')
const distActivities = resolve(distRegistry, 'activities')

// Monorepo layout: agents/ lives at repo root (../../ from this package).
const monorepoAgents = resolve(pkgRoot, '../../agents')
// Fallback: local registry/activities/ (standalone / legacy layout).
const localActivities = resolve(pkgRoot, 'registry/activities')

const agentsRoot = existsSync(monorepoAgents) ? monorepoAgents : localActivities

if (!existsSync(agentsRoot)) {
  console.error(`✗ no agents directory found at ${monorepoAgents} or ${localActivities}`)
  process.exit(1)
}

// Clean dist/registry
await rm(distRegistry, { recursive: true, force: true })
await mkdir(distActivities, { recursive: true })

// Copy registry/build/ into dist/registry/build/ (needed by the builder script)
const buildDir = resolve(pkgRoot, 'registry/build')
if (existsSync(buildDir)) {
  await cp(buildDir, resolve(distRegistry, 'build'), { recursive: true })
}

// Copy each agent directory that has activity.json + templates/
const entries = await readdir(agentsRoot, { withFileTypes: true })
let copied = 0
for (const entry of entries) {
  if (!entry.isDirectory()) continue
  const agentDir = join(agentsRoot, entry.name)
  const hasActivityJson = existsSync(join(agentDir, 'activity.json'))
  // Copy any agent that has activity.json. Template-class agents bring their templates/;
  // profile-class agents (behavior lives in activity.json, run on the managed AEX runtime)
  // ship no scaffold templates and that's fine.
  if (hasActivityJson) {
    await cp(agentDir, join(distActivities, entry.name), { recursive: true })
    copied++
  }
}
console.log(`✓ copied ${copied} activities from ${agentsRoot} → dist/registry/activities`)

// Run the TS builder via tsx — keeps schema + build logic in one TS file.
const builder = resolve(pkgRoot, 'registry/build/build-registry.ts')
const result = spawnSync('npx', ['tsx', builder], {
  cwd: pkgRoot,
  stdio: 'inherit'
})
if (result.status !== 0) {
  console.error('✗ registry build failed')
  process.exit(result.status ?? 1)
}
