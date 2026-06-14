# Suize Wallet — SPEC (`apps/wallet`, `@suize/wallet`)

> The consumer wallet app — the **PAY face** of Suize, **rebuilt + shipped 2026-06-10**, then **migrated off `account.move` onto the live x402 rail (2026-06-12)** (the old shared funded `Account` + its deposit/withdraw/spend verbs are GONE; there is no on-chain "sub-account" balance anymore). Per the 2026-06-09 OWNER PIVOT this is a self-contained conversational consumer AI wallet — the human talks to it, it remembers them, acts across services, and pays non-custodially. This SPEC owns ONLY this app. The live rail (gasless x402 V2 'exact' settlements + the standalone `subs` subscription module) and the global picture live in the root `CLAUDE.md`; `packages/move-subs/SPEC.md` owns the subscription contract; the off-chain surface (sponsor, handle, facilitator) in `services/backend/SPEC.md`. `account.move` / `packages/move-wallet` is **RETIRED** — never build on it. **State each fact once; reference, never redeclare.** Calibrated honesty is LAW — every reassurance here is literally true.

---

## 1. What this app is

`wallet.suize.io` IS the wallet — **money-first, chat-secondary** (owner law 2026-06-10): the balances, the live subscriptions list, and the verifiable activity ledger own the page; the conversational assistant is a resizable side panel, never the screen. Two faces of one app:

- **The personal face (`ui/WalletDeck.tsx`)** — the deck: the wallet balance + the funded-agent card, subscriptions, activity, the assistant column, the money sheets.
- **The business face (`ui/BusinessConsole.tsx`)** — one masthead tap away: a vertical-tab console (Overview / Revenue / Subscriptions) with the settled balance + the same money verbs, MRR/ARR, the charges ledger (the printed fee is the trust proof), and the analytics chat as a permanent column. **Honest by construction:** the merchant data feed does not exist yet, so production shows the real wallet USDC plus calm zeros/empty states — never fabricated revenue.

Five jobs (the conversational job is ROADMAP; the rest are SHIPPED):

