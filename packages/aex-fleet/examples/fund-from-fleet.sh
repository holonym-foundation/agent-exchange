#!/usr/bin/env bash
# Fund a set of recipient agents from an existing tagged source pool.
#
# Use case: you have an existing funded fleet (e.g. tagged `pass-demo`) and want to seed a
# brand-new fleet (e.g. the perpetual `webmaster+pass-1/2/3` agents on a hosted box) without
# manually round-tripping through a faucet.
#
# Behaviour: each source agent sends AMOUNT ETH to each recipient. So for 3 sources × 3
# recipients × 0.05 ETH default, each source spends 0.15 ETH (plus gas) and each recipient
# ends up with 0.15 ETH. Symmetric.
#
# Usage:
#   ./fund-from-fleet.sh --from-tag <tag> --to <id1,id2,id3> [--amount 0.05] [--chain 11155111] [--yes]
#
# Example (seed perpetual demo from your existing pass-demo wallets):
#   ./fund-from-fleet.sh \
#       --from-tag pass-demo \
#       --to webmaster-pass-1,webmaster-pass-2,webmaster-pass-3 \
#       --amount 0.05 --yes
#
# Honors AEX_FLEET_RPC_SEPOLIA for receipt polling (matches dashboard config).

set -uo pipefail

FROM_TAG=""
TO_LIST=""
AMOUNT="0.05"
CHAIN_ID="11155111"
YES=0
PLAN_ONLY=0
RPC_URL="${AEX_FLEET_RPC_SEPOLIA:-https://ethereum-sepolia-rpc.publicnode.com}"

while [ $# -gt 0 ]; do
  case "$1" in
    --from-tag)        FROM_TAG="$2"; shift 2 ;;
    --to)              TO_LIST="$2";  shift 2 ;;
    --amount)          AMOUNT="$2";   shift 2 ;;
    --chain)           CHAIN_ID="$2"; shift 2 ;;
    -y|--yes)          YES=1;         shift   ;;
    --plan|--dry-run)  PLAN_ONLY=1;   shift   ;;
    -h|--help)
      sed -n '2,/^set/{/^set/q;p;}' "$0"
      exit 0
      ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

[ -z "$FROM_TAG" ] && { echo "missing --from-tag" >&2; exit 2; }
[ -z "$TO_LIST" ]  && { echo "missing --to (comma-separated agent-ids)" >&2; exit 2; }

require() { command -v "$1" >/dev/null 2>&1 || { echo "missing tool: $1"; exit 1; }; }
require aex-fleet; require waap-cli; require jq; require curl

# Resolve source agents
SOURCES=$(aex-fleet ls --json | jq -r --arg tag "$FROM_TAG" '.agents[] | select(.tags // [] | index($tag)) | .agentId')
[ -z "$SOURCES" ] && { echo "no agents matched --from-tag $FROM_TAG" >&2; exit 2; }

# Resolve recipients + validate each exists with an address
IFS=',' read -r -a RECIPIENTS <<< "$TO_LIST"
for r in "${RECIPIENTS[@]}"; do
  addr=$(aex-fleet ls --json | jq -r --arg id "$r" '.agents[] | select(.agentId == $id) | .address // empty')
  if [ -z "$addr" ]; then
    echo "recipient $r is not registered (or has no address) — \`aex-fleet add $r --address 0x…\` first" >&2
    exit 2
  fi
done

# Summary
SRC_COUNT=$(echo "$SOURCES" | wc -l | tr -d '[:space:]')
DST_COUNT="${#RECIPIENTS[@]}"
TOTAL_TXS=$(( SRC_COUNT * DST_COUNT ))
TOTAL_OUT_PER_SRC=$(awk -v a="$AMOUNT" -v n="$DST_COUNT" 'BEGIN{print a*n}')

echo "═══ fund-from-fleet plan ═══"
echo "  Sources (--from-tag $FROM_TAG):"
echo "$SOURCES" | sed 's/^/    - /'
echo "  Recipients (--to):"
for r in "${RECIPIENTS[@]}"; do echo "    - $r"; done
echo "  Amount per tx: $AMOUNT ETH"
echo "  Total txs: $TOTAL_TXS  (each source sends to each recipient)"
echo "  ETH out per source (pre-gas): $TOTAL_OUT_PER_SRC"
echo

if [ $PLAN_ONLY -eq 1 ]; then
  echo "▸ --plan only — no txes sent. Re-run with --yes to apply."
  exit 0
fi

if [ $YES -eq 0 ]; then
  if [ -t 0 ]; then
    read -r -p "▸ Press Enter to apply, Ctrl-C to abort… "
  else
    echo "▸ stdin is not a TTY — pass --yes for non-interactive runs, or --plan to dry-run." >&2
    exit 2
  fi
fi

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

echo "═══ executing ═══"
i=0
failures=0
for src in $SOURCES; do
  for dst in "${RECIPIENTS[@]}"; do
    i=$((i + 1))
    echo "[$i/$TOTAL_TXS] $src → $dst  ($AMOUNT ETH)"
    aex-fleet use "$src" >/dev/null
    tx_out=$(aex-fleet waap send-tx --to "$dst" --value "$AMOUNT" --chain "$CHAIN_ID" 2>&1)
    # Surface only the key lines so progress is visible without flooding the terminal.
    echo "$tx_out" | grep -E '✅|Transaction submitted|Error' | sed 's/^/    /'
    tx_hash=$(echo "$tx_out" | extract_tx_hash)
    if [ -z "$tx_hash" ]; then
      echo "  ✗ no tx hash extracted" >&2
      failures=$((failures + 1))
      continue
    fi
    echo "  ⏳ awaiting receipt: $tx_hash"
    if wait_for_receipt "$tx_hash"; then
      echo "  ✓ confirmed"
    else
      case $? in
        1) echo "  ✗ reverted" >&2; failures=$((failures + 1)) ;;
        2) echo "  ⚠ receipt timeout (may still confirm)" >&2 ;;
      esac
    fi
  done
done

echo
echo "═══ done — $((TOTAL_TXS - failures))/$TOTAL_TXS confirmed ═══"
if [ $failures -gt 0 ]; then exit 1; fi
