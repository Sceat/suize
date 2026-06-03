#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

BUMP_TYPE="${1:-}"
if [[ -n "$BUMP_TYPE" ]]; then
  TAG=$(node -e "
    const fs = require('fs');
    const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    const [major, minor, patch] = pkg.version.split('.').map(Number);
    const bumps = { patch: [major, minor, patch+1], minor: [major, minor+1, 0], major: [major+1, 0, 0] };
    if (!bumps['${BUMP_TYPE}']) { console.error('bump type must be patch | minor | major'); process.exit(1); }
    pkg.version = bumps['${BUMP_TYPE}'].join('.');
    fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
    process.stdout.write(pkg.version);
  ")
  if git rev-parse --verify HEAD >/dev/null 2>&1; then
    git tag -a "landing-v${TAG}" -m "Release landing v${TAG}"
    echo "Tagged landing-v${TAG}"
  else
    echo "⚠ no commits yet — skipping git tag (run again after first commit, or tag manually later)"
  fi
else
  TAG=$(node -p "require('./package.json').version")
fi

echo "Deploying landing v${TAG} to Vercel..."
npx vercel --prod

echo ""
echo "============================================"
echo "  Deployed: landing v${TAG}"
echo "============================================"
