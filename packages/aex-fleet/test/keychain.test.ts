import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  deleteSession,
  hasSession,
  readSession,
  sessionPath,
  writeSession
} from '../src/core/keychain.js'

describe('keychain (file-backed session store)', () => {
  let xdg: string

  beforeEach(() => {
    xdg = mkdtempSync(join(tmpdir(), 'aex-fleet-xdg-'))
    process.env.XDG_CONFIG_HOME = xdg
  })

  afterEach(() => {
    delete process.env.XDG_CONFIG_HOME
    rmSync(xdg, { recursive: true, force: true })
  })

  it('round-trips a session payload', () => {
    expect(hasSession('a1')).toBe(false)
    writeSession('a1', { jwt: 'token', userKey: 'k' })
    expect(hasSession('a1')).toBe(true)
    expect(readSession('a1')).toEqual({ jwt: 'token', userKey: 'k' })
  })

  it('writes the session file with mode 0600', () => {
    writeSession('a2', { jwt: 'x' })
    const mode = statSync(sessionPath('a2')).mode & 0o777
    expect(mode).toBe(0o600)
  })

  it('returns undefined for unknown agents', () => {
    expect(readSession('never-existed')).toBeUndefined()
  })

  it('deletes the agent session directory', () => {
    writeSession('a3', { jwt: 'x' })
    deleteSession('a3')
    expect(hasSession('a3')).toBe(false)
  })
})
