# services/backend — SPEC (the off-chain rail surface)

> Scope: this file owns ONLY the off-chain rail — the one Bun service and its
> modules. The global picture (the two primitives, the x402 V2 rail, custody,
> network) lives in the root `CLAUDE.md`; the subscription contract lives in
> `packages/move-subs/SPEC.md`. This file references those, never redeclares them.
> Each fact is stated once. **`account.move` / `RailConfig` / the old pull-relayer /
> `suize-402/1` / `X-Suize-Payment` / `/pay/build` / `/pay/submit` are DELETED** —
> the live rail is vanilla **x402 V2 'exact' over Sui's protocol-level gasless
> Address-Balance transfers** (the payer signs a `send_funds` PTB with its OWN key,
> `gasPayment=[]`, `gasPrice=0` — no gas token, ever).

The backend is **deterministic code, not an AI** — a facilitator + an executor + a
storage extender. It **NEVER signs an owner transaction**: every payment is a gasless
tx the **payer signs locally with its own key**; the facilitator only verifies and
broadcasts (keyless). The backend's only keys are the **Enoki sponsor** (pays gas for
the few sponsored surfaces — Crash bets, the wallet's subscription Party-object
writes) and its service wallets (deploy / handle issuer) — see "The number wall,"
below. **The facilitator settles KEYLESS — it holds no signing key for a payment.**

One Bun service, one port, one image, one deploy. Every module is a route matcher
`(req, url, origin, server) => Promise<Response> | null`; the first non-null wins
(`src/index.ts`). All config is env-only via `src/config.ts` (mirrored by
`.env.example`); secrets are env vars, never hardcoded, never bundled.

---

## 0. Status at a glance (BUILT vs STUB — honest)

