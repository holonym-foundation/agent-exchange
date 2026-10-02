# Agent Exchange (AEX)

> Discover, deploy, and operate AI agents that move money on-chain.

**Agent Exchange** is human.tech's open catalog of AI agents. Every published activity
includes a complete, reviewable starter — fork it, or scaffold one in 60 seconds with
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
| `packages/create-agent-wallet/registry/activities/<slug>/` | One folder per starter agent: manifest, guide, history, and per-runtime templates |
| [`packages/aex-fleet/`](packages/aex-fleet/) | Experimental fleet-operations CLI; not required to create or run a recipe |
| [`skills/`](skills/) | Reusable, generic agent skills |
| [`PUBLIC-REPO-POLICY.md`](./PUBLIC-REPO-POLICY.md) | What belongs here, what never does, and how it's enforced |

## Quick start

```bash
npx @human.tech/create-agent-wallet@latest
# pick Cetus Yield Agent
# pick a runtime (Claude, Standalone, OpenClaw, Nous)
# done — your project runs
```

The public Cetus release requires CLI `0.1.0` or newer. Until that version is
published to npm, build and run the CLI from this repository; the older npm `0.0.1`
package comes from the archived repository and does not contain the safety updates in
this tree.

See [`packages/create-agent-wallet/registry/activities/`](packages/create-agent-wallet/registry/activities/) for the live list of activities.

## Featured recipe: Cetus Yield Agent

The first public activity is the [Cetus Yield Agent](packages/create-agent-wallet/registry/activities/cetus-yield-agent/README.md),
an autonomous concentrated-liquidity agent for Cetus Protocol on Sui. It ships in safe
monitor mode, includes a transaction-simulation path, and requires an explicit USD cap
before active mode can move funds. Its extracted contribution history is retained in Git
and summarized in the activity's [`HISTORY.md`](packages/create-agent-wallet/registry/activities/cetus-yield-agent/HISTORY.md).
The exact public verification scope and commands are recorded in
[`VERIFICATION.md`](packages/create-agent-wallet/registry/activities/cetus-yield-agent/VERIFICATION.md).

## Built on WaaP

Every agent uses [WaaP (Wallet-as-a-Protocol)](https://waap.xyz) for signing:

- **Split-key signing.** The agent never holds a whole private key — your share is required for every transaction, so it cannot sign alone.
- **Scoped privileges.** Spend caps, address allowlists, and time windows enforced on-chain.
- **Human-in-the-loop.** High-risk actions ping you for one-tap approval by default.

## Contributing

To add another recipe, start with the public
[`activity contribution guide`](packages/create-agent-wallet/CONTRIBUTING-ACTIVITY.md),
then read [`CONTRIBUTING.md`](./CONTRIBUTING.md) and
[`PUBLIC-REPO-POLICY.md`](./PUBLIC-REPO-POLICY.md).
Enable the local hygiene hook once per clone:

```bash
git config core.hooksPath .githooks
```

Every push/PR is gated by CI (`gitleaks` + `scripts/repo-guard.sh`) — no secrets,
infrastructure, or operational wallets reach a public commit.

## Security

Report vulnerabilities per [`SECURITY.md`](./SECURITY.md). Licensed under [`LICENSE`](./LICENSE).
