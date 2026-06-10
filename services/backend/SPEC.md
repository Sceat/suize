# services/backend — SPEC (the off-chain rail surface)

> Scope: this file owns ONLY the off-chain rail — the one Bun service and its
> modules. The global picture (the two primitives, the four on-chain verbs, custody,
> network) lives in the root `CLAUDE.md`; the on-chain contract lives in
> `packages/move-wallet/SPEC.md`. This file references those, never redeclares them.
> Each fact is stated once.

The backend is **deterministic code, not an AI** — a scheduler + an executor + a
relayer. It builds sponsored transaction bytes and triggers terms-gated subscription
charges. It **NEVER signs an owner transaction**: the user's local zkLogin session
signs every owner verb (`spend`, `charge`, `create_subscription`, `withdraw`,
`create_account`). The backend's only keys are the **Enoki sponsor** (pays gas) and
its service wallets (deploy / handle issuer) — see "The number wall," below.

One Bun service, one port, one image, one deploy. Every module is a route matcher
`(req, url, origin, server) => Promise<Response> | null`; the first non-null wins
(`src/index.ts`). All config is env-only via `src/config.ts` (mirrored by
`.env.example`); secrets are env vars, never hardcoded, never bundled.

---

## 0. Status at a glance (BUILT vs STUB — honest)

| Module | Status |
|---|---|
| **mcp** (`src/mcp`) | **BUILT, bare.** `POST /mcp`, hand-rolled JSON-RPC 2.0 Streamable-HTTP. One no-auth tool `suize_ping`. NO auth, NO payment, NO Sui, NO session. The `suize_pay` / `suize_balance` / `suize_receipts` / `suize_deploy` tools are **NOT built**. |
| **deploy** (`src/deploy`) | **BUILT + PROVEN end-to-end** (2026-06-10 — it shipped our own landing to Walrus testnet: auth nonce → tar → quilt + manifest → on-chain `Site` → hash-verified serving). `deploy_sui` is published on testnet (real ids in `@suize/shared`). Custom-domain link/unlink built. The **$0.50 charge gate** (quote / charge / execute + on-chain digest verification + single-use reservation) is BUILT but **auto-bypassed (auth-only)** until `account` publishes (§4). Pays its own gas — NOT Enoki-sponsored. |
| **facilitator** (§7) | **DESIGNED 2026-06-10 (owner-validated), NOT built.** The payment architecture: the two-call merchant snippet + `POST /pay/build` / `POST /pay/submit` / `GET /verify/<paymentId>` + paymentId tracking. No endpoint exists in code; the deploy charge join (§4) is the reference implementation and becomes a special case under this umbrella when built. |
| **sponsor** (`src/sponsor`) | **BUILT, core only.** `createSponsor` / `executeSponsor` over Enoki, with the move-call allow-list + gas-drain ceilings. **Drift:** the allow-list is `CRASH + WALLET(legacy)`; it does **NOT yet include `ACCOUNT_MOVE_TARGETS`** (the v1 rail). Today it is invoked over the WS (see §6). |
| **handle** (`src/handle`) | **BUILT.** Fully on-chain SuiNS leaf-subname issuance (`<name>@suize`). Optional — 503 when SuiNS env unset. *Not load-bearing for the rail; the v1 core has no SuiNS dependency.* |
| **subscription relayer** | **STUB / not written.** The deterministic cron that triggers `charge_subscription` each period does not exist yet. This is the CHARGE-recurring engine — see §4. |
| **agent** (`src/agent`) | **STUB.** No-op. Reminder: the real backend is the scheduler + relayer, NOT an AI agent. Do not wire an inference loop here. |
| **transport** (`src/ws`) | **BUILT, LIVE + load-bearing.** Sponsor + handle run over the one Enoki-verified WebSocket (auth ONCE at connect via a signed personal-message nonce; `ws.data.address` is the session identity). The old "HTTP-only, delete `src/ws`" plan was **repudiated** — root `CLAUDE.md` LOCKED #14 (corrected 2026-06-10): two transports, one auth primitive (§6). |
| **readiness** | **BUILT.** `/health`, `/ready`, `/ready/{sponsor,handle,deploy,ws,serve}` — per-component, an unconfigured/down dep never 503s an unrelated surface. |

