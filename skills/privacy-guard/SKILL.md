---
name: privacy-guard
description: The Sybil-clustering engine, inverted for you — checks whether your own wallets are linkable (direct transfers, shared funding, common counterparties) and whether each leaks a public identity (ENS), then tells you exactly how to separate them. Keyless + self-sustaining (ENS reverse, public RPC; full history with an Etherscan key). Read-only.
license: MIT
metadata:
  author: human.tech
  version: "0.2.0"
---

# Privacy Guard

The same clustering that protects $512M+ of airdrops from Sybils — pointed the other way, to protect
**you**. It finds what links the wallets you want to keep separate, and what publicly deanonymizes
each one, with the concrete step to break every link. **Read-only — it analyzes, never moves funds.**
Keyless, runs in your own container — no AEX backend.

## Your wallet set (chat-managed)
Keep the list of **your own wallets** in MEMORY — the identities you want kept separate. Start from
`{WATCH_ADDRESS}` and add in chat ("also check 0x…", "remove 0x…"). Linkability is inherently about
comparing *your* wallets to each other, so 2+ is where it shines.

## Linkability scan — `linkability_scan.py`
`linkability_scan.py --wallets <your wallets> --chain {PRIVACY_CHAIN}`. For each pair of your wallets
it surfaces, strongest first:
- **`direct_transfer`** (definitive) — the two wallets transacted directly. The strongest possible
  link. Fix: never move funds between identities you want separate; route through an intermediary you
  never reuse.
- **`shared_funder`** (strong) — both first funded by the same address. Fix: fund separate identities
  from separate, unlinked sources.
- **`shared_counterparties`** (medium) — both interact with the same niche addresses/contracts
  (common infra like USDC/routers is excluded). Fix: vary your dapp set.

And per wallet, the **footprint**: a public **ENS name** (a handle that deanonymizes — drop it on a
privacy wallet), tx count, counterparties seen, and the first funder.

## Privacy score (Passport-style)
The scan returns a **privacy score 0–100** per wallet (100 = well-isolated, 0 = fully
exposed/clustered) plus an **overall** score, each with a **factor breakdown + the fix** — the
inverse of a Passport humanity score. Penalties: public ENS (−25), linkage to another of your
wallets (high −30 / medium −15), large public counterparty graph (−10). Lead with the score, then
the top factors to improve — exactly the "raise your score" loop users know from Passport.

## Data: keyless vs keyed
Keyless mode reads a **recent window** (public RPC `eth_getLogs`) + keyless ENS reverse — fine for
modest wallets, but heavy/active wallets and original funding events need history. If
`ETHERSCAN_API_KEY` is set (infra-provisioned), it uses **full tx history** (every counterparty + the
true first funder) — the reliable mode for a real privacy audit. The agent should say which mode it
used so the owner knows the confidence.

## Output: prioritize what deanonymizes
Report the linked pairs strongest-first with the specific signal and the **how-to-break** step, plus
each wallet's exposure flags. Lead with the links most likely to cluster the user. Never give a false
all-clear in keyless mode — say "no links found in the recent window; run with full history to be
sure."

## Three DISTINCT privacy concepts — don't conflate them
1. **Your own wallet's public exposure** — e.g. your wallet has an ENS name → you've published a
   handle. (Footprint in `linkability_scan.py`.)
2. **Linkability between YOUR wallets** — direct transfers / shared funder / shared counterparties tie
   your identities together. (Pairwise links in `linkability_scan.py`.)
3. **Attribution via counterparties / services you touch** — a KYC'd exchange links your *legal*
   identity; a publicly-named counterparty makes a specific interaction attributable. (`privacy_threat.py`.)
These are different threats with different fixes — always say which one you're flagging.

