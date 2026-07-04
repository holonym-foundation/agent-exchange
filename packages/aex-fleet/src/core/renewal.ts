import type { AgentEntry } from '../types.js'
import { FleetManager } from './FleetManager.js'
import { getProvider, type ProviderName } from './providers/index.js'
import { renewIfDue, type RenewalDeps, type RenewalOutcome } from './autopay.js'

/**
 * WS-D / #1256 — autopay renewal engine wiring.
 *
 * `renewAll` sweeps the fleet and, for each agent whose lease is near expiry, re-buys the next term
 * within the consented cap by reusing the existing provider lease path (Arkhai `market buy`, signed
 * through the agent's WaaP wallet). Pure renewal policy + cap enforcement lives in `autopay.ts`;
 * this module supplies the concrete `renew()` mechanism and the per-agent notify hook.
 *
 * Run it from `aex-fleet renew` (one-shot or `--watch`), or on a cron — see SKILL/README.
 */

export interface RenewAllOptions {
  /** Override the waap-cli binary path (passed through to the provider where relevant). */
  bin?: string
  /** Inject a clock for tests. */
  now?: () => Date
  /** Notify hook (cap hit / failure). Defaults to a stderr line. */
  notify?: (agent: AgentEntry, message: string) => Promise<void> | void
  /** FleetManager override (tests). */
  fm?: FleetManager
}

export interface RenewAllResult {
  agentId: string
  outcome: RenewalOutcome
}

/**
 * Re-buy one agent's next lease term via its recorded provider, signed by its WaaP wallet.
 *
 * The agent's compute env (SOUL/recipe/inference creds) is already provisioned via container_env;
 * a renewal only needs to re-lock escrow for the next term, so we run `provider.deploy` in a
 * renewal posture: container runtime on (no re-ship), source unused. The provider locks a fresh
 * escrow and returns the new lease handle + price, which `renewIfDue` rolls into the cap accounting
 * and lease-expiry bookkeeping.
 */
function buildRenew(opts: RenewAllOptions) {
  return async (agent: AgentEntry) => {
    const dep = agent.deployment
    if (!dep) throw new Error('no deployment recorded — cannot renew')
    const provider = getProvider(dep.provider as ProviderName, {
      durationHours: dep.leaseHours,
      walletMode: 'waap', // renewals are signed by the agent's own WaaP wallet (Model 2)
      bin: opts.bin
    })
    // Renewal re-locks escrow for the next term. AEX_CONTAINER_ENV_JSON signals the seller already
    // holds the agent's container config, so deploy() skips the (non-existent) re-ship step.
    const result = await provider.deploy({
      agentId: agent.agentId,
      agent,
      source: '',
      env: { ...(agent.address ? { WAAP_AGENT_ADDRESS: agent.address } : {}) },
      dryRun: false
    })
    return {
      ...(result.escrowUid ? { escrowUid: result.escrowUid } : {}),
      ...(result.priceUsd != null ? { chargedUsd: proRateMonthToTerm(result.priceUsd, result.leaseHours ?? dep.leaseHours) } : {}),
      ...(result.leaseHours != null ? { leaseHours: result.leaseHours } : {})
    }
  }
}

const SECONDS_PER_MONTH = 2_592_000

function proRateMonthToTerm(priceUsdMonth: number, leaseHours: number | undefined): number | undefined {
  if (leaseHours == null) return undefined
  return Math.round((priceUsdMonth / SECONDS_PER_MONTH) * leaseHours * 3600 * 100) / 100
}

function defaultNotify(agent: AgentEntry, message: string): void {
  process.stderr.write(`[autopay] ${message}\n`)
}

/** One renewal sweep across every agent with autopay enabled. Continue-and-report. */
export async function renewAll(opts: RenewAllOptions = {}): Promise<RenewAllResult[]> {
  const fm = opts.fm ?? new FleetManager()
  const deps: RenewalDeps = {
    fm,
    renew: buildRenew(opts),
    notify: opts.notify ?? defaultNotify,
    ...(opts.now ? { now: opts.now } : {})
  }
  const results: RenewAllResult[] = []
  for (const agent of fm.listAgents()) {
    if (!agent.autopay?.enabled) continue
    const outcome = await renewIfDue(agent, deps)
    results.push({ agentId: agent.agentId, outcome })
  }
  return results
}
