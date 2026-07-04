import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FleetManager } from '../src/core/FleetManager.js'
import { resolveRecipients } from '../src/core/resolve-recipient.js'

describe('resolveRecipients', () => {
  let dir: string
  let fm: FleetManager

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'aex-fleet-resolve-'))
    fm = new FleetManager(join(dir, 'fleet.json'))
    await fm.addAgent({ agentId: 'alpha', address: '0x1111111111111111111111111111111111111111' })
    await fm.addAgent({ agentId: 'bravo', address: '0x2222222222222222222222222222222222222222' })
    await fm.addAgent({ agentId: 'noaddr' }) // registered but no address
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('substitutes --to <agent-id> with the registered address', () => {
    const r = resolveRecipients(['send-tx', '--to', 'alpha', '--value', '0.001'], fm)
    expect(r.args).toEqual([
      'send-tx',
      '--to',
      '0x1111111111111111111111111111111111111111',
      '--value',
      '0.001'
    ])
    expect(r.substitutions).toEqual([
      { flag: '--to', from: 'alpha', to: '0x1111111111111111111111111111111111111111' }
    ])
  })

  it('substitutes --to=<agent-id> form', () => {
    const r = resolveRecipients(['send-tx', '--to=bravo'], fm)
    expect(r.args).toEqual(['send-tx', '--to=0x2222222222222222222222222222222222222222'])
    expect(r.substitutions).toHaveLength(1)
  })

  it('passes through raw addresses untouched', () => {
    const r = resolveRecipients(['send-tx', '--to', '0xdeadbeef', '--value', '0.001'], fm)
    expect(r.args).toEqual(['send-tx', '--to', '0xdeadbeef', '--value', '0.001'])
    expect(r.substitutions).toEqual([])
  })

  it('passes through ENS-shaped names without resolving (defers to upstream)', () => {
    const r = resolveRecipients(['send-tx', '--to', 'alice.eth'], fm)
    expect(r.args).toEqual(['send-tx', '--to', 'alice.eth'])
    expect(r.substitutions).toEqual([])
  })

  it('passes through unknown agent-ids untouched (waap-cli surfaces the error)', () => {
    const r = resolveRecipients(['send-tx', '--to', 'unknown-agent'], fm)
    expect(r.args).toEqual(['send-tx', '--to', 'unknown-agent'])
    expect(r.substitutions).toEqual([])
  })

  it('passes through agents with no recorded address', () => {
    const r = resolveRecipients(['send-tx', '--to', 'noaddr'], fm)
    expect(r.args).toEqual(['send-tx', '--to', 'noaddr'])
    expect(r.substitutions).toEqual([])
  })

  it('also resolves --from', () => {
    const r = resolveRecipients(['send-tx', '--from', 'alpha', '--to', 'bravo'], fm)
    expect(r.substitutions.map((s) => s.flag).sort()).toEqual(['--from', '--to'])
  })

  it('ignores --to-something-else (only exact --to / --to=)', () => {
    const r = resolveRecipients(['send-tx', '--token-id', 'alpha'], fm)
    expect(r.substitutions).toEqual([])
  })
})
