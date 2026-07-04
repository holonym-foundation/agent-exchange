import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  closeNeonPool,
  fetchFleetStatus,
  getNeonPool,
  resetNeonClientForTests
} from '../src/core/neon-client.js'

describe('neon-client (no DSN)', () => {
  beforeEach(() => {
    delete process.env.AEX_FLEET_NEON_DSN_RO
    delete process.env.DATABASE_URL
    resetNeonClientForTests()
  })

  afterEach(async () => {
    await closeNeonPool()
    resetNeonClientForTests()
  })

  it('returns null pool when no DSN is configured', () => {
    expect(getNeonPool()).toBeNull()
  })

  it('returns zero-filled rows when telemetry is disabled', async () => {
    const rows = await fetchFleetStatus(['a', 'b'])
    expect(rows).toEqual([
      { agentId: 'a', lastBalance: null, lastBalanceTs: null, lastEventTs: null, errorsLast24h: 0 },
      { agentId: 'b', lastBalance: null, lastBalanceTs: null, lastEventTs: null, errorsLast24h: 0 }
    ])
  })

  it('returns empty array for empty input', async () => {
    const rows = await fetchFleetStatus([])
    expect(rows).toEqual([])
  })
})
