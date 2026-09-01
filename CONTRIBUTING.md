# Contributing to AEX

Thanks for considering a contribution. AEX is human.tech's open Agent Exchange — a curated catalog of on-chain agents that anyone can deploy, fork, or extend. Every starter agent in this repository is open source under Apache-2.0.

## How to contribute

1. **Find or open an issue** describing what you want to do. For non-trivial changes (new starter agents, schema changes to `activity.json`, CLI behavior changes), open an issue first so we can discuss before code lands.
2. **Fork the repo** and create a branch off `main`.
3. **Make your changes** with focused commits that each do one thing.
4. **Sign off your commits** (see DCO below).
5. **Open a pull request** referencing the issue. Include enough context that a reviewer can verify the change without re-deriving the reasoning.
6. **Respond to review feedback.** We aim to triage PRs within 5 business days.

## Local setup: pre-commit security review

This repo ships a tracked pre-commit hook in `.githooks/` that runs a best-effort
security review of your staged changes (looking for leaked secrets, injection,
authz bypasses, and similar) before each commit. Git does not enable tracked
hooks automatically, so **run this once** after cloning:

```
git config core.hooksPath .githooks
```

This points git at `.githooks/` for all hooks in this repo. The review covers
both manual commits and commits made by coding agents, since git runs the hook
regardless of who invokes `git commit`.

Notes:

- The reviewer uses the [`claude`](https://docs.claude.com/en/docs/claude-code) CLI. If it isn't installed, the hook **fails open** (skips the review) rather than blocking you.
- It's a best-effort local gate, not an enforcement boundary — override a false positive with `git commit --no-verify`. The authoritative checks run in CI on the PR.
- Default review model is `claude-sonnet-4-6`; set `COMMIT_REVIEW_MODEL=claude-opus-4-8` for a stricter, slower review.

## Developer Certificate of Origin (DCO)

We use the [Developer Certificate of Origin](https://developercertificate.org/) instead of a Contributor License Agreement. Every commit must include a `Signed-off-by:` line:

```
Signed-off-by: Your Name <your.email@example.com>
```

You can add this automatically with `git commit -s`. The DCO is the same one used by the Linux kernel, Docker, GitLab, and Kubernetes — it certifies that you have the right to submit the contribution under the project's license (Apache-2.0).

If you forget to sign off, you can amend with `git commit --amend --signoff` and force-push.

## Adding a new starter agent (Activity)

Everything required to contribute a recipe is public. Start with
[`packages/create-agent-wallet/CONTRIBUTING-ACTIVITY.md`](packages/create-agent-wallet/CONTRIBUTING-ACTIVITY.md),
copy an existing activity, and use the repository's validation command. A contribution
must not depend on a private skill, internal ticket, or undocumented maintainer step.

### Naming convention

For new activities, prefer `[chain]-[protocol]-[action]`. Existing imported recipes may
retain their established slug so links and contribution history remain stable.

Rules:

- All lowercase
- Segments separated by `-` (dash)
- Use dashes throughout; underscores are not accepted by the schema
- Chain prefix first: `evm`, `sui`, `solana`, `stellar`, or `any` (chain-agnostic only)
- Protocol or category second: `morpho`, `polymarket`, `cetus`, `aave`, `snapshot`, `uniswap`, or a category like `trading`, `governance`
- Action last: the agent's verb — `yield-optimizer`, `rebalancer`, `prediction`, `governance-voter`
- Framework variant optional: `-langchain`, `-elizaos`, etc.

Examples: `evm-morpho-yield-optimizer`, `sui-cetus-yield-optimizer`,
`evm-snapshot-governance-voter`, `evm-polymarket-prediction-langchain`.

This slug is canonical across:

- File system: `registry/activities/<slug>/`
- CLI: `npx @human.tech/create-agent-wallet --activity <slug>`
- AEX registry entry: `{ "id": "<slug>" }`
- EIP-8004 registration display name
- Public recipe and generated-project links

### Required fields in `activity.json`

See `cetus-yield-agent/activity.json` as a reference. The authoritative schema is
[`src/registry/types.ts`](packages/create-agent-wallet/src/registry/types.ts); the
activity guide explains each required field and the verification lifecycle.

Safety rails are user-specified — don't invent default spend caps. If your agent moves money, declare a hard cap env var (e.g., `AGENT_MAX_DEPOSIT_USD` or `AGENT_MAX_ORDER_USD`) and document it in `envVars` with `required: true`.

## Code style

- TypeScript / JavaScript: ESM, follow the existing patterns in the repo
- Move (Sui agents): follow the Sui Move style guide
- Markdown: prefer plain prose over heavy formatting
- One commit per logical change; commit messages describe the why, not the what

## Tests

From `packages/create-agent-wallet`, run `npm ci` and `npm run check`. CI runs the same
type-check, unit/integration suite, registry build, and every activity × runtime
scaffold. To iterate on one recipe, run
`npm run validate:activity -- <activity-slug>`.

## Reviewing

Reviewers use the public quality bar and PR checklist. An activity becomes
`verified: true` only after a maintainer reproduces its safe-mode smoke test against
the documented chain/app and records the result in the PR.

## Trademark

"AEX," "Agent Exchange," "human.tech," "WaaP," and "Human Passport" are trademarks of Holonym Foundation. The code in this repository is licensed under Apache-2.0; the trademarks are not. Forks may use the code but should not use the names without permission.

## License

By contributing, you agree your contributions are licensed under [Apache-2.0](./LICENSE).
