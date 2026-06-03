import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ConnectButton,
  useSignAndExecuteTransaction,
  useSignTransaction,
  useSuiClient,
} from '@mysten/dapp-kit'
import type { Transaction } from '@mysten/sui/transactions'
import { toBase64 } from '@mysten/sui/utils'
import {
  fetch_latest_prices,
  fetch_manager,
  fetch_minted,
  fetch_oracles,
  fetch_redeemed,
  find_oracle,
  pick_live_btc_oracle,
  strike_interval_of,
  type MintedPosition,
  type Oracle,
  type RedeemedPosition,
} from './api'
import {
  build_bet_tx,
  build_cash_out_tx,
  build_claim_all_tx,
  build_claim_tx,
  build_create_manager_tx,
  build_withdraw_tx,
  fetch_dusdc_coins,
  find_created_manager_id,
  implied_pct_from_cost,
  read_manager_balance,
  read_trade_amounts,
  snap_strike,
} from './sui'
import {
  DEFAULT_STAKE_USD,
  DUSDC_SCALE,
  LS_STREAK,
  ONE_CONTRACT_QTY,
  PREVIEW_QUANTITY,
  ROUTER_FEE_BPS,
  STAKE_PRESETS_USD,
  bet_amount_with_buffer,
} from './config'
import {
  dusdc_to_usd,
  fmt_addr,
  fmt_compact,
  fmt_countdown,
  fmt_signed_usd,
  fmt_strike,
  fmt_usd,
  fmt_usd_compact,
} from './format'
import { useNow } from './useNow'
import { useAuth } from './auth'
import { execute_sponsored, request_sponsorship } from './sponsor'
import { CustomCursor } from './CustomCursor'
import { CrashE05 } from './CrashE05'
import { useHouse } from './useHouse'
import type {
  CrashActions,
  CrashData,
  CrashResult,
  CrashTapeRow,
} from './crash-host'
import * as sfx from './sfx'

// Where users top up their wallet with testnet funds. The "Add funds" affordance
// (balance couplet + house deposit sheet) links here.
const WALLET_URL = 'https://wallet.suize.io'

// ---------------------------------------------------------------------------
// The one open position we display + drive claim/cash-out from. Held in React
// state ONLY (never localStorage — it is trusted state). It is either:
//   (a) set in-session right after a successful bet (from the tx we just sent), or
//   (b) RECONSTRUCTED from chain/indexer truth on load via reconstruct_open_bet
//       (so a page reload recovers the open position without any local blob).
// Every field needed to build claim/cash_out (oracle_id, expiry, strike, is_up,
// quantity) therefore traces back to chain/indexer truth, not the client.
// `cost_1e6` is purely the displayed "paid" amount; it never affects a tx.
// ---------------------------------------------------------------------------
type OpenBet = {
  oracle_id: string
  expiry_ms: number
  strike_1e9: string // bigint as string
  is_up: boolean
  quantity: string
  cost_1e6: string // what we paid (for display only)
}

// Identity of a position for matching minted <-> redeemed records: the full
// MarketKey tuple (oracle_id + manager_id + is_up + strike + expiry). Both feeds
// expose these exact fields, so a redeemed row matches its minted row 1:1; this
// is the same identity the on-chain redeem addresses, so the open-bet view
// always agrees with on-chain truth about what's already claimed.
const position_key = (p: {
  oracle_id?: string
  manager_id?: string
  is_up?: boolean
  strike?: number
  expiry?: number
}): string =>
  `${p.oracle_id ?? ''}|${p.manager_id ?? ''}|${p.is_up ? 'U' : 'D'}|${p.strike ?? ''}|${p.expiry ?? ''}`

// Parse an indexer integer field (strike / quantity, given as a JSON number or
// string) into an EXACT bigint, with NO float round-trip — so the value matches
// what was minted and the on-chain redeem MarketKey is byte-identical. A JSON
// number is integer-valued and < 2^53 here (1e9 strikes, 1e6 quantities), so
// Math.trunc only strips a spurious ".0"; a string goes straight to BigInt.
const to_exact_bigint = (v: unknown, fallback: bigint): bigint => {
  if (typeof v === 'string' && v.length > 0) {
    try {
      return BigInt(v)
    } catch {
      return fallback
    }
  }
  if (typeof v === 'number' && Number.isFinite(v))
    return BigInt(Math.trunc(v))
  return fallback
}

// ----- STAKE -> QUANTITY (the "stake = what actually LEAVES your wallet") -----
// The stake is the dUSDC the user wants to PART WITH IN TOTAL. The router skims a
// 3% rake on-chain ON TOP of the mint cost, so the real debit is cost + 3%. We
// therefore size the bet so the DEBIT (cost + rake) ≈ the stake — i.e. we target
// the bare mint cost at stake / 1.03, then the rake brings the debit back up to ≈
// the stake (instead of ~3% OVER it).
//   debit(qty) = cost_for(qty) × (1 + rake)            (what the router bills)
//   want debit ≈ stake_usd × DUSDC_SCALE
//   => target cost = stake_usd × DUSDC_SCALE × 10000 / (10000 + ROUTER_FEE_BPS)
//
// `cost_unit` is the ask for ONE WHOLE contract (1e6 quantity units) — i.e. the
// per-contract price in 1e6 base units (< $1). The on-chain quantity is a
// 1e6-SCALED contract count (see config.ts SCALING): quantity == 1_000_000 means
// one whole contract paying $1 on a win. Crucially the protocol has NO whole-lot
// minimum — get_trade_amounts quotes any raw quantity (verified live: qty=100
// already prices precisely), and cost(qty) = cost_unit × qty / 1e6. So we size at
// the FINEST granularity (raw quantity units, NOT whole contracts):
//   quantity = target_cost × 1e6 / cost_unit
// The previous code rounded to whole contracts (multiples of 1e6); at a ~$0.50
// per-contract ask a $1 stake collapsed to exactly 2 contracts on BOTH sides → a
// flat $2 / 2.0x that erased the per-side odds difference. Fine-grained sizing
// makes the WIN (quantity / 1e6 × $1) track the TRUE per-side odds: it differs UP
// vs DOWN and moves as spot diverges from the strike, while the debit stays ≈ the
// stake. Pure presentation/sizing — it only changes the `quantity` value fed to
// the frozen build_bet_tx.
const quantity_for_stake = (stake_usd: number, cost_unit: bigint): bigint => {
  const stake = BigInt(Math.max(1, Math.round(stake_usd)))
  if (cost_unit <= 0n) return stake * ONE_CONTRACT_QTY
  // Target the BARE cost at stake / (1 + rake) so cost + the on-chain 3% rake ≈
  // the stake (the amount that truly leaves the wallet).
  const target_cost =
    (stake * DUSDC_SCALE * 10_000n) / (10_000n + ROUTER_FEE_BPS)
  // Fine-grained: raw quantity units so cost(qty) ≈ target_cost. cost(qty) =
  // cost_unit × qty / 1e6, so qty = target_cost × 1e6 / cost_unit. Floor (never
  // overshoot the stake), with a 1-unit floor so a quote always yields a bet.
  const quantity = (target_cost * ONE_CONTRACT_QTY) / cost_unit
  return quantity < 1n ? 1n : quantity
}

// The BARE mint cost for a sized quantity at a per-contract ask. Mirrors the
// on-chain math::mul(cost_unit, quantity) = cost_unit × quantity / 1e6 (config.ts
// SCALING), at FULL precision (no whole-contract truncation). dUSDC 1e6 units.
const cost_for_quantity = (cost_unit: bigint, quantity: bigint): bigint =>
  (cost_unit * quantity) / ONE_CONTRACT_QTY

// The TRUE debit for a given bare mint cost: cost + the on-chain 3% router rake.
// This is what actually leaves the wallet, so it is the honest "PAID" figure and
// the break-even for live P&L. Single source of truth for the rake gross-up
// (mirrors place_bet's optimistic deduction). dUSDC 1e6 base units in/out.
const debit_with_rake = (cost_1e6: bigint): bigint =>
  cost_1e6 + (cost_1e6 * ROUTER_FEE_BPS) / 10_000n

// The WIN payout (in $) for a given stake at a per-contract cost: contracts × $1.
// With fine-grained sizing `quantity` is a 1e6-scaled (fractional-contract) count,
// so the win is quantity / 1e6 dollars — computed at full precision (NOT integer-
// truncated to whole contracts, which would re-pin the payout). Derived from the
// SAME sizing so the displayed WIN == what the bet actually pays.
const win_for_stake = (stake_usd: number, cost_unit: bigint | null): number => {
  if (cost_unit == null || cost_unit <= 0n) return stake_usd
  return Number(quantity_for_stake(stake_usd, cost_unit)) / Number(ONE_CONTRACT_QTY)
}

// Reconstruct the user's open position from the indexer's minted feed, cross-
// referenced with the live oracle list AND with the redeemed feed so
// already-claimed/cashed-out positions are excluded. A
// position is "open/claimable" while its oracle is active / pending_settlement /
// settled (a just-settled one is claimable — auto-claim then clears it) AND it
// has no matching redeemed record. We pick the most recent such mint. Returns
// null when the user holds nothing live. The numbers come from the indexer, but
// they only QUOTE and address an on-chain redeem that asserts ownership — a
// wrong indexer answer can only fail the tx, never move funds wrongly.
const reconstruct_open_bet = (
  minted: MintedPosition[],
  redeemed: RedeemedPosition[],
  oracles: Oracle[],
): OpenBet | null => {
  const by_id = new Map(oracles.map(o => [o.oracle_id, o]))
  const redeemed_keys = new Set(redeemed.map(position_key))
  const p = minted
    .filter(m => {
      const o = m.oracle_id ? by_id.get(m.oracle_id) : undefined
      return Boolean(
        o &&
          o.status !== 'created' &&
          m.strike != null &&
          m.expiry != null &&
          !redeemed_keys.has(position_key(m)),
      )
    })
    .sort((a, b) => (b.expiry ?? 0) - (a.expiry ?? 0))[0]
  if (!p || p.oracle_id == null || p.strike == null || p.expiry == null)
    return null
  return {
    oracle_id: p.oracle_id,
    expiry_ms: p.expiry,
    strike_1e9: to_exact_bigint(p.strike, 0n).toString(),
    is_up: Boolean(p.is_up),
    quantity: to_exact_bigint(p.quantity, ONE_CONTRACT_QTY).toString(),
    // The indexer reports the BARE on-chain mint cost (the router skims the rake
    // separately before minting). Gross it up by the 3% rake so a reconstructed
    // bet's "PAID" matches a freshly-placed one — both show what truly left the
    // wallet (cost + rake). Display-only; never feeds a tx.
    cost_1e6: debit_with_rake(to_exact_bigint(p.cost, 0n)).toString(),
  }
}

// The exact arg shape router::claim needs (matches sui.ts RedeemOpts). Built by
// gather_claimable_positions and fed straight into build_claim_all_tx.
type ClaimArgs = {
  manager_id: string
  oracle_id: string
  expiry_ms: bigint
  strike_1e9: bigint
  is_up: boolean
  quantity: bigint
}

