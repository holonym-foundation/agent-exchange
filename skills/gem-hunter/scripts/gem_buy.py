#!/usr/bin/env python3
"""gem_buy — build a keyless USDC->gem swap (Uniswap v3) for waap-cli to execute.

Self-sustaining: Uniswap v3 QuoterV2 (eth_call, keyless) for the price + best fee tier, then builds
the approve(USDC->router) + exactInputSingle/exactInput calldata. No aggregator key, no AEX backend.
The agent executes the two txs via `waap-cli send-tx` (2PC, no private key in the env). In dry-run it
just prints the plan and the quoted price.

The script NEVER sends anything — it emits a buy plan. Execution is human-gated/dry-run-aware at the
agent layer, capped, and only after gem_screen.py returns go/caution.

Usage:
  gem_buy.py --chain 8453 --token 0xGem --usd 25 [--slippage-bps 100] [--recipient 0xYou]

Always exits 0; parse JSON on stdout.
"""
import argparse
import json
import urllib.request

# Per-chain Uniswap v3 + base tokens. USDC is the spend asset; WETH is the 2-hop intermediary.
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
            req = urllib.request.Request(
                url,
                data=json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode(),
                headers={"Content-Type": "application/json", "User-Agent": "aex-gem-hunter"},
            )
            with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
                j = json.loads(r.read().decode())
            if isinstance(j, dict) and j.get("result") is not None:
                return j["result"]
        except Exception:
            continue
    return None


def quote_single(cfg, tin, tout, amt, fee):
    # QuoterV2.quoteExactInputSingle((tokenIn,tokenOut,amountIn,fee,sqrtPriceLimitX96)) -> 0xc6a5026a
    data = "0xc6a5026a" + pad(tin) + pad(tout) + u(amt) + u(fee) + u(0)
    res = rpc(cfg["rpc"], "eth_call", [{"to": cfg["quoter"], "data": data}, "latest"])
    if isinstance(res, str) and len(res) >= 66:
        try:
            return int(res[2:66], 16)
        except Exception:
            return None
    return None


def quote_path(cfg, path_bytes, amt):
    # QuoterV2.quoteExactInput(bytes path, uint256 amountIn) -> 0xcdca1753 (path is dynamic bytes)
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


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--chain", type=int, default=8453)
    ap.add_argument("--token", required=True)
    ap.add_argument("--usd", type=float, required=True, help="USDC to spend")
    ap.add_argument("--slippage-bps", type=int, default=100)
    ap.add_argument("--recipient", default="")
    a = ap.parse_args()
    cfg = CFG.get(a.chain)
    if not cfg:
        print(json.dumps({"error": f"chain {a.chain} not supported for buy", "buyable": False}))
        return
    gem = a.token.lower()
    amt_in = int(round(a.usd * 10 ** cfg["usdc_dec"]))
    recipient = a.recipient or "{WATCH_ADDRESS}"

    # best DIRECT route across fee tiers
    best = None  # (out, kind, fee_or_path)
    for fee in FEES:
        out = quote_single(cfg, cfg["usdc"], gem, amt_in, fee)
        if out and (not best or out > best[0]):
            best = (out, "single", fee)
    # 2-hop via WETH if no/weak direct route
    if not best:
        for f1 in (500, 3000):
            for f2 in FEES:
                path = encode_path([cfg["usdc"], cfg["weth"], gem], [f1, f2])
                out = quote_path(cfg, path, amt_in)
                if out and (not best or out > best[0]):
                    best = (out, "path", path)

    if not best or best[0] == 0:
        print(json.dumps({"token": a.token, "chain": a.chain, "buyable": False,
                          "reason": "no Uniswap v3 route found (illiquid or not on Uniswap)"}))
        return

    quoted_out, kind, route = best
    min_out = quoted_out * (10000 - a.slippage_bps) // 10000

    # approve(router, amt_in) on USDC  -> 0x095ea7b3
    approve_data = "0x095ea7b3" + pad(cfg["router"]) + u(amt_in)
    if kind == "single":
        # SwapRouter02.exactInputSingle((tokenIn,tokenOut,fee,recipient,amountIn,amountOutMinimum,sqrtPriceLimitX96)) 0x04e45aaf
        swap_data = ("0x04e45aaf" + pad(cfg["usdc"]) + pad(gem) + u(route) + pad(recipient)
                     + u(amt_in) + u(min_out) + u(0))
        route_desc = f"USDC -[{route}]-> gem (direct)"
    else:
        # SwapRouter02.exactInput((bytes path,address recipient,uint256 amountIn,uint256 amountOutMinimum)) 0xb858183f
        pb = route[2:]
        nbytes = len(pb) // 2
        # struct: offset(0x80), recipient, amountIn, amountOutMin, then bytes(len+data) at 0x80
        swap_data = ("0xb858183f" + u(128) + pad(recipient) + u(amt_in) + u(min_out)
                     + u(nbytes) + pb + "0" * ((32 - (nbytes % 32)) % 32 * 2))
        route_desc = "USDC -> WETH -> gem (2-hop)"

    print(json.dumps({
        "token": a.token, "chain": a.chain, "buyable": True,
        "spend_usdc": a.usd, "route": route_desc,
        "quoted_out_raw": quoted_out, "min_out_raw": min_out, "slippage_bps": a.slippage_bps,
        "txs": [
            {"step": "approve", "to": cfg["usdc"], "data": approve_data, "value": "0x0",
             "desc": f"approve USDC {a.usd} to router"},
            {"step": "swap", "to": cfg["router"], "data": swap_data, "value": "0x0",
             "desc": f"swap {a.usd} USDC for gem ({route_desc}), min out {min_out}"},
        ],
        "note": "Plan only — the script sends nothing. Execute via waap-cli send-tx (approve then swap), "
                "human-gated/dry-run-aware, within caps, and ONLY after gem_screen.py returns go/caution. "
                "Set recipient to the WaaP wallet address.",
    }, indent=2))


if __name__ == "__main__":
    main()
