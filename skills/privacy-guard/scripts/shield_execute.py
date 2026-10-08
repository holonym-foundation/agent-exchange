#!/usr/bin/env python3
"""shield_execute — the execution boundary for a shield plan. Stub: not wired in yet.

The agent-side brain (linkability, score, privacy_threat, shield_plan) runs today. The actual
on-chain shielding — depositing/withdrawing through Shield (shield.human.tech) — is intentionally
NOT wired here yet.

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
        "reason": ("Shield on-chain execution is not wired into this skill yet. Until it is, the agent "
                   "PLANS and hands off; it never deposits/withdraws."),
        "plan_ready": ready,
        "plan_blockers": plan.get("blockers", []),
        "next": "When wired: replace this stub with the Shield SDK relay (deposit -> private+decorrelate "
                "-> withdraw), per-tranche re-screen, caps, ephemeral key delete-after-confirmed.",
    }, indent=2))


if __name__ == "__main__":
    main()
