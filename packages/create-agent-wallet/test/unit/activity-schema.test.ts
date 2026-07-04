import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { ActivitySchema } from '../../src/registry/types.js'

const baseValid = {
  slug: 'blank-project',
  name: 'Blank Project',
  description: 'Minimal WaaP agent scaffold',
  version: '0.1.0',
  author: 'holonym-foundation',
  verified: true,
  chain: { family: 'any', id: null, name: 'Any' },
  category: 'setup',
  protocols: [],
  tags: ['scaffold'],
  runtimes: ['claude', 'standalone'],
  envVars: [],
  waapFeatures: [],
  recipeUrl: null,
  minCliVersion: '0.0.1'
}

describe('ActivitySchema', () => {
  it('accepts a valid blank activity', () => {
    const result = ActivitySchema.safeParse(baseValid)
    expect(result.success).toBe(true)
  })

  it('rejects activity without slug', () => {
    const { slug: _omitted, ...invalid } = baseValid
    const result = ActivitySchema.safeParse(invalid)
    expect(result.success).toBe(false)
  })

  it('rejects non-kebab slug', () => {
    const result = ActivitySchema.safeParse({
      ...baseValid,
      slug: 'BlankProject'
    })
    expect(result.success).toBe(false)
  })

  it('accepts all 4 supported runtimes', () => {
    const result = ActivitySchema.safeParse({
      ...baseValid,
      runtimes: ['claude', 'standalone', 'openclaw', 'nous']
    })
    expect(result.success).toBe(true)
  })

  it('rejects unknown runtime', () => {
    const result = ActivitySchema.safeParse({
      ...baseValid,
      runtimes: ['langchain']
    })
    expect(result.success).toBe(false)
  })

  it('rejects empty runtimes array', () => {
    const result = ActivitySchema.safeParse({ ...baseValid, runtimes: [] })
    expect(result.success).toBe(false)
  })

  it('requires envVar keys to be UPPER_SNAKE_CASE', () => {
    const result = ActivitySchema.safeParse({
      ...baseValid,
      envVars: [{ key: 'lowercase_bad', required: true, description: 'x' }]
    })
    expect(result.success).toBe(false)
  })

  it('requires semver version', () => {
    const result = ActivitySchema.safeParse({ ...baseValid, version: '0.1' })
    expect(result.success).toBe(false)
  })

  it('validates the shipped Blank Project activity.json', async () => {
    const path = resolve(
      __dirname,
      '../../../../agents/blank-project/activity.json'
    )
    const raw = JSON.parse(await readFile(path, 'utf8'))
    const result = ActivitySchema.safeParse(raw)
    expect(result.success).toBe(true)
  })
})
