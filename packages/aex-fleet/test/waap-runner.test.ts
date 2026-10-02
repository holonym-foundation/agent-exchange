import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readSession, sessionDir, sessionPath, writeSession } from '../src/core/keychain.js'
import { passthroughExec, passthroughWaap, runWaap, sandboxDir } from '../src/core/waap-runner.js'

// Process fixtures exercise failures and file lifecycle without authenticating or signing.
describe('waap-runner', () => {
  let root: string
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'aex-fleet-profiles-'))
    vi.stubEnv('AEX_FLEET_HOME', root)
    vi.stubEnv('WAAP_CLI_SESSION_DIR', join(root, 'operator-profile'))
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    rmSync(root, { recursive: true, force: true })
  })

  it('pins the agent profile over inherited settings and preserves HOME', async () => {
    const result = await runWaap({ agentId: 'alpha', bin: process.execPath,
      args: ['-e', 'console.log(JSON.stringify({profile:process.env.WAAP_CLI_SESSION_DIR,home:process.env.HOME}))'] })
    expect(result.exitCode).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual({ profile: sessionDir('alpha'), home: process.env.HOME })
    expect(statSync(sessionDir('alpha')).mode & 0o777).toBe(0o700)
  })

  it('uses the canonical session directly and retains pending registration across commands', async () => {
    writeSession('alpha', { jwt: 'fixture-old' })
    const result = await runWaap({ agentId: 'alpha', bin: process.execPath, args: ['-e', `
      const fs = require('fs'), dir = process.env.WAAP_CLI_SESSION_DIR;
      if (JSON.parse(fs.readFileSync(dir+'/session.json')).jwt !== 'fixture-old') process.exit(9);
      fs.writeFileSync(dir+'/session.json', JSON.stringify({jwt:'fixture-new'}), {mode:0o600});
      fs.writeFileSync(dir+'/pending-registration.json', JSON.stringify({flowId:'fixture-flow'}), {mode:0o600});
    `] })
    expect(result.exitCode).toBe(0)
    expect(readSession('alpha')).toEqual({ jwt: 'fixture-new' })
    const next = await runWaap({ agentId: 'alpha', bin: process.execPath,
      args: ['-e', "console.log(require('fs').readFileSync(process.env.WAAP_CLI_SESSION_DIR+'/pending-registration.json','utf8'))"] })
    expect(JSON.parse(next.stdout)).toEqual({ flowId: 'fixture-flow' })
  })

  it('never resurrects a deleted session, including when stale legacy copies exist', async () => {
    writeSession('alpha', { jwt: 'fixture-current' })
    const legacy = join(sandboxDir('alpha'), '.waap-agent')
    mkdirSync(legacy, { recursive: true })
    writeFileSync(join(legacy, 'session.json'), '{"jwt":"fixture-stale"}')
    const removed = await runWaap({ agentId: 'alpha', bin: process.execPath,
      args: ['-e', "require('fs').unlinkSync(process.env.WAAP_CLI_SESSION_DIR+'/session.json'); process.exit(7)"] })
    expect(removed.exitCode).toBe(7)
    const next = await runWaap({ agentId: 'alpha', bin: process.execPath,
      args: ['-e', "console.log(require('fs').existsSync(process.env.WAAP_CLI_SESSION_DIR+'/session.json'))"] })
    expect(next.stdout).toBe('false')
    expect(readSession('alpha')).toBeUndefined()
    expect(existsSync(join(legacy, 'session.json'))).toBe(true)
  })

  it.each(['waap', 'exec'])('pins the same profile for %s passthrough', async (kind) => {
    const receipt = join(root, `${kind}.json`)
    const args = ['-e', `require('fs').writeFileSync(process.argv[1], JSON.stringify({profile:process.env.WAAP_CLI_SESSION_DIR,home:process.env.HOME}))`, receipt]
    const code = kind === 'waap'
      ? await passthroughWaap({ agentId: 'alpha', bin: process.execPath, args })
      : await passthroughExec({ agentId: 'alpha', cmd: process.execPath, args })
    expect(code).toBe(0)
    expect(JSON.parse(readFileSync(receipt, 'utf8'))).toEqual({ profile: sessionDir('alpha'), home: process.env.HOME })
  })

  it('preserves a damaged session rather than treating it as a successful logout', async () => {
    writeSession('alpha', { jwt: 'fixture' })
    const result = await runWaap({ agentId: 'alpha', bin: process.execPath,
      args: ['-e', "require('fs').writeFileSync(process.env.WAAP_CLI_SESSION_DIR+'/session.json', '{broken'); process.exit(2)"] })
    expect(result.exitCode).toBe(2)
    expect(readFileSync(sessionPath('alpha'), 'utf8')).toBe('{broken')
    expect(() => readSession('alpha')).toThrow()
  })

  it.each(['../other', '..', '/tmp/other', 'alpha/beta', 'alpha\\beta', ''])('rejects invalid profile ID %j before spawning', async (agentId) => {
    await expect(runWaap({ agentId, bin: process.execPath, args: ['-e', 'process.exit(0)'] })).rejects.toThrow('Agent ID')
  })

  it('captures exit code and stderr', async () => {
    const result = await runWaap({ agentId: 'alpha', bin: process.execPath, args: ['-e', "console.error('boom'); process.exit(2)"] })
    expect(result.exitCode).toBe(2)
    expect(result.stderr).toContain('boom')
  })

  it('returns a failure when the binary cannot spawn', async () => {
    const result = await runWaap({ agentId: 'alpha', bin: '/nonexistent/waap-cli', args: ['--version'] })
    expect(result.exitCode).not.toBe(0)
    expect(result.stderr.length).toBeGreaterThan(0)
  })
})
