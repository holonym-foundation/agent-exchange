#!/usr/bin/env bash
# Perpetual round-robin ETH pass — long-running version of passing-eth-demo.sh designed for
# hosted demos (shimmer-saas, aex, anything systemd-shaped). Trades pass-1 → pass-2 → pass-3 →
# pass-1 forever at a slow cadence so a small initial funding lasts months. Pause and resume
# without killing the loop via a sentinel file.
#
# State files (under $AEX_FLEET_HOME):
#   perpetual-pass.paused   — touch to pause; rm to resume; safe to toggle mid-hop
#   perpetual-pass.state.json — written after each hop: totalHops, lastHopAt, lastTxHash, …
#
# Env:
#   EMAIL_BASE (required)   — see passing-eth-demo.sh, same shape
#   PASSWORD                — default AexPassDemo!1234
#   DELAY                   — seconds between hops (default 300 — 5 min, so 3 hops/15 min → ~100 days on 3 ETH)
#   AMOUNT                  — ETH per hop (default 0.0001)
#   CHAIN_ID                — default 11155111 (Sepolia)
#   MAX_HOPS                — optional cap (default infinite)
#   LOG_FILE                — optional tee target (default stdout)
#
# Usage:
#   EMAIL_BASE=demo@holonym.id ./perpetual-pass-loop.sh
#
#   # pause (run anywhere with access to $AEX_FLEET_HOME):
#   touch $AEX_FLEET_HOME/perpetual-pass.paused
#   # resume:
#   rm $AEX_FLEET_HOME/perpetual-pass.paused
#   # graceful stop:
#   pkill -TERM -f perpetual-pass-loop.sh
#
# Run under systemd: see examples/perpetual-pass.service.template

set -uo pipefail

EMAIL_BASE="${EMAIL_BASE:-}"
if [ -z "$EMAIL_BASE" ]; then
  echo "Set EMAIL_BASE first, e.g.: EMAIL_BASE=demo@holonym.id ./perpetual-pass-loop.sh" >&2
  exit 1
fi
PASSWORD="${PASSWORD:-AexPassDemo!1234}"
DELAY="${DELAY:-300}"
AMOUNT="${AMOUNT:-0.0001}"
CHAIN_ID="${CHAIN_ID:-11155111}"
MAX_HOPS="${MAX_HOPS:-0}"   # 0 = forever
LOG_FILE="${LOG_FILE:-}"
RPC_URL="${AEX_FLEET_RPC_SEPOLIA:-https://ethereum-sepolia-rpc.publicnode.com}"

# Resolve the data root so we know where to read the pause file and write state.json — match
# aex-fleet's own logic (AEX_FLEET_HOME wins; else XDG_CONFIG_HOME/aex-fleet; else platform).
if [ -n "${AEX_FLEET_HOME:-}" ]; then
  DATA_DIR="$AEX_FLEET_HOME"
elif [ -n "${XDG_CONFIG_HOME:-}" ]; then
  DATA_DIR="$XDG_CONFIG_HOME/aex-fleet"
elif [ "$(uname)" = "Darwin" ]; then
  DATA_DIR="$HOME/Library/Preferences/aex-fleet"
else
  DATA_DIR="$HOME/.config/aex-fleet"
fi
PAUSE_FILE="$DATA_DIR/perpetual-pass.paused"
STATE_FILE="$DATA_DIR/perpetual-pass.state.json"
LOG_JSONL="$DATA_DIR/perpetual-pass.log.jsonl"

mkdir -p "$DATA_DIR"

log() {
  local ts; ts=$(date -u +%FT%TZ)
  local line="[$ts] $*"
  if [ -n "$LOG_FILE" ]; then
    echo "$line" | tee -a "$LOG_FILE"
  else
    echo "$line"
  fi
}

extract_evm_address() {
  perl -ne '
    if (/EvmWalletAddress:?\s*(0x[a-fA-F0-9]{40})/i) { print "$1\n"; exit }
    if (/"(?:address|evm|evmAddress|eth)":\s*"(0x[a-fA-F0-9]{40})"/) { print "$1\n"; exit }
    if (/(0x[a-fA-F0-9]{40})(?![a-fA-F0-9])/) { print "$1\n"; exit }
  '
}

