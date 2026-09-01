# {{projectName}} — Cetus Yield Agent (Sui)

Concentrated-liquidity agent on **Cetus Protocol**, scaffolded from the canonical 5-phase recipe at [docs.wallet.human.tech/recipes/cetus-yield-agent](https://docs.wallet.human.tech/recipes/cetus-yield-agent).

Default mode is **monitor** (Phase 1 — read-only, no funds at risk), with transaction submission disabled by `DRY_RUN=true`.

## Prerequisites

- Node.js 24+
- `@human.tech/waap-cli` installed (handled by `npm install` here, or `npm i -g @human.tech/waap-cli@latest`)
- A WaaP wallet (`waap-cli signup --email you+cetus@example.com --password '...'`)
- For active mode: SUI for gas + the pool's tokens (e.g. SUI + USDC)

## Quick start (local dev)

```bash
cp .env.example .env
# CETUS_POOL_ID is required. Default points at SUI/USDC mainnet.
npm install
waap-cli chain set sui:mainnet
npm run dev          # tsx hot-reload
```

You should see JSON-line logs like:

```json
{"ts":"...","agent":"{{projectName}}","level":"info","message":"agent_starting","mode":"monitor",...}
{"ts":"...","agent":"{{projectName}}","level":"info","message":"cycle","tick":69758,...}
{"ts":"...","agent":"{{projectName}}","level":"event","message":"sim_position_opened",...}
```

Logs are also appended to `{{projectName}}.log` (override with `LOG_FILE`).

## Run 24/7 (Docker)

```bash
npm run compose:up        # docker compose up -d
npm run compose:logs      # tail follow
npm run compose:down      # stop + remove
```

The compose file persists the waap-cli session in a named volume (`waap-session`) so the container can restart without re-authenticating.

## Switching to active mode

1. Run a few monitor cycles. Confirm `sim_drift_detected` / `sim_rebalance` events look right.
2. Set a conservative positive `AGENT_MAX_DEPOSIT_USD` and switch to `AGENT_MODE=active` while keeping `DRY_RUN=true`.
3. Inspect the simulated transaction effects, gas, and balance changes described in [Phase 2 of the recipe](https://docs.wallet.human.tech/recipes/cetus-yield-agent/phase-2-trade).
4. Only after that validation, set `DRY_RUN=false` to allow WaaP-signed submissions.

## Customise

- Different pool: `CETUS_POOL_ID` (find pool object IDs at app.cetus.zone)
- Wider/narrower range: `POSITION_RANGE_TICKS` (default 200)
- Less/more sensitive rebalancer: `REBALANCE_THRESHOLD_TICKS` (default 100)
- Faster polling: `CHECK_INTERVAL_MS` (default 300000 = 5 min)

## Recipe

{{recipeUrl}}
