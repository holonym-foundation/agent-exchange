#!/usr/bin/env node
// Run checks before this script. It rebuilds clean Git source and never publishes.
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const root = resolve(import.meta.dirname, '..')
const output = process.argv[2] && resolve(process.argv[2])
if (!output || existsSync(output)) throw new Error('Pass a new output directory outside the checkout')
if (output === root || output.startsWith(root + '/')) throw new Error('Release output must be outside the checkout')
function run(bin, args, cwd = root, env = process.env) {
  const result = spawnSync(bin, args, { cwd, env, encoding: 'utf8', timeout: 180_000, maxBuffer: 16 * 1024 * 1024 })
  if (result.status !== 0) throw new Error(`${bin} failed: ${result.error?.message ?? ''}\n${result.stdout ?? ''}\n${result.stderr ?? ''}`)
  return result.stdout.trim()
}
if (run('git', ['status', '--porcelain']).length) throw new Error('Commit or isolate changes before preparing a release')
const revision = run('git', ['rev-parse', 'HEAD'])
const tree = run('git', ['rev-parse', 'HEAD^{tree}'])
const sourceDateEpoch = run('git', ['show', '-s', '--format=%ct', 'HEAD'])
const buildEnv = { ...process.env, SOURCE_DATE_EPOCH: sourceDateEpoch }
mkdirSync(output)
const manifest = { schemaVersion: 1, revision, tree, sourceDateEpoch, node: process.version, npm: run('npm', ['--version']), packages: [] }
const scratch = mkdtempSync(join(tmpdir(), 'aex-release-consumer-'))
const npmrc = join(scratch, 'npmrc')
writeFileSync(npmrc, '')
const consumerEnv = { PATH: process.env.PATH, npm_config_userconfig: npmrc,
  npm_config_cache: process.env.npm_config_cache ?? join(scratch, 'cache'), npm_config_audit: 'false', npm_config_fund: 'false',
  AEX_FLEET_HOME: join(scratch, 'fleet-profile') }
try {
  for (const name of ['create-agent-wallet', 'aex-fleet']) {
    const directory = join(root, 'packages', name)
    const pkg = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'))
    const lock = JSON.parse(readFileSync(join(directory, 'package-lock.json'), 'utf8'))
    if (pkg.version !== lock.version || pkg.version !== lock.packages[''].version) throw new Error(`${name}: package/lock version mismatch`)
    if (pkg.repository.url !== 'https://github.com/holonym-foundation/agent-exchange.git') throw new Error(`${name}: wrong public repository`)
    run('npm', ['run', 'build'], directory, buildEnv)
    const [packed] = JSON.parse(run('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', output], directory))
    if (packed.filename !== basename(packed.filename)) throw new Error('Unexpected tarball filename')
    const files = packed.files.map(file => file.path)
    if (!files.includes('dist/index.js') || !files.includes('package.json')) throw new Error(`${name}: missing executable/package metadata`)
    for (const file of files) {
      const forbidden = file.split('/').some(part =>
        ['.npmrc', 'node_modules', '.git', 'secrets'].includes(part)
        || (part.startsWith('.env') && part !== '.env.example'))
      if (forbidden || /\.(pem|key|keystore)$/.test(file)) throw new Error(`${name}: forbidden package file ${file}`)
    }
    if (name === 'create-agent-wallet') {
      const registry = JSON.parse(readFileSync(join(directory, 'dist/registry.json'), 'utf8'))
      for (const activity of registry.activities.filter(a => !a.behavior)) {
        if (activity.runtimes.includes('standalone') && !files.includes(`dist/registry/activities/${activity.slug}/templates/standalone/agent.ts.tpl`)) throw new Error(`Missing ${activity.slug} standalone template`)
      }
    }
    const artifact = join(output, packed.filename)
    const bytes = readFileSync(artifact)
    const integrity = 'sha512-' + createHash('sha512').update(bytes).digest('base64')
    if (integrity !== packed.integrity) throw new Error(`${name}: npm integrity mismatch`)
    // Rebuild and repack on this runner; keep the first, already-inspected artifact.
    // Compression implementations can differ across OS builds, so compare exact bytes here.
    const repeatedOutput = join(scratch, `${name}-repeat`)
    mkdirSync(repeatedOutput)
    run('npm', ['run', 'build'], directory, buildEnv)
    run('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', repeatedOutput], directory)
    if (!readFileSync(join(repeatedOutput, packed.filename)).equals(bytes)) throw new Error(`${name}: repeated build produced different package bytes`)
    const consumer = join(scratch, name)
    mkdirSync(consumer)
    run('npm', ['install', '--ignore-scripts', artifact], consumer, consumerEnv)
    const installed = join(consumer, 'node_modules', pkg.name)
    const reported = run(process.execPath, [join(installed, 'dist/index.js'), '--version'], consumer, consumerEnv)
    if (reported !== pkg.version) throw new Error(`${name}: installed CLI reports ${reported}, package says ${pkg.version}`)
    manifest.packages.push({ name: pkg.name, version: pkg.version, filename: packed.filename, integrity,
      sha256: createHash('sha256').update(bytes).digest('hex'), files: files.length, installedVersion: reported, repeatedBuildIdentical: true })
    console.log(`✓ ${pkg.name}@${pkg.version}: packed, installed, version verified`)
  }
  if (run('git', ['rev-parse', 'HEAD']) !== revision || run('git', ['status', '--porcelain'])) throw new Error('Source changed while preparing artifacts')
  writeFileSync(join(output, 'release-manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' })
  console.log(`Release candidates written to ${output}; nothing published`)
} finally { rmSync(scratch, { recursive: true, force: true }) }
