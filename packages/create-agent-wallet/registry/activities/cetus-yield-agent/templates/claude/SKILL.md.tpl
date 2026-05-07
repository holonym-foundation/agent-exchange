---
name: {{projectName}}
description: Cetus concentrated-liquidity yield agent on Sui — monitors pool drift, rebalances positions via the local WaaP wallet
---

# {{projectName}} — Cetus Yield Agent (Sui)

Implements the canonical 5-phase recipe at {{recipeUrl}}. Default mode is `monitor` (read-only); active mode opens + repositions real liquidity.

## Prerequisites

- `@human.tech/waap-cli` installed with Sui support
- WaaP wallet authenticated (`waap-cli signup ...; waap-cli chain set sui:mainnet`)
- For active mode: SUI for gas + the pool's tokens (e.g. SUI + USDC)
- Required env: `CETUS_POOL_ID`. Sensible defaults for everything else.

## Strategy

1. `waap-cli whoami --json` — pick `suiWalletAddress` (waap-cli returns both EVM + Sui addresses).
2. Read pool state from Sui (`current_tick_index`, `current_sqrt_price`, `tick_spacing`).
3. **Monitor mode** (`AGENT_MODE=monitor`, default): simulate a position centred on current tick. Log drift / out-of-range events. No transactions.
4. **Active mode** (`AGENT_MODE=active`): use the Cetus SDK to construct add/remove-liquidity payloads, then submit via `waap-cli send-tx --tx-bytes <b64> --chain sui:mainnet`.
5. Loop every `CHECK_INTERVAL_MS` (default 5 min). Honor SIGTERM for clean shutdown.

## Tick math

- Position range: `[currentTick - POSITION_RANGE_TICKS, currentTick + POSITION_RANGE_TICKS]`, snapped to `tick_spacing`.
- Rebalance trigger: `Math.abs(currentTick - position.center) > REBALANCE_THRESHOLD_TICKS` OR out-of-range.

## Safety rails

- Default to `AGENT_MODE=monitor`. Operator must explicitly set `active` to submit anything.
- If `AGENT_MAX_DEPOSIT_USD` is set, never deploy more than that USD value when opening.
- Optional structured JSON logs (one per cycle) to `LOG_FILE` (default `<projectName>.log`).
- After 3 consecutive cycle failures, exit non-zero (let the supervisor restart).

## Known gotchas (from the recipe)

- Cetus SDK parameter is `delta_liquidity`, NOT `liquidity`, for `removeLiquidityTransactionPayload`.
- Always pass `rewarder_coin_types: []` (empty array, not omitted).
- Position ticks must be `tick_spacing`-aligned. Snap with `Math.floor(t / spacing) * spacing`.
- Use 40-50% of available USDC, not 100% — the pool needs proportional balances on both sides.
- Set `sdk.senderAddress = address` before building any tx payload.

## Recipe

{{recipeUrl}}
