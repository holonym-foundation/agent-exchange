#!/usr/bin/env python3
"""gem_screen — keyless "is this gem safe to BUY?" gate. MUST pass before any buy.

Self-sustaining: GoPlus token_security (keyless) + Honeypot.is live buy/sell sim (keyless). A gem
hunter that buys a honeypot is a disaster, so this is conservative: any hard signal => no-go.

Verdict:
  no-go   — honeypot / cannot sell / sell tax too high / blacklistable / sanctioned-style flags
  caution — mintable / upgradeable owner powers / unverified / moderate tax (buy only with eyes open)
  go      — clean

Usage:
  gem_screen.py --chain 8453 --token 0xGem [--max-tax 0.10]

Always exits 0; parse JSON on stdout.
"""
import argparse
import json
import urllib.request

TIMEOUT = 15
UA = {"User-Agent": "aex-gem-hunter", "Accept": "application/json"}


def _get(url):
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=TIMEOUT) as r:
            return json.loads(r.read().decode())
    except Exception:
        return None


def truthy(v):
    return str(v) in ("1", "true", "True")


def fnum(x):
    try:
        return float(x)
    except Exception:
        return 0.0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--chain", type=int, required=True)
    ap.add_argument("--token", required=True)
    ap.add_argument("--max-tax", type=float, default=0.10)
    a = ap.parse_args()
    t = a.token.lower()
    nogo, caution, checks = [], [], {}

    gp = _get(f"https://api.gopluslabs.io/api/v1/token_security/{a.chain}?contract_addresses={t}")
    tok = ((gp or {}).get("result") or {}).get(t) or {}
    if tok:
        checks["goplus"] = {k: tok.get(k) for k in (
            "is_honeypot", "cannot_sell_all", "buy_tax", "sell_tax", "is_open_source", "is_mintable",
            "transfer_pausable", "can_take_back_ownership", "hidden_owner", "owner_change_balance",
            "is_blacklisted", "is_anti_whale", "trading_cooldown", "is_in_dex")}
        if truthy(tok.get("is_honeypot")) or truthy(tok.get("cannot_sell_all")):
            nogo.append("honeypot / cannot sell all")
        if truthy(tok.get("is_blacklisted")):
            nogo.append("blacklist function present")
        if str(tok.get("is_in_dex")) == "0":
            caution.append("not in a known DEX (thin/!routable)")
        st, bt = fnum(tok.get("sell_tax")), fnum(tok.get("buy_tax"))
        if st > a.max_tax or bt > a.max_tax:
            nogo.append(f"tax too high (buy {bt:.0%} / sell {st:.0%} > {a.max_tax:.0%})")
        elif st > 0.03 or bt > 0.03:
            caution.append(f"nonzero tax (buy {bt:.0%} / sell {st:.0%})")
        for k, msg in (("can_take_back_ownership", "owner can reclaim"), ("hidden_owner", "hidden owner"),
                       ("owner_change_balance", "owner can edit balances"), ("is_mintable", "mintable"),
                       ("transfer_pausable", "transfers pausable"), ("trading_cooldown", "trading cooldown")):
            if truthy(tok.get(k)):
                caution.append(msg)
        if str(tok.get("is_open_source")) == "0":
            caution.append("unverified source")
    else:
        caution.append("no GoPlus data (unindexed/very new — extra risky)")

    hp = _get(f"https://api.honeypot.is/v2/IsHoneypot?address={t}&chainID={a.chain}")
    if isinstance(hp, dict):
        hres = hp.get("honeypotResult") or {}
        sim = hp.get("simulationResult") or {}
        checks["honeypot_is"] = {"isHoneypot": hres.get("isHoneypot"),
                                 "buyTax": sim.get("buyTax"), "sellTax": sim.get("sellTax"),
                                 "risk": (hp.get("summary") or {}).get("risk")}
        if hres.get("isHoneypot"):
            nogo.append("honeypot.is: honeypot")
        if fnum(sim.get("sellTax")) / 100 > a.max_tax:
            nogo.append(f"honeypot.is sell tax {fnum(sim.get('sellTax')):.0f}% > {a.max_tax:.0%}")

    verdict = "no-go" if nogo else ("caution" if caution else "go")
    print(json.dumps({
        "token": a.token, "chain": a.chain, "verdict": verdict,
        "no_go": nogo, "caution": caution, "checks": checks,
        "note": "Conservative gate. Only 'go' (and an eyes-open 'caution') may be bought; 'no-go' is "
                "never bought. A gem with no data is treated as caution, not go.",
    }, indent=2))


if __name__ == "__main__":
    main()
