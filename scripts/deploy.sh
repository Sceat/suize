#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# Suize — unified Vercel deploy with semver publishing.
#
# ONE script deploys any frontend app (wallet · crash · landing): it optionally
# bumps that app's package.json version, git-tags the release `<app>-vX.Y.Z`, then
# runs `vercel --prod` from the app's directory (its own linked Vercel project).
#
# Usage:
#   bun run deploy <wallet|crash|landing> [patch|minor|major]
#   bun run deploy:wallet [patch|minor|major]
#   bun run deploy:crash  [patch|minor|major]
#   bun run deploy:landing [patch|minor|major]
#
# Examples:
#   bun run deploy:wallet patch    # 0.1.0 -> 0.1.1, tag wallet-v0.1.1, deploy
#   bun run deploy:crash           # redeploy current crash version (no bump)
#
# One-time per app (owner): from apps/<app>/ run `npx vercel link` to a project
# (Root Directory = apps/<app>), set the Production env vars in the Vercel
# dashboard, and attach the domain. RELEASE IS GATED on the unified backend
# (WS + /sponsor) being live at api.suize.io — see services/backend/DEPLOY.md.
# ──────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# repo root (this script lives in <root>/scripts/)
cd "$(dirname "${BASH_SOURCE[0]}")/.."

APP="${1:-}"
BUMP="${2:-}"

case "$APP" in
  wallet | crash | landing) ;;
  *)
    echo "usage: bun run deploy <wallet|crash|landing> [patch|minor|major]"
    exit 1
    ;;
esac

DIR="apps/$APP"
[ -d "$DIR" ] || { echo "✗ missing $DIR"; exit 1; }
cd "$DIR"

if [[ -n "$BUMP" ]]; then
  TAG=$(node -e "
    const fs = require('fs');
    const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    const [major, minor, patch] = pkg.version.split('.').map(Number);
    const bumps = { patch: [major, minor, patch + 1], minor: [major, minor + 1, 0], major: [major + 1, 0, 0] };
    if (!bumps['${BUMP}']) { console.error('bump type must be patch | minor | major'); process.exit(1); }
    pkg.version = bumps['${BUMP}'].join('.');
    fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
    process.stdout.write(pkg.version);
  ")
  if git rev-parse --verify HEAD >/dev/null 2>&1; then
    git tag -a "${APP}-v${TAG}" -m "Release ${APP} v${TAG}"
    echo "Tagged ${APP}-v${TAG}"
  else
    echo "⚠ no commits yet — skipping git tag (tag manually after the first commit)"
  fi
else
  TAG=$(node -p "require('./package.json').version")
fi

echo "Deploying ${APP} v${TAG} to Vercel (production)…"
# Monorepo gotcha: the bun workspace dep (@suize/shared = "workspace:*") only
# resolves with the repo ROOT present, which Vercel's CLOUD build lacks when only
# this app dir is the project root — `bun install` dies with
# "@suize/shared@workspace:* failed to resolve". So build LOCALLY (the whole
# workspace is on disk here) and ship the PREBUILT output; Vercel never installs.
# `vercel build` bakes the project's Production env vars — set them once in the
# Vercel dashboard / via `vercel env add`: VITE_ENOKI_API_KEY, VITE_GOOGLE_CLIENT_ID,
# VITE_WS_URL=wss://api.suize.io/ws, VITE_AGENT_ADDRESS.
# --scope pins the aresrpg TEAM so deploys never fall back to a personal scope
# (the crash app once shipped to sceats-projects because the scope wasn't pinned).
npx vercel@latest pull --yes --environment=production --scope aresrpg
npx vercel@latest build --prod
npx vercel@latest deploy --prebuilt --prod --scope aresrpg

echo ""
echo "════════════════════════════════════════════"
echo "  ✓ Deployed ${APP} v${TAG}"
echo "════════════════════════════════════════════"
