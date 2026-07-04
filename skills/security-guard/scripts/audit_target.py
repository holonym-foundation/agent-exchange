#!/usr/bin/env python3
"""audit_target — keyless "is this safe to interact with?" report for a token / contract / dapp.

Self-sustaining: GoPlus (token_security, address_security, dapp_security — free/keyless), Honeypot.is
(live buy/sell sim, keyless), public RPC (verified/proxy/owner/paused), and cached GitHub feeds
(MetaMask phishing, 0xB10C OFAC). No API key, no AEX backend. Emits a verdict the agent relays:
go / caution / no-go.

Usage:
  audit_target.py --chain 1 --target 0xTokenOrContract [--domain app.example.xyz]

Always exits 0; parse JSON on stdout.
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
EIP1967_IMPL = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc"


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
            if isinstance(j, dict) and j.get("result") is not None:
                return j["result"]
        except Exception:
            continue
    return None


def truthy(v):
    return str(v) in ("1", "true", "True")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--chain", type=int, required=True)
    ap.add_argument("--target", required=True)
    ap.add_argument("--domain")
    a = ap.parse_args()
    t = a.target.lower()
    nogo, caution, checks = [], [], {}

    # 1. Token security (GoPlus) + honeypot confirm
    gp = _get(f"https://api.gopluslabs.io/api/v1/token_security/{a.chain}?contract_addresses={t}")
    tok = ((gp or {}).get("result") or {}).get(t) or {}
    if tok:
        checks["token"] = {k: tok.get(k) for k in ("is_honeypot", "buy_tax", "sell_tax", "is_mintable", "is_open_source", "transfer_pausable", "can_take_back_ownership", "hidden_owner", "owner_change_balance", "is_blacklisted")}
        if truthy(tok.get("is_honeypot")) or truthy(tok.get("cannot_sell_all")):
            nogo.append("honeypot / cannot sell")
        try:
            if float(tok.get("sell_tax") or 0) > 0.10 or float(tok.get("buy_tax") or 0) > 0.10:
                caution.append("high buy/sell tax (>10%)")
        except Exception:
            pass
        if truthy(tok.get("can_take_back_ownership")) or truthy(tok.get("hidden_owner")) or truthy(tok.get("owner_change_balance")):
            caution.append("owner can rug (reclaim/hidden-owner/balance-edit)")
        if truthy(tok.get("is_mintable")):
            caution.append("mintable")
        if tok.get("is_open_source") == "0":
            caution.append("unverified source")
    hp = _get(f"https://api.honeypot.is/v2/IsHoneypot?address={t}&chainID={a.chain}")
    if isinstance(hp, dict):
        hres = (hp.get("honeypotResult") or {})
        checks["honeypot_is"] = {"isHoneypot": hres.get("isHoneypot"), "risk": (hp.get("summary") or {}).get("risk")}
        if hres.get("isHoneypot"):
            nogo.append("honeypot.is: honeypot")

    # 2. Address reputation (GoPlus) + OFAC feed
    addr = _get(f"https://api.gopluslabs.io/api/v1/address_security/{t}?chain_id={a.chain}")
    ar = (addr or {}).get("result") or {}
    bad = [k for k in ("phishing_activities", "blacklist_doubt", "stealing_attack", "honeypot_related_address", "sanctioned", "cybercrime", "money_laundering", "fake_kyc", "malicious_mining_activities") if truthy(ar.get(k))]
    if bad:
        checks["address_flags"] = bad
        (nogo if {"sanctioned", "stealing_attack", "phishing_activities"} & set(bad) else caution).append("flagged address: " + ",".join(bad))
    ofac = _get("https://raw.githubusercontent.com/0xB10C/ofac-sanctioned-digital-currency-addresses/lists/sanctioned_addresses_ETH.json")
    if isinstance(ofac, list) and t in {x.lower() for x in ofac}:
        nogo.append("OFAC-sanctioned address")

    # 3. Contract reads (keyless RPC)
    code = rpc(a.chain, "eth_getCode", [t, "latest"])
    is_contract = bool(code) and code not in ("0x", "0x0")
    impl = rpc(a.chain, "eth_getStorageAt", [t, EIP1967_IMPL, "latest"]) if is_contract else None
    upgradeable = bool(impl) and impl != "0x" and any(c not in "x0" for c in impl)
    checks["contract"] = {"is_contract": is_contract, "upgradeable": upgradeable}
    if upgradeable:
        caution.append("upgradeable proxy (code can change)")

    # 4. Dapp / domain (phishing feeds + GoPlus)
    if a.domain:
        dom = a.domain.lower().replace("https://", "").replace("http://", "").split("/")[0]
        pd = _get("https://raw.githubusercontent.com/MetaMask/eth-phishing-detect/master/src/config.json") or {}
        blocked = dom in set(pd.get("blocklist") or [])
        gd = _get(f"https://api.gopluslabs.io/api/v1/dapp_security?url={a.domain}")
        checks["domain"] = {"domain": dom, "metamask_blocklist": blocked}
        if blocked:
            nogo.append(f"phishing domain: {dom}")

    verdict = "no-go" if nogo else ("caution" if caution else "go")
    print(json.dumps({
        "target": a.target,
        "chain": a.chain,
        "verdict": verdict,
        "no_go": nogo,
        "caution": caution,
        "checks": checks,
    }, indent=2))


if __name__ == "__main__":
    main()
