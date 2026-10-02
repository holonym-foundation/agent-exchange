import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { getConfigDir } from './config.js'

// v1 ships file-backed storage under $XDG_CONFIG_HOME/aex-fleet/sessions/<agent-id>/session.json
// with mode 0600. The plan calls for OS keychain via keytar with a file fallback, but keytar was
// deprecated by its maintainers in late 2023. Swap in @napi-rs/keyring (or a stable successor)
// once one settles; this module's surface is the swap point.

export type SessionMaterial = Record<string, unknown>

export function sessionDir(agentId: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(agentId)) {
    throw new Error('Agent ID must be a single filename component starting with a letter or digit')
  }
  return resolve(getConfigDir(), 'sessions', agentId)
}

/** Shared directly with WaaP: do not copy sessions in or out after a command. */
export function ensureSessionDir(agentId: string): string {
  const dir = sessionDir(agentId)
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  chmodSync(dir, 0o700)
  return dir
}

export function sessionPath(agentId: string): string {
  return join(sessionDir(agentId), 'session.json')
}

export function hasSession(agentId: string): boolean {
  return existsSync(sessionPath(agentId))
}

export function readSession(agentId: string): SessionMaterial | undefined {
  const p = sessionPath(agentId)
  if (!existsSync(p)) return undefined
  return JSON.parse(readFileSync(p, 'utf8')) as SessionMaterial
}

export function writeSession(agentId: string, session: SessionMaterial): void {
  ensureSessionDir(agentId)
  const p = sessionPath(agentId)
  writeFileSync(p, JSON.stringify(session, null, 2), { mode: 0o600 })
  chmodSync(p, 0o600)
}

export function deleteSession(agentId: string): void {
  const dir = sessionDir(agentId)
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true })
}
