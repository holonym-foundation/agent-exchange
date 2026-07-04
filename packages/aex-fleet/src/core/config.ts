import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import envPaths from 'env-paths'
import lockfile from 'proper-lockfile'
import { FleetConfigSchema, type FleetConfig } from '../types.js'

const APP_NAME = 'aex-fleet'

export function getConfigDir(): string {
  // AEX_FLEET_HOME overrides the entire data root (config + sandboxes + sessions). Used by tests
  // and operators who want to scope a whole instance to one dir. Otherwise honor XDG, then fall
  // back to platform defaults via env-paths.
  if (process.env.AEX_FLEET_HOME) return process.env.AEX_FLEET_HOME
  const xdg = process.env.XDG_CONFIG_HOME
  if (xdg) return join(xdg, APP_NAME)
  return envPaths(APP_NAME, { suffix: '' }).config
}

export function getConfigPath(): string {
  return join(getConfigDir(), 'fleet.json')
}

export function emptyConfig(): FleetConfig {
  return { version: 1, agents: {} }
}

export function readConfig(path: string = getConfigPath()): FleetConfig {
  if (!existsSync(path)) return emptyConfig()
  const raw = readFileSync(path, 'utf8')
  return FleetConfigSchema.parse(JSON.parse(raw))
}

export async function withLockedConfig(
  mutator: (cfg: FleetConfig) => FleetConfig | Promise<FleetConfig>,
  path: string = getConfigPath()
): Promise<void> {
  const dir = dirname(path)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 })
  if (!existsSync(path)) {
    writeAtomic(path, emptyConfig())
  }
  const release = await lockfile.lock(path, {
    retries: { retries: 5, minTimeout: 50, maxTimeout: 200 }
  })
  try {
    const current = readConfig(path)
    const next = await mutator(current)
    writeAtomic(path, next)
  } finally {
    await release()
  }
}

function writeAtomic(path: string, cfg: FleetConfig): void {
  FleetConfigSchema.parse(cfg)
  const tmp = `${path}.tmp.${process.pid}`
  writeFileSync(tmp, JSON.stringify(cfg, null, 2), { mode: 0o600 })
  chmodSync(tmp, 0o600)
  renameSync(tmp, path)
}
