#!/usr/bin/env bash
# Round-robin ETH-pass demo on Ethereum Sepolia.
#
# Spins up 3 real WaaP agents (pass-1, pass-2, pass-3), waits for them to be funded from a
# faucet, then sends ETH around the circle for N rounds. Open `aex-fleet dashboard` in another
# terminal — its 5s auto-refresh will capture each balance change live.
#
# Usage:
#   EMAIL_BASE=you@gmail.com ./passing-eth-demo.sh
#
# Optional env:
#   PASSWORD     (default: AexPassDemo!1234)
#   ROUNDS       (default: 3)              — number of full circles
#   AMOUNT       (default: 0.0001)         — ETH per hop
#   DELAY        (default: 4)              — seconds between hops (≥ dashboard refresh)
#   CHAIN_ID     (default: 11155111)       — Sepolia
#
# The three agents end up registered with the `pass-demo` tag so you can clean up with:
#   aex-fleet policy set --tag pass-demo ...
# or remove individually:
#   for n in 1 2 3; do aex-fleet rm pass-$n; done

set -euo pipefail

EMAIL_BASE="${EMAIL_BASE:-}"
if [ -z "$EMAIL_BASE" ]; then
  echo "Set EMAIL_BASE first, e.g.:"
  echo "  EMAIL_BASE=you@gmail.com ./passing-eth-demo.sh"
  echo
  echo "We'll signup pass-1/2/3 as you+pass1@gmail.com etc. (Gmail/Proton plus-aliasing routes"
  echo "all of them to your real inbox; no extra signups required on your end.)"
  exit 1
fi
PASSWORD="${PASSWORD:-AexPassDemo!1234}"
ROUNDS="${ROUNDS:-3}"
AMOUNT="${AMOUNT:-0.0001}"
# After each send we wait for the tx receipt (so dashboard catches confirmed balance) plus a
# small DELAY for the dashboard's 5s auto-refresh cycle. Bump DELAY higher if you want each
# hop to linger on-screen longer for an audience.
DELAY="${DELAY:-3}"
CHAIN_ID="${CHAIN_ID:-11155111}"
RPC_URL="${AEX_FLEET_RPC_SEPOLIA:-https://ethereum-sepolia-rpc.publicnode.com}"

EMAIL_USER="${EMAIL_BASE%@*}"
EMAIL_DOMAIN="${EMAIL_BASE#*@}"

require() {
  command -v "$1" >/dev/null 2>&1 || { echo "missing required tool: $1"; exit 1; }
}
require aex-fleet
require waap-cli
require jq

div() { echo; echo "═══ $1 ═══"; }

# waap-cli's `whoami` prints a multi-chain blob ("EvmWalletAddress:0x…SuiWalletAddress:0x…")
# rather than a plain hex string. A naive 40-hex grep would chop a Sui address (64-hex) down
# to its first 40 chars — wrong! Prefer the labeled form, then JSON shapes, then bare 40-hex
# with a negative-lookahead to avoid splitting a 64-hex Sui address.
extract_evm_address() {
  perl -ne '
    if (/EvmWalletAddress:?\s*(0x[a-fA-F0-9]{40})/i) { print "$1\n"; exit }
    if (/"(?:address|evm|evmAddress|eth)":\s*"(0x[a-fA-F0-9]{40})"/) { print "$1\n"; exit }
    if (/(0x[a-fA-F0-9]{40})(?![a-fA-F0-9])/) { print "$1\n"; exit }
  '
}

# Get the EVM balance for the active agent as a clean number string. Prefer waap-cli's --json
# top-level flag (returns structured output); fall back to regex-extracting an ETH-formatted
# value from plaintext.
get_eth_balance() {
  local chain_id=$1
  local out
  out=$(aex-fleet waap --json balance --chain "$chain_id" 2>&1 || true)
  local v
  v=$(echo "$out" | jq -r '.value // .balance // .eth // .ether // empty' 2>/dev/null || true)
  if [ -n "$v" ] && [ "$v" != "null" ]; then
    echo "$v"
    return 0
  fi
  # plaintext fallback — look for "X.YYY ETH" or "X.YYY SUI"
  echo "$out" | grep -oE '[0-9]+\.[0-9]+ (ETH|SUI|WEI)' | head -1
}

# Pull the tx hash from a `waap-cli send-tx` invocation. Look for the "✅ Transaction
# submitted: 0x…" line first, then any 64-hex preceded by 0x as fallback.
extract_tx_hash() {
  perl -ne '
    if (/Transaction submitted:\s*(0x[a-fA-F0-9]{64})/) { print "$1\n"; exit }
    if (/TxHash:\s*(0x[a-fA-F0-9]{64})/i) { print "$1\n"; exit }
    if (/(0x[a-fA-F0-9]{64})/) { print "$1\n"; exit }
  '
}

# Poll eth_getTransactionReceipt until status returns or timeout. Returns 0 on confirmed,
# 1 on revert, 2 on timeout. Sepolia block time is ~12s so default ~30 attempts × 2s = 60s.
wait_for_receipt() {
  local hash=$1
  local attempts="${2:-30}"
  local body
  body="{\"jsonrpc\":\"2.0\",\"method\":\"eth_getTransactionReceipt\",\"params\":[\"$hash\"],\"id\":1}"
  for _ in $(seq 1 "$attempts"); do
    local res
    res=$(curl -s --max-time 5 -X POST "$RPC_URL" -H 'content-type: application/json' -d "$body" || true)
    local status
    status=$(echo "$res" | jq -r '.result.status // empty' 2>/dev/null || true)
    if [ "$status" = "0x1" ]; then return 0; fi
    if [ "$status" = "0x0" ]; then return 1; fi
    sleep 2
  done
  return 2
}

