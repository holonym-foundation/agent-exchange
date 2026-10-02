#!/usr/bin/env node
// Validate the artifact builders actually install, rather than only the source tree.
import { mkdtempSync, readFileSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const root = resolve(import.meta.dirname, '..')
const scratch = mkdtempSync(join(tmpdir(), 'aex-packed-projects-'))
const npmrc = join(scratch, 'npmrc')
writeFileSync(npmrc, '')
const env = {
  PATH: process.env.PATH,
  ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
  npm_config_userconfig: npmrc,
  npm_config_cache: process.env.npm_config_cache ?? join(scratch, 'npm-cache'),
  npm_config_audit: 'false',
  npm_config_fund: 'false',
}
function run(bin, args, cwd) {
  const result = spawnSync(bin, args, { cwd, env, encoding: 'utf8', timeout: 180_000, maxBuffer: 8 * 1024 * 1024 })
  if (result.status !== 0) throw new Error(`${bin} ${args.join(' ')} failed: ${result.error?.message ?? ''}\n${result.stdout ?? ''}\n${result.stderr ?? ''}`)
  return result.stdout
}
try {
  const [packed] = JSON.parse(run('npm', ['pack', '--json', '--pack-destination', scratch], root))
  const consumer = join(scratch, 'consumer')
  mkdirSync(consumer)
  run('npm', ['install', '--ignore-scripts', join(scratch, packed.filename)], consumer)
  const installed = join(consumer, 'node_modules/@human.tech/create-agent-wallet/dist')
  const registry = JSON.parse(readFileSync(join(installed, 'registry.json'), 'utf8'))
  const projects = registry.activities.filter(a => !a.behavior && a.runtimes.includes('standalone'))
  if (!projects.length) throw new Error('No standalone projects in packed registry')
  for (const activity of projects) {
    const project = `${activity.slug}-consumer`
    run(process.execPath, [join(installed, 'index.js'), '--activity', activity.slug, '--runtime', 'standalone', '--no-session', '--no-cache', '--yes', project], consumer)
    const directory = join(consumer, project)
    run('npm', ['install', '--ignore-scripts'], directory)
    run('npm', ['run', 'type-check'], directory)
    console.log(`✓ packed consumer: ${activity.slug} installs and typechecks (agent not executed)`)
  }
} finally {
  rmSync(scratch, { recursive: true, force: true })
}
