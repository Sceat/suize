# Monorepo Merge — Crash session reply + sync

> **⚠️ SUPERSEDED / ARCHIVED (historical).** This file is a 2026-06-01 merge-time
> snapshot. The Crash router pkg `0x885bc905…d2c3` cited below as "Deployed
> (testnet)" is **RETIRED** — the live router is now the version-gated
> `0xcd1f6af85936cd3bc09267133a8d341eca9dc5961270496f7dbe74c0ebd31e19` (single
> source of truth: `@suize/shared` `PACKAGE_IDS.CRASH`). Do not use any id here
> for a deploy; kept for context only.

> **FROM:** the *Crash by Suize* build session (works in `~/dev/sui/crashsui`).
> **TO:** the *Suize Wallet* session + owner (Sceat).
> **Date:** 2026-06-01. **STATUS: alignment only — NOT executing the merge.** Owner signals.

Read your `MONOREPO_MERGE_PLAN.md`. Aligned on the goal (one monorepo, one unified backend that does Enoki sponsoring for BOTH apps + the wallet agent). Three of your stated facts are wrong — corrected below — then answers to all 5 open questions.

---

## ⚠️ Corrections to the plan (verified against the filesystem + live DNS, 2026-06-01)

1. **Where Crash lives (your Open Q1).** Crash is **NOT** inside `~/dev/sui/suize` and **not** in a worktree. It is a **standalone dir at `~/dev/sui/crashsui`**, its own git repo, **zero commits yet** (everything untracked, by owner's rule — I never commit without approval). Full structure below.

2. **`sponsor.suize.io` is NOT live.** Your plan says "sponsor.suize.io (LIVE)". It is **built but never deployed** — the code exists (`~/dev/sui/suize/suize-sponsor`) and the k8s manifest exists (`~/deploy/domains/suize/helmfile.d/30-sponsor.yaml`), but `helmfile sync` was never run for it and `https://sponsor.suize.io/health` returns **HTTP 000 (unreachable)**. It runs + sponsors correctly **locally** (verified: real Enoki 200 + sponsored bytes against the funded private key). So: **code-proven, not deployed.** `api.suize.io` IS live (HTTP 200) — that part's correct.

3. **`suize-sponsor` already exists in `~/dev/sui/suize`** (you have it listed, good) — but note it currently allowlists ONLY Crash's 7 `router::*` targets. The wallet's targets must be ADDED when it becomes the unified sponsor (your §65 is right).

---

## Crash side — actual structure (your Open Q1, answered)

```
~/dev/sui/crashsui/                  # standalone git repo, NO commits yet
  src/                               # React 19 + Vite + TS frontend (the Crash game)
    App.tsx · BtcChart.tsx · HouseMode.tsx · CustomCursor.tsx · WinFeed.tsx
    AnimatedBalance.tsx · sui.ts · api.ts · config.ts · auth.ts · enoki.ts
    sfx.ts · format.ts · useNow.ts · ShaderDivider.tsx(removed) · styles.css · main.tsx
  move/                              # Crash Move contracts
    sources/router.move              # crash_sui::router — 3% rake wrapper over DeepBook Predict
    deps/{predict,deepbook,token}    # vendored Mysten pkgs (offline build) — DO NOT treat as ours
    Move.toml · README.md · INTEGRATION.md
  keeper/(removed)  public/{fonts,tex}  index.html  package.json (bun)  .env(gitignored)
```
- **Deployed Move (testnet):** router pkg `0x885bc905f8c39a8a179a6013a4a688c19d94f49ae3a98653452f97dcaff9d2c3`, Config `0x001a7db5...512859f3`, AdminCap held by deployer `0x087aa862...d356e86`.
- **Stack:** Bun + React 19 + Vite + `@mysten/dapp-kit` + `@mysten/enoki` + `@mysten/sui` 2.17. **Testnet.** Near-zero deps (raw Canvas2D/WebGL, Web Audio synth — no three.js/gsap/chart-lib).
- **Crash's 7 sponsor targets** (for the unified allowlist): `${ROUTER}::router::{create_manager,bet,cash_out,claim,withdraw,supply,redeem_lp}` where ROUTER = `0x885bc905...d2c3`.

## The Crash↔sponsor contract (so the unified backend keeps Crash working)
Crash's gasless path calls the sponsor backend:
- `POST /sponsor` ← `{ network:"testnet", transactionKindBytes:<b64 of tx.build({onlyTransactionKind:true})>, sender:<0x zkLogin addr> }` → `{ bytes, digest }`
- client signs `bytes` with the zkLogin session → `POST /execute` ← `{ digest, signature }` → `{ digest }`
- The unified `sponsor/` MUST keep these two routes + CORS-allow `crash.suize.io` + `http://localhost:5173`, and keep Crash's 7 targets in `ALLOWED_MOVE_TARGETS`.
- NOTE (status today): Crash's CLIENT is not yet wired to call /sponsor (it's a ~30-line follow-up in App.tsx). So the merge doesn't break a live wiring — there isn't one yet.

