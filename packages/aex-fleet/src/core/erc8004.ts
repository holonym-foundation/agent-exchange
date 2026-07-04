import { withLockedConfig } from './config.js'
import type { Erc8004State } from '../types.js'

// EIP-8004 (Trustless Agents) is Draft as of this writing — no canonical singleton
// deployment exists. v1.0.2 ships the intent surface (record-in-fleet-json) without making
// any on-chain calls. Populate this map once Holonym (or a community fork) deploys reference
// Identity + Reputation registries; the register flow will pick the right one by chain.
//
// Spec functions we'll target when contracts land:
//   Identity:    register(string agentURI, MetadataEntry[] metadata) -> uint256 agentId
//   Reputation:  giveFeedback(uint256 agentId, int128 value, uint8 valueDecimals,
//                             string tag1, string tag2, string endpoint,
//                             string feedbackURI, bytes32 feedbackHash)
export interface ContractAddrs {
  identityRegistry: string
  reputationRegistry?: string
}
export const CONTRACTS_BY_CHAIN: Record<string, ContractAddrs> = {
  // empty in v1.0.2 — fill in once deployed, e.g.:
  // 'sepolia':  { identityRegistry: '0x…', reputationRegistry: '0x…' },
  // 'ethereum': { identityRegistry: '0x…', reputationRegistry: '0x…' }
}

// Map fleet.json `chain` values to ERC-8004 deployment chain ids. EVM defaults to Sepolia
// for testing; operators override via --chain on register. Non-EVM agents (sui) reject
// registration with a clear error until a Sui-side identity story exists.
export function defaultIdentityChain(agentChain?: string): string | undefined {
  if (!agentChain) return 'sepolia'
  const lc = agentChain.toLowerCase()
  if (lc === 'ethereum' || lc === 'mainnet') return 'ethereum'
  if (lc === 'sepolia' || lc === 'evm') return 'sepolia'
  return undefined
}

export function recordIntent(opts: {
  agentId: string
  intentChain: string
  configPath?: string
}): Promise<Erc8004State> {
  const next: Erc8004State = {
    status: 'pending',
    intentChain: opts.intentChain,
    intentRecordedAt: new Date().toISOString()
  }
  return withLockedConfig(async (cfg) => {
    const agent = cfg.agents[opts.agentId]
    if (!agent) throw new Error(`Unknown agent: ${opts.agentId}`)
    // Preserve already-minted state if a re-register is called on a live token.
    if (agent.erc8004?.status === 'minted') {
      throw new Error(
        `Agent ${opts.agentId} already minted on ${agent.erc8004.intentChain} (tokenId=${agent.erc8004.tokenId}). Use \`erc8004 unregister\` first if you want to re-mint.`
      )
    }
    agent.erc8004 = next
    return cfg
  }, opts.configPath).then(() => next)
}

export function clearIntent(opts: { agentId: string; configPath?: string }): Promise<void> {
  return withLockedConfig(async (cfg) => {
    const agent = cfg.agents[opts.agentId]
    if (!agent) throw new Error(`Unknown agent: ${opts.agentId}`)
    delete agent.erc8004
    return cfg
  }, opts.configPath)
}

export function statusDescription(state: Erc8004State | undefined): string {
  if (!state) return 'not registered'
  switch (state.status) {
    case 'minted':
      return `minted (tokenId=${state.tokenId} on ${state.intentChain})`
    case 'failed':
      return `failed: ${state.lastError ?? 'unknown'} (${state.intentChain})`
    case 'pending':
      return contractsDeployed(state.intentChain)
        ? `pending mint on ${state.intentChain}`
        : `pending — contracts not yet deployed on ${state.intentChain}`
  }
}

export function contractsDeployed(chain: string): boolean {
  return Boolean(CONTRACTS_BY_CHAIN[chain])
}
