#!/usr/bin/env python3
"""claim-watch — keyless on-chain check for whether an airdrop claim has gone LIVE.

Self-sustaining: public RPC endpoints + the public Merkl API only — no API keys and no AEX
backend, so the agent does this entirely from its own container. The agent runs this during its
Claim-watch phase for each opportunity it has farmed (it tracks the distributor address + chain in
its OWN memory). It reads the JSON on stdout to decide: claim via waap-cli, or notify the owner.

Signals (any one ⇒ live):
  * distributor_deployed  — the claim/merkle-distributor contract now has bytecode (eth_getCode)
  * merkle_root_set       — a no-arg root getter (e.g. merkleRoot()) returns non-zero (pass its selector)
  * merkl_claimable       — the public Merkl API reports a claimable reward for the wallet
  * allocation_live       — a project allocation-checker URL returns data for the wallet

Usage:
  claim_check.py --chain 8453 --distributor 0x... --wallet 0xYou... \
     [--merkle-selector 0x...] [--alloc-url 'https://proj/api/eligibility?address={wallet}']

Always exits 0 (it's a probe) — parse the JSON on stdout.
"""
import argparse
import json
import urllib.request

# Keyless public RPCs (PublicNode primary, a second as fallback). No keys, no AEX infra.
RPCS = {
    1: ["https://ethereum-rpc.publicnode.com", "https://eth.llamarpc.com"],
    8453: ["https://base-rpc.publicnode.com", "https://base.llamarpc.com"],
    84532: ["https://base-sepolia-rpc.publicnode.com", "https://sepolia.base.org"],
    42161: ["https://arbitrum-one-rpc.publicnode.com", "https://arb1.arbitrum.io/rpc"],
    10: ["https://optimism-rpc.publicnode.com", "https://mainnet.optimism.io"],
}
TIMEOUT = 12


def _post(url, payload):
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json", "User-Agent": "aex-claim-watch"},
    )
    with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
        return json.loads(r.read().decode())


def rpc(chain, method, params):
    for url in RPCS.get(chain, []):
        try:
            j = _post(url, {"jsonrpc": "2.0", "id": 1, "method": method, "params": params})
            if isinstance(j, dict) and j.get("result") is not None:
                return j["result"]
        except Exception:
            continue
    return None


def _get(url):
    try:
        req = urllib.request.Request(
            url, headers={"Accept": "application/json", "User-Agent": "aex-claim-watch"}
        )
        with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
            return json.loads(r.read().decode())
    except Exception:
        return None


def is_deployed(chain, addr):
    code = rpc(chain, "eth_getCode", [addr, "latest"])
    return bool(code) and code not in ("0x", "0x0")


def root_set(chain, to, selector):
    # eth_call a no-arg root getter (e.g. merkleRoot()); True if the 32-byte word is non-zero.
    res = rpc(chain, "eth_call", [{"to": to, "data": selector}, "latest"])
    if not res or res == "0x":
        return False
    h = res[2:] if res.startswith("0x") else res
    return any(c not in "0" for c in h)


def merkl_claimable(chain, wallet):
    # Public Merkl API (keyless). Defensive about response shape — just surface positive claimables.
    out = []
    j = _get("https://api.merkl.xyz/v4/users/%s/rewards?chainId=%d" % (wallet, chain))
    rows = j if isinstance(j, list) else (j.get("rewards") if isinstance(j, dict) else []) or []
    for r in rows if isinstance(rows, list) else []:
        try:
            amt = r.get("amount") or r.get("claimable") or "0"
            tok = (r.get("token") or {}).get("symbol") or r.get("symbol") or "?"
            val = int(amt) if str(amt).isdigit() else 0
            if val > 0:
                out.append({"token": tok, "amount": str(val)})
        except Exception:
            continue
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--chain", type=int, required=True)
    ap.add_argument("--distributor")
    ap.add_argument("--wallet")
    ap.add_argument("--merkle-selector", help="4-byte selector of a no-arg root getter, e.g. merkleRoot()")
    ap.add_argument("--alloc-url", help="allocation-checker URL; {wallet} is substituted")
    a = ap.parse_args()

    signals = {}
    if a.distributor:
        signals["distributor_deployed"] = is_deployed(a.chain, a.distributor)
        if a.merkle_selector:
            signals["merkle_root_set"] = root_set(a.chain, a.distributor, a.merkle_selector)
    claimable = merkl_claimable(a.chain, a.wallet) if a.wallet else []
    if a.wallet:
        signals["merkl_claimable"] = len(claimable) > 0
    if a.alloc_url and a.wallet:
        signals["allocation_live"] = bool(_get(a.alloc_url.replace("{wallet}", a.wallet)))

    live = any(bool(v) for v in signals.values())
    print(json.dumps({"live": live, "chain": a.chain, "signals": signals, "claimable": claimable}, indent=2))


if __name__ == "__main__":
    main()
