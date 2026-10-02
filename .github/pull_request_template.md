<!-- This repo is PUBLIC. Every commit is permanent + world-readable. -->

## What & why


## Recipe evidence (complete when adding or changing an activity)

- [ ] The chain/app action and measurable user outcome are stated.
- [ ] `npm run check` passes from `packages/create-agent-wallet`.
- [ ] Every declared runtime scaffolds successfully.
- [ ] The generated standalone project installs and type-checks.
- [ ] A read-only or simulated smoke test is documented with date, network,
      public target identifier, and expected output.
- [ ] Live mode is explicit opt-in and refuses to start without a positive hard cap,
      or this recipe is documented as permanently read-only.
- [ ] Transaction policy, recovery behavior, and known limitations are documented.
- [ ] All prerequisites and recipe links are publicly accessible.
- [ ] Imported work includes provenance and contribution-history mapping.
- [ ] New recipes use `verified: false`; a maintainer flips it only after reproducing
      the smoke test.

## Public-repo hygiene checklist
- [ ] No secrets (private keys, mnemonics, DSNs, API tokens, passwords).
- [ ] No infrastructure: box IPs, internal hostnames, managed-DB endpoint/branch names.
- [ ] No operational wallet addresses — any new `0x…` address is a **public token/contract** or a placeholder.
- [ ] No internal-only content (`deployments/`, internal instances, runtime internals, `*.internal.md`, strategy/handoff docs, `.env*`).
- [ ] `scripts/repo-guard.sh` passes locally (or CI `guard` is green).

See `PUBLIC-REPO-POLICY.md`.
