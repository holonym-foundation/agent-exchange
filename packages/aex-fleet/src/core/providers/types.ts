import type { AgentEntry } from '../../types.js'

/**
 * Compute-provider abstraction — the seam that lets `aex-fleet deploy` ship an agent onto
 * different backends through one interface. Today deploy is a hand-rolled deploy.sh per agent
 * (rsync + SSH + systemd to one Hetzner box); this generalises it so a backend like Arkhai
 * (on-chain VM leasing) can be a first-class target alongside self-host.
 *
 * Design ref: internal-docs products/waap/prd/aex/deployment.md (#941, #1219).
 */

export type ProviderName = 'arkhai' | 'marlin-tee' | 'local' | 'hetzner-systemd'

/** What to deploy + how to reach the wallet/telemetry it needs. */
export interface DeploySpec {
  /** Fleet-local agent id (resolved by the deploy command). */
  agentId: string
  /** The agent entry from fleet.json (carries chain, address, waapEmail, tags). */
  agent: AgentEntry
  /** Absolute path to the scaffolded agent project to ship (contains the template Dockerfile). */
  source: string
  /** Non-secret env passed to the agent process. */
  env: Record<string, string>
  /** Telemetry contract — agents POST JSON-line events here (Neon-backed dashboard). */
  telemetry?: { ingestUrl: string; apiKey: string }
  /** Provider-specific knobs (e.g. Arkhai lease params). */
  options?: Record<string, unknown>
  /** Print the plan without provisioning/charging anything. */
  dryRun?: boolean
}

/** Stable handle to a deployed agent, persisted on the fleet entry. */
export interface DeployResult {
  provider: ProviderName
  /** Provider-native id for the running unit (lease/escrow uid, container id, systemd unit). */
  ref: string
  /** Where it runs (VM IP, host, or 'local'). */
  host?: string
  /** On-chain escrow id for leased compute, when applicable. */
  escrowUid?: string
  /** ISO timestamp. */
  deployedAt: string
  /** Lease term in hours for leased compute (drives autopay renewal timing). */
  leaseHours?: number
  /** Negotiated lease price normalized to USD/month, when the provider surfaces it. */
  priceUsd?: number
  /** Free-form provider notes surfaced to the operator. */
  notes?: string[]
}

export type AgentRunState = 'running' | 'stopped' | 'crashed' | 'unknown'

export interface AgentStatus {
  state: AgentRunState
  detail?: string
}

export interface LogOpts {
  follow?: boolean
  tail?: number
}

/** One compute backend. Implementations shell out (execa) and never assemble private keys. */
export interface ComputeProvider {
  readonly name: ProviderName
  /** Fail fast if the provider's CLI/credentials aren't available (used by `doctor`/preflight). */
  preflight(): Promise<{ ok: boolean; detail?: string }>
  /** Provision (lease/start) and ship the agent. Honors spec.dryRun. */
  deploy(spec: DeploySpec): Promise<DeployResult>
  stop(ref: string): Promise<void>
  getStatus(ref: string): Promise<AgentStatus>
  getLogs?(ref: string, opts?: LogOpts): Promise<string>
}
