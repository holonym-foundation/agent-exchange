#!/usr/bin/env python3
"""approvals_scan — keyless audit of a wallet's live token approvals (the #1 drainer surface).

Self-sustaining: GoPlus (free/keyless, 30/min) enumerates approvals; public RPC adds the
upgrade-watch + live-allowance checks; the RevokeCash approval-exploit-list flags spenders tied to
known exploits. No API key, no AEX backend. The agent reads the JSON to alert + recommend (or, under
policy, build) revokes.

Risk flags per approval:
  unlimited            — allowance is the max-uint sentinel (spender can drain the whole balance)
  spender_upgradeable  — spender is an EIP-1967 proxy: its code can be swapped under you (sleeper risk)
  spender_eoa          — spender is an EOA (legit spenders are contracts) — red flag
  spender_exploited    — spender appears in RevokeCash/approval-exploit-list — REVOKE NOW
  goplus_risky         — GoPlus flagged the approved contract (malicious/risky)

Usage:
  approvals_scan.py --chain 1 --wallet 0xYou...

Always exits 0; parse the JSON on stdout.
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
TIMEOUT = 15
UA = {"User-Agent": "aex-security-guard", "Accept": "application/json"}
# EIP-1967 implementation slot — non-zero ⇒ spender is an upgradeable proxy.
EIP1967_IMPL = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc"
MAXUINT = (1 << 256) - 1


def _get(url, headers=UA):
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=TIMEOUT) as r:
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
            if isinstance(j, dict) and j.get("result") is not None:
                return j["result"]
        except Exception:
            continue
    return None


def is_eoa(chain, addr):
    code = rpc(chain, "eth_getCode", [addr, "latest"])
    return code in ("0x", "0x0", None)


def is_upgradeable(chain, addr):
    slot = rpc(chain, "eth_getStorageAt", [addr, EIP1967_IMPL, "latest"])
    return bool(slot) and slot != "0x" and any(c not in "x0" for c in slot)


def exploit_spenders(chain):
    """Set of (lowercased) spender addresses from RevokeCash/approval-exploit-list for this chain.
    Fetched concurrently (the agent should also cache this daily — see SKILL.md)."""
    from concurrent.futures import ThreadPoolExecutor

    out = set()
    idx = _get("https://raw.githubusercontent.com/RevokeCash/approval-exploit-list/main/index.json")
    slugs = idx if isinstance(idx, list) else (idx.get("exploits") if isinstance(idx, dict) else []) or []
    names = [s if isinstance(s, str) else (s.get("id") or s.get("slug")) for s in (slugs if isinstance(slugs, list) else [])]
    names = [n for n in names if n][:150]

    def fetch(name):
        return _get(f"https://raw.githubusercontent.com/RevokeCash/approval-exploit-list/main/exploits/{name}.json")

    with ThreadPoolExecutor(max_workers=12) as ex:
        for e in ex.map(fetch, names):
            for a in (e or {}).get("addresses", []) if isinstance(e, dict) else []:
                if isinstance(a, dict) and (a.get("chainId") in (chain, None)) and a.get("address"):
                    out.add(a["address"].lower())
    return out


def revoke_calldata(spender, is_nft):
    s = spender.lower().replace("0x", "").rjust(64, "0")
    if is_nft:  # setApprovalForAll(operator,false)
        return "0xa22cb465" + s + "0" * 64
    return "0x095ea7b3" + s + "0" * 64  # approve(spender,0)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--chain", type=int, required=True)
    ap.add_argument("--wallet", required=True)
    a = ap.parse_args()

    gp = _get(f"https://api.gopluslabs.io/api/v2/token_approval_security/{a.chain}?addresses={a.wallet}")
    tokens = (gp or {}).get("result") or []
    exploited = exploit_spenders(a.chain) if tokens else set()

    findings = []
    for t in tokens if isinstance(tokens, list) else []:
        sym = t.get("token_symbol") or t.get("token_name") or "?"
        is_nft = bool(t.get("nft_symbol") or t.get("nft_name")) or t.get("chain_id") is None and t.get("nft_address")
        for ap_ in t.get("approved_list", []) or []:
            spender = (ap_.get("approved_contract") or ap_.get("address") or "").strip()
            if not spender:
                continue
            amt = str(ap_.get("approved_amount", ""))
            info = ap_.get("address_info") or {}
            unlimited = amt.lower() in ("unlimited", str(MAXUINT)) or amt.startswith("1.157920892")
            flags = []
            if unlimited:
                flags.append("unlimited")
            if spender.lower() in exploited:
                flags.append("spender_exploited")
            if str(info.get("is_contract", "1")) == "0" or is_eoa(a.chain, spender):
                flags.append("spender_eoa")
            if info.get("malicious_behavior") or str(info.get("trust_list", "")) == "0" and info.get("doubt_list"):
                flags.append("goplus_risky")
            if is_upgradeable(a.chain, spender):
                flags.append("spender_upgradeable")
            sev = "high" if {"spender_exploited", "spender_eoa"} & set(flags) else "medium" if flags else "low"
            if sev == "low" and unlimited:
                sev = "medium"
            findings.append({
                "token": sym,
                "spender": spender,
                "amount": amt or "?",
                "flags": flags,
                "severity": sev,
                "revoke": {"to": t.get("token_address") or t.get("nft_address"), "data": revoke_calldata(spender, bool(is_nft))},
            })

    order = {"high": 0, "medium": 1, "low": 2}
    findings.sort(key=lambda f: (order.get(f["severity"], 3), -len(f["flags"])))
    print(json.dumps({
        "wallet": a.wallet,
        "chain": a.chain,
        "source": "goplus+rpc" if gp else "unavailable",
        "total_approvals": len(findings),
        "risky": sum(1 for f in findings if f["flags"]),
        "findings": findings,
    }, indent=2))


if __name__ == "__main__":
    main()
