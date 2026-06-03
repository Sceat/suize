# Suize Monorepo Merge Plan

> **STATUS: PROPOSAL — do NOT execute yet.** The owner (Sceat) gives the signal to start.
> **TO:** the *Crash by Suize* build session (working in `~/dev/sui/suize`).
> **FROM:** the *Suize Wallet* build session (working in `~/dev/sui/suize-wallet`).
> **Date:** 2026-06-01.

## TL;DR

Two parallel build sessions exist. The owner wants them **consolidated into ONE clean monorepo at `~/dev/sui/suize`** — multi-package, proper Dockerfiles — with a **single unified backend** that runs **(a) the wallet's AI agent** and **(b) Enoki sponsoring for BOTH the wallet and Crash**. This doc is for alignment. **Nothing moves until the owner signals.**

---

## The two projects today

### Suize Wallet — `~/dev/sui/suize-wallet` (separate git repo)
An **agentic Sui wallet**: you dedicate a *sandbox* of risk capital to an AI agent that operates it 24/7, leashed by an on-chain Move "mandate" it physically cannot escape. (Full detail in `~/dev/sui/suize-wallet/docs/` — ARCHITECTURE / SPEC / SECURITY / PITCH / UX — and its `CLAUDE.md`.)

- `packages/move` — `mandate` · `vault` · `swap` · `navi` — **✅ 65/65 tests.** The on-chain cage + protocol adapters. (`guardian` throttle + `withdraw_all` are next.)
- `packages/frontend` — React 19 / Vite / `@mysten/dapp-kit` / `@mysten/enoki` — the Zen wallet UI (home + onboarding, first-cut, mock data, stubbed auth).
- **Planned, not yet built:** `packages/agent` (the off-chain AI brain — per-cycle loop, signals, PTBs, holds a **scoped agent key**), `packages/shared`.
- **Uses:** NAVI (lending), DeepBook v3 (spot swap), Pyth (prices), Enoki (zkLogin + sponsor), SuiNS (`<name>@suize`), Claude (LLM *narrator only* — never touches money).
- **Network: testnet** (decided — reuses the existing testnet Enoki/sponsor; no real funds behind unaudited code).

### `~/dev/sui/suize` today (this repo — Crash + marketing)
Sibling dirs, **not yet a workspace**:
- `landing/` — Vite marketing site, deployed on **Vercel** (currently serves `suize.io`).
- `suize-api/` — Bun waitlist/Turnstile API → **`api.suize.io` (LIVE)**.
- `suize-sponsor/` — Bun **Enoki sponsor backend** → **`sponsor.suize.io` (LIVE)**. Holds the Enoki private key (SOPS); currently allow-lists **Crash's** move targets only.
- `marketing/`, `veo3/`, `screenshots/` — assets.
- **The Crash game (frontend + Move contracts) is NOT visible to me** — likely in a `.claude/worktree` or in progress. **Please point me to it.**

> Deploy infra (from earlier recon): apex `suize.io` = Vercel; `api`/`sponsor`.suize.io = self-hosted k8s (Talos + Helmfile + SOPS + Cloudflare Tunnel), per `~/deploy/deploy.yaml`.

---

## Target: one monorepo at `~/dev/sui/suize`

Proposed clean layout (final tooling TBD — see Open Questions):

```
~/dev/sui/suize/                 # workspace root (pnpm or bun) + turbo (optional)
  apps/
    wallet/        # the Zen wallet frontend   (← suize-wallet/packages/frontend)   → suize.io
    crash/         # the Crash game frontend                                         → crash.suize.io
    landing/       # existing marketing site                                         → marketing subdomain / retired?
  packages/
    move-wallet/   # mandate · vault · swap · navi  (← suize-wallet/packages/move)
    move-crash/    # Crash Move contracts
    shared/        # shared TS: sui client, types, generated package IDs
  services/
    backend/       # THE UNIFIED BACKEND (one deploy, modular)
      sponsor/     #   Enoki sponsored-tx for BOTH apps (← absorbs suize-sponsor)
      agent/       #   the wallet's AI brain (per-cycle loop, signals, scoped agent key)
      api/         #   waitlist etc. (← absorb suize-api?  open question)
  infra/
    docker/        # clean Dockerfiles per service/app
    k8s/           # the existing Helmfile / Cloudflare-Tunnel deploy
  package.json · pnpm-workspace.yaml (or bun) · turbo.json · README.md
```

## The unified backend (the core change the owner asked for)

**One backend, modular**, serving both apps:
- **`sponsor/`** — Enoki sponsored transactions for **wallet + Crash**. Absorbs `suize-sponsor`. **Its `ALLOWED_MOVE_TARGETS` must include BOTH** the wallet's targets (`mandate`/`vault`/`swap`/`navi`) **and** Crash's contract targets, and **both origins** in CORS.
- **`agent/`** — the wallet's AI brain (NEW, from `suize-wallet` plans): the deterministic per-cycle loop, the two degen signals, the optimizer, batched PTBs. Holds the **scoped agent key** (env-isolated; never in any frontend).
- **`api/`** — (open) fold in `suize-api` (waitlist) or leave it standalone.

> Security note (from the wallet's SECURITY.md): the agent key and the Enoki **private** key are **backend-only secrets** (SOPS / gitignored env), **never** in a frontend bundle, **never** committed.

## Migration approach (only WHEN the owner signals)

1. Stand up the workspace skeleton (root `package.json` + workspace config + `turbo`), no code moved yet.
2. Move `suize-wallet/packages/{move,frontend}` → `packages/move-wallet`, `apps/wallet`. **Preserve the 65/65 Move tests** (verify `sui move test` still green after the move).
3. Fold `suize-sponsor` → `services/backend/sponsor`; widen its allow-list to both apps. **Keep the LIVE `sponsor.suize.io` running until the new one is cut over.**
4. Scaffold `services/backend/agent` (the new wallet brain).
5. Place the Crash app + contracts into `apps/crash` + `packages/move-crash` (the Crash session drives this, or hands me the layout).
6. Clean Dockerfiles per service/app; wire `infra/`.
7. Update deploy + domains (Vercel apex retarget, k8s/tunnel hostnames). **Don't break the live backends during cutover.**
8. Decide git history (see Open Questions) before the first commit. **The owner approves all commits.**

## Open Questions — please confirm (Crash session + owner)

1. **Where is the Crash game code** (frontend + Move contracts) right now?
2. **Domains:** owner wants the **wallet at `suize.io`**. So: wallet → `suize.io`, crash → `crash.suize.io`, landing → marketing subdomain **or retired**? Confirm.
3. **Backend scope:** does the unified backend absorb `suize-api` (waitlist), or just `agent` + `sponsor`?
4. **Tooling:** wallet is **pnpm + ESM**; the suize services are **Bun**. Pick ONE workspace manager. (Lean: pnpm workspaces at the root; Bun-runtime services are fine inside it.)
5. **Git:** merge both repos' histories, or fresh monorepo history (move code in, new history)? Both are currently **separate** git repos.

## Hard constraints

- **Do NOT break the LIVE backends** (`api.suize.io`, `sponsor.suize.io`) during migration — cut over, don't yank.
- **Preserve the wallet's 65/65 Move tests.**
- Clean, proper **Dockerfiles** per service/app (the owner's explicit ask).
- **Testnet** (the decided network for both).
- **DO NOT execute the merge until the owner signals.** This doc is for alignment only.

---

*Reply / annotate inline, or leave a sibling `MONOREPO_MERGE_NOTES.md` with the Crash side's structure + answers to the Open Questions.*
