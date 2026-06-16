# @suize/backend — multi-stage Bun image.
#
# Build context is the REPO ROOT (~/dev/sui/suize), NOT this directory, because
# the backend now depends on the workspace package `@suize/shared`. Building from
# root lets `bun install --frozen-lockfile` resolve the workspace graph against the
# committed `bun.lock` for a deterministic, reproducible install.
#
#   docker build -f services/backend/Dockerfile -t <registry>/suize-backend .
#
# (`scripts/push.sh` does this for you with the root context.)

# --- deps: install ONLY the backend workspace + its deps, frozen to bun.lock ---
FROM oven/bun:1.3.5-alpine AS deps
WORKDIR /app
# Lockfile + every workspace manifest so --frozen-lockfile can validate the graph.
COPY package.json bun.lock ./
COPY apps/wallet/package.json ./apps/wallet/package.json
COPY apps/landing/package.json ./apps/landing/package.json
COPY apps/crash/package.json ./apps/crash/package.json
COPY packages/shared/package.json ./packages/shared/package.json
COPY packages/move-wallet/package.json ./packages/move-wallet/package.json
COPY packages/move-deploy/package.json ./packages/move-deploy/package.json
COPY packages/move-subs/package.json ./packages/move-subs/package.json
COPY packages/x402/package.json ./packages/x402/package.json
COPY packages/pay/package.json ./packages/pay/package.json
COPY packages/mcp/package.json ./packages/mcp/package.json
COPY packages/move-auction/package.json ./packages/move-auction/package.json
COPY packages/move-profile/package.json ./packages/move-profile/package.json
COPY apps/deploy/package.json ./apps/deploy/package.json
COPY apps/agents/package.json ./apps/agents/package.json
COPY apps/deck/package.json ./apps/deck/package.json
COPY services/deploy-worker/package.json ./services/deploy-worker/package.json
COPY services/backend/package.json ./services/backend/package.json
# --filter installs the backend + its workspace dep (@suize/shared) only — no
# frontend toolchains. --production drops devDependencies. --frozen-lockfile
# forbids any lockfile drift (fails the build instead of silently resolving).
# Every workspace manifest must be COPYed above (incl. apps/crash) or
# --frozen-lockfile aborts on the missing member.
RUN bun install --frozen-lockfile --production --filter './services/backend'

# --- build: full deps + typecheck (fails the build on type errors) ---
FROM oven/bun:1.3.5-alpine AS build
WORKDIR /app
COPY package.json bun.lock ./
COPY apps/wallet/package.json ./apps/wallet/package.json
COPY apps/landing/package.json ./apps/landing/package.json
COPY apps/crash/package.json ./apps/crash/package.json
COPY packages/shared/package.json ./packages/shared/package.json
COPY packages/move-wallet/package.json ./packages/move-wallet/package.json
COPY packages/move-deploy/package.json ./packages/move-deploy/package.json
COPY packages/move-subs/package.json ./packages/move-subs/package.json
COPY packages/x402/package.json ./packages/x402/package.json
COPY packages/pay/package.json ./packages/pay/package.json
COPY packages/mcp/package.json ./packages/mcp/package.json
COPY packages/move-auction/package.json ./packages/move-auction/package.json
COPY packages/move-profile/package.json ./packages/move-profile/package.json
COPY apps/deploy/package.json ./apps/deploy/package.json
COPY apps/agents/package.json ./apps/agents/package.json
COPY apps/deck/package.json ./apps/deck/package.json
COPY services/deploy-worker/package.json ./services/deploy-worker/package.json
COPY services/backend/package.json ./services/backend/package.json
RUN bun install --frozen-lockfile --filter './services/backend'
# Workspace source needed to typecheck: every @suize/* the backend imports as TS
# source (shared + pay + x402) + the backend itself.
COPY packages/shared ./packages/shared
COPY packages/pay ./packages/pay
COPY packages/x402 ./packages/x402
COPY services/backend/tsconfig.json ./services/backend/tsconfig.json
COPY services/backend/src ./services/backend/src
RUN cd services/backend && bun run typecheck

# --- runtime: prod deps + source (backend + shared), non-root ---
FROM oven/bun:1.3.5-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
# Hoisted workspace node_modules + the regenerated @suize/* symlinks.
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/services/backend/node_modules ./services/backend/node_modules
COPY package.json bun.lock ./
COPY services/backend/package.json ./services/backend/package.json
# @suize/shared + @suize/pay + @suize/x402 are consumed as TS source (package main ->
# src/index.ts), so their source must ship in the runtime image (the workspace symlink
# in node_modules points here; a missing dir = ENOENT at boot).
COPY packages/shared ./packages/shared
COPY packages/pay ./packages/pay
COPY packages/x402 ./packages/x402
# bun's --filter install is NON-hoisted: x402's own deps (@mysten/sui) live in its
# LOCAL node_modules, not /app/node_modules. Ship it or x402 can't resolve at boot.
COPY --from=deps /app/packages/x402/node_modules ./packages/x402/node_modules
COPY services/backend/src ./services/backend/src
USER bun
EXPOSE 8080
WORKDIR /app/services/backend
CMD ["bun", "run", "start"]
