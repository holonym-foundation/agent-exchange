# Known issues — v1 prototype

Honest list of what's intentionally deferred or still rough.

## Intentionally deferred

### Wallet linking verbs (`link` / `unlink`)

**Status:** stub. `aex-fleet link` and `aex-fleet unlink` are not registered yet because Lucian's `waap_linkAddress` / `waap_unlinkAddress` SDK methods in `@human.tech/waap-sdk` aren't shipped yet. The linkage column in `ls` will stay blank until they ship. The plan reserves `--feature linking` as the gating flag.

**Next step:** confirm Lucian's ship date, then add the verbs + wire `linkage.ts` against the SDK. Surface aggregate Passport humanity score in `status` when the operator has an anchor address.

### Embedded WaaP sign-in is REAL; browser-funding needs operator ETH

The "Sign in with WaaP" operator step uses the published `@silk-wallet/silk-wallet-sdk@1.0.2`,
lazy-loaded from esm.sh on click (sign-in is inherently online). `initSilk()` → `window.silk`
EIP-1193 provider → `eth_requestAccounts` opens the hosted Human Wallet (social/email) — **no
WalletConnect projectId needed** (that's only for external wallets). The connected address is
registered as the `operator` agent (anchor + treasury) via `POST /api/operator/connect`.

Because that wallet is browser-signed (no CLI session), funding from it runs **client-side**:
`window.silk` signs real `eth_sendTransaction`s to each agent (opens the WaaP signing UX per
transfer). The operator's Human Wallet must hold Sepolia ETH. Caveats:
- Couldn't fully test the hosted modal here (needs a human + real wallet); wiring follows the
  documented API and the SDK module + `initSilk` export are verified to load.
- esm.sh is a runtime dependency for sign-in only; the rest of the dashboard stays offline-capable.
- Browser-funded operators can't drive the headless loop (no CLI session) — that's correct: the
  loop's agents use CLI signup; only the operator uses the browser wallet.

### Wallet linking is a front-end PROTOTYPE (not yet real on-chain linking)

**Status:** demonstrator. The dashboard's "Link" pipeline step + the `/api/fleet/link`,
`/api/fleet/unlink`, `/api/agents/:id/link|unlink` endpoints currently just write `linkedTo`
to `fleet.json` locally. They mirror the *shape* of Lucian's wallet-linking work so the swap is
a drop-in.

**Swap when these merge:**
- [`silk#904`](https://github.com/holonym-foundation/silk/pull/904) — `linkAddress` / `unlinkAddress` / `getLinkedAddresses` SDK methods (via WalletConnect AppKit signer — the operator signs a SIWE message). Replace the `fleet.json` write in the link endpoints with these calls.
- [`silk#903`](https://github.com/holonym-foundation/silk/pull/903) — `GET /api/public/linked-wallets/by-address/:address` public read endpoint. Use it in `status` / the cluster panel to show the real cluster + Passport humanity score, replacing the locally-derived `operator.clusterSize`.

The demonstrator establishes the narrative (operator wallet = treasury = identity anchor; agents
link to it) and the UI surface; the model is correct, only the backend call is stubbed. Tracked
under [`internal-docs#1058`](https://github.com/holonym-foundation/internal-docs/issues/1058).

### ERC-8004 actual on-chain minting (v1.0.2 ships intent-only)

**Status:** stub. `aex-fleet erc8004 register …` and `add --register-erc8004` record intent in `fleet.json` but do NOT mint on-chain because EIP-8004 is Draft and no canonical singleton deployment exists. All registrations show `pending — contracts not yet deployed`.

**Next step:** populate `CONTRACTS_BY_CHAIN` in `src/core/erc8004.ts` with Identity Registry + Reputation Registry addresses (Sepolia first for testnet, then Ethereum mainnet). Wire the actual `register(agentURI, metadata) → uint256` call using `viem`. Host registration files at `https://aex.human.tech/agents/<tokenId>.json` (or `data:` inline as a sovereign fallback). See [`holonym-foundation/internal-docs#1166`](https://github.com/holonym-foundation/internal-docs/issues/1166) for the integration sketch.

### Forked-opencode "wallet shell"

**Status:** not started, **and explicitly not planned for v1.x**. The hypothesis is that domain-specific UI affordances (balance bar, signing-diff renderer, Privilege ribbon) would justify a fork. The hypothesis is untested. Run the CLI + skill + Claude Code combo for a week first; if operators ask for those affordances, fork.

### MCP server

**Status:** not built, **deliberately**. MCP is a second transport layer wrapping the same CLI — all maintenance, no marginal capability while `--help` / `--json` / `--simulate` cover the surface. Revisit only if a real use case (e.g. streaming progress into a custom dashboard) exposes a gap the CLI can't fill.

### Bulk Privilege grants (`waap-cli request-permission` across the fleet)

**Status:** not implemented. Each Privilege grant requires an independent 2FA approval — bulk-granting across N agents would require N out-of-band approval flows. Out of v1 budget.

**Next step:** scope a bounded version (e.g. grant the same scope to a small group, batch the 2FA prompts into one out-of-band push). Open a follow-up issue when an operator hits this need.

### Cross-operator 2FA routing

**Status:** not implemented. v1 assumes a single operator who owns every agent's 2FA channel. "Alice owns the Morpho agent's 2FA, Bob owns the Polymarket agent's 2FA" is a v2 concern.

## Rough edges in v1

### `HOME`-sandbox trick

Each `aex-fleet waap …` invocation spawns `waap-cli` with `HOME` overridden to a per-agent sandbox dir. Works today, but a `WAAP_CONFIG_DIR` env var upstream would be cleaner. Filed upstream as **[`holonym-foundation/silk#907`](https://github.com/holonym-foundation/silk/issues/907)** — once it lands, `core/waap-runner.ts` swaps from the `HOME` override to `WAAP_CONFIG_DIR` (a few-line change).

### Keychain backend is file-only

The session store at `core/keychain.ts` is file-backed (mode `0600`) rather than wired to the OS keychain. The plan called for `keytar` — but `keytar` was deprecated by its maintainers in late 2023. Swap in `@napi-rs/keyring` (or a stable successor) once one settles; the `keychain.ts` surface is the swap point.

### `status` queries are conservative

The three Neon queries shipped today (latest balance per agent, last event timestamp, error count last 24h) work against the schema documented in `prd/aex/agent-runtime.md`. Total-spend-across-fleet would require knowing the exact `agent_events.data` jsonb keys per agent template, which varies — left out of v1 to avoid speculative columns. Add per-template aggregators when tx event shapes settle.

### Bulk ops are sequential

`policy set --all` runs agents one at a time. 2FA prompts in `waap-cli` force this — parallelism isn't safe. If 2FA is auto-approved (per-agent policy allows it), parallelisation could halve the wall time for a 10-agent fleet; not in v1.

### `--dry-run` only covers planning side-effects, not waap-cli simulation

`aex-fleet policy set --dry-run` skips invoking `waap-cli`. It does not call `waap-cli` with a `--simulate` equivalent — that would require `waap-cli` itself to have a simulation mode for `policy set`, which it doesn't (and likely doesn't need: policy changes are deterministic). For `waap send-tx`, simulation is on `waap-cli`'s side; pass-through whatever it offers.

### Test suite uses `node` as a fake `waap-cli`

The `test/waap-runner.test.ts` spawns Node with inline scripts to simulate `waap-cli`. Real integration tests against the actual `@human.tech/waap-cli` binary on Sepolia live in `examples/demo.sh` and are not run in CI (no funded test wallet, no faucet automation).

## Tracking

Parent issue: [holonym-foundation/internal-docs#1166](https://github.com/holonym-foundation/internal-docs/issues/1166).