| Module | Status |
|---|---|
| **mcp** (`src/mcp`) | **BUILT, bare.** `POST /mcp`, hand-rolled JSON-RPC 2.0 Streamable-HTTP. One no-auth tool `suize_ping`. NO auth, NO payment, NO Sui, NO session. The real wallet tools (`suize_pay` / `suize_balance` / `suize_receipts` / …) live in the local `@suize/mcp` stdio package, not in this bare backend route. |
| **deploy** (`src/deploy`) | **BUILT + PROVEN end-to-end** (2026-06-10 — it shipped our own landing to Walrus testnet: auth nonce → tar → quilt + manifest → on-chain `Site` → hash-verified serving). `deploy_sui` is published on testnet (real ids in `@suize/shared`). Custom-domain link/unlink built. The **$0.50 x402 charge gate** (`src/deploy/payment.ts` — a first-party single-output x402 'exact' settlement verified + settled in-process, single-use digest reservation) is BUILT; it **arms the moment the Deploy treasury (`treasury@suize`) resolves** (no more `account` flags — `chargeGateReady()` = treasury resolves). Pays its own gas for the Site mint — NOT Enoki-sponsored. |
| **facilitator** (§7) | **BUILT + PROVEN — x402 V2 'exact', KEYLESS, E2E on REAL testnet.** `POST /verify` · `POST /settle` · `GET /supported` · `POST /build` · `GET /terms` · `GET /tx` · `POST /checkout` live in `src/facilitator/` (`x402.ts` the verify/settle/build core, `fees.ts` the SuiNS-resolved treasury + the `extra.outputs` 2%/1¢ split, `index.ts` the HTTP layer). The **`@suize/pay` middleware shipped** (`packages/pay` — answers the x402 V2 `PaymentRequired` challenge; zero runtime deps, fetch-style + Express adapters), built on **`@suize/x402`** (the gasless `send_funds` builder + `assertOutputsExact` + `recoverPayer` + the gasless-shape guard). KEYLESS + STATELESS — the chain is the database; the payer signs the gasless tx with its OWN key, the facilitator only verifies (simulate) + broadcasts (gRPC, idempotent by digest). The hosted pay page is **BUILT + LIVE at `pay.suize.io`** (`apps/pay`, base `/`; identity via the wallet-hosted SSO bridge (§7.4); old `wallet.suize.io/pay` links 307-redirect there; base URL env-tunable via `PAY_PAGE_URL`, default `https://pay.suize.io`). (The Tier-0 "instant merchant" screen lives in the wallet's business console — handoff note at the end of `apps/wallet/SPEC.md`.) |
| **sponsor** (`src/sponsor`) | **BUILT.** `createSponsor` / `executeSponsor` (+ `sponsorKindBytes`) over Enoki, with the move-call allow-list + gas-drain ceilings. **Allow-list (`src/sponsor/index.ts`):** `[...CRASH_MOVE_TARGETS, ...WALLET_MOVE_TARGETS, ...(SUBS_PUBLISHED ? SUBS_MOVE_TARGETS : [])]` — Crash `router::*`, the legacy wallet package, and the standalone `subs::subscription` create/renew/cancel (plus the gasless `redeem_funds`/`into_balance` helpers the subscription Balance push needs). **`account.move` is DEAD — its targets are NOT in the allow-list.** Sponsors the few non-gasless surfaces only (a vanilla x402 `send_funds` needs no sponsor). |
| **handle** (`src/handle`) | **BUILT.** Fully on-chain SuiNS leaf-subname issuance (`<name>@suize`). Optional — 503 when SuiNS env unset. *Not load-bearing for the rail; the rail has no SuiNS dependency for payments (the treasury fee-recipient IS resolved from a SuiNS name — §7.5).* |
| **storage extender** (§5, `src/deploy/extend.ts`) | **BUILT, env-gated, wired at boot.** Replaces the deleted pull-relayer. It does NOT charge (the push-not-pull `subs` module already did) — its ONLY job is to keep a PAID Deploy site's Walrus storage extended in place: an **on-settle hook** (`notifySettled`, fired from the sponsor execute path) + a **6h safety cron** (`startStorageCron`), each extending the site's two blobs (`system::extend_blob`, ≤50-epoch clamp), with an F5 owner-binding so a crafted `ref` can't drain the service WAL. See §5. |
| **agent** (`src/agent`) | **STUB.** No-op. Reminder: the real backend is the facilitator + executor + storage extender, NOT an AI agent. Do not wire an inference loop here. |
| **transport** (`src/ws`) | **BUILT, LIVE + load-bearing.** Sponsor + handle run over the one Enoki-verified WebSocket (auth ONCE at connect via a signed personal-message nonce; `ws.data.address` is the session identity). The old "HTTP-only, delete `src/ws`" plan was **repudiated** — root `CLAUDE.md` LOCKED #14 (corrected 2026-06-10): two transports, one auth primitive (§6). |
| **readiness** | **BUILT.** `/health`, `/ready`, `/ready/{sponsor,handle,deploy,ws,serve}` — per-component, an unconfigured/down dep never 503s an unrelated surface. |

---

## 1. The rail, off-chain (x402 V2 'exact' — how a payment is reached)

The rail is **vanilla x402 V2 'exact' over Sui's protocol-level gasless Address-Balance
transfers** (the global picture is in root `CLAUDE.md`). A payment is a single tx the
**payer signs with its OWN key** — a `send_funds` PTB with `gasPayment=[]` and
`gasPrice=0` (no gas token), whose declared outputs ARE the settlement (and, for an
onboarded merchant, the 2%/1¢ fee split). The facilitator (§7) verifies that
signed-but-not-executed tx pays the EXACT declared outputs (simulate), then settles by
broadcasting it (gRPC) — **keyless**: no Enoki, no sponsor, no owner-tx signing. The
fee is **merchant-absorbed** and lives in `extra.outputs` (a second declared output to
the treasury) — the payer always pays exactly the listed price; a vanilla single-output
payment (merchant not in the registry) is the **free tier**. The doors, one rail:

1. **The consumer PAY wallet app** (the PRIMARY payer surface, root `CLAUDE.md` LOCKED
   #6) — pays from the user's own balance, custody law intact: the in-app zkLogin session
   **signs the gasless payment locally** per the confirm dial. Recurring spend rides the
   standalone **`subs::subscription`** module (push-not-pull: the user signs each
   renewal; the wallet renews silently when open — `apps/wallet/SPEC.md`).
2. **The local MCP** *(the developer / power-user door — CHARGE-side ONLY, DEPRECATED as
   the consumer path)* — an external assistant's (Claude/Codex) Suize MCP runs the local
   x402-client flow via its `suize_pay` tool (read the challenge → build the gasless
   payment → sign locally → settle via the facilitator) (§3, §7).
3. **The facilitator HTTP doors** (§7 — BUILT + E2E-proven) — any external agent: the
   **FACILITATOR door** (`POST /build` returns the unsigned gasless bytes → the agent
   signs with its own key → `POST /settle`), the **POWER door** (a Sui-native agent
   builds its own `send_funds` PTB, signs, and hands the b64 `PaymentPayload` in the
   **`X-PAYMENT`** header on retry), the **HUMAN door** (the 402's `payLink` → the hosted
   pay page → one tap).
4. **`llms.txt`** — a static discovery door (content LAW in root `CLAUDE.md`). The
   rail contract is LIVE at `suize.io/llms.txt` — the hub every per-product llms.txt
   links back to (deploy/crash/wallet ship their own).

A **merchant** integrates by dropping the `@suize/pay` middleware (§7.4): answer HTTP
**402** with the x402 V2 `PaymentRequired` challenge, then verify the retry's `X-PAYMENT`
payload through the facilitator's `POST /verify` + `POST /settle` — zero wallet/chain
code merchant-side, no KYB, live in minutes. **The facilitator is STATELESS + KEYLESS —
the chain is the database; the payer signs, Suize verifies + broadcasts.** Protocol = the
**x402 V2 Sui 'exact' scheme** (§7); the claim ladder (root `CLAUDE.md`) governs the
public wording — never "on x402" until the upstream mechanism PR MERGES.

---

## 2. sponsor — Enoki sponsored transactions (BUILT, core)

`src/sponsor/index.ts`. The transport-agnostic core: `createSponsor(input)` →
`{ bytes, digest }`, `executeSponsor({ digest, signature })` → `{ digest }`. The user
signs `bytes` with their **local** zkLogin session; the backend never holds that key.

**The allow-list is the gas-drain guard.** Enoki refuses to sponsor any move call
outside `ALLOWED_MOVE_TARGETS`. The lists are the single source of truth in
`@suize/shared`:

- `CRASH_MOVE_TARGETS` — the live `…::router::*` Crash targets (testnet).
- `WALLET_MOVE_TARGETS` — the **legacy** mandate/vault/swap/navi package (being retired).
- `SUBS_MOVE_TARGETS` — the standalone **`subs::subscription`** create/renew/cancel,
  plus the gasless `redeem_funds`/`into_balance` helpers the per-period Balance push
  needs (`packages/move-subs/SPEC.md`).

The effective allow-list (`src/sponsor/index.ts`) is
`[...CRASH_MOVE_TARGETS, ...WALLET_MOVE_TARGETS, ...(SUBS_PUBLISHED ? SUBS_MOVE_TARGETS : [])]`.
**`account.move` is DEAD — there is no `ACCOUNT_MOVE_TARGETS` and no `RailConfig`.** The
sponsor exists ONLY for the surfaces that genuinely need gas: Crash bets and the wallet's
subscription Party-object writes (a Party-object mint is not fully gas-rebatable). A
vanilla x402 payment is a gasless `send_funds` — it needs **no sponsor at all** (the
protocol rebates it), which is why the facilitator (§7) is keyless.

**Hardening (keep):**
- `sender` is pinned to the verified caller identity, NEVER a body field;
  `allowedAddresses = [sender]` so a sponsored tx cannot redirect funds to a third party.
- Network hard-rejected unless `testnet` (the v1 mainnet flip changes this guard — see
  the root `CLAUDE.md` mainnet gate).
- Oversized-PTB reject (`MAX_TX_KIND_BYTES = 16 KiB`) before Enoki sees it — caps the
  sponsored gas budget against an inflate-the-budget drain.
- **Gas-drain ceilings** (`src/quota.ts`): a process-global daily cap + a per-address
  sub-cap, consumed AFTER validation and BEFORE the Enoki call (a rejected request
  never burns budget). In-memory, per-replica — Enoki's own pool budget is the hard cap.
- Enoki failure detail (Move aborts, allow-list shape, dry-run internals) is logged
  **server-side only**; the client gets a category-only message — no information
  disclosure.

**Relation to the facilitator (§7):** NONE on the payment path — the facilitator is
**keyless** and uses the gRPC client, NOT this Enoki sponsor. A vanilla x402 `send_funds`
is gasless at the protocol level, so the FACILITATOR door (`POST /build` → sign →
`POST /settle`) never touches `createSponsor`. The sponsor's only payment-adjacent
caller is the wallet's `/confirm-subscribe` Party-object write (sponsored because that
mint isn't gas-rebatable — `apps/wallet/SPEC.md` §6b). One sponsor core; the facilitator
is a separate keyless settlement spine.

`sponsorReady()` probes Sui RPC reachability for `/ready/sponsor`.

---

## 3. mcp — the remote-MCP transport (BUILT bare; the pay/deploy tools to build)

`src/mcp/index.ts`. `POST /mcp`, hand-rolled JSON-RPC 2.0 Streamable-HTTP
(`initialize` / `notifications/initialized` / `ping` / `tools/list` / `tools/call`),
single-shot `application/json` responses (no SSE channel, no sessions). Hand-rolled,
not the `@modelcontextprotocol/sdk` — the SDK's Node-stream transport fights this
service's `Request→Response` matcher chain for zero benefit at one tool. Body capped at
64 KiB; batch supported; notifications → 202.

**BUILT:** one tool, `suize_ping` — a no-auth liveness greeting. No auth, no payment,
no Sui, no state.

> Post-pivot scope note (root `CLAUDE.md` LOCKED #6): the MCP is an **optional
> developer / CHARGE-side integration** — never how a consumer uses PAY (that is the
> self-contained wallet app). The tools below remain worth building for external/dev
> agents paying merchants.

**TO BUILD — the real tools (the dev/power-user door, owner-validated 2026-06-10):**

One-line install: `claude mcp add suize` / `npx @suize/mcp`, then Google zkLogin once
(§3.2). LAW (root `CLAUDE.md`, the integration surface): every product surface carries
a **"Use with Claude/Codex"** doc section.

- **`suize_pay`** — the x402 client. Given a merchant's x402 V2 `PaymentRequired`
  challenge (or a pay-link/amount): read the declared outputs, **check the confirm-policy
  dial** (§3.1), build the gasless `send_funds` payment (or `POST /build`), **sign with
  the LOCAL zkLogin session**, settle **via the facilitator** (§7: `POST /settle`). Zero
  payment code for the agent author. The receipt (the on-chain balance-change set, fee
  visible) returned as tool output.
- **`suize_balance`** — the agent address's USDC balance (= the hard cap — the MCP's own
  zkLogin address), read direct-to-chain.
- **`suize_receipts`** — the caller's settled payments (fee visible in the
  balance-changes), read direct-to-chain.
- **`suize_subscriptions`** — the caller's on-chain subscriptions (merchant, amount,
  period, paid-until, active), read direct-to-chain.
- **`suize_kill`** — sweep the agent address's ENTIRE balance back to the paired main
  wallet (gasless) and clear the local session. Idempotent; an empty wallet is a no-op.

