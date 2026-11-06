import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { ActivitySchema, RegistrySchema } from '../../src/registry/types.js'
import { buildRegistry } from '../../registry/build/build-registry.js'

// Contract for registry.json and activity.json validation across schema-library upgrades.
const SHIPPED = resolve(__dirname, '../../registry/activities/cetus-yield-agent/activity.json')

const minimal = {
  slug: 'blank-project',
  name: 'Blank Project',
  description: 'Minimal WaaP agent scaffold',
  version: '0.1.0',
  author: 'holonym-foundation',
  verified: true,
  chain: { family: 'any', id: null, name: 'Any' },
  category: 'setup',
  protocols: [],
  tags: [],
  runtimes: ['standalone'],
  envVars: [],
  waapFeatures: [],
  recipeUrl: null,
  minCliVersion: '0.0.1'
}

const ACTIVITY_KEYS = Object.keys(minimal)
const registryWith = (generatedAt: string) => ({ version: '0.1.0', generatedAt, activities: [minimal] })

describe('registry schema contract', () => {
  it('keeps the shipped activity byte-identical in registry output', async () => {
    const raw = JSON.parse(await readFile(SHIPPED, 'utf8'))
    expect(JSON.stringify(ActivitySchema.parse(raw))).toBe(JSON.stringify(raw))
  })

  it('applies EIP-8004 defaults only when the block is present', () => {
    const plain = ActivitySchema.parse(minimal)
    expect('eip8004' in plain).toBe(false)
    expect('behavior' in plain).toBe(false)
    expect(ActivitySchema.parse({ ...minimal, eip8004: {} }).eip8004).toStrictEqual({
      supportedTrust: ['tee-attestation'],
      x402Support: false,
      services: []
    })
    const service = { type: 'A2A', endpointTemplate: 'https://{{host}}/a2a' }
    expect(ActivitySchema.parse({ ...minimal, eip8004: { services: [service] } }).eip8004?.services).toStrictEqual([
      { ...service, skills: [], domains: [] }
    ])
  })

  it('returns fresh default arrays on every parse', () => {
    const first = ActivitySchema.parse({ ...minimal, eip8004: {} })
    first.eip8004?.supportedTrust.push('reputation')
    first.eip8004?.services.push({ type: 'web', endpointTemplate: 'x', skills: [], domains: [] })
    expect(ActivitySchema.parse({ ...minimal, eip8004: {} }).eip8004).toStrictEqual({
      supportedTrust: ['tee-attestation'],
      x402Support: false,
      services: []
    })
  })

  it('emits entries in schema key order without contributor-only fields', () => {
    const shuffled = Object.fromEntries([['notes', 'not published'], ...Object.entries(minimal).reverse()])
    expect(Object.keys(ActivitySchema.parse(shuffled))).toEqual(ACTIVITY_KEYS)
  })

  it.each(['2026-01-01T00:00:00Z', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.123456Z', '2026-01-01T00:00Z'])(
    'accepts registry timestamp %s',
    (generatedAt) => {
      expect(RegistrySchema.safeParse(registryWith(generatedAt)).success).toBe(true)
    }
  )

  it.each(['2026-01-01T00:00:00+02:00', '2026-01-01', '2026-13-01T00:00:00Z', '2026-02-30T00:00:00Z', 'not-a-date'])(
    'rejects registry timestamp %s',
    (generatedAt) => {
      const result = RegistrySchema.safeParse(registryWith(generatedAt))
      expect(result.success).toBe(false)
      expect(result.error?.issues.map((issue) => issue.path)).toEqual([['generatedAt']])
    }
  )

  it.each([
    ['recipeUrl', 'https://docs.example.com/recipes/blank-project', true],
    ['recipeUrl', null, true],
    ['recipeUrl', 'docs.example.com/recipes/blank-project', false],
    ['recipeUrl', '', false],
    ['chain', { family: 'evm', id: 8453, name: 'Base' }, true],
    ['chain', { family: 'evm', id: 0, name: 'Zero' }, false],
    ['chain', { family: 'evm', id: 1.5, name: 'Fractional' }, false],
    ['chain', { family: 'evm', id: '8453', name: 'String' }, false]
  ])('validates %s %j as %s', (field, value, ok) => {
    expect(ActivitySchema.safeParse({ ...minimal, [field]: value }).success).toBe(ok)
  })
})

describe('registry build output', () => {
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(resolve(tmpdir(), 'caw-contract-'))
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  async function writeActivity(dir: string, activity: unknown) {
    await mkdir(resolve(root, 'activities', dir), { recursive: true })
    await writeFile(resolve(root, 'activities', dir, 'activity.json'), JSON.stringify(activity))
  }

  it('re-validates the bundled registry at runtime without changing it', async () => {
    await writeActivity('cetus-yield-agent', JSON.parse(await readFile(SHIPPED, 'utf8')))
    await writeActivity('blank-project', minimal)
    const out = resolve(root, 'dist/registry.json')
    await buildRegistry({ root, out })
    const text = await readFile(out, 'utf8')
    const parsed = RegistrySchema.parse(JSON.parse(text))
    expect(JSON.stringify(parsed, null, 2) + '\n').toBe(text)
  })

  it('reports contributor errors with field paths and custom messages', async () => {
    await writeActivity('blank-project', {
      ...minimal,
      slug: 'Blank_Project',
      version: '0.1',
      envVars: [{ key: 'lower_case', required: true, description: 'x' }]
    })
    const error = await buildRegistry({ root, out: resolve(root, 'out.json') }).catch((err: Error) => err)
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toContain('blank-project: schema validation failed')
    expect((error as Error).message).toContain('slug: slug must be kebab-case')
    expect((error as Error).message).toContain('version: version must be semver')
    expect((error as Error).message).toContain('envVars.0.key: env keys must be UPPER_SNAKE_CASE')
  })
})
