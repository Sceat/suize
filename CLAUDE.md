# Suize — Monorepo (CLAUDE.md)

> Loaded every session. Owns the **global picture + the one payment-rail standard**. Per-piece detail lives in each piece's `SPEC.md` — **reference, never redeclare; state each fact once.** Calibrated honesty is law: every reassurance here is true today; roadmap is marked ROADMAP.

**Suize = Stripe for AI agents:** charge payments or subscriptions to any agent. Two faces of one rail:

- **CHARGE** — the open rail. Any agent that can pay USDC on Sui pays a Suize merchant (one-off or subscription), no KYB, live in minutes. The payer needs nothing Suize-specific.
- **PAY** — a self-contained conversational consumer AI wallet: it remembers the user, acts across services, and pays non-custodially from a capped sub-account. The best way to *be* a payer on the rail, but optional.

If it isn't CHARGE, PAY, or a clean derivative — it's not Suize.

**Target:** Sui Overflow 2026, Agentic Web track, deadline **June 21 2026** (owner-confirmed). Flagship demo: a real agent deploys a site to Walrus *through* Deploy, having paid via Suize — working, testnet-proven, mainnet-ready.

---

## The one payment rail

Every product (Wallet, Deploy, Crash, external merchants) consumes this one rail.

**One-off = x402.** Vanilla **x402 V2 'exact'** over Sui's protocol-level **gasless** Address-Balance transfers. **No custom Move verbs:** the payer signs a `send_funds` PTB with its own key (`gasPayment=[]`, `gasPrice=0`), and the Suize facilitator settles it **keyless** over gRPC. *"Your address is your account"* — no on-chain Account, no fee object.

- **Fee = 2% (min $0.01), merchant-absorbed,** carved as a second declared output (`extra.outputs`) in the SAME atomic tx, **enforced by the facilitator at verify** (it recomputes the split; payer-declared outputs are ignored). The on-chain balance-change set IS the receipt. **Never waived** — every payment carries it; the `SUIZE_MERCHANTS` registry only customizes the rate. The payer always pays exactly the listed price. The fee lands at the treasury resolved live from the `treasury@suize` SuiNS name (never hardcoded).
- **Idempotency** rides the x402 `payment-identifier` extension — never an ad-hoc field; a retry is never a double charge.
- **Facilitator (`api.suize.io`, `facilitator.suize.io` alias) is STATELESS** — the chain is the database. Endpoints: `/verify` `/settle` `/supported` `/build` `/terms` `/tx`. No payment stores, no server-minted ids.
- **Three agent-paid doors, one wire** — the agent self-signs `X-PAYMENT`; there is **no human / pay-link / checkout path** (deleted): (1) **Sui-aware** — own Sui key + USDC; (2) **Suize** — its zkLogin session via `@suize/mcp` (`suize_pay`); (3) **hosted charge door** `api.suize.io/charge/<token>` — a stateless Suize-signed token `{merchant, price, webhook, payTo}`; GET mints the 402, POST settles on the same rail and fires a *signed order* to the merchant's own https webhook (a delivery callback, not a settlement webhook).
- **Merchant integration = `@suize/pay`** (~60 lines): answer the 402, verify the retry against the merchant's OWN terms, serve. The merchant is the verifier; Suize is plumbing. (Platform gateway plugins are ROADMAP — no platform-name claims until one ships.)

**Recurring = `subs::subscription`** (standalone Party-object Move module — the ONLY Suize Move code in the payment path). The user creates a soulbound `Subscription<T>` ONCE (fixed merchant + amount + period), paying period one inline. **Every renewal is user-signed and PUSHES exactly one period** — nothing reaches into the user's funds (the object holds no balance; the caller pushes one period's coin, the module asserts `value == amount`, carves 2%/$0.01 to treasury, sends the rest to the merchant). **Cancel = delete the object on-chain.** Merchants self-index from chain events. The off-chain relayer only sponsors gas (never holds a key); the chain is the double-charge guard (`ETooEarly`).