> The MCP is a **wallet** — pay, read, kill (6 tools incl. `authenticate`). Deploy is
> NOT an MCP tool: Suize Deploy is a plain x402 endpoint an agent calls directly
> (`apps/deploy/SPEC.md` / its `llms.txt`), so the wallet MCP stays merchant-agnostic.

All tools **sign locally** — the facilitator verifies + broadcasts, never signs. Auth
into the MCP = Google (local zkLogin, via the wallet-origin `/agent-connect` door under
a SECOND distinct client id — `apps/wallet/SPEC.md` §6b); there is NO remote OAuth broker
and NO `set_agent`.

### 3.1 Confirm-policy dials (client-side, in the MCP — NOT a backend gate)

The spending leash has two layers: on-chain physics (the agent ADDRESS's own balance =
hard cap; kill = stop funding + revoke at the source; a subscription = a push-not-pull
Party object the user signs each period) — and the **client-side policy dials** the MCP
enforces before signing: `confirm-each` (default — co-pilot), `auto-under-$X`,
`full-auto`, `confirm-new-subscription`. **Subscriptions, once approved, renew silently**
(exempt from the dial — keeps the Deploy renewal alive). These dials live in the
MCP/Wallet, never on-chain; they gate whether the local session signs, nothing more.
Marketing: *"autonomy you switch on."*

### 3.2 MCP auth & local zkLogin signing (VERIFIED 2026-06-08 vs Enoki + Mysten docs)

The non-custodial guarantee, concretely. The signer is a zkLogin **ephemeral**
`Ed25519Keypair` the MCP **generates and holds locally** — it is the only thing that can
sign, and it never leaves the machine. (Reference: Mysten's own
`sui keytool zk-login-sign-and-execute-tx` is this exact headless flow.)

**First-time auth (once per session ≈ 48 h):**
1. `ephemeral = new Ed25519Keypair()` — local (in-mem or encrypted in `~/.suize/`). **Only signer; never leaves.**
2. Nonce for `maxEpoch = currentEpoch + 2` (Enoki `POST /v1/zklogin/nonce`, or local `generateNonce`).
3. **Browser hand-off:** open the Google OAuth URL carrying that nonce; capture the `id_token` via a **loopback callback** (`http://127.0.0.1:<port>`) — or manual paste (keytool-style) for v1.
4. Salt + address: Enoki `GET /v1/zklogin` (`zklogin-jwt: <id_token>`) — see the salt note.
5. Proof: Enoki `POST /v1/zklogin/zkp` (`zklogin-jwt` + ephemeral pubkey + maxEpoch + randomness) → cache the partial proof for the session.

**Per-tx signing (fully local until `maxEpoch`):** build the sponsored tx →
`userSignature = ephemeral.signTransaction(bytes)` (**local**) →
`getZkLoginSignature({ inputs: {…proof, addressSeed}, maxEpoch, userSignature })` →
execute via the Enoki sponsor.

