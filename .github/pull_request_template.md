<!-- This repo is PUBLIC. Every commit is permanent + world-readable. -->

## What & why


## Public-repo hygiene checklist
- [ ] No secrets (private keys, mnemonics, DSNs, API tokens, passwords).
- [ ] No infrastructure: box IPs, internal hostnames, managed-DB endpoint/branch names.
- [ ] No operational wallet addresses — any new `0x…` address is a **public token/contract** or a placeholder.
- [ ] No internal-only content (`deployments/`, internal instances, runtime internals, `*.internal.md`, strategy/handoff docs, `.env*`).
- [ ] `scripts/repo-guard.sh` passes locally (or CI `guard` is green).

See `PUBLIC-REPO-POLICY.md`.
