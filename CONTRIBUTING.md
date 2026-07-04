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

The fastest path is the [`caw-add-activity`](.claude/skills/caw-add-activity/SKILL.md) maintainer skill, which scaffolds all required files across the four runtime adapters (Claude, Standalone, OpenClaw, Nous/Hermes).

Manual path: copy an existing activity in `packages/create-agent-wallet/registry/activities/` as a starting point, write your `activity.json`, and follow the naming convention below.

### Naming convention

Activity slugs follow the pattern: `[chain]-[protocol_or_category]-[action][-framework?]`

Rules:

- All lowercase
- Segments separated by `-` (dash)
- Multi-word tokens within a segment use `_` (underscore) — e.g., `yield_optimizer`, `governance_voter`
- Chain prefix first: `evm`, `sui`, `solana`, `stellar`, or `any` (chain-agnostic only)
- Protocol or category second: `morpho`, `polymarket`, `cetus`, `aave`, `snapshot`, `uniswap`, or a category like `trading`, `governance`
- Action last: the agent's verb — `yield_optimizer`, `rebalancer`, `prediction`, `governance_voter`
- Framework variant optional: `-langchain`, `-elizaos`, etc.

Examples: `evm-morpho-yield_optimizer`, `sui-cetus-yield_optimizer`, `evm-snapshot-governance_voter`, `evm-polymarket-prediction-langchain`.

This slug is canonical across:

- File system: `registry/activities/<slug>/`
- CLI: `npx @human.tech/create-agent-wallet --activity <slug>`
- AEX registry entry: `{ "id": "<slug>" }`
- EIP-8004 registration display name
- Internal-docs `starters/<slug>.md` path

### Required fields in `activity.json`

See an existing activity (e.g., `cetus-yield-agent/activity.json`) as a reference. Required fields include `slug`, `name`, `description`, `version`, `author`, `chain`, `category`, `protocols`, `runtimes`, `envVars`, `waapFeatures`, and the `eip8004` block.

Safety rails are user-specified — don't invent default spend caps. If your agent moves money, declare a hard cap env var (e.g., `AGENT_MAX_DEPOSIT_USD` or `AGENT_MAX_ORDER_USD`) and document it in `envVars` with `required: true`.

## Code style

- TypeScript / JavaScript: ESM, follow the existing patterns in the repo
- Move (Sui agents): follow the Sui Move style guide
- Markdown: prefer plain prose over heavy formatting
- One commit per logical change; commit messages describe the why, not the what

## Tests

PRs that change CLI behavior or activity schemas need passing tests. Run the existing suite (see the relevant package's `README.md`). The weekly template-health workflow smoke-tests every activity × runtime cell — your activity should pass before being added to the registry.

## Reviewing

Maintainers can use the [`caw-audit`](.claude/skills/caw-audit/SKILL.md) skill to run the 8-category registry health check on a contribution.

## Trademark

"AEX," "Agent Exchange," "human.tech," "WaaP," and "Human Passport" are trademarks of Holonym Foundation. The code in this repository is licensed under Apache-2.0; the trademarks are not. Forks may use the code but should not use the names without permission.

## License

By contributing, you agree your contributions are licensed under [Apache-2.0](./LICENSE).