**Stack:** `@mysten/sui/zklogin` (the standalone `@mysten/zklogin` is **DEPRECATED**) +
`EnokiClient` (Node, API-key, no browser). Enoki is **prover + sponsor + (optionally)
salt** only — it **cannot sign**: a valid signature needs (a) a fresh Google `id_token`
bound to the ephemeral key by nonce, (b) the salt, AND (c) the local ephemeral key. No
single party holds all three; the secret Enoki key alone cannot mint a proof (the prover
requires the user's live JWT). **Non-custodial: VALIDATED.**

**Salt — the one honesty footnote:** Enoki holds the salt by default (can derive the
address, still **cannot sign**). For an airtight *"keys never leave your machine,"*
**self-manage the salt** (deterministic from a local secret / stored locally) so Enoki
never holds it — **DECISION: self-manage** (matches calibrated honesty). If we ever use
Enoki's salt, copy must say "Enoki holds salt but cannot sign," never imply otherwise.

**Mainnet:** Enoki proving + sponsoring on mainnet need a paid tier (≥ $69/mo); testnet
is free; the prover is self-hostable (Docker) to drop the Enoki dependency.
**ANTI-PATTERN (do not copy):** `tamago-labs/sui-butler`'s zkLogin mode pushes txs to a
server and signs server-side — the opposite of our model.

### 3.3 The external (non-MCP) payer — the POWER door: build the gasless tx, the facilitator settles

An agent on **any** Sui key (a competitor's wallet, a raw keypair) pays a Suize merchant
with **no Suize account and no MCP**: the merchant's x402 V2 challenge names the
settlement = a gasless `send_funds` paying the declared `extra.outputs` (the merchant net
+ the treasury fee leg) — both sides are plain ADDRESSES. The agent builds that gasless
PTB itself (or `POST /build`), **signs with its own key**, and hands the b64
`PaymentPayload` back in the **`X-PAYMENT`** header on retry (§7). The facilitator
**verifies (simulate) + settles (broadcast)** — it holds no key and stores nothing per
payment; the on-chain balance-change set IS the receipt, fee visible. The fee can't be
routed around: a single-output payment to a fee-tier merchant fails the facilitator's
exact-outputs check (`assertOutputsExact`) → not settled. The **`payLink`** (the HUMAN
door) is just the hosted pay page (§7.3) for callers that can't auto-build a Sui tx. The
claim ladder (root `CLAUDE.md`) governs the public wording.

---

## 4. deploy — the first merchant on the rail (BUILT; treasury-gated)

`src/deploy/index.ts`. The Deploy merchant orchestration. Detail + the billing model
(each deploy = a one-off $0.50 x402 settlement; the $19.99/mo push-not-pull `subs`
subscription unlocks custom domains + auto-renewed Walrus storage) lives in
`apps/deploy/SPEC.md` — not redeclared here. What this service owns:

- `POST /deploy` (multipart `name`, `site.tar` + the `X-PAYMENT` header) — **authenticated
  BY THE PAYMENT ITSELF**, no anonymous deploy, **NO separate deploy-auth nonce/signature**
  (nonce-free since 2026-06-14). The X-PAYMENT carries a signed gasless payment; the
  on-chain `owner` is the **recovered payer** (`recoverPayer` — zkLogin, Ed25519, OR a
  1-of-2 sub-account MultiSig), never a client field — **whoever pays, owns**. Flow:
  verify the payment pays the exact $0.50 → unpack tar (caps: 100 MiB, 2000 files) →
  Walrus quilt + manifest blob → **settle the payment** → mint a fresh immutable shared
  `Site` (signed by the deploy service wallet, pays its own gas) with the **settled
  payment digest recorded in the on-chain `SiteDigestRegistry`** → `{ siteId, subdomain:
  base36(siteId), url, version, digest }`. The no-Sui-key door is the SAME path: the human
  authorizes (signs-but-doesn't-settle) via `pay.suize.io?…&mode=authorize` and the agent
  submits that signed payload as X-PAYMENT.
- `GET /sites[?owner=]`, `GET /sites/:id` — read from `SiteCreated` events + the Site
  object.
- `POST /domains` (issue challenge / `?verify=1`), `DELETE /domains/:domain` —
  custom-domain link/unlink behind a two-record DNS gate (TXT ownership + CNAME routing)
  AND a cryptographic site-owner signature (`buildDeployLink/UnlinkAuthMessage`, op-bound,
  **stateless-timestamped** `{ ts, signature }` — recovered signer == `Site.owner`, `ts`
  within a freshness window; NO server-issued nonce store, multi-replica-safe). Optional
  Cloudflare-for-SaaS auto-SSL; manual-CNAME fallback otherwise.

**Gates:** 503 "deploy not configured" when `DEPLOY_WALLET_PRIVATE_KEY` is unset; 503
while on-chain ids are `0x0` placeholders (on testnet the `deploy_sui` ids are REAL —
published at `0xadcc8d…`). Per-IP token bucket + a global daily deploy ceiling (each
deploy spends real SUI).

**PROVEN end-to-end:** this module shipped our own landing — tar → Walrus quilt +
manifest → on-chain `create_site` → served hash-verified by the worker (Site
`0xc96dd162…47b9d0c`, 30 epochs, `*.suize.site`). The nonce-free agent-pays path is
proven on testnet: a fresh agent signs a gasless $0.50, submits it as X-PAYMENT, and the
`Site` mints with `owner == the recovered payer` (verified on-chain). The charge gate
arms the moment the Deploy treasury resolves.

> **URL DOMAIN — RESOLVED (L3, verified 2026-06-10).** Worker, backend
> (`config.deployBaseDomain`), and `@suize/shared` all standardize served-site URLs on
> `<base36(siteId)>.suize.site`.

**The CHARGE↔Deploy join — x402 V2 'exact', first-party, KEYLESS** (`src/deploy/payment.ts`):
the deploy is a one-off **$0.50 x402 settlement** gated BEFORE any Walrus upload. Deploy
is a **first-party merchant** — the merchant IS the Suize treasury — so the requirement
is a **SINGLE full-amount output** of the $0.50 to the treasury (no fee split; 100%
already lands on us). The treasury (the fee-recipient) is resolved from a **SuiNS name**
(`treasury@suize`) — rotating it is one on-chain record edit, no redeploy. The gate
(`chargeGateReady()`) is now a SINGLE async predicate — **the treasury resolves**; no
`ACCOUNT_PUBLISHED`/`RAIL_CONFIG_SET` flags (the rail has no `RailConfig`). Until the
treasury resolves, the route runs **un-gated** (auth + rate limits + the daily gas-drain
ceiling — abuse mitigation, not billing); the moment it resolves, the gate lights up with
zero code change.

> **x402 V2, KEYLESS, NONCE-FREE (`src/deploy/payment.ts`).** `POST /deploy` speaks the
> standard: (a) a payment-less POST answers **402 with the x402 V2 `PaymentRequired` body
> + the `PAYMENT-REQUIRED` header** (price discovery is public; a generic agent settles
> zero-shot) — minted **STATELESSLY** via `@suize/pay`'s `mintPaymentRequired`,
> facilitator/buildUrl pointed at this process's own origin; the 402's `error` carries the
> deploy rider *"whoever pays owns the site"*; the `payLink` is
> `pay.suize.io?…&mode=authorize` (no secret);
> (b) the paid retry carries the b64 `PaymentPayload` in the **`X-PAYMENT`** header — the
> SOLE authorization, no separate deploy-auth signature. `gateDeployPayment` decodes it,
> deep-equals the presented `accepted` terms against OUR single-output requirement,
> **recovers the payer** (→ the on-chain `owner`; whoever pays, owns), and runs `doVerify`
> (simulate-only). The Walrus work runs on the VERIFIED-but-unsettled payment; then
> `settleDeployPayment` (`doSettle` — broadcast keyless, idempotent by digest) settles it
> **immediately before** `create_site`, which records the settled digest in the on-chain
> **`SiteDigestRegistry`** and aborts **`EDigestUsed` (→ 409)** on a duplicate. No payment
> → no deploy. The no-Sui-key door submits a human's `mode=authorize` (signed-unsettled)
> payload as the SAME X-PAYMENT — owner = the human.
> E2E: `test/e2e/deploy.402.e2e.ts` + `deploy.paid.e2e.ts` + `deploy.paylink.e2e.ts`.

> **ONE-SITE-PER-PAYMENT = ON-CHAIN (multi-replica-safe; THE PRINCIPLE).** The in-memory
> `settledDeploys` reserve/commit/release map is GONE. `create_site(reg: &mut
> SiteDigestRegistry, payment_digest, …)` asserts the digest is unseen and records it —
> the chain is the atomic lock. A double-submit of the same settled payment, or a retry
> that lands on a different replica, aborts `EDigestUsed` instead of minting a second
> `Site`. (An identical-payload replay is ALSO caught earlier by `doVerify`'s
> already-executed guard → 402; the registry 409 is the multi-replica backstop for the
> race where two replicas both settle the same digest idempotently and both reach the
> mint.) Nothing is public before the deploy — the pay-link returns a signed-UNSETTLED
> payload — so there is no public digest to replay.

This join is Deploy being merchant AND facilitator in one process — **it IS a client of
the ONE verify/settle core** (`src/facilitator/x402.ts` `doVerify`/`doSettle`, the same
spine every external payment rides) and layers only the owner=payer rule + the on-chain
one-site-per-payment registry on top. One verification spine, no parallel verifier.

**Storage auto-renewal** is the separate recurring leg on the push-not-pull `subs`
module — the user signs a `subscription::create` with `ref` = the site id, and the
backend's storage extender (§5) keeps that site's Walrus storage extended on settle. The
backend never charges for renewal; the `subs` module already took the period's payment.

---

## 5. The storage extender (BUILT, env-gated — replaces the deleted pull-relayer)

**The old `charge_subscription`-pulling relayer is DELETED** (it deducted from a shared
`Account` without the owner signing — `account.move` is dead). Recurring spend is now
**push-not-pull** on the standalone `subs::subscription` module: the user signs each
renewal themselves (the wallet pushes it, gas-sponsored), so **the backend never charges
and never reaches into a user's funds.** What's left on the backend is purely the storage
side of Deploy billing — keep a PAID site's Walrus storage extended so it never lapses.

**BUILT (`src/deploy/extend.ts`) and WIRED at boot** (`startStorageCron()`; no-op until
the deploy wallet + the published `subs` + `deploy` ids arm `storageEnabled()`). It does
NOT charge — the `subs` module already took the period's payment. **TWO triggers, ONE
extend path:**

- **The on-settle hook (`notifySettled`)** — fired fire-and-forget from the sponsor
  execute path after a successful sponsored tx. It reads the tx's events; any
  `SubscriptionCreated`/`SubscriptionRenewed` whose `merchant` is the Deploy treasury and
  whose `ref` decodes to a site id → extend that site's two blobs in the same beat.
- **The safety cron (`startStorageCron`)** — every `config.extendTickMs` (default 6h),
  page Deploy-merchant `SubscriptionCreated` events, drop cancelled (deleted) + lapsed
  (`paid_until_ms < now`) subs, and extend any whose blobs end within
  `config.renewalSafetyEpochs`. A missed hook (restart, off-box renewal) is still
  repaired.

The extend itself is one **service-wallet** PTB (`system::extend_blob` on the site's two
Walrus Blob objects, ≤50-epoch clamp; the service wallet pays the **WAL**, never the
user) — a blob-level extend, **no re-upload, no new write fee**. **NON-CUSTODIAL: nothing
here is an owner tx.** **F5 owner-binding (security):** a sub's `ref` is attacker-
controlled (anyone can create a `Subscription` with `ref` = another deployer's site id),
so the extender refuses unless the sub event's `owner` (== `ctx.sender()` at create/renew,
unforgeable) equals the on-chain `Site.owner` tag — otherwise an attacker drains the
service WAL extending sites they don't own. Deterministic, NOT an AI; every epoch is a
shared constant or config value.

The on-demand `POST /sites/:id/extend` is a **paid one-off $0.50** (same x402 gate as a
deploy — §4) that runs `extendOnce` after settlement. See `packages/move-subs/SPEC.md`
for the `subscription::renew` terms + the 24h-window anti-back-billing guard.

---

## 6. Client transport — TWO transports, ONE auth primitive (LOCKED #14, corrected 2026-06-10)

The old "HTTP-only, the WebSocket is dropped" plan in this section was **FALSE against
the running code and was repudiated** — root `CLAUDE.md` LOCKED #14 (corrected
2026-06-10) is the standing architecture:

- **The WS is alive and load-bearing** (`src/ws/index.ts` — `tryUpgrade` /
  `websocketHandler`): it is the wallet's (and Crash's) SOLE transport for `sponsor` +
  `handle`. Auth happens ONCE at upgrade — the client signs a personal-message nonce,
  the recovered address becomes `ws.data.address` (RAM-only session identity), and every
  sponsor call pins `sender` to it (a socket for A can never sponsor for B). The HTTP
  `/sponsor` + `/execute` + `/handle/*` routes were REMOVED when those moved to WS.
  **Verify-failure classification (2026-06-11):** zkLogin verify needs the fullnode, so
  an infra failure there (5xx/timeout/network) is retried (3×, 400 ms) and, if still
  failing, the socket closes `4004 VERIFY_UNAVAILABLE` **without** `connectionRejected`
  — that packet means "permanent, don't reconnect" to the client and is reserved for
  genuine credential failures (one transient fullnode 504 used to brick the wallet
  session until reload).
  **SSO bridge (2026-06-11):** the wallet origin is the suite's identity host —
  `/bridge` (silent `getSession` ONLY; the designed `signAuthNonce` WS-login signer is
  deliberately unshipped until a consumer needs a mitigation — `apps/wallet/SPEC.md`
  §6b) + `/confirm` (the visible money popup, builds-what-it-displays). First consumer:
  the standalone `pay.suize.io` (§7.4). The silent op never signs; money requires the
  visible popup.
- **The deploy/merchant surface is HTTP by necessity** (agents speak 402-shaped HTTP):
  the deploy itself is authenticated BY THE PAYMENT (the `X-PAYMENT` payload — its
  recovered payer becomes the site owner; nonce-free since 2026-06-14), and the domain
  link/unlink ops use a STATELESS TIMESTAMPED owner-signature (`verifyDeployRequester`
  → `verifyPersonalMessageSignature` → recovered address == `Site.owner`; a client `ts`
  within a freshness window, NO server nonce store — multi-replica-safe).
- **One auth primitive, two transports:** both verify signatures through the same
  recover-and-pin pattern — the verified address is the subject, never a body field;
  per-address rate limiting. The WS signs a connect-nonce ONCE (the socket's identity);
  the HTTP deploy/domain ops carry NO server nonce (payment-authenticated, or a ts-fresh
  signature). Reads go direct-to-chain; nothing is server-pushed beyond the
  sponsor/handle frames.

If a shared `src/auth.ts` helper is ever lifted out (deploy + ws both implement the
pattern today), that is a refactor of duplication, NOT a transport change.

---

## 7. FACILITATOR — BUILT (x402 V2 'exact', KEYLESS + STATELESS)

**The live rail is vanilla x402 V2 'exact' over Sui's protocol-level gasless
Address-Balance transfers.** The payer signs a `send_funds` PTB (`gasPayment=[]`,
`gasPrice=0`) with its OWN key, whose declared outputs ARE the settlement; the
facilitator **verifies** (simulate the signed-but-not-executed tx pays the EXACT
outputs) then **settles** (broadcast over gRPC) — **keyless**: no Enoki, no sponsor, no
owner-tx signing. Source: `src/facilitator/` (`x402.ts` the verify/settle/build core,
`fees.ts` the treasury + fee split, `index.ts` the HTTP layer), on `@suize/x402` (the
gasless builder + `assertOutputsExact` + `recoverPayer` + the gasless-shape guard) and
`@suize/pay` (the merchant middleware). **`account.move` / `RailConfig` / `suize-402/1`
/ `X-Suize-Payment` / `/pay/build` / `/pay/submit` are DELETED — do not resurrect.**

> **The design law: the facilitator is STATELESS + KEYLESS — the CHAIN is the
> database.** Suize stores nothing per payment; the payer carries the signed tx, and
> verification is a simulate + one read. Every trust decision reduces to the on-chain
> balance-change set (the receipt — fee visible). Ground truth stays trust-minimized: a
> merchant can audit the settlement itself via RPC (or `GET /tx`) — the facilitator's
> answer is checkable, not trusted. **The address IS the account** — no API key, no
> signup, no merchant record server-side.

### 7.0 The seven endpoints + status (`src/facilitator/index.ts`)

| Endpoint | Scope | Status |
|---|---|---|
| `POST /verify` | the verify core — simulate the signed gasless tx pays the EXACT declared outputs; recovered signer == simulated sender (§7.1) | **BUILT + PROVEN** |
| `POST /settle` | broadcast the verified tx over gRPC, await finality, idempotent by digest (§7.1) | **BUILT + PROVEN** |
| `GET /supported` | the x402 V2 capability descriptor: `{ kinds:[{x402Version:2, scheme:'exact', network}], extensions:['payment-identifier'], signers:{'sui:*':[]} }` | **BUILT** |
| `POST /build` | the optional facilitator-built unsigned gasless bytes (THE PROBE RECIPE — the payer signs locally) (§7.1) | **BUILT + PROVEN** |
| `GET /terms?payTo&amount` | the declared `extra.outputs` split a merchant drops into its 402 — `null` = the free tier (§7.5) | **BUILT** |
| `GET /tx?digest` | a DESCRIPTIVE audit of `balanceChanges` (never trusted, always checkable) | **BUILT** |
| `POST /checkout` | the no-auth pay-link URL formatter (§7.3) — pure string assembly, no store, no chain | **BUILT + PROVEN** |

The `@suize/pay` middleware (§7.4, `packages/pay`) + the hosted pay page (§7.3,
`apps/pay`, LIVE at `pay.suize.io`) round out the merchant + human surfaces. The Tier-0
"instant merchant" screen lives in the wallet's business console (a pay link is only for
a customer to pay a merchant; `apps/wallet/SPEC.md`). The E2E proof inventory + run
commands live ONCE in §0.

### 7.1 The verify / settle / build core (x402 V2 'exact' — BUILT + PROVEN)

Deterministic plumbing over ONE gRPC client (the transport where gasless eligibility
resolves) — no Enoki on this path, no database, no sessions. The only server state is
the in-memory settle idempotency cache (§7.5), never payment records. The wire is the
standard x402 V2 `PaymentPayload` + `PaymentRequirements` pair; amounts are decimal USDC
strings on the public surface, atomic-unit strings inside `extra.outputs`.

- **`POST /verify`** `{ paymentPayload, paymentRequirements }` →
  `200 VerifyResponse { isValid: true, payer }` | `{ isValid: false, invalidReason, invalidMessage }`.
  Read-only (simulate + one tx-state read — NEVER broadcasts). Asserts `scheme === 'exact'` ∧
  `network` match ∧ the payload is `{ signature, transaction }` (base64), then in
  parallel **recovers the signer** (`recoverPayer`) and **simulates** the tx to prove
  it credits the declared outputs EXACTLY (`assertOutputsExact` — default outputs =
  a single full-amount leg to `payTo`, the free tier; a fee-tier merchant declares the
  `[merchant net, treasury fee]` split in `extra.outputs`). Three more hard guards: a
  cheap **gasless-shape check** (`assertGaslessTxShape` — `gasPrice 0`, `gasPayment`
  empty, only the allowlisted `send_funds`/`redeem_funds`/`coin::into_balance` + coin
  split/merge commands, no arbitrary command routes the asset), **recovered signer
  == simulated sender** (no proxy debits), and a **replay guard**: the digest is computed
  from the signed bytes and ONE `getTransaction` read rejects an **already-executed**
  payment (`invalid_exact_sui_payload_already_executed`). Simulation alone is NOT a
  replay guard — a gasless Address-Balance tx has no object inputs, so re-simulating a
  *settled* tx still SUCCEEDS (proven on testnet 2026-06-12); the chain read is the only
  sound guard, and a replayed payload would otherwise pass `/verify` for its whole
  ValidDuring window and double-serve a merchant. A definitive mismatch is a `200`
  `isValid:false` with the x402 `invalidReason`; only a malformed body is a `400`.
- **`POST /settle`** `{ paymentPayload, paymentRequirements }` →
  `200 SettleResponse { success, transaction:<digest>, network, payer, amount }`.
  **Idempotent by digest, chain-read-first** — the digest is precomputed from the bytes
  (`Transaction.from().getDigest()`); a per-replica terminal cache + in-flight join
  fast-paths a local replay, and the run-closure then **reads the chain for an
  already-executed digest** and returns its on-chain result directly — WITHOUT re-verify
  (which now rejects an already-executed digest as a replay) and WITHOUT re-broadcast
  (gRPC `executeTransaction` THROWS on a spent tx). Otherwise it **re-verifies** (never
  broadcasts an unverified tx), then `executeTransaction` over gRPC + `waitForTransaction`
  (finality on the OWN client so an immediate read is answerable) + the effects check: a
  tx that executed but **FAILED on-chain → `success:false`** (a failed tx never reads as
  settled). A retry is never a double charge. A settle failure is a `200` `success:false`
  (the protocol carries the reason); only a malformed request is a `4xx`.
- **`POST /build`** `{ sender, outputs? | requirements? }` → `200 { bytes }`. The
  optional facilitator-built **unsigned gasless** bytes (THE PROBE RECIPE:
  `buildGaslessOutputs` sets `gasBudget(0n)` to force the gasless election). Either
  explicit atomic-unit `outputs` (1..8 legs, each a `0x` address + positive amount) OR a
  `{ payTo, amount }` `requirements` shape from which the fee policy derives the split.
  Belt-and-braces: the facilitator runs `assertUnsignedBytesSafe` on the bytes it built
  (the same hard pre-sign gate the payer must run) before handing them back — it never
  hands back unsafe bytes. The payer signs these **LOCALLY** (the facilitator never signs
  an owner leg). `503` only when a fee-tier split is requested and the treasury is
  unresolved (free-tier single-output build always works).

> **PROVEN on-chain (E2E, real testnet):** the payer signs a gasless `send_funds`,
> pays **ZERO gas** (protocol-level rebate — no gas token, ever), and the exact declared
> outputs (merchant net + the treasury fee leg) land atomically. The facilitator holds
> no key; it only simulated + broadcast.

### 7.2 The 402 challenge — the x402 V2 `PaymentRequired` body (the standard wire)

The merchant answers HTTP **402** with the standard x402 V2 `PaymentRequired` body (plus
the `PAYMENT-REQUIRED` header), minted by `@suize/pay`'s `mintPaymentRequired`. It is the
vanilla x402 shape — the `accepts[]` array of `PaymentRequirements`, each naming the
scheme/network/asset/payTo/amount, the fee split in `extra.outputs`, and an `extra.buildUrl`
pointing at the facilitator's `POST /build`. Defined HERE so the `@suize/pay` middleware
(§7.4), the hosted pay page (§7.3), the MCP's `suize_pay` (§3), and the PAY wallet all
agree on one shape:

```json
{
  "x402Version": 2,
  "error": "payment required",
  "accepts": [
    {
      "scheme": "exact",
      "network": "sui:testnet",
      "asset": "0x…::usdc::USDC",
      "payTo": "0x<merchant address>",
      "amount": "0.50",
      "maxTimeoutSeconds": 120,
      "extra": {
        "outputs": [
          { "to": "0x<merchant address>", "amount": "490000" },
          { "to": "0x<treasury address>", "amount": "10000" }
        ],
        "buildUrl": "https://api.suize.io/build"
      }
    }
  ]
}
```

Wire laws: the public `amount` is a **decimal USDC string** (`"0.50"`); the
`extra.outputs` legs are **atomic-unit strings** (the exact balance-change set the
facilitator enforces — `490000` net + `10000` fee = the full `500000`, **merchant-
absorbed**, so the payer is debited exactly `0.50`). A **single output** (no `extra.outputs`,
or one full-amount leg to `payTo`) is the **free tier** (no rake). `network` names the
chain (`sui:mainnet` / `sui:testnet`). **The PAYER never speaks base units on the public
surface** — it either echoes the merchant's `accepts[0]` to `POST /build` or builds the
`send_funds` PTB from the declared `outputs`, signs locally, and presents the b64
`PaymentPayload` in the **`X-PAYMENT`** header on retry. The fee split is the merchant's
declared terms; the payer-built or facilitator-built tx must credit them EXACTLY or
`/verify` rejects it. The `payment-identifier` extension (advertised by `/supported`)
carries an optional correlation id for the agents that want one — it is NOT load-bearing
for settlement (the digest is the proof).

### 7.3 The hosted pay page (Phase 4 — page BUILT in `apps/pay`, LIVE at `pay.suize.io`; `/checkout` BUILT + PROVEN) — ONE page, both species

`https://pay.suize.io?payTo=<address>&amount=<decimal>&memo=<text>&returnUrl=<url>`

Preferred human-friendly form: **`?to=<handle>`** (a Suize handle — `name@suize`,
bare `name`, or `name.suize.sui`) instead of / alongside `payTo`. The PAGE resolves
the handle on-chain client-side (suix_resolveNameServiceAddress on the
`<name>.suize.sui` leaf record — the backend never resolves); when both params are
present **`to` wins**, and an unresolvable handle is a HARD page error — never a
silent fallback to `payTo` (which stays in the link as the raw protocol fallback).

The terms live ENTIRELY in the URL — the page is stateless too. (The earlier
design's Tier-1 pay-links and Tier-2 checkout sessions are **MERGED into this one
page**, owner 2026-06-10: there are no link records and no sessions to store — a
pay-link IS this URL.)

**Hosting — STANDALONE `pay.suize.io` (owner 2026-06-11, reversing the same-day
base-path call):** the page is its own origin (`apps/pay`, vite `base: '/'`,
routes `/` · `/connect`), Vercel project `aresrpg/suize-pay`. Identity comes
from the WALLET origin via the **SSO bridge** (protocol `@suize/shared/bridge`;
host surfaces `wallet.suize.io/bridge` — the hidden same-site iframe answering
`getSession` silently (the `signAuthNonce` signer is designed but deliberately
unshipped — `apps/wallet/SPEC.md` §6b), origin-allowlisted + `frame-ancestors`
pinned — and `wallet.suize.io/confirm` — the visible money popup that
builds-what-it-displays, signs the gasless payment locally, settles, returns ONLY the
digest; the key never leaves the wallet origin, and no bridge surface signs caller bytes).
The pay page therefore runs NO Google login of its own; standard wallets still
connect locally via dapp-kit. **The `/connect` MCP door is REMOVED (2026-06-11,
unified-auth consolidation)** — its popup OAuth and the `pay.suize.io/enoki`
Google-client flag die with it; the pay origin registers NO Enoki wallet at
all. The MCP's auth handshake gets re-homed on the wallet origin (the one
identity point) when the MCP ships. **Transition
state: RESOLVED (2026-06-11)** — the DNS record landed; `pay.suize.io` is LIVE
and is the canonical pay origin everywhere links are minted (`@suize/pay`'s
default `PAY_PAGE`, `/checkout`, the deploy 402 challenge — all via
`PAY_PAGE_URL`/`config.payPageUrl`); the wallet's phase-B redirect SHIPPED
(2026-06-11): `wallet.suize.io/pay/:path*` 307-redirects to `pay.suize.io/:path*`,
query preserved.

