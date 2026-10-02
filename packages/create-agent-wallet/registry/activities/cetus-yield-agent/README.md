# Cetus Yield Agent

Autonomous concentrated-liquidity agent on **Cetus Protocol (Sui)**. It implements the canonical 5-phase recipe at [docs.wallet.human.tech/recipes/cetus-yield-agent](https://docs.wallet.human.tech/recipes/cetus-yield-agent): read-only monitoring, transaction simulation, active position management, adaptive ranges, and cross-protocol yield comparison.

Runs on **Sui mainnet** (or testnet via `NETWORK=testnet`).

## Modes

| `AGENT_MODE` | What it does                                              | Risk               |
| ------------ | --------------------------------------------------------- | ------------------ |
| `monitor`    | Reads pool state, simulates a position, logs drift events | None (read-only)   |
| `active`     | Opens + rebalances real positions via `waap-cli send-tx`  | Real funds at risk |

The default is `monitor`. Before active submission, validate simulation results and configure WaaP permissions for the intended chain, functions and amounts. Monitoring alone does not prove spending readiness.

## Supported runtimes

- Claude (SKILL.md + CLAUDE.md + MCP config)
- Standalone (Node.js + Dockerfile + docker-compose.yml)
- OpenClaw (AgentSkills SKILL.md)
- Nous / Hermes (AgentSkills SKILL.md)

## Env

| Key                         | Required | Description                                          |
| --------------------------- | -------- | ---------------------------------------------------- |
| `CETUS_POOL_ID`             | yes      | Cetus pool object ID (e.g. SUI/USDC mainnet)         |
| `AGENT_MODE`                | no       | `monitor` (default) or `active`                      |
| `POSITION_RANGE_TICKS`      | no       | Half-width of the tick range (default 200)           |
| `REBALANCE_THRESHOLD_TICKS` | no       | Drift before rebalancing (default 100)               |
| `CHECK_INTERVAL_MS`         | no       | Cycle interval in ms (default 300000 = 5 min)        |
| `NETWORK`                   | no       | `mainnet` (default) or `testnet`                     |
| `SUI_RPC`                   | no       | Override the fullnode URL                            |
| `AGENT_MAX_DEPOSIT_USD`     | active mode | Required positive USD ceiling before active mode starts |
| `DRY_RUN`                   | no       | Simulate transactions instead of submitting (default `true`) |
| `LOG_FILE`                  | no       | JSON-line log path (default `<projectName>.log`)     |

## Generate + run

```bash
npx @human.tech/create-agent-wallet --activity cetus-yield-agent --runtime standalone cetus-agent
cd cetus-agent
cp .env.example .env
# edit .env, set CETUS_POOL_ID
npm install
npx waap-cli signup --email you+cetus@example.com --password-stdin
# Monitor mode needs no wallet signup; transaction commands select the chain explicitly.
npm run dev      # local
# or
docker compose up -d   # inspect failures; no automatic restart after uncertainty
```

The generated project starts in `AGENT_MODE=monitor` and `DRY_RUN=true`. Before live
submission, set a conservative `AGENT_MAX_DEPOSIT_USD`, run active mode with simulation
enabled, inspect the simulated effects, and only then set `DRY_RUN=false`.

## Full recipe

[docs.wallet.human.tech/recipes/cetus-yield-agent](https://docs.wallet.human.tech/recipes/cetus-yield-agent) — 5 phases from monitor → active → adaptive ranges → cross-pool / cross-protocol comparisons.

## Verification status

See [`VERIFICATION.md`](./VERIFICATION.md) for the reproducible scaffold, build,
read-only mainnet smoke test, and the explicit boundary of what has not yet been tested
with funds. `verified: true` means maintainers reproduced the safe public path; it is
not a profitability claim or an audit of Cetus Protocol.

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
