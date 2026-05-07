# Cetus Yield Agent

Autonomous concentrated-liquidity agent on **Cetus Protocol (Sui)**. Implements the canonical 5-phase recipe at [docs.wallet.human.tech/recipes/cetus-yield-agent](https://docs.wallet.human.tech/recipes/cetus-yield-agent) — Phase 1 (monitor) ships ready to run; Phase 2+ (active position management) requires you to wire up the Cetus SDK calls per recipe.

Runs on **Sui mainnet** (or testnet via `NETWORK=testnet`).

## Modes

| `AGENT_MODE` | What it does                                              | Risk               |
| ------------ | --------------------------------------------------------- | ------------------ |
| `monitor`    | Reads pool state, simulates a position, logs drift events | None (read-only)   |
| `active`     | Opens + rebalances real positions via `waap-cli send-tx`  | Real funds at risk |

The default is `monitor`. Switch to `active` only after a few cycles of confidence in the monitor logs.

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
| `AGENT_MAX_DEPOSIT_USD`     | no       | Optional extra USD ceiling (not in canonical recipe) |
| `LOG_FILE`                  | no       | JSON-line log path (default `<projectName>.log`)     |

## Generate + run

```bash
npx @human.tech/create-agent-wallet --activity cetus-yield-agent --runtime standalone cetus-agent
cd cetus-agent
cp .env.example .env
# edit .env, set CETUS_POOL_ID
npm install
waap-cli signup --email you+cetus@example.com --password '...'
waap-cli chain set sui:mainnet
npm run dev      # local
# or
docker compose up -d   # 24/7 with restart:unless-stopped
```

## Full recipe

[docs.wallet.human.tech/recipes/cetus-yield-agent](https://docs.wallet.human.tech/recipes/cetus-yield-agent) — 5 phases from monitor → active → adaptive ranges → cross-pool / cross-protocol comparisons.
