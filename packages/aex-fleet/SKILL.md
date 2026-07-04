---
name: aex-fleet
description: Manage many WaaP agent wallets at once from one operator. Use when the user wants to onboard multiple agents, apply policies in bulk across a fleet, switch between agent contexts, run waap-cli scoped to a specific agent, or aggregate fleet status (balances, errors, last activity). Wraps @human.tech/waap-cli — each agent gets its own sandboxed HOME so sessions don't collide.
metadata:
  author: holonym-foundation
  version: '0.0.1'
  scope: operator CLI for AEX fleets
  related-issues: 'holonym-foundation/internal-docs#1166'
---

# aex-fleet — operator CLI for many WaaP agents at once

Use this skill when the user wants any of:

- **Onboarding many agents** ("set up three Cetus yield agents", "spin up an agent per chain")
- **Bulk policy changes** ("tighten daily limits across all yield agents to $50", "audit current policies")
- **Per-agent wallet ops** ("send 0.1 ETH from the alpha agent to 0xfeed", "sign this message as beta")
- **Fleet status** ("which agents errored overnight?", "what's the total balance?", "is any agent stale?")
- **Context switching** ("switch to the bravo agent and run X")

Skip this skill for single-wallet tasks where the user has not signalled a fleet — `waap-cli` directly is the right tool there.

---

## The shape of every interaction

Always reach for the `--json` flag on reads so output is structured. Always show the user the `plan` output before `apply` for any bulk operation. Always prefer the active agent over forcing the user to specify one — but state the active agent in your response so they can correct you.

```bash
aex-fleet --help                       # full command list
aex-fleet doctor                       # preflight (waap-cli, Neon, session store, linkage)
aex-fleet ls --json                    # structured fleet snapshot
```

---

## Verbs

### Registry

| Command | Shape | When |
|---|---|---|
| `aex-fleet add <id> --template <t> --chain <c> --email <e>` | one-shot | onboard a new agent |
| `aex-fleet ls [--json]` | read | list agents, addresses, cached balance, tags |
| `aex-fleet use <id>` | one-shot | set the active agent for subsequent commands |
| `aex-fleet rm <id>` | one-shot | remove from registry (wallet untouched) |

### Selectors (used by bulk commands)

| Flag | Meaning |
|---|---|
| `--all` | every registered agent |
| `--tag <tag>` | agents whose tags include `<tag>` |
| `--agent <id>` | a single agent (overrides `--all` / `--tag`) |
| _(none)_ | the active agent (one) |

### Policy

| Command | Shape | When |
|---|---|---|
| `aex-fleet policy get [selectors] [--json]` | bulk read | inspect current policy |
| `aex-fleet policy set [selectors] --daily-limit <usd> [--json]` | bulk write | apply daily-spend cap |

Bulk ops are sequential (2FA in `waap-cli` forces it). Failures don't halt — non-zero exit if any agent failed; `--json` always shows per-agent status.

### Status

| Command | Shape | When |
|---|---|---|
| `aex-fleet status [--json]` | read | aggregate balances, last activity, error count last 24h from Neon |
| `aex-fleet doctor [--json]` | read | preflight (waap-cli installed, Neon reachable, session store ok, linkage SDK status) |

`status` requires `AEX_FLEET_NEON_DSN_RO` (or `DATABASE_URL`) for live data; degrades gracefully without.

### Passthrough

| Command | Shape | When |
|---|---|---|
| `aex-fleet waap <args…>` | passthrough | run any `waap-cli` invocation scoped to the active agent |
| `aex-fleet exec <cmd> <args…>` | passthrough | run any command with `HOME` pointed at the active agent's sandbox |

`AEX_FLEET_AGENT=<id>` env overrides the active agent for one invocation.

### ERC-8004 identity (v1.0.2 — intent only, no on-chain mint yet)

| Command | Shape | When |
|---|---|---|
| `aex-fleet add <id> --register-erc8004` | one-shot | onboard an agent and record ERC-8004 identity intent in one step |
| `aex-fleet erc8004 register <id> [--chain <c>]` | one-shot | record intent on an existing agent (defaults: sepolia for EVM) |
| `aex-fleet erc8004 unregister <id>` | one-shot | remove ERC-8004 state from the registry (does NOT burn an on-chain token) |
| `aex-fleet erc8004 status [id] [--json]` | read | per-agent status; `--json` for AI shells |

`8004` column appears in `aex-fleet ls` automatically when any agent has state. Until contracts deploy on-chain, all registrations show as `pending — contracts not yet deployed`.

---

## Task-shaped examples

### Onboard three test agents on Sepolia

```bash
for n in 1 2 3; do
  aex-fleet add eth-yield-test-$n --chain ethereum --email user+ethtest$n@example.com --tag yield --tag test
done
aex-fleet ls --json
```

### Apply a $50 daily cap to every yield agent

```bash
aex-fleet policy set --tag yield --daily-limit 50 --json | jq '{total, failed}'
```

If `failed > 0`, drill into the failures:

```bash
aex-fleet policy set --tag yield --daily-limit 50 --json \
  | jq '.results[] | select(.ok == false) | {agentId, message}'
```

### Switch context and send a tx

```bash
aex-fleet use eth-yield-test-1
aex-fleet waap send-tx --to 0xfeed... --value 0.001

# `--to <agent-id>` resolves against fleet.json — send between registered agents by name:
aex-fleet waap send-tx --to eth-yield-test-2 --value 0.001
# (raw 0x… addresses, anything containing a dot (ENS), and unknown ids pass through untouched)
```

### Audit overnight failures

```bash
aex-fleet status --json \
  | jq '.agents[] | select(.telemetry.errorsLast24h > 0) | {agentId, errors: .telemetry.errorsLast24h}'
```

---

## Failure modes to expect

- **"No active agent"** — the user has no `--agent`, no `AEX_FLEET_AGENT` env, and no `activeAgent` in `fleet.json`. Suggest `aex-fleet use <id>` or `--all` / `--tag`.
- **"Telemetry unavailable"** — `AEX_FLEET_NEON_DSN_RO` is not set. `status` still runs; balances + error counts show `—`. Surface the suggestion to set the DSN.
- **`waap-cli` not installed** — `aex-fleet doctor` will catch this. Direct the user to install `@human.tech/waap-cli` globally.
- **Linkage commands marked `--feature linking`** — Lucian's wallet-linking SDK methods aren't shipped yet in v1. The verbs exist (`aex-fleet link` / `unlink`) but require the feature flag; expect a no-op-with-warning until they ship.

---

## Config

Data root: `$XDG_CONFIG_HOME/aex-fleet/` (or platform default). Override with `AEX_FLEET_HOME`.

```
$AEX_FLEET_HOME/
  fleet.json                       # registry (mode 0600)
  sessions/<agent-id>/session.json # waap-cli session material (mode 0600)
  sandboxes/<agent-id>/.waap-agent/session.json  # materialised per-spawn
```

No secrets in `fleet.json`. Tracking issue: [holonym-foundation/internal-docs#1166](https://github.com/holonym-foundation/internal-docs/issues/1166).
