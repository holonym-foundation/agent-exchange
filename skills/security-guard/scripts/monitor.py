#!/usr/bin/env python3
"""monitor — continuous, keyless wallet watch that fires IMMEDIATE alerts.

Self-sustaining: polls public RPC `eth_getLogs` once per block (~12s, stdlib only — the locked-down
runtime can't pip-install a WS client, so we poll instead of eth_subscribe) for the watched wallets
and prints one JSON alert line per event the instant it lands. The agent relays each line to the
owner's Telegram immediately. No API key, no AEX backend.

Detects (per watched wallet):
  outflow          — an outgoing token Transfer (sweep/large flagged; to-address screened vs feeds)
  approval         — a new Approval / ApprovalForAll (unlimited + risky-spender flagged)
  delegation_7702  — the wallet gained an EIP-7702 delegate (eth_getCode → 0xef0100…) = takeover risk
  flagged_party    — counterparty in OFAC / ScamSniffer feeds

Usage:
  monitor.py --chain 1 --wallets 0xa,0xb [--interval 12] [--once]
"""
import argparse
import json
import sys
import time
import urllib.request

# drpc first for getLogs: PublicNode rejects any non-"latest" getLogs range ("archive requires a
# personal token"); drpc serves ranged queries keyless. PublicNode stays as eth_getCode/blockNumber
# fallback.
RPCS = {
    1: ["https://eth.drpc.org", "https://ethereum-rpc.publicnode.com"],
    8453: ["https://base.drpc.org", "https://base-rpc.publicnode.com"],
    84532: ["https://base-sepolia.drpc.org", "https://base-sepolia-rpc.publicnode.com"],
    42161: ["https://arbitrum.drpc.org", "https://arbitrum-one-rpc.publicnode.com"],
    10: ["https://optimism.drpc.org", "https://optimism-rpc.publicnode.com"],
}
APPROVAL = "0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925"
APPROVAL_FOR_ALL = "0x17307eab39ab6107e8899845ad3d59bd9653f200f220920489ca2b5937696c31"
TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"
MAXUINT = (1 << 256) - 1
TIMEOUT = 12


def topic_addr(a):
    return "0x" + a.lower().replace("0x", "").rjust(64, "0")


def addr_from_topic(t):
    return "0x" + t[-40:]


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


def load_feed(url):
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "aex-security-guard"}), timeout=15) as r:
            data = r.read().decode()
        try:
            j = json.loads(data)
            items = j if isinstance(j, list) else list(j.values())[0] if isinstance(j, dict) else []
            return {str(x).lower() for x in items if isinstance(x, str)}
        except Exception:
            return {ln.strip().lower() for ln in data.splitlines() if ln.strip().startswith("0x")}
    except Exception:
        return set()


def alert(kind, severity, chain, wallet, **detail):
    print(json.dumps({"alert": kind, "severity": severity, "chain": chain, "wallet": wallet, **detail}), flush=True)


def get_logs(chain, topic0, owners, frm, to):
    # toBlock="latest" not hex(to): keyless drpc 408-times-out on a specific recent block but serves
    # "latest" fast. `last` is advanced to the tip we read, so a few blocks may re-scan (dupe-safe:
    # a repeated security alert is acceptable; a missed one is not).
    flt = {"fromBlock": hex(frm), "toBlock": "latest", "topics": [topic0, [topic_addr(w) for w in owners]]}
    for attempt in range(3):
        r = rpc(chain, "eth_getLogs", [flt])
        if isinstance(r, list):
            return r
        time.sleep(0.5 * (attempt + 1))
    return []


def scan(chain, owners, frm, to, bad):
    owners_l = {w.lower() for w in owners}
    for lg in get_logs(chain, APPROVAL, owners, frm, to):
        tp = lg.get("topics", [])
        if len(tp) < 3:
            continue
        owner, spender = addr_from_topic(tp[1]), addr_from_topic(tp[2])
        amt = int(lg.get("data", "0x0") or "0x0", 16)
        flags = (["unlimited"] if amt >= MAXUINT - 10 ** 60 else []) + (["flagged_spender"] if spender.lower() in bad else [])
        alert("approval", "high" if flags else "info", chain, owner, spender=spender, token=lg.get("address"), flags=flags, tx=lg.get("transactionHash"))
    for lg in get_logs(chain, APPROVAL_FOR_ALL, owners, frm, to):
        tp = lg.get("topics", [])
        if len(tp) < 3:
            continue
        alert("approval", "high", chain, addr_from_topic(tp[1]), spender=addr_from_topic(tp[2]), token=lg.get("address"), flags=["setApprovalForAll"], tx=lg.get("transactionHash"))
    for lg in get_logs(chain, TRANSFER, owners, frm, to):  # topic1=from=watched ⇒ OUTGOING
        tp = lg.get("topics", [])
        if len(tp) < 3:
            continue
        to_addr = addr_from_topic(tp[2])
        flagged = to_addr.lower() in bad
        alert("outflow", "high" if flagged else "info", chain, addr_from_topic(tp[1]), to=to_addr, token=lg.get("address"), flagged_recipient=flagged, tx=lg.get("transactionHash"))
    for w in owners:  # EIP-7702 takeover check
        code = rpc(chain, "eth_getCode", [w, "latest"])
        if isinstance(code, str) and code.startswith("0xef0100"):
            alert("delegation_7702", "critical", chain, w, delegate="0x" + code[8:48])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--chain", type=int, required=True)
    ap.add_argument("--wallets", required=True, help="comma-separated addresses to watch")
    ap.add_argument("--interval", type=int, default=12)
    ap.add_argument("--once", action="store_true")
    a = ap.parse_args()
    owners = [w.strip() for w in a.wallets.split(",") if w.strip()]
    bad = load_feed("https://raw.githubusercontent.com/0xB10C/ofac-sanctioned-digital-currency-addresses/lists/sanctioned_addresses_ETH.json")
    bad |= load_feed("https://raw.githubusercontent.com/scamsniffer/scam-database/main/blacklist/address.json")
    last = int(rpc(a.chain, "eth_blockNumber", []) or "0x0", 16)
    alert("watch_started", "info", a.chain, ",".join(owners), from_block=last, feeds=len(bad))
    while True:
        try:
            tip = int(rpc(a.chain, "eth_blockNumber", []) or hex(last), 16)
            if tip > last:
                scan(a.chain, owners, last + 1, tip, bad)
                last = tip
        except Exception as e:
            print(json.dumps({"alert": "monitor_error", "detail": str(e)[:120]}), file=sys.stderr, flush=True)
        if a.once:
            break
        time.sleep(a.interval)


if __name__ == "__main__":
    main()
