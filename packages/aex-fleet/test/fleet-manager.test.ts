import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FleetManager } from '../src/core/FleetManager.js'

describe('FleetManager', () => {
  let dir: string
  let configPath: string
  let fm: FleetManager

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'aex-fleet-'))
    configPath = join(dir, 'fleet.json')
    fm = new FleetManager(configPath)
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('starts empty', () => {
    expect(fm.listAgents()).toEqual([])
    expect(fm.getActive()).toBeUndefined()
  })

  it('adds an agent and marks it active by default', async () => {
    const entry = await fm.addAgent({ agentId: 'one', chain: 'ethereum' })
    expect(entry.agentId).toBe('one')
    expect(entry.tags).toEqual([])
    expect(entry.createdAt).toBeDefined()
    expect(fm.listAgents()).toHaveLength(1)
    expect(fm.getActive()).toBe('one')
  })

  it('keeps the first agent active when adding a second', async () => {
    await fm.addAgent({ agentId: 'one' })
    await fm.addAgent({ agentId: 'two' })
    expect(fm.getActive()).toBe('one')
    await fm.setActive('two')
    expect(fm.getActive()).toBe('two')
  })

  it('rejects duplicate agents', async () => {
    await fm.addAgent({ agentId: 'one' })
    await expect(fm.addAgent({ agentId: 'one' })).rejects.toThrow(/already exists/)
  })

  it('rejects setActive on unknown agent', async () => {
    await expect(fm.setActive('nope')).rejects.toThrow(/Unknown agent/)
  })

  it('removes an agent and reassigns active', async () => {
    await fm.addAgent({ agentId: 'one' })
    await fm.addAgent({ agentId: 'two' })
    await fm.removeAgent('one')
    expect(fm.listAgents()).toHaveLength(1)
    expect(fm.getActive()).toBe('two')
  })

  it('removing the only agent leaves active undefined', async () => {
    await fm.addAgent({ agentId: 'solo' })
    await fm.removeAgent('solo')
    expect(fm.getActive()).toBeUndefined()
    expect(fm.listAgents()).toEqual([])
  })

  it('persists across instances reading the same file', async () => {
    await fm.addAgent({ agentId: 'persistent', chain: 'sepolia', tags: ['test'] })
    const second = new FleetManager(configPath)
    expect(second.listAgents()).toHaveLength(1)
    expect(second.getAgent('persistent')?.tags).toEqual(['test'])
    expect(second.getActive()).toBe('persistent')
  })
})
