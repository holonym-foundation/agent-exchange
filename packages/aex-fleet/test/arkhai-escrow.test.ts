import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock execa so we can drive the deploy/ship/reclaim flow without real
// processes. Kept in its own file so the pure-function tests (providers.test.ts)
// stay un-mocked.
vi.mock('execa', () => ({ execa: vi.fn() }))
import { execa } from 'execa'
import { ArkhaiProvider } from '../src/core/providers/arkhai.js'

const mockExeca = vi.mocked(execa)

const LEASE_JSON = JSON.stringify({
  escrow_uid: '0xabc',
  vm_host_ip: '203.0.113.7',
  ssh_port: 2222,
  ssh_user: 'tenant7'
})
// Minimal spec — the escrow path only reads source/env/dryRun.
const spec = { agentId: 'a1', agent: {}, source: '/tmp/agent', env: {}, dryRun: false } as never

function reclaimCalls() {
  return mockExeca.mock.calls.filter(
    (c) => Array.isArray(c[1]) && c[1][0] === 'escrow' && c[1][1] === 'reclaim'
  )
}

describe('ArkhaiProvider deploy — escrow safety on failed provisioning', () => {
  beforeEach(() => mockExeca.mockReset())

  it('reclaims the escrow when shipping fails after the lease locks (refund)', async () => {
    mockExeca.mockImplementation((async (bin: string, args: string[] = []) => {
      if (args[0] === 'buy') return { stdout: LEASE_JSON }
      if (bin === 'rsync') throw new Error('rsync: connection refused') // provisioning fails
      if (args[0] === 'escrow' && args[1] === 'reclaim') return { exitCode: 0, stdout: 'reclaimed' }
      return { stdout: '', exitCode: 0 }
    }) as never)

    const p = new ArkhaiProvider()
    await expect(p.deploy(spec)).rejects.toThrow(/reclaimed escrow to refund the buyer/)
    const rc = reclaimCalls()
    expect(rc).toHaveLength(1)
    expect(rc[0][1]).toEqual(['escrow', 'reclaim', '0xabc'])
  })

  it('flags manual reclaim when the reclaim itself fails (never masks the cause)', async () => {
    mockExeca.mockImplementation((async (bin: string, args: string[] = []) => {
      if (args[0] === 'buy') return { stdout: LEASE_JSON }
      if (bin === 'rsync') throw new Error('rsync fail')
      if (args[0] === 'escrow' && args[1] === 'reclaim') return { exitCode: 1, stdout: 'error' }
      return { stdout: '', exitCode: 0 }
    }) as never)

    const p = new ArkhaiProvider()
    await expect(p.deploy(spec)).rejects.toThrow(/manual reclaim needed/)
    await expect(p.deploy(spec)).rejects.toThrow(/cause: rsync fail/)
  })

  it('does not reclaim on a successful deploy', async () => {
    mockExeca.mockImplementation((async (_bin: string, args: string[] = []) => {
      if (args[0] === 'buy') return { stdout: LEASE_JSON }
      return { stdout: '', exitCode: 0 } // rsync + ssh succeed
    }) as never)

    const p = new ArkhaiProvider()
    const res = await p.deploy(spec)
    expect(res.escrowUid).toBe('0xabc')
    expect(reclaimCalls()).toHaveLength(0)
  })

  it('stop() reclaims the escrow', async () => {
    mockExeca.mockResolvedValue({ exitCode: 0, stdout: 'reclaimed' } as never)
    await new ArkhaiProvider().stop('0xdead')
    const rc = reclaimCalls()
    expect(rc).toHaveLength(1)
    expect(rc[0][1]).toEqual(['escrow', 'reclaim', '0xdead'])
  })
})
