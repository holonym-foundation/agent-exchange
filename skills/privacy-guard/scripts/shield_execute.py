#!/usr/bin/env python3
"""shield_execute — the execution boundary for a shield plan. MAINNET-GATED stub.

The agent-side brain (linkability, score, privacy_threat, shield_plan) runs today. The actual
on-chain shielding — depositing/withdrawing through Shield (shield.human.tech) — is intentionally
NOT wired here yet. It requires, all landing at the mainnet rollout:
  - the Shield SDK (@human.tech/shield.human.sdk) driven via waap-cli (L1 Permit2 + Aztec ECDSA auth)
  - an in-process Aztec PXE for the private leg (Grumpkin keys; testnet plaintext, TEE before scale)
  - delegated personhood / wallet-linking so the agent's endpoints are Shield-eligible
See docs/specs/privacy-guard-v2.md and the handoffs (shield-wallet-linking-handoff.md,
delegation-handoff.md).

This stub validates the plan and REFUSES to execute, returning a clear gate. It moves nothing.

Usage:
  shield_execute.py --plan plan.json [--net testnet]
"""
import argparse
import json


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--plan", help="path to a shield_plan.py JSON output")
    ap.add_argument("--net", choices=["testnet", "mainnet"], default="testnet")
    a = ap.parse_args()
    plan = {}
    if a.plan:
        try:
            with open(a.plan) as f:
                plan = json.load(f)
        except Exception:
            plan = {}

    ready = bool(plan.get("ready"))
    print(json.dumps({
        "executed": False,
        "gate": "shield-execution-not-wired",
        "reason": ("Shield on-chain execution lands at the mainnet rollout (Aztec v5). It needs the "
                   "Shield SDK via waap-cli + an in-process PXE + delegated personhood/wallet-linking. "
                   "Until then the agent PLANS and hands off; it never deposits/withdraws."),
        "plan_ready": ready,
        "plan_blockers": plan.get("blockers", []),
        "next": "On rollout: replace this stub with the Shield SDK relay (deposit -> private+decorrelate "
                "-> withdraw), per-tranche re-screen, caps, ephemeral key delete-after-confirmed.",
        "refs": ["docs/specs/privacy-guard-v2.md", "docs/specs/shield-wallet-linking-handoff.md",
                 "docs/specs/delegation-handoff.md"],
    }, indent=2))


if __name__ == "__main__":
    main()
