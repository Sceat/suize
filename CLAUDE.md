# Suize — Monorepo (CLAUDE.md)

> Loaded every session. The one file that owns the **global picture + the payment-rail standard**. Per-piece detail lives in each piece's own `SPEC.md` — **reference, never redeclare.** Every fact is stated **once**; if it's about one piece, it lives in that piece's SPEC and this file points to it. Calibrated honesty is **LAW** — every reassurance here is literally TRUE; where a claim is roadmap, it says so.

**Suize is Stripe for AI agents.** Pitch line — say this: **"Suize lets you charge payments or subscriptions to any agent."**

Two faces of ONE thing, equal prominence:

- **CHARGE — the open rail (the Stripe half). Narrative is ACTION-FIRST: *"start accepting payments from AI agents."*** Getting PAID by agents is the PRIMARY business value: any agent that can pay USDC on Sui can pay a Suize merchant — one-off or subscription — instantly, no KYB, live in minutes. The payer needs **nothing Suize-specific**. We take **2%**, taken inline at settlement, emitted in the receipt. **SECONDARY marketplace angle:** a Suize merchant also **gets recommended to our millions of consumers** — when the PAY wallet's AI picks a service for its user (a flight, a meal, a subscription), the business it picks is the business it pays. *(the recommendation/discovery surface is ROADMAP — see PAY.)* **Integration claims are STANDARDS-ONLY** (owner decision 2026-06-10): say *"402-shaped, x402-compatible by design, built for the same standards as Stripe, Coinbase, and Google AP2"* — NEVER "on x402" (Sui is NOT on the official x402 network list), and NO platform-name claims ("works with Shopify/WooCommerce") until a real plugin ships; Shopify is gated (crypto-app program + rev-share) = roadmap only.
- **PAY — the premium consumer AI wallet (the Revolut half).** A **self-contained conversational wallet app** the human talks to: it remembers them (**MemWal** = a memory layer on Walrus), acts across many services (books flights, renews subscriptions, orders food), and pays non-custodially from a capped USDC **sub-account** (the consumer word — internally "the leash": deposit = hard cap + a confirm dial + a one-tap kill), leaving a verifiable Walrus-logged trace of everything it did. Powered by Claude — **Haiku on the free tier, Sonnet on a paid subscription** (the upsell; INTERNAL model names — consumer copy says only **"a smarter AI"**, never a model); an **"Agent-enabled" toggle** arms autonomous spend. The best way to BE a payer on the rail — but optional. *(the conversational AI + cross-service provider integrations are largely ROADMAP; the June-21 build is one narrow real flow — the on-chain rail underneath is shipped.)*

> *If it isn't CHARGE, PAY, or a clean derivative of one — it's not Suize.*

**Target: Sui Overflow 2026, Agentic Web core track. Deadline JUNE 21 2026** (owner-confirmed — never question it). Feeds a late-June pre-seed raise. The thing we WIN on is the **flagship demo**: a real agent deploys a site to Walrus *through* Deploy, having paid via Suize — dead simple, working, on **mainnet**. Not a deck.

---

## THE ONE PAYMENT RAIL (the single standard)

Every product — Wallet, Deploy, Crash, and every external merchant — is a **consumer of this one rail**. The Wallet is just the premium consumer app of it. The rail is `account.move` (spec: `packages/move-wallet/SPEC.md`).

### The four on-chain verbs (`account.move` — FULL OPEN RAIL)

| Verb | Auth | Fee | What it does |
|---|---|---|---|
| `spend(account, amount, payee, memo)` | OWNER | **FREE** | Pure P2P send (agent → anyone). The PAY primitive — no `&RailConfig`. *(shipped)* |
| `charge(account, **config: &RailConfig**, merchant, amount, memo)` | OWNER-authorized | **2% inline** | One-off merchant charge from a funded Account; rate resolved from `RailConfig`. *(shipped)* |
| `charge_subscription(account, **config: &RailConfig**, sub_id, amount, clock)` | PERMISSIONLESS, terms-gated | **2% inline** | Recurring charge; the on-chain `Subscription` terms (fixed payee + per-period cap + `Clock`) are the leash. *(shipped)* |
| `pay(merchant_account, **config: &RailConfig**, coin: Coin<USDC>, memo)` | PERMISSIONLESS | **2% inline** | One-off from ANY raw payer, **no Suize Account needed** — the open facilitator for external 402/AP2 agents. *(shipped)* |

