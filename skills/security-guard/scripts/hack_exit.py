#!/usr/bin/env python3
"""hack_exit — keyless "is a protocol I'm exposed to getting hacked, and how do I get out?"

Two modes, both self-sustaining (DefiLlama /hacks + /protocols, GoPlus, public RPC — no key,
no AEX backend):

  --mode alerts                       list recent DefiLlama hacks (the agent relays NEW ones to
                                      Telegram immediately). "simple alerts on hacks."
  --mode exposure --wallet 0x..       cross-reference recent hacks against the wallet's live
                                      approvals + the hacked protocol's contracts/token, and emit
                                      an EXIT PLAN: revoke calldata for any approval to a hacked
                                      contract + a human-gated sweep note to SAFE_EXIT_ADDRESS.

This script NEVER moves funds. It emits a plan the agent relays; the actual revoke/sweep stays
human-gated (waap-cli), capped, and only ever to the pre-approved SAFE_EXIT_ADDRESS via a private
relay (Flashbots Protect / MEV Blocker) so a rescue tx can't be front-run.

Usage:
  hack_exit.py --mode alerts [--days 7]
  hack_exit.py --mode exposure --wallet 0xYou --chain 1 [--days 30] [--safe-exit 0xSafe]

Always exits 0; parse the JSON on stdout.
"""
import argparse
import json
import re
import urllib.request

RPCS = {
    1: ["https://ethereum-rpc.publicnode.com", "https://eth.llamarpc.com"],
    8453: ["https://base-rpc.publicnode.com", "https://base.llamarpc.com"],
    84532: ["https://base-sepolia-rpc.publicnode.com", "https://sepolia.base.org"],
    42161: ["https://arbitrum-one-rpc.publicnode.com", "https://arb1.arbitrum.io/rpc"],
    10: ["https://optimism-rpc.publicnode.com", "https://mainnet.optimism.io"],
}
# DefiLlama chain name -> our numeric chain id (for filtering hacks by the wallet's chain).
CHAIN_NAMES = {1: "Ethereum", 8453: "Base", 84532: "Base", 42161: "Arbitrum", 10: "Optimism"}
TIMEOUT = 20
UA = {"User-Agent": "aex-security-guard", "Accept": "application/json"}
MAXUINT = (1 << 256) - 1
DAY = 86400


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


def now_ts():
    # Keyless clock without importing time-at-callsite cruft: the latest block's timestamp.
    blk = rpc(1, "eth_getBlockByNumber", ["latest", False]) or {}
    try:
        return int(blk.get("timestamp", "0x0"), 16)
    except Exception:
        return 0


def recent_hacks(days, chain=None):
    """DefiLlama hacks within `days`. Optionally filter to the wallet's chain."""
    data = _get("https://api.llama.fi/hacks") or _get("https://defillama-datasets.llama.fi/hacks/hacks.json")
    rows = data if isinstance(data, list) else (data or {}).get("data") or []
    cutoff = now_ts() - days * DAY
    want_chain = CHAIN_NAMES.get(chain)
    out = []
    for h in rows:
        if not isinstance(h, dict):
            continue
        ts = h.get("date") or h.get("timestamp") or 0
        try:
            ts = int(ts)
        except Exception:
            continue
        if ts < cutoff:
            continue
        chains = h.get("chains") or h.get("chain") or []
        chains = chains if isinstance(chains, list) else [chains]
        if want_chain and chains and want_chain not in chains:
            continue
        out.append({
            "name": h.get("name") or h.get("project") or "?",
            "date": ts,
            "amount_usd": h.get("amount") or h.get("amountLost"),
            "classification": h.get("classification") or h.get("technique"),
            "chains": chains,
            "source": h.get("source") or h.get("link"),
        })
    out.sort(key=lambda x: -(x.get("date") or 0))
    return out


def protocol_index():
    """name/slug/symbol -> {address, symbol, chains} from DefiLlama protocols (keyless)."""
    protos = _get("https://api.llama.fi/protocols") or []
    idx = {}
    for p in protos if isinstance(protos, list) else []:
        if not isinstance(p, dict):
            continue
        addr = p.get("address")
        # DefiLlama addresses look like "chain:0x..." or "0x..." or null.
        if isinstance(addr, str) and ":" in addr:
            addr = addr.split(":")[-1]
        rec = {"address": (addr or "").lower() or None, "symbol": (p.get("symbol") or "").upper(), "name": p.get("name")}
        for key in filter(None, [p.get("name"), p.get("slug")]):
            idx[_norm(key)] = rec
    return idx


