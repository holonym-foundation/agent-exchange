#!/usr/bin/env python3
"""farm_status — keyless read of the agent's own wallet state, for Farm decisions.

Self-sustaining: public RPC only — no API keys, no AEX backend. The agent calls this before taking
a farming action to answer: do I have gas? do I have enough of the spend token to act within my
cap? how active has this wallet already been (nonce → pace organically, don't burst)?

Usage:
  farm_status.py --chain 8453 --wallet 0xAgent... [--token 0xUSDC...]

Prints JSON; always exits 0.
"""
import argparse
import json
import urllib.request

RPCS = {
    1: ["https://ethereum-rpc.publicnode.com", "https://eth.llamarpc.com"],
    8453: ["https://base-rpc.publicnode.com", "https://base.llamarpc.com"],
    84532: ["https://base-sepolia-rpc.publicnode.com", "https://sepolia.base.org"],
    42161: ["https://arbitrum-one-rpc.publicnode.com", "https://arb1.arbitrum.io/rpc"],
    10: ["https://optimism-rpc.publicnode.com", "https://mainnet.optimism.io"],
}
TIMEOUT = 12


def rpc(chain, method, params):
    for url in RPCS.get(chain, []):
        try:
            req = urllib.request.Request(
                url,
                data=json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode(),
                headers={"Content-Type": "application/json", "User-Agent": "aex-farm-status"},
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
        return int(x, 16) if isinstance(x, str) else 0
    except Exception:
        return 0


def balance_of(chain, token, wallet):
    data = "0x70a08231" + wallet.lower().replace("0x", "").rjust(64, "0")
    res = rpc(chain, "eth_call", [{"to": token, "data": data}, "latest"])
    return hex_int(res) if res else 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--chain", type=int, required=True)
    ap.add_argument("--wallet", required=True)
    ap.add_argument("--token", help="ERC-20 to report balance for (e.g. USDC)")
    a = ap.parse_args()

    gas_wei = hex_int(rpc(a.chain, "eth_getBalance", [a.wallet, "latest"]))
    nonce = hex_int(rpc(a.chain, "eth_getTransactionCount", [a.wallet, "latest"]))
    out = {
        "chain": a.chain,
        "wallet": a.wallet,
        "gasEth": gas_wei / 1e18,
        "hasGas": gas_wei > 5 * 10 ** 14,  # ~0.0005 ETH — enough for a few txs
        "txCount": nonce,  # activity level — pace organically, don't burst
    }
    if a.token:
        units = balance_of(a.chain, a.token, a.wallet)
        out["token"] = {"address": a.token, "units": str(units)}
    print(json.dumps(out, indent=2))


if __name__ == "__main__":
    main()
