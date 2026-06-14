# Crash by Suize — SPEC

> Owns ONLY the Crash merchant. The global picture — the two primitives, the one
> payment rail, custody, network policy, brand laws — lives in the root
> [`CLAUDE.md`](../../CLAUDE.md); read it first and never redeclare it here. On-chain
> ids + sponsored targets are owned by [`@suize/shared`](../../packages/shared/src/index.ts)
> (`PACKAGE_IDS.CRASH`) — the single source of truth; never hardcode a package id.

## What Crash is

A one-tap, 15-minute **BTC** up/down binary on **DeepBook Predict**, packaged as a
**CHARGE+EARN merchant** on the Suize rail. You bet BTC will be UP or DOWN at a
15-minute expiry; a winning contract redeems for **$1**, a loser for **$0**. A shared
vault is the counterparty, and you can **cash out a live position back to the vault at
any time before expiry** at its live price — the dopamine core. The hero is a live BTC
price chart (Canvas2D) over a deep-blue void, marking your entry price so you watch the
line ride above/below it. Onboarding: sign in with Google (zkLogin) → writes are
**gasless** via the backend Enoki sponsor; or connect a normal wallet (Slush) that
self-pays gas.

**Honesty — BTC, not SUI.** The asset is BTC (DeepBook Predict is BTC-only today). You
are NOT betting on the SUI token. Everywhere in the UI the asset is labeled **BTC**.

## Network — STAYS TESTNET (does not flip to mainnet)

Crash is the one Suize surface that **stays on testnet** while the rail + Wallet + Deploy
go mainnet (CLAUDE.md). The reason is hard: **DeepBook Predict is testnet-only** — there
is no mainnet Predict to bet against. Crash therefore lives on a separate
network-pinned path; its play-money dUSDC has no mainnet counterpart. Position Crash as a
**proof-of-concept of the router / rake / sponsor stack**, not a mainnet product.

## The two rakes — SEPARATE, do not conflate

Crash carries two distinct fees that must never be presented as one number:

| Rake | Rate | Whose revenue | Where it lives | Status |
| --- | --- | --- | --- | --- |
| **Crash product rake** | **3% (300 bps)** | Crash's own house edge | `crash_sui::router::bet` skims it inline | **LIVE on testnet** (play-money) |
| **Suize rail fee** | **2% (1¢ min)** | the rail (Suize treasury) | the x402 rail (`CLAUDE.md`) | **DESIGNED, NOT WIRED** |

- The **Crash 3%** is Crash-as-a-merchant's own revenue, skimmed atomically inside
  `router::bet` before `predict::mint` pulls the post-trade cost. On testnet it is
  **play money** — real revenue only on a hypothetical mainnet Predict redeploy.
- The **Suize 2%** is the rail fee taken **only when an agent pays Crash through the Suize
  rail** (an x402 settlement — see `CLAUDE.md` for the rail). `router::bet` makes **no**
  payment into the Suize rail, so this leg is **wired nowhere in v1** — Crash funds bets
  from a DeepBook `PredictManager` balance, not through Suize.
- **The two never compound in v1** and cannot: the Suize rail is **mainnet**, Crash is
  **testnet** — a mainnet payment cannot fund a testnet bet in one PTB (cross-network gap).
  If mainnet Predict ever ships they would *compound, not unify* (e.g. $100 → 2% rail →
  $98 into Crash → 3% → $95.06), but that is roadmap, not built.
- **Calibrated honesty:** Crash demonstrates the router + on-chain rake + Enoki sponsor
  stack end-to-end. It is **not** a live two-rake Suize integration. Say "PoC of the rake
  + sponsor stack," never "Crash pays the Suize rail."

## On-chain — `crash_sui::router` (package `move-crash`)

The `router` module is the **single move-call target every user action flows through**.
The Enoki sponsorship allowlist contains ONLY `router::*`, so sponsored gas can never
reach a raw `predict::mint` (which would skip the 3% rake) or any off-path call. Full
verbatim signatures, the rake-enforcement steps, the admin model, and the frontend call
shapes live in [`packages/move-crash/README.md`](../../packages/move-crash/README.md) and
[`apps/crash/INTEGRATION.md`](./INTEGRATION.md) — referenced, not repeated.

