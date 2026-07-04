import { createPublicClient, formatEther, getAddress, http, isAddress, type Chain } from 'viem'
import { mainnet, sepolia } from 'viem/chains'

// We deliberately use the same viem version as @human.tech/waap-cli (^2.21.55) so the EVM
// reads here behave identically to what waap-cli does under the hood for `balance`.

// viem's built-in mainnet default (cloudflare-eth.com) frequently returns "Internal error".
// llamarpc and ankr are also flaky without API keys. publicnode is reliable and key-free for both
// mainnet and sepolia. Operators override per-chain via env vars for production.
const CHAIN_BY_NAME: Record<
  string,
  { chain: Chain; envOverride: string; defaultRpc: string }
> = {
  ethereum: {
    chain: mainnet,
    envOverride: 'AEX_FLEET_RPC_ETHEREUM',
    defaultRpc: 'https://ethereum-rpc.publicnode.com'
  },
  mainnet: {
    chain: mainnet,
    envOverride: 'AEX_FLEET_RPC_ETHEREUM',
    defaultRpc: 'https://ethereum-rpc.publicnode.com'
  },
  sepolia: {
    chain: sepolia,
    envOverride: 'AEX_FLEET_RPC_SEPOLIA',
    defaultRpc: 'https://ethereum-sepolia-rpc.publicnode.com'
  }
}

export interface BalanceResult {
  value: number // human-readable ETH amount
  raw: string // wei as decimal string (preserves full precision)
  chain: string
  fetchedAt: string // ISO timestamp
}

const FETCH_TIMEOUT_MS = 5_000
const CACHE_TTL_MS = 30_000

// Per-(address,chain) cache so a single dashboard refresh (or rapid back-to-back refreshes) only
// fires one RPC call per agent per 30s window. Live enough to feel real, gentle on public RPCs.
const cache = new Map<string, { result: BalanceResult; expiresAt: number }>()

function cacheKey(addr: string, chainName: string): string {
  return `${chainName.toLowerCase()}|${addr.toLowerCase()}`
}

/**
 * Returns the on-chain native-token balance for the address on the named chain, or null if:
 *   - the chain isn't an EVM chain we support (Sui agents → null until v1.3),
 *   - the address isn't a valid EVM address,
 *   - the RPC errors or times out (caller falls back to whatever it had before).
 */
export async function fetchEvmBalance(
  addr: string,
  chainName: string
): Promise<BalanceResult | null> {
  const cfg = CHAIN_BY_NAME[chainName.toLowerCase()]
  if (!cfg) return null
  // Accept addresses that parse as hex even if the EIP-55 checksum is wrong (very common when
  // operators paste from faucets / docs); normalise to canonical case before sending to viem.
  if (!isAddress(addr, { strict: false })) return null
  const normalised = getAddress(addr)

  const key = cacheKey(normalised, chainName)
  const cached = cache.get(key)
  if (cached && cached.expiresAt > Date.now()) return cached.result

  const rpc = process.env[cfg.envOverride] ?? cfg.defaultRpc
  const client = createPublicClient({
    chain: cfg.chain,
    transport: http(rpc, { timeout: FETCH_TIMEOUT_MS })
  })
  try {
    const wei = await client.getBalance({ address: normalised })
    const result: BalanceResult = {
      value: Number(formatEther(wei)),
      raw: wei.toString(),
      chain: chainName,
      fetchedAt: new Date().toISOString()
    }
    cache.set(key, { result, expiresAt: Date.now() + CACHE_TTL_MS })
    return result
  } catch (err) {
    // Surface the reason on stderr so operators (and the dashboard log) see why a column is
    // blank. Common causes: RPC rate-limit, transient gateway error, address-format mismatch.
    const msg = err instanceof Error ? err.message.split('\n')[0] : String(err)
    process.stderr.write(`[balance-fetcher] ${chainName}/${addr.slice(0, 10)}…: ${msg}\n`)
    return null
  }
}

/** Test-only: clear the cache between runs. */
export function resetBalanceCacheForTests(): void {
  cache.clear()
}
