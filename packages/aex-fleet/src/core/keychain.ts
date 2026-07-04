import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { getConfigDir } from './config.js'

// v1 ships file-backed storage under $XDG_CONFIG_HOME/aex-fleet/sessions/<agent-id>/session.json
// with mode 0600. The plan calls for OS keychain via keytar with a file fallback, but keytar was
// deprecated by its maintainers in late 2023. Swap in @napi-rs/keyring (or a stable successor)
// once one settles; this module's surface is the swap point.

export type SessionMaterial = Record<string, unknown>

export function sessionDir(agentId: string): string {
  return join(getConfigDir(), 'sessions', agentId)
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
  const dir = sessionDir(agentId)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 })
  const p = sessionPath(agentId)
  writeFileSync(p, JSON.stringify(session, null, 2), { mode: 0o600 })
  chmodSync(p, 0o600)
}

export function deleteSession(agentId: string): void {
  const dir = sessionDir(agentId)
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true })
}