- **Sponsored targets (`router::*`), all `public fun`, version-gated** (each takes
  `version: &Version` first): `create_manager`, `bet`, `cash_out`, `claim`, `withdraw`,
  `withdraw_all`, `supply`, `redeem_lp`. The canonical list is
  `PACKAGE_IDS.CRASH.TARGETS` in `@suize/shared` (which also includes the framework
  helper `0x2::coin::zero` for the zero-coin bet path after a cash-out leaves the
  manager funded but the wallet coinless). **`coin::zero` normalization fix:** the
  allowlist entry is stored in the canonical long `0x000…002::coin::zero` form — a short
  `0x2::…` target never matches Enoki's allowlist check, so the zero-coin bet path is
  only sponsorable because the target is normalized to the full-length address.
- **Rake is on-chain + non-bypassable on the sponsored path only.** `router::bet` skims
  **3% of the pre-trade quoted cost** (`predict::get_trade_amounts`) to a treasury stored
  inside a shared `Config` (mutable only via the deployer-held `AdminCap`), routed via
  `coin::send_funds`. No treasury address ever lives in client code. A **self-payer** can
  still call `predict::mint` directly and skip the router + rake — the contract can't stop
  that; the Enoki allowlist (not the protocol) is what closes the gasless path.
- **"Be the house" (EARN).** `supply` / `redeem_lp` wrap Predict's PLP LP vault: supply
  dUSDC → receive `PLP` shares; burn shares → get dUSDC back. **No rake** (LPing is not a
  bet). LPs earn the protocol's own spread (the house edge baked into the ask). This is
  the EARN half of CHARGE+EARN.
- **Version lifecycle.** Every `router::*` entry asserts `version` before acting. Adding
  that arg broke the `compatible` policy, so the gated package was published fresh.
  `migrate` / `freeze_all` (admin) are deliberately NOT version-gated so recovery survives
  a freeze.
- **Abort codes (public contract — never renumber):** `EFEE_TOO_HIGH = 1` (`set_fee_bps`
  caps the fee at 1000 bps / 10%). The `version` module owns its own assert/freeze aborts.

### Live ids — read from `@suize/shared`, never inline

The authoritative ids are `PACKAGE_IDS.CRASH` in `@suize/shared`. As of the last publish
the live, version-gated package is **`0x16eb262d…d50c26` (v2)** — upgraded 2026-06-06 to
add `router::withdraw_all` (atomic settle→wallet sweep), with the on-chain `Version`
lifted to 2 via `migrate`, **fencing** the prior v1 package `0xcd1f6af8…ebd31e19`.

> DRIFT FLAG: `apps/crash/README.md`, `INTEGRATION.md`, and
> `packages/move-crash/README.md` still document the **retired v1 id `0xcd1f6af8…`** and
> list only **seven** targets (no `withdraw_all`). `@suize/shared` is correct and
> authoritative; those three docs are stale on the id + target count and should be
> reconciled to the v2 publish. Tests/build counts in those READMEs (6 router/version unit
> tests, `sui move build` green) still hold.

## DeepBook Predict — the underlying protocol

Crash is a consumer of MystenLabs DeepBook Predict (testnet branch
`predict-testnet-4-16`). The verbatim verified protocol facts — package id, the `Predict`
/ `OracleSVI` / `PredictManager` shared objects, dUSDC type + 6-decimals, the 1e9-vs-1e6
two-fixed-point scaling, and the gotchas (`get_trade_amounts` returns
`(cost, payout)` already ×qty in 1e6; `mint` pulls from the manager's internal balance so
you deposit in the same PTB; `create_manager` shares internally + returns only an ID, so
manager creation is its own tx and the id is read from `objectChanges`;
`redeem_permissionless` lets anyone settle a settled oracle) — are documented once in
[`INTEGRATION.md`](./INTEGRATION.md). Reference it, do not duplicate it here.

## The app (consumer of the rail)

- **One balance — the whole UI.** Everything revolves around the **PredictManager internal
  dUSDC balance** (`predict_manager::balance<DUSDC>`, a devInspect read). No separate
  "wallet vs manager", no manual deposit step. `<AnimatedBalance>` diffs prev→next and
  plays green count-up on growth, red dip on shrink (one `requestAnimationFrame` tween +
  CSS, no animation library).
