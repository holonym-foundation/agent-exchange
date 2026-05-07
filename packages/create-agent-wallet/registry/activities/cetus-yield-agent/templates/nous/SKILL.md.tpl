---
name: {{projectName}}
description: Cetus concentrated-liquidity yield agent on Sui — monitor mode (Phase 1) by default; active mode (Phase 2+) opens + rebalances real positions via the local WaaP wallet
compatibility: Requires @human.tech/waap-cli with Sui support, Sui mainnet RPC, CETUS_POOL_ID env var
metadata:
  author: holonym-foundation
  activity: {{activitySlug}}
  runtime: hermes
  chain: sui
---

# {{projectName}} — Cetus Yield Agent on Sui (Hermes)

Hermes Agent implementation of the canonical 5-phase recipe at {{recipeUrl}}. Default `AGENT_MODE=monitor` (read-only); `active` opens real positions.

## Tools

- `waap-cli whoami --json` → returns `{ evmWalletAddress, suiWalletAddress, ... }` — pick the Sui one
- `waap-cli send-tx --tx-bytes <b64> --chain sui:mainnet` (tx hash printed in plain text)
- Sui RPC: `getObject(CETUS_POOL_ID)` and `getOwnedObjects(owner, filter: Position)`
- Cetus SDK (`@cetusprotocol/cetus-sui-clmm-sdk`) for active-mode tx payload construction

## Strategy

1. Resolve `suiWalletAddress` from `waap-cli whoami`.
2. Read pool: `current_tick_index`, `current_sqrt_price`, `tick_spacing`.
3. Monitor: simulate a position centred on the current tick, log drift events.
4. Active: open / rebalance via Cetus SDK → `waap-cli send-tx`. Use `delta_liquidity` (not `liquidity`); pass `rewarder_coin_types: []`.
5. Loop every `CHECK_INTERVAL_MS`; honor SIGTERM.

## Env

- `CETUS_POOL_ID` (required)
- `AGENT_MODE` = `monitor` (default) | `active`
- `POSITION_RANGE_TICKS` = 200
- `REBALANCE_THRESHOLD_TICKS` = 100
- `CHECK_INTERVAL_MS` = 300000
- `NETWORK` = mainnet | testnet
- `AGENT_MAX_DEPOSIT_USD` (optional)

## Hard rules

- Default `monitor`. No submissions until operator opts in.
- Optional `AGENT_MAX_DEPOSIT_USD` ceiling on active-mode opens.
- Refuse if `waap-cli whoami` lacks `suiWalletAddress`.
- 40-50% of available USDC, not 100%, when opening.

## Recipe reference

{{recipeUrl}}
