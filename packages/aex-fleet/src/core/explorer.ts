// Map fleet.json `chain` values to block-explorer base URLs. Returning null tells the dashboard
// to render the address as plain text (no link). Sui defaults to suiscan.xyz mainnet — operators
// can override via env if they want suiexplorer.com instead.

interface ExplorerCfg {
  base: string
  addressPath: (a: string) => string
  txPath: (h: string) => string
}

const EXPLORER_BY_CHAIN: Record<string, ExplorerCfg> = {
  ethereum: {
    base: 'https://etherscan.io',
    addressPath: (a) => `/address/${a}`,
    txPath: (h) => `/tx/${h}`
  },
  mainnet: {
    base: 'https://etherscan.io',
    addressPath: (a) => `/address/${a}`,
    txPath: (h) => `/tx/${h}`
  },
  sepolia: {
    base: 'https://sepolia.etherscan.io',
    addressPath: (a) => `/address/${a}`,
    txPath: (h) => `/tx/${h}`
  },
  sui: {
    base: 'https://suiscan.xyz/mainnet',
    addressPath: (a) => `/account/${a}`,
    txPath: (h) => `/tx/${h}`
  }
}

export function explorerAddressUrl(chain: string | undefined, address: string | null): string | null {
  if (!chain || !address) return null
  const cfg = EXPLORER_BY_CHAIN[chain.toLowerCase()]
  if (!cfg) return null
  return cfg.base + cfg.addressPath(address)
}

export function explorerTxUrl(chain: string | undefined, txHash: string): string | null {
  if (!chain) return null
  const cfg = EXPLORER_BY_CHAIN[chain.toLowerCase()]
  if (!cfg) return null
  return cfg.base + cfg.txPath(txHash)
}
