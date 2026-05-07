# Project context for Claude Code — {{projectName}}

**Activity:** {{activityName}}
**Chain:** {{chainName}}
**Pool:** env `CETUS_POOL_ID`
**Mode:** env `AGENT_MODE` (`monitor` default, `active` to trade)
**Wallet:** {{walletAddress}}

## What this agent does

{{activityDescription}}

Implements the canonical 5-phase recipe at {{recipeUrl}}.

## Modes

- `AGENT_MODE=monitor` — read pool tick, simulate position drift, log events. Zero risk.
- `AGENT_MODE=active` — open + rebalance real Cetus CLMM positions via `waap-cli send-tx`.

Always start in monitor mode.

## Hard limits

- Default `AGENT_MODE=monitor` — operator must explicitly switch to `active`.
- Optional `AGENT_MAX_DEPOSIT_USD` ceiling for active mode (not in canonical recipe; extra safety).
- Use 40-50% of available USDC when opening (recipe convention — pool needs proportional balances).

## Commands

- `waap-cli whoami --json` → returns `{ evmWalletAddress, suiWalletAddress, ... }`. Use `suiWalletAddress`.
- `waap-cli chain set sui:mainnet` — set the Sui chain context once per session.
- `waap-cli send-tx --tx-bytes <b64> --chain sui:mainnet` — submit a Move-built tx (no `--json`; tx hash is plain-text).
- Sui RPC `getObject(CETUS_POOL_ID)` for pool tick state.

## Recipe

{{recipeUrl}}
