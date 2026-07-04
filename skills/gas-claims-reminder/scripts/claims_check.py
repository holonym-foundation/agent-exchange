#!/usr/bin/env python3
"""claims_check — keyless "what can I claim?" for a wallet, across chains.

Self-sustaining: Merkl v4 user-rewards API (keyless) — returns every incentive the wallet has
accrued, with token symbol/decimals/USD price and claimed-so-far, so we can compute the UNCLAIMED
balance. No API key, no AEX backend. The agent relays the actionable ones; it never claims for you.

Usage:
  claims_check.py --wallets 0xa,0xb --chains 1,8453,42161,10 [--min-usd 0.50]

Always exits 0; parse the JSON on stdout.
"""
import argparse
import json
import urllib.request

TIMEOUT = 20
UA = {"User-Agent": "aex-gas-claims-reminder", "Accept": "application/json"}


def _get(url):
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=TIMEOUT) as r:
            return json.loads(r.read().decode())
    except Exception:
        return None


def merkl_rewards(wallet, chain):
    return _get(f"https://api.merkl.xyz/v4/users/{wallet}/rewards?chainId={chain}") or []


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--wallets", required=True, help="comma-separated addresses to check")
    ap.add_argument("--chains", default="1,8453,42161,10")
    ap.add_argument("--min-usd", type=float, default=0.50, help="ignore claimables below this USD value (dust)")
    a = ap.parse_args()
    chains = [int(c) for c in a.chains.split(",") if c.strip()]
    wallets = [w.strip() for w in a.wallets.split(",") if w.strip()]

    claimables, total_usd = [], 0.0
    for wallet in wallets:
        for chain in chains:
            for entry in merkl_rewards(wallet, chain):
                cname = ((entry.get("chain") or {}).get("name")) or str(chain)
                for rw in entry.get("rewards", []) or []:
                    tok = rw.get("token") or {}
                    dec = int(tok.get("decimals") or 18)
                    try:
                        amount = int(rw.get("amount") or 0)
                        claimed = int(rw.get("claimed") or 0)
                    except Exception:
                        continue
                    unclaimed_raw = amount - claimed
                    if unclaimed_raw <= 0:
                        continue
                    human = unclaimed_raw / (10 ** dec)
                    price = float(tok.get("price") or 0) or 0.0
                    usd = human * price
                    if usd < a.min_usd:
                        continue
                    total_usd += usd
                    claimables.append({
                        "wallet": wallet,
                        "chain": chain,
                        "chain_name": cname,
                        "source": "Merkl",
                        "token": tok.get("symbol") or "?",
                        "token_address": tok.get("address"),
                        "amount": round(human, 6),
                        "usd": round(usd, 2),
                        "claim_at": "app.merkl.xyz",  # claim is a user action; agent never claims
                    })

    claimables.sort(key=lambda c: -c["usd"])
    print(json.dumps({
        "wallets": wallets,
        "chains": chains,
        "source": "merkl-v4",
        "claimable_count": len(claimables),
        "total_usd": round(total_usd, 2),
        "claimables": claimables,
        "note": "Read-only: surfaces claimable rewards (Merkl). The owner claims at app.merkl.xyz; "
                "the agent never claims for them. LP fees / protocol airdrops need per-protocol checks.",
    }, indent=2))


if __name__ == "__main__":
    main()