- **A human** gets the confirm page: one tap → sign in with Google → the gasless
  `send_funds` payment is built-from-what-is-displayed, signed locally, and settled via
  the facilitator → redirected back to `returnUrl` with `?digest=<digest>` appended (the
  merchant site then runs its own `/verify`).
- **An agent** requesting the same URL with `Accept: application/json` gets the
  §7.2 x402 V2 `PaymentRequired` body for these terms — the machine-readable door, by
  content negotiation, same URL.
- **`POST /checkout`** `{ payTo, amount, memo?, returnUrl?, handle? }` (`handle?`
  is round-tripped UNRESOLVED into the link's `to=` param — resolution is the
  page's job) →
  `200 { sessionUrl, paymentId }` survives ONLY as an optional **NO-AUTH URL
  formatter** (pure string assembly of the page URL above, for merchants who want a
  server-call shape). No store, no session record, no webhookSecret. **BUILT +
  PROVEN** (`src/facilitator/index.ts` — the per-IP WRITE bucket, the same address/amount
  validators as the other write doors; `returnUrl` must be http(s); `paymentId` = the
  caller's `memo`, or a freshly minted pinned-format `pay_[0-9a-f]{32}` when
  absent — either way it IS the link's `memo` param, so the receipt correlates.
  `400` shape · `429` bucket; no rail gate — string assembly never touches chain.
  Base URL = `PAY_PAGE_URL` env, default `https://pay.suize.io` (the standalone
  pay origin) — the query is appended directly
  (`<base>?payTo=…`, never `<base>/?payTo=…`). Wire types
  `FacilitatorCheckout{Request,Response}` in `@suize/shared`; E2E
  `test/e2e/paylink.e2e.ts`**).
- **Phishing rules (LAW):** a RAW `?payTo=0x…` link renders the address in FULL —
  never truncated-only, never replaced by a merchant display-name (the human
  confirms the exact address, because the address IS the account). **HANDLE-ONLY
  (owner 2026-06-11):** when BOTH sides are Suize accounts — i.e. the link carries
  a `to=` handle — the page shows the **handle ONLY**, NOT the resolved address
  beneath it. The on-chain resolution is what prevents misdirection (the handle
  deterministically resolves to one address on-chain; there is no spoof surface to
  guard against by also showing the hex), and a 64-hex address under every handle
  was noise that hurt the consumer read more than it helped. A raw `?payTo=0x…`
  link (no resolvable handle) still shows the address — that path has no handle to
  show. `memo` is HTML-escaped and rendered as inert text; NO merchant-supplied
  markup/images/redirects except the post-payment `returnUrl`, navigated only
  AFTER settlement with `?digest=` appended — never before.

Settlement notice = the merchant's own `/verify` (on-retry via the middleware, or
polling) or the Tier-0 history view in the wallet's business console (§7.6). **Webhooks are DELETED from v1** —
push can return post-v1 if a paying merchant needs it; ground truth never moves off
the receipt event. (Stripe phrasing law unchanged: Suize **COEXISTS** with Stripe —
"keep Stripe for humans, add Suize for agents" — never claim integration INTO
Stripe.)

