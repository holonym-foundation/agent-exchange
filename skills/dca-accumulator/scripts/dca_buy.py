#!/usr/bin/env python3
"""dca_buy — build a keyless USDC->token buy (Uniswap v3) for a scheduled DCA, via waap-cli.

Self-sustaining: Uniswap v3 QuoterV2 (eth_call, keyless) for the price + best fee tier, then builds
the approve(USDC->router) + exactInputSingle/exactInput calldata. No aggregator key, no AEX backend.
The agent executes the two txs via `waap-cli send-tx` (2PC, no private key in the env). In dry-run it
prints the plan + the quoted price (for cost-basis) and sends nothing.

The script NEVER sends — it emits a buy plan + a quoted price/token so the agent can track cost basis.
Execution stays human-gated/dry-run-aware at the agent layer, capped at the per-cycle amount.

Usage:
  dca_buy.py --chain 8453 --token 0xTokenOut --usd 50 [--slippage-bps 100] [--recipient 0xYou]

Always exits 0; parse JSON on stdout.
"""
import argparse
import json
import urllib.request

CFG = {
    8453: {  # Base
        "rpc": ["https://base.drpc.org", "https://base-rpc.publicnode.com"],
        "quoter": "0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a",
        "router": "0x2626664c2603336E57B271c5C0b26F421741e481",
        "usdc": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", "usdc_dec": 6,
        "weth": "0x4200000000000000000000000000000000000006",
    },
    1: {  # Ethereum
        "rpc": ["https://eth.drpc.org", "https://ethereum-rpc.publicnode.com"],
        "quoter": "0x61fFE014bA17989E743c5F6cB21bF9697530B21e",
        "router": "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45",
        "usdc": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", "usdc_dec": 6,
        "weth": "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
    },
}
FEES = (500, 3000, 10000)
TIMEOUT = 15


def pad(a):
    return a.lower().replace("0x", "").rjust(64, "0")


def u(n):
    return hex(int(n))[2:].rjust(64, "0")


def rpc(rpcs, method, params):
    for url in rpcs:
        try:
            req = urllib.request.Request(url, data=json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode(),
                                         headers={"Content-Type": "application/json", "User-Agent": "aex-dca-accumulator"})
            with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
                j = json.loads(r.read().decode())
            if isinstance(j, dict) and j.get("result") is not None:
                return j["result"]
        except Exception:
            continue
    return None


def quote_single(cfg, tin, tout, amt, fee):
    data = "0xc6a5026a" + pad(tin) + pad(tout) + u(amt) + u(fee) + u(0)
    res = rpc(cfg["rpc"], "eth_call", [{"to": cfg["quoter"], "data": data}, "latest"])
    if isinstance(res, str) and len(res) >= 66:
        try:
            return int(res[2:66], 16)
        except Exception:
            return None
    return None


def quote_path(cfg, path_bytes, amt):
    pb = path_bytes[2:] if path_bytes.startswith("0x") else path_bytes
    nbytes = len(pb) // 2
    data = "0xcdca1753" + u(64) + u(amt) + u(nbytes) + pb + "0" * ((32 - (nbytes % 32)) % 32 * 2)
    res = rpc(cfg["rpc"], "eth_call", [{"to": cfg["quoter"], "data": data}, "latest"])
    if isinstance(res, str) and len(res) >= 66:
        try:
            return int(res[2:66], 16)
        except Exception:
            return None
    return None


def encode_path(tokens, fees):
    p = "0x" + tokens[0].lower().replace("0x", "")
    for i, fee in enumerate(fees):
        p += format(fee, "06x") + tokens[i + 1].lower().replace("0x", "")
    return p


def token_decimals(cfg, token):
    raw = rpc(cfg["rpc"], "eth_call", [{"to": token, "data": "0x313ce567"}, "latest"])  # decimals()
    try:
        return int(raw, 16) if isinstance(raw, str) and raw not in ("0x", None) else 18
    except Exception:
        return 18


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--chain", type=int, default=8453)
    ap.add_argument("--token", required=True, help="token to accumulate (address)")
    ap.add_argument("--usd", type=float, required=True, help="USDC to spend this cycle (per-cycle cap)")
    ap.add_argument("--slippage-bps", type=int, default=100)
    ap.add_argument("--recipient", default="")
    a = ap.parse_args()
    cfg = CFG.get(a.chain)
    if not cfg:
        print(json.dumps({"error": f"chain {a.chain} not supported", "buyable": False}))
        return
    tok = a.token.lower()
    amt_in = int(round(a.usd * 10 ** cfg["usdc_dec"]))
    recipient = a.recipient or "{WAAP_ADDRESS}"

    best = None
    for fee in FEES:
        out = quote_single(cfg, cfg["usdc"], tok, amt_in, fee)
        if out and (not best or out > best[0]):
            best = (out, "single", fee)
    if not best:
        for f1 in (500, 3000):
            for f2 in FEES:
                path = encode_path([cfg["usdc"], cfg["weth"], tok], [f1, f2])
                out = quote_path(cfg, path, amt_in)
                if out and (not best or out > best[0]):
                    best = (out, "path", path)
    if not best or best[0] == 0:
        print(json.dumps({"token": a.token, "chain": a.chain, "buyable": False,
                          "reason": "no Uniswap v3 route found (illiquid or not on Uniswap)"}))
        return

    quoted_out, kind, route = best
    min_out = quoted_out * (10000 - a.slippage_bps) // 10000
    dec = token_decimals(cfg, tok)
    out_human = quoted_out / (10 ** dec)
    price = a.usd / out_human if out_human else None  # USD per token, for cost basis

    approve_data = "0x095ea7b3" + pad(cfg["router"]) + u(amt_in)
    if kind == "single":
        swap_data = "0x04e45aaf" + pad(cfg["usdc"]) + pad(tok) + u(route) + pad(recipient) + u(amt_in) + u(min_out) + u(0)
        route_desc = f"USDC -[{route}]-> token (direct)"
    else:
        pb = route[2:]
        nbytes = len(pb) // 2
        swap_data = "0xb858183f" + u(128) + pad(recipient) + u(amt_in) + u(min_out) + u(nbytes) + pb + "0" * ((32 - (nbytes % 32)) % 32 * 2)
        route_desc = "USDC -> WETH -> token (2-hop)"

    print(json.dumps({
        "token": a.token, "chain": a.chain, "buyable": True,
        "spend_usdc": a.usd, "route": route_desc,
        "quoted_out_raw": quoted_out, "quoted_out": round(out_human, 8), "token_decimals": dec,
        "price_usd_per_token": round(price, 8) if price else None,
        "min_out_raw": min_out, "slippage_bps": a.slippage_bps,
        "txs": [
            {"step": "approve", "to": cfg["usdc"], "data": approve_data, "value": "0x0",
             "desc": f"approve USDC {a.usd} to router"},
            {"step": "swap", "to": cfg["router"], "data": swap_data, "value": "0x0",
             "desc": f"swap {a.usd} USDC for token ({route_desc}), min out {min_out}"},
        ],
        "note": "Plan only — sends nothing. Execute via waap-cli send-tx (approve then swap), "
                "dry-run-aware, capped at the per-cycle amount. Track price_usd_per_token in MEMORY "
                "for running cost basis. Set recipient to the WaaP wallet address.",
    }, indent=2))


if __name__ == "__main__":
    main()
