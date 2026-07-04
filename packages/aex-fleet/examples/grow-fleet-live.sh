#!/usr/bin/env bash
# Adds a new agent every N seconds until Ctrl-C. Use to show the dashboard's
# 5-second auto-refresh picking up changes live.
#
#   ./grow-fleet-live.sh                # one new agent every 5s
#   INTERVAL=2 ./grow-fleet-live.sh     # every 2s
#   STARTING_INDEX=42 ./grow-fleet-live.sh
#
# Run `aex-fleet dashboard` in another terminal first and watch the table grow.

set -euo pipefail

INTERVAL="${INTERVAL:-5}"
STARTING_INDEX="${STARTING_INDEX:-1}"
TAGS="${TAGS:---tag live --tag demo}"
CHAIN="${CHAIN:-ethereum}"

trap 'echo; echo "▸ stopped"; exit 0' INT TERM

echo "▸ Adding a new agent every ${INTERVAL}s. Ctrl-C to stop."
echo "  Open the dashboard in another terminal: \`aex-fleet dashboard\`"
echo

i=$STARTING_INDEX
while true; do
  ts=$(date +%s)
  # Synthesize an address — purely visual, never used on-chain.
  addr="0x$(printf '%040x' $((ts * 1000 + i)) | tail -c 40)"
  id="live-agent-$(printf '%03d' $i)"
  aex-fleet add "$id" --chain "$CHAIN" --address "$addr" $TAGS >/dev/null
  echo "  + $id  ($addr)"
  i=$((i + 1))
  sleep "$INTERVAL"
done