// Gather EVERY claimable position the user holds, from the manager-scoped minted
// feed cross-referenced with the oracle list + the redeemed feed. A position is
// claimable when its oracle is SETTLED with a published settlement_price, the
// position WON (settlement vs strike, the SAME rule claim() uses), and it has no
// matching redeemed record (not already claimed/cashed-out). The numbers come
// from the indexer but only QUOTE + address an on-chain redeem that asserts
// ownership — a wrong indexer answer can only fail the tx, never move funds.
// Returns the exact args router::claim needs for each (manager scoped to the
// caller's PredictManager). Empty when nothing is claimable.
const gather_claimable_positions = (
  manager_id: string,
  minted: MintedPosition[],
  redeemed: RedeemedPosition[],
  oracles: Oracle[],
): ClaimArgs[] => {
  const by_id = new Map(oracles.map(o => [o.oracle_id, o]))
  const redeemed_keys = new Set(redeemed.map(position_key))
  const out: ClaimArgs[] = []
  // Guard against the same MarketKey appearing twice in the minted feed (an
  // accumulated position can emit multiple mint rows) — one claim redeems the
  // whole on-chain position, so a duplicate moveCall would abort the batch.
  const seen = new Set<string>()
  for (const m of minted) {
    if (m.oracle_id == null || m.strike == null || m.expiry == null) continue
    const o = by_id.get(m.oracle_id)
    if (!o || o.status !== 'settled' || o.settlement_price == null) continue
    const key = position_key(m)
    if (redeemed_keys.has(key) || seen.has(key)) continue
    const settlement = BigInt(Math.round(o.settlement_price))
    const strike = to_exact_bigint(m.strike, 0n)
    const is_up = Boolean(m.is_up)
    const won = is_up ? settlement >= strike : settlement < strike
    if (!won) continue
    seen.add(key)
    out.push({
      manager_id,
      oracle_id: m.oracle_id,
      expiry_ms: BigInt(Math.trunc(m.expiry)),
      strike_1e9: strike,
      is_up,
      quantity: to_exact_bigint(m.quantity, ONE_CONTRACT_QTY),
    })
  }
  return out
}

// Detect the "position was already redeemed" outcome of a claim tx. After our
// fresh settled + settlement_price guard, the only realistic way router::claim
// aborts is that the underlying position no longer exists on-chain — a prior
// in-app claim (e.g. a double-fire across reloads) already redeemed it. The predict redeem path aborts
// with a MoveAbort in that case; we treat any on-chain MoveAbort here as
// "already claimed" and clear the bet quietly instead of looping a scary error.
// (A wrong guess only changes the toast — never funds; the payout already landed
// in the owner's manager when the position was redeemed.)
const is_already_redeemed_error = (msg: string): boolean => {
  const m = msg.toLowerCase()
  return (
    m.includes('moveabort') ||
    m.includes('already') ||
    m.includes('does not exist') ||
    m.includes('not found') ||
    m.includes('dynamic field')
  )
}

// Seed the GAINS/LOSS results log (V) from the indexer feeds on load so past
// outcomes survive a refresh. A position is a FINISHED result when it has a
// matching REDEEMED record (it was claimed or cashed out) AND its oracle settled
// with a published settlement_price (so we can score win/loss). The realized P&L
// is the binary settlement payout ($1×qty on a win, $0 on a loss) MINUS the
// all-in debit (bare cost grossed up by the 3% rake — same figure place_bet
// shows as PAID). Returned MOST RECENT FIRST (by expiry) and capped by the
// caller. A cash-out's true payout isn't in the feeds, so a cashed-out winner is
// scored at its settlement value — a reasonable historical approximation; the
// live session capture (finish_bet) always uses the exact realized numbers.
const gather_settled_results = (
  minted: MintedPosition[],
  redeemed: RedeemedPosition[],
  oracles: Oracle[],
): CrashResult[] => {
  const by_id = new Map(oracles.map(o => [o.oracle_id, o]))
  const redeemed_keys = new Set(redeemed.map(position_key))
  const seen = new Set<string>()
  const rows: { result: CrashResult; expiry: number }[] = []
  for (const m of minted) {
    if (m.oracle_id == null || m.strike == null || m.expiry == null) continue
    const key = position_key(m)
    if (!redeemed_keys.has(key) || seen.has(key)) continue
    const o = by_id.get(m.oracle_id)
    if (!o || o.status !== 'settled' || o.settlement_price == null) continue
    seen.add(key)
    const settlement = BigInt(Math.round(o.settlement_price))
    const strike = to_exact_bigint(m.strike, 0n)
    const is_up = Boolean(m.is_up)
    const won = is_up ? settlement >= strike : settlement < strike
    const quantity = to_exact_bigint(m.quantity, ONE_CONTRACT_QTY)
    const debit = debit_with_rake(to_exact_bigint(m.cost, 0n))
    const payout = won ? quantity : 0n
    rows.push({
      result: {
        id: m.expiry,
        isUp: is_up,
        won,
        pnlUsd: dusdc_to_usd(payout - debit),
      },
      expiry: m.expiry,
    })
  }
  return rows.sort((a, b) => b.expiry - a.expiry).map(r => r.result)
}

// client-only, untrusted, resettable — cosmetic streak, not authoritative.
const load_streak = (): number => {
  const n = Number(localStorage.getItem(LS_STREAK))
  return Number.isFinite(n) ? n : 0
}

type Busy = null | 'manager' | 'bet-up' | 'bet-down' | 'cashout' | 'claim' | 'withdraw'

