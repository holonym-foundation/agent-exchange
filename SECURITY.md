# Security Policy

The Agent Exchange (AEX) and the agents in this repository handle on-chain transactions and credentials. We take security seriously and welcome reports.

## Reporting a vulnerability

**Do not file public GitHub issues for security vulnerabilities.**

Email **security@holonym.id** with:

- A description of the issue
- Reproduction steps and / or proof-of-concept
- Affected component(s) — agent name, package, file path, commit hash if known
- Your contact details for follow-up

We will:

- Acknowledge within 24 hours during weekdays, 48 hours otherwise
- Triage and provide an initial assessment within 5 business days
- Coordinate disclosure timing with you for high-severity issues

For incidents in production (active exploitation, suspected compromise), additionally page our on-call by mentioning the urgency in the subject line. We follow a 30-minute response SLA for active incidents per the Sui Moonshot security requirements.

## Bug bounty

We do not currently operate a public bug bounty program. We expect to launch one (HackenProof / HackerOne / Immunefi) as agents on AEX cross meaningful TVL thresholds. Reports made before then are still appreciated and acknowledged in release notes when accepted.

## Scope

In scope:

- Source code in this repository (`aex`), including `packages/`, `agents/`, `dashboards/`, and any `.claude/skills/` shipped here
- Generated agent scaffolds produced by `@human.tech/create-agent-wallet`
- Activity manifests (`activity.json`) and the contract they encode

Out of scope (report to those projects directly):

- WaaP itself — see [security@waap.xyz](mailto:security@waap.xyz)
- Human Passport — see [security@holonym.id](mailto:security@holonym.id)
- Sui Foundation infrastructure
- Third-party DeFi protocols an agent interacts with (Cetus, Morpho, Polymarket, Snapshot, Uniswap, etc.)

## Audit posture

WaaP itself has been audited by Cure53, Hexens, Least Authority, and Halborn. See the [WaaP audit summary](https://github.com/holonym-foundation/internal-docs/blob/main/products/waap/research/audit-summary.md) for status.

Per-agent audits (when conducted) are stored in each agent's `audits/` directory in this repository, with provider, date, scope, commit hash, and report link disclosed.

## Coordination with Sui Foundation

AEX agents that operate on Sui follow the [Sui Moonshot 2026 security requirements](https://github.com/holonym-foundation/internal-docs/blob/main/products/waap/research/sui-moonshot-security-requirements.md). For incidents touching Sui agents, we coordinate with Sui Foundation Security and Mysten Labs through a shared incident channel (channel coordination is in flight; contact security@holonym.id for current routing).

## Acknowledgment

We credit reporters in release notes unless anonymity is requested.
