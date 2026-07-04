# Public-repo policy

This repository is **public**. Everything here — including full git history — is
world-readable forever. Treat every commit as a permanent publication.

The operations backend, hosted UI, per-agent deployments, and internal instances
live in **private** repos (`holonym-foundation/aex-ui`, `…/aex`, `…/aex-agent-runtime`).
Nothing that maps our infrastructure or moves our funds belongs here.

## ✅ What belongs here

- `packages/create-agent-wallet/` — the `npx @human.tech/create-agent-wallet` CLI scaffolder and its **activity registry** (one folder per starter agent: manifest, recipe, per-runtime templates, audits).
- `skills/` — reusable, generic agent skills.
- Governance + docs meant for builders: `README`, `LICENSE`, `SECURITY.md`, `CONTRIBUTING.md`, this policy, and per-activity `README`/audit docs.

Addresses are fine **only** when they are public token/contract addresses (USDC, WETH, routers, ERC-20 event topics) or obvious placeholders (`0x1111…`, `0x0000…`).

## ⛔ What must NEVER be committed

| Category | Examples |
|---|---|
| **Secrets** | private keys, mnemonics/seed phrases, DB connection strings (DSNs), API tokens (`napi_…`, OpenRouter, Brave, TAP), passwords |
| **Infrastructure** | box/server IPs, internal hostnames (`aex-stack`, `aex-native-scm`, `aex-signer`, `aex-registry-main`, `aex-run-forced`), managed-DB endpoint/branch names |
| **Operational wallets** | any wallet address we actually operate (seller, buyer, fee/rake, admin, per-agent runtime wallets) |
| **Internal-only content** | `deployments/`, internally-run agent instances (`agents/`), runtime image internals (`agent-base/`), `*.internal.md`, strategy/handoff/GTM docs, `.env*` |

## How this is enforced

1. **`scripts/repo-guard.sh`** — fails on blocked paths, secrets, infra references, and the operational-wallet **hash denylist** (`scripts/guard/deny-address-hashes.txt` — addresses stored only as SHA-256, never cleartext).
2. **Pre-commit hook** — `git config core.hooksPath .githooks` runs the guard locally before every commit.
3. **CI (`.github/workflows/guard.yml`)** — runs `gitleaks` (broad secret scan over full history) + `repo-guard.sh` on every push/PR. Make it a **required** status check.
4. **`CODEOWNERS` + PR checklist** — human review for anything the automation can't judge (e.g. is a new address really a public contract?).

## If something sensitive lands anyway

A leak is not fixed by a follow-up commit — the value stays in history. Instead:
1. **Rotate/invalidate** the exposed secret immediately (assume it's compromised).
2. Escalate to a maintainer to scrub history (`git filter-repo`) + force-push, or to rebuild the repo from a clean tree.
3. Add a detection pattern to `repo-guard.sh` so it can't recur.
