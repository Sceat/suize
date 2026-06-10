# Suize Wallet — SPEC (`apps/wallet`, `@suize/wallet`)

> The consumer wallet app — the **PAY face** of Suize. **Per the 2026-06-09 OWNER PIVOT this is a self-contained conversational consumer AI wallet** (the human talks to it; it remembers them, acts across services, and pays non-custodially) — NOT a local MCP plugged into someone else's Claude/ChatGPT. This SPEC owns ONLY this app: how a human funds an Account, holds the policy dials, kills it, reads the verifiable trace, and (roadmap) converses with the AI that acts on their behalf. The rail itself (the four on-chain verbs, the 2% fee, abort codes) lives in `packages/move-wallet/SPEC.md`; the off-chain surface (sponsor, handle, relayer) in `services/backend/SPEC.md`; the global picture + rail standard in the root `CLAUDE.md`. **State each fact once; reference, never redeclare.** Brand voice + calibrated honesty are LAW — every reassurance here is literally true.

---

## 1. What this app is

`wallet.suize.io` IS the wallet — a **self-contained conversational consumer AI wallet** and **a consumer of the one payment rail**. Per the 2026-06-09 pivot the human talks to it directly: it remembers them (**MemWal**, a Walrus memory layer), acts across many services (books flights, renews subscriptions, orders food), and **pays from here non-custodially** — the agent the human deals with IS this app, not an external MCP-hosted one. It is still the **human's control plane** (fund the allowance, set the leash, watch what was done, kill it) — the pivot adds the conversational + acting layer on top of that control plane, it does not remove it.

Five jobs:

1. **Converse + act** *(ROADMAP — the demo ships one narrow real flow by June 21)* — the human talks to the wallet; it chooses a service and acts, powered by Claude (**Haiku** free / **Sonnet** on the paid subscription — INTERNAL model names; consumer copy says only **"a smarter AI"**, never a model — root `CLAUDE.md` consumer-vocabulary laws). An **"Agent-enabled" toggle** arms autonomous action; off, it stays a control plane.
2. **Fund** — deposit the human's USDC into the shared `Account<USDC>` (the deposit IS the hard cap).
3. **Dial** — hold the client-side confirm policy (confirm-each / auto-under-$X / full-auto / confirm-new-subscription).
4. **Kill** — withdraw to zero and/or cancel a subscription, on-chain, instant.
5. **Trace** — render every Account event as a checkable on-chain receipt (the Walrus action-log is the phase-2 extension; **MemWal** rides the same Walrus seam).

You arrive already meaning to sign in: returning users with a live session restore silently; first-time / expired visitors see a single "Continue with Google" hero (`PaySignIn`) → the signed-in deck (`PayDeck`).

**The number wall holds:** the AI may narrate, remember, and *choose* a service, but **never emits a number that lands in a tx** — every on-chain amount/fee/size comes from the deterministic builders + the user's confirm dial (see root `CLAUDE.md` #5). **This app never signs an owner tx on a server** — the user's own in-app zkLogin session signs **locally**. It builds PTBs, gets gas sponsored, reads chain — and (roadmap) drives the conversational layer client-side.

---

## 2. The mental model — two pots, one timeline

The whole UI is **two cards + a verifiable timeline** (`PayDeck`):

| Card | Label | Source | Who can move it |
|---|---|---|---|
| **Your money** | "In your wallet" | the owner's wallet USDC balance (`getBalance`) | only the user |
| **Agent money** | "Ready to spend" | the shared `Account<USDC>` balance (`balance_value` devInspect) | owner-signed `spend`/`withdraw`; permissionless-but-terms-gated `charge_subscription` |

The masthead shows the grand total ("Everything together"). The funding action ("Top up agent") moves Your money → Agent money. Copy is locked: *"The money only you can move. Top up your agent to let it pay."* / *"Spend it freely — the full amount lands with the payee, no fee."* (PAY is free; only the CHARGE path takes the 2% — see the rail SPEC).

Two pots is the entire custody story made visible: the human's own USDC is never touched; the funded Account balance is the agent's allowance, and that balance is the hard cap. **Consumer vocabulary (LAW — root `CLAUDE.md`):** in rendered copy the funded Account is a **"sub-account"** — never "leash"/"pot" user-facing ("two pots"/"the leash" stay internal concept terms), and no tech jargon (MemWal / model names / zkLogin / Walrus) ever reaches the UI.

---

## 3. Onboarding

The first-run flow (`OnboardingShell`, beats `hello → name → setup`):