export function App() {
  const {
    address,
    google_wallet,
    sponsored,
    sign_in_google,
    sign_out,
    connecting,
  } = useAuth()
  const client = useSuiClient()
  const { mutateAsync: signAndExecuteRaw } = useSignAndExecuteTransaction()
  // Sign-ONLY mutation (no execute). For sponsored (zkLogin) writes we need the
  // user's signature over the EXACT sponsored bytes the backend returns — NOT a
  // rebuilt+self-paid tx. useSignTransaction accepts a base64 string and passes
  // it through verbatim (it does not rebuild a string transaction), so the
  // resulting signature is over the sponsored bytes the backend will /execute.
  const { mutateAsync: signTransactionRaw } = useSignTransaction()
  const now = useNow(1000)
  const addr = address

  // dapp-kit bundles its own (matching-version) @mysten/sui copy, so the
  // Transaction class it expects is nominally distinct from the one our builders
  // produce. They are structurally + behaviourally identical at runtime; bridge
  // the type at this single boundary.
  //
  // SPONSORSHIP — the ONE write path, branched on wallet kind. Every write call
  // site (place_bet, cash_out, claim, withdraw, supply, redeem_lp) calls this
  // wrapper; it transparently picks the right signing route and always resolves
  // to `{ digest }` (callers do client.waitForTransaction({ digest })).
  //
  //   • NOT sponsored (normal wallet, e.g. Slush): the wallet pays its own gas.
  //     Keep the existing dapp-kit signAndExecute path unchanged.
  //
  //   • sponsored (Enoki/zkLogin): a fresh Google user holds NO SUI, so self-pay
  //     aborts with "No valid gas coins". Route through the unified backend (it
  //     holds the Enoki PRIVATE key + enforces the router::* allowlist):
  //       1. build the tx KIND bytes (onlyTransactionKind) -> base64
  //       2. POST /sponsor  -> { bytes, digest }  (sponsored full tx bytes)
  //       3. sign the EXACT sponsored `bytes` with the zkLogin session via
  //          useSignTransaction (sign-only; a string transaction is passed
  //          through verbatim — NOT rebuilt/self-paid)
  //       4. POST /execute  -> { digest }  (backend submits + pays gas)
  //     On any /sponsor or /execute failure we throw a clear "sponsorship
  //     unavailable" error and do NOT silently fall back to self-pay (which would
  //     just fail confusingly for a gasless user). Callers surface it via set_error.
  const signAndExecute = useCallback(
    async (args: { transaction: Transaction }): Promise<{ digest: string }> => {
      // Self-paid path (normal wallet): identical to the prior behaviour.
      if (!sponsored || !address) {
        return signAndExecuteRaw({
          transaction: args.transaction as unknown as Parameters<
            typeof signAndExecuteRaw
          >[0]['transaction'],
        })
      }

      // Gasless path (zkLogin via Enoki) — sponsor through the backend.
      // 1. tx KIND bytes (no gas data) -> base64. The dapp-kit SuiClient is
      //    structurally compatible with @mysten/sui's build client; bridge the
      //    nominal type at this single boundary (same as elsewhere in the app).
      type BuildOpts = NonNullable<Parameters<Transaction['build']>[0]>
      const kind_bytes = await args.transaction.build({
        client: client as unknown as BuildOpts['client'],
        onlyTransactionKind: true,
      })
      const kind_bytes_b64 = toBase64(kind_bytes)

      // 2. /sponsor -> the full sponsored tx bytes + digest.
      const { bytes, digest } = await request_sponsorship({
        kind_bytes_b64,
        sender: address,
      })

      // 3. Sign the EXACT sponsored bytes (passed as a string => signed verbatim).
      const { signature } = await signTransactionRaw({ transaction: bytes })

      // 4. /execute -> the backend submits + pays gas; echoes the executed digest.
      const executed = await execute_sponsored({ digest, signature })
      return { digest: executed.digest }
    },
    [sponsored, address, signAndExecuteRaw, signTransactionRaw, client],
  )

  // ----- SOUND: unlock the audio context on the FIRST user gesture -----------
  // Browser autoplay policy forbids starting an AudioContext before a gesture,
  // so sfx.unlock() (which lazily creates + resumes the context) is bound to the
  // first pointerdown/keydown and then detaches. The mute toggle UI was dropped
  // in the e05 design; sound stays on (sfx respects the persisted mute in sfx.ts).
  useEffect(() => {
    const on_gesture = () => sfx.unlock()
    window.addEventListener('pointerdown', on_gesture)
    window.addEventListener('keydown', on_gesture)
    return () => {
      window.removeEventListener('pointerdown', on_gesture)
      window.removeEventListener('keydown', on_gesture)
    }
  }, [])

  const [oracles, set_oracles] = useState<Oracle[]>([])
  const [oracle, set_oracle] = useState<Oracle | null>(null)
  const [strike, set_strike] = useState<bigint | null>(null)
  const [spot, set_spot] = useState<bigint | null>(null)

  // up_pct/down_pct (implied win %) are still derived by load_odds (kept as a
  // data hook) but no longer surfaced in the e05 skin — setter-only.
  const [, set_up_pct] = useState<number | null>(null)
  const [, set_down_pct] = useState<number | null>(null)
  const [up_cost, set_up_cost] = useState<bigint | null>(null)
  const [down_cost, set_down_cost] = useState<bigint | null>(null)

  // ----- STAKE selector: $ payout-capacity the user wants to bet -----
  // stake_usd is in whole dollars (1 contract = $1 max payout). custom_open
  // reveals an inline number input; custom_usd holds its (string) value so the
  // field can be cleared mid-edit. quantity derives from the selected stake and
  // flows straight into the bet (build_bet_tx). Odds % stay size-independent
  // (still previewed at 1 contract); only the displayed COST scales with size.
  const [stake_usd, set_stake_usd] = useState<number>(DEFAULT_STAKE_USD)
  // Custom-stake editing state. The ported e05 design owns the inline field's
  // open/value UI; here we keep the setters (driven by the selectStake/
  // setCustomStake actions) — the values themselves aren't read in App.
  const [, set_custom_open] = useState(false)
  const [, set_custom_usd] = useState('')

  const [busy, set_busy] = useState<Busy>(null)
  // GLOBAL ACTION LOCK — one boolean that is TRUE while ANY user-triggered
  // sponsored write (place bet, cash out, claim, supply/become-the-house,
  // withdraw, redeem) is in flight. Every such action handler GUARDS at the top
  // (`if (tx_pending) return`) so a second click while Enoki is slow to sign is a
  // hard no-op, and flips it back in a `finally` (covering success, error AND
  // user-rejection). Exposed to the e05 skin as `txPending` to grey-out every
  // action control. The per-action `busy` flags stay for the inline spinner; this
  // is the GLOBAL cross-action interlock. Auto-claim/auto-create (NOT
  // user-triggered) are excluded from the guard but still flip the flag while in
  // flight so a concurrent user click is blocked.
  const [tx_pending, set_tx_pending] = useState(false)
  const [error, set_error] = useState<string | null>(null)
  const [notice, set_notice] = useState<string | null>(null)
  // Flavour of the current `notice` toast (T + U): 'win' (green) / 'loss' (red)
  // for the concise settle toast; null is the neutral blue info line. Set
  // alongside set_notice; cleared back to null for ordinary notices.
  const [notice_kind, set_notice_kind] = useState<
    'ok' | 'win' | 'loss' | null
  >(null)
  // Soft, non-blocking flag: the indexer reconstruct fetch failed. We keep any
  // in-memory bet and retry on the next poll rather than clearing the position.
  const [reconstruct_failed, set_reconstruct_failed] = useState(false)

  const [manager_id, set_manager_id] = useState<string | null>(null)

  // THE ONE BALANCE: the user's spendable dUSDC = manager internal balance +
  // wallet-held dUSDC. We do NOT eagerly sweep the wallet into the manager;
  // instead we fund LAZILY — at bet time we deposit only what the bet needs
  // (cost + small buffer) from the wallet, inside the bet PTB. The displayed
  // number therefore reflects manager + wallet so the user always sees all their
  // money even though it physically lives in two places.
  //   `manager_balance` / `wallet_dusdc` are the last confirmed on-chain truths.
  //   `optimistic` is a transient override shown instantly on bet/win and
  //   reconciled away on confirmation.
  const [manager_balance, set_manager_balance] = useState<bigint | null>(null)
  const [wallet_dusdc, set_wallet_dusdc] = useState<bigint | null>(null)
  const [optimistic, set_optimistic] = useState<bigint | null>(null)

  const [withdraw_open, set_withdraw_open] = useState(false)
  // The bet and the house live on the SAME scrolling page. `house_view` is a
  // pure presentation flag that smooth-scrolls the house section into focus (and
  // dims the chart under it) — it drops NO feature; HouseMode mounts always so
  // its TVL/position polls keep running whether it's in focus or not.
  const [house_view, set_house_view] = useState(false)
  const [bet, set_bet] = useState<OpenBet | null>(null)
  const [cashout_value, set_cashout_value] = useState<bigint | null>(null)
  // Cosmetic win streak — still persisted by finish_bet (localStorage + state)
  // even though the e05 skin doesn't render a streak chip. Value unread here.
  const [, set_streak] = useState<number>(load_streak)
  const [flash, set_flash] = useState<null | 'win' | 'lose'>(null)
  // GAINS/LOSS results log (V): recent settled outcomes, most recent first, capped
  // to ~5 rows. Accumulated as positions settle (finish_bet) and seeded from the
  // redeemed feed on load. Pure presentation — never feeds a tx.
  const RESULTS_CAP = 5
  const [results, set_results] = useState<CrashResult[]>([])

  // ----- reset trusted state on disconnect (nothing is read from localStorage) -
  // Manager id + open position are resolved from chain/indexer truth by the
  // effects below; on disconnect we simply clear them.
  useEffect(() => {
    if (!addr) {
      set_manager_id(null)
      set_bet(null)
      set_manager_balance(null)
      set_optimistic(null)
      set_wallet_dusdc(null)
    }
  }, [addr])

  // ----- poll oracle list (every 20s) and keep an active BTC oracle selected -
  const load_oracles = useCallback(async () => {
    try {
      const list = await fetch_oracles()
      set_oracles(list)
      set_oracle(prev => {
        const current = prev && find_oracle(list, prev.oracle_id)
        if (current && current.status === 'active') return current
        return pick_live_btc_oracle(list) ?? current ?? null
      })
    } catch (e) {
      set_error(`Could not load markets: ${(e as Error).message}`)
    }
  }, [])

  useEffect(() => {
    load_oracles()
    const id = setInterval(load_oracles, 20_000)
    return () => clearInterval(id)
  }, [load_oracles])

  // The oracle behind our held bet (may have left the active window).
  const bet_oracle: Oracle | null = useMemo(() => {
    if (!bet) return null
    return find_oracle(oracles, bet.oracle_id) ?? null
  }, [bet, oracles])

  // ----- compute strike (ATM) for the selected market -----
  const load_strike = useCallback(async (o: Oracle) => {
    try {
      const prices = await fetch_latest_prices(o.oracle_id)
      const spot_1e9 =
        prices.spot != null ? BigInt(Math.round(prices.spot)) : null
      set_spot(spot_1e9)
      const min = BigInt(Math.round(o.min_strike))
      const tick = BigInt(Math.round(strike_interval_of(o)))
      if (spot_1e9 != null) set_strike(snap_strike(spot_1e9, min, tick))
    } catch {
      // spot may be unavailable on a brand-new oracle; leave strike as-is.
    }
  }, [])

  // Keep the strike (and odds, below) polling even while a bet is HELD so the
  // bet controls stay LIVE for accumulation (Bug 4) — the user can add to a held
  // same-key position without the controls going inert. The held bet's OWN strike
  // is pinned separately (bet.strike_1e9 drives the chart + accumulation target),
  // so this re-snapping selectable strike never disturbs the held position.
  useEffect(() => {
    if (oracle) {
      load_strike(oracle)
      const id = setInterval(() => load_strike(oracle), 10_000)
      return () => clearInterval(id)
    }
  }, [oracle, load_strike])

  // ----- live ODDS via devInspect get_trade_amounts (UP & DOWN), every 5s ----
  const load_odds = useCallback(
    async (o: Oracle, strike_1e9: bigint) => {
      try {
        const expiry_ms = BigInt(o.expiry)
        const [up, down] = await Promise.all([
          read_trade_amounts(client, {
            oracle_id: o.oracle_id,
            expiry_ms,
            strike_1e9,
            is_up: true,
            quantity: PREVIEW_QUANTITY,
            sender: addr ?? undefined,
          }),
          read_trade_amounts(client, {
            oracle_id: o.oracle_id,
            expiry_ms,
            strike_1e9,
            is_up: false,
            quantity: PREVIEW_QUANTITY,
            sender: addr ?? undefined,
          }),
        ])
        set_up_cost(up.ask_cost)
        set_down_cost(down.ask_cost)
        set_up_pct(implied_pct_from_cost(up.ask_cost, PREVIEW_QUANTITY))
        set_down_pct(implied_pct_from_cost(down.ask_cost, PREVIEW_QUANTITY))
      } catch (e) {
        set_up_pct(null)
        set_down_pct(null)
        void e
      }
    },
    [client, addr],
  )

  useEffect(() => {
    if (oracle && strike != null && oracle.status === 'active') {
      load_odds(oracle, strike)
      const id = setInterval(() => load_odds(oracle, strike), 5_000)
      return () => clearInterval(id)
    }
  }, [oracle, strike, load_odds])

  // ----- refresh THE balance: manager internal balance + wallet dUSDC --------
  // Both are part of the single displayed number (manager + wallet). We never
  // sweep the wallet into the manager here — funding is lazy, at bet time.
  const refresh_balances = useCallback(async () => {
    if (!addr) return
    try {
      const { total } = await fetch_dusdc_coins(client, addr)
      set_wallet_dusdc(total)
    } catch {
      set_wallet_dusdc(null)
    }
    if (manager_id) {
      try {
        const bal = await read_manager_balance(client, manager_id, addr)
        set_manager_balance(bal)
        // The real balance is now known — drop any optimistic override.
        set_optimistic(null)
      } catch {
        // leave last known balance in place
      }
    } else {
      // No manager yet => nothing deposited; the wallet portion still counts.
      set_manager_balance(0n)
      set_optimistic(null)
    }
  }, [addr, client, manager_id])

  useEffect(() => {
    refresh_balances()
  }, [refresh_balances])

  // ----- LIVE CASH-OUT value while holding a bet (bid), every ~1.5s ----------
  const load_cashout = useCallback(async () => {
    if (!bet) return
    try {
      const r = await read_trade_amounts(client, {
        oracle_id: bet.oracle_id,
        expiry_ms: BigInt(bet.expiry_ms),
        strike_1e9: BigInt(bet.strike_1e9),
        is_up: bet.is_up,
        quantity: BigInt(bet.quantity),
        sender: addr ?? undefined,
      })
      set_cashout_value(r.bid_payout)
    } catch {
      // Not quoteable (e.g. pending_settlement freeze). Keep last value.
    }
  }, [bet, client, addr])

  useEffect(() => {
    if (!bet) {
      set_cashout_value(null)
      return
    }
    load_cashout()
    const id = setInterval(load_cashout, 1_500)
    return () => clearInterval(id)
  }, [bet, load_cashout])

  // Rising TICK as the live cash-out value climbs (cosmetic; reads state only).
  // We compare each new quote to the previous one and chirp on an increase while
  // a bet is held. sfx.tick() is internally throttled + a no-op before unlock.
  const prev_cashout = useRef<bigint | null>(null)
  useEffect(() => {
    if (bet && cashout_value != null) {
      const prev = prev_cashout.current
      if (prev != null && cashout_value > prev) sfx.tick()
      prev_cashout.current = cashout_value
      // Rising TENSION as the live cash-out sits near the coin-flip crossover
      // ($0.50 of $1 = the price hugging your entry line). closeness peaks at the
      // 50/50 knife-edge and falls off as the outcome gets decided either way.
      const payout = dusdc_to_usd(cashout_value)
      const closeness = Math.max(0, 1 - Math.abs(payout - 0.5) * 2)
      if (closeness > 0.4) sfx.tension(closeness)
    } else {
      prev_cashout.current = null
    }
  }, [bet, cashout_value])

  // ----- manager lifecycle ---------------------------------------------------
  // The id is resolved from CHAIN/INDEXER TRUTH (fetch_manager) on login and held
  // in React state for the session; after we create one we use the id straight
  // from objectChanges (no indexer round-trip). create_in_flight guards against
  // firing two create_manager txs (auto-create on login racing a manual bet).
  const create_in_flight = useRef(false)

  // Create the on-chain PredictManager (its own tx; read the new shared id from
  // objectChanges). Throws on failure so callers can surface it. Never persists
  // to localStorage — the id is recoverable from the indexer on the next load.
  const create_manager = useCallback(async (): Promise<string> => {
    if (!addr) throw new Error('Sign in first.')
    const tx = build_create_manager_tx()
    const res = await signAndExecute({ transaction: tx })
    const full = await client.waitForTransaction({
      digest: res.digest,
      options: { showObjectChanges: true },
    })
    const new_id = find_created_manager_id(
      full.objectChanges as
        | Array<{ type: string; objectType?: string; objectId?: string }>
        | undefined,
    )
    if (!new_id) throw new Error('Account created but id not found in changes.')
    set_manager_id(new_id)
    return new_id
  }, [addr, signAndExecute, client])

  // Resolve-or-create, used by the bet path. Resolves from the indexer first
  // (covers a reload where state was reset), only creating if truly none exists.
  const ensure_manager = useCallback(async (): Promise<string> => {
    if (manager_id) return manager_id
    if (!addr) throw new Error('Sign in first.')
    const existing = await fetch_manager(addr)
    if (existing) {
      set_manager_id(existing)
      return existing
    }
    if (create_in_flight.current)
      throw new Error('Setting up your account — try again in a moment.')
    create_in_flight.current = true
    set_busy('manager')
    try {
      return await create_manager()
    } finally {
      create_in_flight.current = false
      set_busy(null)
    }
  }, [manager_id, addr, create_manager])

  // ----- AUTO-RESOLVE + AUTO-CREATE manager on login (so betting is 1 tap) ----
  // On connect: resolve the manager from chain/indexer truth. If the user has
  // none, fire the sponsored create_manager invisibly so the first bet is
  // instant. This must NEVER block the read-only UI (odds/countdown), so it runs
  // detached and only sets state. Handles BOTH Enoki and fallback-wallet
  // connections identically (the first write either way needs a manager).
  useEffect(() => {
    if (!addr || manager_id || create_in_flight.current) return
    // Claim the in-flight slot SYNCHRONOUSLY, before any await — two effect
    // invocations (StrictMode / dep change) must never both pass the guard and
    // fire two create_manager txs (which would mint duplicate managers and split
    // the user's funds). The shared ref is also honoured by ensure_manager.
    create_in_flight.current = true
    let alive = true
    ;(async () => {
      try {
        const existing = await fetch_manager(addr)
        if (!alive) return
        if (existing) {
          set_manager_id(existing)
          return
        }
        const id = await create_manager()
        if (alive) set_manager_id(id)
      } catch {
        // Best-effort: a failure here just defers creation to the first bet
        // (ensure_manager retries). Never surfaced as a blocking error.
      } finally {
        create_in_flight.current = false
      }
    })()
    return () => {
      alive = false
    }
  }, [addr, manager_id, create_manager])

  // ----- RECONSTRUCT the open position from chain/indexer truth on load -------
  // A page reload wipes React state; recover any live bet from the indexer's
  // minted feed (never localStorage) so claim/cash-out keep working — minus any
  // position the redeemed feed shows as already claimed/cashed-out. We only
  // reconstruct when we are NOT already tracking one this session.
  //
  // SCOPED BY manager_id (NOT the wallet): Predict positions live under the
  // PredictManager, and the wallet-scoped indexer queries were verified STALE —
  // `/positions/minted?trader=<wallet>` missed the live open position (it
  // returned only an old, already-redeemed one) while the manager-scoped feed
  // returned the real open bet. So we wait for manager_id to resolve, then query
  // both minted + redeemed by it. (manager_id is auto-resolved on login by the
  // effect above; on a fresh account with no manager there is nothing to
  // reconstruct, so gating on it is correct.)
  //
  // On a fetch failure we do NOT clear/replace a known bet and do NOT treat the
  // user as having no open position (that would let them place a duplicate);
  // instead we surface a soft, non-blocking note and let the next poll retry.
  useEffect(() => {
    if (!addr || !manager_id || bet) return
    const mgr = manager_id
    let alive = true
    Promise.all([fetch_minted(mgr), fetch_redeemed(mgr), fetch_oracles()])
      .then(([minted, redeemed, list]) => {
        if (!alive) return
        set_reconstruct_failed(false)
        const open = reconstruct_open_bet(minted, redeemed, list)
        if (open) set_bet(open)
      })
      .catch(() => {
        if (alive) set_reconstruct_failed(true)
      })
    return () => {
      alive = false
    }
  }, [addr, manager_id, bet])

  // ----- AUTO-CLAIM ALL settled WINS on load (one sponsored PTB) -------------
  // On load (once the manager + feeds resolve), sweep EVERY settled + won +
  // unclaimed position into a SINGLE router::claim batch. The held-bet auto-claim
  // (claimed_ref effect below) only handles the one open position we display;
  // this catches every OTHER claimable position (e.g. older settled wins the
  // reconstruct view never surfaces). We gather them from the manager-scoped
  // minted/redeemed feeds + the oracle list (same truth as reconstruct), build
  // ONE Transaction with one claim per position, and run it through the EXISTING
  // sponsored signAndExecute unchanged. Guarded to fire ONCE per manager (the
  // ref is keyed to the manager id) and only when there is something to claim —
  // no toast spam, no double-fire across StrictMode / re-renders. On success we
  // refresh balances so the swept winnings show; failures are swallowed (the
  // per-position held auto-claim and the next load both retry).
  const claim_all_for_ref = useRef<string | null>(null)
  useEffect(() => {
    if (!addr || !manager_id) return
    const mgr = manager_id
    if (claim_all_for_ref.current === mgr) return
    claim_all_for_ref.current = mgr
    let alive = true
    ;(async () => {
      try {
        const [minted, redeemed, list] = await Promise.all([
          fetch_minted(mgr),
          fetch_redeemed(mgr),
          fetch_oracles(),
        ])
        if (!alive) return
        const claimable = gather_claimable_positions(mgr, minted, redeemed, list)
        if (claimable.length === 0) return // nothing to do — stay quiet
        const tx = build_claim_all_tx(claimable)
        const res = await signAndExecute({ transaction: tx })
        await client.waitForTransaction({ digest: res.digest })
        if (!alive) return
        refresh_balances()
      } catch {
        // Best-effort sweep: allow a retry on the next manager resolution.
        if (alive) claim_all_for_ref.current = null
      }
    })()
    return () => {
      alive = false
    }
  }, [addr, manager_id, signAndExecute, client, refresh_balances])

  // ----- SEED the GAINS/LOSS log from the redeemed feed on load (V, bonus) -----
  // So past results show after a refresh. Fires ONCE per manager (ref-keyed),
  // read-only — it never signs anything. Session settles (finish_bet) PREPEND
  // their exact-number rows on top; the seed only backfills history. We don't
  // clobber rows already captured this session: seed only when the log is empty.
  const seeded_results_ref = useRef<string | null>(null)
  useEffect(() => {
    if (!addr || !manager_id) return
    const mgr = manager_id
    if (seeded_results_ref.current === mgr) return
    seeded_results_ref.current = mgr
    let alive = true
    Promise.all([fetch_minted(mgr), fetch_redeemed(mgr), fetch_oracles()])
      .then(([minted, redeemed, list]) => {
        if (!alive) return
        const past = gather_settled_results(minted, redeemed, list)
        if (past.length === 0) return
        set_results(prev => (prev.length > 0 ? prev : past.slice(0, RESULTS_CAP)))
      })
      .catch(() => {
        // Best-effort backfill — allow a retry on the next manager resolution.
        if (alive) seeded_results_ref.current = null
      })
    return () => {
      alive = false
    }
  }, [addr, manager_id])

  // NOTE: no eager wallet->manager sweep. Funding is LAZY — `place_bet` funds
  // exactly the shortfall (cost + small buffer) from the wallet via the bet PTB's
  // payment coin, so we never surprise the user by moving their whole balance.

  // ----- PLACE BET (lazy-funded payment coin + router::bet in one PTB) -----
  const place_bet = useCallback(
    async (is_up: boolean) => {
      // GLOBAL LOCK guard: a second click while any sponsored write is mid-flight
      // (e.g. Enoki slow to sign) is a hard no-op.
      if (tx_pending) return
      set_error(null)
      set_notice(null)
      set_notice_kind(null)
      if (!addr) {
        set_error('Sign in first.')
        return
      }
      if (!oracle || strike == null) {
        set_error('No live market yet — try again in a moment.')
        return
      }
      // ACCUMULATION (Bug 4): if a bet on the SAME side is already held and its
      // round is still active, bet AGAIN onto the EXACT same on-chain MarketKey
      // (oracle_id, expiry, strike, is_up) — the router::bet -> predict::mint path
      // accumulates quantity on that key automatically (no contract change). We
      // therefore pin the bet target to the HELD position's values (not the freely
      // re-snapping selectable strike) so the second bet truly lands on the same
      // key and adds to it. A different-side / different-strike bet stays out of
      // scope (we have one open-position slot); only same-key add is supported.
      // Belt + suspenders: a held bet locks the side. Adding the same side
      // accumulates; the opposite side is rejected (would orphan the held one).
      if (bet != null && bet.is_up !== is_up) {
        set_error('You hold a bet this round — add to it or cash out first.')
        return
      }
      const accumulate =
        bet != null && bet.is_up === is_up && oracle.status === 'active'
      const tgt_oracle_id = accumulate ? bet.oracle_id : oracle.oracle_id
      const tgt_expiry_ms = accumulate ? bet.expiry_ms : oracle.expiry
      const tgt_strike = accumulate ? BigInt(bet.strike_1e9) : strike
      if (oracle.status !== 'active') {
        set_error('Market is not open for new bets right now.')
        return
      }
      // Per-contract preview cost for this side. The STAKE is what truly LEAVES
      // the wallet (cost + 3% rake), so we size `quantity` (whole contracts) so
      // the DEBIT ≈ the stake; the WIN headline is then the binary payout ($1 ×
      // contracts) > the stake.
      const cost_unit = is_up ? up_cost : down_cost
      if (cost_unit == null) {
        set_error('Odds not loaded yet — wait a second and retry.')
        return
      }
      const quantity = quantity_for_stake(stake_usd, cost_unit)
      const cost = cost_for_quantity(cost_unit, quantity)
      // The HONEST "paid" figure = the bare mint cost + the on-chain 3% router
      // rake — the exact amount that leaves the wallet. This is what we display as
      // PAID and deduct optimistically, so the numbers reconcile to the penny.
      const debit = debit_with_rake(cost)
      // The manager must hold the mint cost plus headroom (covers the future
      // on-chain 3% router rake + quote-vs-execution price drift). The optimistic
      // RED drop shows the real debit; the small headroom stays in the manager.
      const need = bet_amount_with_buffer(cost)
      // Spendable = manager + wallet (the single displayed number).
      const spendable = (manager_balance ?? 0n) + (wallet_dusdc ?? 0n)
      if (spendable < need) {
        set_error(
          `Not enough funds. Need ~${fmt_usd(need)}; add test funds below.`,
        )
        return
      }

      // Optimistic: drop the single (manager + wallet) balance instantly by the
      // TRUE debit, in red. The router skims a 3% rake on-chain on top of `cost`,
      // so the user actually parts with cost + rake (== `debit`) — deduct both or
      // the balance drifts ~3% high per bet. This is the SAME number we display as
      // PAID, so the balance drop and PAID always agree. Reconciled on confirm.
      const total_spend = debit
      const optimistic_after = spendable > total_spend ? spendable - total_spend : 0n
      set_optimistic(optimistic_after)
      set_busy(is_up ? 'bet-up' : 'bet-down')
      set_tx_pending(true)
      try {
        // Resolve-or-create the manager (chain/indexer truth), then read its
        // on-chain balance so we fund only the SHORTFALL. The router deposits our
        // payment coin into the manager, so payment only needs need - balance.
        const mgr = await ensure_manager()
        let on_chain = manager_balance
        try {
          on_chain = await read_manager_balance(client, mgr, addr)
          set_manager_balance(on_chain)
        } catch {
          // keep last known
        }
        // Lazy funding: the payment coin is EXACTLY the shortfall (need - manager
        // balance). It may be 0 (manager already covers it) — the router deposits
        // a 0-value coin harmlessly. The payment coin must be split from a real
        // Coin<DUSDC>, so at least one wallet dUSDC coin is always required.
        const shortfall = (on_chain ?? 0n) >= need ? 0n : need - (on_chain ?? 0n)
        const { total, coin_ids } = await fetch_dusdc_coins(client, addr)
        if (coin_ids.length === 0 || (shortfall > 0n && total < shortfall)) {
          set_optimistic(null)
          set_error(
            `Not enough funds. Need ~${fmt_usd(need)} in your balance; ` +
              `add test funds (button below).`,
          )
          return
        }

        // The market may have flipped to pending_settlement during the awaits
        // above (manager creation / balance read). Re-check the live oracle
        // status right before sending — minting into a non-active market aborts.
        const fresh = find_oracle(await fetch_oracles(), tgt_oracle_id)
        if (!fresh || fresh.status !== 'active') {
          set_optimistic(null)
          set_error('Market just closed for new bets — pick the next round.')
          return
        }

        const tx = build_bet_tx({
          manager_id: mgr,
          oracle_id: tgt_oracle_id,
          expiry_ms: BigInt(tgt_expiry_ms),
          strike_1e9: tgt_strike,
          is_up,
          quantity,
          payment_amount: shortfall,
          dusdc_coin_ids: coin_ids,
        })
        const res = await signAndExecute({ transaction: tx })
        await client.waitForTransaction({ digest: res.digest })
        // Session position (React state only — never localStorage). A reload
        // recovers the same position from the indexer via reconstruct_open_bet.
        // ACCUMULATE: when this was an add onto a held same-key position, SUM the
        // on-chain-accumulated quantity + the displayed cost into the existing
        // bet; otherwise this is a fresh position.
        // PAID accumulates the DEBIT (cost + rake) — what actually left the wallet
        // — so two "$1" bets read as the sum of the real charges, matching the
        // balance drop. Display-only; never feeds a tx.
        const new_bet: OpenBet = accumulate
          ? {
              ...bet,
              quantity: (BigInt(bet.quantity) + quantity).toString(),
              cost_1e6: (BigInt(bet.cost_1e6) + debit).toString(),
            }
          : {
              oracle_id: tgt_oracle_id,
              expiry_ms: tgt_expiry_ms,
              strike_1e9: tgt_strike.toString(),
              is_up,
              quantity: quantity.toString(),
              cost_1e6: debit.toString(),
            }
        set_bet(new_bet)
        sfx.placed()
        sfx.whoosh()
        set_notice('In. Watch it move — cash out before it crashes.')
        set_notice_kind(null)
        refresh_balances()
      } catch (e) {
        // Revert the optimistic drop and reconcile to truth.
        set_optimistic(null)
        refresh_balances()
        set_error(`Bet failed: ${(e as Error).message}`)
      } finally {
        set_busy(null)
        set_tx_pending(false)
      }
    },
    [
      addr,
      oracle,
      strike,
      up_cost,
      down_cost,
      stake_usd,
      wallet_dusdc,
      client,
      manager_balance,
      ensure_manager,
      signAndExecute,
      refresh_balances,
      bet,
      tx_pending,
    ],
  )

  // Push one settled outcome onto the GAINS/LOSS log (V), most-recent-first,
  // capped. Dedup by id (epoch ms) is implicit — each settle calls this once via
  // finish_bet. Pure presentation; never feeds a tx.
  const push_result = useCallback(
    (is_up: boolean, won: boolean, pnl_usd: number) => {
      const row: CrashResult = {
        id: Date.now(),
        isUp: is_up,
        won,
        pnlUsd: pnl_usd,
      }
      set_results(prev => [row, ...prev].slice(0, RESULTS_CAP))
    },
    [],
  )

  // ----- finish a bet: update streak, clear local state, flash result -----
  // `is_up` + `cost_1e6` describe the position that just settled (the live `bet`
  // is cleared below), so we can fire the concise win/loss TOAST (T + U) and log
  // the GAINS/LOSS row (V) with the REAL P&L = payout − the all-in debit.
  const finish_bet = useCallback(
    (
      won: boolean,
      payout: bigint | null,
      is_up: boolean,
      cost_1e6: bigint,
    ) => {
      if (!addr) return
      set_flash(won ? 'win' : 'lose')
      // REAL P&L: what landed (payout) minus what truly left the wallet (the
      // all-in debit = cost + 3% rake, already baked into bet.cost_1e6). On a loss
      // the payout is 0, so the P&L is the whole debit (negative).
      const pnl_units = (payout ?? 0n) - cost_1e6
      const pnl_usd = dusdc_to_usd(pnl_units)
      const won_usd = dusdc_to_usd(payout ?? 0n)
      const loss_usd = dusdc_to_usd(cost_1e6)
      // Concise, COLOURED settle toast — replaces the old long cropped string.
      if (won) {
        set_error(null)
        // Win flair (the 🎉 emoji) is now a Boxicons trophy rendered by the e05
        // skin (.e05-toast.win::before); the message string stays emoji-free.
        set_notice(`You won ${fmt_usd_compact(won_usd)}`)
        set_notice_kind('win')
      } else {
        set_error(null)
        set_notice(`You lost ${fmt_usd_compact(loss_usd)}`)
        set_notice_kind('loss')
      }
      // GAINS/LOSS log row (V).
      push_result(is_up, won, pnl_usd)
      if (won) {
        sfx.win()
        sfx.coin_shower()
      } else {
        sfx.loss()
        sfx.deflate()
      }
      setTimeout(() => set_flash(null), 1800)
      if (won) {
        const s = load_streak() + 1
        localStorage.setItem(LS_STREAK, String(s))
        set_streak(s)
      } else {
        localStorage.setItem(LS_STREAK, '0')
        set_streak(0)
        // Loss: staked amount was already deducted at bet time. No change.
      }
      // ONE reconcile: bump the CURRENTLY-DISPLAYED total up by the payout once
      // (green count-up), then a single refresh_balances() snaps it to truth.
      // Basing the bump on the displayed total (optimistic ?? manager+wallet)
      // rather than manager-only avoids a ghost flash (bump→snap→bump).
      if (won && payout != null && payout > 0n) {
        const displayed =
          optimistic ?? (manager_balance ?? 0n) + (wallet_dusdc ?? 0n)
        set_optimistic(displayed + payout)
      }
      set_bet(null)
      set_cashout_value(null)
      refresh_balances()
    },
    [
      addr,
      optimistic,
      manager_balance,
      wallet_dusdc,
      refresh_balances,
      push_result,
    ],
  )

  // ----- CASH OUT (redeem at live bid) -> lands in the manager balance -----
  const cash_out = useCallback(async () => {
    // GLOBAL LOCK guard: ignore a click while another sponsored write is pending.
    if (tx_pending) return
    if (!addr || !bet || !manager_id) return
    set_error(null)
    // Engage the lock for the whole flow (including the async oracle re-check
    // below) so no other action can start while this is resolving.
    set_tx_pending(true)
    set_busy('cashout')
    try {
      // Early redeem needs a LIVE, quoteable oracle. Re-check status at call time
      // (it can roll between render and tap): once it's pending_settlement/settled
      // a cash_out tx is guaranteed to abort — bail with a clear message instead.
      const fresh = find_oracle(await fetch_oracles(), bet.oracle_id)
      if (!fresh || fresh.status !== 'active') {
        set_error('Round settling — you can claim once it settles.')
        return
      }
      const tx = build_cash_out_tx({
        manager_id,
        oracle_id: bet.oracle_id,
        expiry_ms: BigInt(bet.expiry_ms),
        strike_1e9: BigInt(bet.strike_1e9),
        is_up: bet.is_up,
        quantity: BigInt(bet.quantity),
      })
      const res = await signAndExecute({ transaction: tx })
      await client.waitForTransaction({ digest: res.digest })
      const payout = cashout_value ?? 0n
      const won = payout > BigInt(bet.cost_1e6)
      // finish_bet fires the concise, COLOURED win/loss toast (T) + logs the
      // result (V); no separate "Cashed out…" line (it would clobber the toast).
      finish_bet(won, payout, bet.is_up, BigInt(bet.cost_1e6))
    } catch (e) {
      set_error(`Cash out failed: ${(e as Error).message}`)
    } finally {
      set_busy(null)
      set_tx_pending(false)
    }
  }, [addr, bet, manager_id, cashout_value, client, signAndExecute, finish_bet, tx_pending])

  // ----- CLAIM settled (redeem_permissionless) — the in-app auto-claim path --
  const claim = useCallback(async () => {
    if (!addr || !bet || !manager_id) return
    // Claim is only valid once the oracle is SETTLED with a published
    // settlement_price. Re-check status at call time (it can roll between render
    // and tap). A settled binary pays exactly $1×qty
    // (win) or $0 (loss) — decided by the on-chain settlement_price, NOT the live
    // cashout quote (which can be stale and flash a fake WIN). If the price isn't
    // published yet the market hasn't truly settled: bail and let the next poll
    // retry. We read the FRESH oracle, not the possibly-stale bet_oracle state.
    const fresh = find_oracle(await fetch_oracles(), bet.oracle_id)
    const settle_1e9 = fresh?.settlement_price
    if (!fresh || fresh.status !== 'settled' || settle_1e9 == null) return
    const settlement = BigInt(Math.round(settle_1e9))
    const strike = BigInt(bet.strike_1e9)
    const won = bet.is_up ? settlement >= strike : settlement < strike
    const settled_payout = won ? BigInt(bet.quantity) : 0n
    set_error(null)
    set_busy('claim')
    // Engage the GLOBAL lock for the signing window. claim() is shared by the
    // user CTA AND the (non-user) auto-claim effect; either way, while a claim is
    // actually mid-flight no other action may start. The user CTA is guarded at
    // the claimBet action wrapper; the auto-claim effect is gated on !tx_pending.
    set_tx_pending(true)
    try {
      const tx = build_claim_tx({
        manager_id,
        oracle_id: bet.oracle_id,
        expiry_ms: BigInt(bet.expiry_ms),
        strike_1e9: strike,
        is_up: bet.is_up,
        quantity: BigInt(bet.quantity),
      })
      const res = await signAndExecute({ transaction: tx })
      await client.waitForTransaction({ digest: res.digest })
      // U: the old long "Settled — winnings landed…automatically." string was
      // cropped by the toast. finish_bet now fires the concise, COLOURED win/loss
      // toast (T) instead and logs the result (V); no separate settle string.
      finish_bet(won, settled_payout, bet.is_up, BigInt(bet.cost_1e6))
    } catch (e) {
      // Idempotency: if the position was ALREADY redeemed (a previous claim
      // already landed, e.g. across a reload), the redeem aborts.
      // That's not a user-facing failure — the winnings are/were paid. Clear the
      // bet quietly (treat as claimed) instead of showing a scary error that
      // would otherwise re-fire every poll forever.
      const msg = (e as Error).message ?? ''
      if (is_already_redeemed_error(msg)) {
        set_bet(null)
        set_cashout_value(null)
        refresh_balances()
      } else {
        set_error(`Auto-claim failed: ${msg}`)
      }
    } finally {
      set_busy(null)
      set_tx_pending(false)
    }
  }, [addr, bet, manager_id, client, signAndExecute, finish_bet, refresh_balances])

  // ----- WITHDRAW to wallet (round-trip cash-out) -----
  // Moves the manager's internal balance OUT to the wallet. Because the single
  // displayed number already counts manager + wallet, the total is unchanged by
  // a withdraw — so we don't animate it; we just reconcile after it confirms.
  const withdraw_all = useCallback(async () => {
    // GLOBAL LOCK guard: ignore a click while another sponsored write is pending.
    if (tx_pending) return
    if (!addr || !manager_id) return
    const amount = manager_balance ?? 0n
    if (amount <= 0n) {
      set_error('Nothing in your manager balance to move to the wallet.')
      return
    }
    set_error(null)
    set_busy('withdraw')
    set_tx_pending(true)
    try {
      const tx = build_withdraw_tx({
        manager_id,
        amount,
      })
      const res = await signAndExecute({ transaction: tx })
      await client.waitForTransaction({ digest: res.digest })
      set_withdraw_open(false)
      set_notice(`Moved ${fmt_usd(amount)} to your wallet.`)
      set_notice_kind(null)
      refresh_balances()
    } catch (e) {
      refresh_balances()
      set_error(`Withdraw failed: ${(e as Error).message}`)
    } finally {
      set_busy(null)
      set_tx_pending(false)
    }
  }, [addr, manager_id, manager_balance, client, signAndExecute, refresh_balances, tx_pending])

  // ----- derived display values -----
  const expiry_ms_left = bet
    ? bet.expiry_ms - now
    : oracle
      ? oracle.expiry - now
      : 0
  const countdown = fmt_countdown(expiry_ms_left)
  const cd_class =
    expiry_ms_left <= 0 ? 'dead' : expiry_ms_left < 60_000 ? 'urgent' : ''
  // Split mm / ss so the e05 masthead can grey the seconds; both come from the
  // SAME `countdown` string the app already derives — no new clock.
  const [cd_mm, cd_ss] = countdown.split(':')

  // ----- THE LOCK WINDOW — the REAL "betting sealed" guard, mapped onto e05's
  // .e05-is-locked seam. pick_live_btc_oracle only selects oracles with
  // expiry > now + 15_000 (api.ts), and place_bet re-checks oracle.status==='active'
  // right before send; so a market is genuinely unbettable in its final 15s OR
  // once it leaves 'active'. We surface that here as ONE boolean that (a) toggles
  // the root .e05-is-locked class (CSS fades the buttons/chips inert + reveals the
  // betstatus line) and (b) composes into the existing button `disabled` props
  // (belt + suspenders). This is a PRESENTATION flag only — it never bypasses the
  // contract's own status check inside place_bet. Only meaningful pre-bet (the
  // held-position view replaces the bet controls entirely).
  const locked =
    !bet &&
    (!oracle || oracle.status !== 'active' || expiry_ms_left <= 15_000)
  // Lock-drain hairline fills over the FINAL 60s (matches the existing `urgent`
  // cue at <60s); always BLUE chrome, clamped 0..1. 0 when the round is calm.
  const lock_frac =
    expiry_ms_left > 0 && expiry_ms_left < 60_000
      ? Math.max(0, Math.min(1, 1 - expiry_ms_left / 60_000))
      : expiry_ms_left <= 0
        ? 1
        : 0

  // ----- THE VALIDATING-ROUND PHASE — round over / settling, no live round -----
  // This is the phase AFTER a round's oracle passes expiry (or flips to
  // pending_settlement / settled) and BEFORE a fresh active round is selected.
  // pick_live_btc_oracle only selects oracles with expiry > now + 15s, so between
  // rounds the held `oracle` is stale (past expiry / not active) and there is no
  // bettable round yet — exactly the window the masthead must label "VALIDATING
  // ROUND" instead of flashing the 3 dots. It is DISTINCT from `locked` (the
  // earlier final-15s pre-expiry lock, where the oracle is STILL active with a
  // future expiry). Only meaningful pre-bet — a held position drives its own
  // settling/claim view. Presentation only; never gates a tx.
  const validating =
    !bet &&
    (oracle == null ||
      oracle.status === 'pending_settlement' ||
      oracle.status === 'settled' ||
      oracle.expiry <= now)
  // The ~15s settlement window is derivable from the round's own expiry: it runs
  // from oracle.expiry to oracle.expiry + 15s. Show the seconds left while the
  // window is live; null once it elapses (then the label + hairline loader carry
  // the state with no stale counter).
  const validating_secs =
    validating && oracle != null
      ? Math.max(0, Math.ceil((oracle.expiry + 15_000 - now) / 1000)) || null
      : null
  // While validating we FREEZE every live display number at its round-end value.
  // We keep a ref of the last NON-validating snapshot of the volatile figures and
  // serve those while validating, so nothing drifts during the window; when the
  // next round goes active `validating` clears and the live values resume.
  const frozen = validating

  const bet_settled = bet_oracle?.status === 'settled'
  const bet_pending = bet_oracle?.status === 'pending_settlement'
  const bet_expired = bet ? bet.expiry_ms <= now : false
  // A position is only finalizable once the oracle has published its
  // settlement_price; "settled" status can briefly precede the price landing.
  const bet_claimable = bet_settled && bet_oracle?.settlement_price != null

  // AUTO-CLAIM: when the held bet's oracle reports "settled", fire
  // redeem_permissionless once, invisibly (sponsored when on Enoki).
  const claimed_ref = useRef(false)
  useEffect(() => {
    // Gate on !tx_pending too: if another action holds the global lock we DON'T
    // claim yet (and don't burn the once-per-bet claimed_ref) — the effect
    // re-runs when tx_pending clears and fires then.
    if (bet && bet_claimable && !busy && !tx_pending && !claimed_ref.current) {
      claimed_ref.current = true
      claim()
    }
    if (!bet) claimed_ref.current = false
  }, [bet, bet_claimable, busy, tx_pending, claim])

  const cost_now = bet ? BigInt(bet.cost_1e6) : 0n
  const delta_usd =
    bet && cashout_value != null
      ? dusdc_to_usd(cashout_value) - dusdc_to_usd(cost_now)
      : 0
  const winning = bet && cashout_value != null && cashout_value > cost_now

  // The AUTHORITATIVE chart-tint verdict — the SAME source as the cash-out card,
  // so the line and the card can never disagree (Bug 2). While the round is live
  // we use the live bid-vs-cost P&L (`winning`); once the oracle has published a
  // settlement_price we switch to the SETTLEMENT verdict (price-vs-strike, the
  // identical rule claim() uses at ~899), because the live bid quote freezes/
  // staleness can flash a fake result post-expiry. null when no bet is held.
  const chart_winning: boolean | null =
    !bet
      ? null
      : bet_oracle?.status === 'settled' &&
          bet_oracle.settlement_price != null
        ? bet.is_up
          ? BigInt(Math.round(bet_oracle.settlement_price)) >=
            BigInt(bet.strike_1e9)
          : BigInt(Math.round(bet_oracle.settlement_price)) <
            BigInt(bet.strike_1e9)
        : cashout_value != null
          ? cashout_value > cost_now
          : null

  // Cash-out meter fill: how much of max payout ($1) the live bid is worth.
  const meter_pct =
    cashout_value != null
      ? Math.max(2, Math.min(100, dusdc_to_usd(cashout_value) * 100))
      : 0

  const signed_in = Boolean(addr)

  // THE displayed number = manager internal balance + wallet-held dUSDC. Null
  // only until the very first read lands.
  const total_balance =
    manager_balance == null && wallet_dusdc == null
      ? null
      : (manager_balance ?? 0n) + (wallet_dusdc ?? 0n)

  // ----- THE WAGER (constant) + per-side QUANTITY ------------------------------
  // STANDARD FIXED-STAKE BINARY MODEL. The selected stake IS the WAGER — the
  // single amount the user PAYS, IDENTICAL whether they pick UP or DOWN. Switching
  // sides never changes the wager. We size `quantity` PER SIDE (each side has its
  // own per-contract ask) so the on-chain DEBIT lands as close to the wager as
  // whole-contract granularity allows — typically within a few cents. The WAGER we
  // DISPLAY is the stake itself (one constant), NOT the per-side realized debit:
  // surfacing each side's tiny rounding drift as "you pay $X" made the wager LOOK
  // like it changed per side, which is exactly what this model removes. The exact
  // realized charge is still shown post-bet as "PAID $X" in the held view.
  const up_qty = up_cost != null ? quantity_for_stake(stake_usd, up_cost) : null
  const down_qty =
    down_cost != null ? quantity_for_stake(stake_usd, down_cost) : null
  // Per-side realized debit (cost + 3% rake) — kept ONLY as a "quote loaded"
  // signal for the enable gating below; it is NOT displayed (the displayed wager
  // is the constant stake). The actual debit ≈ the wager within granularity.
  const up_cost_stake =
    up_cost != null && up_qty != null
      ? debit_with_rake(cost_for_quantity(up_cost, up_qty))
      : null
  const down_cost_stake =
    down_cost != null && down_qty != null
      ? debit_with_rake(cost_for_quantity(down_cost, down_qty))
      : null

  // ----- PER-SIDE PAYOUT (the DIFFERING number) — pure read of existing odds ----
  // A winning binary pays $1 per contract. With the constant WAGER sized into
  // `quantity` contracts, the WIN payout = contracts × $1, and it DIFFERS per side
  // because UP and DOWN have different implied odds — the less-likely side fits
  // more contracts for the same wager, so it WINS more. The per-side multiple is
  //   multiple = win / WAGER          (payout relative to what you pay — constant)
  // computed against the SAME constant wager both buttons show, so the multiple and
  // the displayed wager always agree. Early in a round the outcome is ~50/50 so a
  // side pays ~2x the wager; near expiry a near-certain side pays a thin multiple.
  // Entirely from the REAL get_trade_amounts cost — nothing invented, no extra RPC.
  type Payout = {
    is_up: boolean
    payout_usd: number
    multiple: number
  } | null
  const payout_of = (
    cost_unit: bigint | null,
    is_up: boolean,
  ): Payout => {
    if (cost_unit == null || cost_unit <= 0n || stake_usd <= 0) return null
    const win_usd = win_for_stake(stake_usd, cost_unit)
    return {
      is_up,
      payout_usd: win_usd, // contracts × $1 — the real binary payout (differs per side)
      multiple: win_usd / stake_usd, // payout vs the constant wager
    }
  }
  const up_payout = payout_of(up_cost, true)
  const down_payout = payout_of(down_cost, false)

  // Total dUSDC required to place a bet of `cost` (cost + on-chain 3% rake).
  const required_for = (cost: bigint): bigint =>
    cost + (cost * ROUTER_FEE_BPS) / 10_000n
  // With the new sizing the cost ≈ the stake regardless of side/odds, so
  // affordability is simply "balance covers the stake + the 3% rake". Pre-connect
  // (balance unknown) everything is allowed — odds/preview work without funds.
  const can_afford = useCallback(
    (usd: number): boolean => {
      if (total_balance == null) return true
      const stake_units = BigInt(Math.max(1, Math.round(usd))) * DUSDC_SCALE
      return total_balance >= required_for(stake_units)
    },
    [total_balance],
  )
  // Largest affordable whole-$ stake (for the Custom "max $X" hint + clamp). With
  // the new sizing the stake IS the spend, so the cap is balance / (1 + 3% rake),
  // in whole dollars (1e6 base units per $).
  const max_affordable_usd: number | null =
    total_balance == null
      ? null
      : Math.max(
          0,
          Math.floor(
            Number(
              (total_balance * 10_000n) /
                (DUSDC_SCALE * (10_000n + ROUTER_FEE_BPS)),
            ),
          ),
        )
  // The optimistic override is computed against `spendable` (manager + wallet)
  // in place_bet, so it already represents the post-bet TOTAL — pass it straight.
  const has_money = (total_balance ?? 0n) > 0n
  const wallet_empty = signed_in && (total_balance ?? 0n) <= 0n

  // ----- DRIVE THE LIVE CHART (EtherChart): a rolling time-series of the SAME
  // oracle spot the app already fetches (fetch_latest_prices -> `spot`, 1e9). We
  // SAMPLE that live spot into a fixed-cadence ring buffer (1s × ~150 pts ≈ a
  // 2.5-min window) so the 1.5s/5s/10s polls never make the line jump; EtherChart
  // reads the buffer + the eased live price every frame (smoothing only — the
  // sampled vertices ARE the truth, no invented prices). All values are plain USD
  // (EtherChart's contract); we convert the 1e9-scaled spot/strike here. NOTHING
  // here touches a tx or the frozen write path — it is pure read of existing state.
  const CHART_MAX_POINTS = 150
  const CHART_SAMPLE_MS = 1000
  // The SAME array reference is passed to EtherChart, which reads it live each
  // frame; we mutate it in place (no re-mount on poll). `spot_ref` always holds
  // the freshest live spot so the interval samples truth even between polls.
  const chart_samples_ref = useRef<number[]>([])
  const spot_ref = useRef<number | null>(null)
  spot_ref.current = spot != null ? Number(spot) / 1e9 : null
  useEffect(() => {
    const sample = () => {
      const v = spot_ref.current
      if (v == null || !Number.isFinite(v)) return
      const buf = chart_samples_ref.current
      buf.push(v)
      if (buf.length > CHART_MAX_POINTS) buf.shift()
    }
    sample()
    const id = setInterval(sample, CHART_SAMPLE_MS)
    return () => clearInterval(id)
  }, [])

  // Live USD props for EtherChart (plain numbers; it tints the line vs strike +
  // draws the dashed ENTRY/STRIKE line itself from side + strike).
  const chart_price_usd = spot != null ? Number(spot) / 1e9 : null
  const chart_strike_usd = bet
    ? Number(BigInt(bet.strike_1e9)) / 1e9
    : strike != null
      ? Number(strike) / 1e9
      : null
  const chart_side: 'UP' | 'DOWN' | null = bet
    ? bet.is_up
      ? 'UP'
      : 'DOWN'
    : null

  // Smooth-scroll the HOUSE section into focus when the toggle flips it on (the
  // house lives on the SAME page now, below the bet — not a separate view).
  useEffect(() => {
    const el = document.getElementById(house_view ? 'house-section' : 'bet-top')
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [house_view])

  // Countdown heartbeat: a subtle sub-pulse in the final 5s of a held round.
  const beat_ref = useRef(false)
  useEffect(() => {
    const final5 = bet != null && expiry_ms_left > 0 && expiry_ms_left <= 5_000
    if (final5 && !beat_ref.current) {
      sfx.heartbeat()
      beat_ref.current = true
      setTimeout(() => {
        beat_ref.current = false
      }, 900)
    }
  }, [bet, expiry_ms_left])

  // e05 bet-button view-models: the WIN number is the binary PAYOUT (contracts ×
  // $1 — what THIS side pays if it's right). It DIFFERS per side (different odds),
  // while the WAGER (the stake) stays constant. The multiple (win / wager) comes
  // straight from the REAL get_trade_amounts quote (up_payout/down_payout).
  // "Double your money" shows in the [1.8, 2.3] band. Fallback to ~2x the wager
  // before a quote lands so the headline never reads below the wager.
  const up_win = up_payout?.payout_usd ?? stake_usd * 2
  const down_win = down_payout?.payout_usd ?? stake_usd * 2
  const up_mult = up_payout?.multiple ?? null
  const down_mult = down_payout?.multiple ?? null
  const is_double = (m: number | null): boolean =>
    m != null && m >= 1.8 && m <= 2.3

  // ----- FREEZE SNAPSHOT — hold the live numbers at their round-end values -----
  // While `validating`, every volatile display figure must STOP moving and hold
  // what it read at the moment the round ended: the live price (chart head +
  // tag), the per-side payouts/multiples, and the balance the bet figures derive
  // from. We keep a ref of the last NON-validating snapshot of those values and
  // serve it while validating; once the next round goes active `validating`
  // clears and the live values flow again. The odds poll is already gated on
  // `oracle.status === 'active'` so up/down cost stop refreshing on their own —
  // this snapshot makes the freeze explicit + also pins the live price (which
  // otherwise keeps polling) and the balance text. Pure presentation; the snapshot
  // never feeds a tx and the underlying state keeps reconciling underneath.
  const frozen_snapshot = useRef<{
    chartPriceUsd: number | null
    upWin: number
    downWin: number
    upMult: number | null
    downMult: number | null
    balanceStr: string
  }>({
    chartPriceUsd: null,
    upWin: stake_usd * 2,
    downWin: stake_usd * 2,
    upMult: null,
    downMult: null,
    balanceStr: '—',
  })

  // ----- THE HOUSE (LP) LOGIC — headless hook; the ported e05 footer renders it.
  // All vault data + the router::supply / redeem_lp write path live here exactly
  // as before (extracted verbatim from the old HouseMode). signAndExecute is the
  // SAME frozen gasless path; on_balance_change refreshes the shared bet balance.
  const house = useHouse({
    address: addr,
    client,
    signAndExecute,
    on_balance_change: refresh_balances,
    balance_usd: total_balance != null ? dusdc_to_usd(total_balance) : null,
  })

  // ----- LIVE "Placing now" TAPE — ambient social proof (ZERO gameplay). No
  // global per-bet feed exists in the indexer yet, so this is SIMULATED client-
  // side (clearly flavour; identical to the prototype's stub stream). Swap the
  // emitter for a real global-feed poller later — nothing else changes.
  const [tape, set_tape] = useState<CrashTapeRow[]>([])
  useEffect(() => {
    const NAMES = [
      'satoshi_jr', '0xVibe', 'moonfarmer', 'cleo', 'tarp', 'gm_anon',
      'liquid.sui', 'nakamoto_w', 'pixeldust', 'frostbyte', 'mira',
      'degenharbor', 'koi', 'sol_survivor', 'eth_maxi', 'whale.bait', 'nova',
      'tycho', 'redshift', 'qubit', 'mochi', 'glacier', 'orbit_kid', 'vesper',
      'lumen', 'aria.sui', 'fenwick', 'darkpool', 'minnow', 'helios',
    ]
    const pick = <T,>(a: readonly T[]): T =>
      a[Math.floor(Math.random() * a.length)]
    const rand_amount = (): number => {
      const r = Math.random()
      if (r < 0.55) return pick([10, 25, 50, 75])
      if (r < 0.85) return pick([100, 120, 150, 200, 250])
      return pick([400, 500, 750, 1000])
    }
    let timer = 0
    let alive = true
    const emit = () => {
      if (!alive) return
      const row: CrashTapeRow = {
        id:
          Math.floor(performance.now() * 1000) +
          Math.floor(Math.random() * 1000),
        name: pick(NAMES),
        amountUsd: rand_amount(),
        side: Math.random() < 0.52 ? 'UP' : 'DOWN',
      }
      set_tape(prev => [row, ...prev].slice(0, 6))
      timer = window.setTimeout(emit, 1500 + Math.random() * 1500)
    }
    emit()
    return () => {
      alive = false
      window.clearTimeout(timer)
    }
  }, [])

  // ----- map the preserved app state -> the ported e05 design's `data` -------
  // Balance couplet uses the COMPACT formatter so a fat testnet balance never
  // clips its box (e.g. 150000 -> "$150k", 1.25M -> "$1.25M"); small balances
  // keep thousands separators ("$1,500").
  const fmt_money_whole = (units: bigint): string =>
    '$' + fmt_compact(dusdc_to_usd(units))

  // Resolve the FROZEN display values: while not validating, REFRESH the snapshot
  // with the live figures and pass the live values straight through; while
  // validating, leave the snapshot untouched and serve it (so the numbers hold at
  // their round-end value). `chart_price_usd` is the live spot the chart head +
  // tag glide toward; pinning it here (plus the `frozen` flag the chart reads to
  // stop easing) holds the head still during the window.
  const live_balance_str =
    total_balance != null ? fmt_money_whole(total_balance) : '—'
  if (!frozen) {
    frozen_snapshot.current = {
      chartPriceUsd: chart_price_usd,
      upWin: up_win,
      downWin: down_win,
      upMult: up_mult,
      downMult: down_mult,
      balanceStr: live_balance_str,
    }
  }
  const snap = frozen_snapshot.current
  const disp_chart_price_usd = frozen ? snap.chartPriceUsd : chart_price_usd
  const disp_up_win = frozen ? snap.upWin : up_win
  const disp_down_win = frozen ? snap.downWin : down_win
  const disp_up_mult = frozen ? snap.upMult : up_mult
  const disp_down_mult = frozen ? snap.downMult : down_mult
  const disp_balance_str = frozen ? snap.balanceStr : live_balance_str

  // Build one side's view-model. `costUsd` is the WAGER — the SAME constant value
  // (the selected stake) on BOTH sides, surfaced only once a quote has loaded
  // (quoted == true) so the button reads "Wager $X" identically for UP and DOWN.
  // The wager NEVER varies by side; only `win` + `multiple` differ.
  const side_vm = (
    win: number,
    mult: number | null,
    quoted: boolean,
    enabled: boolean,
  ): CrashData['up'] => ({
    win,
    multiple: mult,
    costUsd: quoted ? stake_usd : null,
    double: is_double(mult),
    enabled,
  })

  // While a bet is HELD, only the SAME side stays enabled — a tap ADDS to that
  // same-key position (Bug 4 accumulation). The OPPOSITE side is disabled because
  // we hold ONE open-position slot; a different-side bet would orphan the held one
  // (full multi-different-position support is out of scope). No bet held => both
  // sides are bettable as usual.
  const up_enabled =
    !locked &&
    strike != null &&
    up_cost_stake != null &&
    oracle?.status === 'active' &&
    can_afford(stake_usd) &&
    (bet == null || bet.is_up === true)
  const down_enabled =
    !locked &&
    strike != null &&
    down_cost_stake != null &&
    oracle?.status === 'active' &&
    can_afford(stake_usd) &&
    (bet == null || bet.is_up === false)

  const held_special: 'done' | 'pending' | null =
    bet && bet_expired && bet_settled
      ? 'done'
      : bet && bet_expired
        ? 'pending'
        : null

  const data: CrashData = {
    signedIn: signed_in,
    balanceStr: disp_balance_str,
    roundStr: '· live round',
    // Identity: no SuiNS/handle resolver is wired (would add a network call), so
    // the cluster shows the truncated, click-to-copy hex address as the fallback.
    addressFull: addr ?? null,
    addressShort: fmt_addr(addr),

    googleWallet: Boolean(google_wallet),
    connecting,
    hasMoney: has_money,
    walletEmpty: wallet_empty,
    managerHasBalance: (manager_balance ?? 0n) > 0n,

    countdownMm: cd_mm,
    countdownSs: cd_ss,
    cdClass: cd_class,
    cdWarn: locked,
    lockFrac: lock_frac,

    validating,
    validatingSecs: validating_secs,
    frozen,

    locked,
    betStatusText: 'Locked — reopens next round',
    stakes: STAKE_PRESETS_USD,
    stake: stake_usd,
    maxAffordableUsd: max_affordable_usd,
    canAfford: can_afford,
    up: side_vm(
      disp_up_win,
      disp_up_mult,
      up_cost_stake != null,
      Boolean(up_enabled),
    ),
    down: side_vm(
      disp_down_win,
      disp_down_mult,
      down_cost_stake != null,
      Boolean(down_enabled),
    ),
    busyUp: busy === 'bet-up' || busy === 'manager',
    busyDown: busy === 'bet-down',

    held: bet
      ? {
          isUp: bet.is_up,
          entryStr: `ENTRY ${fmt_strike(BigInt(bet.strike_1e9))}`,
          label: bet_settled
            ? 'FINAL PAYOUT'
            : bet_pending
              ? 'SETTLING…'
              : 'CASH OUT FOR',
          cashoutStr: cashout_value != null ? fmt_usd(cashout_value) : null,
          // PAID is the TOTAL that left the wallet (the displayed figure silently
          // includes the on-chain 3% router rake), so it reconciles with the
          // balance drop. The honest all-in math stays; we just don't surface a
          // fee caption.
          deltaStr:
            cashout_value != null
              ? `${fmt_signed_usd(delta_usd)} · PAID ${fmt_usd(cost_now)}`
              : '',
          winning: Boolean(winning),
          meterPct: meter_pct,
          pending: bet_pending,
          settled: bet_settled,
          countdownText: countdown,
          countdownSpecial: held_special,
          busyCashout: busy === 'cashout',
          busyClaim: busy === 'claim',
          canCashout: cashout_value != null,
        }
      : null,

    chartSamples: chart_samples_ref.current,
    spot: disp_chart_price_usd,
    strike: chart_strike_usd,
    chartSide: chart_side,
    chartWinning: chart_winning,

    tape,
    flash: flash,
    // GAINS/LOSS results log (V) — most recent first, already capped.
    results,

    house: {
      tvlStr: house.vm.tvlStr,
      sharePriceStr: house.vm.sharePriceStr,
      shareChgStr: house.vm.shareChgStr,
      yieldStr: house.vm.yieldStr,
      yieldUnit: house.vm.yieldUnit,
      projFromStr: house.vm.projFromStr,
      projEarnStr: house.vm.projEarnStr,
      projTierStr: house.vm.projTierStr,
      utilizationStr: house.vm.utilizationStr,
      yourStakeStr: house.vm.yourStakeStr,
      ctaLabel: house.vm.ctaLabel,
      hasPosition: house.vm.hasPosition,
      walletDusdcUsd: house.vm.walletDusdcUsd,
      positionValueStr: house.vm.positionValueStr,
      supplyBusy: house.vm.supplyBusy,
      redeemBusy: house.vm.redeemBusy,
      canSupply: house.vm.canSupply,
      error: house.vm.error,
      supplyDoneAt: house.vm.supplyDoneAt,
    },

    error,
    notice,
    noticeKind: notice_kind,
    reconstructFailed: reconstruct_failed,
    // GLOBAL ACTION LOCK — true while ANY sponsored write is in flight; the e05
    // skin greys out + disables every action control so no second action starts.
    txPending: tx_pending,
  }

  const actions: CrashActions = {
    selectStake: usd => {
      const i = STAKE_PRESETS_USD.indexOf(usd as (typeof STAKE_PRESETS_USD)[number])
      sfx.stake_select(i >= 0 ? i / (STAKE_PRESETS_USD.length - 1) : 0.5)
      set_custom_open(false)
      set_stake_usd(usd)
    },
    setCustomStake: usd => {
      sfx.tap()
      // Floor the custom stake at $1 — a bet can never be sized below $1. We
      // clamp the value the input feeds in (NaN/0/negatives all snap up to 1)
      // BEFORE applying the affordability cap, so the stake stays in [1, max].
      const floored = Number.isFinite(usd) ? Math.max(1, Math.floor(usd)) : 1
      set_custom_open(true)
      set_custom_usd(String(floored))
      const clamped =
        max_affordable_usd != null && max_affordable_usd >= 1
          ? Math.min(floored, max_affordable_usd)
          : floored
      set_stake_usd(clamped)
    },
    placeBet: side => {
      // GLOBAL LOCK: a blocked click is a full no-op (no sfx, no action).
      if (tx_pending) return
      sfx.tap()
      place_bet(side === 'UP')
    },
    cashOutBet: () => {
      if (tx_pending) return
      sfx.tap()
      sfx.splash()
      cash_out()
    },
    claimBet: () => {
      if (tx_pending) return
      claim()
    },
    becomeHouse: () => set_house_view(true),
    // Wrap the house supply/redeem (router::supply / redeem_lp via useHouse) in
    // the SAME global lock. They are async at runtime (typed as void); wrap in
    // Promise.resolve so the finally fires on both the success and the
    // internally-caught-error path.
    supply: usd => {
      if (tx_pending) return
      set_tx_pending(true)
      Promise.resolve(house.actions.supply(usd)).finally(() =>
        set_tx_pending(false),
      )
    },
    redeemHouse: () => {
      if (tx_pending) return
      set_tx_pending(true)
      Promise.resolve(house.actions.redeem()).finally(() =>
        set_tx_pending(false),
      )
    },
    withdraw: () => set_withdraw_open(true),
    addFunds: () => window.open(WALLET_URL, '_blank', 'noopener'),
    signInGoogle: () => sign_in_google(),
    signOut: () => sign_out(),
    goToBet: () => set_house_view(false),
  }

  return (
    <div className={`app${bet ? ' held' : ''}`}>
      {/* a soft cursor that follows the pointer (skipped on touch) */}
      <CustomCursor />

      {/* THE WHOLE PAGE: the ported e05 "Fold & Footer" design — verbatim DOM +
          scoped .e05 CSS + canvas chart (crash-e05.ts / crash-base.ts), fed the
          preserved app state via `data` and the preserved gasless/data handlers
          via `actions`. Presentation only; no logic lives in there. */}
      <CrashE05 data={data} actions={actions} />

      {/* STANDARD-WALLET CONNECT — only when Enoki's Google wallet is absent (the
          e05 acct slot stays empty in that case). A real dapp-kit ConnectButton,
          rendered OUTSIDE the .e05 scope so the wallet modal keeps its own
          dist/index.css (main.tsx line 9). */}
      {!signed_in && !google_wallet && (
        <div className="connect-overlay">
          <ConnectButton connectText="CONNECT" />
        </div>
      )}

      {/* ---------------- WITHDRAW MODAL (the one allowed hairline sheet) ------
          opened by the balance couplet's CASH OUT affordance. Confirms moving
          the manager balance out to the wallet via the frozen withdraw path. */}
      {withdraw_open && (
        <div
          className="modal-backdrop"
          onClick={() => busy === null && set_withdraw_open(false)}
        >
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label="Cash out to wallet"
            onClick={e => e.stopPropagation()}
          >
            <div className="modal-h">CASH OUT TO WALLET</div>
            <p className="modal-p">
              Move your entire balance{' '}
              <b>{fmt_usd(manager_balance ?? 0n)}</b> of dUSDC out to your
              connected wallet.
            </p>
            <div className="modal-actions">
              <button
                className="btn ghost"
                onClick={() => set_withdraw_open(false)}
                disabled={busy !== null}
              >
                CANCEL
              </button>
              <button
                className="btn accent"
                onClick={withdraw_all}
                disabled={busy !== null || (manager_balance ?? 0n) <= 0n}
              >
                {busy === 'withdraw' ? (
                  <span className="spin" />
                ) : (
                  `WITHDRAW ${fmt_usd(manager_balance ?? 0n)}`
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
