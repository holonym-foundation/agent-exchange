# `@human.tech/aex-fleet`

Operator CLI for managing many WaaP agent wallets at once.

> v1 prototype — see tracking issue [`holonym-foundation/internal-docs#1166`](https://github.com/holonym-foundation/internal-docs/issues/1166).

## What it does

Wraps [`@human.tech/waap-cli`](https://www.npmjs.com/package/@human.tech/waap-cli) with a fleet registry so one operator can:

| | |
|---|---|
| `aex-fleet add` | Register an agent in the fleet |
| `aex-fleet ls` | List agents, addresses, balances, tags |
| `aex-fleet use` | Set the active agent for subsequent commands |
| `aex-fleet rm` | Remove an agent from the registry (wallet untouched) |
| `aex-fleet waap …` | Pass through to `waap-cli` scoped to the active agent |
| `aex-fleet exec …` | Run an arbitrary command in the active agent's HOME sandbox |
| `aex-fleet policy get/set` | Inspect / set policy in bulk via `--all`, `--tag`, `--agent` |
| `aex-fleet autopay enable/disable/pause/resume/status` | Arm policy-bounded buyer autopay (auto-buy + auto-renew the compute lease, #1256) |
| `aex-fleet renew [--watch]` | Renewal loop — re-buy near-expiry leases within the consented cap (one-shot or daemon) |
| `aex-fleet status` | Aggregate balances, last activity, errors (24h) from Neon |
| `aex-fleet plan` / `aex-fleet apply` | Two-phase bulk ops — preview, then approve |
| `aex-fleet doctor` | Health-check the runtime |

Every read command supports `--json` for AI-shell consumption. Every side-effecting verb supports `--dry-run` (or the `plan`/`apply` flow).

## AI shells drive this natively

The `SKILL.md` at the package root + the `templates/claude-code/CLAUDE.md` project primer let Claude Code (or Cursor / opencode) invoke `aex-fleet` via the shell's native Bash tool. No MCP server required. See [`examples/demo.claude-code.md`](./examples/demo.claude-code.md) for a session transcript.

## Quick start

```bash
# Install
npm install -g @human.tech/aex-fleet @human.tech/waap-cli

# Preflight
aex-fleet doctor

# Onboard
aex-fleet add alpha --chain ethereum --tag yield
aex-fleet add beta --chain ethereum --tag yield

# Bulk policy via plan/apply
aex-fleet plan policy set --tag yield --daily-limit 50 | aex-fleet apply --yes

# Aggregate status (requires AEX_FLEET_NEON_DSN_RO)
aex-fleet status
```

Full end-to-end demo on Sepolia: [`examples/demo.sh`](./examples/demo.sh).

## Buyer autopay (Model 2, #1256)

`autopay` arms an agent's **own WaaP wallet** to auto-buy and auto-renew its compute lease without a
human approving each transaction — bounded by a daily spend cap the user consents to at enable time.

```bash
# 1. Deploy with a lease term (also reads AEX_LEASE_HOURS if --duration-hours is omitted).
aex-fleet deploy alpha --source ./alpha --target arkhai --duration-hours 1

# 2. Arm autopay: push the daily cap and configure non-interactive signing.
aex-fleet autopay enable --agent alpha --daily-limit 10 --per-tx-limit 4 --mode no-2fa

# 3. Run the renewal loop (one shot from cron, or a long-running watcher).
aex-fleet renew                       # one sweep, then exit
aex-fleet renew --watch --interval 600  # daemon: sweep every 10 min

# Status / recover.
aex-fleet autopay status --all
aex-fleet autopay resume --agent alpha   # clear a pause after topping up funds
```

Cron example (every 10 minutes):

```cron
*/10 * * * * AEX_FLEET_HOME=$HOME/.config/aex-fleet aex-fleet renew --json >> $HOME/autopay.log 2>&1
```

**How non-interactive signing works (and the residual gap).** waap-cli (v1.0.2) enforces a daily
USD cap server-side via `policy set --daily-spend-limit`, and a transaction skips the per-tx 2FA
prompt either by **disabling 2FA** for the wallet (`--mode no-2fa`, the default — the daily cap is
then the only bound) or by passing a pre-minted **permission-token** (`--privilege`) per tx
(`--mode permission-token --permission-token <encoded>`). waap-cli does **not** yet expose a command
to *mint* a scoped permission-token, so today the available in-CLI non-interactive path is
`no-2fa`. When waap-cli ships a privilege-mint primitive, switch to `permission-token` for a
session-key-scoped bound that doesn't require disabling 2FA wallet-wide. See `core/autopay.ts`.

**Safety.** The renewal loop never silently drops a lease: when the per-tx or projected daily cap
would be exceeded, or a renewal fails (funds / provider / chain), the agent is **paused** and a
notification is emitted (`autopay status` shows `PAUSED`; resume with `autopay resume`). Cap
accounting resets daily (UTC) and is enforced client-side *before* charging, on top of waap-cli's
server-side daily limit.

## Config

Data root: `$XDG_CONFIG_HOME/aex-fleet/` (or platform default on macOS / Windows):

```
$AEX_FLEET_HOME/
  fleet.json                                       # registry (mode 0600)
  sessions/<agent-id>/session.json                 # waap-cli session material (mode 0600)
  sandboxes/<agent-id>/.waap-agent/session.json    # materialised per-spawn
```

Override the whole data root with `AEX_FLEET_HOME=/path/to/dir`. Useful for isolating a test instance or pinning multiple operator profiles on one machine.

### Environment

| Var | Purpose |
|---|---|
| `AEX_FLEET_HOME` | Override the data root (see above) |
| `AEX_FLEET_AGENT` | Override the active agent for one invocation |
| `AEX_FLEET_NEON_DSN_RO` | Read-only Postgres DSN for `aex-fleet status` (also accepts `DATABASE_URL` for parity with the dashboards) |
| `AEX_LEASE_HOURS` | Default lease term (hours) for `deploy` when `--duration-hours` is omitted; also the term the autopay renewal loop re-buys |
| `AEX_FLEET_BLAST_RADIUS` | Bulk-op warning threshold (default 5) — applies to `autopay` selections too |

## Architecture mechanics

- **Per-agent scoping**: each `aex-fleet waap …` spawn overrides `HOME` to a per-agent sandbox dir so `waap-cli`'s `~/.waap-agent/session.json` is scoped. Filing an upstream `WAAP_CONFIG_DIR` request to retire this trick.
- **Credentials**: session material lives in the file store with mode `0600`. `keytar` was deprecated; swap in `@napi-rs/keyring` (or successor) when stable — the `core/keychain.ts` surface is the swap point.
- **Telemetry**: read-only Postgres against the existing Neon schema (`agent_events`, `agent_balance_snapshots`). No schema changes.
- **Wallet linking**: consumes Lucian's upcoming `waap_linkAddress` SDK methods. Linkage verbs are gated behind `--feature linking` until they ship — see [`KNOWN_ISSUES.md`](./KNOWN_ISSUES.md).

## Status of v1

Day 1–7 of a one-week prototype:

- [x] Day 1 — scaffold, `FleetManager`, locked `fleet.json`, `add`/`ls`/`use`/`rm`
- [x] Day 2 — `waap-runner` HOME-sandbox, file-backed session store, `exec` + `waap` passthrough
- [x] Day 3 — `policy get/set` with `--all`/`--tag`/`--agent` + result table + EventEmitter
- [x] Day 4 — Neon read-only client + `status` (3 aggregate queries) + graceful degradation
- [x] Day 5 — `doctor`, `SKILL.md`, Claude Code template, demo script
- [x] Day 6 — `plan` / `apply` two-phase + `--dry-run` on side-effecting verbs + `--help` polish
- [x] Day 7 — Claude Code demo transcript, `KNOWN_ISSUES.md`, upstream `WAAP_CONFIG_DIR` ask

What's deferred and why → [`KNOWN_ISSUES.md`](./KNOWN_ISSUES.md).

## License

Apache-2.0
