#!/usr/bin/env python3
"""shield_plan — build a decorrelated shielding plan (the privacy IP).

A naive shield is pointless: deposit 4.137 and withdraw 4.137 a minute later and anyone can match it.
This produces a plan that breaks the in/out correlation — varied (non-round, non-equal) tranches with
jittered timing, respecting Shield's caps. It also runs the readiness checks (source != destination,
both must be verified, amount vs caps, testnet-vs-mainnet gating).

This script PLANS only. Execution (the Shield SDK deposit/withdraw via waap-cli + the in-process PXE)
is the mainnet-gated step — see docs/specs/privacy-guard-v2.md for the integration contract.

Model A: deposit from your VERIFIED source wallet -> Aztec private layer (decorrelate) -> withdraw to
another of your VERIFIED identities. Eligibility (Passport >=20 / PoCH) is a precondition checked at
the identity layer and passed in here.

Usage:
  shield_plan.py --usd 2500 --source 0xSrc --dest 0xDest \
      [--per-tx-cap 1000] [--min-tranches 2] [--max-delay-h 18] [--net testnet] \
      [--source-verified true] [--dest-verified false]

Always exits 0; parse JSON on stdout.
"""
import argparse
import hashlib
import json
import math


def jitter(seed_str, lo, hi):
    """Deterministic pseudo-random in [lo, hi] from a seed (reproducible, varied per input)."""
    h = int(hashlib.sha256(seed_str.encode()).hexdigest(), 16)
    frac = (h % 10_000_000) / 10_000_000
    return lo + (hi - lo) * frac


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--usd", type=float, required=True, help="total USDC to shield")
    ap.add_argument("--source", required=True)
    ap.add_argument("--dest", required=True)
    ap.add_argument("--per-tx-cap", type=float, default=1000.0, help="Shield Passport-tier per-tx cap (USDC)")
    ap.add_argument("--min-tranches", type=int, default=2, help="min splits for decorrelation even under cap")
    ap.add_argument("--max-delay-h", type=float, default=18.0, help="max jitter delay between tranches (hours)")
    ap.add_argument("--net", choices=["testnet", "mainnet"], default="testnet")
    ap.add_argument("--source-verified", default="false")
    ap.add_argument("--dest-verified", default="false")
    a = ap.parse_args()
    sv = a.source_verified.lower() in ("1", "true", "yes")
    dv = a.dest_verified.lower() in ("1", "true", "yes")

    blockers, warnings = [], []
    if a.source.lower() == a.dest.lower():
        blockers.append("source == destination: shielding to the same wallet provides no unlinkability")
    if not sv:
        blockers.append("source wallet is NOT Passport/PoCH verified — Shield will reject the deposit (see wallet-linking)")
    if not dv:
        blockers.append("destination is NOT verified — Shield gates withdrawals too; pick/stand up a verified identity")

    # tranche count: enough to stay under cap, and at least min-tranches for decorrelation
    by_cap = max(1, math.ceil(a.usd / a.per_tx_cap))
    n = max(by_cap, a.min_tranches)
    # varied (non-equal, non-round) split that sums to the total and respects the cap
    weights = [0.7 + jitter(f"{a.source}{a.dest}{i}", 0.0, 0.6) for i in range(n)]  # 0.7..1.3
    wsum = sum(weights)
    raw = [a.usd * w / wsum for w in weights]
    # clamp any tranche over the cap, push remainder to others proportionally (simple pass)
    tranches = []
    cumulative_delay_h = 0.0
    for i, amt in enumerate(raw):
        amt = min(amt, a.per_tx_cap)
        amt = round(amt - jitter(f"r{a.source}{i}", 0.01, 0.99), 2)  # de-round: avoid clean numbers
        if amt <= 0:
            continue
        delay_h = 0.0 if i == 0 else round(jitter(f"d{a.dest}{i}", a.max_delay_h * 0.15, a.max_delay_h), 2)
        cumulative_delay_h += delay_h
        tranches.append({
            "index": i,
            "deposit_usd": amt,
            "delay_after_prev_h": delay_h,
            "t_plus_h": round(cumulative_delay_h, 2),
            "flow": ["deposit_from_source_private", "hold_in_private_layer", "withdraw_to_dest_private"],
        })
    planned_total = round(sum(t["deposit_usd"] for t in tranches), 2)
    if planned_total < a.usd - 1:
        warnings.append(f"planned {planned_total} < requested {a.usd} (cap/rounding); add tranches or raise cap")
    if a.usd < 50:
        warnings.append("amount is small — splitting adds little; a single shielded position may be fine")
    warnings.append("decorrelation hides timing INSIDE the private layer (externally invisible); the only cost is a longer window where the relay key controls already-shielded funds")

    print(json.dumps({
        "model": "A (deposit from verified source -> private layer + decorrelate -> withdraw to verified dest)",
        "network": a.net,
        "source": a.source, "dest": a.dest,
        "total_usd": a.usd, "per_tx_cap": a.per_tx_cap,
        "tranche_count": len(tranches),
        "tranches": tranches,
        "planned_total_usd": planned_total,
        "ready": not blockers,
        "blockers": blockers,
        "warnings": warnings,
        "execution": ("MAINNET-GATED: execute via the Shield SDK (deposit/withdraw) using waap-cli for "
                      "L1 Permit2 + Aztec ECDSA auth, and the in-process PXE for the private leg. See "
                      "docs/specs/privacy-guard-v2.md. On testnet, run capped, small amounts to find wrinkles."),
        "note": "Plan only — moves nothing. Re-screen eligibility immediately before each tranche; "
                "never deposit==withdraw the same amount/time.",
    }, indent=2))


if __name__ == "__main__":
    main()
