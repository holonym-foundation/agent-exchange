import type { AgentEntry, AutopayState } from '../types.js'
import { FleetManager } from './FleetManager.js'
import { runWaap } from './waap-runner.js'

/**
 * WS-D / #1256 — buyer autopay (Model 2) core.
 *
 * The agent's own WaaP wallet auto-buys and auto-renews its compute lease without a human
 * approving each transaction, bounded by a spend policy the user consented to at deploy.
 *
 * Two responsibilities live here:
 *   1. Arming the bounded buyer session (`enableAutopay`): push the daily spend cap to the wallet
 *      via `waap-cli policy set --daily-spend-limit` and configure how it signs non-interactively.
 *   2. The renewal engine (`renewIfDue`): when a lease nears expiry, re-buy the next term within the
 *      cap; pause + flag the agent (never silently drop) when the cap is hit or a renewal fails.
 *
 * waap-cli signing capability (verified against v1.0.2):
 *   - `policy set --daily-spend-limit <usd>` enforces a daily USD cap server-side.
 *   - a single tx skips the per-tx 2FA prompt with `--privilege <encoded>` (a pre-minted
 *     permission-token, supplied out of band) OR by disabling 2FA for the wallet.
 *   - there is NO `privilege`/`permission-token` *mint* subcommand yet, so the available in-CLI
 *     non-interactive path is `mode: 'no-2fa'` (disable 2FA + rely on the daily cap). `mode:
 *     'permission-token'` is wired for the day waap-cli ships a token-mint primitive.
 */

export interface EnableAutopayInput {
  dailyLimitUsd: number
  perTxLimitUsd?: number
  mode: AutopayState['mode']
  permissionToken?: string
  renewBeforeMinutes?: number
  bin?: string
}

/** Result of arming a single agent's bounded buyer session. */
export interface EnableAutopayResult {
  ok: boolean
  /** Operator-facing detail (policy push result, or why it failed). */
  detail: string
}

/**
 * Arm autopay for one agent: push the daily spend cap and (for `no-2fa` mode) disable the per-tx
 * 2FA prompt so the bounded session can sign lease purchases unattended. Records the consented
 * policy on the fleet entry. Idempotent — re-enabling overwrites the policy and clears any pause.
 */
export async function enableAutopay(
  agentId: string,
  input: EnableAutopayInput,
  fm: FleetManager = new FleetManager()
): Promise<EnableAutopayResult> {
  if (!Number.isFinite(input.dailyLimitUsd) || input.dailyLimitUsd <= 0) {
    return { ok: false, detail: 'dailyLimitUsd must be a positive number' }
  }
  if (
    input.perTxLimitUsd != null &&
    (!Number.isFinite(input.perTxLimitUsd) || input.perTxLimitUsd <= 0)
  ) {
    return { ok: false, detail: 'perTxLimitUsd must be a positive number when set' }
  }
  if (input.mode === 'permission-token' && !input.permissionToken) {
    return {
      ok: false,
      detail:
        'mode=permission-token requires --permission-token (waap-cli has no privilege-mint command yet)'
    }
  }

  // 1. Push the daily spend cap to the wallet (server-side enforcement).
  const setPolicy = await runWaap({
    agentId,
    args: ['policy', 'set', '--daily-spend-limit', String(input.dailyLimitUsd)],
    bin: input.bin
  })
  if (setPolicy.exitCode !== 0) {
    return {
      ok: false,
      detail: `policy set failed: ${firstLine(setPolicy.stderr || setPolicy.stdout)}`
    }
  }

  // 2. For no-2fa mode, remove the per-tx 2FA prompt so the bounded session signs unattended.
  //    permission-token mode keeps 2FA on and bypasses it per-tx with the supplied --privilege.
  if (input.mode === 'no-2fa') {
    const disable = await runWaap({ agentId, args: ['2fa', 'disable'], bin: input.bin })
    if (disable.exitCode !== 0) {
      return {
        ok: false,
        detail: `2fa disable failed: ${firstLine(disable.stderr || disable.stdout)}`
      }
    }
  }

  const now = new Date().toISOString()
  const state: AutopayState = {
    enabled: true,
    dailyLimitUsd: input.dailyLimitUsd,
    ...(input.perTxLimitUsd != null ? { perTxLimitUsd: input.perTxLimitUsd } : {}),
    mode: input.mode,
    ...(input.permissionToken ? { permissionToken: input.permissionToken } : {}),
    renewBeforeMinutes: input.renewBeforeMinutes ?? 30,
    spentTodayUsd: 0,
    spentDate: utcDate(now),
    configuredAt: now
  }
  await fm.updateAgent(agentId, { autopay: state })
  return {
    ok: true,
    detail: `autopay armed (daily cap $${input.dailyLimitUsd}, mode=${input.mode})`
  }
}

