---
name: dca-accumulator
description: Dollar-cost-average into a token on schedule — swaps a fixed USDC amount on Base at your cadence via your WaaP wallet, with a hard per-buy cap, slippage guard, dry-run default, and running cost-basis. Keyless + self-sustaining (Uniswap v3 QuoterV2, public RPC).
license: MIT
metadata:
  author: human.tech
  version: "0.2.0"
---

# DCA Accumulator

Stacks a token on schedule — no timing anxiety, no emotions. Fixed USDC per cycle, hard caps,
**dry-run by default**. Keyless and self-sustaining (no AEX backend); spends only USDC, only up to the
per-cycle amount.

## Each cycle (if a buy is due)
1. **Resolve** `{DCA_TOKEN_OUT}` to a token address on `{DCA_CHAIN}` (default Base) if a symbol was
   given (CoinGecko/GeckoTerminal). **Sanity-check once** that it isn't a honeypot before the first
   buy (a cheap GoPlus/Honeypot.is read) — refuse to DCA into a token you can't sell.
2. **Quote + build** the buy: `dca_buy.py --chain {DCA_CHAIN} --token <addr> --usd {DCA_AMOUNT_USD}
   --slippage-bps {AGENT_MAX_SLIPPAGE_BPS} --recipient <your WaaP address>`. It picks the best
   Uniswap v3 fee tier (or a 2-hop via WETH), returns the **quoted price/token** (for cost basis) and
   `approve` + `swap` calldata, with `amountOutMinimum` from slippage.
3. **Execute** the two txs via `waap-cli send-tx` (2PC — no private key in the env). **Abort** if the
   quote implies worse than `{AGENT_MAX_SLIPPAGE_BPS}`. **Never spend more than `{DCA_AMOUNT_USD}`** in
   a cycle.
4. **Dry-run:** if `AGENT_DRY_RUN` is `"1"`, DON'T send — log the intended buy + quoted price and stop.

## Cost basis (keep it honest)
Track in MEMORY: total USDC spent, total token acquired, **average entry price**. Each cycle report:
fill price (or quoted price in dry-run), amount acquired, running cost basis, and **average entry vs
current price** (up/down). No hype — DCA is a discipline, not a signal.

## Scheduling
Buy at most once per `{DCA_INTERVAL_HOURS}` (default weekly = 168h). Track the last-buy time in MEMORY
so restarts don't double-buy.

## Self-sustaining by design
Keyless data (Uniswap v3 QuoterV2, public RPC), your own MEMORY (cost basis + last-buy time), your own
WaaP wallet to buy, your own Telegram to report. No keys, no AEX backend. Spends only USDC, only the
per-cycle amount, dry-run by default. Selling/exit is out of scope — this only accumulates.
