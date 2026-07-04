# Agent Exchange (AEX)

> Discover, deploy, and operate AI agents that move money on-chain.

**Agent Exchange** is human.tech's open catalog of AI agents. Every agent here is a
complete, working program — fork it, or scaffold a new one in 60 seconds with
`npx @human.tech/create-agent-wallet`.

This repository is the **public, open-source home for what builders touch**: the CLI
scaffolder, the agent-activity registry (templates + recipes + audits), and reusable
skills. The hosted Browse UI, the operations backend, and the agents we run ourselves
live in **separate private repos** — nothing here maps our infrastructure or moves our
funds. See [`PUBLIC-REPO-POLICY.md`](./PUBLIC-REPO-POLICY.md).

## What's here

| Path | Purpose |
|------|---------|
| [`packages/create-agent-wallet/`](packages/create-agent-wallet/) | The `npx @human.tech/create-agent-wallet` CLI scaffolder + the **activity registry** it scaffolds from |
| `packages/create-agent-wallet/registry/activities/<slug>/` | One folder per starter agent: manifest, recipe, per-runtime templates, audits |
| [`skills/`](skills/) | Reusable, generic agent skills |
| [`PUBLIC-REPO-POLICY.md`](./PUBLIC-REPO-POLICY.md) | What belongs here, what never does, and how it's enforced |

## Quick start

```bash
npx @human.tech/create-agent-wallet
# pick an activity (Cetus yield, Morpho yield, Polymarket, Snapshot governance, …)
# pick a runtime (Claude, Standalone, OpenClaw, Nous)
# pick a chain
# done — your project runs
```

See [`packages/create-agent-wallet/registry/activities/`](packages/create-agent-wallet/registry/activities/) for the live list of activities.

## Built on WaaP

Every agent uses [WaaP (Wallet-as-a-Protocol)](https://waap.xyz) for signing:

- **Split-key signing.** The agent never holds a whole private key — your share is required for every transaction, so it cannot sign alone.
- **Scoped privileges.** Spend caps, address allowlists, and time windows enforced on-chain.
- **Human-in-the-loop.** High-risk actions ping you for one-tap approval by default.

## Contributing

Read [`CONTRIBUTING.md`](./CONTRIBUTING.md) and [`PUBLIC-REPO-POLICY.md`](./PUBLIC-REPO-POLICY.md).
Enable the local hygiene hook once per clone:

```bash
git config core.hooksPath .githooks
```

Every push/PR is gated by CI (`gitleaks` + `scripts/repo-guard.sh`) — no secrets,
infrastructure, or operational wallets reach a public commit.

## Security

Report vulnerabilities per [`SECURITY.md`](./SECURITY.md). Licensed under [`LICENSE`](./LICENSE).