- **Silent funding.** On first load, if the manager is empty but the wallet holds dUSDC,
  the app deposits it under the hood (sponsored). If both are empty, a clean "Get test
  funds →" link to the dUSDC faucet shows instead of a blank screen.
- **The loop.** Sign in → app finds the nearest-expiry active BTC oracle, snaps spot to
  the ATM strike, shows a live mm:ss countdown + live UP%/DOWN% odds (implied prob from
  the live ask) + each side's dUSDC cost → tap UP ▲ / DOWN ▼ (first bet auto-creates the
  `PredictManager`, then each bet deposits the stake + mints) → hold a position with a live
  "Cash Out — $X.XX" value (~1.5s refresh) → **Cash Out** any time, or at settlement the
  app **auto-claims** (`router::claim`, permissionless, sponsored) and flashes WIN /
  CRASHED. "Cash out to wallet" (`router::withdraw` / `withdraw_all`) pulls the balance
  back. A 🔥 streak counter (localStorage) + recent-bets feed round it out.
- **Optimistic bet UX.** Tapping UP/DOWN drops the balance by `(cost + 3% fee)`
  immediately, fires the sponsored tx, then reconciles to the true on-chain balance; on
  failure the optimistic drop reverts with a toast. The client funds the manager with ~8%
  headroom (`bet_amount_with_buffer`) to cover the 3% rake + quote-vs-execution drift.
- **Auto-claim needs no keeper.** Because `redeem_permissionless` is permissionless, a
  user who closed the tab simply collects on their next visit (the same auto-claim runs on
  load).

## Gasless seam — the sponsor, not the rail

Crash's gasless path runs through the **same Enoki sponsor** the rest of Suize uses (the
sponsor allowlist covers `router::*` for Crash, plus the wallet + `subs` targets — see
`services/backend/SPEC.md`), and is separate from the x402 payment rail (`CLAUDE.md`):

- `src/App.tsx`'s `signAndExecute` branches on `sponsored`: zkLogin → `src/sponsor.ts`
  over the backend's **authenticated WebSocket** (`src/ws.ts` — opened on sign-in,
  a personal-message nonce signed ONCE at connect; the socket's verified address pins the
  sponsor `sender`, so a socket for A can never sponsor for B): `sponsorRequest` → sign the
  sponsored bytes with `useSignTransaction` → `executeRequest`. A normal wallet →
  dapp-kit self-paid. `VITE_WS_URL` points at the unified backend (default
  `ws://localhost:8080/ws`; prod `wss://api.suize.io/ws`). (This replaced the old HTTP
  `POST /sponsor` + `/execute` — root `CLAUDE.md` LOCKED #14.)
- The backend's Enoki app allowlists the `router::*` targets server-side; the client never
  passes the allowlist. SplitCoins / MergeCoins / TransferObjects are native PTB commands
  and are NOT allowlisted by Enoki (only `moveCall` targets are), so a PTB doing
  `SplitCoins` + `router::bet` is sponsorable with just the `router::*` targets.

## Stack

React 19 + TypeScript + Vite (mobile-first PWA, single dark screen). `@mysten/enoki`
(zkLogin + sponsored gas), `@mysten/dapp-kit` (wallet + signing), `@mysten/sui`
(Transaction/client), `@tanstack/react-query`. Odds + live cash-out via
`suiClient.devInspectTransactionBlock` on `predict::get_trade_amounts`; market metadata
via the public read API. `src/sui.ts` builds the router PTBs + devInspect reads,
`src/config.ts` re-exports the `@suize/shared` ids + scaling, `src/api.ts` is the read
API, `src/useHouse.ts` drives the LP panel. Runner: **bun**.

## Brand

Obey the laws in `CLAUDE.md` + `marketing/DIRECTION.md`: declarative present tense,
number-led, no banned words, green/red only for true status (WIN / CRASHED / refund),
never decorative. Be honest that this is testnet play money and a PoC of the rake/sponsor
stack — never imply live Suize-rail revenue.