All four emit a receipt event with the **fee VISIBLE**. The 2% rake is the rail's only revenue, taken inline **only when a merchant is paid** (verbs 2/3/4); the three CHARGE verbs now take `&RailConfig` and resolve the rate from it (per-merchant override or `default_fee_bps = 200`) → `RailConfig.fee_recipient` = Suize treasury. **Sending (verb 1) takes ZERO** — full amount to payee, no `&RailConfig`.

### The integration surface (off-chain) — Suize is the FACILITATOR (owner-validated 2026-06-10)

> **Status (calibrated honesty):** the facilitator endpoints (`POST /pay/build`, `POST /pay/submit`, `GET /verify/<paymentId>`, paymentId tracking) are **DESIGNED 2026-06-10, NOT yet built** — the deploy charge join (quote/charge/execute) is the closest existing implementation. Endpoint contracts: `services/backend/SPEC.md` §7 — reference, never redeclare.

- **The merchant snippet does exactly TWO HTTP things** — zero wallet/chain code merchant-side (this is what makes "one line, live in minutes" literally true): (a) answer HTTP **402** with a challenge `{ amount, currency: USDC, payTo, paymentId, facilitator: api.suize.io, payLink }`; (b) on a retry carrying `X-Suize-Payment: <paymentId>`, call `GET /verify/<paymentId>` on the facilitator and serve when paid.
- **Merchant on-ramps = a four-tier ladder** *(DESIGNED 2026-06-10, NOT built — contracts: `services/backend/SPEC.md` §7)*: **Tier 1 pay-links** (no code — dashboard-hosted link, machine-readable confirm page), **Tier 2 checkout sessions** (one authenticated `POST /checkout` → hosted session URL → settlement webhook), **Tier 3 the 402 middleware** (the two-call snippet above), **Tier 4 platform gateway plugins** (ROADMAP — standards-only law: no platform names in public copy until one ships). All four land on the same facilitator + rail + receipt — **the tiers only change who writes the 402.**
- **Three pay doors, one rail** (all settle through the four verbs; ground truth = the on-chain receipt event, fee visible — `/verify` is the merchant's one-call check; trust-minimized upgrade: a merchant can audit the receipt event itself via RPC):
  - **FACILITATOR door** (any agent — no gas, no Sui knowledge): `POST /pay/build { paymentId, sender }` → Suize returns a **fully-built, gas-sponsored** transaction → the agent signs the bytes **with its own key** → `POST /pay/submit` → Suize submits on-chain, awaits finality, marks the paymentId paid. The agent never constructs a Sui tx, never needs gas.
  - **POWER door** (a Sui-native agent): submits the payment itself, `paymentId` in the memo; Suize indexes the receipt for `/verify`.
  - **HUMAN door**: the 402's `payLink` → a Suize-hosted confirm page → one tap.
- **Subscriptions, same contract:** the first approval creates the on-chain `Subscription` (fixed payee + per-period cap); the relayer triggers renewals permissionlessly; `/verify` reports each period paid.
- **The MCP = the dev/power-user door** for external assistants (Claude/Codex): one-line install (`claude mcp add suize` / `npx @suize/mcp`), Google zkLogin once; tools = `suize_pay` (a 402 client: reads the challenge, enforces the user's confirm dials, signs with the **LOCAL** session, settles via the facilitator), `suize_balance`, `suize_receipts`. *(tools NOT built — `services/backend/SPEC.md` §3.)* LAW: every product surface carries a **"Use with Claude/Codex"** doc section. (CHARGE-side/dev only — never the consumer PAY path; LOCKED #6.)
- **The PAY wallet's own AI pays two ways** (custody law intact): **in-session** — the local zkLogin session signs per the confirm dial; and **autonomous-away via on-chain ALLOWANCES** — the existing `Subscription` object reused as a per-merchant allowance (payee + per-period cap enforced BY THE CHAIN, relayer-triggered, one-tap killable): autonomy with **NO key delegation**. Outside an allowance → push notification → one tap in-app. The wallet agent pays ONBOARDED merchants natively (no 402 round-trip needed) — the marketplace flywheel: merchants onboard to get paid → the agent prefers payable merchants → "get recommended." *(the allowance reuse is designed; the on-chain `Subscription` object it reuses is shipped.)*

Gasless via the Enoki sponsor; the payer's **own key signs** (the wallet/MCP's local zkLogin session, or a Sui-native agent's own wallet); the backend **never signs owner txs**. We are **402-shaped, x402-compatible by design** — there is no live x402 facilitator on Sui (never say "we run x402" / "on x402").

### Two pots, two control layers

- **Two pots** *(internal concept term — consumer copy says **"sub-account"**, see the vocabulary laws below)*: the human's own USDC (Suize never touches it) vs the **funded Account** (the agent's allowance; **balance = the hard cap**). Funding = the human deposits into the Account.
- **Two control layers:** (1) **on-chain physics** — balance = hard cap, withdraw/kill = instant, subscription terms = recurring leash; (2) **client-side policy dials** in the PAY app (or the dev-side MCP) — confirm-each / auto-under-$X / full-auto / confirm-new-subscription. **Subscriptions, once approved, renew silently.**

### Custody

**Fully non-custodial by construction** — the PAY app (or, on the dev CHARGE-side, the local MCP) runs Google/Enoki zkLogin and signs locally; keys never leave the user's machine; Suize never signs owner txs and never holds the user's key. **No `set_agent`, no delegated agent key, no on-chain agent identity.** Honest caveat: the funded balance is **delegated-spend** (v1 has no payee allow-list) — bounded by deposit + verifiable log + one-tap kill. **Delegated-spend risk, NOT custody risk.**

---

## The repo at a glance

```
apps/        wallet/      @suize/wallet    React 19 + Vite — the PAY face (fund/dials/kill/Walrus trace)  → apps/wallet/SPEC.md
             deploy/      @suize/deploy    React 19 + Vite — Deploy merchant (folds move-deploy + worker) → apps/deploy/SPEC.md
             crash/       @suize/crash     React 19 + Vite — BTC up/down (folds move-crash) TESTNET       → apps/crash/SPEC.md
             landing/     @suize/landing   React 19 + Vite — consumer home + /for-business sales site     → apps/landing/SPEC.md
packages/    shared/      @suize/shared    network + PACKAGE_IDS + wire types — SINGLE SOURCE OF TRUTH (self-documenting, no SPEC)
             move-wallet/ @suize/move-wallet  the RAIL: account.move (4 verbs + subs) → packages/move-wallet/SPEC.md
                                              LEGACY cage (mandate/vault/swap/navi) being retired; swap/navi kept as post-v1 tools
             move-deploy/ @suize/move-deploy  deploy_sui (version·site·domain_registry) — folded into apps/deploy/SPEC.md
             move-crash/  @suize/move-crash   crash_sui::router (Crash's own 3% skim) — folded into apps/crash/SPEC.md
services/    backend/     @suize/backend      ONE Bun service: mcp + deploy + sponsor + handle + relayer → services/backend/SPEC.md
             deploy-worker/ @suize/deploy-worker  CF Worker serving Walrus sites w/ on-chain manifest + 2× hash → apps/deploy/SPEC.md
```

Each piece in one line (detail lives in its SPEC — go there, don't expect it here):

- **`apps/wallet`** — the PAY face: a **self-contained conversational consumer AI wallet** (Claude Haiku free / Sonnet paid; **MemWal** = Walrus memory; books/pays across services; an **Agent-enabled** toggle). In-app zkLogin signs locally, funds the Account, holds the dials, is the kill switch, logs every agent action to **Walrus** (the Walrus-track wedge). PAY rewrite onto `account` pending; the conversational AI + provider integrations are ROADMAP.
- **`apps/deploy`** — the **FIRST merchant** (our SaaS). Agent POSTs a built site → Walrus quilt + manifest → immutable shared on-chain `Site` → served at `<base36(siteId)>.suize.site`. **Goes mainnet.** New billing model in LOCKED #10.
- **`apps/crash`** — a CHARGE+EARN merchant: live BTC up/down 15-min binary on DeepBook Predict, gasless Google-zkLogin writes, "Be the House" PLP vault. **Stays testnet** (Predict is testnet-only).
- **`apps/landing`** — REBUILT (2026-06-10): a conversation-first consumer home + a corporate `/for-business` CHARGE page, obeying the consumer-vocabulary laws. **Deployed on Walrus through our own Deploy service** (testnet — dogfood proof). The old "3 lies" are resolved (below, kept as standing laws). One known lie remains: `public/llms.txt` is a stale pre-pivot draft (see the SPEC).
- **`packages/shared`** — `NETWORK`, `fullnodeUrl()`, `PACKAGE_IDS`, native USDC type, sponsor wire types. **Network, on-chain ids, and version pins live ONLY here.**
- **`packages/move-wallet`** — owns `account.move` (the rail). The legacy cage (`mandate`/`vault`/`swap`/`navi`, 65/65 tests) describes the OLD product — do NOT read "65/65 green" as "v1 built"; `swap`/`navi` are KEPT as post-v1 staking tools.
- **`packages/move-deploy`** — `deploy_sui` (Move 2024.beta, framework-only): `version` gate, immutable shared `Site` per deploy, one global `domain_registry`.
- **`packages/move-crash`** — `crash_sui::router`: thin DeepBook-Predict wrapper that skims **Crash's own 3%** (distinct from the Suize rail 2%) to a treasury; the only Enoki-sponsored surface in Crash.
- **`services/backend`** — ONE Bun service, one port, modular route-matcher chain: `mcp` (bare JSON-RPC 2.0 Streamable-HTTP), `deploy` (Walrus upload + CF domains + on-chain `Site`, pays own gas; **HTTP, per-request signed-nonce auth** — the merchant/agent surface; **PROVEN end-to-end — it shipped our own landing**; the $0.50 charge gate is BUILT but auto-bypassed (auth-only) until `account` publishes), `sponsor` + `handle` (Enoki sponsored bytes + SuiNS, **WS-only: the wallet signs a personal-message nonce ONCE at connect**, the recovered address is the socket's identity), the **subscription relayer cron** *(unbuilt)*. **Deterministic — never an AI**; never signs owner txs.
- **`services/deploy-worker`** — CF Worker serving Walrus sites at `<base36(siteId)>.suize.site` + linked domains; resolves host→siteId, reads the on-chain `Site`, **verifies twice** (manifest blob vs on-chain `manifest_hash`; each file vs its `sha256`) — mismatch → 502, never the bytes.

---

## LOCKED DECISIONS (do not relitigate)

1. **TWO primitives: CHARGE + PAY.** Everything is a derivative of one. If it isn't one or a clean derivative — it's not Suize.
2. **FULL OPEN RAIL — four verbs** (`spend` free / `charge` / `charge_subscription` / `pay`, all in `account.move`). The 2% rake is taken inline, ONLY on a merchant pay (verbs 2/3/4), emitted in the receipt. `spend()` is free.
3. **ONE shared on-chain `Account<USDC>`** `{ balance, owner, next_sub_id }` — **no `fee_bps`/`fee_recipient` on the Account** (fee policy moved OFF it), **no agent field, no pause, no `set_agent`, no SuiNS dependency.** Fee policy lives in a **Suize-owned shared `RailConfig`** `{ default_fee_bps = 200, fee_recipient, overrides: Table<address,u16> }` mutated only via a `RailAdminCap` — this closes the merchant-zeros-their-own-fee hole (a per-Account `fee_bps` let a merchant pay Suize nothing) AND enables per-merchant discount rates. Shared ONLY because the relayer must deduct subscriptions without the owner signing. Subscriptions live as child dynamic fields keyed by `u64 sub_id` (append-only). `withdraw` returns a `Coin<T>` (composable); `spend`/`charge` transfer.
4. **FULLY NON-CUSTODIAL by construction** — the PAY app's in-app zkLogin signs locally (on the dev CHARGE-side, the local MCP); Suize never signs owner txs. Custody phrasing is **exactly** *"fully non-custodial — your keys never leave your machine"* (NEVER "never holds funds"). v1 = delegated-spend risk, not custody risk.
5. **Backend = deterministic scheduler + executor + subscription relayer. NO AI** — no agent, no chat, no inference, no alpha. The **number wall**: the deterministic core owns every on-chain amount/fee/size; an LLM may narrate but never emits a number that lands in a tx.
6. **Distribution = a SELF-CONTAINED CONSUMER AI WALLET app** (2026-06-09 OWNER PIVOT). We onboard **consumers, not developers** — "plug our MCP into your own Claude/ChatGPT" was a developer ritual; a conversational app we own is lower friction, gives us the UX + safety surface, makes a better demo, and is more on-theme for the Agentic Web track. Consumer onboarding: **open the Suize app → sign in with Google (zkLogin) → talk to your AI wallet** (it acts + pays across services; the in-app zkLogin session signs **locally**, keys never leave your machine — the non-custodial law is UNCHANGED). The **local-MCP-into-an-external-agent is DEPRECATED as the consumer distribution** — it may survive ONLY as an optional **developer / CHARGE-side** integration (an external agent paying merchants), never as how a consumer uses PAY. The remote zero-install connector stays **DEAD**. (The conversational AI itself is largely ROADMAP — see #5's number wall: an LLM narrates/chooses, the deterministic core owns every on-chain number.)
7. **Payment standard = 402-shaped + FACILITATOR (owner-validated 2026-06-10); x402 DEFERRED.** The merchant snippet does two HTTP things (answer the 402 challenge; one `GET /verify/<paymentId>` call on retry); **Suize acts as the facilitator: builds + sponsors + submits + verifies; the payer only signs.** Three pay doors (facilitator / power / human pay-link), one rail — see "The integration surface"; raw HTTP callers get a `402` carrying the pay-link. The facilitator endpoints (`/pay/build`, `/pay/submit`, `/verify`, paymentId tracking) are **DESIGNED 2026-06-10, NOT yet built** — the deploy charge join is the closest existing implementation. **402-shaped, x402-compatible by design — NEVER "on x402"** (Sui is NOT on the official x402 network list). **Integration claims are STANDARDS-ONLY** (owner 2026-06-10): *"built for the same standards as Stripe, Coinbase, and Google AP2"* — NO platform-name claims (no "works with Shopify/WooCommerce") until a real plugin ships; Shopify is gated (crypto-app program + rev-share) = roadmap only. Sui Payment Kit = lower-level infra we build on/alongside (no subs, no fee-split): *"Payment Kit verifies; Suize bills."*
8. **Spending control = client-side confirm dials** (confirm-each default, auto-under-$X, full-auto) separate from the on-chain hard cap (deposit) + kill (`withdraw`/`cancel`). **Subscriptions are exempt** — approved once, renew silently. Marketing: *"autonomy you switch on,"* not "autonomous from second one."
9. **Revenue = 2% on CHARGE** (`RailConfig.default_fee_bps = 200`, emitted in the event) **+ Deploy** (model in #10). The rate + per-merchant **override** rates live in the Suize-owned shared **`RailConfig`**, gated by the **`RailAdminCap`** (only Suize can change rates / grant a merchant a discount; a merchant can no longer zero its own fee). Crash's **3%** is Crash's own product revenue, a separate rake — never conflate.
10. **Deploy billing (NEW MODEL — owner-locked, replaces the old "$19.99/deploy + $1 trial"):** each deploy = a **direct one-off 402 charge of $0.50** (via `charge`/`pay`); the site goes live on Walrus immediately (covers the deploy + an initial storage period). The **subscription** (price placeholder **$19.99/mo — FLAG to owner, may lower**) unlocks ONLY: (a) custom domains, (b) Suize **auto-renews the Walrus storage** so the site never expires (via `charge_subscription`). One product proves **both** one-off and recurring on the same rail. **Deploy goes mainnet.** Detail: `apps/deploy/SPEC.md`.
11. **Crash stays TESTNET** (DeepBook Predict is testnet-only). The Crash→Suize 2% leg is **designed, NOT wired** in v1 (`router::bet` has no `spend`/`charge` call; a mainnet Account can't pay a testnet bet in one PTB — cross-network gap). Position Crash as **PoC of the router/rake/sponsor stack**, not a live two-rake integration.
12. **NETWORK split — rails + Wallet + Deploy go MAINNET; Crash stays TESTNET on a network-pinned path** so the mainnet flip never drags it along. Mainnet native USDC = `0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC` (a Circle RegulatedCoin — orthogonal to non-custodial, note in copy, not a blocker). Enoki paid tier, SUI in the sponsor, **WAL** in the deploy wallet (Walrus writes are WAL-denominated, not USDC). `account.move` is UNPUBLISHED (`PACKAGE_IDS.ACCOUNT = 0x0`) — publishing to mainnet is the v1 gate. `deploy_sui` is **already published on testnet** (`0xadcc8d…`) — its mainnet flip is a republish.
13. **Bun workspaces, one toolchain.** Root globs `apps/* packages/* services/*`; `bun install` at root; dev/build fan out via `--filter '*'`. No pnpm, no turbo.
14. **ONE unified backend, TWO transports, ONE auth primitive** (corrected 2026-06-10 — the old "WS is dropped" claim was FALSE and dangerous). The **WS is alive and load-bearing**: it is the wallet's SOLE transport for `sponsor` + `handle` (sign-once-at-connect personal-message nonce; `ws.data.address` is the session identity). The **deploy surface is HTTP** by necessity (agents/merchants speak 402-shaped HTTP; per-request signed-nonce auth). Both transports verify signatures through the same primitive — no second source of truth. Reads go direct-to-chain; nothing wallet-push beyond sponsor/handle/balance frames. The backend never signs owner txs. The CF deploy-worker is a separate edge runtime, not "the backend."
15. **`@suize/*` package naming. Network, on-chain ids, version pins live ONLY in `@suize/shared`** — no app or service hardcodes a package id, target, or network.
16. **Per-piece SPEC; this file owns the global picture + the rail standard. Each SPEC owns only its own piece and points up here. State each fact ONCE; reference, never redeclare.**
17. **No `git add`/`commit`/`push` without the owner's explicit approval.** (Standing rule.)

### The moat (honest, post-research — sell THIS, not standards/gasless)

Standards are commodity (AP2, x402, Sui Payment Kit are megacorp-owned) and gasless is table stakes (Sui native $0 stablecoin transfers, May 2026) — **do NOT sell either as the moat.** The moat is **execution + on-chain ENFORCEMENT:** the leash is **physics not policy** (deposit = hard cap, kill = an on-chain state change), the 2% is **emitted in the receipt** (monetization as trust), the **Walrus action-log is verifiable + user-owned**, and we can close AP2 issue **#118** (mandate-verification, genuinely OPEN as of June 2026) on-chain. **Caveat that MUST travel with every #118 mention:** AP2 mandates are W3C Verifiable Credentials (ECDSA P-256), NOT zkLogin JWTs — "reuse zkLogin JWT verification" is **proof-of-capability / a proposed reference implementation, NOT a drop-in. Roadmap, not shipped.**

### vs the field (counter on the delta we own — never on "free", never on false lock-in)

- **vs Beep** (only Sui rival, Sui-endorsed): MIT-open + free but ships an ugly site and charges $10 for an "agent" that does unclear nothing — **no real working product.** Win on **EXECUTION** (the real agent→Deploy→Walrus mainnet demo). **Do NOT attack on lock-in — Beep is MIT-open.**
- **vs Tempo MPP / Coinbase Agentic Wallets / cards:** counter on **fully-non-custodial + verifiable on-chain trace + one-tap on-chain revoke.** We sell the delta; we do not beat "free."

---

## Conventions

- **JS/TS:** ESM everywhere (`"type": "module"`). Bun = runtime + workspace manager; apps build with Vite, the backend runs on Bun, the deploy-worker runs on CF Workers (wrangler).
- **Move:** `edition = "2024"` (`2024.beta` in move-deploy); a shared `Version` upgrade gate per package; owner-**address** auth (zkLogin gives a stable address — nothing to phish).
- **Abort codes are a PUBLIC CONTRACT — never renumber**, scoped per module. `account.move`: `0=ENotOwner`, `3=EInsufficientBalance`, `4=ETooEarly`, `5=EOverPeriodCap`, `6=ESubscriptionNotFound`, `7=EInvalidRate` (admin set a fee rate > 10_000 bps); codes `1/2` remain retired/unused (free for future). Admin fns need NO abort code — `&RailAdminCap` possession IS the auth.
- **Secrets are env-only (SOPS in k8s), never committed, never in a frontend bundle.** Sponsor Enoki key ≠ SuiNS-issuing key (separate secrets). The Google `client_id` is **load-bearing forever** (zkLogin `aud`) — pin one, never rotate.
- **Docs = this CLAUDE.md + ONE SPEC.md per piece. No other markdown** — fold the still-true facts into the owning SPEC and delete the stray (owner law, 2026-06-10). Exceptions: the root `README.md` (a thin pointer to here, nothing more), vendored `deps/**` docs (not ours), and `marketing/` (owner strategy docs, not product docs).
- **`llms.txt` LAW:** one per product, **final-production framing** — no internals, no testnet, no status talk; the landing's is a short navigation version.

### Consumer vocabulary (LAW — any user-facing copy, every surface)

- The agent's funded balance is a **"sub-account"** in ALL consumer copy — NEVER "leash"/"pot" user-facing. (Internal/spec prose may keep "leash"/"two pots" as concept terms, but must note the consumer word.)
- **NO tech jargon user-facing.** MemWal, Haiku/Sonnet, zkLogin, MCP, Walrus are INTERNAL names. Consumer copy says: *"it remembers you"* (MemWal), *"a smarter AI"* (the paid model tier), *"sign in with Google"* (zkLogin).
- **NO pricing outside the Pricing page.** (A fee rendered inside an illustrative receipt artifact is trust proof, not pricing — even then the gross is a neutral sample, never a pricing tier.)
- The landing is a **mainnet-ready SALES landing**: NO testnet labels AND no false "live on mainnet" claims — on-page figures read as illustrative product mockups; "Built on Sui" (true) is fine.

### The 3 lies (ALL RESOLVED — kept as standing laws, never reintroduce)

- **L1 — `apps/landing` consumer story: RESOLVED by the conversation-first rebuild (2026-06-10).** The dead remote-connector / `connect.suize.io` AND the old "Install the Suize MCP → your agent pays" consumer copy are gone. Consumer onboarding is the self-contained app: *"Open the Suize app → sign in with Google → talk to your AI wallet; keys never leave your machine."* (Residual: `public/llms.txt` still carries the pre-pivot story — see `apps/landing/SPEC.md`.)
- **L2 — never claim "LIVE on mainnet" while `account.move` is unpublished** (`ACCOUNT = 0x0`). RESOLVED as written (owner 2026-06-09, encoded in the rebuild): mainnet-ready SALES landing — testnet labels REMOVED, on-page figures read as illustrative product mockups; keep "Built on Sui" (true), NO false "live"/mainnet claim until publish. Stays a law.
- **L3 — domain mismatch: RESOLVED (verified 2026-06-10).** Worker, backend (`deployBaseDomain`), shared, and dashboard all standardize on **`suize.site`**. Residue cleaned the same day: `AgentsView.tsx` snippet fallback now `api.suize.io`; worker README rewritten off the old zone.

---

## Build status (as of 2026-06-10)

| Piece | Status |
|---|---|
| `packages/move-wallet` `account.move` (the rail) | **Shipped + 28 account unit tests pass (98 package-wide).** All four verbs: `spend` (free) · `charge` · `charge_subscription` · `pay` · `deposit`/`withdraw` · `create`/`cancel_subscription` + accessors + the abort contract (now incl. `7=EInvalidRate`). Fee policy is the **shared `RailConfig`** (`default_fee_bps=200` + per-merchant `overrides` table) + a **`RailAdminCap`** (per-merchant rake / discounts; cap-gated setters); the three CHARGE verbs take `&RailConfig`. **UNPUBLISHED** — `PACKAGE_IDS.ACCOUNT = 0x0`; `RAIL_CONFIG` id captured at publish; **mainnet publish is the v1 gate.** |
| `packages/move-wallet` legacy cage | 65/65 tests green — but they prove the **OLD** mandate/vault/swap/navi product, **NOT v1.** swap/navi kept as post-v1 tools. |
| `packages/move-deploy` (`deploy_sui`) | `sui move build` green, 10 tests pass. **Published on testnet** (`0xadcc8d…`); mainnet = republish. |
| `services/deploy-worker` | Built (tsc clean) + **serving in production**: the rebuilt landing is served through it, double-hash verified, at `*.suize.site`. |
| `apps/deploy` | Building (Vite). Merchant UI; the deploy pipeline itself is **proven end-to-end** (it shipped the landing); the $0.50-one-off + sub billing UI still to wire (the backend charge gate is built, bypassed until publish). |
| `apps/wallet` | Real on testnet against the **legacy** package; the **PAY rewrite onto `account`** + Walrus action-log pending. |
| `apps/crash` / `packages/move-crash` | Building; `router` live on testnet (`PACKAGE_IDS.CRASH`). Stays testnet; the Crash→Suize 2% leg is designed, not wired. |
| `apps/landing` | **REBUILT + DEPLOYED VIA OUR OWN DEPLOY** (dogfood, testnet): conversation-first consumer home + `/for-business`. Site `0xc96dd1621f41ccc957887925ea98756dc617543deb3e6fa9d00d1839e47b9d0c` → `https://50qfse0t2krlxbu9zvbx0xfz8m9ccssa0g7dt8lrx4oopads0c.suize.site` (30 epochs ≈ 1 month Walrus storage; charge gate bypassed = auth-only deploy). og.png 1200×630 + full meta shipped. Vercel (`scripts/deploy.sh`) is the LEGACY path. No waitlist anywhere. Remaining lie: `public/llms.txt` is a stale pre-pivot draft — rewrite pending. |
| `services/backend` | `mcp` Step-1 bare transport BUILT + curl-proven (no auth/payment/Sui/session yet). `deploy` BUILT + **PROVEN end-to-end** (2026-06-10 — shipped our own landing: auth nonce → tar → Walrus quilt + manifest → on-chain `create_site` → hash-verified serving); its $0.50 charge gate (quote/charge/execute + digest verification) is BUILT but **auto-bypassed (auth-only)** until `account` publishes. `sponsor` + `handle` LIVE over the WS (LOCKED #14). Subscription relayer unbuilt. Facilitator endpoints (`/pay/build` · `/pay/submit` · `/verify/<paymentId>`) **DESIGNED 2026-06-10, unbuilt** — `services/backend/SPEC.md` §7. |
| `packages/shared` | Done for legacy + Crash + Deploy (testnet ids; served-site URLs standardized on `suize.site` — L3 fixed). Mainnet ids + native USDC pending. |

---

## Pointers (where the detail lives — reference, never redeclare)

- **The on-chain rail contract → `packages/move-wallet/SPEC.md`** (the 4 verbs, the Account struct, subscriptions, abort codes).
- Off-chain rail surface (facilitator / mcp / deploy / sponsor / handle / relayer / 402) → `services/backend/SPEC.md`
- The consumer Wallet (PAY face, dials, Walrus trace) → `apps/wallet/SPEC.md`
- Deploy merchant (new billing model; folds `move-deploy` + `deploy-worker`) → `apps/deploy/SPEC.md`
- Crash merchant (folds `move-crash`; the 3% rake) → `apps/crash/SPEC.md`
- Landing (IA, copy laws, design laws, deploy state) → `apps/landing/SPEC.md`
- `packages/shared` is self-documenting (types/consts) — no SPEC.

> The old `docs/` folder is DELETED (verified 2026-06-10). Read the SPECs, not history.
