# @human.tech/create-agent-wallet

Scaffold a WaaP agent project in 3 minutes.

```bash
npx @human.tech/create-agent-wallet
```

Interactive prompts pick an **Activity** (what the agent does), a **runtime** (Claude, Standalone, OpenClaw, or Nous/Hermes Agent), and a **project name**. The generator stamps out a working project — you `cd` in, copy `.env.example`, and run.

Part of the [Agent Exchange (AEX)](https://github.com/holonym-foundation/aex).

## Features

- **4 runtimes:** Claude (SKILL.md + CLAUDE.md + MCP config), Standalone (Node.js + Dockerfile), OpenClaw (AgentSkills SKILL.md), and Nous / Hermes Agent (AgentSkills SKILL.md). OpenClaw + Nous share the [AgentSkills open standard](https://agentskills.io/) so the same SKILL.md works across both (and any other AgentSkills-compatible runtime).
- **Curated Activity registry:** 11 launch templates plus a Blank Project scaffold — Polymarket Signal Trader, Polymarket Arbitrage, Polymarket LLM Analyst, Snapshot Governance, Cetus Yield, Morpho Yield, EVM Uniswap Rebalancer, EVM Portfolio Rebalancer, Sui Portfolio Rebalancer, Recurring Payments, CI/CD Agent.
- **Session bootstrapping:** detects `~/.waap-cli/session.json`; prompts inline if absent.
- **Non-interactive mode:** full flag-based usage for CI / agent orchestration.
- **Offline-capable:** bundled registry fallback if `docs.waap.xyz` is unreachable.
- **[EIP-8004](https://eips.ethereum.org/EIPS/eip-8004) ready:** every scaffolded project ships a valid `agent-registration.json` (plus `.well-known/agent-registration.json` for standalone) so the agent is discoverable the moment an Identity Registry contract is deployed.

## Usage

### Interactive (default)

```bash
npx @human.tech/create-agent-wallet
```

### Non-interactive / scripted

```bash
npx @human.tech/create-agent-wallet \
  --activity polymarket-agent \
  --runtime standalone \
  --no-session \
  --yes \
  my-polymarket-bot
```

### Flags

| Flag                                                 | Description                                              |
| ---------------------------------------------------- | -------------------------------------------------------- |
| `-a, --activity <slug>`                              | Pick activity by slug (skips browse)                     |
| `-r, --runtime <claude\|standalone\|openclaw\|nous>` | Pick runtime (skips prompt)                              |
| `--no-session`                                       | Skip WaaP session detection + inline signup              |
| `--registry <url>`                                   | Override registry URL (`http(s)://` or `file://`)        |
| `--no-cache`                                         | Bypass the 24h local cache                               |
| `-y, --yes`                                          | Non-interactive — fail non-zero on missing required args |
| `--version`                                          | Print version                                            |
| `--help`                                             | Print usage                                              |

### Exit codes

| Code | Meaning                            |
| ---- | ---------------------------------- |
| 0    | Success                            |
| 1    | Generic error                      |
| 2    | Invalid args                       |
| 3    | Registry fetch failed and no cache |
| 4    | Activity slug not found            |
| 5    | Project directory already exists   |
| 6    | Session bootstrap failed           |
| 7    | Schema validation error            |

## What gets generated

### Standalone runtime

```
my-agent/
├── package.json              pnpm/npm ready, tsx + execa
├── agent.ts                  your loop — shells out to waap-cli
├── Dockerfile                production container
├── tsconfig.json
├── .env.example              activity-specific env vars
├── .gitignore
├── README.md                 run instructions
├── agent-registration.json   EIP-8004 registration file
└── .well-known/              served alongside the agent for domain-control verification
```

### Claude runtime

```
my-skill/
├── SKILL.md           skill definition Claude Code discovers
├── CLAUDE.md          project context — loaded into Claude's window
├── mcp-config.json    WaaP MCP server wiring
├── .env.example
└── README.md
```

### OpenClaw runtime

```
my-skill/
├── SKILL.md           AgentSkills-compliant skill (agentskills.io)
├── .env.example
└── README.md
```

OpenClaw loads from `~/.openclaw/workspace/skills/<name>/` — copy or symlink the scaffolded folder there.

### Nous / Hermes Agent runtime

```
my-skill/
├── SKILL.md           AgentSkills-compliant skill (agentskills.io)
├── .env.example
└── README.md
```

Hermes Agent loads skills via its Skills Hub. See [hermes-agent.nousresearch.com](https://hermes-agent.nousresearch.com/) for the install + registration commands.

## EIP-8004 alignment

This CLI implements [EIP-8004 "Trustless Agents"](https://eips.ethereum.org/EIPS/eip-8004) (currently Draft) at the **registration file** level. Every scaffolded project includes:

- `agent-registration.json` at the project root — matches the EIP-8004 `registration-v1` shape. Developer edits this, then uploads to IPFS / serves from an HTTPS endpoint, and passes the URI to the on-chain Identity Registry when one exists.
- `.well-known/agent-registration.json` (standalone runtime only) — for the [domain-control verification path](https://eips.ethereum.org/EIPS/eip-8004#agent-registration-file-resolution) when the agent is served from a host the developer controls.

Placeholders are used where on-chain state is required:

- `agentId: "__TODO_AFTER_ON_CHAIN_REGISTRATION__"` — populated after calling `identityRegistry.register(agentURI)`.
- `agentRegistry: "eip155:{chainId}:__TODO_IDENTITY_REGISTRY_ADDRESS__"` — the developer fills in the registry contract address.

### Default trust model

Scaffolded projects default to `supportedTrust: ["tee-attestation"]` because WaaP's 2PC signing terminates in a TEE. Activities can declare `reputation` and `crypto-economic` too in their `activity.json`.

### What's not in v1

- No on-chain `register-agent` flow. That will ship as a `waap-cli register-agent` subcommand once WaaP deploys an Identity Registry or the ecosystem standardizes on one.
- No automatic IPFS publishing. The developer picks their host.

## Registry

Activities live in [`registry/activities/`](./registry/activities). Each directory contains:

- `activity.json` — metadata (schema in [`src/registry/types.ts`](./src/registry/types.ts))
- `README.md` — human description (rendered into docs site)
- `templates/<runtime>/` — files copied on scaffold

A build step aggregates per-activity `activity.json` files into a single `registry.json` published at `docs.waap.xyz/registry.json`. The CLI fetches this once per 24h and caches locally at `~/.create-agent-wallet/registry.json`.

## Contributing an Activity

See [CONTRIBUTING-ACTIVITY.md](./CONTRIBUTING-ACTIVITY.md).

## Design doc

See [docs/plans/002-create-agent-wallet-cli-design-plan-2026-04-20.md](../../docs/plans/002-create-agent-wallet-cli-design-plan-2026-04-20.md).

## License

Apache-2.0 — see [LICENSE](../../LICENSE).
