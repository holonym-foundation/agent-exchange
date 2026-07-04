---
name: farm
description: Phase 2 of the Airdrop Farmer — work the eligibility tasks for opportunities the owner approved, using your own waap-cli wallet, your own MEMORY as the allowlist, and keyless RPC to check funds/activity. Self-sustaining: no AEX backend.
license: MIT
metadata:
  author: human.tech
  version: "0.1.0"
---

# Farm

Your **Phase 2** capability: actually complete the eligibility tasks for airdrop opportunities, on
the owner's behalf, within hard caps. It runs from your own container — your `waap-cli` wallet, your
own MEMORY, your own Telegram, and keyless public RPC. You do **not** depend on any AEX service.

## Your allowlist lives in YOUR memory
You keep a small structured record in MEMORY — this is your source of truth, not a server:
```
FARM ALLOWLIST
- <project> (chain <id>): status=approved|proposed|done
    checklist: [the qualifying actions from your Scout brief + cost]
    progress:  [actions you've already taken, with tx hashes + timestamps]
    spent_usd: <running total for this opportunity>
```
You never lose this if the AEX control plane is down — you read and update it every cycle.

## How an opportunity becomes "approved"
- **FARM_MODE = manual** (default): for the top opportunities not yet approved, **propose** them to
  the owner on Telegram (project + the actions + estimated cost). When the owner approves (their
  reply arrives to you as a lead), mark that opportunity `approved` in MEMORY. Only then do you act.
- **FARM_MODE = auto**: you may approve high-score opportunities yourself, within caps. (Still never
  exceed `FARM_MAX_USD_TOTAL`.)

## Executing the next action (per approved opportunity)
1. **Check you can act** — run `skills/farm/scripts/farm_status.py --chain <id> --wallet <your
   waap-cli address> --token <USDC>`: confirm `hasGas` and enough token for the next action within
   `FARM_MAX_USD_PER_OP`. The `txCount` tells you how active this wallet already is — **pace
   organically** (don't burst many txs at once; space them across cycles to avoid sybil patterns).
2. **Pick the next checklist action** not in `progress` (bridge, swap, supply/LP, a dapp contract
   call, a small send — whatever the brief said qualifies).
3. **Do it** with the `waap-cli` wallet (build the tx, sign + send via `waap-cli send-tx`), spending
   at most `FARM_MAX_USD_PER_OP` for this opportunity and never pushing the running total over
   `FARM_MAX_USD_TOTAL`.
4. **Record** the action + tx hash + spend in MEMORY `progress`/`spent_usd`, and ingest it (so the
   dashboard shows a `farm_action` event).

## Guardrails
- **Caps are hard.** Never exceed `FARM_MAX_USD_PER_OP` per opportunity or `FARM_MAX_USD_TOTAL`
  overall. Re-read your `spent_usd` from MEMORY before every action.
- **AGENT_DRY_RUN = "1"** or **FARM_MODE = "manual"** without approval → **propose only**, do not
  move funds.
- **Hand off what you can't safely do** — KYC, CAPTCHA, social login, or any action you're unsure
  how to perform → notify the owner on Telegram with the link, don't guess on-chain.
- **One opportunity at a time, paced.** Take one qualifying action per opportunity per cycle, not a
  burst — organic behavior survives sybil filters.

## Self-sustaining by design
MEMORY = allowlist + progress · `waap-cli` = your wallet · Telegram = approvals + hand-off ·
keyless RPC (`farm_status.py`) = funds/activity checks. No API keys, no AEX backend. If the operator
provides RPC keys in your env you may use them, but you don't require them.
