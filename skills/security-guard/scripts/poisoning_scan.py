#!/usr/bin/env python3
"""poisoning_scan — keyless address-poisoning detector over a wallet's recent transfer history.

Address poisoning: an attacker generates a vanity address whose first/last hex chars match a
counterparty you really transact with, then sends you a zero-value or dust transfer so the lookalike
lands in your history — hoping you copy-paste it on your next send and lose the funds. This is the
#1 "you sent it to the wrong address" loss vector and on-chain scanners see it too late.

Self-sustaining: public RPC `eth_getLogs` only (stdlib, no key, no AEX backend). Emits warnings the
agent surfaces BEFORE any outbound send; it moves nothing.

Heuristics (per recent window):
  lookalike     — an INCOMING counterparty whose address matches a REAL (outgoing) recipient on the
                  first/last N hex chars but is NOT that address (classic poisoning)
  dust          — a near-zero / zero-value incoming transfer from a never-before-seen sender (bait)
  spoofed_token — two different token contracts share a symbol; the rarely-seen one is a likely fake

Usage:
  poisoning_scan.py --chain 1 --wallet 0xYou [--lookback-blocks 200000] [--match-chars 4]

Always exits 0; parse the JSON on stdout.
"""
import argparse
import json
import time
import urllib.request

# drpc first for getLogs: it serves ranged historical queries keyless (≤10k blocks/request);
# PublicNode rejects any non-"latest" getLogs range ("archive requires a personal token").
RPCS = {
    1: ["https://eth.drpc.org", "https://ethereum-rpc.publicnode.com"],
    8453: ["https://base.drpc.org", "https://base-rpc.publicnode.com"],
    84532: ["https://base-sepolia.drpc.org", "https://base-sepolia-rpc.publicnode.com"],
    42161: ["https://arbitrum.drpc.org", "https://arbitrum-one-rpc.publicnode.com"],
    10: ["https://optimism.drpc.org", "https://optimism-rpc.publicnode.com"],
}
TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"
TIMEOUT = 20
MAX_RANGE = 9000  # free-tier getLogs range cap (drpc rejects >10k)


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
            if isinstance(j, dict) and "result" in j:
                return j["result"]
        except Exception:
            continue
    return None


def topic_addr(a):
    return "0x" + a.lower().replace("0x", "").rjust(64, "0")


def addr_from_topic(t):
    return "0x" + t[-40:].lower()


def get_logs_chunked(chain, frm, tip, topics):
    """getLogs across [frm, tip] in <=MAX_RANGE windows. The chunk that reaches the tip uses
    toBlock="latest" — keyless drpc serves "latest" fast but 408-times-out on a specific recent
    block number. Intermediate (older) chunks use explicit blocks; on free RPCs those may be
    unavailable (returns nothing for that chunk rather than failing the scan)."""
    logs, lo = [], frm
    while lo <= tip:
        hi = min(lo + MAX_RANGE, tip)
        to = "latest" if hi >= tip else hex(hi)  # the tip-reaching chunk must use "latest" (drpc 408s on a specific recent block)
        part = None
        for attempt in range(4):  # keyless drpc rate-limits intermittently — retry with backoff
            part = rpc(chain, "eth_getLogs", [{"fromBlock": hex(lo), "toBlock": to, "topics": topics}])
            if isinstance(part, list):
                break
            time.sleep(0.6 * (attempt + 1))
        if isinstance(part, list):
            logs.extend(part)
        lo = hi + 1
    return logs


def eth_call(chain, to, data):
    return rpc(chain, "eth_call", [{"to": to, "data": data}, "latest"])


