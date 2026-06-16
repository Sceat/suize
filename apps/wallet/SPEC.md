# Suize Wallet — SPEC (`apps/wallet`, `@suize/wallet`)

> The consumer wallet app — the **PAY face** of Suize, **rebuilt + shipped 2026-06-10**, then **migrated off `account.move` onto the live x402 rail (2026-06-12)** (the old shared funded `Account` + its deposit/withdraw/spend verbs are GONE; there is no on-chain "sub-account" balance anymore). Per the 2026-06-09 OWNER PIVOT this is a self-contained conversational consumer AI wallet — the human talks to it, it remembers them, acts across services, and pays non-custodially. This SPEC owns ONLY this app. The live rail (gasless x402 V2 'exact' settlements + the standalone `subs` subscription module) and the global picture live in the root `CLAUDE.md`; `packages/move-subs/SPEC.md` owns the subscription contract; the off-chain surface (sponsor, handle, facilitator) in `services/backend/SPEC.md`. `account.move` / `packages/move-wallet` is **RETIRED** — never build on it. **State each fact once; reference, never redeclare.** Calibrated honesty is LAW — every reassurance here is literally true.

---

## 1. What this app is

`wallet.suize.io` IS the wallet — **money-first, chat-secondary** (owner law 2026-06-10): the balances, the live subscriptions list, and the verifiable activity ledger own the page; the conversational assistant is a resizable side panel, never the screen. Two faces of one app:

- **The personal face (`ui/WalletDeck.tsx`)** — the deck: the wallet balance + the funded-agent card, subscriptions, activity, the assistant column, the money sheets.
- **The business face (`ui/BusinessConsole.tsx`)** — one masthead tap away: a vertical-tab console (Overview / Revenue / Subscriptions) with the settled balance + the same money verbs, MRR/ARR, the charges ledger (the printed fee is the trust proof), and the analytics chat as a permanent column. **Honest by construction:** the merchant data feed does not exist yet, so production shows the real wallet USDC plus calm zeros/empty states — never fabricated revenue.

Five jobs (the assistant + on-chain rail are SHIPPED; the *broad* cross-service reach is roadmap):

