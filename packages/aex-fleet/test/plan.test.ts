import { describe, expect, it } from 'vitest'
import { describeOp, PlanSchema, type Plan } from '../src/core/plan.js'

describe('plan schema', () => {
  it('round-trips a valid plan', () => {
    const plan: Plan = {
      version: 1,
      createdAt: new Date().toISOString(),
      ops: [
        { op: 'policy.set', agentId: 'alpha', args: { dailyLimit: '50' } },
        { op: 'policy.set', agentId: 'beta', args: { dailyLimit: '50' } }
      ]
    }
    const json = JSON.stringify(plan)
    expect(PlanSchema.parse(JSON.parse(json))).toEqual(plan)
  })

  it('rejects unknown op kinds', () => {
    expect(() =>
      PlanSchema.parse({
        version: 1,
        createdAt: new Date().toISOString(),
        ops: [{ op: 'policy.unknown', agentId: 'x', args: {} }]
      })
    ).toThrow()
  })

  it('rejects wrong version', () => {
    expect(() =>
      PlanSchema.parse({
        version: 2,
        createdAt: new Date().toISOString(),
        ops: []
      })
    ).toThrow()
  })

  it('formats ops as one-liners', () => {
    expect(
      describeOp({ op: 'policy.set', agentId: 'alpha', args: { dailyLimit: '50' } })
    ).toBe('policy.set --daily-limit 50 → alpha')
  })
})
