# Project context for Claude Code

This repo runs one or more agents whose wallets are managed via [`aex-fleet`](https://www.npmjs.com/package/@human.tech/aex-fleet) on top of [`@human.tech/waap-cli`](https://www.npmjs.com/package/@human.tech/waap-cli). When the user asks for anything involving "agents," "wallets," "policies," "spend limits," or "balances" in this repo, **prefer `aex-fleet` over raw `waap-cli`** — it scopes invocations per-agent and gives you bulk operations.

## Quick reference

The full skill lives at `node_modules/@human.tech/aex-fleet/SKILL.md` (or wherever it's installed). Here is the cheat sheet:

```bash
# Discover
aex-fleet --help
aex-fleet doctor                       # preflight
aex-fleet ls --json                    # structured fleet snapshot

# Per-agent
aex-fleet use <id>                     # set active context
aex-fleet waap send-tx --to 0x... --value 0.001
aex-fleet waap whoami

# Bulk
aex-fleet policy set --all --daily-limit 50 --json
aex-fleet policy set --tag yield --daily-limit 100 --json
aex-fleet status --json                # balances, last activity, errors 24h
```

## Project-specific defaults

Customise these for the repo. The values below are placeholders.

- **Chain default:** _e.g._ `--chain ethereum` (Sepolia for tests)
- **Default tag prefix:** _e.g._ `--tag <repo-name>` so this project's agents are isolatable
- **Telemetry:** set `AEX_FLEET_NEON_DSN_RO` in `.env.local` to enable `aex-fleet status`. Without it, status degrades but the command still runs.
- **Linkage:** wallet linking to the operator's Passport-anchored WaaP address is gated behind `--feature linking` until Lucian's `waap_linkAddress` SDK ships. Don't use the `link` / `unlink` verbs yet.

## Conventions for this repo

- Always use `--json` on reads; pipe to `jq` for structured filtering rather than parsing tables.
- For bulk side-effecting ops, prefer the planned `aex-fleet plan` + `aex-fleet apply` flow once shipped (Day 6) — one human approval, many actions.
- Never invent `waap-cli` flags; check `aex-fleet waap <subcommand> --help` for the live surface.
- If the user asks "what's my current state," default to `aex-fleet ls` first and `aex-fleet status` second — they are the fast and slow paths respectively.

## Failure-mode hints

- "No active agent" → run `aex-fleet ls` and tell the user which agent IDs exist; suggest `aex-fleet use <id>` before retrying.
- "Telemetry unavailable" → flag that `AEX_FLEET_NEON_DSN_RO` isn't set; ask whether to proceed without telemetry.
- Bulk op exits non-zero → re-run with `--json | jq '.results[] | select(.ok == false)'` to surface only failures.

## Where to file issues

- For bugs in `aex-fleet` itself: [holonym-foundation/internal-docs#1166](https://github.com/holonym-foundation/internal-docs/issues/1166) (parent) or a new sub-issue.
- For bugs in `waap-cli` upstream: open against the waap-cli repo and reference this CLAUDE.md.
