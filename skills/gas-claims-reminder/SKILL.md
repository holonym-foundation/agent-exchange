---
name: gas-claims-reminder
description: Collect & time — finds money you've already earned but not collected (Merkl & liquidity incentives, across wallets/chains), tells you the cheapest moment to transact (gas-timing, mainly on Ethereum), and flags low gas tanks + deadlines. Keyless + self-sustaining (Merkl v4, public RPC). Read-only — it finds money, you collect it.
license: MIT
metadata:
  author: human.tech
  version: "0.3.0"
---

# Gas & Claims Reminder — "Collect & Time"

Two jobs: **collect** money you've already earned but left uncollected, and **time** your
transactions for the cheapest moment. It stays quiet unless there's something to do. **Read-only: it
finds money and the right moment; you act.** Keyless, runs in your own container — no AEX backend.

## Watch list (multi-wallet, chat-managed)
Keep a **watch list in your MEMORY**: `{WATCH_ADDRESS}` plus any address the owner adds in chat
("also watch 0x…", "stop watching 0x…"). Everything here is read-only, so you can watch any wallet.
Check every wallet on every chain in `{WATCH_CHAINS}`.

## 1. Gas — the cheapest moment to act (every cycle)
`gas_check.py --wallets <watch list> --chains {WATCH_CHAINS} --min-native {MIN_GAS_NATIVE} --cheap-pctile {GAS_CHEAP_PCTILE} --spike-pctile {GAS_SPIKE_PCTILE}`.
Gas is per-chain; balance is per-wallet. It reports the base fee, its **percentile vs recent blocks**
(chain-relative), and flags:
- `gas_cheap` — a good moment to do a pending action.
- `gas_spike` — hold off / be aware.
- `actionable_gas` — **gas-timing is meaningful on Ethereum L1**; on L2s gas is usually negligible,
  so a relative "spike" is suppressed unless the absolute fee is genuinely high. Only surface
  `actionable_gas`.
- `low_gas` — a watched wallet can't afford pending actions; tell the owner to top up.

Run this **every cycle** — cheap-gas windows on L1 are transient (that's why the default cadence is
hourly, not daily).

## 2. Claimables — money already earned (≈ once per 24h)
`claims_check.py --wallets <watch list> --chains {WATCH_CHAINS} --min-usd {MIN_CLAIM_USD}`. Keyless
Merkl v4 user-rewards → **unclaimed** balance per token with USD value and which wallet. Dust-filtered.
The owner claims at app.merkl.xyz; **you never claim.** (LP fees / per-protocol rewards need
protocol-specific checks — note them, don't fabricate amounts.) Track last-run in MEMORY so claims
run about daily even though the gas loop is hourly.

## 3. Deadlines
From the claimables + tracked positions, flag anything time-boxed (claim window / vesting unlock
approaching, Merkl campaign ending). Only flag what the data shows.

## The one rule + how owners hear about it
Alert only when actionable. When there's something to do, send **one consolidated message to the
owner's Telegram** (which wallet, what, where, how much, how urgent, the action). When nothing's
actionable, stay silent. Notifications go through this agent's **own Telegram bot** (self-sustaining,
per-agent) — there's no central notification service. Track last-seen claimables + last gas-alert
state per wallet/chain in MEMORY so you never re-alert the same thing.

## Self-sustaining by design
Keyless data (Merkl v4, public RPC), your own MEMORY (watch list + last-seen claimables + gas state),
your own Telegram to alert. No keys, no AEX backend. Read-only — it never sends a transaction.

## Roadmap: gas-timing as a service (x402)
Other agents will be able to **ask this agent "is now a cheap moment on chain X?"** and **pay (x402)
to have a transaction scheduled for the next cheap-gas window** — a gas-timing oracle + scheduled
execution that any agent can consume. See the x402 spec; this agent is a natural x402 *provider*.
