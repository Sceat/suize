# Crash · by Suize

> Part of the **Suize** monorepo: this app is `@suize/crash` at `apps/crash`. It
> imports shared on-chain ids + sponsor wire types from `@suize/shared`, and its
> gasless transactions are sponsored by the unified backend at `services/backend`
> (routes `/sponsor` + `/execute`).

A one-tap, 15-minute **BTC** up/down "crash game" by **Suize**, built on the **DeepBook
Predict** binary-options protocol on **Sui testnet**. The hero is a **live BTC
price chart** (Canvas2D, glowing line) over a deep-blue void: when you bet, your
**entry price** is marked and you watch the live line ride above/below it.
**Onboarding:** sign in with Google (zkLogin) → transactions are **gasless**
(sponsored via the backend → Enoki); or connect a normal wallet (Slush) which
self-pays gas. No seed phrase, no extension needed for the gasless path.

You bet that BTC will be **UP** or **DOWN** at a 15-minute expiry. A winning
contract pays **1 dUSDC**, a loser pays **0**. A shared vault is the
counterparty — and the dopamine core is that you can **cash out your position
back to the vault at any time before expiry** at its live price. Watch the
cash-out value tick up or down in real time and bail before it crashes.

## ⚠️ BTC, not SUI — honesty note

The underlying asset is **BTC**. The DeepBook Predict protocol is BTC-only
today. **Crash** is the crash game by **Suize**, running **on** Sui —
**you are NOT betting on the SUI token's price.** Everywhere in the app the asset
is labeled **BTC**. This is testnet only; nothing here is real money.

## One balance — the whole app

The entire UI revolves around **one big number**: your **PredictManager internal
dUSDC balance** (read via `predict_manager::balance<DUSDC>`). There is no
separate "wallet vs manager", no manual deposit step, and (with Enoki) no tx
popup.

- **Silent funding.** On first load, if the manager is empty but your wallet
  holds dUSDC, the app deposits it into your manager under the hood (sponsored) —
  so the single balance "just has money". If the wallet is empty too, you get a
  clean **"Get test funds →"** link to the dUSDC faucet instead of a blank screen.
- **Animated.** A single `<AnimatedBalance>` (`src/AnimatedBalance.tsx`) diffs
  previous → next and plays the right effect: **balance growing = green count-up
  + glow/pulse; balance shrinking = red dip.** No animation libraries — one
  `requestAnimationFrame` tween plus CSS.
- **Bet → instant red.** Tapping UP/DOWN optimistically drops the balance by
  `(cost + 3% fee)` immediately, fires the sponsored tx under the hood, then
  reconciles to the true on-chain balance on confirmation. If the tx fails the
  optimistic drop is reverted and a toast explains why.
- **Win/claim → green.** Cash-out and settled-claim payouts land back in the
  manager balance; the number animates **up in green** with a count-up + pulse.
- **Loss.** The stake was already deducted at bet time, so a settlement loss is
  just a "CRASHED" flash on the position — no second balance change.

## The money model (and the fees)

- You buy a binary contract for the **live ask price** (always **< $1**). If it
  wins it redeems for **$1**; if it loses it redeems for **$0**.