1. **Converse + act** *(ROADMAP — the assistant UI ships honest: an empty thread, one "What can you do?" chip, and a truthful "I'm almost ready" reply; no fabricated history or actions in production).* The **Agent-enabled switch** lives in the assistant panel head.
2. **Fund the agent** — the agent's spend cap IS its OWN address balance (a separate zkLogin identity — §3). "Fund" is a plain gasless P2P `sendWallet` from the human's wallet to the agent address; fund more → bigger cap.
3. **Dial** — the confirm policy stays a client-side dial (root `CLAUDE.md` #8); no `policy` field on-chain.
4. **Kill** — the honest two-step (the wallet can't sweep a foreign zkLogin address — §10): stop funding the agent (you control the tap) + revoke at the source (the MCP `suize_kill` tool + Google's app-permissions page); plus per-row subscription "Cancel" (`subs::subscription::cancel`), the Agent-enabled switch off, and **Sign out** (the masthead identity menu → dapp-kit disconnect; autoConnect will not silently restore).
5. **Trace** — every subscription lifecycle event (`SubscriptionCreated`/`Renewed`/`Cancelled`) + sent payment rendered as a checkable row with a real explorer link (`SUIVISION_TX`). The Walrus action-log remains the phase-2 extension (root `CLAUDE.md` moat).

**The number wall holds** (root `CLAUDE.md` #5): the deterministic builders + the dial own every on-chain amount; no LLM emits a tx number. **No server signing** — the in-app zkLogin session signs locally.

---

## 2. The flow (`app/App.tsx`)

1. **HelloScreen** (`ui/Onboarding.tsx`) — the sign-in: the editorial welcome ("Meet the wallet you *talk* to."), ONE gesture — "Continue with Google" opens the Enoki OAuth **popup** (`window.open` → Google → same-origin `/enoki` → opener polls + closes it), so it MUST fire from this user click or the popup is blocked; returning users skip it (autoConnect → home).
2. **ClaimFlow** (`ui/Onboarding.tsx`) — first-timers only: pick `<name>@suize` (real debounced `checkHandleAvailable`), then the **setting-up manifest** runs the REAL two-leg claim (leaf-subname mint → user-signed reverse record → `setCachedHandle`) rendered as rows checking off under a filling hairline; any failure surfaces a calm retry (idempotent). StrictMode subtlety: the fired claim is **never cancelled** from effect cleanup (the fired-guard ref blocks the re-run, so a cancel would strand the mint; post-unmount setState is a React-18 no-op).
3. **Home** — the WalletDeck, with the BusinessConsole one tap away. Sign-out resets to Hello.
4. Failure/timeout → redirect to `suize.io`.

**DEV preview seam** (`import.meta.env.DEV`, tree-shaken): `?preview=hello|claim|home|business`, plus `&demo=1` to paint the sample books + the scripted SF assistant choreography. Every fabricated figure in the app lives behind this seam; the demo figures are pre-reconciled in `ui/copy.ts`.

---

## 3. The mental model — your money + a funded agent address

| Card | Label | Source | Verbs |
|---|---|---|---|
| **Your money** | "Your money" | wallet USDC (`getBalance`) | **Add funds** (receive) · **Send** (P2P) |
| **Agent (sub-account)** | "Sub-account" | the agent ADDRESS's USDC balance (`getBalance` on a SEPARATE zkLogin identity — `data/useAgent.ts`) | **Connect** (paste the agent's address) · **Fund** (a P2P `sendWallet` to it) |

There is **no on-chain shared `Account` anymore** (the `account.move` cage is retired — §6): the agent's spend cap IS its own address balance. The human FUNDS a separate address (the MCP/assistant session's address, pasted from `suize_balance`), and that balance is the hard ceiling — fund more raises it, the wallet cannot reach in. The **honest custody caveat (§10):** that address is a DIFFERENT Google `aud`, so the wallet **cannot sweep it back** — only the agent's own session can move its funds.

