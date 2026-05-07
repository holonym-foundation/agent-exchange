---
name: {{projectName}}
description: Cetus concentrated-liquidity yield agent on Sui — monitor mode (Phase 1) by default; active mode (Phase 2+) opens + rebalances real positions via the local WaaP wallet
compatibility: Requires @human.tech/waap-cli with Sui support, Sui mainnet RPC, CETUS_POOL_ID env var
metadata:
  author: holonym-foundation
  activity: {{activitySlug}}
  runtime: openclaw
  chain: sui
---

# {{projectName}} — Cetus Yield Agent (Sui CLMM)

AgentSkills implementation of the canonical 5-phase recipe at {{recipeUrl}}. Default mode (`AGENT_MODE=monitor`) is read-only; active mode opens real positions.

## Tools

- `waap-cli whoami --json` → returns `{ evmWalletAddress, suiWalletAddress, ... }` — pick the Sui one
- `waap-cli send-tx --tx-bytes <b64> --chain sui:mainnet` (no `--json`; tx hash is printed in plain text)
- Sui RPC: `getObject(CETUS_POOL_ID)` for pool state; `getOwnedObjects(owner, filter: Position)` for positions
- Cetus SDK (`@cetusprotocol/cetus-sui-clmm-sdk`) for active-mode payload construction

## Strategy

1. `whoami` → Sui address.
2. Read pool state from Sui (`current_tick_index`, `current_sqrt_price`, `tick_spacing`).
3. **Monitor mode**: simulate position drift, log events, no tx.
4. **Active mode**: snap target range to `tick_spacing`; open/close via SDK + `waap-cli send-tx`.
5. Loop every `CHECK_INTERVAL_MS`. Exit after 3 consecutive failures.

## Env

- `CETUS_POOL_ID` (required)
- `AGENT_MODE` = `monitor` (default) | `active`
- `POSITION_RANGE_TICKS` = 200
- `REBALANCE_THRESHOLD_TICKS` = 100
- `CHECK_INTERVAL_MS` = 300000
- `NETWORK` = mainnet | testnet
- `AGENT_MAX_DEPOSIT_USD` (optional safety cap)

## Hard rules

- Default to `AGENT_MODE=monitor`. Operator must opt into `active`.
- Never exceed `AGENT_MAX_DEPOSIT_USD` if set.
- Refuse if `waap-cli whoami` doesn't return a `suiWalletAddress`.
- Use 40-50% of available USDC when opening, never 100% — pool requires proportional balances.
- Cetus SDK uses `delta_liquidity` (not `liquidity`); always pass `rewarder_coin_types: []`.

## Recipe reference

{{recipeUrl}}
