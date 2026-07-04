import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readSession, writeSession } from '../src/core/keychain.js'
import { runWaap, sandboxDir } from '../src/core/waap-runner.js'

// We use `process.execPath` (node itself) as the fake waap-cli binary and pass `-e <script>` to
// have it read/write the sandbox's session.json. That lets us prove HOME-overriding works and
// the materialise/persist cycle round-trips, without needing a real waap-cli installed.

describe('waap-runner', () => {
  let xdg: string

  beforeEach(() => {
    xdg = mkdtempSync(join(tmpdir(), 'aex-fleet-xdg-'))
    process.env.XDG_CONFIG_HOME = xdg
  })

  afterEach(() => {
    delete process.env.XDG_CONFIG_HOME
    rmSync(xdg, { recursive: true, force: true })
  })

  it('runs the binary with HOME pointed at the agent sandbox', async () => {
    const result = await runWaap({
      agentId: 'sandbox-test',
      bin: process.execPath,
      args: ['-e', 'console.log(process.env.HOME)']
    })
    expect(result.exitCode).toBe(0)
    expect(result.stdout.trim()).toBe(sandboxDir('sandbox-test'))
  })

  it('materialises the stored session into the sandbox before invocation', async () => {
    writeSession('mat-test', { jwt: 'abc', userKey: 'k' })
    const result = await runWaap({
      agentId: 'mat-test',
      bin: process.execPath,
      args: [
        '-e',
        "const fs=require('fs'); process.stdout.write(fs.readFileSync(process.env.HOME+'/.waap-agent/session.json','utf8'))"
      ]
    })
    expect(result.exitCode).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual({ jwt: 'abc', userKey: 'k' })
  })

  it('persists session changes back to the store after invocation', async () => {
    writeSession('persist-test', { jwt: 'old' })
    const result = await runWaap({
      agentId: 'persist-test',
      bin: process.execPath,
      args: [
        '-e',
        "const fs=require('fs'); fs.writeFileSync(process.env.HOME+'/.waap-agent/session.json', JSON.stringify({jwt:'new'}))"
      ]
    })
    expect(result.exitCode).toBe(0)
    expect(readSession('persist-test')).toEqual({ jwt: 'new' })
  })

  it('returns the non-zero exit code when the binary fails', async () => {
    const result = await runWaap({
      agentId: 'fail-test',
      bin: process.execPath,
      args: ['-e', 'process.exit(7)']
    })
    expect(result.exitCode).toBe(7)
  })

  it('captures stderr from the binary', async () => {
    const result = await runWaap({
      agentId: 'stderr-test',
      bin: process.execPath,
      args: ['-e', "console.error('boom'); process.exit(2)"]
    })
    expect(result.exitCode).toBe(2)
    expect(result.stderr).toContain('boom')
  })

  it('returns a non-zero exit code with a message when the binary is not found', async () => {
    const result = await runWaap({
      agentId: 'missing-test',
      bin: '/nonexistent/waap-cli-xyz',
      args: ['--version']
    })
    expect(result.exitCode).not.toBe(0)
    expect(result.stderr.length).toBeGreaterThan(0)
  })
})
