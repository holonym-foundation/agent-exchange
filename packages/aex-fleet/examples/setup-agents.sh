#!/usr/bin/env bash
# Sign up N demo agents (WaaP wallets) WITHOUT starting any loop. Used by the dashboard's
# "Create" step and runnable standalone. Idempotent: existing agents are reused (signup falls
# back to login). Records each agent's EVM address into fleet.json via `aex-fleet set`.
#
# Usage:
#   EMAIL_BASE=webmaster@holonym.id ./setup-agents.sh [COUNT] [PREFIX] [TAG]
#
# Args (all optional):
#   COUNT   number of agents to create (default 3)
#   PREFIX  agent-id prefix (default "pass") → pass-1, pass-2, …
#   TAG     tag applied to each (default "perpetual")
#
# Env:
#   EMAIL_BASE (required)  e.g. webmaster@holonym.id → webmaster+pass1@holonym.id …
#   PASSWORD               default AexPassDemo!1234
#   CHAIN                  default sepolia

set -uo pipefail

EMAIL_BASE="${EMAIL_BASE:-}"
[ -z "$EMAIL_BASE" ] && { echo "EMAIL_BASE required" >&2; exit 1; }
COUNT="${1:-3}"
PREFIX="${2:-pass}"
TAG="${3:-perpetual}"
PASSWORD="${PASSWORD:-AexPassDemo!1234}"
CHAIN="${CHAIN:-sepolia}"

EMAIL_USER="${EMAIL_BASE%@*}"
EMAIL_DOMAIN="${EMAIL_BASE#*@}"

extract_evm_address() {
  perl -ne '
    if (/EvmWalletAddress:?\s*(0x[a-fA-F0-9]{40})/i) { print "$1\n"; exit }
    if (/"(?:address|evm|evmAddress|eth)":\s*"(0x[a-fA-F0-9]{40})"/) { print "$1\n"; exit }
    if (/(0x[a-fA-F0-9]{40})(?![a-fA-F0-9])/) { print "$1\n"; exit }
  '
}

for i in $(seq 1 "$COUNT"); do
  id="${PREFIX}-${i}"
  email="${EMAIL_USER}+${PREFIX}${i}@${EMAIL_DOMAIN}"
  if ! aex-fleet ls --json | jq -e ".agents[] | select(.agentId == \"$id\")" >/dev/null 2>&1; then
    aex-fleet add "$id" --chain "$CHAIN" --email "$email" --tag "$TAG" >/dev/null
    echo "registered $id"
  fi
  aex-fleet use "$id" >/dev/null
  if ! aex-fleet waap whoami >/dev/null 2>&1; then
    echo "signing up $id ($email)…"
    if ! aex-fleet waap signup -e "$email" -p "$PASSWORD" >/dev/null 2>&1; then
      aex-fleet waap login -e "$email" -p "$PASSWORD" >/dev/null 2>&1 || true
    fi
  fi
  addr=$(aex-fleet waap whoami 2>/dev/null | extract_evm_address)
  if [ -n "$addr" ]; then
    aex-fleet set "$id" --address "$addr" >/dev/null
    echo "ready $id $addr"
  else
    echo "WARN: no address for $id" >&2
  fi
done
echo "done: $COUNT agent(s) with prefix '$PREFIX' tag '$TAG'"
