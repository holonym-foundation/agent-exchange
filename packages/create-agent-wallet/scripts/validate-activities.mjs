#!/usr/bin/env node

/**
 * Scaffold every declared runtime for every published template activity.
 * Pass one or more slugs to validate only those activities:
 *
 *   npm run validate:activity -- cetus-yield-agent
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const packageRoot = resolve(import.meta.dirname, '..')
const registryPath = resolve(packageRoot, 'dist/registry.json')
const cliPath = resolve(packageRoot, 'dist/index.js')
const requested = new Set(process.argv.slice(2))
const registry = JSON.parse(await readFile(registryPath, 'utf8'))
const activities = registry.activities.filter(
  (activity) => !activity.behavior && (requested.size === 0 || requested.has(activity.slug)),
)

if (requested.size > 0) {
  const found = new Set(activities.map((activity) => activity.slug))
  const missing = [...requested].filter((slug) => !found.has(slug))
  if (missing.length > 0) {
    console.error(`Unknown or non-template activity: ${missing.join(', ')}`)
    process.exit(1)
  }
}

if (activities.length === 0) {
  console.error('No template activities found to validate')
  process.exit(1)
}

const workDir = await mkdtemp(resolve(tmpdir(), 'aex-recipe-validation-'))
let scaffolded = 0

try {
  for (const activity of activities) {
    for (const runtime of activity.runtimes) {
      const projectName = `${activity.slug}-${runtime}`
      const result = spawnSync(
        process.execPath,
        [
          cliPath,
          '--activity',
          activity.slug,
          '--runtime',
          runtime,
          '--no-session',
          '--yes',
          projectName,
        ],
        { cwd: workDir, encoding: 'utf8' },
      )

      if (result.status !== 0) {
        process.stderr.write(result.stdout ?? '')
        process.stderr.write(result.stderr ?? '')
        console.error(`Failed: ${activity.slug} / ${runtime}`)
        process.exit(1)
      }
      scaffolded++
      console.log(`✓ ${activity.slug} / ${runtime}`)
    }
  }
} finally {
  await rm(workDir, { recursive: true, force: true })
}

console.log(`Validated ${activities.length} activities across ${scaffolded} runtime templates`)
