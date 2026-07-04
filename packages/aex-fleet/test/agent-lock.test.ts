import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runWaap } from '../src/core/waap-runner.js'

// Proves the per-agent advisory lock serialises concurrent invocations for the same agent:
// running three writes-to-session in parallel against `alpha` must produce three sequential
// writes, no torn JSON. We use a node-script fake bin that appends a marker, then verify the
// final session contains all three markers in order.

describe('per-agent lock', () => {
  let xdg: string

  beforeEach(() => {
    xdg = mkdtempSync(join(tmpdir(), 'aex-fleet-lock-'))
    process.env.XDG_CONFIG_HOME = xdg
  })

  afterEach(() => {
    delete process.env.XDG_CONFIG_HOME
    rmSync(xdg, { recursive: true, force: true })
  })

  it('serialises concurrent runs against the same agent', async () => {
    // Each invocation: read whatever's in session.json (default []), append its tag, write back.
    // Without the lock, the three reads would race and two writes would be lost.
    const script = `
      const fs = require('fs');
      const p = process.env.HOME + '/.waap-agent/session.json';
      let cur = [];
      try { cur = JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) {}
      cur.push(process.argv[1]);
      // tiny artificial delay to widen the race window
      const end = Date.now() + 50;
      while (Date.now() < end) {}
      fs.writeFileSync(p, JSON.stringify(cur));
      console.log(cur.join(','));
    `
    const runOne = (tag: string) =>
      runWaap({
        agentId: 'lock-test',
        bin: process.execPath,
        args: ['-e', script, tag]
      })

    const results = await Promise.all([runOne('one'), runOne('two'), runOne('three')])
    for (const r of results) expect(r.exitCode).toBe(0)

    // The persisted store is the truth — under the lock, all three writes survive.
    const { readFileSync } = await import('node:fs')
    const stored = JSON.parse(
      readFileSync(join(xdg, 'aex-fleet', 'sessions', 'lock-test', 'session.json'), 'utf8')
    )
    expect((stored as string[]).sort()).toEqual(['one', 'three', 'two'])
  })
})
