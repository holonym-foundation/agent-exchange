# Demo: driving `aex-fleet` from Claude Code

This is the AI-shell variant of `examples/demo.sh` — the same flow, but invoked by talking to Claude Code (or Cursor / opencode) instead of typing CLI commands. The point: `aex-fleet`'s `SKILL.md` + the `templates/claude-code/CLAUDE.md` project primer are enough for an AI shell to drive the whole fleet via its native Bash tool. No MCP server, no custom shell.

## One-time setup

1. `npm install -g @human.tech/aex-fleet @human.tech/waap-cli`
2. Copy `node_modules/@human.tech/aex-fleet/templates/claude-code/CLAUDE.md` to your repo root (or to `.claude/CLAUDE.md` if you prefer the agent-only scope).
3. Open the repo in Claude Code. The CLAUDE.md primer plus the skill (auto-discovered by Claude Code's skill system from `SKILL.md` in the installed package) prime the model.

## The session

> **You:** Onboard three Aave yield agents on Sepolia for me. Tag them `yield` and `demo`. After they're up, set a $50 daily limit on all of them, then show me the status.

Claude Code reasons through the SKILL.md, picks `aex-fleet add` and runs three invocations:

```
$ aex-fleet add eth-yield-test-1 --chain ethereum --tag yield --tag demo --email user+ethtest1@example.com
Added eth-yield-test-1 to fleet.

$ aex-fleet add eth-yield-test-2 --chain ethereum --tag yield --tag demo --email user+ethtest2@example.com
Added eth-yield-test-2 to fleet.

$ aex-fleet add eth-yield-test-3 --chain ethereum --tag yield --tag demo --email user+ethtest3@example.com
Added eth-yield-test-3 to fleet.
```

It checks the state:

```
$ aex-fleet ls --json
{
  "activeAgent": "eth-yield-test-1",
  "agents": [...]
}
```

For the policy change, Claude Code defaults to the plan/apply two-phase (per the CLAUDE.md guidance) so the human sees what's about to happen:

```
$ aex-fleet plan policy set --tag yield --daily-limit 50
{
  "version": 1,
  "ops": [
    {"op": "policy.set", "agentId": "eth-yield-test-1", "args": {"dailyLimit": "50"}},
    {"op": "policy.set", "agentId": "eth-yield-test-2", "args": {"dailyLimit": "50"}},
    {"op": "policy.set", "agentId": "eth-yield-test-3", "args": {"dailyLimit": "50"}}
  ]
}
```

> **Claude:** Here's the plan — 3 ops, $50/day on each yield agent. Apply?
>
> **You:** Yes.

```
$ aex-fleet plan policy set --tag yield --daily-limit 50 | aex-fleet apply --yes --json
{
  "total": 3,
  "failed": 0,
  "results": [...]
}
```

Then the status:

```
$ aex-fleet status --json
{
  "summary": {
    "fleetSize": 3,
    "telemetryConnected": true,
    "totalErrorsLast24h": 0,
    ...
  },
  ...
}
```

> **Claude:** All three agents onboarded and policy-set. Telemetry shows zero errors in the last 24h. Active agent is `eth-yield-test-1`. Want me to drive a test transaction on it?

## What this proves

- The model picks the right verb sequence ("onboard three" → three `add` calls, "set $50 daily" → `plan policy set` then `apply --yes`).
- Tool calls are visible (Claude Code streams every Bash invocation in its TUI).
- Inline approval works (Claude Code asks before applying side-effecting ops because the CLAUDE.md primer tells it to default to plan/apply).
- Structured output (`--json`) means no table parsing — the model reads the data shape directly.
- Active-agent context is implicit (the model didn't need to be told which agent to act on after `add`).

That's five of the six "Claude Code addictiveness" elements, delivered for free. The sixth (domain-specific UI affordances like a balance bar or signing diff) is the open hypothesis — revisit if operator feedback demands it.
