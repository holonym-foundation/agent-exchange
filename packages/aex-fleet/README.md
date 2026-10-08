# `@human.tech/aex-fleet`

Operator CLI for managing many WaaP agent wallets at once.

> v1 prototype. Report issues in [holonym-foundation/agent-exchange](https://github.com/holonym-foundation/agent-exchange/issues).

## What it does

Wraps [`@human.tech/waap-cli`](https://www.npmjs.com/package/@human.tech/waap-cli) with a fleet registry so one operator can:

| | |
|---|---|
| `aex-fleet add` | Register an agent in the fleet |
| `aex-fleet ls` | List agents, addresses, balances, tags |
| `aex-fleet use` | Set the active agent for subsequent commands |
| `aex-fleet rm` | Remove an agent from the registry (wallet untouched) |
| `aex-fleet waap …` | Pass through to `waap-cli` scoped to the active agent |
| `aex-fleet exec …` | Run trusted local code with the active agent's WaaP profile |
| `aex-fleet policy get/set` | Inspect / set policy in bulk via `--all`, `--tag`, `--agent` |
| `aex-fleet autopay enable/disable/pause/resume/status` | Arm policy-bounded buyer autopay (auto-buy + auto-renew the compute lease) |
| `aex-fleet renew [--watch]` | Renewal loop — re-buy near-expiry leases within the consented cap (one-shot or daemon) |
| `aex-fleet status` | Aggregate balances, last activity, errors (24h) from Neon |
| `aex-fleet plan` / `aex-fleet apply` | Two-phase bulk ops — preview, then approve |
| `aex-fleet doctor` | Health-check the runtime |

Every read command supports `--json` for AI-shell consumption. Every side-effecting verb supports `--dry-run` (or the `plan`/`apply` flow).

## AI shells drive this natively

The `SKILL.md` at the package root + the `templates/claude-code/CLAUDE.md` project primer let Claude Code (or Cursor / opencode) invoke `aex-fleet` via the shell's native Bash tool. No MCP server required. See [`examples/demo.claude-code.md`](./examples/demo.claude-code.md) for a session transcript.

## Quick start

```bash
# Install (aex-fleet is not published to npm yet; build it from this repository)
npm install -g @human.tech/waap-cli@2.2.1
git clone https://github.com/holonym-foundation/agent-exchange.git
cd agent-exchange/packages/aex-fleet && npm ci && npm run build && npm link

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

## Buyer autopay

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
  sessions/<agent-id>/pending-registration.json   # resumable WaaP signup, when present
  sandboxes/<agent-id>/.lock                      # fleet command lock only
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

- **Per-agent scoping**: capture, passthrough, `exec` and local deployment set `WAAP_CLI_SESSION_DIR` to the agent's canonical `sessions/<agent-id>` directory. An inherited operator setting cannot override this selection. `HOME` remains unchanged.
- **Credentials**: WaaP reads/writes its session directly; fleet does not copy it back after a command. Session deletion stays deleted and pending signup state survives interruption. Directories use mode `0700`, session files `0600`.
- **Trust boundary**: these are profiles for one trusted local operator, not OS sandboxes. `exec` and local deployment can access the operator's other files and inherited environment. Run only trusted code here; enforce wallet permissions at WaaP. Detached local agents do not hold the fleet command lock for their lifetime. Do not run simultaneous authentication/session-mutating commands against a profile used by a running agent.
- **Telemetry**: read-only Postgres against the AEX telemetry schema (`agent_events`, `agent_balance_snapshots`). No schema changes.
- **Wallet linking**: consumes the upcoming `waap_linkAddress` SDK methods. Linkage verbs are gated behind `--feature linking` until they ship — see [`KNOWN_ISSUES.md`](./KNOWN_ISSUES.md).

### Upgrading the session adapter

Compatibility is tested against published WaaP CLI **2.2.1**. Upgrade the CLI before using this adapter. Existing `sessions/<agent-id>/session.json` files remain in place; fleet does not rewrite their format. If WaaP rejects a legacy session, authenticate again through `aex-fleet waap login` for that agent.

Old `sandboxes/<agent-id>/.waap-agent` or `.waap-cli` copies are never imported or restored. Stop older fleet processes before upgrading. Reauthenticate the affected agents instead of copying stale tokens. After confirming access, review and remove obsolete local copies; deleting a file alone does not revoke a remote credential. Use WaaP logout and check its remote-revocation result. Separate staging and production using different `AEX_FLEET_HOME` roots together with the corresponding `WAAP_CLI_ENV`.

`npm ci && npm run type-check && npm test && npm run build` runs the adapter tests and the actual published CLI with synthetic sessions and network access blocked. Coverage includes three concurrent profiles, metadata redaction, session deletion, registration-file retention and unchanged HOME. It does not prove live login, remote logout/revocation, transaction policy enforcement or funded recipe execution.

## Status of v1

Day 1–7 of a one-week prototype:

- [x] Day 1 — scaffold, `FleetManager`, locked `fleet.json`, `add`/`ls`/`use`/`rm`
- [x] Day 2 — `waap-runner` per-agent session directory, file-backed session store, `exec` + `waap` passthrough
- [x] Day 3 — `policy get/set` with `--all`/`--tag`/`--agent` + result table + EventEmitter
- [x] Day 4 — Neon read-only client + `status` (3 aggregate queries) + graceful degradation
- [x] Day 5 — `doctor`, `SKILL.md`, Claude Code template, demo script
- [x] Day 6 — `plan` / `apply` two-phase + `--dry-run` on side-effecting verbs + `--help` polish
- [x] Day 7 — Claude Code demo transcript, `KNOWN_ISSUES.md`, WaaP session-directory compatibility

What's deferred and why → [`KNOWN_ISSUES.md`](./KNOWN_ISSUES.md).

## License

Apache-2.0