---

## 1. The rail, off-chain (how the four verbs are reached)

The on-chain verbs (`spend`, `charge`, `charge_subscription`, `pay`) are defined in
`packages/move-wallet/SPEC.md`. This service is how an agent or merchant reaches them
off-chain. **Fee policy is the rail's, not the Account's:** the three CHARGE verbs
(`charge` / `charge_subscription` / `pay`) each take a `&RailConfig` — Suize's one shared
fee-policy object (`default_fee_bps = 200` + a per-merchant `overrides` table, mutated
only via the `RailAdminCap`). Every CHARGE PTB this service builds MUST pass the
`RailConfig` shared-object id (`PACKAGE_IDS.ACCOUNT.RAIL_CONFIG`). The doors, one rail:

1. **The consumer PAY wallet app** (the PRIMARY payer surface, post-2026-06-09 pivot —
   root `CLAUDE.md` LOCKED #6) — pays TWO ways, custody law intact: **in-session** (the
   in-app zkLogin session **signs locally** per the confirm dial; the hosted backend
   builds sponsored bytes, the app signs, the backend relays/executes — **it never signs
   an owner tx**) and **autonomous-away via on-chain ALLOWANCES** — the existing on-chain
   `Subscription` object reused as a per-merchant allowance (payee + per-period cap
   enforced BY THE CHAIN, relayer-triggered §5, one-tap killable): autonomy with NO key
   delegation. Outside an allowance → push notification → one tap in-app. The wallet
   agent pays ONBOARDED merchants natively (no 402 round-trip needed).
2. **The local MCP** *(the developer / power-user door — CHARGE-side ONLY, DEPRECATED as
   the consumer path)* — an external assistant's (Claude/Codex) Suize MCP runs the
   local-zkLogin 402-client flow via its `suize_pay` tool, settling through the
   facilitator (§3, §7).
3. **The facilitator HTTP doors** (§7 — DESIGNED 2026-06-10, not built) — any external
   agent with no MCP: the **FACILITATOR door** (`POST /pay/build` → sign with its own
   key → `POST /pay/submit`), the **POWER door** (a Sui-native agent submits itself,
   `paymentId` in the memo), the **HUMAN door** (the 402's pay-link → confirm page →
   one tap).
4. **`llms.txt`** — a static discovery door (content LAW in root `CLAUDE.md`; the rail's
   own is not yet served — see §7; the landing ships a STALE pre-pivot draft at
   `suize.io/llms.txt`, flagged in `apps/landing/SPEC.md`).

A **merchant** integrates by dropping the TWO-CALL snippet (§7): answer HTTP **402**
with the Suize challenge, then one `GET /verify/<paymentId>` call on retry — zero
wallet/chain code merchant-side, no KYB, live in minutes. 402-shaped, **x402-compatible
by design** — we do NOT run x402 (Sui is not on the x402 network list); on this rail
**Suize itself is the facilitator: builds + sponsors + submits + verifies; the payer
only signs.**

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
- `ACCOUNT_MOVE_TARGETS` — the **v1 rail** (`create_account`, `deposit`, `spend`,
  `charge`, `create_subscription`, `charge_subscription`, `cancel_subscription`,
  `withdraw`, `pay`, PLUS the four `RailAdminCap`-gated fee-policy mutators
  `set_default_fee_bps` / `set_fee_recipient` / `set_merchant_rate` /
  `remove_merchant_rate`). **REQUIRED ADDITION:** the effective allow-list MUST become
  `[...CRASH, ...ACCOUNT]` once `account` publishes. Today it is `[...CRASH, ...WALLET]`
  — that is drift to fix when the rail goes live. The CHARGE verbs (`charge` /
  `charge_subscription` / `pay`) each take a `config: &RailConfig` arg now — the shared
  fee-policy object (`PACKAGE_IDS.ACCOUNT.RAIL_CONFIG`, `0x0` until publish); the rate +
  recipient are read from it, never from an Account. See `packages/move-wallet/SPEC.md`.

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