### 7.4 The `@suize/pay` middleware (BUILT: `packages/pay`) — the whole merchant integration, one import

The x402 V2 snippet as a package (**zero runtime deps**), configured with the merchant's
OWN terms. **API:** `suize({ to, price, facilitator?, network? })` returns the fetch-style
wrapper `paywall(handler)` (Bun.serve / Hono / Next route handlers), with `paywall.express`
attached (structural Express types — no `@types/express` dependency) for custom transports;
malformed config throws at boot, never mints unverifiable challenges. It does exactly two
things:

1. Request without valid payment → answer **402** with the x402 V2 `PaymentRequired` body
   (§7.2, `mintPaymentRequired`) + the `PAYMENT-REQUIRED` header. The declared
   `extra.outputs` come from the merchant's own terms (`/terms` resolves the 2%/1¢ split,
   or a single full-amount output for the free tier).
2. Request carrying the b64 `PaymentPayload` in the **`X-PAYMENT`** header → parse it →
   call the facilitator `POST /verify` + `POST /settle` against the merchant's OWN
   configured terms → serve ONLY when both succeed (the settled tx pays the EXACT
   declared outputs) AND the digest is unseen.

**The state is one in-memory structure:** the **seen-digest `Set`** (one digest = one
serve — the replay guard; the on-chain idempotent settle is the durable guard, the chain
rejects a re-broadcast). The restart caveat: a restart resets the replay guard, and the
settle's own digest cache + the chain's re-broadcast rejection bound the exposure — persist
the set if one payment guarding many serves matters to you.

