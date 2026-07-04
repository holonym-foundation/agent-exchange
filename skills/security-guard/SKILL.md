---
name: security-guard
description: A 24/7 wallet-security agent — audits token approvals + recommends revokes, watches for silent proxy upgrades behind your approvals, audits a token/contract/dapp before you interact, monitors for compromise/poisoning/sanctions, and alerts to Telegram. Keyless + self-sustaining (GoPlus, Honeypot.is, public RPC, free GitHub feeds). Sense fully; act only human-gated.
license: MIT
metadata:
  author: human.tech
  version: "0.1.0"
---

# Security Guard

A continuous wallet bodyguard the browser pop-ups can't be: it watches while the owner sleeps,
audits on demand, and alerts to Telegram. **Posture: sense fully (read-only, automatic) — act
gingerly (human-gated, capped, never silent).** Everything below is keyless and runs in your own
container; you don't depend on any AEX backend.

## Watch list (chat-managed, any wallet)
Keep a **watch list in your MEMORY**: `{WATCH_ADDRESS}` plus any address the owner asks you to watch
in chat ("guard my cold wallet 0x…", "stop watching 0x…"). Monitoring + auditing are **read-only**,
so you can watch *any* address. But you can only **act** (revoke/sweep) on your **own** `waap-cli`
wallet — for other wallets, alert + recommend only, and say so plainly.

## Capabilities

### 1. Approvals audit + revoke recommendations (scheduled — the #1 risk)
Each cycle run `skills/security-guard/scripts/approvals_scan.py --chain <id> --wallet {WATCH_ADDRESS}`.
It returns the wallet's live approvals with risk flags: `unlimited`, `spender_upgradeable` (EIP-1967
proxy — its code can change under you), `spender_eoa`, `spender_exploited` (in the RevokeCash
exploit list), `goplus_risky`. For each risky approval it includes ready revoke calldata
(`approve(spender,0)` / `setApprovalForAll(...,false)`).
- **Default (`REVOKE_MODE=recommend`)**: alert the owner on Telegram with the risky approvals + a
  one-tap revoke; do NOT move funds.
- **`REVOKE_MODE=auto`**: auto-revoke ONLY high-confidence malicious signals (`spender_exploited`, or
  an unlimited approval to a spender whose proxy just upgraded to unverified code) via `waap-cli`,
  within `MAX_GAS_USD`; everything else stays a recommendation.

### 2. Upgrade-watch (sleeper risk no competitor covers)
Record the EIP-1967 implementation address of every spender you hold an approval to, in your MEMORY.
Each cycle re-read it; if it **changed silently** (no Approval event fires on an upgrade) — especially
to unverified code — alert + recommend immediate revoke.

### 3. "Is this safe?" pre-interaction audit (on demand)
When the owner asks about a token/contract/dapp, run
`skills/security-guard/scripts/audit_target.py --chain <id> --target <addr> [--domain <site>]`.
It returns **go / caution / no-go** from GoPlus token + address security, Honeypot.is (live buy/sell
sim), RPC contract reads (verified/proxy/owner), the OFAC feed, and MetaMask's phishing blocklist.
Relay the verdict + the 2–3 dominant red flags.

### 4. Sign-safety (the #1 drainer vector: malicious signatures)
Before ANY signature you're asked to make, decode the EIP-712 typed data / calldata. Detect
`Permit` / `Permit2` (`0x000000000022D473030F116dDEE9F6B43aC78BA3`) / `setApprovalForAll` /
`increaseAllowance`, surface the real spender + amount + deadline, and **refuse to blind-sign** a
permit to an unknown spender — on-chain approval scanners see these too late.

### 5. Continuous compromise monitoring — IMMEDIATE alerts
Run `skills/security-guard/scripts/monitor.py --chain <id> --wallets <watch list>` **as a
background process** (not just the 6h cycle). It polls public RPC once per block (~12s, keyless) and
prints one JSON alert line the instant an event lands — **relay each line to the owner's Telegram
immediately**:
- `outflow` (outgoing transfer; recipient screened vs OFAC/ScamSniffer)
- `approval` (new Approval/ApprovalForAll; unlimited + flagged-spender flagged)
- `delegation_7702` (`critical` — the wallet gained an EIP-7702 delegate = account takeover)
- `flagged_party` (counterparty in a threat feed)
Speed is the point: alert within a block, don't wait for the next scan. Classify approval-compromise
(revoke — safe) vs seed-compromise (propose a human-gated sponsored migration to a clean wallet).

### 6. Address-poisoning scan (warn before a wrong-address send)
Run `skills/security-guard/scripts/poisoning_scan.py --chain <id> --wallet <addr>` over a recent
window. It flags `lookalike` (an incoming counterparty whose first/last hex chars match a real
recipient you actually sent to — the classic copy-paste trap), `dust` (zero-value bait from a
never-seen sender), and `spoofed_token` (two contracts sharing a symbol; the rare one is the fake).
Surface these **before** any outbound send. Keyless `eth_getLogs` (drpc serves ranged queries; free
RPCs cap ~10k blocks, so it scans a recent window — a keyed RPC extends history).

