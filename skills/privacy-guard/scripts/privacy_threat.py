#!/usr/bin/env python3
"""privacy_threat — does a product/service this wallet touched deanonymize you?

Self-sustaining / keyless: classifies the wallet's counterparties into privacy threats —
  kyc_onramp     — a known CEX hot/deposit address (their KYC links your REAL identity to this wallet
                   — the #1 deanonymizer)
  sanctioned     — OFAC-listed / mixer (taint: privacy AND compliance risk)
  public_identity — the counterparty has a public ENS name (interacting links you to a named entity)
Each comes with the deanonymization risk + the fix, and a contribution to the privacy score.

Data: public RPC getLogs (drpc; Etherscan V2 full history if ETHERSCAN_API_KEY), keyless ENS reverse,
the 0xB10C OFAC feed, and a bundled (extensible, partial) CEX-address list. No AEX backend.

Usage:
  privacy_threat.py --wallet 0xYou --chain 1 [--lookback-blocks 9000]

Always exits 0; parse JSON on stdout.
"""
import argparse
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
MAX_RANGE = 9000
TIMEOUT = 20
UA = {"User-Agent": "aex-privacy-guard", "Accept": "application/json"}
# Bundled, PARTIAL, extensible set of well-known CEX hot/deposit addresses (the strongest KYC link).
# Refreshable later from a labels feed; absence != not-a-CEX.
CEX = {
    "0x28c6c06298d514db089934071355e5743bf21d60": "Binance", "0x21a31ee1afc51d94c2efccaa2092ad1028285549": "Binance",
    "0xdfd5293d8e347dfe59e90efd55b2956a1343963d": "Binance", "0x56eddb7aa87536c09ccc2793473599fd21a8b17f": "Binance",
    "0x71660c4005ba85c37ccec55d0c4493e66fe775d3": "Coinbase", "0x503828976d22510aad0201ac7ec88293211d23da": "Coinbase",
    "0xa9d1e08c7793af67e9d92fe308d5697fb81d3e43": "Coinbase", "0x2910543af39aba0cd09dbb2d50200b3e800a63d2": "Kraken",
    "0x6cc5f688a315f3dc28a7781717a9a798a59fda7b": "OKX", "0x98ec059dc3adfbdd63429454aeb0c990fba4a128": "OKX",
    "0x1522900b6dafac587d499a862861c0869be6e428": "Bitfinex", "0xf89d7b9c864f589bbf53a82105107622b35eaa40": "Bybit",
}


def _get(url):
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=TIMEOUT) as r:
            return json.loads(r.read().decode())
    except Exception:
        return None


def rpc(chain, method, params):
    for url in RPCS.get(chain, []):
        try:
            req = urllib.request.Request(url, data=json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode(),
                                         headers={"Content-Type": "application/json", "User-Agent": "aex-privacy-guard"})
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


def counterparties(chain, wallet, lookback, key):
    w = wallet.lower()
    cps = set()
    if key:
        for action in ("txlist", "tokentx"):
            url = f"https://api.etherscan.io/v2/api?chainid={chain}&module=account&action={action}&address={w}&startblock=0&endblock=99999999&sort=desc&apikey={key}"
            j = _get(url)
            for t in (j.get("result", []) if isinstance(j, dict) and str(j.get("status")) == "1" else [])[:3000]:
                for a2 in ((t.get("from") or "").lower(), (t.get("to") or "").lower()):
                    if a2 and a2 != w:
                        cps.add(a2)
        src = "etherscan-full-history"
    else:
        tip = int(rpc(chain, "eth_blockNumber", []) or "0x0", 16)
        frm = max(0, tip - lookback)
        for lg in get_logs_chunked(chain, frm, tip, [TRANSFER, topic_addr(w)]):
            if len(lg.get("topics", [])) >= 3:
                cps.add(addr_from_topic(lg["topics"][2]))
        for lg in get_logs_chunked(chain, frm, tip, [TRANSFER, None, topic_addr(w)]):
            if len(lg.get("topics", [])) >= 3:
                cps.add(addr_from_topic(lg["topics"][1]))
        cps.discard(w)
        src = "keyless-recent-window"
    return cps, src


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--wallet", required=True)
    ap.add_argument("--chain", type=int, default=1)
    ap.add_argument("--lookback-blocks", type=int, default=9000)
    a = ap.parse_args()
    key = os.environ.get("ETHERSCAN_API_KEY", "").strip()
    cps, src = counterparties(a.chain, a.wallet, a.lookback_blocks, key)

    ofac = _get("https://raw.githubusercontent.com/0xB10C/ofac-sanctioned-digital-currency-addresses/lists/sanctioned_addresses_ETH.json")
    ofac = {x.lower() for x in ofac} if isinstance(ofac, list) else set()

    # Each flag carries its EVIDENCE SOURCE so the verdict is auditable, not an opaque score.
    # Tiers reflect real deanonymization power: KYC on-ramp (links your legal identity) >> taint >>
    # named-counterparty (mere attribution context, NOT a deanonymization of you — info only).
    threats, score_delta = [], 0
    for cp in list(cps)[:60]:  # cap ENS lookups
        if cp in CEX:
            score_delta -= 20
            threats.append({"counterparty": cp, "kind": "kyc_onramp", "label": CEX[cp], "severity": "high",
                            "evidence": f"address in bundled CEX list ({CEX[cp]})",
                            "deanon": f"{CEX[cp]} is a KYC'd exchange — it links your real legal identity to this wallet",
                            "fix": "for a private wallet, don't fund/cash-out via a KYC exchange directly; hop through a fresh, unlinked address (or shield)"})
        elif cp in ofac:
            score_delta -= 15
            threats.append({"counterparty": cp, "kind": "sanctioned", "severity": "high",
                            "evidence": "address in 0xB10C OFAC sanctioned-addresses feed",
                            "deanon": "OFAC-listed / mixer counterparty — taint (privacy + compliance risk)",
                            "fix": "avoid; tainted funds attract chain-analysis attention to your whole cluster"})
        else:
            nm = ens_name(cp)
            if nm:
                score_delta -= 2  # attribution context, not deanonymization of YOU — kept low on purpose
                threats.append({"counterparty": cp, "kind": "named_counterparty", "ens": nm, "severity": "info",
                                "evidence": "ENS reverse record on the counterparty",
                                "deanon": f"this counterparty is publicly named ('{nm}') — your interaction with it is attributable to a known party (this is NOT about your own wallet being public, and NOT cross-wallet linkability — see linkability_scan for those)",
                                "fix": "informational; only matters if you don't want this specific interaction attributed"})

    order = {"high": 0, "medium": 1, "info": 2}
    threats.sort(key=lambda t: order.get(t["severity"], 3))
    print(json.dumps({
        "wallet": a.wallet, "chain": a.chain, "data_source": src,
        "counterparties_examined": len(cps),
        "threats_found": len(threats),
        "privacy_score_delta": score_delta,
        "threats": threats,
        "disclaimer": "Evidence-based, not a social-credit score for apps. Each flag cites its source; "
                      "absence of a flag is NOT a privacy endorsement (the CEX list is partial; feeds "
                      "update; off-chain data practices are assessed separately and cited from the "
                      "service's own docs). A 'no threats' result means 'none in these signals,' not 'private'.",
        "note": "Heuristic + partial (CEX list curated/extensible; keyless window sees recent activity, "
                "a key gives full history). Folds into the privacy score. Read-only — never moves funds.",
    }, indent=2))


if __name__ == "__main__":
    main()
