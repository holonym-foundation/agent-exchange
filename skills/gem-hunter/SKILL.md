---
name: gem-hunter
description: An on-chain gem hunter — discovers early low-cap tokens with momentum, screens every one for honeypots/rugs BEFORE buying, and (with your approval, capped) actually buys the survivors via your WaaP wallet. Keyless + self-sustaining (GeckoTerminal, GoPlus, Honeypot.is, Uniswap v3, public RPC).
license: MIT
metadata:
  author: human.tech
  version: "0.2.0"
---

# Gem Hunter (on-chain)

Finds low-cap gems with real momentum, **refuses to buy the rugs**, and buys the survivors on your
say-so within hard caps. Everything is keyless and runs in your own container — no AEX backend. The
order is the whole point: **discover → SCREEN → approve → buy.** Momentum without screening is how
you buy a honeypot.

Default posture is **safe**: `AGENT_DRY_RUN=1` and `AGENT_MODE=manual` → it proposes buys and hands
off to Telegram; it moves no funds until you opt in. It only ever spends USDC, only up to your caps.

## 1. Discover — `gem_scan.py`
`gem_scan.py --chain {GEM_CHAIN} --min-liq-usd {GEM_MIN_LIQ_USD} --max-fdv-usd {GEM_MAX_FDV_USD}`.
Keyless GeckoTerminal trending + new DEX pools → candidates with the **token contract address**,
liquidity, 24h volume, momentum, FDV, and a 0–100 score (liquidity floor + activity + capped
momentum + youth). Filters illiquid traps and pools without a USDC/WETH route. Discovery only.

## 2. SCREEN — `gem_screen.py` (mandatory gate — never skip)
For EVERY candidate you'd propose or buy: `gem_screen.py --chain {GEM_CHAIN} --token <addr>`.
Keyless GoPlus token-security + Honeypot.is live sim → `go` / `caution` / `no-go`. **Never buy a
`no-go`** (honeypot, cannot-sell, tax-too-high, blacklistable). `caution` (mintable, upgradeable
owner powers, unverified, moderate tax) may be bought only eyes-open and called out. No data = treat
as caution, not go. This screen is the agent's differentiator — surface the verdict honestly.

## 3. Propose / approve
Rank the screened survivors by score (drop `no-go`). Keep an **approved list in your MEMORY** — the
gems the owner has OK'd to buy (they approve in chat: "buy GEM", "stop watching GEM"). In
`AGENT_MODE=manual` (default) you only buy what's on the approved list; in `auto` you may buy `go`
gems above `{GEM_MIN_SCORE}` within caps. Always honestly label speculation; never give financial
advice.

## 4. Buy — `gem_buy.py` + waap-cli (human-gated, capped)
For an approved+screened gem: `gem_buy.py --chain {GEM_CHAIN} --token <addr> --usd {GEM_BUY_USD}
--slippage-bps {GEM_MAX_SLIPPAGE_BPS} --recipient <your WaaP address>`. It builds, keylessly (Uniswap
v3 QuoterV2 for the best fee tier / 2-hop via WETH), the **approve(USDC→router)** then
**exactInputSingle/exactInput** calldata with `amountOutMinimum` from slippage. Execute the two txs
via `waap-cli send-tx` (2PC — no private key in the env). Rules:
- **Re-screen immediately before buying** (gem_screen) — reject if it flipped to `no-go`.
- **Caps:** never spend more than `{GEM_BUY_USD}` per buy or `{GEM_MAX_USD_TOTAL}` total (track spend
  in MEMORY); abort if the quote implies worse than `{GEM_MAX_SLIPPAGE_BPS}`.
- **Dry-run / manual:** if `AGENT_DRY_RUN=1` or `AGENT_MODE=manual` without approval, DON'T send —
  post the plan + quoted price to Telegram and hand off.
- Track holdings + cost basis in MEMORY; report fill (or quoted) price, amount, running spend vs cap.

## Self-sustaining by design
Keyless data (GeckoTerminal, GoPlus, Honeypot.is, Uniswap v3 QuoterV2, public RPC), your own MEMORY
(approved list + holdings + cost basis + last-seen candidates), your own WaaP wallet to buy, your own
Telegram to propose/hand-off. No keys, no AEX backend. Read-by-default; spends only USDC, only on
screened+approved gems, only within your caps. Selling / take-profit is out of scope for v1 — surface
exits, the owner sells.