**Relation to the facilitator (§7 — DESIGNED, not built):** the FACILITATOR door is this
same core reached over HTTP — `/pay/build` = `createSponsor` with the rail's
`charge`/`pay` targets (the `ACCOUNT_MOVE_TARGETS` addition above) and the `paymentId`
bound into the memo; `/pay/submit` = `executeSponsor` + finality + paymentId settlement.
One sponsor core, two callers.

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

- **`suize_pay`** — the 402 client. Given a merchant 402 challenge (or a
  pay-link/amount): read the amount + payee + `paymentId`, **check the confirm-policy
  dial** (§3.1), **sign with the LOCAL zkLogin session**, settle **via the facilitator**
  (§7: `POST /pay/build` → local sign → `POST /pay/submit`). Zero payment code for the
  agent author. Receipt (with the visible 2% fee) returned as tool output.
- **`suize_balance`** — the funded Account balance (= the hard cap), read direct-to-chain.
- **`suize_receipts`** — the caller's receipt events (fee visible), read direct-to-chain.
- **`suize_deploy`** — wraps the deploy flow (§4 / `apps/deploy/SPEC.md`): tar the
  built site, sign the deploy nonce locally, POST `/deploy`, return the live URL +
  digest. The Deploy charge ($0.50 one-off) settles on the same rail.

All tools **sign locally** — the hosted backend builds sponsored bytes and
relays/executes, never signs. Auth into the MCP = Google (local zkLogin); there is NO
remote OAuth broker and NO `set_agent`.

### 3.1 Confirm-policy dials (client-side, in the MCP — NOT a backend gate)

The spending leash has two layers: on-chain physics (balance = hard cap; withdraw/kill
instant; subscription terms = recurring leash) — owned by the contract — and the
**client-side policy dials** the MCP enforces before signing: `confirm-each` (default —
co-pilot), `auto-under-$X`, `full-auto`, `confirm-new-subscription`. **Subscriptions,
once approved, renew silently** (exempt from the dial — keeps the Deploy renewal alive).
These dials live in the MCP/Wallet, never on-chain; they gate whether the local session
signs, nothing more. Marketing: *"autonomy you switch on."*

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

### 3.3 The external (non-MCP) payer — the POWER door: call `pay()`, the chain verifies