1. **Converse + act** — the assistant IS the **brain**: a Claude-powered (Haiku) tool-use agent (`ui/Assistant.tsx` `BrainAssistant`, which the panel runs in production whenever the deck passes `runAgentTool`). It READS your money and PROPOSES actions; it executes NOTHING itself — the keyless backend runs the loop and the **wallet is the sole executor** (reads answer instantly from app state; every write is a confirm card you tap, signed LOCALLY — the loop transport is `services/backend/SPEC.md`). Seven tools: read balance / activity / subscriptions, send USDC, cancel a subscription, sweep the sub-account, and publish a static page through Deploy. The **Agent-enabled switch** (the **Pause/Resume** button on the agent card) is the kill switch — off ⇒ no auto-spend. *(Built + green, pending this deploy; the brain answers "not configured" until the backend ships with its key. The BROADER "books flights / orders food across services" reach is roadmap — the brain has a fixed seven-tool set, not open-ended provider integration.)*
2. **Fund the agent** — the spend cap IS the sub-account's balance (the 1-of-2 multisig — §3). "Fund" is a plain gasless P2P `sendWallet` from the human's wallet to the multisig address; fund more → bigger cap.
3. **Dial** — the confirm policy stays a client-side dial (root `CLAUDE.md` #8); no `policy` field on-chain.
4. **Kill** — **stop funding + one-tap sweep**: the sub-account is a 1-of-2 multisig the human's MAIN member can drain alone (§3), so "bring my money back" is a single signed sweep — no foreign-address caveat. Plus per-row subscription "Cancel" (`subs::subscription::cancel`), the **Agent-enabled** switch off (halts auto-spend at once), and **Sign out** (the masthead identity menu → dapp-kit disconnect; autoConnect will not silently restore).
5. **Trace** — every subscription lifecycle event (`SubscriptionCreated`/`Renewed`/`Cancelled`) + sent payment rendered as a checkable row with a real explorer link (`SUIVISION_TX`). The Walrus action-log remains the phase-2 extension (root `CLAUDE.md` moat).

**The number wall holds** (root `CLAUDE.md` #5): the brain only *proposes* — the wallet's deterministic builders re-derive every on-chain amount, recipient, and fee on the confirm card the user taps; no LLM output ever becomes a tx number. **No server signing** — the in-app zkLogin session signs locally; the backend brain is keyless and never touches the money path.

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
| **Agent (sub-account)** | "Sub-account" | the sub-account's USDC balance — a 1-of-2 multisig over { MAIN, AGENT } session keys (`data/useAgent.ts`) | **Connect** (arm it: a one-time agent Google sign-in captures the AGENT member) · **Fund** (a P2P `sendWallet` to the multisig) · **Bring it back** (one-tap sweep — MAIN signs alone) |

There is **no on-chain shared `Account` anymore** (the `account.move` cage is retired — §6): the sub-account is a **1-of-2 Sui multisig** over { the MAIN wallet session key, the AGENT session key }, threshold 1 — a PURE FUNCTION of the two members (`@suize/x402` `formAgentSubaccount`), so the wallet re-derives the address with no trusted state. Its balance is the hard cap — fund more raises it. **Threshold 1 cuts both ways:** the AGENT member spends from it (the leash), and the **MAIN member can sweep it back in ONE TAP, signing alone** — so unlike the old "fund a foreign address" model, the human is never locked out of the sub-account (§10). The members are captured at **arm** (§6b `/agent-connect`) and persisted (public keys, not secrets — `payStore`).

The masthead shows the **Total** at the right, beside the **identity menu** (`ui/Identity.tsx` — the handle ▾: copy address, Sign out; lives at the masthead's right on BOTH faces). The activity ledger is the **verifiable trace**: sent payments flow out (−), and subscription rows (created / renewed / cancelled) carry the period amount or, where nothing moved, **no signed amount**. Consumer-vocabulary law (root `CLAUDE.md`): "sub-account" everywhere — never "leash"/"pot"/"agent money" — and no tech jargon reaches the UI.

---

## 4. The money sheets (`ui/sheets.tsx`)

Shared by both faces; all are real modals (focus-trapped, `aria-modal`, Escape closes, focus returns to the opener):

- **Add funds** — the branded decorative QR (`SuizeQr` — NOT scannable; the copy row is the share surface), the copyable handle, the network warning (*"Send only USDC on Sui"*), and the coming-soon rails (Bank transfer / Apple Pay / Card). The **exact-amount request link is demo-gated** (`requestEnabled`) until its route ships — production never mints a link that leads nowhere. Request links are the WALLET surface (free gasless P2P `sendWallet`), never a merchant CHARGE (the 2% x402 surface — an agent pays the merchant's own x402 endpoint).
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
- **`useAgent.ts`** — the sub-account hook (the **1-of-2 multisig** model): derive the sub-account address from the stored members (`formAgentSubaccount`; `armed` only when both parse back to the owner), read its USDC balance (the hard cap), **`fund`** (a `sendWallet` to the multisig), and **`withdraw`** (the one-tap sweep — a gasless multisig `send_funds` from the sub-account to MAIN, the MAIN member signs + combines alone). A stored member that mis-parses (e.g. the old flag-prefix bug) derives to a different address ⇒ treated as NOT armed, so the UI offers a clean re-arm instead of a sub-account the owner's signature can't satisfy.
- **`useSubscriptions.ts`** — the live `Subscription<USDC>` object reads + the silent-renew loop driver.
- **`payTypes.ts`** — the stable `PayApi` contract (pending union includes `'send'` and `'cancel'`).
- **`payStore.ts`** — per-owner client-side policy (all localStorage, all the SECOND control layer — funding physics is the first): the **agent multisig members** (the two public keys; the address is a pure function of them), the **approved-terms** store (the silent-renew leash — the loop only auto-renews terms the user approved), the **spending dials** (`each` / `under $X` / `full`; a NEW payee always confirms), the **known-payee** allow-list, and the **repeat-action loop-breaker** (`autoActionIsRepeat` — the 3rd identical auto-send in 10 min falls through to a confirm; funding physics + the coming Walrus action-log are the real backstops, this just probes intent on a loop).
- **`coins.ts` / `grpc.ts` / `prices.ts`** — the USDC coin type/decimals, the gRPC client (the transport where gasless eligibility resolves), and USD pricing.
- **`memwal.ts`** — the one-time **memory onboarding**: ask the backend for the user's derived MemWal delegate pubkey (`wsMemwalDelegate`), then `createAccount` + `addDelegateKey` (Enoki-sponsored, signed locally) and cache the `accountId`. The brain does recall/remember server-side around each turn (`services/backend/SPEC.md`); the wallet only authorizes the delegate ONCE. Best-effort — never blocks a chat or a payment.
- **`agentTools.ts`** — the `ToolRun` contract the brain's tool calls compile to: an `immediate` result (a read, no money) or a `card` (a write the user must tap, carrying its `commit`). `ui/WalletDeck.tsx` `runAgentTool` is the executor (the number wall lives here — it re-derives recipient/amount/fee, never trusting the model's args).
- **`deploy.ts` / `pack.ts`** — deploy-from-agent: tar a single self-contained `index.html` and publish it through the Deploy **x402** flow (probe → 402 → settle the $0.50 locally → live URL). A strict CSP `<meta>` is injected so the page is truly self-contained (no network); the price is the backend's OWN 402 challenge (the number wall — the model never sets it).
- **`useAuth.ts`** — Enoki zkLogin (`connect` = an OAuth **popup**, must fire from a user gesture) + **`signOut`** (dapp-kit disconnect). **`suins.ts` / `ws.ts` / `useIdentity.ts` / `useWsLifecycle.ts`** — the WS sponsor/handle transport per root `CLAUDE.md` #14. **The socket self-heals (2026-06-11):** a user action on a down socket kicks a fresh connect and waits briefly (`ensureConnected`) instead of instantly failing, and tab-focus / network-online kick a reconnect — a dropped socket (laptop sleep, transient server-side verify failure) can no longer strand the session on "not ready" until reload.

Transport: a gasless x402 write (`sendWallet`) builds its own gasless bytes and the session signs them; a sponsored write (a subscription `create`/`renew`/`cancel`, which mints/touches a persistent Party object → not fully gas-rebatable) builds KIND bytes → `requestSponsorship` → the zkLogin session signs the sponsored bytes verbatim → `executeSponsored`. The backend never signs owner txs.

**Optimistic-then-reconcile (`sendWallet`, 2026-06-13):** the gRPC execute node settles before the JSON-RPC read node (balance) and the indexer (the sent-tx feed) reflect a send — so the UI used to look frozen until a manual reload. Now `sendWallet` applies the send to the UI INSTANTLY (the amount drops from the displayed balance; a "confirming…" row, spinner, no verify link, prepends the activity), then reconciles against the chain and rolls back on failure. Honesty guards: the optimistic balance is `real − unreflected-outflow` where a send stops being subtracted the moment the refetched real balance has dropped to/below `snapshot − amount` (so it can NEVER double-count when the chain catches up); the pending row is replaced by the real row only once that digest appears in the real sent feed; a 30s TTL drops any entry that neither reconciles nor fails (falling back to authoritative chain state); a failed execute removes the entry (rollback). Background refresh still runs (`waitForTransaction` on the read node → bump, +2.5s bump for the indexer). The same path serves agent **`fund`** (it sends from your wallet).

---

## 6b. The subscription + agent gates (wallet-hosted popups)

The Enoki session lives on THIS origin only; the wallet hosts two visible
top-level popups other `*.suize.io` products open for the operations they can't
sign themselves (protocol + security model: `@suize/shared/bridge`; wire shapes
there, POLICY here). **NOTHING signs on a silent surface — money always needs a
visible popup the human approves.**

- **`/confirm-subscribe`** (`src/bridge/ConfirmSubscribe.tsx`) — the RECURRING money
  gate: a visible top-level popup other `*.suize.io` products (Deploy's storage
  subscription) open to set up (or cancel) a subscription. Origin-pinned + a `ready`
  beacon + popup sign-in for the `SubscribeTerms` pair. **display = build:** it renders
  the terms (merchant / amount / periodMs / ref) and on approval builds the
  `subs::subscription::create` PTB ITSELF from those same terms (push-not-pull —
  period 1 paid inline). **Sponsored** (a Party-object mint is not fully
  gas-rebatable), so it runs the WS sign-once lifecycle and rides the sponsor path —
  the key still never leaves the machine. On success it records the APPROVED terms in
  `payStore` (the silent-renew leash) and posts the new `subKey` back. Signed-out:
  "Continue with Google" opens the Enoki OAuth popup; this window stays open and its
  session updates reactively on return. `frame-ancestors 'none'` — it can never be
  iframed.

**`/agent-connect` — the Suize-door agent sign-in (CHARGE-side / dev, NOT a consumer PAY path)**
(`src/bridge/AgentConnect.tsx`): an external assistant's Suize MCP signs in via a
**SECOND, DISTINCT Google zkLogin client** (`VITE_GOOGLE_AGENT_CLIENT_ID`) so the
AGENT session is a different `aud` and **NEVER reuses the human wallet session**. With
`?arm=1` (the wallet's "Connect" — §3) it captures the AGENT member's public key that,
together with the MAIN member, forms the **1-of-2 multisig** sub-account; threshold 1
means the human's MAIN member can still **sweep it alone** (§10). It then hands the MCP a
local session. **LOAD-BEARING FOREVER:** `VITE_GOOGLE_AGENT_CLIENT_ID` is a separate
pinned OAuth client id — once registered it can never be rotated (it is the agent
identity's zkLogin `aud`), exactly like the primary `client_id`. **STATUS — STUB:**
the second Enoki OAuth client is not yet registered, so `GOOGLE_AGENT_CLIENT_ID` is
empty in this build and the door is inert (`AGENT_ENABLED` false) until it is set.

The key never leaves this origin; no popup surface exports key material or
signs arbitrary tx bytes. The `/confirm-subscribe` consumer is Deploy's storage
subscription — see `services/backend/SPEC.md` §7.4. **Reviewed** (4-agent
`/review` + a dedicated web-security adversary, 2026-06-11): no exploitable
finding against the hard requirements (key isolation, display=build,
money-needs-visible-UI, non-allowlisted-origins-get-nothing — the last proven
live with a hostile origin). Hardened in the same pass: the OAuth-resume stash
re-asserts the allowlist on its stored `openerOrigin` before posting any result;
first-valid-terms guard + a 30 s beacon deadline. Accepted residual (in the
stated threat model): an XSS'd allowlisted origin can *request* a subscription
via the popup — but the human still sees and approves the amount, and the key
never moves.

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

- **No server signing; the server-side AI is FENCED OUT of the money path** (root `CLAUDE.md` #5). The backend brain runs Claude and PROPOSES tool calls, but it is keyless: it never signs, settles, sponsors, or imports the money path, and the wallet re-derives every on-chain number on the confirm card (the number wall). The assistant never reports an action as done unless the tool result says so.
- **No on-chain agent identity / `set_agent` / pause / budget / scope / allow-list / expiry, and no shared funded `Account`** — the multisig sub-account's own balance is the cap; kill = stop funding + one-tap sweep / cancel subscriptions / switch off / sign out.
- **No fabricated numbers.** Demo data exists only behind the DEV `?demo=1` seam.
- **No request/claim links in production** until their routes exist (Soon-gated).

---

## 10. Custody copy (exact — never deviate)

The verbatim law (root `CLAUDE.md`): **"fully non-custodial — your keys never leave your machine."** The deck footnote (rendered from `copy.ts` `custodyLead`/`custodyTail`):

> **Fully non-custodial** — your keys never leave your machine. Every payment is signed by your own login; Suize never signs for you.

The custody phrase is VERBATIM and never deviates. **The honest agent caveat:** the sub-account is a **1-of-2 multisig** over { your MAIN session, the AGENT session } (§3) — threshold 1, so the AGENT member can spend the funds you put there (delegated-spend; v1 has no on-chain payee allow-list), but **your MAIN member can sweep it back in one tap, signing alone.** So the leash is bounded by what you fund + a verifiable log + a one-tap sweep you alone control — **delegated-spend risk, NOT custody risk.** (We never claim the wallet can claw back a *foreign* address — the sub-account is not foreign, it's a multisig you co-own.)

---

## 11. Current status (2026-06-12)

- **SHIPPED + LIVE at `wallet.suize.io`** (Vercel, prebuilt deploys; PWA with `skipWaiting` so new deploys take over immediately). Meta/OG: "Suize — the AI wallet that makes life easier" + the marketing tweet card (1600×900).
- **Migrated onto the live x402 rail (2026-06-12):** off the retired `account.move`, onto gasless x402 `send_funds` + the standalone `subs::subscription` module.
- **Real on testnet:** sign-in, handle claim, wallet balance, gasless send, the **multisig sub-account** (arm / fund / balance / one-tap sweep), subscriptions + the verifiable trace with explorer links, push-not-pull silent renew, cancel, coverage warnings, sign-out.
- **The conversational assistant (the brain) is BUILT + green:** Claude Haiku, seven tools, the wallet-executes-every-tool loop, the spending dials + repeat loop-breaker, and MemWal memory ("it remembers you"). Wired into production (`BrainAssistant`); it answers "not configured" until the backend ships with `ANTHROPIC_API_KEY` (this deploy).
- **Reviewed:** the 4-agent `/review` gauntlet passed after the 2026-06-10/11 fix round (blockers: orphaned landing token, false +cap credit, vocab in the ledger, dead request links — all fixed).
- **Pending:** this DEPLOY (backend with the Anthropic + MemWal env; wallet Vercel); the `/agent-connect` **second Enoki client** registration (the sub-account can't arm until it's set — dormant-but-honest until then); the merchant data feed (business-face real revenue); the **Walrus action-log** (phase 2 — the verifiable trace of every agent action); the broader **cross-service reach** (book flights / order food — the brain has a fixed seven-tool set today); two more brain tools (pay an external merchant, create a subscription); the request/claim-link routes; the mainnet publish.