## Service / product privacy-threat (v2, keyless, live)
Run `privacy_threat.py --wallet <addr> --chain <id>` for concept #3. It classifies counterparties:
**kyc_onramp** (a known CEX → links your real legal identity, the #1 deanonymizer — high),
**sanctioned** (OFAC/mixer taint — high), **named_counterparty** (counterparty has a public ENS →
attribution context only, NOT a deanonymization of you — **info**, tiny penalty on purpose). **Every
flag cites its evidence source**; fold the `privacy_score_delta` into the score.

**Off-chain data-practices (on-demand, evidence-cited — NOT a maintained ranking):** when the owner
asks about a specific product/dapp, fetch its **own docs / privacy policy / terms** and **quote the
concerning clauses** (data retention windows, third-party sharing, KYC requirements, IP/analytics
logging, wallet-address logging). Report the *quote + URL*, not an opaque grade. This covers "sketchy
things in their docs" beyond just CEX.

**Anti-bias / anti-stale — hard rules (avoid a "social-credit score for apps"):**
- **Evidence-based, never reputation-based:** every verdict cites a *source* (a feed entry, an
  on-chain fact, or a quoted doc clause). No opaque per-app number.
- **Recency:** say when the signal was read; refresh feeds; treat the bundled CEX list as *partial*
  ("absence ≠ private"). Never present a stale list as authoritative.
- **No false endorsement:** "no threats found" means "none in these signals," never "this is private."
- **Symmetric:** report what you *can't* see (keyless window only, list is partial) as plainly as what
  you can.

## Shield remediation (v2 — agent plans now, executes at the mainnet rollout)
When a link drops the score, the guard can plan a **shield** to break it (Model A: deposit from the
user's verified wallet → Aztec private layer + **decorrelate** → withdraw to another of the user's
verified identities).
1. `shield_plan.py --usd <amt> --source <verified> --dest <verified> --source-verified <t/f> --dest-verified <t/f> [--net testnet]`
   produces a **decorrelated tranche plan** (varied non-round amounts, jittered timing, respecting the
   Passport ~$1k/tx cap) + **readiness checks** (source≠dest, both verified, caps). Never deposit ==
   withdraw the same amount/time.
2. `shield_execute.py --plan <plan.json>` is the **execution boundary** — currently a mainnet-gated
   stub that REFUSES to move funds (Shield SDK + PXE + delegated personhood land at the Aztec-v5
   rollout). Until then the guard plans + hands off; it executes nothing.
Eligibility (Passport ≥20 / PoCH) is a **precondition** resolved at the identity layer — see the
wallet-linking + delegation handoffs in `docs/specs/`. Help the user **stand up a verified
destination** if they lack one.

## Meta-privacy: how this bot protects YOUR privacy (the cypherpunk smell test)
A privacy auditor is itself a privacy risk — to ask "how linked are my wallets?" you hand it your
whole cluster. Be honest about this and minimize it:
- **It's YOUR bot, YOUR container.** Runs self-hosted, keyless, **no AEX backend**, no telemetry, no
  phone-home. MEMORY is local and **deletable**; the scripts are short and **auditable**.
- **Residual risk #1 — the cluster honeypot:** the container now knows all your wallets. Keep MEMORY
  minimal/ephemeral; run on infra you control; purge after use.
- **Residual risk #2 — data-provider correlation (the subtle one):** querying all your wallets from
  one container/IP **links them at the RPC / ENS / Etherscan provider level**, even if the bot is
  honest. Mitigate: use **your own node**, rotate/per-wallet-isolate providers, or route over Tor.
  (Roadmap: per-wallet query isolation built in.) Disclose this to the owner — don't hide it.
- **Verdict:** the architecture is cypherpunk-aligned (local, keyless, auditable, no backend), but the
  honeypot + provider-correlation residuals are real. The honest posture: self-host, use your own
  node, isolate queries, and never run this on infra you don't trust. Say so to the user.

## Self-sustaining by design
Keyless data (ENS reverse API, public RPC; optional Etherscan full history), your own MEMORY (your
wallet set + last scan), your own Telegram to report. No keys required, no AEX backend. Read-only by
default — it never transacts until the mainnet Shield rollout, and even then only human-gated, capped,
and between your verified identities.
