import { describe, expect, it } from 'vitest'
import { assertMinCliVersion } from '../../src/main.js'
import { CawError, ExitCodes } from '../../src/util/errors.js'
import type { Activity } from '../../src/registry/types.js'

const activity = {
  slug: 'sui-cetus-yield-optimizer',
  name: 'Cetus Yield Optimizer',
  description: 'Test activity',
  version: '1.0.0',
  author: 'test',
  verified: false,
  chain: { family: 'sui', id: 1, name: 'Sui Mainnet' },
  category: 'yield',
  protocols: ['cetus'],
  tags: [],
  runtimes: ['standalone'],
  envVars: [],
  waapFeatures: [],
  recipeUrl: null,
  minCliVersion: '0.1.0',
} satisfies Activity

describe('minimum CLI version', () => {
  it.each(['0.1.0', '0.1.1', '1.0.0'])('accepts compatible version %s', (version) => {
    expect(() => assertMinCliVersion(activity, version)).not.toThrow()
  })

  it('rejects an older CLI with an actionable error', () => {
    try {
      assertMinCliVersion(activity, '0.0.1')
      throw new Error('expected version check to throw')
    } catch (error) {
      expect(error).toBeInstanceOf(CawError)
      expect((error as CawError).code).toBe(ExitCodes.INVALID_ARGS)
      expect((error as Error).message).toContain('requires create-agent-wallet 0.1.0 or newer')
    }
  })
})