The masthead shows the **Total** at the right, beside the **identity menu** (`ui/Identity.tsx` — the handle ▾: copy address, Sign out; lives at the masthead's right on BOTH faces). The activity ledger is the **verifiable trace**: sent payments flow out (−), and subscription rows (created / renewed / cancelled) carry the period amount or, where nothing moved, **no signed amount**. Consumer-vocabulary law (root `CLAUDE.md`): "sub-account" everywhere — never "leash"/"pot"/"agent money" — and no tech jargon reaches the UI.

---

## 4. The money sheets (`ui/sheets.tsx`)

Shared by both faces; all are real modals (focus-trapped, `aria-modal`, Escape closes, focus returns to the opener):

- **Add funds** — the branded decorative QR (`SuizeQr` — NOT scannable; the copy row is the share surface), the copyable handle, the network warning (*"Send only USDC on Sui"*), and the coming-soon rails (Bank transfer / Apple Pay / Card). The **exact-amount request link is demo-gated** (`requestEnabled`) until its route ships — production never mints a link that leads nowhere. Request links are the WALLET surface (free gasless P2P `sendWallet`), never the merchant pay-link (the 2% CHARGE surface).
- **Send** — accepts ANY SuiNS name form, all resolved the same on submit (owner law 2026-06-13): `name@suize` (a Suize handle = `name.suize.sui`), the SuiNS `@name` form (= `name.sui`), `name.sui`, and subnames `x.y.sui`. The ONE normalizer is `normalizeSuiName` in `data/suins.ts` (shared by the Send sheet's `detectRecipient` and `resolveRecipient` — single source of truth; a dotted-parent `a@b.tld` is an email, not a name). Also full 64-hex addresses, and emails/phones (detected, marked coming-soon; the claim-link path is demo-gated). The pre-submit tick says "looks right" (resolution is on submit). No memo field. Executes `sendWallet` (a gasless single-output x402 `send_funds`). "Max" **floors to cents** so sub-cent dust can never overdraw the tx.
- **Fund the agent** — amount + quick chips + Max; a plain `sendWallet` to the connected agent address (its balance becomes the cap); async with a calm in-sheet error line.

Write failures everywhere surface calmly in place (sheets inline; subscription-cancel failures under the list) — never a silent dead click.

---

## 5. Subscriptions (read-side, push-not-pull) + the coverage law

`ui/money.tsx` `SubsList` renders the live subscriptions (the live `Subscription<USDC>` objects + their events — see §6) with the per-period amount and a renews line. Subscriptions are **push-not-pull** (`packages/move-subs`): the user signs each renewal themselves, nobody reaches into their funds, and cancel = delete the object on-chain. The wallet **silently renews on open** (the in-app loop pushes a due period via `subs::subscription::renew`); when the wallet is closed, a reminder. **Coverage must never silently lie:** when the wallet USDC can't cover a subscription's next period, the row says **"won't renew — top up"** in true-status red. Per-row Cancel calls `cancelSubscription` (pending state `'cancel'`).

---

## 6. The data layer (`data/` — the chain seam)

- **`subs.ts`** — pure PTB builders + object/event reads for the STANDALONE `subs::subscription` module (the SINGLE source of the subscription Move shapes: `create`/`renew`/`cancel`, the `Subscription<USDC>` type arg, the shared `SubsConfig`, the Clock; push-not-pull — each period's `Balance<USDC>` is pushed into create/renew via `tx.balance(...)`). Ids live ONLY in `@suize/shared`.
- **`useAccount.ts`** — the one hook (REWRITTEN onto the live rail, 2026-06-12): reads (wallet USDC + the subs lifecycle as the activity trace) + writes — **`sendWallet`** (a gasless single-output x402 Address-Balance `send_funds` of the user's own wallet USDC; the payer's OWN session signs; no fee) and **`cancelSubscription`** (`subs::subscription::cancel`, ridden over the WS sponsor). The shared funded-`Account` deposit/withdraw/spend verbs are GONE. The event feed is **paginated with caps** so a fixed window can't starve our rows under real module traffic.
- **`useAgent.ts`** — the agent-address store: read the saved agent address (per-owner localStorage) + its USDC balance (its hard cap), `setAddress`/`clearAddress`, and **`fund`** (a `sendWallet` to the agent address). No on-chain Account; the honest can't-sweep custody caveat lives in the copy (§10).
- **`useSubscriptions.ts`** — the live `Subscription<USDC>` object reads + the silent-renew loop driver.
- **`payTypes.ts`** — the stable `PayApi` contract (pending union includes `'send'` and `'cancel'`).
- **`payStore.ts`** — the per-owner agent-address cache + the approved-terms store (the silent-renew leash: the loop only auto-renews terms the user approved).
- **`coins.ts` / `grpc.ts` / `prices.ts`** — the USDC coin type/decimals, the gRPC client (the transport where gasless eligibility resolves), and USD pricing.
- **`useAuth.ts`** — Enoki zkLogin (`connect` = an OAuth **popup**, must fire from a user gesture) + **`signOut`** (dapp-kit disconnect). **`suins.ts` / `ws.ts` / `useIdentity.ts` / `useWsLifecycle.ts`** — the WS sponsor/handle transport per root `CLAUDE.md` #14. **The socket self-heals (2026-06-11):** a user action on a down socket kicks a fresh connect and waits briefly (`ensureConnected`) instead of instantly failing, and tab-focus / network-online kick a reconnect — a dropped socket (laptop sleep, transient server-side verify failure) can no longer strand the session on "not ready" until reload.

Transport: a gasless x402 write (`sendWallet`) builds its own gasless bytes and the session signs them; a sponsored write (a subscription `create`/`renew`/`cancel`, which mints/touches a persistent Party object → not fully gas-rebatable) builds KIND bytes → `requestSponsorship` → the zkLogin session signs the sponsored bytes verbatim → `executeSponsored`. The backend never signs owner txs.

**Optimistic-then-reconcile (`sendWallet`, 2026-06-13):** the gRPC execute node settles before the JSON-RPC read node (balance) and the indexer (the sent-tx feed) reflect a send — so the UI used to look frozen until a manual reload. Now `sendWallet` applies the send to the UI INSTANTLY (the amount drops from the displayed balance; a "confirming…" row, spinner, no verify link, prepends the activity), then reconciles against the chain and rolls back on failure. Honesty guards: the optimistic balance is `real − unreflected-outflow` where a send stops being subtracted the moment the refetched real balance has dropped to/below `snapshot − amount` (so it can NEVER double-count when the chain catches up); the pending row is replaced by the real row only once that digest appears in the real sent feed; a 30s TTL drops any entry that neither reconciles nor fails (falling back to authoritative chain state); a failed execute removes the entry (rollback). Background refresh still runs (`waitForTransaction` on the read node → bump, +2.5s bump for the indexer). The same path serves agent **`fund`** (it sends from your wallet).

---

## 6b. The SSO bridge (the wallet as the suite's identity origin — 2026-06-11)

The Enoki session lives on THIS origin only; other `*.suize.io` products consume
it through two wallet-hosted surfaces (protocol + security model:
`@suize/shared/bridge`; wire shapes there, POLICY here):

- **`/bridge`** (`bridge.html`, a SEPARATE vite entry → `src/bridge/main.tsx` +
  `BridgeHost.tsx`) — a hidden same-site iframe, ONE silent op: `getSession`
  (address or null). **NOTHING signs on the silent surface.** The host answers
  through a **settle gate**: the session restores ASYNCHRONOUSLY after the
  iframe mounts (Enoki registration → autoConnect → IndexedDB decrypt), so when
  dapp-kit's persisted connection marker says a session is expected, `getSession`
  is parked until the account materializes (6s deadline for the stale-marker
  case) — answering straight from `useCurrentAccount()` raced the restore and
  reported logged-in users as null, which silently broke suite-wide auto-login
  (fixed 2026-06-13). A second op
  `signAuthNonce` (sign the fixed backend-WS login message so another product
  could open its OWN authenticated WS with the shared session) is DESIGNED in
  `@suize/shared/bridge` but **deliberately NOT shipped** — it has no consumer
  (pay.suize.io uses the facilitator + the confirm popup, never a WS) and a
  zero-click signer is the one piece that turns an allowlisted-origin XSS into a
  full WS session as the victim. Re-add WITH a mitigation (one-time visible
  consent / audience-scoped nonce) when the first WS product lands. Gates: the
  exact-match origin allowlist (`src/bridge/origins.ts` — `pay.suize.io` +
  `deploy.suize.io` + `crash.suize.io`; NEVER a wildcard, NEVER `*.suize.site`)
  + a `frame-ancestors` CSP in `vercel.json` listing the same three (CSP is the
  ONLY frame control here — X-Frame-Options can't express the multi-origin
  embed; `/confirm` adds `XFO: DENY`); the PWA service worker denylists the path
  from its SPA fallback.
- **`/confirm`** (`src/bridge/ConfirmPay.tsx`, routed in `main.tsx`) — the
  visible MONEY popup: receives terms (origin + opener-pinned), then
  **builds-what-it-displays** (the gasless x402 `send_funds` payment built from the
  displayed terms → local sign → settled via the facilitator) and returns ONLY the
  digest. Signed-out: "Continue with Google" opens the Enoki OAuth popup; this
  window stays open and its session updates reactively on return (no redirect, no
  sessionStorage stash). `frame-ancestors 'none'` — it can never be iframed.
- **`/confirm-subscribe`** (`src/bridge/ConfirmSubscribe.tsx`) — the RECURRING money
  gate: a visible top-level popup other `*.suize.io` products open to set up (or
  cancel) a subscription. Mirrors `/confirm` (same origin-pinning + `ready` beacon +
  same popup sign-in) for the `SubscribeTerms` pair. **display = build:** it renders
  the terms (merchant / amount / periodMs / ref) and on approval builds the
  `subs::subscription::create` PTB ITSELF from those same terms (push-not-pull —
  period 1 paid inline). **Sponsored** (a Party-object mint is not fully
  gas-rebatable), so it runs the WS sign-once lifecycle and rides the sponsor path —
  the key still never leaves the machine. On success it records the APPROVED terms in
  `payStore` (the silent-renew leash) and posts the new `subKey` back.

**ONE consumer shape (live 2026-06-11):**
- **Identity + money popup (pay):** reads `getSession` for who-you-are, runs NO
  local login, signs money through `/confirm`. `apps/pay/src/bridge-client.ts`.
- **The auto-login bootstrap is REMOVED (owner decision 2026-06-13).** Deploy and
  crash briefly shipped a `useSsoAutoLogin` hook that, on load, asked the bridge
  `getSession` and silently triggered the app's own Google login. It died on
  platform reality: Enoki's `connect` is POPUP-based (`window.open` → OAuth →
  poll → close — NOT a full-page redirect), so the "silent" mint either gets
  popup-blocked (no user gesture on page load) or flashes a popup with Google's
  account chooser — never silent. Deploy/crash now use their plain local sign-in
  button (popup behind a real click). Do NOT reintroduce a load-time OAuth mint;
  if zero-click identity is ever wanted there, consume the bridge ADDRESS as
  read-only identity (pay's shape) and mint the local session lazily behind the
  first signing click.
- **Limitation (by construction):** identity propagates FROM the wallet origin
  (the bridge host). Logging into a leaf app first does not back-propagate to the
  wallet (cross-origin storage), so suite-wide SSO assumes the canonical login is
  the wallet (or pay's wallet-origin popup). Acceptable: the wallet is the home.

**`/agent-connect` — the MCP auth door (CHARGE-side / dev, NOT a consumer PAY path)**
(`src/bridge/AgentConnect.tsx`): an external assistant's Suize MCP signs in via a
**SECOND, DISTINCT Google zkLogin client** (`VITE_GOOGLE_AGENT_CLIENT_ID`) so the
agent's address is a different `aud` and **NEVER reuses the human wallet session** —
this is exactly why the wallet can't sweep the agent (§10). It then hands the MCP a
local session. **LOAD-BEARING FOREVER:** `VITE_GOOGLE_AGENT_CLIENT_ID` is a separate
pinned OAuth client id — once registered it can never be rotated (it is the agent
identity's zkLogin `aud`), exactly like the primary `client_id`. **STATUS — STUB:**
the second Enoki OAuth client is not yet registered, so `GOOGLE_AGENT_CLIENT_ID` is
empty in this build and the door is inert (`AGENT_ENABLED` false) until it is set.

The key never leaves this origin; no bridge surface exports key material or
signs arbitrary tx bytes. Consumers: `pay.suize.io` (identity + popup),
`deploy.suize.io` + `crash.suize.io` (identity + auto-login) — see
`services/backend/SPEC.md` §7.4. **Reviewed** (4-agent `/review` + a dedicated
web-security adversary, 2026-06-11): no exploitable finding against the hard
requirements (key isolation, display=build, money-needs-visible-UI,
non-allowlisted-origins-get-nothing — the last proven live with a hostile
origin). Hardened in the same pass: silent surface cut to `getSession` only
(above); the OAuth-resume stash re-asserts the allowlist on its stored
`openerOrigin` before posting any result; first-valid-terms guard + a 30 s
beacon deadline; the payer receipt shows ONLY the approved amount (never the
verify response's fee fields). Accepted residual (in the stated threat model):
an XSS'd allowlisted origin can *request* a payment via the popup — but the
human still sees and approves the amount, and the key never moves.

---

## 7. The publish gate (honest by construction)

The subscription module `subs::subscription` is **PUBLISHED on testnet** (`PACKAGE_IDS.SUBS` in `@suize/shared`; `SUBS_PUBLISHED` true there) — subscription create/renew/cancel are live. The gate logic remains for the **mainnet build** (the subs mainnet id stays `0x0` until the v1 publish): reads always run (honest zeros), subscription writes throw the calm consumer-safe message until published. `sendWallet` (a gasless x402 `send_funds`) is never subs-gated — it needs no module. `account.move` is RETIRED and the wallet no longer touches it. Network/ids live ONLY in `@suize/shared`.

---

## 8. The design system (`ui/rd.css` + `ui/copy.ts`)

- Scoped under `.rd`; token values are the landing's locked family spec (light broadsheet default · lifted dark · the corporate business room via `data-rd-room`). The `.rd-amb` ambient field + grain give the glass its contrast. Theme glyphs are borderless (owner law).
- **Every user-facing word lives in `ui/copy.ts`** (the copy law) — production strings + the reconciled demo figures, one file.
- Tailwind is **removed** (2026-06-11; zero utilities were used) — `system/tokens.css` opens with the small base reset that replaces preflight, and still carries the Loader styles + the promoted globals (the Hashgraph `@font-face`, the `.j-cursor-*` cursor layers).

---

## 9. What this app does NOT do (anti-drift fence)

- **No server signing; no server-side AI in the signing path** (root `CLAUDE.md` #5). The assistant UI never fabricates: production threads start empty and reply honestly until the conversational layer ships.
- **No on-chain agent identity / `set_agent` / pause / budget / scope / allow-list / expiry, and no shared funded `Account`** — the agent address's own balance is the cap; kill = stop funding + revoke at the source / cancel subscriptions / switch off / sign out.
- **No fabricated numbers.** Demo data exists only behind the DEV `?demo=1` seam.
- **No request/claim links in production** until their routes exist (Soon-gated).

---

## 10. Custody copy (exact — never deviate)

The verbatim law (root `CLAUDE.md`): **"fully non-custodial — your keys never leave your machine."** The deck footnote (rendered from `copy.ts` `custodyLead`/`custodyTail`):

> **Fully non-custodial** — your keys never leave your machine. Every payment is signed by your own login; Suize never signs for you.

The custody phrase is VERBATIM and never deviates. **The honest agent caveat (the new model):** the agent's funds live on a SEPARATE zkLogin identity (a different Google `aud`, connected via `/agent-connect` — §6b), so **the wallet cannot sweep them back** — only the agent's own session can move them. Kill is therefore the honest two-step (§1.4): stop funding it (you control the tap) + revoke at the source (the MCP `suize_kill` tool + Google's app-permissions page). We never pretend the wallet can claw back a foreign address. (The agent balance is delegated-spend, bounded by what you funded + the verifiable log + that two-step kill — delegated-spend risk, not custody risk.)

---

## 11. Current status (2026-06-12)

- **SHIPPED + LIVE at `wallet.suize.io`** (Vercel, prebuilt deploys; PWA with `skipWaiting` so new deploys take over immediately). Meta/OG: "Suize — the AI wallet that makes life easier" + the marketing tweet card (1600×900).
- **Migrated onto the live x402 rail (2026-06-12):** off the retired `account.move`, onto gasless x402 `send_funds` + the standalone `subs::subscription` module.
- **Real on testnet:** sign-in, handle claim, wallet balance, gasless send, the funded-agent card (connect/fund/balance), subscriptions + the verifiable trace with explorer links, push-not-pull silent renew, cancel, coverage warnings, sign-out.
- **Reviewed:** the 4-agent `/review` gauntlet passed after the 2026-06-10/11 fix round (blockers: orphaned landing token, false +cap credit, vocab in the ledger, dead request links — all fixed).
- **Pending:** the merchant data feed (business face real revenue); the conversational AI layer; the Walrus action-log (phase 2); the request/claim-link routes (then flip their gates); the `/agent-connect` second Enoki client registration (STUB until then); the mainnet publish.
