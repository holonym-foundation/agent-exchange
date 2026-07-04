import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FleetManager } from '../src/core/FleetManager.js'

describe('FleetManager.selectAgents', () => {
  let configPath: string
  let dir: string
  let fm: FleetManager

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'aex-fleet-sel-'))
    configPath = join(dir, 'fleet.json')
    fm = new FleetManager(configPath)
    await fm.addAgent({ agentId: 'a', chain: 'ethereum', tags: ['yield', 'prod'] })
    await fm.addAgent({ agentId: 'b', chain: 'ethereum', tags: ['yield', 'test'] })
    await fm.addAgent({ agentId: 'c', chain: 'sui', tags: ['govern'] })
    await fm.setActive('b')
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('--agent <id> picks exactly one (and ignores --all / --tag)', () => {
    expect(fm.selectAgents({ agent: 'c', all: true, tag: 'yield' }).map((a) => a.agentId)).toEqual(['c'])
  })

  it('--agent <id> returns empty for unknown', () => {
    expect(fm.selectAgents({ agent: 'nope' })).toEqual([])
  })

  it('--tag filters by membership', () => {
    expect(fm.selectAgents({ tag: 'yield' }).map((a) => a.agentId).sort()).toEqual(['a', 'b'])
    expect(fm.selectAgents({ tag: 'govern' }).map((a) => a.agentId)).toEqual(['c'])
  })

  it('--all returns everything', () => {
    expect(fm.selectAgents({ all: true }).map((a) => a.agentId).sort()).toEqual(['a', 'b', 'c'])
  })

  it('no selector falls back to active', () => {
    expect(fm.selectAgents({}).map((a) => a.agentId)).toEqual(['b'])
  })
})

describe('FleetManager.applyToEach', () => {
  let configPath: string
  let dir: string
  let fm: FleetManager

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'aex-fleet-bulk-'))
    configPath = join(dir, 'fleet.json')
    fm = new FleetManager(configPath)
    await fm.addAgent({ agentId: 'one' })
    await fm.addAgent({ agentId: 'two' })
    await fm.addAgent({ agentId: 'three' })
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('runs fn against every agent in order and emits events', async () => {
    const events: string[] = []
    fm.on('agent:start', (e) => events.push(`start:${e.agentId}:${e.index}/${e.total}`))
    fm.on('agent:done', (e) => events.push(`done:${e.agentId}`))
    fm.on('agent:error', (e) => events.push(`error:${e.agentId}`))
    fm.on('bulk:done', (e) => events.push(`bulk:${e.failed}/${e.total}`))

    const agents = fm.selectAgents({ all: true })
    const results = await fm.applyToEach(agents, async (agent) => ({
      ok: agent.agentId !== 'two',
      message: agent.agentId === 'two' ? 'simulated failure' : undefined
    }))

    expect(results.map((r) => `${r.agentId}:${r.ok}`)).toEqual([
      'one:true',
      'two:false',
      'three:true'
    ])
    expect(events).toEqual([
      'start:one:0/3',
      'done:one',
      'start:two:1/3',
      'error:two',
      'start:three:2/3',
      'done:three',
      'bulk:1/3'
    ])
  })

  it('treats thrown errors as failed results (continue-and-report)', async () => {
    const agents = fm.selectAgents({ all: true })
    const results = await fm.applyToEach(agents, async (agent) => {
      if (agent.agentId === 'two') throw new Error('boom')
      return { ok: true }
    })
    expect(results.find((r) => r.agentId === 'two')).toMatchObject({
      ok: false,
      message: 'boom'
    })
    expect(results.filter((r) => r.ok)).toHaveLength(2)
  })

  it('returns empty results for empty input without emitting per-agent events', async () => {
    const events: string[] = []
    fm.on('agent:start', () => events.push('start'))
    fm.on('bulk:done', () => events.push('bulk'))
    const results = await fm.applyToEach([], async () => ({ ok: true }))
    expect(results).toEqual([])
    expect(events).toEqual(['bulk'])
  })
})