/** Disable autopay for one agent. Leaves the wallet's 2FA/policy as-is (operator decides). */
export async function disableAutopay(
  agentId: string,
  fm: FleetManager = new FleetManager()
): Promise<void> {
  const agent = fm.getAgent(agentId)
  if (!agent?.autopay) return
  await fm.updateAgent(agentId, { autopay: { ...agent.autopay, enabled: false } })
}

/** Pause autopay (cap hit / funds / renewal failure). The renewal loop skips paused agents. */
export async function pauseAutopay(
  agentId: string,
  reason: string,
  fm: FleetManager = new FleetManager()
): Promise<void> {
  const agent = fm.getAgent(agentId)
  if (!agent?.autopay) return
  await fm.updateAgent(agentId, {
    autopay: { ...agent.autopay, pausedReason: reason, pausedAt: new Date().toISOString() }
  })
}

/** Clear a pause and re-arm renewals. */
export async function resumeAutopay(
  agentId: string,
  fm: FleetManager = new FleetManager()
): Promise<void> {
  const agent = fm.getAgent(agentId)
  if (!agent?.autopay) return
  const next = { ...agent.autopay, enabled: true }
  delete next.pausedReason
  delete next.pausedAt
  await fm.updateAgent(agentId, { autopay: next })
}

export type RenewalOutcome =
  | { status: 'skipped'; reason: string }
  | { status: 'not-due'; expiresAt: string }
  | { status: 'renewed'; escrowUid?: string; chargedUsd?: number; expiresAt?: string }
  | { status: 'paused'; reason: string }

/** Inject a renewal mechanism so the engine stays testable without real compute/escrow. */
export interface RenewalDeps {
  fm: FleetManager
  /**
   * Re-buy the next lease term for the agent. Returns the new lease handle + cost. Reuses the
   * existing provider deploy/lease path at the call site (see `core/renewal.ts`).
   */
  renew: (agent: AgentEntry) => Promise<{ escrowUid?: string; chargedUsd?: number; leaseHours?: number }>
  /** Notify the operator on pause (cap hit / failure). Never throws into the renewal path. */
  notify?: (agent: AgentEntry, message: string) => Promise<void> | void
  now?: () => Date
}

/**
 * Renew one agent's lease if it's within the renew window — bounded by the consented cap.
 *
 * Order of guards (each is a hard stop, never a silent drop):
 *   - autopay disabled / already paused → skip.
 *   - lease not yet near expiry → not-due.
 *   - per-tx cap or projected daily cap would be exceeded → pause + notify.
 *   - renewal throws (funds, provider, chain) → pause + notify.
 * On success: roll the daily-spend accumulator and the lease expiry forward.
 */