**Spending control = funding physics + client dials.** The agent's funded address balance IS the hard cap (kill = stop funding + sweep); a detached agent = a second Google sign-in's address. Client-side dials: confirm-each (default), auto-under-$X, full-auto, confirm-new-subscription. Subscriptions, once approved, renew silently. Marketing framing: *"autonomy you switch on."*

**Custody: fully non-custodial by construction** — the PAY app (or, dev-side, the local MCP) runs Google/Enoki zkLogin and signs locally; keys never leave the user's machine; Suize never signs owner txs. v1 is **delegated-spend risk, not custody risk** (no payee allow-list yet — bounded by what you fund + a verifiable log + stop-and-sweep). Custody phrasing is exactly *"fully non-custodial — your keys never leave your machine"* (never "never holds funds").

---

## Repo map

```
apps/        wallet/        @suize/wallet       React 19 + Vite — the PAY face (fund/dials/kill/trace)        → apps/wallet/SPEC.md
             deploy/        @suize/deploy       React 19 + Vite — Deploy merchant (folds move-deploy + worker) → apps/deploy/SPEC.md
             crash/         @suize/crash        React 19 + Vite — BTC up/down, TESTNET (folds move-crash)      → apps/crash/SPEC.md
             landing/       @suize/landing      React 19 + Vite — consumer home + /for-business               → apps/landing/SPEC.md
             agents/        @suize/agents-app   React 19 + Vite — agents.suize.io: live x402 feed + ad auction → apps/agents/SPEC.md
packages/    shared/        @suize/shared       network + PACKAGE_IDS + wire types — SINGLE SOURCE OF TRUTH (self-documenting)
             x402/          @suize/x402         the x402 V2 'exact' Sui scheme: wire types + build/verify (self-documenting)
             pay/           @suize/pay          the ~60-line merchant middleware (x402 challenge + verify)     → services/backend/SPEC.md
             mcp/           @suize/mcp          the dev/power-user door: 6 generic tools, npm-ready            → services/backend/SPEC.md
             move-subs/     @suize/move-subs    subs::subscription — standalone Party-object subscription      → packages/move-subs/SPEC.md
             move-deploy/   @suize/move-deploy  deploy_sui (version · site · domain_registry)                 → apps/deploy/SPEC.md
             move-crash/    @suize/move-crash   crash_sui::router — Crash's own 3% skim                        → apps/crash/SPEC.md
             move-auction/  @suize/move-auction auction::auction — the directory's on-chain ad-slot auction    → packages/move-auction/SPEC.md
             move-profile/  @suize/move-profile profile::profile — on-chain BusinessProfile, $0.10 create/edit (self-documenting)
             move-wallet/   @suize/move-wallet  RETIRED-IN-PLACE archive: account.move (old rail) + legacy cage — NOT in any live path
services/    backend/       @suize/backend      ONE Bun service: facilitator + mcp + deploy + sponsor + handle + relayer + directory → services/backend/SPEC.md
             deploy-worker/ @suize/deploy-worker CF Worker serving Walrus sites w/ on-chain manifest + 2× hash → apps/deploy/SPEC.md
```

Network split: **Wallet + Deploy go mainnet; Crash stays testnet** (DeepBook Predict is testnet-only) on a network-pinned path so the mainnet flip never drags it along.

---

## Locked decisions (do not relitigate)

