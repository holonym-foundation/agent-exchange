import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readConfig, withLockedConfig } from '../src/core/config.js'
import { FleetConfigSchema, type FleetConfig } from '../src/types.js'

// Compatibility contract for fleet.json across schema-library upgrades. Synthetic values only.
const ts = '2026-01-01T00:00:00.000Z'

// Every optional block populated, keys in schema order — the shape aex-fleet 0.0.3 persists.
const populated = {
  version: 1,
  activeAgent: 'alpha',
  agents: {
    alpha: {
      agentId: 'alpha',
      templateId: 'fixture-template',
      chain: 'base',
      address: '0x1111111111111111111111111111111111111111',
      waapEmail: 'alpha@example.com',
      tags: ['fixture'],
      sessionRef: 'session-alpha',
      linkedTo: 'beta',
      createdAt: ts,
      lastBalanceCache: { value: '1.5', ts },
      erc8004: { status: 'pending', intentChain: 'base', intentRecordedAt: ts },
      deployment: {
        provider: 'local',
        ref: '4242',
        status: 'running',
        deployedAt: ts,
        leaseHours: 24,
        leaseExpiresAt: '2026-01-02T00:00:00.000Z',
        priceUsdMonth: 12.5
      },
      autopay: {
        enabled: true,
        dailyLimitUsd: 5,
        perTxLimitUsd: 2,
        mode: 'no-2fa',
        renewBeforeMinutes: 45,
        spentTodayUsd: 1.25,
        spentDate: '2026-01-01',
        configuredAt: ts
      }
    },
    beta: { agentId: 'beta', tags: [], createdAt: ts }
  },
  telemetry: {}
}

// Older or hand-written entries that omit every defaulted field.
const minimal = {
  version: 1,
  agents: {
    alpha: {
      agentId: 'alpha',
      createdAt: ts,
      deployment: { provider: 'local', ref: '4242', deployedAt: ts },
      autopay: { dailyLimitUsd: 5, mode: 'no-2fa', configuredAt: ts }
    }
  }
}

describe('fleet.json schema compatibility', () => {
  let dir: string
  let configPath: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'aex-fleet-schema-'))
    configPath = join(dir, 'fleet.json')
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('rewrites an existing fleet.json byte-for-byte on a no-op locked update', async () => {
    const original = JSON.stringify(populated, null, 2)
    writeFileSync(configPath, original)
    await withLockedConfig((cfg) => cfg, configPath)
    expect(readFileSync(configPath, 'utf8')).toBe(original)
  })

  it('fills documented defaults and leaves omitted optional fields absent', () => {
    writeFileSync(configPath, JSON.stringify(minimal))
    expect(readConfig(configPath)).toStrictEqual({
      version: 1,
      agents: {
        alpha: {
          agentId: 'alpha',
          tags: [],
          createdAt: ts,
          deployment: { provider: 'local', ref: '4242', status: 'unknown', deployedAt: ts },
          autopay: {
            enabled: false,
            dailyLimitUsd: 5,
            mode: 'no-2fa',
            renewBeforeMinutes: 30,
            spentTodayUsd: 0,
            configuredAt: ts
          }
        }
      }
    })
    expect(FleetConfigSchema.parse({ version: 1 })).toStrictEqual({ version: 1, agents: {} })
  })

  it('returns fresh default containers on every parse', () => {
    const first = FleetConfigSchema.parse({ version: 1 })
    first.agents.alpha = FleetConfigSchema.parse(minimal).agents.alpha
    first.agents.alpha.tags.push('mutated')
    expect(FleetConfigSchema.parse({ version: 1 }).agents).toStrictEqual({})
    expect(FleetConfigSchema.parse(minimal).agents.alpha.tags).toStrictEqual([])
  })

  it('drops unknown fields instead of persisting them', () => {
    const parsed = FleetConfigSchema.parse({
      ...minimal,
      futureField: true,
      agents: { alpha: { ...minimal.agents.alpha, futureAgentField: 'x' } }
    })
    expect('futureField' in parsed).toBe(false)
    expect('futureAgentField' in parsed.agents.alpha).toBe(false)
  })

  it.each([
    ['unsupported version', { ...minimal, version: 2 }, ['version']],
    [
      'unknown deploy provider',
      { ...minimal, agents: { alpha: { ...minimal.agents.alpha, deployment: { ...minimal.agents.alpha.deployment, provider: 'other' } } } },
      ['agents', 'alpha', 'deployment', 'provider']
    ],
    [
      'unknown autopay mode',
      { ...minimal, agents: { alpha: { ...minimal.agents.alpha, autopay: { ...minimal.agents.alpha.autopay, mode: 'auto' } } } },
      ['agents', 'alpha', 'autopay', 'mode']
    ],
    [
      'string spend cap',
      { ...minimal, agents: { alpha: { ...minimal.agents.alpha, autopay: { ...minimal.agents.alpha.autopay, dailyLimitUsd: '5' } } } },
      ['agents', 'alpha', 'autopay', 'dailyLimitUsd']
    ],
    [
      'missing createdAt',
      { ...minimal, agents: { alpha: { agentId: 'alpha' } } },
      ['agents', 'alpha', 'createdAt']
    ]
  ])('rejects %s at the same field path', (_name, input, path) => {
    const result = FleetConfigSchema.safeParse(input)
    expect(result.success).toBe(false)
    expect(result.error?.issues.map((issue) => issue.path)).toEqual([path])
  })

  it('refuses to persist a non-finite number that JSON would write as null', async () => {
    const original = JSON.stringify(populated, null, 2)
    writeFileSync(configPath, original)
    await expect(
      withLockedConfig((cfg): FleetConfig => {
        const alpha = cfg.agents.alpha
        return {
          ...cfg,
          agents: { ...cfg.agents, alpha: { ...alpha, autopay: { ...alpha.autopay!, renewBeforeMinutes: Infinity } } }
        }
      }, configPath)
    ).rejects.toThrow()
    expect(readFileSync(configPath, 'utf8')).toBe(original)
    expect(readConfig(configPath).agents.alpha.autopay?.renewBeforeMinutes).toBe(45)
  })
})
