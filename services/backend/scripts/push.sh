#!/usr/bin/env bash
set -euo pipefail

# Build + push the UNIFIED @suize/backend image.
#
# The backend depends on the `@suize/shared` workspace package, so the Docker
# build context is the REPO ROOT and the Dockerfile is referenced with -f. We
# cd to the repo root (two levels up: services/backend/scripts -> root) and build
# from there.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
ROOT_DIR="$(cd "${BACKEND_DIR}/../.." && pwd)"
cd "$ROOT_DIR"

# ── Configuration ─────────────────────────────────────────────────────
REGISTRY="${DOCKER_REGISTRY:?set DOCKER_REGISTRY to your container registry host (e.g. registry.example.com)}"
IMAGE_NAME="${DOCKER_IMAGE:-suize-backend}"
FULL_IMAGE="${REGISTRY}/${IMAGE_NAME}"
DOCKERFILE="services/backend/Dockerfile"
PKG="services/backend/package.json"

# ── Optional version bump (patch|minor|major) ────────────────────────
BUMP_TYPE="${1:-}"
if [[ -n "$BUMP_TYPE" ]]; then
  case "$BUMP_TYPE" in
    patch|minor|major) ;;
    *)
      echo "Usage: $0 [patch|minor|major]"
      echo ""
      echo "  (no arg)   Use current package.json version as tag — no bump, no git tag"
      echo "  patch      0.1.0 -> 0.1.1, tag suize-backend-v0.1.1"
      echo "  minor      0.1.0 -> 0.2.0, tag suize-backend-v0.2.0"
      echo "  major      0.1.0 -> 1.0.0, tag suize-backend-v1.0.0"
      exit 1
      ;;
  esac
  TAG=$(node -e "
    const fs = require('fs');
    const pkg = JSON.parse(fs.readFileSync('${PKG}', 'utf8'));
    const [major, minor, patch] = pkg.version.split('.').map(Number);
    const bumps = { patch: [major, minor, patch+1], minor: [major, minor+1, 0], major: [major+1, 0, 0] };
    pkg.version = bumps['${BUMP_TYPE}'].join('.');
    fs.writeFileSync('${PKG}', JSON.stringify(pkg, null, 2) + '\n');
    process.stdout.write(pkg.version);
  ")
  if git rev-parse --verify HEAD >/dev/null 2>&1; then
    git tag -a "suize-backend-v${TAG}" -m "Release suize-backend v${TAG}"
    echo "Tagged suize-backend-v${TAG}"
  else
    echo "⚠ no commits yet — skipping git tag (tag manually after first commit)"
  fi
else
  TAG=$(node -p "require('./${PKG}').version")
fi

# ── Ensure logged in ─────────────────────────────────────────────────
if ! grep -q "\"${REGISTRY}\"" ~/.docker/config.json 2>/dev/null; then
    echo "No credentials found for ${REGISTRY}. Running docker login..."
    docker login "$REGISTRY"
fi

# ── Build (ROOT context, backend Dockerfile) ─────────────────────────
echo "Building ${FULL_IMAGE}:${TAG} (linux/amd64) from repo root..."
docker build --platform linux/amd64 \
  -f "${DOCKERFILE}" \
  -t "${FULL_IMAGE}:${TAG}" \
  -t "${FULL_IMAGE}:latest" \
  .

# ── Push ──────────────────────────────────────────────────────────────
echo ""
echo "Pushing ${FULL_IMAGE}:${TAG}..."
docker push "${FULL_IMAGE}:${TAG}"
echo "Pushing ${FULL_IMAGE}:latest..."
docker push "${FULL_IMAGE}:latest"

# ── Summary ───────────────────────────────────────────────────────────
echo ""
echo "============================================"
echo "  Pushed: ${FULL_IMAGE}:${TAG}"
echo "  Tag:    ${TAG}"
echo "============================================"
echo ""
echo "Next: roll your deployment to pick up this image"
echo "  Bump the image tag to \"${TAG}\" in your deploy environment and re-sync."
echo ""