extract_tx_hash() {
  perl -ne '
    if (/Transaction submitted:\s*(0x[a-fA-F0-9]{64})/) { print "$1\n"; exit }
    if (/TxHash:\s*(0x[a-fA-F0-9]{64})/i) { print "$1\n"; exit }
    if (/(0x[a-fA-F0-9]{64})/) { print "$1\n"; exit }
  '
}

wait_for_receipt() {
  local hash=$1
  local body="{\"jsonrpc\":\"2.0\",\"method\":\"eth_getTransactionReceipt\",\"params\":[\"$hash\"],\"id\":1}"
  for _ in $(seq 1 30); do
    local status
    status=$(curl -s --max-time 5 -X POST "$RPC_URL" -H 'content-type: application/json' -d "$body" \
      | jq -r '.result.status // empty' 2>/dev/null || true)
    [ "$status" = "0x1" ] && return 0
    [ "$status" = "0x0" ] && return 1
    sleep 2
  done
  return 2
}

write_state() {
  local total_hops=$1 last_hash=$2 last_status=$3 last_error=$4 paused=$5
  jq -n \
    --argjson totalHops "$total_hops" \
    --arg lastHopAt "$(date -u +%FT%TZ)" \
    --arg lastTxHash "$last_hash" \
    --arg lastStatus "$last_status" \
    --arg lastError "$last_error" \
    --argjson paused "$paused" \
    --arg amount "$AMOUNT" \
    --argjson delay "$DELAY" \
    --argjson chainId "$CHAIN_ID" \
    '{totalHops:$totalHops, lastHopAt:$lastHopAt, lastTxHash:$lastTxHash, lastStatus:$lastStatus, lastError:$lastError, paused:$paused, amount:$amount, delay:$delay, chainId:$chainId}' \
    > "$STATE_FILE.tmp" && mv "$STATE_FILE.tmp" "$STATE_FILE"
}

# Graceful stop on SIGTERM/SIGINT
SHUTDOWN=0
on_signal() { SHUTDOWN=1; log "▸ signal received, finishing current hop then exiting"; }
trap on_signal TERM INT

# One-time setup mirror of passing-eth-demo Stage 1 — register + signup + record addresses.
log "═══ Perpetual round-robin starting (EMAIL_BASE=$EMAIL_BASE, DELAY=${DELAY}s, AMOUNT=${AMOUNT} ETH) ═══"
EMAIL_USER="${EMAIL_BASE%@*}"
EMAIL_DOMAIN="${EMAIL_BASE#*@}"
for i in 1 2 3; do
  id="pass-$i"
  email="${EMAIL_USER}+pass${i}@${EMAIL_DOMAIN}"
  if ! aex-fleet ls --json | jq -e ".agents[] | select(.agentId == \"$id\")" >/dev/null 2>&1; then
    aex-fleet add "$id" --chain sepolia --email "$email" --tag pass-demo --tag perpetual >/dev/null
    log "  ▸ registered $id"
  fi
  aex-fleet use "$id" >/dev/null
  if ! aex-fleet waap whoami >/dev/null 2>&1; then
    if ! aex-fleet waap signup -e "$email" -p "$PASSWORD" >/dev/null 2>&1; then
      aex-fleet waap login -e "$email" -p "$PASSWORD" >/dev/null
    fi
  fi
  addr=$(aex-fleet waap whoami 2>/dev/null | extract_evm_address)
  if [ -n "$addr" ]; then
    aex-fleet set "$id" --address "$addr" >/dev/null
    log "  ✓ $id → $addr"
  fi
done

# Main loop
log "═══ Loop running. Pause: \`touch $PAUSE_FILE\` · Resume: \`rm $PAUSE_FILE\` ═══"

PAIRS=("pass-1:pass-2" "pass-2:pass-3" "pass-3:pass-1")
total_hops=0
pair_index=0