**Fail-closed LAW (every facilitator consumer):** a never-settled / unreadable digest is
NOT a definitive paid. A consumer MUST treat anything that isn't a verified+settled
success as unpaid — the middleware does (any non-success, including a fetch failure → a
fresh 402).

That is the ENTIRE merchant surface: no keys, no signup, no webhook handler, no chain
code. The merchant is the verifier of its own terms; Suize is plumbing.
*(npm note: the package is currently `"private": true` with TS-source exports — an npm
publish later needs a build step.)*

### 7.5 Minimal abuse guards (the ONLY guards in v1)

- **The verify spine** — every trust decision reduces to the §7.1 verify/settle
  assertions over the on-chain balance-change set; nothing else is trusted, nothing
  else is stored.
- **TWO per-IP token buckets by cost** (the facilitator's OWN — `src/facilitator/index.ts`),
  **both FAIL CLOSED on a null IP**: a **WRITE bucket** (`/settle` + `/build` + `/checkout`
  — capacity 6, refill 0.5/s; each token is a broadcast/build/mint) and a separate,
  **looser READ bucket** (`/verify` + `/terms` + `/tx` + `/supported` — capacity 30,
  refill 5/s; cheap simulate/reads so legit polling never trips). Validation precedes
  the bucket — a malformed request never burns a token.
- **`/settle`** — idempotent by digest (§7.1's terminal cache + in-flight join +
  chain-readability fallback): retries are free, double charges impossible. No sponsor
  ceiling applies — the facilitator is keyless, the payer pays zero gas at the protocol
  level, so there is no Enoki budget to grind.
- **The exact-outputs check is the fee guard** — a single-output payment to a fee-tier
  merchant fails `assertOutputsExact` (the treasury leg is missing) → not verified, not
  settled. The fee can't be routed around.
- **The hosted page** — the §7.3 phishing rules.
- **Treasury fail-closed** — a fee-tier `/terms`/`/build` REFUSES (503) when the
  SuiNS-resolved treasury is unknown (a fee with an unknown recipient would burn the rake
  or pay a squatter); free-tier (single-output) verify/settle/build never touch it.
- **The multi-replica landmine** — the settle idempotency cache is per-replica in-memory:
  running more than one replica needs sticky routing or shared state (flagged; v1 runs
  one). The on-chain idempotent settle is the durable backstop.

### 7.6 Merchant on-ramps — the ladder (amended 2026-06-10)

Every tier lands on the SAME rail + receipt — the tiers only change WHO WRITES THE
402:

- **TIER 0 — INSTANT MERCHANT (a screen, not an API — lives in the WALLET's
  business console, owner 2026-06-11; the pay surface is only for a customer to
  pay a merchant).** Sign in with Google (zkLogin mints your `payTo` address) and
  the console hands you your pay-link (§7.3) + a **READ-ONLY on-chain payment
  history** (the receipt events for that address, read straight from chain — no
  database, no merchant record server-side). Zero code, zero keys; vanilla x402
  pays any plain address, so *"your address is your account"* is literally true.
  (A working prototype lived at the deleted apps/pay `/start` — handoff note at the
  end of `apps/wallet/SPEC.md`.)
- **TIER 1+2 — THE HOSTED PAY PAGE** (merged, §7.3): terms in the URL; humans tap,
  agents content-negotiate the x402 V2 `PaymentRequired` body; `/checkout` = the
  optional no-auth URL formatter.
- **TIER 3 — THE 402 MIDDLEWARE** (`@suize/pay`, §7.4) — for merchants who own
  their HTTP surface and serve agents directly.
- **TIER 4 — PLATFORM GATEWAY PLUGINS (ROADMAP).** Gateway plugins for hosted
  commerce platforms, configured with the merchant's `payTo` (the pay page under
  the hood — keyless). Per the standards-only law (root `CLAUDE.md`): **NO platform
  names in public copy until a plugin ships** — internal note only:
  WooCommerce/Wix/BigCommerce are the open-gateway candidates; Shopify is gated
  (crypto-app program + rev-share).

