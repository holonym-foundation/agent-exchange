#!/usr/bin/env bash
# One-shot capability check — runs the perpetual loop briefly so the dashboard has live state,
# exercises pause/resume, and exits clean. Use to verify the stack works end-to-end on a laptop
# before staging on shimmer-saas.
#
# Usage:
#   EMAIL_BASE=shady@holonym.id ~/.../local-capability-check.sh
#
# Optional env:
#   HOPS=6  PASSWORD=…  AMOUNT=0.0001  CHAIN_ID=11155111

set -uo pipefail

EMAIL_BASE="${EMAIL_BASE:-}"
if [ -z "$EMAIL_BASE" ]; then
  echo "Set EMAIL_BASE first, e.g.:"
  echo "  EMAIL_BASE=shady@holonym.id $0"
  exit 1
fi
HOPS="${HOPS:-6}"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Resolve config dir (same logic as the loop script)
if [ -n "${AEX_FLEET_HOME:-}" ]; then
  DATA_DIR="$AEX_FLEET_HOME"
elif [ -n "${XDG_CONFIG_HOME:-}" ]; then
  DATA_DIR="$XDG_CONFIG_HOME/aex-fleet"
elif [ "$(uname)" = "Darwin" ]; then
  DATA_DIR="$HOME/Library/Preferences/aex-fleet"
else
  DATA_DIR="$HOME/.config/aex-fleet"
fi
STATE_FILE="$DATA_DIR/perpetual-pass.state.json"
PAUSE_FILE="$DATA_DIR/perpetual-pass.paused"

div() { echo; echo "─── $1 ───"; }

div "1. preflight"
aex-fleet doctor || true

div "2. start perpetual loop for $HOPS hops (DELAY=10s, so ~2 minutes)"
echo "    state will land at: $STATE_FILE"
MAX_HOPS=$HOPS DELAY=10 EMAIL_BASE="$EMAIL_BASE" \
  "$SCRIPT_DIR/perpetual-pass-loop.sh" &
LOOP_PID=$!
echo "    loop PID: $LOOP_PID"

# Wait for first hop so the state file exists
echo "    waiting for first hop to write state…"
for _ in $(seq 1 60); do
  [ -f "$STATE_FILE" ] && break
  sleep 1
done

if [ ! -f "$STATE_FILE" ]; then
  echo "    ✗ state file never appeared — check loop output above"
  kill $LOOP_PID 2>/dev/null || true
  exit 1
fi

div "3. state.json after first hop"
jq . "$STATE_FILE"

div "4. exercise pause"
touch "$PAUSE_FILE"
echo "    touched $PAUSE_FILE — loop should report ⏸ paused within ~10s"
sleep 15
echo "    state after pause:"
jq '{totalHops, paused, lastStatus}' "$STATE_FILE"

div "5. exercise resume"
rm -f "$PAUSE_FILE"
echo "    removed pause file — loop should report ▶ resumed within ~10s"
sleep 12
echo "    state after resume:"
jq '{totalHops, paused, lastStatus}' "$STATE_FILE"

div "6. let loop finish remaining hops"
wait $LOOP_PID || true

div "done — final state"
jq . "$STATE_FILE"

echo
echo "▸ Dashboard URL: http://localhost:3002  (start with: aex-fleet dashboard --port 3002)"
echo "▸ Tail state:    watch -n2 \"jq . $STATE_FILE\""
echo "▸ Pause/resume:  touch $PAUSE_FILE  /  rm $PAUSE_FILE"
