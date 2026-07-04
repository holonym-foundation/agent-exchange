#!/usr/bin/env python3
"""contracts_walk — discover the apps / smart contracts a watched wallet actually interacts with,
so the guard can watchlist them (upgrade-watch + periodic audit) instead of guessing.

Self-sustaining / keyless by default:
  - approved spenders  (GoPlus token_approval_security — contracts the wallet granted allowance to)
  - token contracts    (from recent Transfer logs in/out, via drpc ranged getLogs)
Richer with a key (optional, no dependency): if ETHERSCAN_API_KEY is set, also pulls the wallet's
full tx list (Etherscan V2 multichain) and adds every contract it has sent a tx to ("interacted").

For each discovered contract it records is_contract + EIP-1967 implementation (so upgrade-watch can
flag a silent code swap). Emits a watchlist the agent stores in MEMORY and monitors per chain.

Usage:
  contracts_walk.py --chain 1 --wallet 0xYou [--lookback-blocks 9000]

Always exits 0; parse the JSON on stdout.
"""
import argparse
import json
import os
import time
import urllib.request

# drpc first for getLogs (keyless ranged; PublicNode rejects ranges). PublicNode for getCode/storage.
RPCS = {
    1: ["https://eth.drpc.org", "https://ethereum-rpc.publicnode.com"],
    8453: ["https://base.drpc.org", "https://base-rpc.publicnode.com"],
    84532: ["https://base-sepolia.drpc.org", "https://base-sepolia-rpc.publicnode.com"],
    42161: ["https://arbitrum.drpc.org", "https://arbitrum-one-rpc.publicnode.com"],
    10: ["https://optimism.drpc.org", "https://optimism-rpc.publicnode.com"],
}
TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"
EIP1967_IMPL = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc"
TIMEOUT = 20
MAX_RANGE = 9000
UA = {"User-Agent": "aex-security-guard", "Accept": "application/json"}


def _get(url):
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=TIMEOUT) as r:
            return json.loads(r.read().decode())
    except Exception:
        return None


def rpc(chain, method, params):
    for url in RPCS.get(chain, []):
        try:
            req = urllib.request.Request(
                url,
                data=json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode(),
                headers={"Content-Type": "application/json", "User-Agent": "aex-security-guard"},
            )
            with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
                j = json.loads(r.read().decode())
            if isinstance(j, dict) and ("result" in j):
                return j["result"]
        except Exception:
            continue
    return None


def topic_addr(a):
    return "0x" + a.lower().replace("0x", "").rjust(64, "0")


def get_logs_chunked(chain, frm, tip, topics):
    logs, lo = [], frm
    while lo <= tip:
        hi = min(lo + MAX_RANGE, tip)
        to = "latest" if hi >= tip else hex(hi)
        part = None
        for attempt in range(3):
            part = rpc(chain, "eth_getLogs", [{"fromBlock": hex(lo), "toBlock": to, "topics": topics}])
            if isinstance(part, list):
                break
            time.sleep(0.5 * (attempt + 1))
        if isinstance(part, list):
            logs.extend(part)
        lo = hi + 1
    return logs


def is_contract(chain, addr):
    code = rpc(chain, "eth_getCode", [addr, "latest"])
    return isinstance(code, str) and code not in ("0x", "0x0", None)


def impl_of(chain, addr):
    slot = rpc(chain, "eth_getStorageAt", [addr, EIP1967_IMPL, "latest"])
    if isinstance(slot, str) and slot != "0x" and any(c not in "x0" for c in slot):
        return "0x" + slot[-40:]
    return None


def approved_spenders(chain, wallet):
    gp = _get(f"https://api.gopluslabs.io/api/v2/token_approval_security/{chain}?addresses={wallet}")
    out = set()
    for t in (gp or {}).get("result") or []:
        for ap_ in t.get("approved_list", []) or []:
            s = (ap_.get("approved_contract") or ap_.get("address") or "").strip().lower()
            if s:
                out.add(s)
    return out


def token_contracts(chain, wallet, lookback):
    tip = int(rpc(chain, "eth_blockNumber", []) or "0x0", 16)
    frm = max(0, tip - lookback)
    toks = set()
    for topics in ([TRANSFER, topic_addr(wallet)], [TRANSFER, None, topic_addr(wallet)]):
        for lg in get_logs_chunked(chain, frm, tip, topics):
            a = (lg.get("address") or "").lower()
            if a:
                toks.add(a)
    return toks


def etherscan_interacted(chain, wallet, key):
    """Optional: every contract the wallet has sent a tx TO (Etherscan V2 multichain)."""
    url = f"https://api.etherscan.io/v2/api?chainid={chain}&module=account&action=txlist&address={wallet}&startblock=0&endblock=99999999&sort=desc&apikey={key}"
    j = _get(url)
    out = set()
    if isinstance(j, dict) and str(j.get("status")) == "1":
        for tx in j.get("result", [])[:2000]:
            to = (tx.get("to") or "").lower()
            # contractAddress set => this tx created a contract; 'to' empty for creations
            if to and tx.get("input", "0x") not in ("0x", ""):
                out.add(to)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--chain", type=int, required=True)
    ap.add_argument("--wallet", required=True)
    ap.add_argument("--lookback-blocks", type=int, default=9000)
    a = ap.parse_args()
    w = a.wallet.lower()

    spenders = approved_spenders(a.chain, w)
    tokens = token_contracts(a.chain, w, a.lookback_blocks)
    key = os.environ.get("ETHERSCAN_API_KEY", "").strip()
    interacted = etherscan_interacted(a.chain, w, key) if key else set()

    kinds = {}  # addr -> set of roles
    for s in spenders:
        kinds.setdefault(s, set()).add("spender")
    for t in tokens:
        kinds.setdefault(t, set()).add("token")
    for c in interacted:
        kinds.setdefault(c, set()).add("interacted")

    watchlist = []
    for addr in list(kinds)[:120]:  # cap RPC fan-out
        if not is_contract(a.chain, addr):
            continue
        impl = impl_of(a.chain, addr)
        watchlist.append({
            "address": addr,
            "roles": sorted(kinds[addr]),
            "upgradeable": bool(impl),
            "impl": impl,  # record so upgrade-watch can flag a silent change
        })

    print(json.dumps({
        "wallet": a.wallet,
        "chain": a.chain,
        "source": "goplus+rpc" + ("+etherscan" if key else " (keyless; set ETHERSCAN_API_KEY for full tx-history walk)"),
        "discovered": len(watchlist),
        "upgradeable": sum(1 for c in watchlist if c["upgradeable"]),
        "watchlist": watchlist,
        "note": "Store this per-chain in MEMORY as the contract watchlist; upgrade-watch each "
                "(re-read impl, alert on silent change) and audit_target the upgradeable/unverified ones.",
    }, indent=2))


if __name__ == "__main__":
    main()
