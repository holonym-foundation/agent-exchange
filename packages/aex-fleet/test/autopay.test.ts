import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mock the waap-runner so enableAutopay's `policy set` / `2fa disable` don't shell out.
vi.mock('../src/core/waap-runner.js', () => ({
  runWaap: vi.fn(async () => ({ exitCode: 0, stdout: 'ok', stderr: '' }))
}))
import { runWaap } from '../src/core/waap-runner.js'
import {
  enableAutopay,
  estimateRenewalCostUsd,
  renewIfDue,
  type RenewalDeps
} from '../src/core/autopay.js'
import { FleetManager } from '../src/core/FleetManager.js'
import type { AgentEntry } from '../src/types.js'

const mockRunWaap = vi.mocked(runWaap)

describe('autopay', () => {
  let dir: string
  let configPath: string
  let fm: FleetManager

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'aex-autopay-'))
    configPath = join(dir, 'fleet.json')
    fm = new FleetManager(configPath)
    mockRunWaap.mockClear()
    mockRunWaap.mockResolvedValue({ exitCode: 0, stdout: 'ok', stderr: '' })
    await fm.addAgent({ agentId: 'alpha', address: '0xabc', tags: [] })
  })

  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  describe('enableAutopay', () => {
    it('pushes the daily cap and disables 2FA for no-2fa mode, records consented policy', async () => {
      const r = await enableAutopay('alpha', { dailyLimitUsd: 10, mode: 'no-2fa' }, fm)
      expect(r.ok).toBe(true)
      const calls = mockRunWaap.mock.calls.map((c) => c[0].args)
      expect(calls).toContainEqual(['policy', 'set', '--daily-spend-limit', '10'])
      expect(calls).toContainEqual(['2fa', 'disable'])

      const ap = fm.getAgent('alpha')!.autopay!
      expect(ap.enabled).toBe(true)
      expect(ap.dailyLimitUsd).toBe(10)
      expect(ap.mode).toBe('no-2fa')
      expect(ap.spentTodayUsd).toBe(0)
    })

    it('permission-token mode keeps 2FA on (no disable call) and requires a token', async () => {
      const missing = await enableAutopay('alpha', { dailyLimitUsd: 10, mode: 'permission-token' }, fm)
      expect(missing.ok).toBe(false)
      expect(missing.detail).toMatch(/permission-token requires/)

      const ok = await enableAutopay(
        'alpha',
        { dailyLimitUsd: 10, mode: 'permission-token', permissionToken: 'priv-abc' },
        fm
      )
      expect(ok.ok).toBe(true)
      const calls = mockRunWaap.mock.calls.map((c) => c[0].args)
      expect(calls).not.toContainEqual(['2fa', 'disable'])
      expect(fm.getAgent('alpha')!.autopay!.permissionToken).toBe('priv-abc')
    })

    it('fails (without recording) when the policy push fails', async () => {
      mockRunWaap.mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: 'policy error' })
      const r = await enableAutopay('alpha', { dailyLimitUsd: 10, mode: 'no-2fa' }, fm)
      expect(r.ok).toBe(false)
      expect(r.detail).toMatch(/policy set failed/)
      expect(fm.getAgent('alpha')!.autopay).toBeUndefined()
    })

    it('rejects a non-positive daily limit', async () => {
      const r = await enableAutopay('alpha', { dailyLimitUsd: 0, mode: 'no-2fa' }, fm)
      expect(r.ok).toBe(false)
      expect(mockRunWaap).not.toHaveBeenCalled()
    })
  })

  describe('renewIfDue', () => {
    const fixedNow = new Date('2026-06-22T12:00:00Z')
    const now = () => fixedNow

    function agentWithLease(over: Partial<AgentEntry> = {}): AgentEntry {
      return {
        agentId: 'alpha',
        address: '0xabc',
        tags: [],
        createdAt: '2026-06-01T00:00:00Z',
        deployment: {
          provider: 'arkhai',
          ref: '0xold',
          escrowUid: '0xold',
          status: 'running',
          deployedAt: '2026-06-22T11:00:00Z',
          leaseHours: 1,
          leaseExpiresAt: '2026-06-22T12:10:00Z', // 10 min out → inside 30-min window
          priceUsdMonth: 3.5
        },
        autopay: {
          enabled: true,
          dailyLimitUsd: 10,
          renewBeforeMinutes: 30,
          spentTodayUsd: 0,
          mode: 'no-2fa',
          configuredAt: '2026-06-22T10:00:00Z'
        },
        ...over
      }
    }

    function deps(renew: RenewalDeps['renew'], notify?: RenewalDeps['notify']): RenewalDeps {
      return { fm, renew, ...(notify ? { notify } : {}), now }
    }

    it('skips when autopay disabled', async () => {
      const a = agentWithLease({ autopay: { ...agentWithLease().autopay!, enabled: false } })
      const out = await renewIfDue(a, deps(async () => ({})))
      expect(out.status).toBe('skipped')
    })

    it('not-due when the lease is outside the renew window', async () => {
      const a = agentWithLease()
      a.deployment!.leaseExpiresAt = '2026-06-22T13:00:00Z' // 60 min out > 30-min window
      const out = await renewIfDue(a, deps(async () => ({})))
      expect(out.status).toBe('not-due')
    })

    it('renews within the cap and rolls expiry + spend forward', async () => {
      await fm.addAgent({ agentId: 'alpha', address: '0xabc', tags: [] }).catch(() => {})
      const a = agentWithLease()
      // persist the agent so updateAgent inside renewIfDue can patch it
      await fm.updateAgent('alpha', { deployment: a.deployment, autopay: a.autopay })
      const renew = vi.fn(async () => ({ escrowUid: '0xnew', chargedUsd: 0.005, leaseHours: 1 }))
      const out = await renewIfDue(a, deps(renew))
      expect(out.status).toBe('renewed')
      expect(renew).toHaveBeenCalledOnce()

      const updated = fm.getAgent('alpha')!
      expect(updated.deployment!.escrowUid).toBe('0xnew')
      expect(updated.deployment!.leaseExpiresAt).toBe('2026-06-22T13:00:00.000Z') // now + 1h
      expect(updated.autopay!.spentTodayUsd).toBeCloseTo(0.005)
      expect(updated.autopay!.spentDate).toBe('2026-06-22')
    })

    it('pauses + notifies when the per-tx estimate exceeds the per-tx cap', async () => {
      const a = agentWithLease()
      a.deployment!.priceUsdMonth = 30_000 // ~$0.69 for a 1h term... bump term to blow the cap
      a.deployment!.leaseHours = 720 // a month → ~$30k
      a.autopay!.perTxLimitUsd = 1
      await fm.updateAgent('alpha', { deployment: a.deployment, autopay: a.autopay })
      const notify = vi.fn()
      const renew = vi.fn(async () => ({}))
      const out = await renewIfDue(a, deps(renew, notify))
      expect(out.status).toBe('paused')
      expect(renew).not.toHaveBeenCalled() // paused BEFORE charging
      expect(notify).toHaveBeenCalledOnce()
      expect(fm.getAgent('alpha')!.autopay!.pausedReason).toMatch(/per-tx cap/)
    })

    it('pauses + notifies when a renewal throws (never silent drop)', async () => {
      const a = agentWithLease()
      await fm.updateAgent('alpha', { deployment: a.deployment, autopay: a.autopay })
      const notify = vi.fn()
      const renew = vi.fn(async () => {
        throw new Error('insufficient funds')
      })
      const out = await renewIfDue(a, deps(renew, notify))
      expect(out.status).toBe('paused')
      if (out.status === 'paused') expect(out.reason).toMatch(/insufficient funds/)
      expect(notify).toHaveBeenCalledOnce()
      expect(fm.getAgent('alpha')!.autopay!.pausedReason).toMatch(/insufficient funds/)
    })

    it('skips an already-paused agent', async () => {
      const a = agentWithLease()
      a.autopay!.pausedReason = 'cap hit yesterday'
      const out = await renewIfDue(a, deps(async () => ({})))
      expect(out.status).toBe('skipped')
    })
  })

  describe('estimateRenewalCostUsd', () => {
    it('pro-rates monthly price to the lease term', () => {
      const cost = estimateRenewalCostUsd({
        agentId: 'x',
        tags: [],
        createdAt: '',
        deployment: {
          provider: 'arkhai',
          ref: 'r',
          status: 'running',
          deployedAt: '',
          leaseHours: 720, // 1 month
          priceUsdMonth: 3.5
        }
      } as AgentEntry)
      expect(cost).toBeCloseTo(3.5, 1)
    })

    it('returns undefined without a price signal', () => {
      const cost = estimateRenewalCostUsd({
        agentId: 'x',
        tags: [],
        createdAt: '',
        deployment: { provider: 'arkhai', ref: 'r', status: 'running', deployedAt: '', leaseHours: 1 }
      } as AgentEntry)
      expect(cost).toBeUndefined()
    })
  })
})