def token_symbol(chain, token):
    # symbol() = 0x95d89b41 ; tolerate both string and bytes32 returns.
    raw = eth_call(chain, token, "0x95d89b41")
    if not isinstance(raw, str) or len(raw) < 130:
        return None
    try:
        body = bytes.fromhex(raw[2:])
        return body[64:].split(b"\x00")[0].decode("utf-8", "ignore").strip() or None
    except Exception:
        return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--chain", type=int, required=True)
    ap.add_argument("--wallet", required=True)
    ap.add_argument("--lookback-blocks", type=int, default=9000,
                    help="recent window to scan (keyless RPCs cap ranges ~10k blocks; deeper history needs a keyed RPC)")
    ap.add_argument("--match-chars", type=int, default=4)
    a = ap.parse_args()
    w = a.wallet.lower()
    n = a.match_chars

    tip = int(rpc(a.chain, "eth_blockNumber", []) or "0x0", 16)
    frm = max(0, tip - a.lookback_blocks)
    out_logs = get_logs_chunked(a.chain, frm, tip, [TRANSFER, topic_addr(w)])         # from=wallet -> OUTGOING
    in_logs = get_logs_chunked(a.chain, frm, tip, [TRANSFER, None, topic_addr(w)])    # to=wallet   -> INCOMING

    real_recipients = set()   # addresses you actually sent to (the impersonation targets)
    for lg in out_logs:
        tp = lg.get("topics", [])
        if len(tp) >= 3:
            real_recipients.add(addr_from_topic(tp[2]))

    incoming = []             # (sender, token, value_is_zero)
    seen_senders = {}         # sender -> count, to spot never-seen dust origins
    token_symbols = {}        # token_addr -> symbol
    for lg in in_logs:
        tp = lg.get("topics", [])
        if len(tp) >= 3:
            sender = addr_from_topic(tp[1])
            val0 = int(lg.get("data", "0x0") or "0x0", 16) == 0
            incoming.append((sender, (lg.get("address") or "").lower(), val0))
            seen_senders[sender] = seen_senders.get(sender, 0) + 1

    warnings = []

    # 1) lookalike — incoming sender mimics a real recipient on first/last N chars
    real_keys = {r: (r[2:2 + n], r[-n:]) for r in real_recipients}
    flagged = set()
    for sender, _tok, _v0 in incoming:
        if sender in real_recipients or sender in flagged:
            continue
        sk = (sender[2:2 + n], sender[-n:])
        for real, rk in real_keys.items():
            if sk == rk and sender != real:
                warnings.append({
                    "kind": "lookalike",
                    "severity": "high",
                    "poison_address": sender,
                    "mimics_real_address": real,
                    "match": f"first{n}+last{n}",
                    "advice": "Do NOT copy-paste from history — verify the full address before sending.",
                })
                flagged.add(sender)
                break

    # 2) dust — zero-value incoming from a sender you've only ever received from (never sent to)
    for sender, _tok, v0 in incoming:
        if v0 and sender not in real_recipients and seen_senders.get(sender, 0) <= 2 and sender not in flagged:
            warnings.append({
                "kind": "dust",
                "severity": "medium",
                "poison_address": sender,
                "advice": "Zero-value bait from an unknown sender — ignore; don't reuse this address.",
            })
            flagged.add(sender)

    # 3) spoofed_token — two contracts sharing a symbol; flag the rarely-seen impostor
    tok_counts = {}
    for _s, tok, _v in incoming:
        if tok:
            tok_counts[tok] = tok_counts.get(tok, 0) + 1
    for tok in list(tok_counts)[:25]:  # cap RPC
        sym = token_symbol(a.chain, tok)
        if sym:
            token_symbols.setdefault(sym.upper(), []).append((tok, tok_counts[tok]))
    for sym, toks in token_symbols.items():
        if len(toks) > 1:
            toks.sort(key=lambda x: -x[1])
            for tok, cnt in toks[1:]:
                warnings.append({
                    "kind": "spoofed_token",
                    "severity": "medium",
                    "token": tok,
                    "symbol": sym,
                    "advice": f"Multiple contracts use symbol {sym}; this one is likely a fake impersonating the real token.",
                })

    order = {"high": 0, "medium": 1, "low": 2}
    warnings.sort(key=lambda x: order.get(x["severity"], 3))
    print(json.dumps({
        "wallet": a.wallet,
        "chain": a.chain,
        "scanned_blocks": [frm, tip],
        "outgoing_counterparties": len(real_recipients),
        "incoming_events": len(incoming),
        "warnings": warnings,
        "note": "Heuristic + best-effort over a recent window; warns before sends, moves nothing.",
    }, indent=2))


if __name__ == "__main__":
    main()