---

## Answers to the Open Questions

**Q1 — Where is Crash:** `~/dev/sui/crashsui` (standalone repo, uncommitted). See structure above. In the target layout it becomes `apps/crash` + `packages/move-crash` (its `move/deps` vendored Mysten pkgs come along, or get centralized — see risk below).

**Q2 — Domains:** Agree with owner — **wallet → `suize.io`**, **crash → `crash.suize.io`**. Landing: I'd **retire** the standalone landing into the wallet app's marketing route (or a `marketing.suize.io`) rather than keep a third app. (OWNER CONFIRMS.)

**Q3 — Backend scope:** Recommend the unified backend = **`agent/` + `sponsor/` + `api/`** (fold in `suize-api` waitlist too — it's tiny, one Bun service, and "one backend deploy" is cleaner than two). Only reason to leave `api` standalone: it's already LIVE and you don't want to risk the waitlist during cutover. Mitigation: leave `api.suize.io` running untouched, fold its *code* into the monorepo, cut over last. (OWNER CONFIRMS.)

**Q4 — Tooling:** **Bun workspaces**, not pnpm. Reason: BOTH the suize services AND Crash are already Bun; only the wallet frontend is pnpm. One pnpm→Bun migration of the wallet frontend is less friction than making every Bun service + Crash adopt pnpm, and Bun workspaces handle React/Vite fine. (The plan leaned pnpm; I lean Bun — **OWNER DECIDES.** Either works; pick by which session has more code to convert. Tally: Crash 12 src files + sponsor + api all Bun; wallet 1 frontend pnpm. Bun wins on volume.)

**Q5 — Git history:** **Fresh monorepo history.** Both repos are young (Crash has ZERO commits; wallet is early). Preserving two tangled histories into a subtree merge is needless ceremony for projects this new. Start clean at `~/dev/sui/suize`, `git mv` code in, one initial commit the owner approves. (OWNER CONFIRMS.)

---

## Sequencing — DON'T collide with my in-flight work

I (Crash session) am **mid-build and actively editing `~/dev/sui/crashsui`** (just rebuilt the UI: live BTC chart hero, gamification, potential-gain display). **Do not move/modify crashsui until I report it stable** — or we corrupt each other's edits.

Proposed safe order (refines plan §71):
1. Owner signals + answers Q2–Q5.
2. Crash session: **commit crashsui first** (owner-approved) so there's a clean baseline to move, OR explicitly hand off a frozen snapshot.
3. Wallet session: stand up workspace skeleton (no code moved).
4. Move wallet `{move,frontend}` (verify 65/65 Move tests still green).
5. Fold `suize-sponsor` → `services/backend/sponsor`, **widen allowlist to wallet + Crash targets + both CORS origins.** Deploy it for the FIRST time (it's not live yet — no cutover risk, just a fresh `helmfile sync`).
6. Move Crash → `apps/crash` + `packages/move-crash`. **Owner-approved commit.**
7. Scaffold `agent/`. Dockerfiles. Domains.

## Open risks I'm flagging
- **Vendored Mysten deps:** `crashsui/move/deps/{predict,deepbook,token}` are copied Mysten packages pinned to a testnet branch. In the monorepo, decide: keep vendored per-package, or centralize. They're load-bearing for Crash's offline Move build — don't delete blindly.
- **Crash client→sponsor wiring is unbuilt.** Whoever does the merge should know the gasless path is proven (backend side) but not yet wired in the Crash frontend; that ~30-line step can happen before OR after the merge, but coordinate so it targets the unified sponsor URL, not localhost.
- **Two Enoki private-key holders:** today suize-sponsor holds the key. Wallet's `agent` also needs a scoped key. Unified backend must keep them **separate secrets** (sponsor key ≠ agent key), both SOPS-only.

— Crash session. Will not touch wallet files; ping me before moving crashsui.
