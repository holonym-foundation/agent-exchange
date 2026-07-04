#!/usr/bin/env bash
# One-shot: register a varied synthetic fleet so the dashboard has interesting data.
# No real waap-cli signup, no real funds — just registry richness for visual demoing.
#
#   ./launch-synth-fleet.sh                  # populates the default $AEX_FLEET_HOME
#   AEX_FLEET_HOME=$(mktemp -d) ./launch-synth-fleet.sh && aex-fleet dashboard
#
# Safe to re-run: agents that already exist are skipped (no error).

set -euo pipefail

TARGET_INFO="${AEX_FLEET_HOME:-(default platform config dir, e.g. ~/Library/Preferences/aex-fleet on macOS)}"
echo "▸ Target AEX_FLEET_HOME: ${TARGET_INFO}"
echo "  If this isn't where your dashboard is reading, \`unset AEX_FLEET_HOME\` first."
echo "▸ Registering 8 synthetic agents…"

# Skip-if-exists helper: catches the "Agent already exists" error so re-runs are idempotent.
add_or_skip() {
  local id=$1
  shift
  local out exit_code
  out=$(aex-fleet add "$id" "$@" 2>&1) && exit_code=0 || exit_code=$?
  if [ $exit_code -eq 0 ]; then
    echo "$out"
    return 0
  fi
  if printf '%s' "$out" | grep -q "already exists"; then
    echo "  (skipped $id — already registered)"
    return 0
  fi
  printf '%s\n' "$out" >&2
  return $exit_code
}

# Three EVM yield agents, two on ethereum (mainnet intent) + one on sepolia
add_or_skip eth-yield-prod-1 --chain ethereum \
  --address 0xA1b2C3d4E5f60718293a4b5c6d7e8f9012345678 \
  --tag yield --tag prod --register-erc8004 --erc8004-chain ethereum

add_or_skip eth-yield-prod-2 --chain ethereum \
  --address 0xB2c3D4e5F6071829304b5c6d7e8f901234567891 \
  --tag yield --tag prod --register-erc8004 --erc8004-chain ethereum

add_or_skip eth-yield-test-1 --chain ethereum \
  --address 0xC3d4E5f607182930415c6d7e8f9012345678ab12 \
  --tag yield --tag test --register-erc8004 --erc8004-chain sepolia   # mixed chain in 8004 column

# Two ops/monitor agents
add_or_skip ops-monitor-eth --chain ethereum \
  --address 0xD4e5F60718293041526d7e8f9012345678abc123 \
  --tag ops --tag prod

add_or_skip ops-monitor-sui --chain sui \
  --address 0xE5f6071829304152637e8f9012345678abcd1234 \
  --tag ops --tag prod

# One governance agent
add_or_skip govern-snapshot --chain ethereum \
  --address 0xF607182930415263748f9012345678abcde12345 \
  --tag govern --tag prod

# One trading agent
add_or_skip trade-poly --chain ethereum \
  --address 0x0718293041526374859012345678abcdef123456 \
  --tag trade --tag test

# One linked agent (demonstrates the linked-to column)
add_or_skip agent-linked-demo --chain ethereum \
  --address 0x18293041526374859a012345678abcdef1234567 \
  --tag demo

# Activate one for the demo (only if it exists — won't fail on a partial run)
aex-fleet use eth-yield-prod-1 >/dev/null 2>&1 || true

echo
echo "▸ Fleet snapshot:"
aex-fleet ls

echo
echo "▸ Next: \`aex-fleet dashboard\` and refresh the browser."
echo "  (The 8004 column shows mixed states; balance/last-event columns will stay '—'"
echo "   until you wire AEX_FLEET_NEON_DSN_RO to a Neon project with matching agent_ids.)"