An agent on **any** Sui wallet (a competitor's, a raw keypair) pays a Suize merchant with
**no Suize account and no MCP**: the merchant's 402 (x402-shaped) names the settlement =
*call `pay(merchant, coin, memo)` on the rail package*. The agent builds that PTB,
**signs with its own wallet, submits** — `paymentId` in the memo (§7). Suize **verifies
nothing** — Sui validators verify the signature; the Move `pay()` enforces the 2 % split
atomically and emits the `Paid` receipt; Suize merely indexes that receipt so the
merchant's one `GET /verify/<paymentId>` call answers "paid". The fee can't be routed
around: a raw transfer produces no receipt → `/verify` stays false → the merchant
re-serves the 402. The **pay-link** (the HUMAN door) is just the hosted UX wrapper of
this for callers that can't auto-build a Sui tx. 402-shaped, x402-compatible by design.

---

## 4. deploy — the first merchant on the rail (BUILT; chain-gated)

`src/deploy/index.ts`. The Deploy merchant orchestration. Detail + the new billing
model (each deploy = a one-off $0.50 `charge`; the $19.99/mo subscription unlocks
custom domains + auto-renewed Walrus storage) lives in `apps/deploy/SPEC.md` — not
redeclared here. What this service owns:

- `POST /deploy` (multipart `name`, `site.tar`, `nonce`, `signature`) — **always
  authenticated**, no anonymous deploy. The deployer signs a single-use server nonce
  (`buildDeployAuthMessage`); the on-chain `owner` is the **cryptographically-recovered
  signer** (`verifyPersonalMessageSignature` — zkLogin OR Ed25519), never a client field.
  Flow: unpack tar (caps: 100 MiB, 2000 files) → Walrus quilt + manifest blob → mint a
  fresh immutable shared `Site` (signed by the deploy service wallet, pays its own gas)
  → `{ siteId, subdomain: base36(siteId), url, version, digest }`.
- `GET /sites[?owner=]`, `GET /sites/:id` — read from `SiteCreated` events + the Site
  object.
- `POST /domains` (issue challenge / `?verify=1`), `DELETE /domains/:domain`,
  `GET /auth/nonce` — custom-domain link/unlink behind a two-record DNS gate (TXT
  ownership + CNAME routing) AND a cryptographic site-owner signature
  (`buildDeployLink/UnlinkAuthMessage`, op-bound, nonce-fresh, single-use). Optional
  Cloudflare-for-SaaS auto-SSL; manual-CNAME fallback otherwise.

**Gates:** 503 "deploy not configured" when `DEPLOY_WALLET_PRIVATE_KEY` is unset; 503
while on-chain ids are `0x0` placeholders (on testnet the `deploy_sui` ids are REAL —
published at `0xadcc8d…`). Per-IP token bucket + a global daily deploy ceiling (each
deploy spends real SUI).

**PROVEN end-to-end (2026-06-10):** this module shipped our own landing — auth nonce →
tar → Walrus quilt + manifest → on-chain `create_site` → served hash-verified by the
worker (Site `0xc96dd162…47b9d0c`, 30 epochs, `*.suize.site`). The $0.50 charge gate
ran **bypassed (auth-only)** — `chargeGateReady()` stays false until `account` publishes.

> **Account-publish sequencing (the rail's `0x0`→live flip).** Publishing the `account`
> package runs `init`, which creates + shares the one `RailConfig` (`default_fee_bps =
> 200`, `fee_recipient = publisher`) and sends the `RailAdminCap` to the publisher. The
> publish step MUST: (1) set `PACKAGE_IDS.ACCOUNT.PACKAGE` to the new package id; (2)
> **capture the shared `RailConfig` object id from the publish/`init` effects into
> `PACKAGE_IDS.ACCOUNT.RAIL_CONFIG`** (without it `RAIL_CONFIG_SET` stays false and every
> CHARGE 503s — the PTB needs the `&RailConfig` arg); (3) pin `SUIZE_TREASURY` and run
> the admin `set_fee_recipient(cap, config, SUIZE_TREASURY)` so the 2% lands in the real
> treasury, not the publisher's address. Per-merchant discounts are later `set_merchant_rate`
> writes. All in `@suize/shared` (single source of truth) — no app/service hardcodes them.

> **URL DOMAIN — RESOLVED (L3, verified 2026-06-10).** Worker, backend
> (`config.deployBaseDomain`), and `@suize/shared` all standardize served-site URLs on
> `<base36(siteId)>.suize.site`.

The deploy charge ($0.50 one-off, $19.99/mo renewal) settles via the rail (`charge` /
`charge_subscription`) — that wiring is the merchant integration, owned by
`apps/deploy/SPEC.md`, not yet connected to this deploy flow. The `charge` PTB
(`src/deploy/charge.ts`) passes the shared `RailConfig` object as its `config` arg
(right after the account, before the merchant) — the fee rate is resolved from it
on-chain. The CHARGE↔Deploy gate (`chargeGateReady`) is therefore three-way: it requires
`ACCOUNT_PUBLISHED` **and** `RAIL_CONFIG_SET` (the `RailConfig` id is captured, no longer
`0x0`) **and** `DEPLOY_MERCHANT_SET` — without the `RailConfig` id the PTB cannot be built.

This quote/charge/execute join is the **reference implementation** of the facilitator
lifecycle (§7) — Deploy is merchant AND facilitator in one process (the charge terms are
known server-side); when the §7 endpoints are built, this flow becomes a special case
under that umbrella.

---

## 5. The subscription relayer (STUB — the CHARGE-recurring engine)

**Not written.** The deterministic cron that drives recurring CHARGE. It is the ONLY
reason the on-chain Account is a shared object: the relayer must deduct subscriptions
without the owner signing.

Contract when built:
- Periodically scan owner-approved `Subscription` children and call the permissionless
  `charge_subscription(account, config, sub_id, amount, clock)` once the period has
  elapsed — passing the shared `RailConfig` (`PACKAGE_IDS.ACCOUNT.RAIL_CONFIG`) as
  `config`; the per-payee fee rate is resolved from it on-chain.
- **It is terms-gated, not trusted.** The on-chain leash (fixed payee + per-period cap +
  `Clock`) is what bounds it; the relayer only *triggers* — it emits **no number** that
  lands in a tx beyond `sub_id`. The 2% is split inline on-chain.
- Deterministic code, NOT an AI. No inference, no signals, no discretion.
- Graceful insufficient-balance handling → a "top up to keep your subscription alive"
  signal, never a silent failure. (Surfaced by the Wallet — `apps/wallet/SPEC.md`.)
- The same permissionless trigger powers the Wallet's **autonomous-away allowances**
  (the `Subscription` object reused as a per-merchant allowance — root `CLAUDE.md`,
  the integration surface); `GET /verify/<paymentId>` (§7) reports each settled period
  paid.

See `packages/move-wallet/SPEC.md` for the on-chain `charge_subscription` terms and
abort codes (`ETooEarly`, `EOverPeriodCap`, `ESubscriptionNotFound`).

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
- **The deploy/merchant surface is HTTP by necessity** (agents speak 402-shaped HTTP):
  per-request signed-nonce auth (`verifyDeployRequester` →
  `verifyPersonalMessageSignature` → recovered address is the trusted subject,
  single-use nonce, burn on use).
- **One auth primitive, two transports:** both verify signatures through the same
  recover-and-pin pattern — the verified address is the subject, never a body field;
  single-use nonces; per-address rate limiting. Reads go direct-to-chain; nothing is
  server-pushed beyond the sponsor/handle frames.

If a shared `src/auth.ts` helper is ever lifted out (deploy + ws both implement the
pattern today), that is a refactor of duplication, NOT a transport change.

---

## 7. FACILITATOR — the snippet contract + the three pay doors + the merchant tier ladder (DESIGNED 2026-06-10, NOT built)

The owner-validated payment architecture (2026-06-10). **Status: DESIGNED, not built** —
no endpoint below exists in code yet. The deploy charge join (§4 — quote / charge /
execute + on-chain digest verification + single-use reservation) is the **reference
implementation**: Deploy is merchant and facilitator in one process; when this section
is built, that flow becomes a special case under this umbrella. The one-screen summary
lives in the root `CLAUDE.md` ("The integration surface") — this section owns the
precise contracts.

### 7.1 The merchant snippet — exactly TWO HTTP things

Zero wallet/chain code merchant-side — this is what makes "one line, live in minutes"
literally true. The snippet:

(a) answers HTTP **402** with the challenge:

```json
{
  "amount": "<USDC amount>",
  "currency": "USDC",
  "payTo": "<merchant Sui address>",
  "paymentId": "<single-use id>",
  "facilitator": "https://api.suize.io",
  "payLink": "<Suize-hosted confirm-page URL for this paymentId>"
}
```

(b) on a retry carrying the **`X-Suize-Payment: <paymentId>`** request header, calls
`GET /verify/<paymentId>` on the facilitator and serves the resource when `paid` is
true.

The 402 contract is defined HERE so the snippet/SDK (not yet built as a published
package), the MCP's `suize_pay` (§3), and the PAY wallet all agree on one shape.

### 7.2 The three pay doors (one rail, ground truth = the receipt event)

All three settle through the on-chain verbs (`pay` / `charge` — root `CLAUDE.md`, never
redeclared here). **Ground truth is the on-chain receipt event** (fee visible);
`/verify` is the merchant's one-call check. Trust-minimized upgrade: a merchant can
audit the receipt event itself via RPC — Suize's `/verify` answer is checkable, not
trusted.

- **FACILITATOR door** — any agent, no gas, no Sui knowledge:
  1. `POST /pay/build` `{ paymentId, sender }` → Suize returns a **fully-built,
     gas-sponsored** transaction (`{ bytes, digest }`). Under the hood this is the §2
     sponsor core (`createSponsor`) reached over HTTP, with the rail's `charge`/`pay`
     targets on the allow-list (the §2 drift note applies) and the `paymentId` bound
     into the memo.
  2. The agent signs the bytes **with its OWN key** and returns the signature:
     `POST /pay/submit` `{ digest, signature }` → Suize submits on-chain
     (`executeSponsor`), **awaits finality**, marks the paymentId **settled**, returns
     the receipt digest. The agent never constructs a Sui tx and never needs gas.
- **POWER door** — a Sui-native agent submits the payment itself (own wallet, own gas),
  `paymentId` in the memo; Suize indexes the receipt event for `/verify` (§3.3).
- **HUMAN door** — the 402's `payLink` → the Suize-hosted confirm page → one tap →
  the permissionless `pay()` (no Suize Account needed).

### 7.3 `GET /verify/<paymentId>`

```json
{ "paid": true, "receiptDigest": "<tx digest>" }
```

(`paid: false`, `receiptDigest: null` until settled.) **Subscriptions ride the same
contract:** the first approval creates the on-chain `Subscription` (fixed payee +
per-period cap); the relayer (§5) triggers renewals permissionlessly; `/verify` reports
each period paid.

### 7.4 paymentId lifecycle — single-use, idempotent

`issued → built → submitted → settled | expired`

- **issued** — the snippet mints the single-use id into the 402 challenge.
- **built** — `/pay/build` produced sponsored bytes for a `sender` (re-callable; a
  rebuild supersedes prior bytes).
- **submitted** — `/pay/submit` accepted a signature; submission in flight.
- **settled** — finality reached, the receipt event indexed, `/verify` flips to `paid`.
  A settled paymentId can NEVER settle again — one settlement per id, the same
  single-use discipline as the deploy charge gate's reservation (§4).
- **expired** — TTL elapsed before settlement; the snippet re-serves a fresh challenge.

`/pay/submit` is idempotent on the same `{ digest, signature }` — a retry returns the
same result, never a double charge.

> **RESOLVED (owner-validated 2026-06-10, the keyless decision):** **the payer
> ECHOES the challenge terms** — `/pay/build { paymentId, sender, payTo, amount }`.
> The facilitator builds exactly what was asked (trustless plumbing, no merchant
> secret needed); the MERCHANT is the verifier of terms via
> `/verify?paymentId&payTo&amount` against its OWN configured price — a payer that
> echoes wrong terms just produces a payment that fails the merchant's check. The
> signed-token alternative is retired. (The deploy reference implementation already
> sidesteps this: merchant = facilitator, terms known server-side.)

### 7.5 The other merchant doors (unchanged)

- **`llms.txt`** — a static discovery door advertising the rail to non-MCP agents.
  **Not yet served.** Content LAW in root `CLAUDE.md`: one per product,
  final-production framing, no internals/testnet/status talk.
- **OpenAPI** — the deploy/merchant HTTP surfaces (§4) double as the OpenAPI door for
  non-MCP callers (not yet published as a spec document).

### 7.6 Merchant on-ramps — the tier ladder (DESIGNED 2026-06-10, owner-validated, NOT built)

Four merchant on-ramps, ordered by merchant stack (highest-level first). **All four
land on the SAME facilitator + rail + receipt — the tiers only change WHO WRITES THE
402.** Every tier mints a `paymentId` into the §7.4 lifecycle; in tiers 1/2 the
facilitator itself mints it with the terms known server-side (the link/session is
created WITH `amount`/`payTo`), so the §7.4 open detail bites only Tier 3.

- **TIER 1 — PAY-LINKS (no code).** A dashboard-created hosted payment link
  (`pay.suize.io/<linkId>`) the merchant pastes anywhere — a hosted store, an email,
  an `llms.txt`. The hosted confirm page is **MACHINE-READABLE** (structured payment
  terms, not just a button), so an agent landing on it extracts the terms and settles
  through the FACILITATOR door (§7.2) without a human; a human taps as in the HUMAN
  door. Settlement notice = the webhook or the dashboard.
- **TIER 2 — CHECKOUT SESSIONS (one API call, any language). KEYLESS** (owner
  decision 2026-06-10 — "do we really need an API key?" → NO): the merchant's
  **address IS the account**; the money lands on-chain at `payTo`, not in a database
  we guard, so creating a session needs no permission (a session paying you is a
  favor; a scammer's session paying himself is just a payment link):

  ```
  POST /checkout  { payTo, amount, memo, webhook? }   NO auth — no signup
  → { sessionUrl, paymentId, webhookSecret? }         a hosted pay.suize.io session
  ```

  The merchant redirects the buyer (agent or human) to `sessionUrl`; settlement =
  the per-session-secret-signed webhook (if declared) or polling
  `/verify?paymentId&payTo&amount` against the merchant's OWN configured terms.
  Anti-abuse = IP/volume rate limits, not identity.
- **TIER 3 — THE 402 MIDDLEWARE (one line, agent-native).** The snippet contract of
  §7.1 — answer the 402 challenge, `/verify` on retry. Already fully specified above;
  it is simply Tier 3 of this ladder: the door for merchants who own their HTTP
  surface and serve agents directly.
- **TIER 4 — PLATFORM GATEWAY PLUGINS (ROADMAP).** Gateway plugins for hosted
  commerce platforms, configured with the merchant's `payTo` address (Tier 2 under
  the hood — keyless). Per the standards-only law (root `CLAUDE.md`): **NO platform
  names in public copy until a plugin ships** — internal note only:
  WooCommerce/Wix/BigCommerce are the open-gateway candidates; Shopify is gated
  (crypto-app program + rev-share).

**No API key required — the address is the account** (owner decision 2026-06-10).
Tiers 2/3/4 are fully permissionless: identity = `payTo`; verification = the
merchant checking `/verify` against its OWN terms; webhook auth = a per-session
secret returned at creation. An OPTIONAL dashboard account (sign-in, not an API
key requirement) exists only for comforts: managing Tier-1 pay-links, payment
history UI, higher rate limits. This also resolves the §7.4 open `/pay/build`
terms question WITHOUT a merchant secret: **the payer echoes the 402's terms**
(`payTo`, `amount`, `paymentId`) to `/pay/build`; the facilitator builds exactly
what was asked; the MERCHANT is the verifier of terms via `/verify` — a payer
that echoes wrong terms simply produces a payment that fails the merchant's own
check. The facilitator stays trustless plumbing. (The signed-token alternative is
RETIRED.)

**Webhooks — a designed facilitator surface.** Settlement events
(`{ paymentId, amount, receiptDigest }`), signed with the per-session
`webhookSecret` — serving tiers 1/2/4 the way `/verify` serves Tier 3 (push vs
poll; ground truth stays the on-chain receipt event, §7.2). The event mirrors the
payment-event shape a merchant's fulfillment code already handles from Stripe —
Suize **COEXISTS** with Stripe ("keep Stripe for humans, add Suize for agents");
never claim integration INTO Stripe.

---

## 8. Readiness + boot (BUILT)

`src/index.ts`. Boot fails fast if `ENOKI_PRIVATE_API_KEY` is missing. Warns if
`ALLOWED_ORIGINS` is empty (browser origins gate CORS + — today — the WS upgrade).

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
  emits a number that lands in a transaction. The relayer passes only `sub_id`; the
  on-chain terms supply the amount.
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
- **One hostname for everything:** the Cloudflare Tunnel routes `api.suize.io` →
  `backend.internal:8080`. `GET /ws` (sponsor/execute + handle ops),
  `POST /mcp`, the `/deploy*` + `/domains*` + `/execute` HTTP surfaces, and the
  health/readiness routes all live behind it — no separate sponsor host.
- **Verify after deploy:** `curl /health` → `ok`; `/ready` reports per-component;
  `/ready/serve` is the k8s readinessProbe target (§8).
- **Client wire contracts** live in `@suize/shared` (sponsor frames over the WS; deploy
  HTTP types) — never restated in a runbook.

---

### Open question for the owner

The §2 allow-list swap to `[...CRASH, ...ACCOUNT]` is a real code change the rail needs
but that isn't done. **Cut it now (pre-publish, against the `0x0` account package), or
when `account` publishes to mainnet so the allow-list and the live `charge`/`pay`
targets land together?** (The old §6 HTTP-only-refactor question is CLOSED — LOCKED #14
keeps the WS.)
