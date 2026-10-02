# {{projectName}} (Claude runtime)

Cetus yield agent skill for Claude Code. Default mode is `monitor` (Phase 1 — read-only).

## Files

| File              | Purpose                                                                                                                                |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `SKILL.md`        | Skill definition                                                                                                                       |
| `CLAUDE.md`       | Project context loaded into Claude's window                                                                                            |
| `mcp-config.json` | WaaP MCP wiring                                                                                                                        |
| `.env.example`    | `CETUS_POOL_ID` (required), `AGENT_MODE`, `POSITION_RANGE_TICKS`, `REBALANCE_THRESHOLD_TICKS`, `CHECK_INTERVAL_MS`, `NETWORK`, etc. |

## Use it

1. `cp .env.example .env` and set `CETUS_POOL_ID` (and any other overrides).
2. `waap-cli signup --email ... && waap-cli chain set sui:mainnet`.
3. Open this folder in Claude Code.
4. Ask Claude to review the pool and run a monitor-mode cycle.

## Recipe

{{recipeUrl}}