Anti-abuse everywhere = IP/volume rate limits (§7.5), never identity. The merchant
copy law (lead with the fee delta, agents-first) lives in root `CLAUDE.md` —
referenced, not redeclared.

### 7.7 Protocol positioning + the claim ladder (the binding copy law)

- **The protocol IS x402 V2 'exact'** (§7.2) — the standard wire, the merged Sui exact
  scheme; the facilitator implements it natively, no proprietary fork.
- **The claim ladder (binding — write at the rung true ON PUBLISH, ~June 18, when the
  upstream PRs are OPEN but not merged):** ALLOWED — *"gasless"* (literally true,
  protocol-level), *"x402-compatible by design,"* *"implements the merged x402 Sui exact
  scheme,"* *"we run a live x402 facilitator for Sui,"* *"the x402 Sui implementation,
  contributed upstream (PR open)."* FORBIDDEN until the mechanism PR MERGES — *"on x402,"
  "official x402 facilitator," "listed by x402," "the default Sui facilitator"* as fact
  (may be stated as an ambition). The land-grab thesis (no dominant Sui facilitator) is
  the motivation, NOT a present-tense claim.
- **The other discovery doors:** **`llms.txt`** — the static door advertising the rail
  to non-MCP agents (LIVE at `suize.io/llms.txt`; content LAW in root `CLAUDE.md`) — and
  **OpenAPI** — the deploy/merchant HTTP surfaces (§4) double as the OpenAPI door (not
  yet published as a spec document).

---

## 8. Readiness + boot (BUILT)

`src/index.ts`. Boot fails fast if `ENOKI_PRIVATE_API_KEY` is missing. Warns if
`ALLOWED_ORIGINS` is empty (browser origins gate CORS + — today — the WS upgrade).

> **DEPLOY-CHECKLIST — `ALLOWED_ORIGINS` REPLACES the defaults.** When the env var
> is set it OVERRIDES `DEFAULT_ALLOWED_ORIGINS` wholesale (`src/config.ts` ~L50 —
> it is `fromEnv.length > 0 ? fromEnv : defaults`, never a union). So the prod/k8s
> value MUST include **`https://pay.suize.io`** (the hosted pay page origin) and
> **`https://wallet.suize.io`** (the SSO bridge host) or the facilitator's `/build`,
> `/settle`, and `/verify` lose their CORS allow-origin and every browser call from
> the pay page is blocked. Include every prod app origin you actually serve (pay,
> wallet, deploy, crash, suize.io) — the default list is the reference for what a
> complete override looks like.

| Probe | Gates |
|---|---|
| `GET /health` | liveness (`ok`) |
| `GET /ready` | all CONFIGURED components up (200) — an unconfigured handle/deploy is omitted, never a 503 |
| `GET /ready/sponsor` | sponsor Sui RPC reachable |
| `GET /ready/handle` | handle module (SuiNS config + RPC); 503 when unconfigured |
| `GET /ready/deploy` | deploy wallet configured + Sui RPC; 503 when unset |
| `GET /ready/ws` | WS plumbing (the live sponsor/handle transport — LOCKED #14) |
| `GET /ready/serve` | the k8s readinessProbe target — request-serving surfaces only (sponsor + WS); EXCLUDES handle so a SuiNS blip can't pull the rail out of rotation |

`idleTimeout: 200s` — a deploy is a ~20s synchronous surface (two Walrus PUTs + the Site
mint) with no bytes flowing; Bun's default 10s would 502 it mid-deploy.

---

## 9. The number wall + key separation (LAW)

- **The deterministic core owns every on-chain amount/fee/size.** No LLM, no signal ever
  emits a number that lands in a transaction. The fee split is the facilitator's declared
  `extra.outputs` (the 2%/1¢ math in `fees.ts`); the storage extender passes only the
  clamped epoch count; the on-chain terms supply each subscription period's amount.
- **The backend never signs an owner tx.** It signs only: sponsored gas (Enoki private
  key), the deploy `Site` mints (deploy service wallet), and SuiNS leaf mints (handle
  issuer key). Three SEPARATE secrets — never reuse one across modules. The Enoki sponsor
  key and any future scoped key live in env (SOPS in k8s); production keys belong in
  KMS/HSM (mainnet gate).
- **Custody:** *"fully non-custodial — your keys never leave your machine."* The honest
  caveat (delegated-spend, not custody risk) lives in the root `CLAUDE.md` — referenced,
  not redeclared.

---

## 10. Conventions

ESM + Bun runtime. One process, one port (default 8080), one image. `src/config.ts` is
the sole env boundary (mirrored by `.env.example`). Network, on-chain ids, version pins,
and the move-call allow-list lists live ONLY in `@suize/shared`.

---

## 11. Ops — build, secrets, run (the production runbook facts)

*(Folded from the old `services/backend/DEPLOY.md`, corrected to the current modules —
that file is now a pointer here, pending owner approval for deletion.)*

- **Image:** built from the **repo root** context (workspace dep on `@suize/shared`) via
  `services/backend/Dockerfile`; `bun run push` (or `push:patch|minor|major`) builds
  linux/amd64 + pushes to `registry.example.com/your-org/suize-backend`. `bun run typecheck`
  must be clean first.
- **Secrets (SOPS — `~/deploy`, `secrets.example.yaml`, `env:` map →
  ONE `suize-secrets` Opaque Secret via `envFrom`):** `ENOKI_PRIVATE_API_KEY` (sponsor),
  `DEPLOY_WALLET_PRIVATE_KEY` (deploy service wallet — its OWN key, pays its own gas),
  `HANDLE_ISSUER_PRIVATE_KEY` + `SUINS_PARENT_NFT_ID` (handle, optional), `CF_API_TOKEN`
  (CF-for-SaaS custom hostnames, optional). **Separate keys per module — never reuse.**
  The old `TURNSTILE_SECRET` + Redis are GONE (the waitlist/api module was removed;
  handle issuance is fully on-chain — nothing here touches Redis).
- **Cluster:** `helmfile -f deploy.yaml sync`; secret-only rotations need a
  `kubectl rollout restart deployment/suize-backend -n suize`.
- **One hostname for everything:** the Cloudflare Tunnel routes `api.suize.io`
  (`facilitator.suize.io` is an alias) → `backend.internal:8080`.
  `GET /ws` (sponsor/execute + handle ops), `POST /mcp`, the `/deploy*` + `/domains*` +
  `/execute` HTTP surfaces, the facilitator (`POST /verify` + `POST /settle` +
  `GET /supported` + `POST /build` + `GET /terms` + `GET /tx` + `POST /checkout` — §7),
  and the health/readiness routes all live behind it — no separate sponsor host.
- **Verify after deploy:** `curl /health` → `ok`; `/ready` reports per-component;
  `/ready/serve` is the k8s readinessProbe target (§8).
- **Client wire contracts** live in `@suize/shared` (sponsor frames over the WS; deploy
  HTTP types) — never restated in a runbook.

---

### Open question for the owner — none

The old `account.move` allow-list question is **MOOT**: the rail moved to vanilla x402
V2 (a gasless `send_funds` needs no sponsor allow-list at all — the facilitator is
keyless), and the sponsor allow-list is now `[...CRASH, ...WALLET, ...(SUBS_PUBLISHED ?
SUBS : [])]` (§2). (The old §6 HTTP-only-refactor question stays CLOSED — LOCKED #14
keeps the WS.)
