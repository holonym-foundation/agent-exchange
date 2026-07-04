#!/usr/bin/env python3
"""linkability_scan — the Sybil-clustering engine, inverted for the user.

Given the user's OWN wallets, find what links them to each other (so they can separate identities)
and each wallet's public footprint. Self-sustaining: ENS reverse via a keyless API, public RPC for
tx counts, and counterparty/funder graphs from Etherscan V2 (if ETHERSCAN_API_KEY is set) or a
keyless recent getLogs window as fallback. No AEX backend.

Per wallet: ENS name (a public handle deanonymizes you), tx count, first funder, counterparties.
Per pair: direct_transfer (definitive link), shared_funder (strong), shared_counterparties (medium).
Each link comes with the concrete step to break it. Read-only — it analyzes, never moves funds.

Usage:
  linkability_scan.py --wallets 0xa,0xb,0xc --chain 1 [--lookback-blocks 9000]

Always exits 0; parse JSON on stdout.
"""
import argparse
import itertools
import json
import os
import time
import urllib.request

RPCS = {
    1: ["https://eth.drpc.org", "https://ethereum-rpc.publicnode.com"],
    8453: ["https://base.drpc.org", "https://base-rpc.publicnode.com"],
    42161: ["https://arbitrum.drpc.org", "https://arbitrum-one-rpc.publicnode.com"],
    10: ["https://optimism.drpc.org", "https://optimism-rpc.publicnode.com"],
}
TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"
TIMEOUT = 20
MAX_RANGE = 9000
UA = {"User-Agent": "aex-privacy-guard", "Accept": "application/json"}
# Ultra-common infra — sharing these tells us nothing, so exclude from "shared counterparty".
INFRA = {a.lower() for a in [
    "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",  # USDC eth
    "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",  # USDC base
    "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",  # WETH eth
    "0x4200000000000000000000000000000000000006",  # WETH base/op
    "0xdac17f958d2ee523a2206206994597c13d831ec7",  # USDT
    "0x000000000022d473030f116ddee9f6b43ac78ba3",  # Permit2
    "0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45",  # UniversalRouter eth
    "0x2626664c2603336e57b271c5c0b26f421741e481",  # SwapRouter02 base
]}


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
                headers={"Content-Type": "application/json", "User-Agent": "aex-privacy-guard"},
            )
            with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
                j = json.loads(r.read().decode())
            if isinstance(j, dict) and j.get("result") is not None:
                return j["result"]
        except Exception:
            continue
    return None


def ens_name(addr):
    j = _get(f"https://api.ensideas.com/ens/resolve/{addr}")
    return (j or {}).get("name") if isinstance(j, dict) else None


def topic_addr(a):
    return "0x" + a.lower().replace("0x", "").rjust(64, "0")


def addr_from_topic(t):
    return "0x" + t[-40:].lower()


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


def etherscan(chain, action, addr, key, extra=""):
    url = f"https://api.etherscan.io/v2/api?chainid={chain}&module=account&action={action}&address={addr}&startblock=0&endblock=99999999&sort=asc&apikey={key}{extra}"
    j = _get(url)
    return j.get("result", []) if isinstance(j, dict) and str(j.get("status")) == "1" else []