1. **hello** — the welcome reveal.
2. **name** — pick `<name>@suize` (debounced availability). Issued via SuiNS leaf subnames + Enoki Identity Subnames (async `PENDING→ACTIVE`; don't block on it — advance and let it resolve). Handle resolution + issuance detail lives in `services/backend/SPEC.md`.
3. **setup** — the calm Loader runs the real handle claim (`StepSettingUp`), then hands to the deck.

The `strategy` beat (Safe/Risky cards) is **dead legacy** — it belongs to the retired cage product and is only reachable via `?preview=strategy`; the real flow skips name → setup directly. It must be removed when the PAY rewrite lands (it maps to "which mandate is minted," which no longer exists).

> **Architecture note (the locked truth, post-2026-06-09 pivot):** this app IS the wallet the human talks to and pays from — onboarding is **open the app → sign in with Google (zkLogin) → talk to your AI wallet**. The in-app zkLogin session runs Google/Enoki and **signs locally** — keys never leave the user's machine; the backend never signs owner txs. There is **no `set_agent`, no delegated agent key, no on-chain agent identity** — see the root `CLAUDE.md` custody section. The honest consumer line is *"open the Suize app → sign in with Google → talk to your AI wallet; keys never leave your machine."* The **local-MCP-into-an-external-agent is DEPRECATED for the consumer** (it may survive only as an optional developer / CHARGE-side integration — root `CLAUDE.md` LOCKED #6); any UI copy implying a "remote connector / no install" stays wrong.

---

## 4. Funding — the deposit IS the cap

"Top up agent" runs `deposit` (auto-creating the shared Account on first top-up via `ensureAccount`). The deposited balance is the agent's spend ceiling — monkey-simple, on-chain, unbreakable. There is no separate budget/scope/expiry object; the balance is the only hard cap. Anyone may `deposit` (the human, or a third party); only the owner may `spend`/`withdraw`.

---

## 5. The policy dials (client-side only)

The confirm policy is a **client-side dial**, NOT an on-chain control. The on-chain guarantee is simply "no owner signature → no spend"; the dial only decides whether the wallet (its in-app AI, when Agent-enabled) signs automatically or after a human tap:

- **Confirm each** — every ad-hoc payment surfaces a tap (the co-pilot default).
- **Auto under $X** — "leash until amount": auto-sign below the threshold, tap above it.
- **Full auto** — sign without a tap.
- **Subscriptions are EXEMPT** — approved once, they renew silently (a 3am Deploy renewal can't wait for a tap). New-subscription approval can itself be gated by a "confirm-new-subscription" dial.

Marketing law: **"autonomy you switch on,"** not "autonomous from second one." Confirm-each is the default.

> Post-pivot the dials live in THIS app (its in-app AI auto-signs under the dial when Agent-enabled); on the optional dev CHARGE-side an external agent's local MCP honors the same dial. The dial state is client-side preference, never an on-chain field — do not invent a `policy` field on the Account.

---

## 6. The kill path

There is **no on-chain `pause`** and nothing to "revoke" — the only signer is the owner, so there is no standing authority to switch off. Kill is two owner actions plus stopping the client:

- **Withdraw to zero** ("Take back") — `withdraw` returns a `Coin<USDC>` routed back to the owner in the same PTB; zeroing the balance zeroes the spendable cap.
- **Cancel a subscription** — `cancel_subscription` (owner-only) removes the recurring authorization; the per-row "Cancel" in the Subscriptions list.
- **Disarm the AI** — flip the **"Agent-enabled" toggle** off (or close the app): the wallet's in-app AI produces no more `spend` signatures. This is the consumer kill switch for ad-hoc autonomous spend, replacing the old "stop the local MCP" (which now applies only to an optional dev CHARGE-side MCP).

All on-chain kill actions are owner txs signed from the user's own zkLogin session (gas sponsored), independent of any backend cooperation.

---

## 7. Subscriptions (the recurring leash, read-side)

The Subscriptions list (`Subscriptions.tsx`) is reconstructed from events (`SubscriptionCreated` minus `SubscriptionCancelled`, advancing `lastChargedMs` on each `Charged`). Each row shows the merchant label, the per-period cap (Martian-Mono blue money), the cadence, and an **honest coverage line** — `floor(agentBalance / periodCap)` full periods, the WORST case (the cap is the most it could ever charge), warn-colored when it won't cover the next period. Per-row "Cancel" calls `cancelSubscription`.

The subscription's payee is FIXED at creation and can never be redirected; the terms (fixed payee + per-period cap + `Clock` time-gate) are the on-chain leash. Full term semantics + the permissionless relayer that triggers the charge → `packages/move-wallet/SPEC.md` + `services/backend/SPEC.md`.

Coverage must never silently lie: insufficient balance surfaces a "top up to keep it live" warning, never an optimistic guess and never a silent expiry.

---

## 8. The verifiable trace (the timeline — the centerpiece)

`ActivityTimeline.tsx` renders the `suize::account` event stream for THIS account, reverse-chronological, read **straight from chain** (`queryEvents`, filtered by `account_id`). One row per event:

| Event | Row | Flow |
|---|---|---|
| `AccountCreated` | "Agent wallet created · Non-custodial · your keys" | none |
| `Deposited` | "Topped up · Wallet → Agent money" | in (+) |
| `Withdrawn` | "Withdrew · Agent money → Wallet" | in (+) |
| `Spent` | "Paid · <payee · memo>" | out (−) |
| `Charged` | "Subscription charged · <payee>" | out (−) |
| `SubscriptionCreated` | "New subscription · <payee>" | none |
| `SubscriptionCancelled` | "Subscription cancelled" | none |

Each row carries its `txDigest` as a tappable **"verify ↗"** link to the explorer — *the receipt you can check, not a log you trust.* Money is always Martian-Mono **blue**; the +/− sign carries direction (green/red are reserved for true status only — `confirmed`/`failed`/`refund`, never decorative flow).

**The Walrus action-log (the moat wedge):** in v1 the `Spent`/`Charged` events carry **`decision_hash` + `walrus_blob_id`** fields, reserved on-chain from day one (empty in v1) so no schema migration is needed later. **Phase 2:** a per-action JSON record (tool called, inputs, reasoning summary, chosen action, alternatives, outcome, related tx digest) is stored on Walrus; `sha256(record)` is anchored as `decision_hash`; the timeline gets a "verify" affordance that re-fetches the blob, recomputes the hash, and checks it against chain → green "verified" / red "tampered." This Walrus user-owned trace is the Walrus-track wedge and part of the honest moat (execution + on-chain enforcement, NOT "gasless" or "standards" — those are commodity).

---

## 9. The data layer (the chain seam)

The PAY data layer is already written and verified, gated on publish:

- **`src/data/account.ts`** — PURE PTB builders + event readers for `suize::account` (`buildCreateAccount` / `buildDeposit` / `buildSpend` / `buildWithdraw` / `buildCreateSubscription` / `buildCancelSubscription`, plus `accountIdFromEvents` / `subKeyFromEvents`). The single source of truth for the Move SHAPES (targets, arg order, the `Account<USDC>` type arg, the `Clock` at `0x6`). Builders return a `@mysten/sui` `Transaction` — never bytes, never a network call.
- **`src/data/useAccount.ts`** — the hook every screen calls: `useAccount(ownerAddress?, handle?) → PayApi`. Reads (real, on-chain): wallet USDC, Account balance via `balance_value` devInspect, subscriptions + timeline reconstructed from events. Writes (sponsored PTBs): `ensureAccount` / `deposit` / `spend` / `withdraw` / `createSubscription` / `cancelSubscription`. The hook signature is STABLE.
- **`src/data/payTypes.ts`** — the PAY data shapes (`UsdcBalance` / `Subscription` / `Activity` / `PayState` / `PayApi`). Every figure is real on-chain truth or an honest empty/zero state — never fabricated.
- **`src/data/payStore.ts`** — per-owner localStorage cache of the shared-`Account` object id (a public on-chain id, not a secret), keyed `suize:account:<owner>`; a one-time `AccountCreated`-event recovery scan re-derives it if the cache is cold (shared objects have no cheap owner-index). The `string | null` get/set is a SEAM — swap the body for a backend call later, useAccount is unchanged.

**Account id recovery:** on a cold cache, `useAccount` scans the latest `AccountCreated` events for one whose `owner === ownerAddress` and caches it.

---

## 10. Transport — sponsored, owner-signed (the migration)

Every write is a **sponsored** PTB: build tx-KIND bytes → request sponsorship → **the user's zkLogin session signs the sponsored bytes verbatim** → execute. Gas is paid by the Enoki sponsor; the user pays nothing and signs everything that moves their funds. The backend never signs.

**Transport (corrected 2026-06-10 — root `CLAUDE.md` LOCKED #14):** the wallet's sponsor/handle transport IS the single Enoki-verified **WebSocket** — `requestSponsorship` / `executeSponsored` ride it (`src/data/suins.ts` + `src/data/ws.ts`, with `useAuth` Enoki zkLogin, `useIdentity` SuiNS handle, `useWsLifecycle`). The wallet signs a personal-message nonce ONCE at connect; the recovered address is the socket's identity. The old "drop the WS, go HTTP-only" plan was **repudiated** (#14: two transports, one auth primitive — the WS is alive and load-bearing; HTTP per-request signed-nonce is the deploy/merchant surface). Reads still go direct-to-chain. The transport boundary stays `runSponsored` in `useAccount` — if the architecture ever changes again, the swap is body-only; the PTB builders and the hook contract are untouched. Detail → `services/backend/SPEC.md`.

---

## 11. The publish gate (honest by construction)

`account.move` is **not yet published** (`PACKAGE_IDS.ACCOUNT.PACKAGE === '0x0'`, `SUIZE_TREASURY === '0x0'` in `@suize/shared`). `ACCOUNT_PUBLISHED` is the boolean the UI gates on:

- **Reads** run regardless — they resolve nothing → honest empty/zero states (never fabricated numbers).
- **Writes** throw a CALM, explicit error before publish (`guardWrite`), never a fake success: *"The Suize account contract is not live on testnet yet. Reading works; live payments turn on the moment account.move is published."*
- `PayDeck` shows a publish-gate banner saying exactly this; the actions are wired and ready.

When the package id + treasury are set in `@suize/shared`, every flow lights up with zero app changes. **Per the network frame, the rail goes MAINNET** (native USDC, Enoki paid tier) — populating `PACKAGE_IDS.ACCOUNT` is the v1 gate. The mainnet flip is a publish + a `@suize/shared` id/network change; nothing in this app hardcodes a package id, target, or network (single source of truth = `@suize/shared`).

> **DEV-only demo seam:** `?preview=home&demo=1` paints a populated deck (sample subs + timeline) for design capture; the whole branch is behind `import.meta.env.DEV` and tree-shaken from production. `?preview=<state>` renders any screen without real OAuth.

---

## 12. What this app does NOT do (anti-drift fence)

- **No server signing.** Owner txs are signed by the user's own zkLogin session, locally. The backend builds sponsored bytes and relays terms-gated subscription charges — it holds no spend-capable key.
- **No server-side AI in the signing path; the in-app AI never emits a tx number.** Post-2026-06-09 this app DOES host a conversational AI (Claude Haiku/Sonnet) that narrates, remembers (MemWal), and *chooses* a service — but the **number wall holds**: every on-chain amount/fee/size comes from the deterministic builders + the confirm dial, never from the LLM (root `CLAUDE.md` #5). The backend stays a deterministic scheduler/relayer with NO AI in it.
- **No on-chain agent identity / `set_agent` / delegated agent key / `agent@suize` name / SuiNS-gated spend.** Spend is owner-only (the in-app AI signs only via the user's own zkLogin session under the dial). Any such code is legacy and must be removed in the PAY rewrite.
- **No on-chain `pause` / budget / scope / payee-allow-list / expiry.** The deposit is the cap; kill = withdraw / cancel / disarm (Agent-enabled off — §6). (A user-opt-in "trusted merchants" whitelist is an OPTIONAL post-v1 convenience, not v1.)
- **No fabricated numbers.** Every figure is on-chain truth or an honest zero.

---

## 13. Custody copy (exact — never deviate)

The locked phrasing is **"fully non-custodial — your keys never leave your machine"** (NEVER "never holds funds" — Suize does hold the shared Account object; that is delegated-spend, not custody). The footnote on the deck is the canonical line:

> **Fully non-custodial.** Every payment is signed by your own login on your own machine — Suize never holds your keys or your funds, and never signs for you. Your money never leaves your wallet until you move it.

Honest caveat (carry it where relevant): in v1 there is no payee allow-list, so the funded balance is delegated-spend — bounded by the deposit (hard cap) + the verifiable log + one-tap kill. **Delegated-spend risk, not custody risk.**

---

## 14. Current status

- **PAY data layer (`account.ts` / `useAccount.ts` / `payTypes.ts` / `payStore.ts`):** written + verified against `account.move`, gated on `ACCOUNT_PUBLISHED`.
- **`PayDeck` / `ActivityTimeline` / `Subscriptions` / `PaySignIn`:** built in the locked broadsheet language; honest empty/zero/publish-gate states.
- **Reused from the legacy app:** `useAuth` (Enoki zkLogin), `useIdentity` + the SuiNS handle flow, `OnboardingShell`, the Loader/AmbientField/CustomCursor system, the providers stack.
- **Pending:** publish `account.move` + set `PACKAGE_IDS.ACCOUNT`/`SUIZE_TREASURY`; delete the dead `strategy` onboarding beat and any residual legacy mandate/vault wiring (`accountStore.ts`, `useHome.ts`); rewrite the stale `README.md` (it still describes the mock-data cage UI). (The WS→HTTP sponsor migration is OFF the list — the WS is the locked transport, `CLAUDE.md` #14.)

> Build status across the repo lives in the root `CLAUDE.md`; the rail contract + abort codes in `packages/move-wallet/SPEC.md`.