export async function renewIfDue(agent: AgentEntry, deps: RenewalDeps): Promise<RenewalOutcome> {
  const now = (deps.now ?? (() => new Date()))()
  const ap = agent.autopay
  if (!ap || !ap.enabled) return { status: 'skipped', reason: 'autopay not enabled' }
  if (ap.pausedReason) return { status: 'skipped', reason: `paused: ${ap.pausedReason}` }

  const expiresAt = agent.deployment?.leaseExpiresAt
  if (!expiresAt) return { status: 'skipped', reason: 'no lease expiry recorded' }

  const msUntilExpiry = Date.parse(expiresAt) - now.getTime()
  const windowMs = ap.renewBeforeMinutes * 60_000
  if (msUntilExpiry > windowMs) return { status: 'not-due', expiresAt }

  // Roll the daily window if the UTC date changed, then enforce the consented caps client-side.
  // (waap-cli also enforces the daily cap server-side; this client check lets us pause cleanly
  // BEFORE attempting a charge that would breach it, instead of relying on a signing failure.)
  const today = utcDate(now.toISOString())
  const spentToday = ap.spentDate === today ? ap.spentTodayUsd : 0

  // Best-effort cost estimate for the cap pre-check: a renewal of the same lease term costs about
  // the same as the recorded lease price. priceUsd is normalized to USD/month; pro-rate by term.
  const estCost = estimateRenewalCostUsd(agent)
  if (ap.perTxLimitUsd != null && estCost != null && estCost > ap.perTxLimitUsd) {
    const reason = `estimated renewal $${estCost.toFixed(2)} exceeds per-tx cap $${ap.perTxLimitUsd}`
    await pauseAndNotify(agent, reason, deps)
    return { status: 'paused', reason }
  }
  if (estCost != null && spentToday + estCost > ap.dailyLimitUsd) {
    const reason = `estimated renewal $${estCost.toFixed(2)} would exceed daily cap $${ap.dailyLimitUsd} (spent $${spentToday.toFixed(2)} today)`
    await pauseAndNotify(agent, reason, deps)
    return { status: 'paused', reason }
  }

  // Within the cap — buy the next term.
  let lease: { escrowUid?: string; chargedUsd?: number; leaseHours?: number }
  try {
    lease = await deps.renew(agent)
  } catch (err) {
    const reason = `renewal failed: ${err instanceof Error ? err.message : String(err)}`
    await pauseAndNotify(agent, reason, deps)
    return { status: 'paused', reason }
  }

  const charged = lease.chargedUsd ?? estCost ?? 0
  const newExpiry = computeNewExpiry(now, lease.leaseHours ?? agent.deployment?.leaseHours)
  await deps.fm.updateAgent(agent.agentId, {
    autopay: {
      ...ap,
      spentTodayUsd: spentToday + charged,
      spentDate: today,
      lastRenewalAt: now.toISOString()
    },
    ...(agent.deployment
      ? {
          deployment: {
            ...agent.deployment,
            ...(lease.escrowUid ? { ref: lease.escrowUid, escrowUid: lease.escrowUid } : {}),
            status: 'running' as const,
            deployedAt: now.toISOString(),
            ...(newExpiry ? { leaseExpiresAt: newExpiry } : {})
          }
        }
      : {})
  })
  return {
    status: 'renewed',
    ...(lease.escrowUid ? { escrowUid: lease.escrowUid } : {}),
    chargedUsd: charged,
    ...(newExpiry ? { expiresAt: newExpiry } : {})
  }
}

async function pauseAndNotify(agent: AgentEntry, reason: string, deps: RenewalDeps): Promise<void> {
  await pauseAutopay(agent.agentId, reason, deps.fm)
  if (deps.notify) {
    try {
      await deps.notify(agent, `autopay paused for ${agent.agentId}: ${reason}`)
    } catch {
      /* notification must never break the renewal path */
    }
  }
}

const SECONDS_PER_MONTH = 2_592_000

/**
 * Estimate the USD cost of renewing the same lease term from the recorded lease price.
 * `priceUsdMonth` (persisted on the deployment) is normalized to USD/month; pro-rate it back to the
 * lease term. Returns undefined when we have no price signal — then the client-side cap pre-check is
 * skipped and we rely on waap-cli's server-side daily-spend-limit to bound the charge.
 */
export function estimateRenewalCostUsd(agent: AgentEntry): number | undefined {
  const hours = agent.deployment?.leaseHours
  const priceUsdMonth = agent.deployment?.priceUsdMonth
  if (priceUsdMonth == null || hours == null) return undefined
  const perSecond = priceUsdMonth / SECONDS_PER_MONTH
  return Math.round(perSecond * hours * 3600 * 100) / 100
}

function computeNewExpiry(now: Date, leaseHours: number | undefined): string | undefined {
  if (leaseHours == null) return undefined
  return new Date(now.getTime() + leaseHours * 3_600_000).toISOString()
}

function utcDate(iso: string): string {
  return iso.slice(0, 10)
}

function firstLine(s: string): string {
  return (s || '').trim().split('\n')[0] ?? ''
}
