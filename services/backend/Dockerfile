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
FROM oven/bun:1-alpine AS deps
WORKDIR /app
# Lockfile + every workspace manifest so --frozen-lockfile can validate the graph.
COPY package.json bun.lock ./
COPY apps/wallet/package.json ./apps/wallet/package.json
COPY apps/landing/package.json ./apps/landing/package.json
COPY packages/shared/package.json ./packages/shared/package.json
COPY packages/move-wallet/package.json ./packages/move-wallet/package.json
COPY services/backend/package.json ./services/backend/package.json
# --filter installs the backend + its workspace dep (@suize/shared) only — no
# frontend toolchains. --production drops devDependencies. --frozen-lockfile
# forbids any lockfile drift (fails the build instead of silently resolving).
RUN bun install --frozen-lockfile --production --filter './services/backend'

# --- build: full deps + typecheck (fails the build on type errors) ---
FROM oven/bun:1-alpine AS build
WORKDIR /app
COPY package.json bun.lock ./
COPY apps/wallet/package.json ./apps/wallet/package.json
COPY apps/landing/package.json ./apps/landing/package.json
COPY packages/shared/package.json ./packages/shared/package.json
COPY packages/move-wallet/package.json ./packages/move-wallet/package.json
COPY services/backend/package.json ./services/backend/package.json
RUN bun install --frozen-lockfile --filter './services/backend'
# Workspace source needed to typecheck: the shared package + the backend.
COPY packages/shared ./packages/shared
COPY services/backend/tsconfig.json ./services/backend/tsconfig.json
COPY services/backend/src ./services/backend/src
RUN cd services/backend && bun run typecheck

# --- runtime: prod deps + source (backend + shared), non-root ---
FROM oven/bun:1-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
# Hoisted workspace node_modules + the regenerated @suize/* symlinks.
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/services/backend/node_modules ./services/backend/node_modules
COPY package.json bun.lock ./
COPY services/backend/package.json ./services/backend/package.json
# @suize/shared is consumed as TS source (its package main -> src/index.ts), so
# the source must ship in the runtime image.
COPY packages/shared ./packages/shared
COPY services/backend/src ./services/backend/src
USER bun
EXPOSE 8080
WORKDIR /app/services/backend
CMD ["bun", "run", "start"]