1. **Two primitives: CHARGE + PAY.** Everything is a derivative of one.
2. **Rail = x402, no custom verbs** (see above). The fee is never waived. `account.move` is RETIRED.
3. **No Account object, no RailConfig.** *"Your address is your account"* is literal — no on-chain Account, fee object, or agent field. The cap = what you fund the agent address with; kill = stop funding + sweep. Subscriptions are the standalone Party-object module (user-signed push, cancel = delete, merchants self-index). The fee split lives in the declared outputs, not an on-chain config.
4. **Fully non-custodial** (see above). v1 = delegated-spend risk, not custody risk.
5. **Backend = deterministic core + a FENCED inference module (the wallet "brain").** The brain runs **Claude (Haiku only)** to power the PAY conversation but is walled off from money: it returns ONLY narration + *proposed* tool calls, never imports the signer/settle/sponsor/relayer path, and emits no on-chain amount/address/signature/digest (CI-fenced on the response shape). **The NUMBER WALL is load-bearing:** every on-chain amount/fee/size originates from the user's explicit input (re-shown on the confirm card), a merchant's OWN 402 terms, or a `@suize/shared` constant — **never from an LLM tool argument**. The wallet client is the SOLE signer (local zkLogin). The brain rides the authenticated WS (identity = `ws.data.address`) with a strict per-user daily token cap. The relayer + sponsor + facilitator stay fully deterministic — no LLM ever touches settlement.
6. **Distribution = a self-contained consumer AI wallet app.** Onboarding: open the app → sign in with Google (zkLogin, signs locally) → talk to your AI wallet. The local-MCP-into-an-external-agent survives ONLY as an optional dev/CHARGE-side integration, never as the consumer path. The remote zero-install connector is dead.
7. **Payment standard = x402 V2 'exact' for Sui + a stateless facilitator.** The `@x402/sui` mechanism + the gasless spec amendment are submitted upstream as **OPEN PRs** on `x402-foundation/x402` (#2615 spec + #2616 mechanism) — open, not merged. Copy is governed by the **claim ladder** (below). Sui Payment Kit is lower-level infra we build alongside (no subs, no fee-split): *"Payment Kit verifies; Suize bills."*
8. **Spending control = funding physics + client dials** (see above). Subscriptions are exempt — approved once, they renew silently.
9. **Revenue = 2% (min $0.01) on CHARGE + Deploy** — merchant-absorbed, facilitator-enforced, lands at the treasury. A merchant cannot zero it. Crash's **3%** is Crash's own product rake — never conflate.
10. **Deploy billing:** each deploy = a direct one-off x402 charge of **$0.50** (site live on Walrus immediately). The subscription (**$19.99/mo placeholder — may lower**) unlocks ONLY (a) custom domains and (b) auto-renewed Walrus storage (via `subs`). One product proves both one-off and recurring on the same rail. Deploy goes mainnet. → `apps/deploy/SPEC.md`.
11. **Crash stays testnet.** The Crash→Suize 2% leg is designed, NOT wired (a mainnet payer can't settle a testnet bet in one PTB). Position Crash as a PoC of the router/rake/sponsor stack.
12. **Mainnet is UNGATED for payments** — the treasury, mainnet native USDC, and gasless transfers all exist with zero publishes (there is no payment Move package). The only mainnet publishes are the `subs` module and a `deploy_sui` republish. **The mainnet flip is DEFERRED past the June 21 submission** (owner 2026-06-18): the demo is testnet-proven, mainnet-ready; the flip is a post-submission republish, not a v1 gate. Mainnet native USDC = `0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC` (a Circle RegulatedCoin — note in copy, not a blocker).
13. **Bun workspaces, one toolchain.** Root globs `apps/* packages/* services/*`; `bun install` at root; dev/build fan out via `--filter '*'`. No pnpm, no turbo.
14. **One backend, two transports, one auth primitive.** The **WS** is the wallet's sole transport for `sponsor` + `handle` (sign-once personal-message nonce at connect; `ws.data.address` is the session identity). The **HTTP** surface carries deploy/402 (per-request signed-nonce auth). Both verify through the same primitive. Reads go direct-to-chain. The backend never signs owner txs. The CF deploy-worker is a separate edge runtime, not "the backend."
15. **`@suize/*` naming. Network, on-chain ids, and version pins live ONLY in `@suize/shared`** — nothing else hardcodes an id, target, or network.
16. **Per-piece SPEC; this file owns the global picture + the rail standard.** State each fact once; reference, never redeclare.
17. **No `git add` / `commit` / `push` without explicit owner approval.**

---

## Conventions

- **JS/TS:** ESM everywhere (`"type": "module"`). Bun = runtime + workspace manager; apps build with Vite, the backend runs on Bun, the deploy-worker runs on CF Workers.
- **Move:** `edition = "2024"` (`2024.beta` in move-deploy); a `Version` upgrade gate per package; owner-**address** auth (zkLogin gives a stable address). **Abort codes are a public contract — never renumber**, scoped per module. `subs`: `0 ETooEarly · 1 EWrongAmount · 2 EBadTerms · 3 EInvalidRate`. `auction`: `0 EBidTooLow · 1 EWrongCoin · 2 EInvalidRate · 3 EBadSlot · 4 ECoinUnpinned · 5 EBadCreative · 6 ENotHolder · 7 EUpdateTooSoon`. Admin fns need no abort code — cap possession IS the auth.
- **Secrets are env-only, never committed, never in a frontend bundle.** Separate key per module (sponsor Enoki ≠ SuiNS issuer ≠ deploy wallet — never reuse). The Google `client_id` is load-bearing forever (zkLogin `aud`) — pin one, never rotate. Var names live in `services/backend/.env.example`; the only values safe to commit are publishable `VITE_` frontend keys (Enoki public key, OAuth client ids, public addresses).
- **Docs = this file + ONE `SPEC.md` per piece.** No other markdown except the root `README.md` (the public front door), vendored `deps/**`, and `marketing/` (owner strategy). Fold stray facts into the owning SPEC.
- **`llms.txt`:** one per product, final-production framing (no internals, no testnet, no status talk); the landing's is a short navigation version.

### Copy laws (every user-facing surface)

- The agent's funded balance is a **"sub-account"** in consumer copy — never "leash"/"pot" (those stay internal concept terms).
- **No tech jargon user-facing:** MemWal → *"it remembers you"*; the model → *"a smarter AI"* (Haiku is internal; no paid tier); zkLogin → *"sign in with Google"*; MCP/Walrus stay internal.
- **No pricing outside the Pricing page** (an illustrative receipt fee is trust proof, not a tier).
- The landing is **mainnet-ready sales copy:** no testnet labels AND no false "live on mainnet"; "Built on Sui" (true) is fine; on-page figures read as illustrative mockups.
- **Claim ladder (binding).** ALLOWED now: *"gasless"*, *"x402-compatible by design"*, *"implements the merged x402 Sui exact scheme"*, *"we run a live x402 facilitator for Sui"*, *"opened the spec + mechanism PRs upstream (#2615 + #2616)"*. FORBIDDEN until the mechanism PR **merges**: *"on x402"*, *"official/default Sui facilitator"*, *"listed by x402"*, *"merged upstream"* (as fact, not ambition). **Zero status-talk on any public surface** — no "coming soon / soon / roadmap / not yet / pending"; a feature is described as it works today or it is absent.

---

## Status & pointers

Live on-chain ids, network, and version pins live ONLY in `@suize/shared`; per-piece build status lives in each SPEC. In short: the **x402 rail** (`packages/x402` + the backend facilitator) and the **`subs` / `auction` / `deploy_sui`** Move modules are **built and testnet-proven**; mainnet is a deferred republish (#12). The wallet conversational brain is built (answers "not configured" until the backend has `ANTHROPIC_API_KEY`); cross-service provider integrations and the Walrus action-log are ROADMAP.

- x402 wire scheme → `packages/x402` (self-documenting)
- subscription module → `packages/move-subs/SPEC.md`
- ad-slot auction → `packages/move-auction/SPEC.md`
- agent-commerce directory (`agents.suize.io`) → `apps/agents/SPEC.md`
- off-chain rail (facilitator / mcp / deploy / sponsor / handle / relayer / directory) → `services/backend/SPEC.md`
- consumer Wallet (PAY) → `apps/wallet/SPEC.md`
- Deploy merchant → `apps/deploy/SPEC.md`
- Crash merchant → `apps/crash/SPEC.md`
- Landing → `apps/landing/SPEC.md`
- `packages/shared` is self-documenting (no SPEC)
