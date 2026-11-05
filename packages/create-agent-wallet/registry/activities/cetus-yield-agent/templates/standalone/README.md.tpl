# {{projectName}} — Cetus Yield Agent (Sui)

Concentrated-liquidity agent on **Cetus Protocol**, scaffolded from the canonical 5-phase recipe at [docs.waap.human.tech/recipes/cetus-yield-agent](https://docs.waap.human.tech/recipes/cetus-yield-agent).

Default mode is **monitor** (Phase 1 — read-only, no funds at risk), with transaction submission disabled by `DRY_RUN=true`.

## Prerequisites

- Node.js 24+
- `@human.tech/waap-cli` installed (handled by `npm install` here, or `npm i -g @human.tech/waap-cli@2.2.1`)
- For active mode, a WaaP wallet (`npx waap-cli signup --email you+cetus@example.com --password-stdin`)
- For active mode: SUI for gas + the pool's tokens (e.g. SUI + USDC)

## Quick start (local dev)

```bash
cp .env.example .env
# CETUS_POOL_ID is required. Default points at SUI/USDC mainnet.
npm install
# Monitor mode needs no wallet signup; transaction commands select the chain explicitly.
npm run dev          # run the agent with tsx
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
3. Inspect the simulated transaction effects, gas, and balance changes described in [Phase 2 of the recipe](https://docs.waap.human.tech/recipes/cetus-yield-agent/phase-2-trade).
4. Only after that validation, set `DRY_RUN=false` to allow WaaP-signed submissions.

## Customise

- Different pool: `CETUS_POOL_ID` (find pool object IDs at app.cetus.zone)
- Wider/narrower range: `POSITION_RANGE_TICKS` (default 200)
- Less/more sensitive rebalancer: `REBALANCE_THRESHOLD_TICKS` (default 100)
- Faster polling: `CHECK_INTERVAL_MS` (default 300000 = 5 min)

## Recipe

{{recipeUrl}}

## Execution and recovery

The standalone template pins WaaP CLI **2.2.1** and sends Sui **TransactionKind** bytes on stdin. WaaP prepares the full transaction and enforces its signing policy. `AGENT_MAX_DEPOSIT_USD` is a local strategy limit, not a substitute for the wallet's externally enforced permissions.

Before submission, the agent synchronously persists an intent containing the owner, pool, network, operation and transaction-kind hash. It records a returned transaction digest before waiting for finality. Disk failures, malformed/missing receipts and unknown finality stop execution. A pending intent blocks startup and subsequent actions; an existing position is not proof that this particular submission succeeded. Simulation failures fail the cycle, and dry runs never clear or overwrite a live intent.

Use persistent local storage for `INTENT_FILE`. Docker Compose mounts `execution-state` at `/app/state` and disables automatic restart. Keep that volume when rebuilding; `docker compose down -v` deletes recovery evidence and must not be used while a submission is unresolved. An exclusive adjacent `.lock` directory prevents another active process using the same journal. A crash may leave that lock; it is never stolen by a timeout.

When recovery is required:

1. Stop every process using this wallet/journal and preserve the intent, lock metadata and logs.
2. Reconcile the recorded digest and exact owner/pool/network with independent chain receipts and WaaP operation records. If the digest was lost, obtain the corresponding operation outcome from WaaP; a balance or position snapshot alone is insufficient.
3. Keep the agent stopped while an operation might still submit or its outcome remains unknown. Do not retry the transaction or merely delete the journal.
4. After establishing the final outcome and reviewing the next intended action, archive the evidence and remove the resolved intent and stale lock. Recheck balances, positions and wallet permissions before restarting.

The shipped regression tests cover encoding and injected failures without funds. They do not establish live policy enforcement, provider availability, profitability or funded transaction acceptance. Default polling remains five minutes (`CHECK_INTERVAL_MS=300000`); use faster checks only for a bounded rehearsal, then select a schedule appropriate to the strategy and cost.
