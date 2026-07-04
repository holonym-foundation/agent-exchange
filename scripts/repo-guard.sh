#!/usr/bin/env bash
# repo-guard.sh — public-repo hygiene gate.
#
# This repository is PUBLIC. Everything committed here is world-readable forever
# (git history included). This guard fails the commit / CI run if tracked content
# leaks any of:
#   1. Blocked paths      — internal-only dirs/files that must never be published.
#   2. Secrets            — private keys, DB connection strings, API tokens, mnemonics.
#   3. Infrastructure     — box IPs, internal hostnames, managed-DB endpoint/branch markers.
#   4. Sensitive wallets  — operational wallet addresses (matched by SHA-256, so the
#                           addresses themselves are never stored in this public repo).
#
# Public token/contract addresses (USDC, WETH, routers, 0x1111…, etc.) are allowed —
# only the operational-wallet hash denylist is blocked.
#
# Run locally: scripts/repo-guard.sh   (also wired as a pre-commit hook + CI job)
set -uo pipefail
cd "$(git rev-parse --show-toplevel)" || exit 2

fail=0
report() { printf '\n❌ %s\n' "$1"; [ -n "${2:-}" ] && printf '%s\n' "$2"; fail=1; }

# --- 1. Blocked paths ------------------------------------------------------------
# Internal ops content that has no place in the public repo. Excluding these dirs is
# how the box IPs / internal instances / runtime internals stay out (see PUBLIC-REPO-POLICY.md).
blocked=$(git ls-files | grep -nE '(^|/)(deployments|agents|agent-base)/|(^|/)\.env(\.|$)|\.internal\.[a-z]+$' || true)
[ -n "$blocked" ] && report "blocked path(s) present — internal-only, must not be published:" "$blocked"

# --- 2. Secrets ------------------------------------------------------------------
# High-signal patterns. (CI also runs gitleaks for broad coverage; this is the fast local gate.)
secret_re='-----BEGIN [A-Z ]*PRIVATE KEY-----'
secret_re+='|postgres(ql)?://[^[:space:]:@/"'\'']+:[^[:space:]@"'\'']+@'   # DSN with user:pass@host
secret_re+='|napi_[A-Za-z0-9]{20,}'                                        # Neon API token
secret_re+='|(PRIVATE_KEY|MNEMONIC|SEED_PHRASE)[[:space:]]*[:=][[:space:]]*['\''"]?[0-9a-zA-Z]'
secret_re+='|(api[_-]?key|secret|token|password)["'\'' ]*[:=][[:space:]]*["'\''][A-Za-z0-9_\-]{24,}["'\'']'
secrets=$(git grep -nIE "$secret_re" -- . ':(exclude)scripts/repo-guard.sh' ':(exclude)PUBLIC-REPO-POLICY.md' 2>/dev/null \
          | grep -viE 'example|sample|placeholder|dummy|your[_-]|xxxx|0x0{8}|<[a-z_]+>' || true)
[ -n "$secrets" ] && report "possible secret(s) — do NOT commit credentials:" "$secrets"

# --- 3. Infrastructure -----------------------------------------------------------
# Box IPs, internal service hostnames, and managed-DB endpoint/branch fingerprints.
infra_re='(^|[^0-9])(91\.99\.(125|210)|88\.99\.125|167\.233\.(64|97))\.[0-9]{1,3}'          # Hetzner box IPs
infra_re+='|aex-stack|aex-native-scm|aex-signer|aex-registry-main|aex-run-forced'           # internal hostnames
infra_re+='|nameless-heart|proud-dust|bold-breeze|mute-truth|ep-[a-z]+-[a-z]+-a2[0-9a-z]+'  # Neon endpoints/branches
infra=$(git grep -nIE "$infra_re" -- . ':(exclude)scripts/repo-guard.sh' ':(exclude)PUBLIC-REPO-POLICY.md' 2>/dev/null || true)
[ -n "$infra" ] && report "infrastructure / internal reference — genericize before publishing:" "$infra"

# --- 4. Sensitive wallet addresses (hash-matched) --------------------------------
denyfile="scripts/guard/deny-address-hashes.txt"
if [ -f "$denyfile" ]; then
  if command -v sha256sum >/dev/null 2>&1; then sha() { sha256sum | awk '{print $1}'; }
  else sha() { shasum -a 256 | awk '{print $1}'; }; fi
  denyhashes=$(grep -oiE '^[0-9a-f]{64}' "$denyfile" | tr 'A-F' 'a-f')
  if [ -n "$denyhashes" ]; then
    for a in $(git grep -hIoE '0x[0-9a-fA-F]{40}' -- . 2>/dev/null | tr 'A-F' 'a-f' | sort -u); do
      h=$(printf '%s' "$a" | sha)
      printf '%s\n' "$denyhashes" | grep -qx "$h" && report "operational wallet address present (SHA-256 $h) — use a placeholder or public contract only"
    done
  fi
fi

if [ "$fail" -eq 0 ]; then echo "✓ repo-guard: clean"; else printf '\nrepo-guard: FAILED — see PUBLIC-REPO-POLICY.md\n'; fi
exit "$fail"
