#!/usr/bin/env bash
# End-to-end demo for aex-fleet on Ethereum Sepolia.
#
# What this demonstrates:
#   1. Register three agents in one fleet
#   2. List them with structured output
#   3. Switch active context
#   4. Apply a daily-spend-limit policy in bulk
#   5. Inspect aggregate status
#
# Prerequisites:
#   - `aex-fleet` and `waap-cli` on PATH (npm install -g @human.tech/aex-fleet @human.tech/waap-cli)
#   - Optional: AEX_FLEET_NEON_DSN_RO for live status (otherwise it degrades gracefully)
#   - Sepolia faucet access to fund the wallets after `add`

set -euo pipefail

# Isolate this demo from any real fleet on the host.
SMOKE=$(mktemp -d)
export AEX_FLEET_HOME=$SMOKE
trap 'rm -rf "$SMOKE"' EXIT

EMAIL_BASE="${EMAIL_BASE:-demo+ethtest}@example.com"
DAILY_LIMIT="${DAILY_LIMIT:-50}"

echo "=== aex-fleet demo (data root: $SMOKE) ==="
echo

echo "--- 1. preflight ---"
aex-fleet doctor || true   # may fail if waap-cli isn't installed; demo continues either way
echo

echo "--- 2. register three agents on Sepolia ---"
for n in 1 2 3; do
  aex-fleet add "eth-yield-test-$n" \
    --chain ethereum \
    --email "${EMAIL_BASE/+/+test$n+}" \
    --tag yield --tag demo
done
echo

echo "--- 3. list the fleet (table) ---"
aex-fleet ls
echo

echo "--- 4. list the fleet (json — what AI shells consume) ---"
aex-fleet ls --json | head -40
echo

echo "--- 5. switch active to test-2 ---"
aex-fleet use eth-yield-test-2
aex-fleet ls
echo

echo "--- 6. apply daily-limit \$$DAILY_LIMIT to all yield agents ---"
# This will only succeed if each agent is signed up (post `aex-fleet waap signup`) and waap-cli
# is reachable. For the dry demo we expect non-zero exits — the table renders regardless.
aex-fleet policy set --tag yield --daily-limit "$DAILY_LIMIT" || true
echo

echo "--- 7. aggregate status (degrades if AEX_FLEET_NEON_DSN_RO unset) ---"
aex-fleet status
echo

echo "=== done ==="