- The counterparty is a **shared vault** (the "house"). **Win → the vault pays
  you $1. Lose → your stake stays in the vault.** Liquidity providers fund the
  vault and earn the spread (the protocol's own house edge, baked into the ask).
- Cash-out / settled payouts land in your **PredictManager internal balance**
  and become the single displayed balance, reusable for the next bet.

### 3% platform rake — enforced ON-CHAIN (Move router)

The 3% platform fee is **not** a client-side skim. A client-side fee is trivially
bypassable (anyone can edit the JS or call `predict::mint` raw), and a treasury
address must never live in client code. So the fee moves to a Move module:

```
crash_sui::router::bet<DUSDC>(config, predict, manager, oracle, key, qty, clock, ctx)
```

`router::bet` calls `predict::mint` and then skims 3% from the manager to a
treasury stored **inside** the router's shared `config` object — fully on-chain
and non-bypassable. The treasury address never touches the frontend.

- **Today:** the bet path calls plain `predict::mint` (no rake) while the Move
  router is being built by a separate Move agent.
- **The swap is tiny + isolated.** In `src/sui.ts`, the bet move-call is built by
  one small helper, `add_bet_move_call`, marked with a **ROUTER SWAP-POINT**
  comment. When the router ships: set `ROUTER_ENABLED = true` and fill
  `ROUTER_PACKAGE` / `ROUTER_CONFIG` in `src/config.ts`. The helper then targets
  `crash_sui::router::bet` with one extra leading arg (the shared config). Nothing
  else (deposit, market_key, redeem, withdraw, the whole UI) changes.
- **Funding headroom.** The client funds the manager with ~8% headroom
  (`bet_amount_with_buffer` in `src/config.ts`) so it covers the future 3% rake
  plus quote-vs-execution price drift. While the router is off, the small extra
  simply stays in the user's own manager balance.
- **Testnet = play money.** dUSDC is testnet play-dollars, so even once the router
  is live the rake is *not* real revenue here — real revenue only on a **mainnet
  redeploy** of the router + Predict stack with a mainnet treasury.

### Withdraw to wallet (round-trip)

The "Cash out to wallet" link under the balance opens a small modal that calls
`predict_manager::withdraw<DUSDC>(manager, amount, ctx)` and transfers the coin
to **your own** address — completing the loop **fund → bet → win → withdraw**.

## The loop

1. **Sign in with Google** (zkLogin) — or connect any testnet wallet if Enoki
   keys aren't configured (see fallback below). Reads work with no funds.
2. The app finds the **nearest-expiry active BTC oracle**, computes the **ATM
   strike** (snaps live spot to the strike grid), and shows a **live mm:ss
   countdown**, **live UP% / DOWN%** odds (implied probability from the live ask),
   and each side's dUSDC cost.
3. Tap **UP ▲** or **DOWN ▼**. The first bet auto-creates your on-chain
   `PredictManager` (one tx), then every bet deposits the stake and **mints** a
   position (one tx). With Enoki these are **sponsored + popupless**.
4. You now hold a position: a **live "Cash Out — $X.XX"** value updates every
   ~1.5s, with a smooth value meter and the ticking countdown.
5. **Cash Out** any time (redeem at the live bid).
6. When the oracle **settles**, the app **auto-claims** your payout
   (`redeem_permissionless`, sponsored/invisible) — winnings just appear in your
   balance (green count-up) — and it flashes **WIN** or **CRASHED**.
7. Any time, **Cash out to wallet** pulls your whole balance back to your wallet.
8. A 🔥 **streak** counter (localStorage) and a **recent bets** feed round it out.

## Full-invisible onboarding (Enoki)

Sign-in and gas are powered by **Enoki** (`@mysten/enoki` `1.0.8`) via
`@mysten/dapp-kit` (`1.0.6`) on `@mysten/sui` (`2.17.0`):

- `registerEnokiWallets({ apiKey, client, network: 'testnet', providers: { google: { clientId, redirectUrl } } })`
  (in `src/main.tsx` → `src/enoki.ts`) injects a **Google zkLogin wallet** into
  dapp-kit. The user signs in with Google and transparently gets a Sui address.
- The registered Enoki wallet **sponsors gas itself**: its internal
  `signTransaction` / `signAndExecuteTransaction` goes through Enoki's
  create/execute-SponsoredTransaction flow, so writes are **gasless** (the user
  never needs SUI) and typically **popupless**. The app just uses dapp-kit's
  `useSignAndExecuteTransaction()` — sponsorship is automatic when the active
  wallet is an Enoki wallet (the status chip then reads `gasless`).

> API confirmed against the installed types in
> `node_modules/@mysten/enoki/dist/esm/wallet.d.ts` (`registerEnokiWallets`,
> `isEnokiWallet`, `EnokiWallet.provider`, `AuthProvider = 'google' | ...`).

### Required Enoki portal config (sponsored allowlist)

Sponsored transactions are **allowlisted server-side** in the Enoki portal app
(not passed from the client). Enable Sponsored Transactions for your testnet app
and allowlist these move-call targets, or sponsored writes are rejected
(`pkg = 0xf5ea2b3749c65d6e56507cc35388719aadb28f9cab873696a2f8687f5c785138`):

```
<pkg>::predict::create_manager
<pkg>::predict_manager::deposit
<pkg>::predict_manager::withdraw      # rake skim + cash-out-to-wallet
<pkg>::predict::mint
<pkg>::predict::redeem
<pkg>::predict::redeem_permissionless
<pkg>::market_key::up
<pkg>::market_key::down
```

### Get the keys

- **Enoki API key** (public, browser-safe): https://portal.enoki.mystenlabs.com
  — create an app on **testnet**, copy the public key, enable Sponsored
  Transactions, add the allowlist above.
- **Google OAuth Web client ID**: https://console.cloud.google.com/apis/credentials
  — create an OAuth 2.0 "Web application" client, add your origin (e.g.
  `http://localhost:5173`) to Authorized JavaScript origins + redirect URIs, then
  register the client ID in your Enoki app's Google provider.

Put both in `.env` (see `.env.example`):

```bash
cp .env.example .env
# VITE_ENOKI_API_KEY=...
# VITE_GOOGLE_CLIENT_ID=...
```

### Graceful fallback (no keys needed today)

If the Enoki env vars are **absent**, the app still builds and runs: it falls
back to a standard **dapp-kit ConnectButton** (any testnet wallet extension), so
the full betting loop is testable today without keys. The app never crashes on
missing keys.

## Auto-claim (invisible winnings)

While you hold a bet, the app polls the oracle status; when it reports `settled`
it fires `router::claim` (`redeem_permissionless`) once, automatically (sponsored
when on Enoki). Winnings land in your balance with no action. Because the redeem
is permissionless on-chain, a user who closed the tab simply collects on their
next visit (the same auto-claim runs on load) — no server or keeper needed.

## Stack

- React 19 + TypeScript + Vite (mobile-first PWA, dark/minimal, single screen).
- `@mysten/enoki` (zkLogin + sponsored gas), `@mysten/dapp-kit` (wallet +
  signing), `@mysten/sui` (Transaction/client), `@tanstack/react-query`.
- Odds + live cash-out via `suiClient.devInspectTransactionBlock` on
  `predict::get_trade_amounts`; market metadata via the public read API.
- Package manager + runner: **bun**.

## Get testnet funds

Needed only to *place* bets (reads/odds/cash-out preview work with no funds):

- **Testnet SUI (gas):** https://faucet.sui.io — only needed for the **fallback
  wallet** path. With Enoki, gas is sponsored and you need **no SUI**.
- **dUSDC (to bet):** Tally form — **https://tally.so/r/Xx102L** — paste your
  testnet address. dUSDC has 6 decimals.

## Run it

From the monorepo root (`~/dev/sui/suize`), `bun install` once links the workspace.
Then, for the gasless path, run the backend too:

```bash
# terminal 1 — the sponsor/api backend (gasless writes)
cd services/backend && bun run start   # serves /sponsor + /execute (+ /waitlist)

# terminal 2 — the Crash app
cd apps/crash && bun run dev           # Vite dev server, default http://localhost:5173
```

The wallet (Slush) path works without the backend (self-paid gas). The gasless
Google path needs the backend reachable at `VITE_SPONSOR_URL`.

Type check / build:

```bash
bun run typecheck  # tsc --noEmit  (0 errors)
bun run build      # tsc -b && vite build -> dist/
```

## End-to-end test

1. `bun install && bun run dev`, open the printed URL.
2. **No wallet, no keys:** confirm the **countdown ticks**, a **BTC strike**
   shows, **UP% / DOWN%** odds refresh, and the **edge** appears — this proves
   the live read path + `get_trade_amounts` devInspect against the protocol.
3. **With Enoki keys:** the header shows **Sign in** (Google). Sign in → a Sui
   address appears, the chip reads `gasless`.
4. Fund (dUSDC; SUI too if using the fallback wallet). Tap **UP/DOWN**: first bet
   creates your manager then mints; a held position appears with a **live
   cash-out value**.
5. Tap **Cash Out**, or let it expire and watch the **auto-claim** at settlement,
   the **WIN / CRASHED** flash, and the streak update.

## Architecture notes

- **All writes go through `crash_sui::router::*`** (the 7 targets in `@suize/shared`
  `PACKAGE_IDS.CRASH`). The **3% rake is taken ON-CHAIN inside the router**, not in
  the client — the frontend never computes or transfers the rake. `src/sui.ts`
  builds the router PTBs (`build_bet_tx`, `build_cash_out_tx`, `build_claim_tx`,
  `build_withdraw_tx`, `build_supply_tx`, `build_redeem_lp_tx`) + devInspect reads;
  `src/config.ts` holds the testnet `ROUTER_PACKAGE`/`ROUTER_CONFIG` ids + the
  1e9-vs-1e6 scaling; `src/api.ts` is the read API.
- **Gasless seam:** `src/App.tsx`'s `signAndExecute` branches on `sponsored` —
  zkLogin → `src/sponsor.ts` (`POST {VITE_SPONSOR_URL}/sponsor` → sign the sponsored
  bytes with `useSignTransaction` → `POST /execute`); normal wallet → dapp-kit
  self-paid. `VITE_SPONSOR_URL` points at the unified backend (default
  `http://localhost:8099`; prod = the `api.suize.io` host).
- See **`INTEGRATION.md`** for verbatim Move signatures + the critical gotchas
  (`get_trade_amounts` returns `(cost, payout)` already ×qty in 1e6; `mint` pulls
  from the manager's internal balance so deposit in the same PTB; `create_manager`
  shares internally + only returns an ID, so it's its own tx and the new id is
  read from `objectChanges`; settled payouts land in the manager balance = the
  single displayed balance).