# ─── Stage 1: register + signup ──────────────────────────────────────────────
div "Stage 1: register + signup 3 agents"
for i in 1 2 3; do
  id="pass-$i"
  email="${EMAIL_USER}+pass${i}@${EMAIL_DOMAIN}"
  # Register in fleet.json if missing.
  if ! aex-fleet ls --json | jq -e ".agents[] | select(.agentId == \"$id\")" >/dev/null 2>&1; then
    aex-fleet add "$id" --chain sepolia --email "$email" --tag pass-demo >/dev/null
    echo "  ▸ registered $id"
  fi
  aex-fleet use "$id" >/dev/null
  # Ensure a WaaP session: try whoami; if it fails, signup; if signup fails (already exists), login.
  if ! aex-fleet waap whoami >/dev/null 2>&1; then
    echo "  ▸ signing up $id ($email) …"
    if ! aex-fleet waap signup -e "$email" -p "$PASSWORD" >/dev/null 2>&1; then
      echo "    (signup failed — trying login in case the account exists)"
      aex-fleet waap login -e "$email" -p "$PASSWORD" >/dev/null
    fi
  fi
  addr=$(aex-fleet waap whoami 2>/dev/null | extract_evm_address)
  if [ -z "$addr" ]; then
    echo "  ! could not extract EVM address from \`waap whoami\` for $id — skipping" >&2
    continue
  fi
  aex-fleet set "$id" --address "$addr" >/dev/null
  echo "  ✓ $id → $addr"
done

# ─── Stage 2: balances + faucet wait ─────────────────────────────────────────
div "Stage 2: fund each agent on Sepolia"
echo "Total needed per agent: about $(awk "BEGIN { print $AMOUNT * 3 * $ROUNDS * 1.5 }") ETH (3 hops × $ROUNDS rounds × 1.5× for gas)"
echo
echo "Faucets:"
echo "  https://sepolia-faucet.pk910.de            (PoW, no signup — recommended)"
echo "  https://www.alchemy.com/faucets/ethereum-sepolia"
echo "  https://faucet.quicknode.com/ethereum/sepolia"
echo
echo "Addresses to fund:"
for i in 1 2 3; do
  id="pass-$i"
  addr=$(aex-fleet ls --json | jq -r ".agents[] | select(.agentId == \"$id\") | .address")
  echo "  $id: $addr"
done
echo
read -r -p "▸ Press Enter once all 3 are funded (or Ctrl-C to abort)… "

echo
echo "Current balances:"
for i in 1 2 3; do
  id="pass-$i"
  aex-fleet use "$id" >/dev/null
  bal=$(get_eth_balance "$CHAIN_ID")
  echo "  $id: ${bal:-(unknown)}"
done

# ─── Stage 3: round-robin ────────────────────────────────────────────────────
div "Stage 3: round-robin ($ROUNDS rounds × 3 hops × $AMOUNT ETH, ${DELAY}s between hops)"
echo "▸ Open \`aex-fleet dashboard\` in another terminal to watch balances tick."
echo

start_ts=$(date +%s)
for round in $(seq 1 "$ROUNDS"); do
  echo "── Round $round / $ROUNDS ──"
  for pair in "pass-1:pass-2" "pass-2:pass-3" "pass-3:pass-1"; do
    src="${pair%%:*}"
    dst="${pair##*:}"
    echo "  → $src sends $AMOUNT ETH to $dst"
    aex-fleet use "$src" >/dev/null
    # Capture the send-tx output so we can pull the hash. Tee to user too so they see progress.
    tx_out=$(aex-fleet waap send-tx --to "$dst" --value "$AMOUNT" --chain "$CHAIN_ID" 2>&1 | tee /dev/tty)
    tx_hash=$(echo "$tx_out" | extract_tx_hash)
    if [ -z "$tx_hash" ]; then
      echo "    ✗ no tx hash extracted — skipping wait" >&2
      sleep "$DELAY"
      continue
    fi
    echo "    ⏳ waiting for receipt ($tx_hash) …"
    if wait_for_receipt "$tx_hash"; then
      echo "    ✓ confirmed"
    else
      case $? in
        1) echo "    ✗ reverted" >&2 ;;
        2) echo "    ⚠ receipt timed out (will continue anyway)" >&2 ;;
      esac
    fi
    sleep "$DELAY"   # gives the dashboard's 5s refresh a chance to capture the change
  done
done
end_ts=$(date +%s)

div "Done"
echo "Elapsed: $((end_ts - start_ts))s"
echo "Final balances:"
for i in 1 2 3; do
  id="pass-$i"
  aex-fleet use "$id" >/dev/null
  bal=$(get_eth_balance "$CHAIN_ID")
  echo "  $id: ${bal:-(unknown)}"
done
echo
echo "Cleanup (optional):"
echo "  for n in 1 2 3; do aex-fleet rm pass-\$n; done"