def _norm(s):
    return re.sub(r"[^a-z0-9]", "", str(s).lower())


def wallet_approvals(chain, wallet):
    gp = _get(f"https://api.gopluslabs.io/api/v2/token_approval_security/{chain}?addresses={wallet}")
    out = []
    for t in (gp or {}).get("result") or []:
        sym = (t.get("token_symbol") or t.get("token_name") or "").upper()
        taddr = (t.get("token_address") or t.get("nft_address") or "").lower()
        is_nft = bool(t.get("nft_symbol") or t.get("nft_name"))
        for ap_ in t.get("approved_list", []) or []:
            spender = (ap_.get("approved_contract") or ap_.get("address") or "").strip().lower()
            if spender:
                out.append({"token_symbol": sym, "token_address": taddr, "spender": spender, "is_nft": is_nft})
    return out


def revoke_calldata(spender, is_nft):
    s = spender.lower().replace("0x", "").rjust(64, "0")
    return ("0xa22cb465" + s + "0" * 64) if is_nft else ("0x095ea7b3" + s + "0" * 64)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--mode", choices=["alerts", "exposure"], default="alerts")
    ap.add_argument("--wallet")
    ap.add_argument("--chain", type=int, default=1)
    ap.add_argument("--days", type=int)
    ap.add_argument("--safe-exit", default="")
    a = ap.parse_args()

    if a.mode == "alerts":
        hacks = recent_hacks(a.days or 7)
        print(json.dumps({"mode": "alerts", "window_days": a.days or 7, "count": len(hacks), "hacks": hacks}, indent=2))
        return

    # exposure
    if not a.wallet:
        print(json.dumps({"error": "exposure mode needs --wallet"}))
        return
    hacks = recent_hacks(a.days or 30, a.chain)
    idx = protocol_index() if hacks else {}
    approvals = wallet_approvals(a.chain, a.wallet) if hacks else []
    appr_spenders = {ap_["spender"] for ap_ in approvals}
    appr_symbols = {ap_["token_symbol"] for ap_ in approvals if ap_["token_symbol"]}

    exposures = []
    for h in hacks:
        rec = idx.get(_norm(h["name"]))
        if not rec:
            continue
        signals, conf = [], "low"
        # 1) Active approval to the hacked protocol's contract — the actionable case (revoke!).
        hit = next((ap_ for ap_ in approvals if rec["address"] and ap_["spender"] == rec["address"]), None)
        if hit:
            signals.append("approval_to_hacked_contract")
            conf = "high"
        # 2) Holding / approving the hacked protocol's token (symbol match) — consider exiting.
        if rec["symbol"] and rec["symbol"] in appr_symbols:
            signals.append("holds_or_approves_hacked_token")
            conf = "high" if conf == "high" else "medium"
        if not signals:
            continue
        exposures.append({
            "protocol": h["name"],
            "hack_date": h["date"],
            "amount_usd": h["amount_usd"],
            "classification": h["classification"],
            "confidence": conf,
            "signals": signals,
            "revoke": ({"to": hit["token_address"], "data": revoke_calldata(hit["spender"], hit["is_nft"])} if hit else None),
        })

    plan = []
    if any(e["revoke"] for e in exposures):
        plan.append("REVOKE every approval to a hacked contract first (recommend; auto only if REVOKE_MODE=auto and high-confidence).")
    if exposures:
        dest = a.safe_exit or "{SAFE_EXIT_ADDRESS}"
        plan.append(f"If seed/key compromise is suspected, propose a HUMAN-GATED sweep to {dest} ONLY (never a new address), "
                    "via a private relay (Flashbots Protect / MEV Blocker) so the rescue tx isn't front-run.")
        plan.append("Always at least ALERT the owner on Telegram immediately. Never silently move funds.")

    print(json.dumps({
        "mode": "exposure",
        "wallet": a.wallet,
        "chain": a.chain,
        "window_days": a.days or 30,
        "hacks_considered": len(hacks),
        "exposed": len(exposures),
        "exposures": exposures,
        "exit_plan": plan,
        "note": "Exposure is matched keylessly by protocol name/symbol/contract and is best-effort — "
                "confirm before acting; the script moves nothing.",
    }, indent=2))


if __name__ == "__main__":
    main()
