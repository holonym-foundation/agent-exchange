#!/usr/bin/env python3
"""gas_check — keyless gas + native-balance check across chains and wallets.

Self-sustaining: public RPC only (eth_getBlockByNumber for the current base fee, eth_feeHistory for
the recent distribution, eth_getBalance per wallet). No API key, no AEX backend.

Gas is per-CHAIN (base fee is chain-wide); native balance is per-WALLET. Gas-timing matters most on
Ethereum L1 (real spikes); on L2s gas is usually negligible, so we suppress normal L2 variation and
only surface a genuine L2 spike. Flags:
  gas_cheap   — base fee at/below the cheap percentile of recent blocks (good moment to act) [L1 + meaningful chains]
  gas_spike   — base fee at/above the spike percentile (hold off / be aware)
  actionable  — gas_cheap/gas_spike that's worth a notification on THIS chain (L1 always; L2 only on extreme spike)
  low_gas     — a watched wallet's native balance is below --min-native (can't afford pending actions)

Usage:
  gas_check.py --wallets 0xa,0xb --chains 1,8453,42161,10 [--min-native 0.002] [--cheap-pctile 30] [--spike-pctile 90]

Always exits 0; parse the JSON on stdout.
"""
import argparse
import json
import urllib.request

RPCS = {
    1: ["https://eth.drpc.org", "https://ethereum-rpc.publicnode.com"],
    8453: ["https://base.drpc.org", "https://base-rpc.publicnode.com"],
    42161: ["https://arbitrum.drpc.org", "https://arbitrum-one-rpc.publicnode.com"],
    10: ["https://optimism.drpc.org", "https://optimism-rpc.publicnode.com"],
    84532: ["https://base-sepolia.drpc.org", "https://base-sepolia-rpc.publicnode.com"],
}
CHAIN_NAMES = {1: "Ethereum", 8453: "Base", 42161: "Arbitrum", 10: "Optimism", 84532: "Base Sepolia"}
# Gas-timing is meaningful on L1; L2s are usually negligible. On L2 we only call a spike "actionable".
L1_CHAINS = {1}
# Below this gwei, an L2 base fee isn't worth mentioning even at a high percentile (pure noise).
L2_GAS_FLOOR_GWEI = 0.05
TIMEOUT = 15


def rpc(chain, method, params):
    for url in RPCS.get(chain, []):
        try:
            req = urllib.request.Request(
                url,
                data=json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode(),
                headers={"Content-Type": "application/json", "User-Agent": "aex-gas-claims-reminder"},
            )
            with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
                j = json.loads(r.read().decode())
            if isinstance(j, dict) and j.get("result") is not None:
                return j["result"]
        except Exception:
            continue
    return None


def hex_int(x):
    try:
        return int(x, 16)
    except Exception:
        return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--wallets", required=True, help="comma-separated addresses to check balances for")
    ap.add_argument("--chains", default="1,8453,42161,10")
    ap.add_argument("--min-native", type=float, default=0.002)
    ap.add_argument("--cheap-pctile", type=float, default=30.0)
    ap.add_argument("--spike-pctile", type=float, default=90.0)
    a = ap.parse_args()
    chains = [int(c) for c in a.chains.split(",") if c.strip()]
    wallets = [w.strip() for w in a.wallets.split(",") if w.strip()]

    out = []
    for chain in chains:
        blk = rpc(chain, "eth_getBlockByNumber", ["latest", False]) or {}
        base = hex_int(blk.get("baseFeePerGas") or "0x0")
        row = {"chain": chain, "chain_name": CHAIN_NAMES.get(chain, str(chain)), "is_l1": chain in L1_CHAINS}
        if base is None:
            row["error"] = "no base fee"
            out.append(row)
            continue
        gwei = base / 1e9
        fh = rpc(chain, "eth_feeHistory", ["0x32", "latest", []]) or {}
        hist = [hex_int(x) for x in (fh.get("baseFeePerGas") or []) if hex_int(x) is not None]
        pctile = round(100.0 * sum(1 for h in hist if h <= base) / len(hist), 1) if hist else None
        gas_cheap = pctile is not None and pctile <= a.cheap_pctile
        gas_spike = pctile is not None and pctile >= a.spike_pctile
        # actionability: L1 cheap/spike always worth a ping; L2 only an extreme spike above the floor
        if chain in L1_CHAINS:
            actionable = gas_cheap or gas_spike
        else:
            actionable = gas_spike and gwei >= L2_GAS_FLOOR_GWEI
        # per-wallet native balances on this chain
        balances = []
        for w in wallets:
            bal = hex_int(rpc(chain, "eth_getBalance", [w, "latest"]) or "0x0") or 0
            native = bal / 1e18
            balances.append({"wallet": w, "native_balance": round(native, 6), "low_gas": native < a.min_native})
        row.update({
            "base_fee_gwei": round(gwei, 4),
            "pctile_of_recent": pctile,
            "gas_cheap": gas_cheap,
            "gas_spike": gas_spike,
            "actionable_gas": actionable,
            "balances": balances,
        })
        out.append(row)

    actionable = [r for r in out if r.get("actionable_gas") or any(b["low_gas"] for b in r.get("balances", []))]
    print(json.dumps({
        "wallets": wallets,
        "chains": chains,
        "source": "public-rpc",
        "results": out,
        "actionable": actionable,
        "note": "Gas-timing is meaningful on Ethereum L1; L2 gas is suppressed unless it genuinely "
                "spikes. gas_cheap = good moment to act; low_gas = top up. Read-only — never sends.",
    }, indent=2))


if __name__ == "__main__":
    main()