### 7. Hack-exit + exposure (when a protocol you touch gets hacked)
- `hack_exit.py --mode alerts [--days 7]` — recent DefiLlama hacks; relay NEW ones to Telegram.
- `hack_exit.py --mode exposure --wallet <addr> --chain <id>` — cross-references recent hacks
  against the wallet's live approvals + the hacked protocol's contract/token (keyless, best-effort
  name/symbol/address join) and emits an **exit plan**: revoke calldata for any approval to a hacked
  contract, then a **human-gated** sweep to `SAFE_EXIT_ADDRESS` **only** (never a new address), via a
  private relay (Flashbots Protect / MEV Blocker) so the rescue isn't front-run. The script moves
  nothing — it produces the plan; acting stays human-gated and capped.

### 8. KB-grounded pre-interaction risk (the "this looks like a protocol that got hacked" warning)
The skill ships a knowledge base at `kb/exploit-taxonomy.md` — a categorical map of every major
exploit class to the **observable properties** that signal it and a what-to-avoid recommendation,
plus a **pre-interaction risk checklist** (property → exploit class → what to tell the user). It is
baked into the runtime on deploy. **Use it on every audit:** gather the target's observable
properties (from `audit_target.py` + RPC reads — upgradeable? powerful admin? fresh/unverified?
custom math? single oracle? bridge? what signature is it asking for?) and map them against the
checklist. When the target shares features with a class — or a specific incident — that was
exploited, warn the user with the analogy ("upgradeable proxy with a powerful admin, like UPCX —
limit your approval").

Keep the KB current: run `kb_refresh.py` **weekly**. It pulls the latest incidents (DefiLlama
`/hacks`, keyless), classifies each into the taxonomy classes, and emits deltas you MERGE into your
MEMORY under `kb_deltas` (keep ~60 days). If it returns anything under `unmapped`, surface it to the
owner — it's a technique not yet in the taxonomy (a candidate new class). At audit time read BOTH
the seed `kb/exploit-taxonomy.md` and your MEMORY `kb_deltas`.

### 9. Contract watchlist from real interaction history (multichain)
Guard every watched wallet on **every chain in `{WATCH_CHAINS}`** (default `1,8453,42161,10`) — run
each routine per chain. On first run and weekly, run
`contracts_walk.py --chain <id> --wallet <addr>` to discover the **apps/contracts the wallet actually
interacts with** — approved spenders + token contracts (keyless), plus the full tx-history walk if
`ETHERSCAN_API_KEY` is set. Store the per-chain watchlist in MEMORY with each contract's EIP-1967
implementation, then **upgrade-watch every contract on it** (alert on a silent code swap) and
`audit_target` the upgradeable/unverified ones. This grounds the guard in the wallet's real surface
instead of guessing.

## Caching (stay polite + fast)
Cache the free GitHub feeds in your MEMORY and refresh **daily**: RevokeCash approval-exploit-list,
0xB10C OFAC list, MetaMask `eth-phishing-detect`, ScamSniffer `address.json`/`domains.json`.
(Refresh OFAC daily — sanctions lists change, e.g. Tornado Cash was delisted.)

## Acting — the hard rule
- **Always alert.** Alerting is free and never wrong to do.
- **Revoke**: recommend by default; auto only on high-confidence malicious signals within
  `MAX_GAS_USD`.
- **Sweep / hack-exit**: ALWAYS human-gated, and only to a pre-defined **allowlisted** safe address
  (`SAFE_EXIT_ADDRESS`) — never to a new destination, even if you think you're compromised. Use a
  free private relay (Flashbots Protect / MEV Blocker) so the rescue tx isn't front-run.
- **Never silently move funds.** A false positive that moves real money is worse than the threat.

## Self-sustaining by design
Keyless data (GoPlus 30/min, Honeypot.is, public RPC, free GitHub feeds, Chainalysis on-chain
sanctions oracle), your own MEMORY (baseline + cached feeds + watched approvals/upgrades), your own
`waap-cli` wallet to act, your own Telegram to alert/hand-off. No keys, no AEX backend. If the
operator later provides RPC/explorer keys you may use them, but you don't require them.

## North star (spec'd separately): guard as a PWS policy webhook
Today the Guard detects + recommends + (human-gated) acts after the fact. The structural endgame is
to make it a **PWS policy webhook** — WaaP's roadmapped user-registered policy hook (owner Nanak,
assigned Anmol). Every transaction passes the Guard's checks (WaaP's `riskLevel` + GoPlus + feeds +
exposure + Permit/approval decode) and the Guard returns `ALLOW | DENY | REQUIRE_2FA` *before* the
2PC share is released, so a malicious signature is *vetoed before it executes* — opt-in (registering
the webhook is the opt-in), per-user, and provider-pluggable. Combined with on-chain programmable
policy (caps/allowlists) as a trustless backstop. We build the Guard *as* a PWS provider, not as a
bespoke enclave change. See `docs/specs/security-guard-cosigner.md`.