def profile(chain, wallet, lookback, key):
    """counterparties set, first_funder, source label."""
    w = wallet.lower()
    counterparties, first_funder = set(), None
    if key:
        txs = etherscan(chain, "txlist", w, key) + etherscan(chain, "tokentx", w, key)
        txs.sort(key=lambda t: int(t.get("timeStamp") or 0))
        for t in txs:
            frm, to = (t.get("from") or "").lower(), (t.get("to") or "").lower()
            other = to if frm == w else frm
            if other and other != w:
                counterparties.add(other)
            if first_funder is None and to == w and frm and frm != w:
                first_funder = frm  # earliest inbound = funder
        source = "etherscan-full-history"
    else:
        tip = int(rpc(chain, "eth_blockNumber", []) or "0x0", 16)
        frm_b = max(0, tip - lookback)
        for lg in get_logs_chunked(chain, frm_b, tip, [TRANSFER, topic_addr(w)]):
            counterparties.add(addr_from_topic(lg["topics"][2])) if len(lg.get("topics", [])) >= 3 else None
        for lg in get_logs_chunked(chain, frm_b, tip, [TRANSFER, None, topic_addr(w)]):
            if len(lg.get("topics", [])) >= 3:
                counterparties.add(addr_from_topic(lg["topics"][1]))
        counterparties.discard(w)
        source = "keyless-recent-window"
    return {
        "counterparties": counterparties,
        "first_funder": first_funder,
        "source": source,
        "ens": ens_name(wallet),
        "tx_count": int(rpc(chain, "eth_getTransactionCount", [wallet, "latest"]) or "0x0", 16),
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--wallets", required=True, help="the user's own wallets, comma-separated")
    ap.add_argument("--chain", type=int, default=1)
    ap.add_argument("--lookback-blocks", type=int, default=9000)
    a = ap.parse_args()
    wallets = [w.strip().lower() for w in a.wallets.split(",") if w.strip()]
    key = os.environ.get("ETHERSCAN_API_KEY", "").strip()

    profs = {w: profile(a.chain, w, a.lookback_blocks, key) for w in wallets}
    wset = set(wallets)

    # privacy score per wallet — 0 (fully exposed) .. 100 (well-isolated), Passport-style with factors.
    # max link strength to ANY of the owner's other wallets (computed after links below) is folded in.
    def score_wallet(w):
        p = profs[w]
        score, factors = 100, []
        if p["ens"]:
            score -= 25
            factors.append({"factor": "public ENS name", "delta": -25, "fix": f"don't use ENS ('{p['ens']}') on a wallet you want private"})
        cps = len(p["counterparties"]) - len({c for c in p["counterparties"]} & INFRA)
        if cps > 50:
            score -= 10
            factors.append({"factor": "large public counterparty graph", "delta": -10, "fix": "spread activity across identities; reuse fewer niche dapps"})
        elif cps > 15:
            score -= 5
            factors.append({"factor": "moderate counterparty graph", "delta": -5, "fix": "vary your dapp set"})
        return score, factors, cps

    footprint = []
    for w in wallets:
        p = profs[w]
        sc, factors, cps = score_wallet(w)
        flags = []
        if p["ens"]:
            flags.append(f"public ENS name '{p['ens']}' — a handle that deanonymizes this wallet")
        footprint.append({"wallet": w, "ens": p["ens"], "tx_count": p["tx_count"],
                          "counterparties_seen": len(p["counterparties"]), "first_funder": p["first_funder"],
                          "source": p["source"], "exposure_flags": flags,
                          "privacy_score": sc, "score_factors": factors})

    links = []
    for x, y in itertools.combinations(wallets, 2):
        px, py = profs[x], profs[y]
        signals, advice, strength = [], [], "low"
        # 1) direct transfer between the two (definitive)
        if y in px["counterparties"] or x in py["counterparties"]:
            signals.append("direct_transfer")
            advice.append("These two wallets have transacted directly — the strongest possible link. Never move funds between identities you want separate; if you must, route through an intermediary you never reuse.")
            strength = "high"
        # 2) shared funder (strong)
        if px["first_funder"] and px["first_funder"] == py["first_funder"]:
            signals.append("shared_funder")
            advice.append(f"Both wallets were first funded by {px['first_funder']} — fund separate identities from separate, unlinked sources (different CEX accounts / fresh wallets).")
            strength = "high"
        # 3) shared counterparties (medium) — excluding common infra + the user's own wallets
        shared = (px["counterparties"] & py["counterparties"]) - INFRA - wset
        if len(shared) >= 3:
            signals.append("shared_counterparties")
            advice.append(f"Both interact with {len(shared)} of the same addresses/contracts (e.g. {list(shared)[:3]}) — vary your dapp set; reused niche counterparties cluster you.")
            strength = "high" if strength == "high" else "medium"
        if signals:
            links.append({"wallet_a": x, "wallet_b": y, "strength": strength,
                          "signals": signals, "shared_counterparty_count": len(shared), "how_to_break": advice})

    links.sort(key=lambda l: {"high": 0, "medium": 1, "low": 2}.get(l["strength"], 3))

    # fold linkage into each wallet's privacy score (being linked to another identity is the worst hit)
    LINK_PENALTY = {"high": 30, "medium": 15, "low": 5}
    by_wallet = {f["wallet"]: f for f in footprint}
    for w in wallets:
        worst = None
        for l in links:
            if w in (l["wallet_a"], l["wallet_b"]):
                worst = l["strength"] if worst is None else (l["strength"] if LINK_PENALTY[l["strength"]] > LINK_PENALTY[worst] else worst)
        if worst:
            pen = LINK_PENALTY[worst]
            by_wallet[w]["privacy_score"] = max(0, by_wallet[w]["privacy_score"] - pen)
            by_wallet[w]["score_factors"].append({"factor": f"linked to another of your wallets ({worst})", "delta": -pen, "fix": "break the link (see links[]) or move funds to a fresh, separately-funded identity"})
    overall = round(sum(f["privacy_score"] for f in footprint) / len(footprint)) if footprint else None

    print(json.dumps({
        "wallets": wallets, "chain": a.chain,
        "data_source": "etherscan-full-history" if key else "keyless-recent-window (set ETHERSCAN_API_KEY for full history)",
        "privacy_score": overall,
        "score_legend": "0 = fully exposed/clustered, 100 = well-isolated. Per-wallet scores + factors in footprint[].",
        "footprint": footprint,
        "linked_pairs": len(links),
        "links": links,
        "note": "Read-only. Links across YOUR wallets you'd rather keep separate. Strongest deanonymizers "
                "first. The keyless mode sees a recent window only; a key gives full history (funders + all counterparties).",
    }, indent=2))


if __name__ == "__main__":
    main()
