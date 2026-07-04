# aex-fleet — team testing guide

A self-contained dashboard that demonstrates managing a fleet of WaaP agent wallets:
**Sign in (Human Wallet) → Create agents → Fund → Run → Observe**, with policy controls and a
wallet-linking preview. This guide gets you from clone to a working demo in ~5 minutes.

> Branch: `shady/aex-fleet-v1` · PR: holonym-foundation/aex#23 · Tracking: internal-docs#1166

---

## 1. Run it (pick one)

### Option A — local (fastest, for poking at it)
```bash
git clone git@github.com:holonym-foundation/aex.git
cd aex && git checkout shady/aex-fleet-v1
cd packages/aex-fleet
npm install && npm run build

# clean demo slate (does NOT touch any real fleet):
AEX_FLEET_HOME=$(mktemp -d) node dist/index.js dashboard --port 3005
```
Open **http://localhost:3005**. (Hard-refresh — Cmd/Ctrl-Shift-R — after any rebuild.)

### Option B — Docker (self-contained, closest to a deploy)
```bash
cd packages/aex-fleet
docker build -t aex-fleet:dev .
docker run --rm -it -p 127.0.0.1:3005:3001 -v aex-fleet-demo:/var/lib/aex-fleet aex-fleet:dev
```
`@human.tech/waap-cli` + the loop script are baked into the image; state persists in the
`aex-fleet-demo` volume.

> `waap-cli` only needs to be installed for the **Run** step (headless agent signup) and the
> server-side fund sweep. The Docker image includes it; for local Option A:
> `npm install -g @human.tech/waap-cli`.

---

## 2. Walk the pipeline

1. **Sign in (top-right "Sign in with WaaP")** — opens the hosted Human Wallet (social/email,
   no extension). After login you become the **operator**: your wallet is the identity anchor +
   funding source, and your email auto-fills the rest of the flow. The chain is switched to
   Sepolia automatically in the background.
   - *Don't want to use a personal wallet?* Click the operator chip → "designate an existing
     wallet" to use a pre-funded agent instead (no sign-in).
2. **Create agents** — signs up N WaaP wallets (≈30 s each; it's real signup). They auto-enroll
   under your identity.
3. **Fund** — sends Sepolia ETH from your operator wallet to each agent.
   - If your operator is a **Human Wallet** (browser-signed), funding is signed **in your wallet**
     (a signature popup per transfer; the modal shows an intermediate screen between them).
     **Your operator wallet must hold Sepolia ETH** — faucet it first:
     https://sepolia-faucet.pk910.de
   - If your operator is a **designated CLI agent**, funding sweeps server-side (no popups).
4. **Run** — starts the perpetual round-robin (agents pass ETH to each other). Pause / Resume /
   Stop from the same card.
5. **Observe** — the live transaction feed at the bottom fills in as hops confirm (Etherscan
   links per tx).

**Fleet details & bulk controls** (collapsible, bottom): full agent table, per-agent ⚙ policy +
＋ labels, and "Set policy by tag" across the fleet.

---

## 3. What's real vs preview

| Piece | Status |
|---|---|
| Human Wallet sign-in (`@silk-wallet/silk-wallet-sdk`) | **real** — hosted social/email login |
| Browser-side funding (operator signs real txs) | **real** — Sepolia `eth_sendTransaction` |
| Server-side funding (CLI treasury sweep) | **real** — via `waap-cli` |
| Agent signup, send-tx, policy set | **real** — `waap-cli` |
| Live balances | **real** — viem RPC |
| **Wallet linking** ("enroll under identity") | **PREVIEW** — local stub mirroring silk#903/#904; swaps in when they merge |
| ERC-8004 identity | **intent only** — no on-chain mint yet |

See `KNOWN_ISSUES.md` for the exact swap points.

---

## 4. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Buttons do nothing | Hard-refresh (cached old JS). Check browser console. |
| Sign-in: no popup | The SDK lazy-loads from esm.sh on click — needs internet. Console shows import errors. |
| Fund: "Insufficient funds for gas" | Your **operator wallet** has no Sepolia ETH — faucet it (it's the source). |
| Policy "no wallet yet" | That agent was registered but never signed up — it has no wallet session. |
| Dashboard empty | You're on a fresh `AEX_FLEET_HOME`. Sign in + Create to populate. |
| Port in use | `--port <n>` (local) or change the `-p` mapping (Docker). |

---

## 5. Give feedback

Drop notes on **holonym-foundation/aex#23** (the PR) or internal-docs#1166. Useful to report:
which step, what you clicked, what the toast/modal said, and a screenshot if the UI looked wrong.
