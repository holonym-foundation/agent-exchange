import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { deployCommand } from '../src/commands/deploy.js'
import { FleetManager } from '../src/core/FleetManager.js'
import { sessionDir } from '../src/core/keychain.js'

const { deploy } = vi.hoisted(() => ({ deploy: vi.fn(async () => ({ provider: 'local', ref: 'fixture', deployedAt: '2026-01-01T00:00:00Z' })) }))
vi.mock('../src/core/providers/index.js', () => ({ getProvider: () => ({ preflight: async () => ({ ok: true }), deploy }) }))

describe('local deploy session selection', () => {
  let root: string
  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'aex-deploy-profile-'))
    vi.stubEnv('AEX_FLEET_HOME', root)
    vi.stubEnv('WAAP_CLI_SESSION_DIR', join(root, 'operator'))
    vi.spyOn(console, 'log').mockImplementation(() => {})
    await new FleetManager().addAgent({ agentId: 'alpha' })
  })
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    deploy.mockClear()
    rmSync(root, { recursive: true, force: true })
  })
  it.each([true, false])('selects the canonical profile with dryRun=%s and no HOME override', async (dryRun) => {
    await deployCommand().parseAsync(['alpha', '--source', '/fixture/project', '--target', 'local',
      '--env', 'WAAP_CLI_SESSION_DIR=/wrong/profile', ...(dryRun ? ['--dry-run'] : [])], { from: 'user' })
    const spec = (deploy.mock.calls[0] as unknown as [Record<string, unknown>])[0]
    expect(spec.env).toMatchObject({ WAAP_CLI_SESSION_DIR: sessionDir('alpha') })
    expect(spec.env).not.toHaveProperty('HOME')
  })
})
