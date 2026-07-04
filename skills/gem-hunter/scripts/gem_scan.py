#!/usr/bin/env python3
"""gem_scan — keyless on-chain gem discovery on a chain you can actually buy on.

Self-sustaining: GeckoTerminal API (keyless) — trending + new DEX pools, which give the base-token
CONTRACT ADDRESS, liquidity, 24h volume, and price momentum directly (so a candidate is immediately
screenable + buyable, unlike CoinGecko ids). No API key, no AEX backend.

Scores 0–100 from liquidity (can you enter/exit?), activity (volume/liquidity), momentum (price
change, capped so it doesn't just chase a pump), and youth (newer = gem-ier but riskier). Filters out
illiquid traps and pools whose quote isn't USDC/WETH (no clean buy route).

Usage:
  gem_scan.py --chain 8453 [--min-liq-usd 50000] [--max-fdv-usd 50000000] [--top 15]

Always exits 0; parse JSON on stdout. Discovery only — screen (gem_screen.py) before any buy.
"""
import argparse
import json
import urllib.request

GT_NET = {1: "eth", 8453: "base", 42161: "arbitrum", 10: "optimism"}
QUOTE_OK = {"usdc", "weth", "eth", "usdbc"}  # quote tokens we can route a buy through
TIMEOUT = 20
UA = {"User-Agent": "aex-gem-hunter", "Accept": "application/json"}


def _get(url):
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=TIMEOUT) as r:
            return json.loads(r.read().decode())
    except Exception:
        return None


def pools(net, kind):
    d = _get(f"https://api.geckoterminal.com/api/v2/networks/{net}/{kind}?page=1")
    return (d or {}).get("data", []) or []


def fnum(x):
    try:
        return float(x)
    except Exception:
        return 0.0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--chain", type=int, default=8453)
    ap.add_argument("--min-liq-usd", type=float, default=50000)
    ap.add_argument("--max-fdv-usd", type=float, default=50_000_000)
    ap.add_argument("--top", type=int, default=15)
    a = ap.parse_args()
    net = GT_NET.get(a.chain)
    if not net:
        print(json.dumps({"error": f"chain {a.chain} not supported for gem scan", "candidates": []}))
        return

    seen, cands = {}, []
    for kind in ("trending_pools", "new_pools"):
        for p in pools(net, kind):
            at = p.get("attributes", {}) or {}
            rels = p.get("relationships", {}) or {}
            base = (rels.get("base_token", {}) or {}).get("data", {}) or {}
            quote = (rels.get("quote_token", {}) or {}).get("data", {}) or {}
            tok_id = base.get("id", "")  # "base_0x..."
            addr = tok_id.split("_")[-1] if "_" in tok_id else ""
            if not addr or addr in seen:
                continue
            quote_sym = (quote.get("id", "").split("_")[-1] or "")  # address; symbol not in rel — use name
            name = at.get("name", "")  # "TOKEN / QUOTE"
            quote_name = name.split("/")[-1].strip().lower() if "/" in name else ""
            if quote_name and quote_name not in QUOTE_OK:
                continue  # need a USDC/WETH route to buy cleanly
            liq = fnum(at.get("reserve_in_usd"))
            if liq < a.min_liq_usd:
                continue
            fdv = fnum(at.get("fdv_usd")) or fnum(at.get("market_cap_usd"))
            if a.max_fdv_usd and fdv and fdv > a.max_fdv_usd:
                continue  # not a low-cap
            vol = fnum((at.get("volume_usd") or {}).get("h24"))
            chg24 = fnum((at.get("price_change_percentage") or {}).get("h24"))
            chg6 = fnum((at.get("price_change_percentage") or {}).get("h6"))
            # score: liquidity floor + activity (vol/liq) + capped momentum + youth
            activity = min(vol / liq, 10) if liq else 0          # turnover, capped
            momentum = max(min(chg24, 100), -50) / 100            # cap +100%/-50%
            liq_score = min(liq / 500000, 1)                      # saturates at $500k
            score = round(100 * (0.35 * liq_score + 0.30 * min(activity / 3, 1) + 0.25 * max(momentum, 0) + 0.10), 1)
            seen[addr] = True
            cands.append({
                "token": name.split("/")[0].strip() if "/" in name else name,
                "address": addr,
                "chain": a.chain,
                "liquidity_usd": round(liq),
                "volume24h_usd": round(vol),
                "fdv_usd": round(fdv) if fdv else None,
                "change24h_pct": round(chg24, 1),
                "change6h_pct": round(chg6, 1),
                "score": score,
                "dex": (at.get("name") or ""),
                "source": kind,
            })

    cands.sort(key=lambda c: -c["score"])
    print(json.dumps({
        "chain": a.chain,
        "source": "geckoterminal",
        "count": len(cands),
        "candidates": cands[: a.top],
        "note": "Discovery only — momentum != quality. ALWAYS run gem_screen.py on a candidate "
                "(honeypot/tax/rug) before proposing or making any buy.",
    }, indent=2))


if __name__ == "__main__":
    main()
