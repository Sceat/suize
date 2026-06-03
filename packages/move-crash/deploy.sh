#!/usr/bin/env bash
# ============================================================================
# Crash Sui — Move router redeploy helper.
# Builds, publishes to the active sui CLI env, and prints the new package id +
# the created Config / AdminCap object ids to paste into src/config.ts.
# Usage:  ./deploy.sh        (run from this move/ directory)
# Prereqs: sui CLI on testnet, gas in the active address, jq installed.
# ============================================================================
set -euo pipefail

cd "$(dirname "$0")"

echo "==> sui move build"
sui move build

echo "==> sui client publish (gas budget 200000000)"
out="$(sui client publish --gas-budget 200000000 --json)"

echo "$out" > .last-publish.json

pkg="$(echo "$out" | jq -r '.objectChanges[] | select(.type=="published") | .packageId')"
config="$(echo "$out" | jq -r '.objectChanges[] | select(.type=="created" and (.objectType // "" | endswith("::router::Config"))) | .objectId')"
admin="$(echo "$out" | jq -r '.objectChanges[] | select(.type=="created" and (.objectType // "" | contains("AdminCap"))) | .objectId')"

echo ""
echo "============================================================"
echo "ROUTER_PACKAGE : ${pkg:-<not found>}"
echo "ROUTER_CONFIG  : ${config:-<not found>}"
echo "AdminCap       : ${admin:-<none>}"
echo "============================================================"
echo "Paste ROUTER_PACKAGE + ROUTER_CONFIG into ../src/config.ts."
echo "Full output saved to move/.last-publish.json"
