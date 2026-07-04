#!/usr/bin/env python3
"""kb_refresh — weekly maintainer for the Security Guard's exploit KB.

Self-sustaining: pulls the latest incidents from DefiLlama /hacks (keyless), classifies each into
the taxonomy classes defined in kb/exploit-taxonomy.md, and emits JSON the agent MERGES into its
MEMORY under `kb_deltas`. Anything whose technique/classification does NOT map to a known class is
emitted under `unmapped` and flagged for human review (a possible NEW exploit class to add to the
seed taxonomy). No API key, no AEX backend.

The seed taxonomy ships in the image (read-only); live deltas live in MEMORY. At audit time the
agent reads BOTH. Run weekly (see activity.json schedule).

Usage:
  kb_refresh.py [--days 14]

Always exits 0; parse the JSON on stdout.
"""
import argparse
import json
import urllib.request

TIMEOUT = 20
UA = {"User-Agent": "aex-security-guard", "Accept": "application/json"}
DAY = 86400

# Known taxonomy classes (must match kb/exploit-taxonomy.md "Class index").
CLASSES = ["approval", "permit", "poisoning", "drainer", "fake-claim", "seed", "supply-chain",
           "blind-sign", "delegation-7702", "contract-bug", "bridge", "infra"]

# Keyword -> class. First match wins, in priority order. DefiLlama uses fields like
# classification/technique ("Compromised Private Keys", "Access Control", "Oracle issue",
# "Reentrancy", "Flash Loan Attack", "Phishing", "Rugpull", "Frontend Attack", etc.).
RULES = [
    ("seed", ["private key", "compromised key", "seed", "credential", "wallet compromise"]),
    ("infra", ["infrastructure", "insider", "exchange", "hot wallet", "server", "api key", "cloud"]),
    ("supply-chain", ["supply chain", "supply-chain", "npm", "dependency", "dns", "frontend", "front-end", "front end", "ui", "javascript", "injected"]),
    ("blind-sign", ["multisig", "multi-sig", "blind sign", "blind-sign", "delegatecall", "safe wallet", "signer"]),
    ("delegation-7702", ["7702", "delegation", "delegate", "sweeper"]),
    ("bridge", ["bridge", "cross-chain", "cross chain", "layerzero", "validator", "dvn", "message"]),
    ("phishing-router", ["phishing", "social engineering", "impersonat", "fake support", "scam"]),  # routed below
    ("poisoning", ["poisoning", "address poison", "lookalike", "dusting"]),
    ("permit", ["permit", "permit2", "signature", "gasless", "off-chain sig"]),
    ("approval", ["approval", "approve", "allowance", "setapprovalforall"]),
    ("contract-bug", ["reentran", "overflow", "rounding", "precision", "access control", "access-control",
                      "oracle", "price manipulation", "flash loan", "flash-loan", "logic", "rounding error",
                      "integer", "math", "rugpull", "rug pull", "exploit", "vulnerability", "minting"]),
]


def _get(url):
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=TIMEOUT) as r:
            return json.loads(r.read().decode())
    except Exception:
        return None


def now_ts():
    blk = _get("https://api.llama.fi/charts") and None  # avoid; use a block timestamp instead
    # Use a public RPC latest-block timestamp for a keyless clock.
    try:
        req = urllib.request.Request(
            "https://eth.llamarpc.com",
            data=json.dumps({"jsonrpc": "2.0", "id": 1, "method": "eth_getBlockByNumber", "params": ["latest", False]}).encode(),
            headers={"Content-Type": "application/json", "User-Agent": "aex-security-guard"},
        )
        with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
            return int(json.loads(r.read().decode())["result"]["timestamp"], 16)
    except Exception:
        return 0


def classify(hack):
    blob = " ".join(str(hack.get(k) or "") for k in ("classification", "technique", "name", "source")).lower()
    for cls, kws in RULES:
        if any(kw in blob for kw in kws):
            if cls == "phishing-router":
                # Phishing is a delivery layer — route to the most likely on-chain class if hinted,
                # else default to drainer (the kit behind most phishing).
                if "permit" in blob or "signature" in blob:
                    return "permit"
                if "approval" in blob or "approve" in blob:
                    return "approval"
                if "poison" in blob:
                    return "poisoning"
                return "drainer"
            return cls
    return None  # unmapped -> flag for human review


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=14)
    a = ap.parse_args()

    data = _get("https://api.llama.fi/hacks") or _get("https://defillama-datasets.llama.fi/hacks/hacks.json")
    rows = data if isinstance(data, list) else (data or {}).get("data") or []
    cutoff = now_ts() - a.days * DAY

    by_class = {c: [] for c in CLASSES}
    unmapped = []
    considered = 0
    for h in rows:
        if not isinstance(h, dict):
            continue
        try:
            ts = int(h.get("date") or h.get("timestamp") or 0)
        except Exception:
            continue
        if ts < cutoff:
            continue
        considered += 1
        rec = {
            "name": h.get("name") or h.get("project") or "?",
            "date": ts,
            "amount_usd": h.get("amount") or h.get("amountLost"),
            "classification": h.get("classification") or h.get("technique"),
            "chains": h.get("chains") or h.get("chain"),
        }
        cls = classify(h)
        if cls:
            by_class[cls].append(rec)
        else:
            unmapped.append(rec)

    by_class = {c: sorted(v, key=lambda x: -(x["date"] or 0)) for c, v in by_class.items() if v}
    print(json.dumps({
        "kb_deltas": {
            "window_days": a.days,
            "incidents_considered": considered,
            "by_class": by_class,
            "unmapped": unmapped,  # techniques not in the taxonomy — review + maybe add a new class
        },
        "merge_into_memory": "kb_deltas",
        "review_flag": bool(unmapped),
        "note": "Merge by_class into MEMORY kb_deltas (replace, keep last ~60 days). If unmapped is "
                "non-empty, surface to the owner: a technique not yet in exploit-taxonomy.md — "
                "consider adding a new class.",
    }, indent=2))


if __name__ == "__main__":
    main()
