# Suize — Monorepo (CLAUDE.md)

> Loaded every session. The one file to understand the whole repo. Keep it tight; per-app detail lives in each app/package's own `docs/` + SPEC. Sources of detail are pointed to inline — **reference, never redeclare.**

**Suize** is a Sui product suite shipped as **one Bun-workspace monorepo** for Sui Overflow 2026. Two products share one backend, one shared-constants package, and one network:

- **the agentic wallet** — you dedicate a risk-capital *sandbox* to an AI agent leashed by an on-chain Move **mandate** it physically cannot escape (the cage). The kill-move (jailbreak → VM aborts → revoke) is the demo centerpiece.
- **Crash** — a betting game: DeepBook Predict wrapped by `crash_sui::router` that skims 3% of the quoted cost on-chain, gasless via the shared sponsor. *(Migrated into `apps/crash` + `packages/move-crash`; client wired to the backend's gasless `/sponsor`+`/execute`.)*

**Everything targets Sui TESTNET.** No real funds behind unaudited code. The testnet→mainnet gate is `docs/MAINNET_CHECKLIST.md` (later).

---

## The repo at a glance

```
apps/        wallet/      @suize/wallet    React 19 + Vite — the Zen wallet UI            → suize.io
             landing/     @suize/landing   Vite marketing / waitlist                      → marketing
             crash/       @suize/crash     React 19 + Vite — live BTC up/down betting game → crash.suize.io
packages/    shared/      @suize/shared    network + PACKAGE_IDS + sponsor wire types — SINGLE SOURCE OF TRUTH
             move-wallet/ @suize/move-wallet  mandate · vault · swap · navi (Move, 65/65)
             move-crash/  @suize/move-crash   crash_sui::router (skims 3% of the quoted cost over DeepBook Predict) + vendored Mysten deps
services/    backend/     @suize/backend   ONE Bun service: sponsor + api(waitlist) + agent(stub)
```

### Each piece in a few lines

- **`apps/wallet` (`@suize/wallet`)** — React 19 / Vite / `@mysten/dapp-kit` / `@mysten/enoki`. The editorial-journal wallet: a three-account model (Main + AI Spending + AI Investing) on a single **Enoki-verified WebSocket** transport (auth at upgrade, no cookies/sessions), with **real testnet chain writes** — Enoki zkLogin, SuiNS `<name>@suize` onboarding, and sponsored PTBs (mandate/vault/swap/navi + send) against the published `move-wallet` package. The autonomous agent loop is the only stub. Detail: `apps/wallet/README.md`, design spec in `docs/wallet/`.
- **`apps/landing` (`@suize/landing`)** — React 19 / Vite 7 / Tailwind v4 / OGL fluid shader. Marketing + waitlist (posts to the backend's `/waitlist`). Deploys to Vercel.
- **`apps/crash` (`@suize/crash`)** — React 19 / Vite / `@mysten/dapp-kit` / `@mysten/enoki`. The Crash betting game: a live BTC up/down 15-min binary on DeepBook Predict, with a Canvas2D live-price chart hero (entry line, potential-gain display), Google-zkLogin **gasless** writes routed through the backend's `/sponsor`+`/execute`, plus a "Be the House" PLP-vault panel. Migrated from the former standalone `crashsui`. Detail: `apps/crash/README.md`, `apps/crash/INTEGRATION.md`.
- **`packages/shared` (`@suize/shared`)** — pure types + constants, zero runtime deps. Owns `NETWORK='testnet'`, `fullnodeUrl()`, `PACKAGE_IDS` (Crash router + its 7 sponsorable `router::*` targets, and the **published** `move-wallet` package `0x285865f6…314267b1` + its sponsorable `WALLET_MOVE_TARGETS`), and the sponsor `/sponsor`+`/execute` wire types. **The single source of truth: network, on-chain ids, and pins live ONLY here.** Imported by every app + service.
- **`packages/move-wallet` (`@suize/move-wallet`)** — the Move package `suize` (`edition = "2024"`). Four modules, **65/65 tests green** — `mandate` (the cage), `vault` (per-user custody), `swap` (DeepBook spot SUI↔USDC adapter), `navi` (NAVI lend-as-is adapter). `Move.toml` is pinned to `framework/testnet`. Detail: `docs/wallet/ARCHITECTURE.md`.
- **`packages/move-crash` (`@suize/move-crash`)** — Crash's Move package `crash_sui` (`router` module: a thin wrapper over DeepBook Predict that skims 3% of the quoted cost to a treasury and is the only Enoki-sponsored surface). Vendors Mysten's `predict`/`deepbook`/`token` under `deps/` for an offline `sui move build`. Live on testnet (router pkg in `@suize/shared` `PACKAGE_IDS.CRASH`). Detail: `packages/move-crash/README.md`, `apps/crash/INTEGRATION.md`.
- **`services/backend` (`@suize/backend`)** — ONE Bun service, one port, modular: **sponsor** (Enoki sponsored tx for both apps — `POST /sponsor`, `POST /execute`; allow-lists the union of both apps' Move targets from `@suize/shared`), **api** (waitlist / Turnstile — `POST /waitlist`), **agent** (the wallet AI brain — **STUB**, not wired). Per-component readiness probes. Folds in the former standalone `suize-sponsor` + `suize-api`. Detail: `services/backend/DEPLOY.md`.

---

## Build status (2026-06-04)

| Piece | Status |
|---|---|
| `packages/move-wallet` | **✅ 65/65 Move tests** (mandate 11 · vault 12 · swap 18 · navi 24; ~47 are `#[expected_failure]` refusal proofs). Gate + custody round-trips fully unit-tested; the real DeepBook/NAVI calls are compile-verified behind a seam and need a live integration run (see ARCHITECTURE §2). |
| `apps/wallet` | **Real on testnet** — Enoki zkLogin + single Enoki-verified WS transport + sponsored PTBs (send/mandate/vault/swap/navi) on the published `move-wallet` package + SuiNS `<name>@suize` onboarding. Editorial-journal UI (3-account). Agent loop stubbed. Not yet deployed (gated on the backend cutover). |
| `apps/landing` | Shipping marketing site (Vercel). |
| `services/backend` | Consolidated (sponsor + api + agent-stub), typechecks. Sponsor + waitlist proven; agent is a stub. |
| `packages/shared` | Done. Wallet `PACKAGE_IDS` point at the **published** `move-wallet` package on testnet (`0x285865f6…314267b1`); `WALLET_MOVE_TARGETS` is the sponsorable set. |
| `apps/crash` | **Migrated + building** (tsc clean, vite build green). Live BTC chart UI, gasless client wired to backend `/sponsor`+`/execute` (round-trip proven: 200 + sponsored bytes). First real gasless bet needs a manual Google login (can't headless). |
| `packages/move-crash` | **Migrated, `sui move build` green.** Router live on testnet. Pre-mainnet: version gate + `RakeTaken` event (per audit). |

---

## LOCKED DECISIONS (do not relitigate)

1. **Network = TESTNET.** One `NETWORK` const in `@suize/shared`; the backend sponsor hard-rejects anything but `testnet`. Mainnet is a later, gated flip (`docs/MAINNET_CHECKLIST.md`).
2. **Bun workspaces.** One toolchain. Root `package.json` globs `apps/* packages/* services/*`; `bun install` at the root; `bun run dev` / `bun run build` fan out via `--filter '*'`. No pnpm, no turbo.
3. **ONE unified backend.** `services/backend` runs sponsor + api + agent on one port, one image, one deploy. Not three services.
4. **`@suize/*` package naming** across the workspace (`@suize/wallet`, `@suize/landing`, `@suize/shared`, `@suize/move-wallet`, `@suize/backend`).
5. **Network, on-chain ids, and version pins live ONLY in `@suize/shared`.** No app or service hardcodes a package id, target, or network — they import from shared.
6. **Per-app SPEC.md; docs reference, never redeclare.** State each fact once, in its owning doc; link to it elsewhere. The wallet's irreducible doc set is `docs/wallet/{SPEC,ARCHITECTURE,SECURITY}.md`.
7. **No commit/stage without the owner's approval.** Never `git add`/`commit`/`push` until the owner signs off. (Owner's standing rule.)

---

## Conventions

- **JS/TS:** ESM everywhere (`"type": "module"`). Bun is the runtime + workspace manager; the wallet/landing build with Vite, the backend runs on Bun directly.
- **Move:** `edition = "2024"`; shared `Mandate`, key-only non-transferable `AgentCap`, owner-**address** auth (zkLogin gives a stable address — nothing to phish). Abort codes are a public contract — never renumber.
- **Secrets are env-only (SOPS in k8s), never committed, never in a frontend bundle.** The Enoki **private** key (sponsor) and the future scoped **agent** key are **separate** secrets.
- **The number wall (the soul, in code):** a deterministic core owns every on-chain amount/size/slippage; the LLM/signals only rank strategy and narrate — they **never** emit a number that lands in a transaction. Governs DEGEN too.

---

## The wallet thesis (one paragraph)

An **agentic Sui wallet**: you dedicate a risk-capital **sandbox** to an AI agent that **operates itself 24/7**, leashed by an on-chain Move **mandate** the VM enforces (budget cap + protocol scope + expiry + instant revoke — the agent's over-limit tx is *impossible to construct*, not "denied by a backend"). **Caveat (in-flight hardening):** the budget gate + `idle/deployed` custody hold today, but the **swap and NAVI-withdraw legs are being hardened** (pinned pool + asset-bound tickets); **until the wallet republishes, treat those two legs as not-yet-fully-VM-caged** — on those specific paths the "impossible to construct" / "funds never leave Move custody" claim is aspirational, not yet shipped. Two balances: **MAIN** (the user's savings, the agent never touches it) and the **SANDBOX** (caged play money). A **dual dial** picks which mandate is minted — **SAFE** = NAVI lend-as-is, multi-asset; **DEGEN** = spot SUI↔USDC on signals via DeepBook swaps, **no margin/leverage**. The guardian is a **position-risk-throttle** (trims an overextended SUI position back to USDC), not exploit clairvoyance. The **kill-move** — jailbreak → VM aborts the theft on-chain → show the failed tx hash → revoke → next move reverts — is the demo centerpiece. **Margin is excluded** because DeepBook's `MarginManager` is sender-owned (`ctx.sender()==owner`, no `store`/cap/revoke) and so **cannot be VM-caged**; it's roadmap-only and would be labeled "off-chain-policy-governed, NOT VM-caged." Full detail: `docs/wallet/SPEC.md`.

## The Crash thesis (one paragraph)

A **betting game**: bet whether **BTC** (DeepBook Predict's oracle asset — **not** the SUI token) is **UP or DOWN** at a 15-min binary expiry, wrapped by an on-chain `crash_sui::router` that **skims 3% of the quoted cost** (the rake is taken on the pre-trade quote while the user pays the post-trade mint cost, so the platform collects 3% of the *quote* — it slightly under-collects and never overcharges the user), made **gasless via the shared Enoki sponsor** (zkLogin users route through the backend; Slush/wallet users self-pay). The rake is **non-bypassable on the sponsored path** — the Enoki allowlist only permits `router::*`, so sponsored gas can never reach a raw `predict::mint`; a **self-payer** can still call `predict::mint` directly and skip the router + rake (the contract can't stop that, only the allowlist closes the gasless path). Its 7 sponsorable router targets (`create_manager`, `bet`, `cash_out`, `claim`, `withdraw`, `supply`, `redeem_lp`) live in `@suize/shared` (`PACKAGE_IDS.CRASH`). The price you pay ≈ your win probability, so a last-second "sure" bet costs ~$1 to win $1 — the edge is betting **early** + correct (bigger payout); the UI surfaces this as the potential-gain %. Migrated into `apps/crash` + `packages/move-crash`. Detail: `apps/crash/INTEGRATION.md`.

---

## Calibrated honesty (the brand — non-negotiable, both products)

Every reassurance must be **true**. Bake it into copy, UX, and pitch.

- **Never** claim AI alpha / guaranteed profit. DEGEN = *"gamble safely,"* not *"win."* The signals (contrarian sentiment + MA-distance) are honest heuristics, not alpha.
- **Yield is plumbing, not the pitch.** NAVI supply is low single-digit % and the incumbent advertises the same; our value is **autonomy + safety + the experience**.
- **The guardian is a position-risk-throttle**, not liquidation-defense (there's no leverage) and not exploit clairvoyance — instant logic-bug drains are un-frontrunnable.
- **The cage caps loss to the sandbox, never the main wallet — but not to zero** (markets move against a spot position). Say it plainly.
- **No margin in the MVP** (un-cageable). **"Coming soon" means coming soon** — fake onramp tabs are labeled, never faked.
- **Show, don't claim.** The kill-move's failed tx hash and the ~47 refusal tests are facts on-chain / in the suite — lead with those, not slides.

---

## Pointers (where the detail lives)

- Wallet product/vision/scope → `docs/wallet/SPEC.md`
- Wallet deep technical (Move modules + agent loop) → `docs/wallet/ARCHITECTURE.md`
- Wallet threat model + Sui exploit history + pre-mainnet items → `docs/wallet/SECURITY.md`
- Backend deploy (image, SOPS secrets, k8s, client contract) → `services/backend/DEPLOY.md`
- Wallet frontend structure + what's real/mock → `apps/wallet/README.md`
- Marketing brand (Droplet mascot, palette, type, voice) → `marketing/DIRECTION.md`
- Testnet → mainnet gate → `docs/MAINNET_CHECKLIST.md`
- Monorepo-merge history (how this repo was assembled) → `docs/MONOREPO_MERGE_{PLAN,NOTES}.md` *(archived — for context, not active spec)*
