# claim-watch skill

The Airdrop Farmer's **Phase 3** capability — detect when a farmed opportunity's airdrop claim
goes **live**, then claim (`waap-cli`) or hand off (Telegram). Runs **entirely inside the agent's
own container** — no AEX backend, no API keys required. Agents stay self-sustaining.

```
skills/claim-watch/
├── SKILL.md                 # instructions the model loads (when/how to use it)
└── scripts/claim_check.py   # keyless probe: public RPC + public Merkl API, stdlib only
```

## Why it's self-sustaining
- **Detection** — `claim_check.py` uses keyless public RPCs (PublicNode + a per-chain fallback) and
  the public Merkl API. No keys, no AEX service.
- **What to watch** — the agent's **own MEMORY** (the opportunities it farmed + their distributor
  addresses), not a server lookup.
- **Acting** — the agent's **own `waap-cli` MPC wallet** to claim; its **own Telegram** (Hermes
  gateway) to notify. Nothing routes through AEX infra.

So an agent keeps watching and claiming even if the AEX control plane is unavailable — which is the
point: agents should not depend on AEX infra unless there's a strong reason.

## Integration (runtime)
Bake this directory into the agent runtime image (`aex-agent-runtime` / `agent-base`) so the agent
loads it as a skill, the same way the `waap-cli` skill is provided. The Airdrop Scout→Farmer recipe
(`agents/autoresearch/activity.json`) Phase 3 already invokes it by path. No per-tenant config
needed.

## Optional acceleration (not required)
If the operator sets `ETHERSCAN_API_KEY` or an Alchemy WSS URL in the agent's env, the watcher can
later use them for faster / real-time (`eth_subscribe`) detection. Absent them, it falls back to
keyless polling — and still works.

## Test
```bash
# a deployed contract → distributor_deployed: true, live: true
python3 scripts/claim_check.py --chain 8453 \
  --distributor 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 \
  --wallet 0xYourAgentWallet
```
