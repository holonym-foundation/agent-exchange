import { z } from 'zod'

export const BalanceCacheSchema = z.object({
  value: z.string(),
  ts: z.string()
})

// ERC-8004 Identity Registry state per agent. v1.0.2 records intent only; on-chain mint
// happens once contracts are deployed (see core/erc8004.ts CONTRACTS_BY_CHAIN). Token ID is
// stored as a string to preserve full uint256 precision across JSON round-trips.
export const Erc8004StateSchema = z.object({
  status: z.enum(['pending', 'minted', 'failed']),
  intentChain: z.string(),
  intentRecordedAt: z.string(),
  registry: z.string().optional(),
  tokenId: z.string().optional(),
  agentURI: z.string().optional(),
  mintedAt: z.string().optional(),
  mintTxHash: z.string().optional(),
  lastError: z.string().optional()
})

// Where an agent is deployed. Recorded on the fleet entry after `aex-fleet deploy` so `ls`/`status`
// can show it and `stop` can find the handle. provider-native `ref` = lease/escrow uid (arkhai),
// pid (local), or systemd unit (hetzner).
export const DeploymentStateSchema = z.object({
  provider: z.enum(['arkhai', 'marlin-tee', 'local', 'hetzner-systemd']),
  ref: z.string(),
  host: z.string().optional(),
  escrowUid: z.string().optional(),
  status: z.enum(['running', 'stopped', 'crashed', 'unknown']).default('unknown'),
  deployedAt: z.string(),
  /** Lease term in hours (from --duration-hours / AEX_LEASE_HOURS). Drives renewal timing. */
  leaseHours: z.number().optional(),
  /** ISO timestamp the current lease term expires (deployedAt + leaseHours). */
  leaseExpiresAt: z.string().optional(),
  /** Negotiated lease price normalized to USD/month, when the provider surfaced it. Used by the
   * autopay cap pre-check to estimate a renewal's cost before charging. */
  priceUsdMonth: z.number().optional(),
  lastError: z.string().optional()
})

// WS-D / #1256 — buyer autopay (Model 2). The agent's own WaaP wallet auto-buys + auto-renews its
// compute lease without a human approving each tx, bounded by a spend policy the user consented to
// at deploy. Recorded on the fleet entry so the renewal loop knows the cap and how to sign
// non-interactively, and so a cap-hit / funds / renewal failure can `pause` (never silently drop).
//
// Non-interactive signing within the cap relies on waap-cli's policy primitives (verified v1.0.2):
//   - `policy set --daily-spend-limit <usd>` enforces the daily cap server-side.
//   - a transaction bypasses the 2FA prompt with `--privilege <encoded>` (pre-minted out of band)
//     OR by disabling 2FA for the bounded session (`mode: 'no-2fa'`).
// There is no `privilege` mint subcommand in waap-cli yet, so 'permission-token' mode requires the
// caller to supply a token; until that primitive ships, 'no-2fa' is the available in-CLI path.
export const AutopayStateSchema = z.object({
  enabled: z.boolean().default(false),
  /** Daily spend cap in USD pushed to `waap-cli policy set --daily-spend-limit`. */
  dailyLimitUsd: z.number(),
  /** Per-renewal cap in USD; a single lease purchase above this pauses instead of buying. */
  perTxLimitUsd: z.number().optional(),
  /**
   * How the bounded buyer session signs without a per-tx 2FA prompt:
   *   'no-2fa'           — 2FA disabled for this wallet; daily-spend-limit is the only bound.
   *   'permission-token' — a pre-minted waap-cli `--privilege`/permission-token is supplied per tx.
   */
  mode: z.enum(['no-2fa', 'permission-token']),
  /** Encoded permission-token / privilege, when mode='permission-token'. Opaque to aex-fleet. */
  permissionToken: z.string().optional(),
  /** Renew when the lease is within this many minutes of expiry. */
  renewBeforeMinutes: z.number().default(30),
  /** Set when autopay is paused (cap hit / funds / renewal failure). Renewal loop skips paused agents. */
  pausedReason: z.string().optional(),
  pausedAt: z.string().optional(),
  /** Running total of USD spent by autopay today (UTC), for client-side cap enforcement. */
  spentTodayUsd: z.number().default(0),
  /** UTC date (YYYY-MM-DD) the spentTodayUsd window covers; resets when the date rolls over. */
  spentDate: z.string().optional(),
  configuredAt: z.string(),
  lastRenewalAt: z.string().optional()
})

export const AgentEntrySchema = z.object({
  agentId: z.string(),
  templateId: z.string().optional(),
  chain: z.string().optional(),
  address: z.string().optional(),
  waapEmail: z.string().optional(),
  tags: z.array(z.string()).default([]),
  sessionRef: z.string().optional(),
  linkedTo: z.string().optional(),
  createdAt: z.string(),
  lastBalanceCache: BalanceCacheSchema.optional(),
  erc8004: Erc8004StateSchema.optional(),
  deployment: DeploymentStateSchema.optional(),
  autopay: AutopayStateSchema.optional()
})

export const FleetConfigSchema = z.object({
  version: z.literal(1),
  activeAgent: z.string().optional(),
  agents: z.record(z.string(), AgentEntrySchema).default({}),
  telemetry: z
    .object({
      neonDsn: z.string().optional()
    })
    .optional()
})

export type BalanceCache = z.infer<typeof BalanceCacheSchema>
export type Erc8004State = z.infer<typeof Erc8004StateSchema>
export type DeploymentState = z.infer<typeof DeploymentStateSchema>
export type AutopayState = z.infer<typeof AutopayStateSchema>
export type AgentEntry = z.infer<typeof AgentEntrySchema>
export type FleetConfig = z.infer<typeof FleetConfigSchema>
