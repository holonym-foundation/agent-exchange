import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import {
  buildRegistrationFile,
  writeRegistrationFiles,
  EIP8004_TYPE,
  TODO_PLACEHOLDER
} from '../../src/scaffold/eip8004.js'
import type { Activity } from '../../src/registry/types.js'

const baseActivity: Activity = {
  slug: 'polymarket-agent',
  name: 'Polymarket Trading Agent',
  description: 'Fetch markets, sign EIP-712 orders, submit to CLOB',
  version: '0.1.0',
  author: 'holonym-foundation',
  verified: true,
  chain: { family: 'evm', id: 137, name: 'Polygon' },
  category: 'trading',
  protocols: ['polymarket'],
  tags: ['prediction-market'],
  runtimes: ['claude', 'standalone'],
  envVars: [],
  waapFeatures: ['sign-typed-data'],
  recipeUrl: 'https://docs.waap.xyz/recipes/polymarket',
  minCliVersion: '0.0.1',
  eip8004: {
    supportedTrust: ['tee-attestation', 'reputation'],
    x402Support: false,
    services: [
      {
        type: 'A2A',
        endpointTemplate: 'https://{{host}}/a2a',
        version: '0.1',
        skills: ['prediction-market-trading'],
        domains: ['polymarket.com']
      }
    ]
  }
}

describe('buildRegistrationFile', () => {
  it('uses the EIP-8004 registration-v1 type', () => {
    const reg = buildRegistrationFile(baseActivity, {
      projectName: 'my-poly',
      runtime: 'standalone',
      chainId: 137,
      walletAddress: '0xabc'
    })
    expect(reg.type).toBe(EIP8004_TYPE)
  })

  it('maps activity description into description field', () => {
    const reg = buildRegistrationFile(baseActivity, {
      projectName: 'my-poly',
      runtime: 'standalone',
      chainId: 137
    })
    expect(reg.description).toBe(baseActivity.description)
  })

  it('uses projectName as the agent name', () => {
    const reg = buildRegistrationFile(baseActivity, {
      projectName: 'my-poly',
      runtime: 'standalone',
      chainId: 137
    })
    expect(reg.name).toBe('my-poly')
  })

  it('renders services from activity.eip8004.services', () => {
    const reg = buildRegistrationFile(baseActivity, {
      projectName: 'my-poly',
      runtime: 'standalone',
      chainId: 137,
      walletAddress: '0xabc'
    })
    expect(reg.services).toHaveLength(1)
    expect(reg.services[0].name).toBe('A2A')
    expect(reg.services[0].endpoint).toBe('https://__TODO_HOST__/a2a')
    expect(reg.services[0].skills).toContain('prediction-market-trading')
  })

  it('inserts default service for the runtime when activity declares none', () => {
    const blank: Activity = {
      ...baseActivity,
      slug: 'blank-project',
      eip8004: {
        supportedTrust: ['tee-attestation'],
        x402Support: false,
        services: []
      }
    }
    const claudeReg = buildRegistrationFile(blank, {
      projectName: 'blank',
      runtime: 'claude',
      chainId: null
    })
    expect(claudeReg.services).toHaveLength(1)
    expect(claudeReg.services[0].name).toBe('MCP')

    const standaloneReg = buildRegistrationFile(blank, {
      projectName: 'blank',
      runtime: 'standalone',
      chainId: null
    })
    expect(standaloneReg.services[0].name).toBe('A2A')
  })

  it('uses tee-attestation as default supportedTrust when activity omits eip8004', () => {
    const noBlock: Activity = { ...baseActivity, eip8004: undefined }
    const reg = buildRegistrationFile(noBlock, {
      projectName: 'x',
      runtime: 'standalone',
      chainId: 137
    })
    expect(reg.supportedTrust).toEqual(['tee-attestation'])
  })

  it('sets agentId + agentRegistry placeholders for post-deploy fill-in', () => {
    const reg = buildRegistrationFile(baseActivity, {
      projectName: 'x',
      runtime: 'standalone',
      chainId: 137
    })
    expect(reg.registrations).toHaveLength(1)
    expect(reg.registrations[0].agentId).toBe(TODO_PLACEHOLDER)
    expect(reg.registrations[0].agentRegistry).toMatch(/^eip155:137:/)
    expect(reg.registrations[0].agentRegistry).toMatch(
      /__TODO_IDENTITY_REGISTRY_ADDRESS__$/
    )
  })

  it('uses __TODO_CHAIN_ID__ placeholder when chain is "any"', () => {
    const anyChain: Activity = {
      ...baseActivity,
      chain: { family: 'any', id: null, name: 'Any' }
    }
    const reg = buildRegistrationFile(anyChain, {
      projectName: 'x',
      runtime: 'standalone',
      chainId: null
    })
    expect(reg.registrations[0].agentRegistry).toMatch(
      /eip155:__TODO_CHAIN_ID__:/
    )
  })

  it('marks active: true by default', () => {
    const reg = buildRegistrationFile(baseActivity, {
      projectName: 'x',
      runtime: 'standalone',
      chainId: 137
    })
    expect(reg.active).toBe(true)
  })

  it('preserves x402Support from activity block', () => {
    const with402: Activity = {
      ...baseActivity,
      eip8004: {
        ...baseActivity.eip8004!,
        x402Support: true
      }
    }
    const reg = buildRegistrationFile(with402, {
      projectName: 'x',
      runtime: 'standalone',
      chainId: 137
    })
    expect(reg.x402Support).toBe(true)
  })
})

describe('writeRegistrationFiles', () => {
  let projectDir: string

  beforeEach(async () => {
    projectDir = await mkdtemp(resolve(tmpdir(), 'caw-eip-'))
  })

  afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true })
  })

  it('writes agent-registration.json at project root', async () => {
    await writeRegistrationFiles(projectDir, baseActivity, {
      projectName: 'my-poly',
      runtime: 'standalone',
      chainId: 137
    })
    const parsed = JSON.parse(
      await readFile(resolve(projectDir, 'agent-registration.json'), 'utf8')
    )
    expect(parsed.type).toBe(EIP8004_TYPE)
    expect(parsed.name).toBe('my-poly')
  })

  it('writes .well-known/agent-registration.json for standalone runtime', async () => {
    await writeRegistrationFiles(projectDir, baseActivity, {
      projectName: 'my-poly',
      runtime: 'standalone',
      chainId: 137
    })
    const parsed = JSON.parse(
      await readFile(
        resolve(projectDir, '.well-known/agent-registration.json'),
        'utf8'
      )
    )
    expect(parsed.type).toBe(EIP8004_TYPE)
  })

  it('skips .well-known/ for claude runtime (no hosted endpoint)', async () => {
    await writeRegistrationFiles(projectDir, baseActivity, {
      projectName: 'skill',
      runtime: 'claude',
      chainId: null
    })
    await expect(
      readFile(resolve(projectDir, '.well-known/agent-registration.json'))
    ).rejects.toThrow()
  })
})
