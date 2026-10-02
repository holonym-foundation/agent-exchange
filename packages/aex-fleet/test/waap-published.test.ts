import { mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sessionDir, sessionPath, writeSession } from '../src/core/keychain.js'
import { runWaap } from '../src/core/waap-runner.js'

const require = createRequire(import.meta.url)
const cli = require.resolve('@human.tech/waap-cli')
const denyNetwork = join(dirname(fileURLToPath(import.meta.url)), 'fixtures/deny-network.cjs')
const fixture = (agent: string) => ({
  token: `fixture-bearer-${agent}`,
  // Local diagnostics decode metadata only; this unsigned fixture cannot authorize a request.
  jwt: ['fixture', Buffer.from(JSON.stringify({ is_agent: true, email: `${agent}@example.invalid`, exp: 4102444800 })).toString('base64url'), 'fixture-signature'].join('.'),
  userId: `fixture-user-${agent}`, email: `${agent}@example.invalid`,
  savedAt: '2026-01-01T00:00:00.000Z'
})
const inspect = (agentId: string) => runWaap({
  agentId, bin: process.execPath, args: ['--require', denyNetwork, cli, 'session-info', '--json']
})

describe('published WaaP CLI compatibility (no network, synthetic sessions)', () => {
  let root: string
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'aex-waap-published-'))
    vi.stubEnv('AEX_FLEET_HOME', root)
    vi.stubEnv('WAAP_CLI_SESSION_DIR', join(root, 'operator-profile'))
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    rmSync(root, { recursive: true, force: true })
  })

  it('executes the exact supported published version', async () => {
    expect(require('@human.tech/waap-cli/package.json').version).toBe('2.2.1')
    const result = await runWaap({ agentId: 'version', bin: process.execPath,
      args: ['--require', denyNetwork, cli, '--version'] })
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('2.2.1')
  })

  it('reads three concurrent profiles without crossing identities or printing credentials', async () => {
    const agents = ['alpha', 'beta', 'gamma']
    for (const agent of agents) writeSession(agent, fixture(agent))
    const results = await Promise.all(agents.map(inspect))
    results.forEach((result, i) => {
      expect(result.exitCode, result.stdout + result.stderr).toBe(0)
      expect(result.stdout).toContain(`${agents[i]}@example.invalid`)
      for (const sibling of agents.filter((_, j) => j !== i)) {
        expect(result.stdout).not.toContain(`${sibling}@example.invalid`)
      }
      expect(result.stdout + result.stderr).not.toContain(fixture(agents[i]).token)
      expect(result.stdout + result.stderr).not.toContain(fixture(agents[i]).jwt)
      expect(JSON.parse(readFileSync(sessionPath(agents[i]), 'utf8'))).toEqual(fixture(agents[i]))
    })
  })

  it('observes deletion without restoring a session and retains unrelated registration state', async () => {
    writeSession('alpha', fixture('alpha'))
    const pending = join(sessionDir('alpha'), 'pending-registration.json')
    writeFileSync(pending, '{"flowId":"fixture-pending"}', { mode: 0o600 })
    expect((await inspect('alpha')).exitCode).toBe(0)
    // Remote logout is outside this offline test. Model its completed local deletion.
    unlinkSync(sessionPath('alpha'))
    const next = await inspect('alpha')
    expect(next.exitCode).not.toBe(0)
    expect(next.exitCode).not.toBe(97)
    expect(next.stdout + next.stderr).toContain('NO_SESSION')
    expect(readFileSync(pending, 'utf8')).toBe('{"flowId":"fixture-pending"}')
  })
})
