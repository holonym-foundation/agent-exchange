# Getting started with `aex-fleet`

A 10-minute walkthrough: install → onboard three agents → first transaction → bulk policy → ERC-8004 intent → live dashboard.

You should leave this with a working local fleet of test agents on Ethereum Sepolia and a clear sense of the verb surface.

---

## 0. Prerequisites

- **Node ≥ 20** (`node -v` to confirm)
- **macOS, Linux, or WSL** — Windows native untested
- **A throwaway email** with `+`-aliasing (Gmail, ProtonMail) so you can give each test agent a distinct WaaP account
- **Sepolia ETH** — grab from any faucet (Alchemy, QuickNode, [pk910 PoW](https://sepolia-faucet.pk910.de))

---

## 1. Install

```bash
npm install -g @human.tech/waap-cli @human.tech/aex-fleet
aex-fleet --version
waap-cli --version
```

Or, if you're working from the monorepo:

```bash
git clone git@github.com:holonym-foundation/aex.git
cd aex/packages/aex-fleet
npm install && npm run build && npm link
```

Confirm everything's wired:

```bash
aex-fleet doctor
```

You should see five rows: `waap-cli OK`, `session-store dir OK`, `fleet.json OK`, `Neon telemetry WARN` (unset is fine), `wallet linking PENDING`.

---

## 2. Isolate your demo (optional)

By default `aex-fleet` writes to your platform config dir. To keep this walkthrough sandboxed:

```bash
export AEX_FLEET_HOME=$(mktemp -d)
```

Everything below now lands in that temp dir; remove it to start over.

---

## 3. Register three agents

```bash
aex-fleet add eth-yield-1 --chain ethereum --email you+eth1@gmail.com --tag yield --tag demo
aex-fleet add eth-yield-2 --chain ethereum --email you+eth2@gmail.com --tag yield --tag demo
aex-fleet add eth-yield-3 --chain ethereum --email you+eth3@gmail.com --tag yield --tag demo
aex-fleet ls
```

You'll see three agents with `*` next to `eth-yield-1` (the first add becomes active). Addresses and balances are blank — we haven't signed up yet.

---

## 4. Sign up each agent's WaaP wallet

`aex-fleet waap <args…>` passes through to `waap-cli` scoped to the active agent's sandbox — its `~/.waap-agent/session.json` lands in the per-agent dir, not your home.

```bash
aex-fleet use eth-yield-1
aex-fleet waap signup -e you+eth1@gmail.com -p 'CorrectHorseBattery'
aex-fleet waap whoami    # prints the new wallet address

aex-fleet use eth-yield-2
aex-fleet waap signup -e you+eth2@gmail.com -p 'CorrectHorseBattery'
aex-fleet waap whoami

aex-fleet use eth-yield-3
aex-fleet waap signup -e you+eth3@gmail.com -p 'CorrectHorseBattery'
aex-fleet waap whoami
```

> **Note:** v1.0.x doesn't auto-populate the `address` column in `fleet.json` from `whoami`. You can pass `--address 0x…` to `add` if you know it ahead of time, or wait for v1.1 to fold signup into `add`.

---

## 5. Fund the wallets

Copy each `whoami` address into a Sepolia faucet ([pk910 PoW](https://sepolia-faucet.pk910.de) is no-signup). Once the faucet drops in:

```bash
aex-fleet use eth-yield-1 && aex-fleet waap balance --chain 11155111
```

---

## 6. Send a transaction — with agent-id resolution

`--to <agent-id>` resolves against `fleet.json` and substitutes the stored address. You never copy-paste between agents.

```bash
aex-fleet use eth-yield-1
aex-fleet waap send-tx --to eth-yield-2 --value 0.001 --chain 11155111
# stderr: (resolved --to eth-yield-2 → 0x…)
```

Raw `0x…` addresses and anything with a `.` (ENS) pass through untouched.

---

## 7. Bulk policy via plan / apply

The terraform-style two-phase flow is the canonical path for any side-effecting bulk op:

```bash
aex-fleet plan policy set --tag yield --daily-limit 50
# prints a JSON plan to stdout, no side effects

aex-fleet plan policy set --tag yield --daily-limit 50 | aex-fleet apply
# refuses without --yes — shows the plan in human-readable form first

aex-fleet plan policy set --tag yield --daily-limit 50 | aex-fleet apply --yes
# executes; streams [N/M] progress per agent; non-zero exit if any failed
```

Quick-fire dry-run if you don't need a saved plan:

```bash
aex-fleet policy set --tag yield --daily-limit 50 --dry-run
```

When a bulk op affects more than 5 agents (override via `AEX_FLEET_BLAST_RADIUS=N`) you get a yellow stderr warning — AI shells reading stderr will surface this to humans before execution.

---

## 8. Record ERC-8004 identity intent

EIP-8004 is Draft — no registries are deployed yet, so v1.0.2 records *intent* in `fleet.json` without minting. The surface is here so it's swap-in ready the moment contracts land.

```bash
aex-fleet erc8004 register eth-yield-1
# or do it at add-time:
aex-fleet add eth-yield-4 --chain ethereum --register-erc8004

aex-fleet erc8004 status
aex-fleet ls                  # `8004` column auto-appears when any agent has state
```

Defaults: EVM agents → `sepolia` testnet; pass `--chain ethereum` for mainnet intent. Non-EVM agents (e.g. `--chain sui`) require an explicit `--chain` flag.

---

## 9. Aggregate fleet status

```bash
aex-fleet status
aex-fleet status --json | jq '.summary'
```

If you've set `AEX_FLEET_NEON_DSN_RO=…` (the read-only DSN for the existing aex Neon project), this pulls latest balance, last event timestamp, and error counts for the last 24h per agent. Without it, status degrades gracefully and prints `—`.

---

## 10. Spin up the dashboard

```bash
aex-fleet dashboard
# opens http://localhost:3001 in your browser; auto-refreshes every 5s
```

You'll see a header (active agent, telemetry status, ERC-8004 contracts deployed), aggregate cards (fleet size, errors 24h, agents with ERC-8004 intent), and the per-agent table with all the columns from `ls`. Use this as your demo screen.

```bash
# share a static snapshot instead of a live server:
aex-fleet dashboard --export ./dashboard.html
open ./dashboard.html
```

---

## What you've now seen

- **Registry CRUD**: `add`, `ls`, `use`, `rm`
- **Per-agent scoping**: every `aex-fleet waap …` runs against the active agent's HOME sandbox
- **Agent-id resolution**: `--to <agent-id>` substitutes the registered address transparently
- **Bulk ops with safety**: `plan` / `apply` two-phase, `--dry-run`, blast-radius warning
- **Telemetry**: read-only Neon aggregates with graceful degradation
- **ERC-8004**: identity intent (mint path lands in v1.1)
- **Dashboard**: local web UI for demos

## Where to go next

- [`../SKILL.md`](../SKILL.md) — the agent-readable verb cheatsheet (drop into Claude Code / Cursor / opencode)
- [`../templates/claude-code/CLAUDE.md`](../templates/claude-code/CLAUDE.md) — project-scoped Claude Code primer
- [`../examples/demo.sh`](../examples/demo.sh) — re-runnable testnet flow
- [`../examples/demo.claude-code.md`](../examples/demo.claude-code.md) — transcript of driving the same flow by talking to Claude Code
- [`../KNOWN_ISSUES.md`](../KNOWN_ISSUES.md) — what's deferred and why
- [`../README.md`](../README.md) — verb-by-verb reference

## Quick troubleshooting

| Symptom | Fix |
|---|---|
| `Unknown agent: …` | `aex-fleet ls` to see registered ids; `aex-fleet use <id>` to set active |
| `No active agent` | `aex-fleet use <id>` or `AEX_FLEET_AGENT=<id> aex-fleet <cmd>` |
| `Telemetry unavailable` | set `AEX_FLEET_NEON_DSN_RO=postgres://…` to enable `status` live data |
| `waap-cli` row FAILs in doctor | `npm install -g @human.tech/waap-cli`; check `which waap-cli` |
| `policy set` hangs | a `waap-cli` 2FA prompt — set `aex-fleet waap 2fa disable` per agent for unattended ops |
| ERC-8004 always "pending" | expected in v1.0.2 — `CONTRACTS_BY_CHAIN` populates in v1.1 once registries deploy |
