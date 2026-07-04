---
name: claim-watch
description: Detect when a farmed airdrop's claim goes LIVE (contract deployed / merkle root set / Merkl claimable / allocation endpoint live) using keyless public RPC + the public Merkl API — then claim via waap-cli or hand off to the owner. Self-contained: no API keys, no external service.
license: MIT
metadata:
  author: human.tech
  version: "0.1.0"
---

# Claim-watch

Your **Phase 3** capability as an Airdrop Farmer: catch the drop the moment it's claimable, so you
never miss a window. It runs entirely from your own container — public RPC + the public Merkl API,
no keys, no AEX backend. You are self-sustaining.

## When to use
Each cycle, for **every opportunity you have farmed** (you track these in your own MEMORY — see
below), check whether its claim has gone live.

## What to track in MEMORY
When you farm an opportunity, record in your memory: the **project**, the **chain id**, and — as
soon as research reveals it — the **distributor/claim contract address** (and, if known, the no-arg
root-getter selector, e.g. `merkleRoot()`, and any allocation-checker URL). That memory is your
source of truth for what to watch — you do not depend on any AEX service to remember it.

## How to check (one opportunity)
Run the script with what you know (more inputs = more signals; any one positive ⇒ live):
```bash
python3 skills/claim-watch/scripts/claim_check.py \
  --chain 8453 \
  --distributor 0xDISTRIBUTOR \
  --wallet $(waap-cli whoami --json | jq -r .evmWalletAddress) \
  [--merkle-selector 0xSELECTOR] \
  [--alloc-url 'https://project.xyz/api/eligibility?address={wallet}']
```
It prints JSON, e.g.:
```json
{ "live": true, "chain": 8453,
  "signals": { "distributor_deployed": true, "merkl_claimable": true },
  "claimable": [ { "token": "OP", "amount": "1500000000000000000000" } ] }
```
Signals: `distributor_deployed` (contract now has code), `merkle_root_set` (root getter non-zero —
needs `--merkle-selector`), `merkl_claimable` (Merkl reports a reward for your wallet),
`allocation_live` (project endpoint returns data). If you only know the project (no distributor
yet), still run it with `--wallet` for the Merkl check, and keep searching for the distributor.

## What to do when `live` is true
Respect the recipe's policy (`CLAIM_MODE`, `CLAIM_MAX_USD`, `AGENT_DRY_RUN`, `CLAIM_AUTOSECURE`):
- **CLAIM_MODE = notify** (default) or **AGENT_DRY_RUN = 1** → send the owner a Telegram message
  with the project, what's claimable, and the claim link/contract. Do not move funds.
- **CLAIM_MODE = auto** and not dry-run and the claim cost ≤ `CLAIM_MAX_USD` → build and send the
  claim transaction with `waap-cli` (your own MPC wallet). Then, if `CLAIM_AUTOSECURE = 1`, move the
  proceeds to a stable to beat the dump. Report the tx.
- **Always at least notify** — never silently miss a live claim.

## Cadence
Check more often as a rumored claim date nears (daily → hourly). Public RPC + Merkl are keyless and
rate-tolerant; be polite (a few calls per opportunity per cycle).

## Self-sustaining by design
No API keys required. Public RPCs (PublicNode + a fallback per chain), the public Merkl API, your
own MEMORY for what to watch, your own `waap-cli` wallet to claim, and your own Telegram to hand
off. If the operator later provides `ETHERSCAN_API_KEY` / an Alchemy WSS URL in your env, you may
use them for faster/real-time detection — but you do not require them.