while [ $SHUTDOWN -eq 0 ]; do
  if [ "$MAX_HOPS" -gt 0 ] && [ $total_hops -ge "$MAX_HOPS" ]; then
    log "▸ MAX_HOPS=$MAX_HOPS reached — exiting"
    break
  fi

  # Pause-file check — re-poll every 10s while paused so resume is responsive without
  # spinning. State is updated once when entering and once when leaving the paused state.
  if [ -f "$PAUSE_FILE" ]; then
    write_state "$total_hops" "" "paused" "" true
    log "⏸  paused (touch=$PAUSE_FILE) — waiting…"
    while [ -f "$PAUSE_FILE" ] && [ $SHUTDOWN -eq 0 ]; do sleep 10; done
    [ $SHUTDOWN -eq 1 ] && break
    log "▶  resumed"
    write_state "$total_hops" "" "resumed" "" false
  fi

  pair="${PAIRS[$pair_index]}"
  src="${pair%%:*}"
  dst="${pair##*:}"
  pair_index=$(( (pair_index + 1) % 3 ))

  log "→ hop $((total_hops + 1)): $src sends $AMOUNT ETH to $dst"
  aex-fleet use "$src" >/dev/null

  tx_out=$(aex-fleet waap send-tx --to "$dst" --value "$AMOUNT" --chain "$CHAIN_ID" 2>&1) || true
  tx_hash=$(echo "$tx_out" | extract_tx_hash)
  last_error=""
  last_status="submitted"

  if [ -z "$tx_hash" ]; then
    last_error="no tx hash extracted"
    last_status="failed"
    log "  ✗ send-tx failed: $(echo "$tx_out" | tail -3 | tr '\n' ' ')"
  else
    log "  ⏳ awaiting receipt: $tx_hash"
    if wait_for_receipt "$tx_hash"; then
      last_status="confirmed"
      log "  ✓ confirmed"
    else
      case $? in
        1) last_status="reverted"; last_error="tx reverted"; log "  ✗ reverted" ;;
        2) last_status="timeout";  last_error="receipt timeout"; log "  ⚠ receipt timed out" ;;
      esac
    fi
  fi

  total_hops=$((total_hops + 1))
  write_state "$total_hops" "$tx_hash" "$last_status" "$last_error" false

  # Append a JSON-line to the tx log so the dashboard can render recent activity. Single line
  # per entry, append-only, no rotation in v1 (dashboard reads last 50). Truncate to ~10MB
  # opportunistically via head when it grows past that — cheap, no logrotate dep.
  jq -nc \
    --arg ts "$(date -u +%FT%TZ)" \
    --arg src "$src" \
    --arg dst "$dst" \
    --arg amount "$AMOUNT" \
    --argjson chainId "$CHAIN_ID" \
    --arg txHash "$tx_hash" \
    --arg status "$last_status" \
    --arg error "$last_error" \
    '{ts:$ts, src:$src, dst:$dst, amount:$amount, chainId:$chainId, txHash:$txHash, status:$status, error:$error}' \
    >> "$LOG_JSONL" 2>/dev/null || true
  # If log grows beyond 10MB, keep the last 5000 lines (best-effort, no fancy logrotate)
  if [ -f "$LOG_JSONL" ] && [ "$(wc -c <"$LOG_JSONL" 2>/dev/null || echo 0)" -gt 10485760 ]; then
    tail -n 5000 "$LOG_JSONL" > "$LOG_JSONL.tmp" && mv "$LOG_JSONL.tmp" "$LOG_JSONL"
  fi

  # DELAY between hops — but respond to SHUTDOWN promptly by sleeping in chunks.
  remaining=$DELAY
  while [ "$remaining" -gt 0 ] && [ "$SHUTDOWN" -eq 0 ]; do
    chunk=$(( remaining > 5 ? 5 : remaining ))
    sleep "$chunk"
    remaining=$(( remaining - chunk ))
  done
done

log "═══ Exited after $total_hops hop(s) ═══"
write_state "$total_hops" "" "stopped" "" false
