import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ConnectButton,
  useSignAndExecuteTransaction,
  useSignPersonalMessage,
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
  build_claim_tx,
  build_create_manager_tx,
  build_withdraw_all_tx,
  fetch_dusdc_coins,
  fetch_minted_events,
  fetch_redeemed_events,
  find_created_manager_id,
  read_manager_balance,
  read_trade_amounts,
  snap_strike,
  type MintedEvent,
  type RedeemedEvent,
} from './sui'
import {
  DEFAULT_STAKE_USD,
  DUSDC_SCALE,
  LOCK_WINDOW_MS,
  ONE_CONTRACT_QTY,
  PREVIEW_QUANTITY,
  ROUTER_FEE_BPS,
  STAKE_PRESETS_USD,
  bet_amount_with_buffer,
} from './config'
import {
  dusdc_to_usd,
  fmt_addr,
  fmt_balance,
  fmt_countdown,
  fmt_signed_cents,
  fmt_strike,
  fmt_usd,
  fmt_usd_cents,
} from './format'
import { resolveSuizeHandle } from './suins'
import { useNow } from './useNow'
import { useAuth } from './auth'
import { execute_sponsored, request_sponsorship } from './sponsor'
import { connect_ws, disconnect_ws, register_signer } from './ws'
import { CustomCursor } from './CustomCursor'
import { CrashE05 } from './CrashE05'
import type {
  CrashActions,
  CrashData,
  CrashResult,
  SideVM,
} from './crash-host'
import * as sfx from './sfx'

// Where users top up their wallet with testnet funds. The "Add funds" affordance
// (balance couplet + house deposit sheet) links here.
const WALLET_URL = 'https://wallet.suize.io'

// ---------------------------------------------------------------------------
// DUAL-SIDE POSITION — TWO buckets per round, surfaced as ONE accumulated uPnL.
//
// A round holds TWO independent buckets on the SAME manager: UP and DOWN. On
// chain they live under DISTINCT MarketKeys (DeepBook Predict keys by direction)
// so they NEVER net — each is its own redeemable position. The user taps UP and/or
// DOWN freely in the same round; each tap grows the MATCHING bucket. The UI
// presents the pair as ONE accumulated, mark-to-market position (one breathing
// uPnL / cash-out number, one cash-out that exits BOTH buckets, one settle).
//
// Held in React state ONLY (never localStorage — it is trusted state). It is
// either (a) grown in-session from the bets we CONFIRM this round, or (b)
// RECONSTRUCTED from chain/indexer truth on load via reconstruct_position (a
// reload recovers BOTH open buckets without any local blob). Every field that
// feeds a claim/cash_out tx (oracle_id, expiry, strike, is_up, quantity) traces
// back to chain/indexer truth; each bucket's `cost_1e6` is purely the displayed
// "paid" amount.
// ---------------------------------------------------------------------------

// One side's accumulated bucket: confirmed on-chain contracts + displayed paid.
type Bucket = {
  quantity: bigint // confirmed on-chain contracts (1e6-scaled)
  cost_1e6: bigint // displayed PAID for this side (debit incl. the 3% rake)
}
const EMPTY_BUCKET: Bucket = { quantity: 0n, cost_1e6: 0n }

type Position = {
  oracle_id: string
  expiry_ms: number
  strike_1e9: string // bigint as string — the round's strike
  up: Bucket // the UP-side bucket (0/0 when nothing bet up)
  down: Bucket // the DOWN-side bucket (0/0 when nothing bet down)
}

// True while a position holds NOTHING on either side (both buckets empty) — used
// to treat such a position as "no position" without juggling null everywhere.
const position_empty = (p: Position): boolean =>
  p.up.quantity <= 0n && p.down.quantity <= 0n

// The ONE in-flight bet tap (SERIALIZED — never more than one at a time). It is
// shown immediately as PENDING (optimistic size/balance preview) but is NOT
// folded into the confirmed position until the tx CONFIRMS with on-chain
// success. On failure/rejection it is dropped with one clear error — no phantom
// position, no fake success. `debit_1e6` drives the optimistic balance drop.
type PendingBet = {
  is_up: boolean
  quantity: bigint // contracts the tap adds (1e6-scaled)
  debit_1e6: bigint // what leaves the wallet (cost + 3% rake) — the balance drop
  cost_1e6: bigint // bare mint cost (for the optimistic cash-out floor)
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

// The bucket key for the ON-CHAIN events (D2) — same identity as position_key but
// WITHOUT manager (events + the loser feed both reconcile on
// oracle|side|strike|expiry). strike/expiry are exact strings (Sui u64s) so the
// minted<->redeemed match is byte-exact (no Number() round-trip).
const event_key = (e: {
  oracle_id: string
  is_up: boolean
  strike: string
  expiry: string
}): string => `${e.oracle_id}|${e.is_up ? 'U' : 'D'}|${e.strike}|${e.expiry}`

// ----- ODDS PREVIEW poll cadence + freshness TTL — declared TOGETHER on purpose.
// The TTL must comfortably exceed the cadence + quote latency, or every quote
// "expires" between polls and the bet cards strobe "Pricing…" once per cycle —
// we shipped exactly that bug when the cadence was slowed 2s→6s and the 5s TTL
// silently became shorter than the poll gap. Two missed polls + latency headroom.
const ODDS_POLL_MS = 6_000
const ODDS_STALE_MS = ODDS_POLL_MS * 2 + 3_000

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

// The exact INVERSE of debit_with_rake: recover the bare mint cost from a
// grossed-up debit. The on-chain redeem (bid_payout) refunds NO rake, so a
// position's cash-out floor before its first live quote must be the BARE cost, not
// the grossed debit — flooring at the debit would mask the few-cents spread+rake
// loss. Calibrated honesty: a cash-out preview must never under-report a loss.
const bare_cost = (debit_1e6: bigint): bigint =>
  (debit_1e6 * 10_000n) / (10_000n + ROUTER_FEE_BPS)

// P&L cents formatters (fmt_signed_cents / fmt_usd_cents) now live in format.ts so
// the history row + the settle toast share ONE source and agree to the cent.

// The WIN payout (in $) for a given stake at a per-contract cost: contracts × $1.
// With fine-grained sizing `quantity` is a 1e6-scaled (fractional-contract) count,
// so the win is quantity / 1e6 dollars — computed at full precision (NOT integer-
// truncated to whole contracts, which would re-pin the payout). Derived from the
// SAME sizing so the displayed WIN == what the bet actually pays.
const win_for_stake = (stake_usd: number, cost_unit: bigint | null): number => {
  if (cost_unit == null || cost_unit <= 0n) return stake_usd
  return Number(quantity_for_stake(stake_usd, cost_unit)) / Number(ONE_CONTRACT_QTY)
}

// Reconstruct the user's DUAL-SIDE open position for the most-recent open round
// from the indexer's minted feed, cross-referenced with the live oracle list AND
// the redeemed feed so already-claimed/cashed-out positions are excluded. A mint
// is "open" while its oracle is active / pending_settlement / settled (a just-
// settled one is claimable — auto-claim then clears it) AND it has no matching
// redeemed record. We pick the most-recent open round (by expiry), then SUM each
// side's open mints on that round into BOTH buckets — UP and DOWN are kept
// SEPARATELY and never collapsed (they live under distinct on-chain MarketKeys, so
// holding both at once is normal in this model). Returns null when nothing is
// live. The numbers come from the indexer but only QUOTE and address an on-chain
// redeem that asserts ownership — a wrong indexer answer can only fail the tx,
// never move funds wrongly.
const reconstruct_position = (
  minted: MintedPosition[],
  redeemed: RedeemedPosition[],
  oracles: Oracle[],
  // D6 — bucket EVENT-keys (oracle|side|strike|expiry) just cash-out-redeemed
  // locally; suppressed from reconstruct until the redeemed feed catches up, so a
  // just-cashed side can't be resurrected as still-open.
  suppressed?: Set<string>,
): Position | null => {
  const by_id = new Map(oracles.map(o => [o.oracle_id, o]))
  const redeemed_keys = new Set(redeemed.map(position_key))
  // All currently-open mints (any side), most recent first.
  const open = minted
    .filter(m => {
      const o = m.oracle_id ? by_id.get(m.oracle_id) : undefined
      if (!o || o.status === 'created' || m.strike == null || m.expiry == null)
        return false
      if (redeemed_keys.has(position_key(m))) return false
      // D6: drop a bucket we just cashed out locally (indexer redeemed-feed lag).
      if (
        suppressed &&
        m.oracle_id != null &&
        suppressed.has(
          event_key({
            oracle_id: m.oracle_id,
            is_up: Boolean(m.is_up),
            strike: to_exact_bigint(m.strike, 0n).toString(),
            expiry: String(m.expiry),
          }),
        )
      )
        return false
      // A SETTLED position is only 'open' if it WON (a winner still needs
      // claiming); a settled LOSER is terminal ($0, never redeemed) — exclude it so
      // the loser of a both-sides (hedged) round is not resurrected (which would
      // phantom-log a loss + re-pin run_bet's round, hard-locking new bets). The
      // settlement-vs-strike comparison MATCHES gather_claimable_positions + claim()
      // EXACTLY: settlement = round(settlement_price), strike = to_exact_bigint(.,0n),
      // UP wins iff settlement >= strike, DOWN wins iff settlement < strike.
      if (o.status === 'settled' && o.settlement_price != null) {
        const settlement = BigInt(Math.round(o.settlement_price))
        const strike = to_exact_bigint(m.strike, 0n)
        const won = m.is_up ? settlement >= strike : settlement < strike
        if (!won) return false
      }
      return true
    })
    .sort((a, b) => (b.expiry ?? 0) - (a.expiry ?? 0))
  const head = open[0]
  if (!head || head.oracle_id == null || head.strike == null || head.expiry == null)
    return null
  // The round is identified by oracle_id + expiry + strike. Sum each side's open
  // mints on that round (an accumulated same-side position can emit multiple rows)
  // into its OWN bucket — both sides are carried, neither is discarded.
  const round_oracle = head.oracle_id
  const round_expiry = head.expiry
  const round_strike = to_exact_bigint(head.strike, 0n)
  let up_qty = 0n
  let up_cost = 0n
  let down_qty = 0n
  let down_cost = 0n
  for (const m of open) {
    if (
      m.oracle_id !== round_oracle ||
      m.expiry !== round_expiry ||
      to_exact_bigint(m.strike, 0n) !== round_strike
    )
      continue
    const qty = to_exact_bigint(m.quantity, ONE_CONTRACT_QTY)
    // The indexer reports the BARE on-chain mint cost (the router skims the rake
    // separately before minting). Gross it up by the 3% rake so a reconstructed
    // position's "PAID" matches a freshly-placed one — both show what truly left
    // the wallet (cost + rake). Display-only; never feeds a tx.
    const cost = debit_with_rake(to_exact_bigint(m.cost, 0n))
    if (m.is_up) {
      up_qty += qty
      up_cost += cost
    } else {
      down_qty += qty
      down_cost += cost
    }
  }
  if (up_qty <= 0n && down_qty <= 0n) return null
  return {
    oracle_id: round_oracle,
    expiry_ms: round_expiry,
    strike_1e9: round_strike.toString(),
    up: { quantity: up_qty, cost_1e6: up_cost },
    down: { quantity: down_qty, cost_1e6: down_cost },
  }
}

// The exact arg shape router::claim needs (matches sui.ts RedeemOpts), PLUS the
// summed bucket cost (D1) so the on-load sweep can report each swept winner's net
// without re-deriving the position key. Built by gather_claimable_positions.
type ClaimArgs = {
  manager_id: string
  oracle_id: string
  expiry_ms: bigint
  strike_1e9: bigint
  is_up: boolean
  quantity: bigint
  // The all-in cost basis for this bucket (summed indexer bare mint cost across
  // all of the bucket's mint rows, grossed up by the 3% rake). For the report row.
  cost_1e6: bigint
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
  // AGGREGATE per bucket key (an accumulated/grown winner emits MULTIPLE mint rows)
  // — SUM quantity + cost. One claim redeems the WHOLE on-chain bucket at once, so
  // the claimed quantity must be the bucket total (not the first row's), and the
  // reported cost must be the full summed basis.
  const agg = new Map<string, ClaimArgs>()
  for (const m of minted) {
    if (m.oracle_id == null || m.strike == null || m.expiry == null) continue
    const o = by_id.get(m.oracle_id)
    if (!o || o.status !== 'settled' || o.settlement_price == null) continue
    const key = position_key(m)
    if (redeemed_keys.has(key)) continue
    const settlement = BigInt(Math.round(o.settlement_price))
    const strike = to_exact_bigint(m.strike, 0n)
    const is_up = Boolean(m.is_up)
    const won = is_up ? settlement >= strike : settlement < strike
    if (!won) continue
    const qty = to_exact_bigint(m.quantity, ONE_CONTRACT_QTY)
    const cost = debit_with_rake(to_exact_bigint(m.cost, 0n))
    const prev = agg.get(key)
    if (prev) {
      prev.quantity += qty
      prev.cost_1e6 += cost
    } else {
      agg.set(key, {
        manager_id,
        oracle_id: m.oracle_id,
        expiry_ms: BigInt(Math.trunc(m.expiry)),
        strike_1e9: strike,
        is_up,
        quantity: qty,
        cost_1e6: cost,
      })
    }
  }
  return Array.from(agg.values())
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

// A TRANSIENT sponsorship/network failure (the WS reconnecting, a sponsor timeout,
// a momentary backend hiccup) — NOT an on-chain abort. The auto-claim retries these
// instead of surfacing a scary error and dropping the position: the claim never
// landed, the winnings are still on-chain, and the redeem is idempotent (a stray
// double-claim aborts as already-redeemed, handled separately). The caller checks
// is_already_redeemed_error FIRST, so this never swallows a terminal outcome.
const is_retryable_sponsor_error = (msg: string): boolean => {
  const m = msg.toLowerCase()
  return (
    m.includes('sponsor') || // "Sponsorship unavailable / failed / timed out"
    m.includes('not ready') ||
    m.includes('timed out') ||
    m.includes('timeout') ||
    m.includes('network') ||
    m.includes('websocket') ||
    m.includes('connection') ||
    m.includes('failed to fetch')
  )
}
// Bound the silent auto-claim retry so a DURABLE sponsor outage eventually surfaces
// the error rather than retrying forever; ~2.5s apart lets the WS reconnect between.
const MAX_CLAIM_RETRIES = 5
const CLAIM_RETRY_BACKOFF_MS = 2500

// D3-ERROR — detect the "ask price out of bounds" outcome (predict abort code 7,
// EAskPriceOutOfBounds). The side just left the mintable band: the executed ask
// re-quoted above the ceiling (or below the floor). We map this to a calm
// "try the other side / next round" message and ABORT the bet — never silently
// send a doomed tx. Covers the devInspect re-quote throw, the move abort in the
// landed tx effects, AND the sponsor 502 (which wraps the same abort). We match
// the abort code + the symbol name + the predict-specific phrasing, kept narrow so
// it never swallows an unrelated error.
const is_ask_oob_error = (msg: string): boolean => {
  const m = msg.toLowerCase()
  return (
    m.includes('out of bounds') ||
    m.includes('outofbounds') ||
    m.includes('easkprice') ||
    m.includes('ask_price') ||
    // MoveAbort with code 7 in the predict module — the on-chain assert_mintable_ask.
    /moveabort[^0-9]*\b7\b/.test(m) ||
    m.includes(', 7)') ||
    m.includes('code: 7') ||
    m.includes('code 7')
  )
}
const ASK_OOB_MESSAGE =
  'This side just left the price band — try the other side or next round.'

// D2 — REALIZED HISTORY FROM ON-CHAIN EVENTS. The indexer redeemed feed carries no
// amount + no cash-out-vs-claim discriminator, so wins were omitted on reload.
// PositionRedeemed events carry BOTH: the exact `payout` and `is_settled`
// (settlement claim vs early cash-out). For each redeemed bucket we score the
// realized P&L = payout − summed_mint_cost (the summed bucket bare cost grossed up
// by the 3% rake, to match what actually left the wallet). One row per redeemed
// bucket key; a grown bucket sums to ONE mint-cost. Returns rows tagged with their
// event key + expiry so the caller can dedup losers + sort.
const gather_realized_results_from_events = (
  redeemed: RedeemedEvent[],
  minted: MintedEvent[],
): { result: CrashResult; key: string; expiry: number }[] => {
  // Sum the BARE mint cost per bucket key (grossed up once at the end).
  const mint_cost = new Map<string, bigint>()
  for (const m of minted) {
    const k = event_key(m)
    mint_cost.set(k, (mint_cost.get(k) ?? 0n) + to_exact_bigint(m.cost, 0n))
  }
  // One realized row per redeemed bucket key (a bucket is redeemed whole; dedup
  // defensively in case the event feed ever repeats).
  const seen = new Set<string>()
  const rows: { result: CrashResult; key: string; expiry: number }[] = []
  for (const r of redeemed) {
    const k = event_key(r)
    if (seen.has(k)) continue
    // CAP-SKEW guard (LOW): if this bucket's PositionMinted paged OUT of the fetch
    // window, we have no cost basis — defaulting cost to 0 would score a redeemed
    // position as a full-payout WIN (overstated). SKIP it (better to omit an old
    // row than bake in a wrong one) rather than fabricate a $0-cost win.
    if (!mint_cost.has(k)) continue
    seen.add(k)
    const payout = to_exact_bigint(r.payout, 0n)
    const cost = debit_with_rake(mint_cost.get(k)!)
    rows.push({
      result: {
        id: Number(r.expiry) || 0,
        isUp: r.is_up,
        // WON = realized proceeds beat the all-in cost (the honest predicate for
        // BOTH a settlement claim and an early cash-out).
        won: payout > cost,
        pnlUsd: dusdc_to_usd(payout - cost),
      },
      key: k,
      expiry: Number(r.expiry) || 0,
    })
  }
  return rows
}

// Seed the GAINS/LOSS results log (V) from the indexer feeds on load so past
// outcomes survive a refresh — PER BUCKET, so it matches the live (per-side) log
// for a hedged round (two rows). We ONLY reconstruct HELD-TO-SETTLEMENT LOSER
// buckets, deliberately:
//   · We EXCLUDE every REDEEMED position (cashed-out OR settlement-claimed) up
//     front — same redeemed_keys exclusion reconstruct_position uses. A redeemed
//     position's realized P&L is NOT recoverable from the feeds: the redeemed feed
//     (RedeemedPosition, api.ts) carries NO realized amount and NO
//     cash_out-vs-claim discriminator. So an EARLY-CASHED-OUT loser (true loss =
//     bid − cost, e.g. −$0.13) must NOT be re-scored as a full −debit loss
//     (−$1.03, a ~90% overstatement) — it is simply OMITTED (R1). The live row
//     captured the exact realized number when it happened.
//   · LOSER bucket that was HELD to settlement: it LOST and NEVER redeems on-chain
//     ($0), so it has no redeemed record and its realized P&L is unambiguous:
//     −debit. We log it straight from the minted feed + settlement. This matches
//     the live claim() loss row exactly. (These are the ONLY survivors.)
//   · WINNER bucket: SKIPPED via `if (won) continue`. A held-to-settlement winner
//     stays a CLAIMABLE open position (reconstruct surfaces it) until claimed; a
//     redeemed winner is already excluded above. Either way we never fabricate a
//     full-settlement win from a record we can't score (B2).
// AGGREGATION (B3): a grown bucket emits MULTIPLE mint rows — we group ALL rows of
// a bucket and SUM quantity + cost, mirroring reconstruct_position, so a grown
// loser's realized P&L is the full −debit (not just the first row's). Buckets are
// keyed by the FULL position_key (oracle|manager|side|strike|expiry) — NOT
// expiry|side, which collides when two oracles share an expiry (SF2). Returned
// MOST RECENT FIRST (by expiry) and capped by the caller.
const gather_settled_results = (
  minted: MintedPosition[],
  redeemed: RedeemedPosition[],
  oracles: Oracle[],
): { result: CrashResult; key: string; expiry: number }[] => {
  const by_id = new Map(oracles.map(o => [o.oracle_id, o]))
  // EXCLUDE redeemed positions up front (cashed-out OR claimed) — identical key to
  // reconstruct_position, so the two agree on what's already off the board (R1).
  const redeemed_keys = new Set(redeemed.map(position_key))
  // First pass: group settled-round mints into LOSER buckets, summing qty + cost.
  // We carry the EVENT-FORM key (oracle|side|strike|expiry — no manager) so the
  // caller can dedup these losers against the realized event rows by the same key.
  type Agg = {
    is_up: boolean
    expiry: number
    ekey: string
    cost: bigint
  }
  const buckets = new Map<string, Agg>()
  for (const m of minted) {
    if (m.oracle_id == null || m.strike == null || m.expiry == null) continue
    const o = by_id.get(m.oracle_id)
    if (!o || o.status !== 'settled' || o.settlement_price == null) continue
    // Drop anything already redeemed (cashed-out or settlement-claimed): its real
    // proceeds aren't in the feeds, so it must not be re-scored as a full −debit.
    if (redeemed_keys.has(position_key(m))) continue
    const settlement = BigInt(Math.round(o.settlement_price))
    const strike = to_exact_bigint(m.strike, 0n)
    const is_up = Boolean(m.is_up)
    const won = is_up ? settlement >= strike : settlement < strike
    if (won) continue // omit winners (no realized-amount discriminator) — B2
    const key = position_key(m)
    const ekey = event_key({
      oracle_id: m.oracle_id,
      is_up,
      strike: strike.toString(),
      expiry: String(m.expiry),
    })
    const agg = buckets.get(key) ?? {
      is_up,
      expiry: m.expiry,
      ekey,
      cost: 0n,
    }
    // Sum the BARE on-chain cost across the bucket's rows, gross up ONCE below.
    agg.cost += to_exact_bigint(m.cost, 0n)
    buckets.set(key, agg)
  }
  const rows: { result: CrashResult; key: string; expiry: number }[] = []
  for (const agg of buckets.values()) {
    // Loser: payout 0, realized P&L = −(summed bare cost grossed up by the rake).
    const debit = debit_with_rake(agg.cost)
    rows.push({
      result: {
        id: agg.expiry,
        isUp: agg.is_up,
        won: false,
        pnlUsd: dusdc_to_usd(-debit),
      },
      key: agg.ekey,
      expiry: agg.expiry,
    })
  }
  return rows
}

// Per-action busy flag for the inline spinner. Betting taps are now SERIALIZED
// (one bet tx in flight at a time), so 'bet' covers the pending bet spinner.
// 'manager' covers the first-bet auto-create spinner.
type Busy = null | 'manager' | 'bet' | 'cashout' | 'claim' | 'withdraw'

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
  // Personal-message signer for the WS auth handshake (sponsor transport). dapp-kit
  // resolves the account + chain from the live Enoki/zkLogin session, so the bridge
  // below only passes `message` and gets back base64 { bytes, signature }.
  const { mutateAsync: signPersonalMessage } = useSignPersonalMessage()
  const now = useNow(1000)
  const addr = address

  // ── SUINS HANDLE (display only) ────────────────────────────────────────────
  // The connected address's `<name>@suize` SuiNS handle, resolved client-side
  // from its on-chain reverse record (suins.ts mirrors the backend's meCore).
  // null until/unless it resolves — the account cluster shows `handle ??
  // addressShort`, so the hex shows immediately and is replaced in place once
  // (and only if) the handle arrives. Purely presentational; never feeds a tx.
  const [handle, set_handle] = useState<string | null>(null)
  useEffect(() => {
    // Reset on address change so a stale handle never bleeds across accounts.
    set_handle(null)
    if (!addr) return
    let alive = true
    resolveSuizeHandle(addr, client).then(h => {
      // Guard against an out-of-order resolve after the address changed/unmounted.
      if (alive) set_handle(h)
    })
    return () => {
      alive = false
    }
  }, [addr, client])

  // ── GASLESS SPONSOR TRANSPORT LIFECYCLE ────────────────────────────────────
  // The sponsor now rides the Enoki-verified WebSocket (ws.ts) instead of HTTP.
  // We open + authenticate the socket on sign-in (when a SPONSORED zkLogin address
  // + signer are available) and reuse it for every bet / cash-out / claim sponsor.
  // A self-paying wallet (e.g. Slush) never needs it, so we only connect for the
  // sponsored path — and avoid prompting a self-paying user for an auth signature.
  //
  // Job 1: register the personal-message signer thunk the auth handshake calls.
  useEffect(() => {
    register_signer(async (message: Uint8Array) => {
      const { bytes, signature } = await signPersonalMessage({ message })
      return { bytes, signature }
    })
    return () => register_signer(null)
  }, [signPersonalMessage])

  // Job 2: connect when a sponsored address arrives; disconnect on sign-out / a
  // switch to a self-paying wallet. connect_ws is a no-op when already open.
  useEffect(() => {
    if (sponsored && address) {
      connect_ws(address)
    } else {
      disconnect_ws()
    }
  }, [sponsored, address])

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
  //     aborts with "No valid gas coins". Route through the unified backend over
  //     the Enoki-verified WebSocket (ws.ts) — opened + authenticated on sign-in;
  //     the backend holds the Enoki PRIVATE key, PINS the sender to the verified
  //     socket address, and enforces the router::* allowlist:
  //       1. build the tx KIND bytes (onlyTransactionKind) -> base64
  //       2. sponsorRequest -> { bytes, digest }  (sponsored full tx bytes)
  //       3. sign the EXACT sponsored `bytes` with the zkLogin session via
  //          useSignTransaction (sign-only; a string transaction is passed
  //          through verbatim — NOT rebuilt/self-paid)
  //       4. executeRequest -> { digest }  (backend submits + pays gas)
  //     On any sponsor/execute failure we throw a clear "sponsorship unavailable"
  //     error and do NOT silently fall back to self-pay (which would just fail
  //     confusingly for a gasless user). Callers surface it via set_error.
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

      // 2. sponsorRequest (over the WS) -> the full sponsored tx bytes + digest.
      const { bytes, digest } = await request_sponsorship({
        kind_bytes_b64,
        sender: address,
      })

      // 3. Sign the EXACT sponsored bytes (passed as a string => signed verbatim).
      const { signature } = await signTransactionRaw({ transaction: bytes })

      // 4. executeRequest (over the WS) -> backend submits + pays gas; echoes the digest.
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

  const [up_cost, set_up_cost] = useState<bigint | null>(null)
  const [down_cost, set_down_cost] = useState<bigint | null>(null)
  // Per-side LAST-SUCCESSFUL-QUOTE stamps: WHEN (epoch ms) + WHICH ROUND the ask
  // was quoted on. With per-side keep-last we hold a side's last ask on a transient
  // read miss instead of freezing the pair; but a kept value must NOT keep reading
  // as live once it is STALE (no fresh quote past the TTL) — or once the ROUND has
  // moved on: round-end odds (a ~1.0x favorite / 12x longshot) displayed as live on
  // the next round's ~50/50 open is exactly the "big number snaps to a different
  // value" bug. `up_fresh`/`down_fresh` below gate on BOTH. Refs (not state) —
  // read reactively via `now` (1s tick); writing them never needs a re-render.
  const up_cost_at = useRef<{ at: number; oracle_id: string }>({
    at: 0,
    oracle_id: '',
  })
  const down_cost_at = useRef<{ at: number; oracle_id: string }>({
    at: 0,
    oracle_id: '',
  })

  // ----- STAKE selector: $ payout-capacity the user wants to bet -----
  // stake_usd is in whole dollars (1 contract = $1 max payout). custom_open
  // reveals an inline number input; custom_usd holds its (string) value so the
  // field can be cleared mid-edit. quantity derives from the selected stake and
  // flows straight into the bet (build_bet_tx). Odds % stay size-independent
  // (still previewed at 1 contract); only the displayed COST scales with size.
  const [stake_usd, set_stake_usd] = useState<number>(DEFAULT_STAKE_USD)

  const [busy, set_busy] = useState<Busy>(null)
  // WHICH side's cash-out tx is in flight (so only THAT side's card shows its
  // spinner). null when no per-side cash-out is running. Set alongside busy =
  // 'cashout'; cleared in the same finally.
  const [cashout_side, set_cashout_side] = useState<'up' | 'down' | null>(null)
  // GLOBAL WRITE LOCK — TRUE while ANY sponsored, manager-touching write (bet,
  // cash out, claim, supply/become-the-house, withdraw, redeem, manager-create)
  // is in flight. EVERY write handler GUARDS at the top (`if (tx_pending) return`)
  // and flips it back in a `finally` (covering success, error AND user-rejection).
  // Exposed to the e05 skin as `txPending` to grey-out + disable EVERY action
  // control. SERIALIZED: only ever ONE write at a time, so the shared manager is
  // never under-funded by a concurrent bet and the same wallet coins are never
  // reused (the root cause of the DOWN-fail withdraw_with_proof abort). Bets are
  // now part of this lock too (symmetric guard) — a bet can never race a withdraw.
  const [tx_pending, set_tx_pending] = useState(false)
  // Live mirror of the write lock for non-reactive reads (the on-load claim sweep
  // checks it WITHOUT taking tx_pending as an effect dep, which would re-run the
  // once-per-manager effect on every lock flip). Kept in sync below.
  const tx_pending_ref = useRef(false)
  useEffect(() => {
    tx_pending_ref.current = tx_pending
  }, [tx_pending])
  // THE ONE PENDING BET — shown immediately as PENDING (optimistic preview) while
  // its tx is in flight, then folded into the confirmed position ONLY on confirmed
  // on-chain success; dropped on failure. Never more than one (serialized). null
  // when no bet is mid-flight.
  const [pending_bet, set_pending_bet] = useState<PendingBet | null>(null)
  // SERIAL TAP QUEUE — same-side taps fired while a bet is pending are queued and
  // processed one-at-a-time after the prior confirms (keeps the "tap to grow"
  // feel without ever firing two concurrent bet txs). Each queued tap is the side
  // tapped. A queue runner (process_queue) drains it serially.
  const tap_queue = useRef<boolean[]>([])
  const queue_running = useRef(false)
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
  //   `optimistic` is the WIN-BUMP override (an absolute total, set by
  //   report_result for the green count-up on settle), reconciled away on the next
  //   refresh. The
  //   bet-time DROP is NOT this field — it is derived live from the pending-delta
  //   stack (see `displayed_balance`), so each tap's drop appears instantly and
  //   disappears as its delta reconciles.
  const [manager_balance, set_manager_balance] = useState<bigint | null>(null)
  const [wallet_dusdc, set_wallet_dusdc] = useState<bigint | null>(null)
  // The WIN-BUMP override, GENERATION-TAGGED (D5). A redeem credits the manager
  // internally; the next manager-balance poll provably reflects it ONLY if that
  // read was *started after* the redeem confirmed. We stamp the override with the
  // poll generation at the moment report_result sets it, and refresh_balances
  // clears it ONLY when a read whose generation is STRICTLY NEWER lands — so the
  // unconditional 4s poll can't wipe a fresh win-bump within ≤4s (the old
  // flash-and-vanish). `gen` is a monotonically increasing counter incremented at
  // the START of every refresh_balances.
  const [optimistic, set_optimistic] = useState<{
    value: bigint
    gen: number
  } | null>(null)
  const poll_gen = useRef(0)

  const [withdraw_open, set_withdraw_open] = useState(false)
  // The House (PLP vault) now lives on its OWN /house tab (src/shell) — App is the
  // Play screen only. The old in-page `house_view` smooth-scroll flag is gone; the
  // shell router owns tab navigation. `goToMarkets` (below) routes to /markets.
  const navigate = useNavigate()
  // The confirmed on-chain SINGLE position for the live round, or null.
  const [position, set_position] = useState<Position | null>(null)
  // Mirror of the latest confirmed position for synchronous reads in the serial
  // queue drain (a queued same-side grow that runs right after a prior bet confirms
  // must see the just-folded position for its round-key decision, before React has
  // re-rendered the run_bet closure). run_bet sets it synchronously on a confirmed
  // grow; this effect keeps it in sync for every OTHER mutation (reconstruct,
  // cash-out/settle clear, disconnect).
  const position_ref = useRef<Position | null>(null)
  useEffect(() => {
    position_ref.current = position
  }, [position])
  // D6 — "recently cashed locally" guard: bucket event-keys we just cash-out-redeemed,
  // with an expiry timestamp. The redeemed indexer feed lags the redeem by a few
  // seconds, so a reconstruct in that window would resurrect the just-cashed bucket
  // as still-open. We suppress those keys from reconstruct for ~6s; on-chain truth
  // (the redeemed feed) takes over once it catches up. Cleared lazily on read.
  const recently_cashed = useRef<Map<string, number>>(new Map())
  // Live cash-out BIDs for the position (mark-to-market), polled PER SIDE. The
  // single accumulated cash-out value = up.bid + down.bid (the net mark-to-market
  // of every held bucket). null until the first quote lands.
  const [cashout_bids, set_cashout_bids] = useState<{
    up: bigint | null
    down: bigint | null
  }>({ up: null, down: null })
  const [flash, set_flash] = useState<null | 'win' | 'lose'>(null)
  // GAINS/LOSS results log (V): recent settled outcomes, most recent first, capped
  // to ~5 rows. Accumulated as positions settle (report_result) and seeded from the
  // redeemed feed on load. Pure presentation — never feeds a tx.
  const RESULTS_CAP = 5
  const [results, set_results] = useState<CrashResult[]>([])

  // ----- reset trusted state on disconnect (nothing is read from localStorage) -
  // Manager id + open position are resolved from chain/indexer truth by the
  // effects below; on disconnect we simply clear them.
  useEffect(() => {
    if (!addr) {
      set_manager_id(null)
      set_position(null)
      set_pending_bet(null)
      tap_queue.current = []
      set_manager_balance(null)
      set_optimistic(null)
      set_wallet_dusdc(null)
    }
  }, [addr])

  // ----- poll oracle list (every 20s) and keep the SOONEST BTC round selected -----
  // The bet target is ALWAYS the soonest active BTC round (the real ~15-min
  // countdown), shown through its whole life — its final 15s are LOCKED, not
  // skipped, and we NEVER roll forward to a far-future round. When it expires the
  // next poll (or the reactive advance below) picks the next soonest. A held
  // position keeps its OWN round via `bet_oracle` (position.oracle_id) + the
  // held_expiry path, so advancing the bet target never disturbs the held card's
  // settling/claim.
  const load_oracles = useCallback(async () => {
    try {
      const list = await fetch_oracles()
      set_oracles(list)
      set_oracle(prev => pick_live_btc_oracle(list) ?? prev ?? null)
    } catch (e) {
      set_error(`Could not load markets: ${(e as Error).message}`)
    }
  }, [])

  useEffect(() => {
    load_oracles()
    const id = setInterval(load_oracles, 20_000)
    return () => clearInterval(id)
  }, [load_oracles])

  // The 20s oracle poll is too coarse to catch the exact moment the current round
  // EXPIRES; this effect advances to the next soonest round off the 1s `now` tick —
  // but ONLY once the current one has expired / left 'active' (NOT 15s early: its
  // final 15s are shown, just locked). No network call (reads `oracles`).
  useEffect(() => {
    if (!oracle) return
    const still_current = oracle.status === 'active' && oracle.expiry > now
    if (still_current) return
    const next = pick_live_btc_oracle(oracles, now)
    if (next && next.oracle_id !== oracle.oracle_id) set_oracle(next)
  }, [oracle, oracles, now])

  // The oracle behind our held position (may have left the active window).
  const bet_oracle: Oracle | null = useMemo(() => {
    if (!position) return null
    return find_oracle(oracles, position.oracle_id) ?? null
  }, [position, oracles])

  // SETTLING SIGNAL (single source) — true once the HELD round has passed expiry,
  // or its oracle has flipped to pending_settlement / settled. During this window
  // the displayed numbers are FROZEN by design, so cash-out quotes are meaningless
  // and the bip must not chirp. Declared HERE (before the cash-out poll + bip
  // effects below) so both can gate on it; the downstream `held_settling` reuses
  // it verbatim. Derived only from `position`, `bet_oracle`, and `now` — all
  // available at this point. Presentation only; never gates a tx.
  const settling_now = Boolean(
    position &&
      ((position.expiry_ms <= now) ||
        bet_oracle?.status === 'pending_settlement' ||
        bet_oracle?.status === 'settled'),
  )

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

  // Keep the strike (and odds, below) polling even while a position is HELD so the
  // SAME-side bet control stays LIVE for accumulation — the user can grow a held
  // position without the control going inert. The held position's OWN strike is
  // pinned separately (position.strike_1e9 drives the chart + the grow target via
  // run_bet's round key), so this re-snapping selectable strike never disturbs it.
  useEffect(() => {
    if (oracle) {
      load_strike(oracle)
      const id = setInterval(() => load_strike(oracle), 10_000)
      return () => clearInterval(id)
    }
  }, [oracle, load_strike])

  // ----- THE QUOTE STRIKE — the strike a tap will ACTUALLY buy at ---------------
  // ONE source of truth for "what does this button cost": the bet card's odds and
  // run_bet's execution must price the SAME round key. A held (non-empty) position
  // on the current oracle pins ITS OWN line — run_bet's grow path bets at
  // position.strike_1e9, either side folding into that round — so the card quotes
  // that line too. Only a fresh bet (no position) prices the re-snapped ATM strike.
  // Quoting the card at the ATM strike while holding showed ~50/50 odds for a tap
  // that executed at the held line: once spot had drifted, a $5 DOWN wager sized at
  // the displayed ~$0.52 ask was charged the real ~$0.91 ask → "paid $8.90, wins
  // $0.61". Display and execution now read the same key by construction.
  const quote_strike: bigint | null =
    position != null &&
    !position_empty(position) &&
    position.oracle_id === oracle?.oracle_id
      ? BigInt(position.strike_1e9)
      : strike

  // ----- live ODDS via devInspect get_trade_amounts (UP & DOWN) ---------------
  // Polled every ODDS_POLL_MS at `quote_strike` (the executable key, above).
  // PER-SIDE KEEP-LAST: each side is quoted in its OWN try, so a LONGSHOT side that
  // reverts at the price band (the lopsided-market failure) no longer rejects a
  // single Promise.all and nukes the HEALTHY side's refresh. A failing side returns
  // null → its setter keeps the last value (functional setter), and its stamp
  // is NOT touched so the staleness check (below) flips it to "Pricing…" rather than
  // showing a frozen ~2x. Mirrors load_cashout's per-side merge.
  const load_odds = useCallback(
    async (o: Oracle, strike_1e9: bigint) => {
      const expiry_ms = BigInt(o.expiry)
      // Quote the per-contract ASK (the marginal price the bet pays). The card's
      // WIN/multiple is built from THIS ask via quantity_for_stake + win_for_stake —
      // the SAME path run_bet sizes the bet with — so the displayed potential gain ==
      // the real bet outcome by construction (no divergence). Per-side try so one
      // side reverting keeps the other fresh.
      const quote = async (is_up: boolean): Promise<bigint | null> => {
        try {
          const r = await read_trade_amounts(client, {
            oracle_id: o.oracle_id,
            expiry_ms,
            strike_1e9,
            is_up,
            quantity: PREVIEW_QUANTITY,
            sender: addr ?? undefined,
          })
          return r.ask_cost
        } catch {
          // momentarily unquoteable — keep last value without rejecting the other side.
          return null
        }
      }
      const [up, down] = await Promise.all([quote(true), quote(false)])
      // Keep the last value on a per-side miss. Stamp time + ROUND identity ONLY
      // on a real new quote: a stale side goes "Pricing…", and a quote from a
      // previous round can never read as live on the next one (the response may
      // land after the round advanced — `o` is the round actually quoted).
      if (up != null) {
        up_cost_at.current = { at: Date.now(), oracle_id: o.oracle_id }
        set_up_cost(up)
      }
      if (down != null) {
        down_cost_at.current = { at: Date.now(), oracle_id: o.oracle_id }
        set_down_cost(down)
      }
    },
    [client, addr],
  )

  useEffect(() => {
    if (oracle && quote_strike != null && oracle.status === 'active') {
      load_odds(oracle, quote_strike)
      // ODDS_POLL_MS cadence — slowed from 2s to cut fullnode spam: each tick is 2
      // cross-origin devInspects and the public fullnode CORS-preflights every POST,
      // so 2s meant ~4 fullnode requests every 2s just for odds. The bet-card odds
      // stay fresh enough (the real bet re-quotes + re-sizes fresh at submit);
      // lopsidedness just updates a few seconds slower. The freshness TTL is sized
      // off this cadence (ODDS_STALE_MS, declared with it) so a kept quote never
      // expires between healthy polls. Cheap, read-only devInspects.
      // Pause when the tab is hidden — no point quoting odds nobody's looking at.
      const id = setInterval(() => {
        if (!document.hidden) load_odds(oracle, quote_strike)
      }, ODDS_POLL_MS)
      return () => clearInterval(id)
    }
  }, [oracle, quote_strike, load_odds])

  // ----- refresh THE balance: manager internal balance + wallet dUSDC --------
  // Both are part of the single displayed number (manager + wallet). We never
  // sweep the wallet into the manager here — funding is lazy, at bet time.
  const refresh_balances = useCallback(async () => {
    if (!addr) return
    // GENERATION-TAG this read at its START (D5). A win-bump stamped with gen <
    // this read's gen is provably superseded by an on-chain read that post-dates it.
    const my_gen = ++poll_gen.current
    try {
      const { total } = await fetch_dusdc_coins(client, addr)
      set_wallet_dusdc(total)
    } catch {
      // D10: KEEP the last-known wallet balance on a read failure — collapsing to
      // null flips it to 0 in `total_balance`, which would falsely fail affordability
      // (matches the manager path, which already keeps last known on failure).
    }
    if (manager_id) {
      try {
        const bal = await read_manager_balance(client, manager_id, addr)
        set_manager_balance(bal)
        // The real balance is now known. Drop the win-bump override ONLY if it was
        // set BEFORE this read started (its gen is older) — a redeem that landed AND
        // a read that began after it can be trusted to include the payout. A
        // win-bump stamped LATER than this read's start (gen >= my_gen) is NOT yet
        // reflected by this read, so we keep it (D5 — no flash-and-vanish). The
        // bet-time balance drop is NOT this override; it is the pending bet's debit.
        set_optimistic(prev => (prev == null || prev.gen < my_gen ? null : prev))
      } catch {
        // leave last known balance in place
      }
    } else {
      // No manager yet => nothing deposited; the wallet portion still counts.
      set_manager_balance(0n)
      set_optimistic(prev => (prev == null || prev.gen < my_gen ? null : prev))
    }
  }, [addr, client, manager_id])

  // STEADY BALANCE POLL — the displayed balance must reflect on-chain funds
  // (wallet dUSDC + manager balance) within a few seconds of them arriving, in
  // EVERY app state. Both reads are cheap, read-only fullnode calls and funds
  // land instantly on the fullnode, so a ~4s cadence keeps the number fresh
  // without a stale window after an external deposit / add-funds. This runs
  // UNCONDITIONALLY (it is NOT gated by validating/settling/held state — those
  // freeze cosmetic round figures, never the real money the user holds; see the
  // freeze exemption at `disp_balance_str`). The reactive refresh_balances()
  // calls after each bet/cash-out/withdraw still fire for instant reconcile;
  // this just guarantees an external balance change is never missed.
  useEffect(() => {
    refresh_balances()
    // ~12s steady backstop (was 4s). The user's OWN actions already trigger an
    // immediate refresh, and the focus/visibility listener below catches external
    // top-ups on tab-return — so this slow poll only guards the rare missed case.
    // Slowed to cut fullnode getCoins+devInspect (+CORS preflight) spam.
    // Pause when hidden; the focus/visibility listener below snaps it fresh on return.
    const id = setInterval(() => {
      if (!document.hidden) refresh_balances()
    }, 12_000)
    return () => clearInterval(id)
  }, [refresh_balances])

  // Refresh the balance the instant the tab regains focus / becomes visible —
  // the user typically tops up in another tab (the wallet) and switches back, so
  // this surfaces the new funds immediately instead of waiting for the next poll.
  useEffect(() => {
    const on_focus = () => refresh_balances()
    window.addEventListener('focus', on_focus)
    document.addEventListener('visibilitychange', on_focus)
    return () => {
      window.removeEventListener('focus', on_focus)
      document.removeEventListener('visibilitychange', on_focus)
    }
  }, [refresh_balances])

  // ----- LIVE CASH-OUT value (bid) — poll EACH held bucket, every ~1.5s --------
  // The position's cash-out value (the "NOW" / early-exit bid) is the SUM of each
  // non-empty bucket's bid, each quoted via the on-chain devInspect
  // get_trade_amounts on its own side. An empty bucket contributes 0 (no quote).
  // null when not quoteable (e.g. pending_settlement) — we keep the last value.
  // Once the round is SETTLING the displayed numbers are frozen, so a fresh quote
  // would either fail (no live market) or pointlessly nudge a pinned figure — we
  // STOP polling entirely (the effect below clears the interval) and bail here too.
  const load_cashout = useCallback(async () => {
    if (!position || settling_now) return
    const quote = async (
      is_up: boolean,
      quantity: bigint,
    ): Promise<bigint | null> => {
      if (quantity <= 0n) return 0n
      try {
        const r = await read_trade_amounts(client, {
          oracle_id: position.oracle_id,
          expiry_ms: BigInt(position.expiry_ms),
          strike_1e9: BigInt(position.strike_1e9),
          is_up,
          quantity,
          sender: addr ?? undefined,
        })
        return r.bid_payout
      } catch {
        // not quoteable (e.g. pending_settlement) — signal "keep last value"
        return null
      }
    }
    const [up, down] = await Promise.all([
      quote(true, position.up.quantity),
      quote(false, position.down.quantity),
    ])
    set_cashout_bids(prev => ({
      up: up ?? prev.up,
      down: down ?? prev.down,
    }))
  }, [position, settling_now, client, addr])

  useEffect(() => {
    if (!position) {
      set_cashout_bids({ up: null, down: null })
      return
    }
    // SETTLING: stop polling. The numbers are frozen at their round-end value, so
    // we neither fetch nor reschedule — the position visibly LOCKS instead of
    // nudging. (We keep the last bids; the held card freezes on them.)
    if (settling_now) return
    load_cashout()
    // ~4s cadence (was 1.5s) — the per-side cost floor + the P&L deadband keep
    // the held numbers calm between polls, so 4s reads fine while cutting
    // per-held-bucket devInspect (+CORS preflight) spam on the fullnode.
    // Pause when the tab is hidden — resume on the next tick when it's visible.
    const id = setInterval(() => {
      if (!document.hidden) load_cashout()
    }, 4_000)
    return () => clearInterval(id)
  }, [position, settling_now, load_cashout])

  // ===== THE POSITION VIEW — both buckets + the ONE pending bet, as ONE number ==
  // ONE source of truth for the displayed accumulated position. The confirmed
  // `position` holds BOTH buckets (up/down); the single `pending_bet` is a
  // transient PENDING overlay folded into its MATCHING side (clearly marked
  // PENDING in the UI). It is NEVER committed until the tx confirms with on-chain
  // success, and dropped on failure. We surface the pair as ONE accumulated
  // mark-to-market position:
  //   · up/down    = per-side {qty, cost}, each incl. the pending bet on that side
  //   · quantity   = total contracts held across both sides (size, not netted)
  //   · total_cost = up.cost + down.cost (+ the pending bet's debit on its side)
  //   · cashout    = bid_up·qty_up + bid_down·qty_down — the SINGLE accumulated
  //                  cash-out / mark-to-market value of the WHOLE position. Each
  //                  side's confirmed bid is floored at its own cost until its
  //                  first quote lands (never flickers to 0); the pending bet adds
  //                  its bare-cost estimate (a fresh bet can't sell back for more
  //                  than it cost).
  //   · net_lean   = which side carries more size ('UP' / 'DOWN' / null=hedged) —
  //                  a small secondary hint only; the primary surface is `cashout`.
  const view = useMemo(() => {
    const base_up_qty = position ? position.up.quantity : 0n
    const base_up_cost = position ? position.up.cost_1e6 : 0n
    const base_down_qty = position ? position.down.quantity : 0n
    const base_down_cost = position ? position.down.cost_1e6 : 0n
    // Fold the ONE pending bet into the side it is on.
    const pend_up = pending_bet && pending_bet.is_up
    const pend_down = pending_bet && !pending_bet.is_up
    const up_qty = base_up_qty + (pend_up ? pending_bet!.quantity : 0n)
    const up_cost = base_up_cost + (pend_up ? pending_bet!.debit_1e6 : 0n)
    const down_qty = base_down_qty + (pend_down ? pending_bet!.quantity : 0n)
    const down_cost = base_down_cost + (pend_down ? pending_bet!.debit_1e6 : 0n)
    const quantity = up_qty + down_qty
    const total_cost = up_cost + down_cost
    // Per-side confirmed bid (floored at its own BARE cost until its first quote
    // lands so the number never flickers to 0, yet never over-credits the rake the
    // redeem won't refund), plus the pending bet's bare-cost estimate on its side.
    // The SINGLE accumulated cash-out is the sum.
    const up_bid =
      (base_up_qty > 0n ? (cashout_bids.up ?? bare_cost(base_up_cost)) : 0n) +
      (pend_up ? pending_bet!.cost_1e6 : 0n)
    const down_bid =
      (base_down_qty > 0n ? (cashout_bids.down ?? bare_cost(base_down_cost)) : 0n) +
      (pend_down ? pending_bet!.cost_1e6 : 0n)
    const cashout = up_bid + down_bid
    const has_any = quantity > 0n
    // Net lean: the side with more contracts (a tiny qualifier, not the surface).
    const net_lean: 'UP' | 'DOWN' | null =
      up_qty > down_qty ? 'UP' : down_qty > up_qty ? 'DOWN' : null
    return {
      up_qty,
      up_cost,
      down_qty,
      down_cost,
      up_bid,
      down_bid,
      quantity,
      total_cost,
      cashout,
      has_any,
      net_lean,
    }
  }, [position, pending_bet, cashout_bids])

  // Rising TICK as the live cash-out value climbs (cosmetic; reads state only).
  // We compare each new quote to the previous and chirp on an increase while a
  // position is held. sfx.tick() is internally throttled + a no-op before unlock.
  // GATED ON !settling_now: once the round is settling the numbers are FROZEN, so
  // the bip would machine-gun on a pinned figure ("numbers froze but the bip keeps
  // playing") — we silence both the tick and the tension while settling.
  const prev_cashout = useRef<bigint | null>(null)
  useEffect(() => {
    if (position && view.has_any && !settling_now) {
      const v = view.cashout
      const prev = prev_cashout.current
      if (prev != null && v > prev) sfx.tick()
      prev_cashout.current = v
      // Rising TENSION near the coin-flip crossover. closeness peaks at the 50/50
      // knife-edge (cash-out ≈ half the size's max payout) and falls off as the
      // outcome gets decided either way.
      const payout = dusdc_to_usd(v)
      const max_payout = dusdc_to_usd(view.quantity)
      const mid = max_payout / 2
      const closeness =
        max_payout > 0 ? Math.max(0, 1 - Math.abs(payout - mid) / mid) : 0
      if (closeness > 0.4) sfx.tension(closeness)
    } else {
      prev_cashout.current = null
    }
  }, [position, view, settling_now])

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

  // ----- RECONSTRUCT the position from chain/indexer truth on load -----------
  // A page reload wipes React state; recover the live SINGLE position from the
  // indexer's minted feed (never localStorage) so claim/cash-out keep working —
  // minus anything the redeemed feed shows as already claimed/cashed-out. We
  // reconstruct ONLY when we are NOT already tracking a round this session AND no
  // bet is mid-flight: in-session, a confirmed bet folds its real on-chain
  // quantity straight into `position` (truth, from the tx we sent), so we must not
  // let a laggy indexer re-read clobber it; the pending bet is likewise protected.
  // The reconstruct is the RELOAD-recovery path, not a live poller.
  //
  // SCOPED BY manager_id (NOT the wallet): Predict positions live under the
  // PredictManager, and the wallet-scoped indexer queries were verified STALE —
  // `/positions/minted?trader=<wallet>` missed the live open position while the
  // manager-scoped feed returned it. So we wait for manager_id to resolve, then
  // query both minted + redeemed by it.
  //
  // On a fetch failure we do NOT clear/replace a known position and do NOT treat
  // the user as having nothing open; we surface a soft, non-blocking note and let
  // the next poll retry.
  useEffect(() => {
    if (!addr || !manager_id || position || pending_bet) return
    const mgr = manager_id
    let alive = true
    Promise.all([fetch_minted(mgr), fetch_redeemed(mgr), fetch_oracles()])
      .then(([minted, redeemed, list]) => {
        if (!alive) return
        set_reconstruct_failed(false)
        // D6: build the live "recently cashed" suppression set (drop expired keys).
        const now_ms = Date.now()
        const suppressed = new Set<string>()
        for (const [k, until] of recently_cashed.current) {
          if (until > now_ms) suppressed.add(k)
          else recently_cashed.current.delete(k)
        }
        const open = reconstruct_position(minted, redeemed, list, suppressed)
        if (open) set_position(open)
      })
      .catch(() => {
        if (alive) set_reconstruct_failed(true)
      })
    return () => {
      alive = false
    }
  }, [addr, manager_id, position, pending_bet])

  // ----- AUTO-CLAIM ALL settled WINS on load (per-position, robust) ----------
  // On load (once the manager + feeds resolve), sweep EVERY settled + won +
  // unclaimed position. The held-bet auto-claim (claimed_ref effect below) only
  // handles the one open position we display; this catches every OTHER claimable
  // win (e.g. older settled wins the reconstruct view never surfaces). We gather
  // them from the manager-scoped minted/redeemed feeds + the oracle list (same
  // truth as reconstruct). Guarded to fire ONCE per manager (the ref is keyed to
  // the manager id).
  //
  // D4 — DE-ATOMIZED: claim each winner in its OWN tx (not one PTB). A single
  // already-redeemed leg (indexer lag) would abort the whole batch and STRAND the
  // rest; per-tx, one stale leg only skips itself (its already-redeemed abort is
  // tolerated). D1 — REPORT each swept winner through report_result so the silent
  // sweep now fires a toast + history row + balance bump per win (then a final
  // refresh snaps to truth). A settlement claim's payout == quantity (gross $1×qty);
  // its cost = the summed bucket mint cost (debit_with_rake of the indexer bare cost).
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
        // SF8: this sweep is a SPONSORED write — it MUST take the global lock so the
        // per-position auto-claim (which guards on !tx_pending) can't fire the SAME
        // claim concurrently. If another write already holds the lock, DEFER: reset
        // the ref so a later manager-resolution / re-render retries, don't race.
        if (tx_pending_ref.current) {
          claim_all_for_ref.current = null
          return
        }
        set_tx_pending(true)
        try {
          for (const c of claimable) {
            if (!alive) break
            const tx = build_claim_tx(c)
            try {
              const res = await signAndExecute({ transaction: tx })
              const full = await client.waitForTransaction({
                digest: res.digest,
                options: { showEffects: true },
              })
              const status = (
                full.effects as { status?: { status?: string } } | undefined
              )?.status?.status
              if (status !== 'success') continue // already redeemed / aborted — skip
              // D1: report this swept winner. A settlement claim's payout == qty
              // (gross $1×qty); cost = the summed bucket basis from gather. Pass the
              // stable bucket key so the row dedups against the per-position
              // auto-claim's twin + the reload seed (HIGH 2b).
              report_result(
                c.quantity > c.cost_1e6,
                c.quantity,
                c.is_up,
                c.cost_1e6,
                true,
                event_key({
                  oracle_id: c.oracle_id,
                  is_up: c.is_up,
                  strike: c.strike_1e9.toString(),
                  expiry: c.expiry_ms.toString(),
                }),
              )
            } catch {
              // One leg failed (already-redeemed/network) — skip it, keep sweeping.
            }
          }
          if (!alive) return
          refresh_balances()
        } finally {
          set_tx_pending(false)
        }
      } catch {
        // Best-effort sweep: allow a retry on the next manager resolution.
        if (alive) claim_all_for_ref.current = null
      }
    })()
    return () => {
      alive = false
    }
  }, [addr, manager_id, signAndExecute, client, refresh_balances])

  // ----- AUTO-RECOVER stranded game-account funds (ONCE per manager) ----------
  // Money can sit in the manager's INTERNAL balance — settled winnings redeemed
  // via an external path, an old redeem from before the auto-sweep, or leftover
  // bet-funding buffer — and the WALLET is the only balance the UI reliably shows.
  // So on load we sweep any manager balance back to the wallet via
  // router::withdraw_all (gasless, no rake, user-signed): funds never strand and
  // the displayed balance is always whole, with no button to hunt for.
  //
  // Bulletproof by construction: the manager is resolved DIRECTLY (fetch_manager,
  // proven to work in-browser) so a no-bet session where the manager_id STATE never
  // landed still recovers; the balance is read via read_manager_balance's
  // devInspect-free fallback. Skips silently when empty (no needless tx) and takes
  // the global write lock so it can never race a bet/claim and strand it. The ref
  // is claimed synchronously right after the resolve await, so the manager_id
  // null→resolved double-render can't fire two sweeps.
  const swept_for_ref = useRef<string | null>(null)
  useEffect(() => {
    if (!addr) return
    let alive = true
    ;(async () => {
      try {
        const mgr = manager_id ?? (await fetch_manager(addr))
        if (!alive || !mgr) return
        if (swept_for_ref.current === mgr) return
        swept_for_ref.current = mgr // claim the slot (atomic: no await before this)
        const bal = await read_manager_balance(client, mgr, addr)
        // Skip a NEGLIGIBLE balance: never fire a tx (or a misleading "Moved
        // $0.00" notice) for sub-cent dust — e.g. leftover bet-funding buffer.
        // The manual Withdraw + the redeem-path sweep still take the FULL balance,
        // and the dust still shows in the displayed total (manager + wallet), so
        // nothing is hidden or stranded. 0.01 dUSDC = 10_000 base units (6-dp).
        if (!alive || bal < 10_000n) return
        // Another sponsored write holds the lock (a bet/claim in flight) — defer and
        // let a later resolution retry, never race it.
        if (tx_pending_ref.current) {
          swept_for_ref.current = null
          return
        }
        set_tx_pending(true)
        try {
          const res = await signAndExecute({
            transaction: build_withdraw_all_tx(mgr),
          })
          await client.waitForTransaction({ digest: res.digest })
          if (!alive) return
          set_notice(`Moved ${fmt_usd(bal)} to your wallet.`)
          set_notice_kind(null)
          refresh_balances()
        } finally {
          set_tx_pending(false)
        }
      } catch {
        // best-effort — allow a retry on the next manager resolution
        if (alive) swept_for_ref.current = null
      }
    })()
    return () => {
      alive = false
    }
  }, [addr, manager_id, client, signAndExecute, refresh_balances])

  // ----- SEED the GAINS/LOSS log on load — from ON-CHAIN EVENTS (D2) ----------
  // So past results (WINS INCLUDED) show after a refresh. Fires ONCE per manager
  // (ref-keyed), read-only — it never signs anything. Two honest sources, deduped
  // by the bucket key so a position is exactly ONE row:
  //   · REALIZED rows from PositionRedeemed events — the EXACT payout + the
  //     settlement-vs-cashout discriminator (wins are no longer omitted/mis-scored).
  //   · HELD-TO-SETTLEMENT LOSER rows from the indexer minted∩¬redeemed feed (a
  //     loser never redeems, so it emits no redeem event — its −debit row comes
  //     from the feed). We DROP any loser whose key already has a realized row.
  // A settled WINNER not yet redeemed has NO redeem event AND is excluded from
  // losers (it stays a claimable OPEN position via reconstruct/sweep) — so it is
  // never double-logged. Session settles (report_result) still PREPEND exact rows;
  // the seed only backfills, and only when the live log is empty.
  const seeded_results_ref = useRef<string | null>(null)
  useEffect(() => {
    if (!addr || !manager_id) return
    const mgr = manager_id
    if (seeded_results_ref.current === mgr) return
    seeded_results_ref.current = mgr
    let alive = true
    Promise.all([
      fetch_minted(mgr),
      fetch_redeemed(mgr),
      fetch_oracles(),
      fetch_redeemed_events(client, mgr),
      fetch_minted_events(client, mgr),
    ])
      .then(([minted, redeemed, list, redeemed_ev, minted_ev]) => {
        if (!alive) return
        // Realized rows (wins + cash-outs) from the on-chain events.
        const realized = gather_realized_results_from_events(redeemed_ev, minted_ev)
        const realized_keys = new Set(realized.map(r => r.key))
        // Held-to-settlement loser rows from the indexer feed; drop any whose key
        // already has a realized event row (no double-count across the two paths).
        const losers = gather_settled_results(minted, redeemed, list).filter(
          l => !realized_keys.has(l.key),
        )
        // Merge, sort most-recent-first by expiry, cap. Attach the stable bucket
        // key to each row so a live-session capture dedups against its seed twin
        // (HIGH 2b — push_result keys on `key`).
        const merged = [...realized, ...losers]
          .sort((a, b) => b.expiry - a.expiry)
          .map(x => ({ ...x.result, key: x.key }))
          .slice(0, RESULTS_CAP)
        if (merged.length === 0) return
        set_results(prev => (prev.length > 0 ? prev : merged))
      })
      .catch(() => {
        // Best-effort backfill — allow a retry on the next manager resolution.
        if (alive) seeded_results_ref.current = null
      })
    return () => {
      alive = false
    }
  }, [addr, manager_id, client])

  // NOTE: no eager wallet->manager sweep. Funding is LAZY — `place_bet` funds
  // exactly the shortfall (cost + small buffer) from the wallet via the bet PTB's
  // payment coin, so we never surprise the user by moving their whole balance.

  // ----- PLACE BET — SERIALIZED, HONEST per-side tap --------------------------
  // TWO-DISTINCT-POSITIONS MODEL: a tap opens or GROWS the MATCHING side's bucket
  // (UP and DOWN are separate on-chain MarketKeys that never net), so EITHER side
  // is always bettable — there is no opposite-side block. SERIALIZATION: only ONE
  // bet tx is ever in flight at a time (tx_pending guards it) — this is the FIX for
  // the withdraw_with_proof abort, where two stacked bet txs under-funded the
  // shared manager and reused the same wallet coins. The tap is
  // shown immediately as PENDING (optimistic size + balance drop, clearly marked
  // PENDING in the VM), then folded into the confirmed position ONLY after the tx
  // CONFIRMS with on-chain success; on failure/rejection the pending bet is
  // dropped and one clear error shows — no phantom position, no fake success.
  //
  // `run_bet` executes ONE bet end-to-end under the lock. The public `place_bet`
  // either runs it now (no write in flight) or QUEUES the tap to fire after the
  // prior confirms (the serial tap queue) — preserving the "tap to grow" feel
  // without ever firing two concurrent bet txs.
  const run_bet = useCallback(
    async (is_up: boolean): Promise<void> => {
      set_error(null)
      set_notice(null)
      set_notice_kind(null)
      if (!addr) {
        set_error('Sign in first.')
        return
      }
      // The round target. A held position pins the round (oracle_id, expiry,
      // strike) so a same-side grow lands on the exact same MarketKey; otherwise
      // this opens a fresh round from the selected oracle/strike. Read state via
      // the functional setters where it matters; here we snapshot the current
      // position for the round key.
      // Read the LATEST confirmed position from the ref (synchronously fresh for a
      // queued grow that runs right after a prior confirm).
      const held_pos = position_ref.current
      let tgt_oracle_id: string
      let tgt_expiry_ms: number
      let tgt_strike: bigint
      if (held_pos != null && !position_empty(held_pos)) {
        // Growing the held position — pin its round (oracle/expiry/strike). EITHER
        // side is bettable: the tap folds into its OWN bucket (UP and DOWN live
        // under distinct on-chain MarketKeys and never net), so there is no
        // cross-side reject here.
        tgt_oracle_id = held_pos.oracle_id
        tgt_expiry_ms = held_pos.expiry_ms
        tgt_strike = BigInt(held_pos.strike_1e9)
      } else {
        if (!oracle || strike == null) {
          set_error('No live market yet — try again in a moment.')
          return
        }
        if (oracle.status !== 'active') {
          set_error('Market is not open for new bets right now.')
          return
        }
        tgt_oracle_id = oracle.oracle_id
        tgt_expiry_ms = oracle.expiry
        tgt_strike = strike
      }
      // Per-contract ask for this side — the basis for sizing `quantity` so the
      // DEBIT (cost + 3% rake) ≈ the wager. ALWAYS a FRESH on-chain quote at the
      // EXACT target round key (read_trade_amounts at PREVIEW_QUANTITY = 1
      // contract): the chain charges `quantity` at the EXECUTION-time price, so
      // sizing from the kept preview once debited $8.90 on a $5 wager (9.5
      // contracts sized at a stale ~$0.52 ask, charged at the real ~$0.91). The
      // preview (up_cost/down_cost) is DISPLAY-only; here it survives ONLY as the
      // fallback for a transient quote-read failure, and ONLY when it passes the
      // display gate's own criteria (same round + within TTL) — else the bet fails
      // gracefully: a re-tap beats a silently mis-sized debit.
      let cost_unit: bigint | null = null
      try {
        const q = await read_trade_amounts(client, {
          oracle_id: tgt_oracle_id,
          expiry_ms: BigInt(tgt_expiry_ms),
          strike_1e9: tgt_strike,
          is_up,
          quantity: PREVIEW_QUANTITY,
          sender: addr,
        })
        cost_unit = q.ask_cost
      } catch {
        const preview = is_up ? up_cost : down_cost
        const stamp = is_up ? up_cost_at.current : down_cost_at.current
        cost_unit =
          preview != null &&
          preview > 0n &&
          stamp.oracle_id === tgt_oracle_id &&
          Date.now() - stamp.at <= ODDS_STALE_MS
            ? preview
            : null
      }
      if (cost_unit == null || cost_unit <= 0n) {
        set_pending_bet(null)
        set_error('Couldn’t price the bet — try again.')
        return
      }
      let quantity = quantity_for_stake(stake_usd, cost_unit)
      const cost = cost_for_quantity(cost_unit, quantity)
      // The HONEST "paid" figure = bare mint cost + the on-chain 3% router rake —
      // the exact amount that leaves the wallet. Shown as PAID + dropped from the
      // balance optimistically (the pending bet), reconciling to the penny.
      const debit = debit_with_rake(cost)
      // Manager headroom for the future on-chain rake + quote drift.
      const need = bet_amount_with_buffer(cost)
      // Spendable = manager + wallet. SERIALIZED, so no other in-flight bet has
      // committed funds — this is the current SETTLED balance, safe to size against.
      const spendable = (manager_balance ?? 0n) + (wallet_dusdc ?? 0n)
      if (spendable < need) {
        set_error(
          `Not enough funds. Need ~${fmt_usd(need)}; add test funds below.`,
        )
        return
      }

      // ENGAGE THE LOCK + show the PENDING bet (optimistic preview). The lock
      // guarantees no concurrent bet/withdraw/cash-out can touch the manager.
      set_tx_pending(true)
      set_busy('bet')
      set_pending_bet({ is_up, quantity, debit_1e6: debit, cost_1e6: cost })
      // Instant "bet fired" feedback.
      sfx.placed()
      sfx.whoosh()
      try {
        // Resolve-or-create the manager (chain/indexer truth), then read its
        // on-chain balance so we fund only the SHORTFALL.
        const mgr = await ensure_manager()
        let on_chain = manager_balance
        try {
          on_chain = await read_manager_balance(client, mgr, addr)
          set_manager_balance(on_chain)
        } catch {
          // keep last known
        }
        // FUND FROM A FRESH ON-CHAIN QUOTE AT THE EXACT QUANTITY. The unit-ask
        // `cost` above is a linear scale of PREVIEW_QUANTITY from a moment ago;
        // on-chain `router::bet` re-quotes the cost at execution, and growing a
        // winning side (the contract dearer as spot moves toward it) makes the
        // real cost exceed that figure → an under-funded payment →
        // withdraw_with_proof abort (code 3). So we re-quote get_trade_amounts at
        // the REAL `quantity` (same call + `ask_cost` field the preview
        // `up_cost`/`down_cost` come from) and size the funding off that, keeping
        // the existing 1.08x buffer. On a quote failure we fall back to the
        // sizing-quote `need` so a transient read hiccup doesn't block the bet
        // (the on-chain re-quote + the buffer still protect funding).
        let need_fresh = need
        // The fresh BARE mint cost for THIS exact quantity (q.ask_cost). We store
        // its grossed-up debit in the bucket so the LIVE history row matches the
        // REFRESH row (gather_settled_results uses the same indexer bare cost). On a
        // quote-read hiccup we fall back to the sizing-quote `cost`. NO PRE-EMPTIVE
        // OOB BLOCK (owner): we DON'T read the band + abort before sending — every
        // bet goes to the chain. If the protocol actually rejects (assert_mintable_ask
        // at mint), the landed-tx / sponsor-502 handlers below map it to the friendly
        // ASK_OOB_MESSAGE. That on-chain rejection is the ONLY backstop.
        let cost_fresh = cost
        try {
          const q = await read_trade_amounts(client, {
            oracle_id: tgt_oracle_id,
            expiry_ms: BigInt(tgt_expiry_ms),
            strike_1e9: tgt_strike,
            is_up,
            quantity,
            sender: addr,
          })
          need_fresh = bet_amount_with_buffer(q.ask_cost)
          cost_fresh = q.ask_cost
        } catch {
          // transient quote hiccup — keep the sizing-quote `need` + `cost`.
        }
        let debit_fresh = debit_with_rake(cost_fresh)
        // WAGER GUARD — "the stake is what leaves your wallet" is a HARD promise,
        // not a hope. `quantity` was sized from the unit ask a beat ago; if this
        // at-quantity quote says the REAL debit overshoots the selected stake by
        // >5% (the ask moved between the two quotes, or book depth priced the
        // size above the unit ask), RE-SIZE the quantity down proportionally
        // (cost ≈ linear in quantity) and re-quote once so funding + the recorded
        // PAID stay honest. Granularity cents over the stake are fine — dollars
        // never. On a re-quote failure the cost scales linearly with the shrink
        // (the chain charges the smaller quantity either way).
        const stake_units = BigInt(Math.max(1, Math.round(stake_usd))) * DUSDC_SCALE
        const target_cost =
          (stake_units * 10_000n) / (10_000n + ROUTER_FEE_BPS)
        if (cost_fresh > (target_cost * 105n) / 100n) {
          const prev_qty = quantity
          const resized = (quantity * target_cost) / cost_fresh
          quantity = resized < 1n ? 1n : resized
          try {
            const q2 = await read_trade_amounts(client, {
              oracle_id: tgt_oracle_id,
              expiry_ms: BigInt(tgt_expiry_ms),
              strike_1e9: tgt_strike,
              is_up,
              quantity,
              sender: addr,
            })
            cost_fresh = q2.ask_cost
          } catch {
            cost_fresh = (cost_fresh * quantity) / prev_qty
          }
          need_fresh = bet_amount_with_buffer(cost_fresh)
          debit_fresh = debit_with_rake(cost_fresh)
          // Keep the optimistic PENDING preview honest with the resized bet.
          set_pending_bet({
            is_up,
            quantity,
            debit_1e6: debit_fresh,
            cost_1e6: cost_fresh,
          })
        }
        const shortfall =
          (on_chain ?? 0n) >= need_fresh ? 0n : need_fresh - (on_chain ?? 0n)
        const { total: wallet_total, coin_ids } = await fetch_dusdc_coins(
          client,
          addr,
        )
        // FRIENDLY OUT-OF-FUNDS CHECK off FRESH truth (manager + wallet), BEFORE we
        // build/send — so the sponsor never sees an under-funded bet (which would
        // surface as a cryptic 502). Drops the optimistic pending bet cleanly. We
        // gate on (manager + wallet) covering `need_fresh` — NOT on the wallet coin
        // count: after a cash-out the manager holds the funds and the wallet may have
        // ZERO dUSDC coin objects, which is a FULLY-FUNDED re-bet (the bet PTB funds
        // the mint from the manager via a zero payment coin — see build_bet_tx). The
        // copy branches on whether a position is already held (a true FIRST bet has
        // no staked figure to quote).
        const available = (on_chain ?? 0n) + wallet_total
        if (available < need_fresh) {
          set_pending_bet(null)
          refresh_balances()
          const has_pos =
            position_ref.current != null &&
            !position_empty(position_ref.current)
          set_error(
            has_pos
              ? `Not enough dUSDC — you've staked ${fmt_usd(view.total_cost)}. ` +
                  `Cash out or top up to bet more.`
              : 'Not enough dUSDC — add test funds below.',
          )
          return
        }

        // The market may have flipped to pending_settlement during the awaits
        // above. Re-check the live oracle status right before sending — minting
        // into a non-active market aborts.
        const fresh = find_oracle(await fetch_oracles(), tgt_oracle_id)
        if (!fresh || fresh.status !== 'active') {
          set_pending_bet(null)
          refresh_balances()
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
        // HONEST CONFIRM: wait for the tx AND assert on-chain success before we
        // commit the bet into the position. A failed/aborted tx must NOT produce a
        // phantom position or a fake "placed" affordance.
        const full = await client.waitForTransaction({
          digest: res.digest,
          options: { showEffects: true },
        })
        const eff = full.effects as
          | { status?: { status?: string; error?: string } }
          | undefined
        const status = eff?.status?.status
        if (status !== 'success') {
          // The tx landed but the move call aborted — drop the pending bet and
          // surface one clear error. No phantom position. D3-ERROR: if the abort is
          // the ask-out-of-bounds code, show the calm "left the price band" message.
          set_pending_bet(null)
          refresh_balances()
          set_error(
            is_ask_oob_error(eff?.status?.error ?? '')
              ? ASK_OOB_MESSAGE
              : 'Bet did not go through — nothing was placed. Try again.',
          )
          return
        }
        // RECONCILE (confirmed success): fold the confirmed quantity into the
        // MATCHING side's bucket, then drop the pending bet so the optimistic
        // overlay collapses exactly as the confirmed position appears. PAID
        // accumulates the DEBIT (what truly left the wallet). We compute the next
        // position from the REF (the latest confirmed value, synchronously) so a
        // queued grow (either side) that runs next sees it before React re-renders;
        // then mirror it into the ref AND state. A tap on the SAME round (oracle +
        // expiry, regardless of side) folds into that side's bucket; a different
        // round replaces. React state only — a reload recovers from the indexer.
        const prev_pos = position_ref.current
        const same_round =
          prev_pos != null &&
          !position_empty(prev_pos) &&
          prev_pos.oracle_id === tgt_oracle_id &&
          prev_pos.expiry_ms === tgt_expiry_ms
        // PAID accumulates the FRESH-quote debit (debit_fresh) so the live row's
        // cost == the refresh row's cost (both the grossed-up on-chain bare cost).
        const grow_bucket = (b: Bucket): Bucket => ({
          quantity: b.quantity + quantity,
          cost_1e6: b.cost_1e6 + debit_fresh,
        })
        const next_pos: Position = same_round
          ? {
              ...prev_pos!,
              up: is_up ? grow_bucket(prev_pos!.up) : prev_pos!.up,
              down: is_up ? prev_pos!.down : grow_bucket(prev_pos!.down),
            }
          : {
              oracle_id: tgt_oracle_id,
              expiry_ms: tgt_expiry_ms,
              strike_1e9: tgt_strike.toString(),
              up: is_up
                ? { quantity, cost_1e6: debit_fresh }
                : EMPTY_BUCKET,
              down: is_up
                ? EMPTY_BUCKET
                : { quantity, cost_1e6: debit_fresh },
            }
        position_ref.current = next_pos
        set_position(next_pos)
        set_pending_bet(null)
        set_notice('In. Watch it move — cash out before it crashes.')
        set_notice_kind(null)
        refresh_balances()
      } catch (e) {
        // FAILURE / rejection: drop the pending bet so the size + balance snap
        // back to truth, reconcile to chain, show one clear error. D3-ERROR: the
        // sponsor 502 wraps the on-chain abort, so map the ask-out-of-bounds code to
        // the calm "left the price band" message instead of a raw 502 string.
        const msg = (e as Error).message ?? ''
        set_pending_bet(null)
        refresh_balances()
        set_error(is_ask_oob_error(msg) ? ASK_OOB_MESSAGE : `Bet failed: ${msg}`)
      } finally {
        set_tx_pending(false)
        set_busy(null)
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
      view.total_cost,
      // `position` is read via position_ref (synchronously fresh), not the closure.
    ],
  )

  // Keep the freshest run_bet in a ref so the serial queue drain (which may run
  // long after a tap) always uses the latest state-bound closure.
  const run_bet_ref = useRef(run_bet)
  run_bet_ref.current = run_bet

  // Drain the serial tap queue one bet at a time. Reentrancy-guarded so only one
  // drainer ever runs; each bet awaits fully (confirm or fail) before the next
  // fires — NEVER two concurrent bet txs against the manager.
  const drain_queue = useCallback(async () => {
    if (queue_running.current) return
    queue_running.current = true
    try {
      while (tap_queue.current.length > 0) {
        const next = tap_queue.current.shift()!
        await run_bet_ref.current(next)
      }
    } finally {
      queue_running.current = false
    }
  }, [])

  // Public tap entry. Push the tap onto the serial queue, then kick the drainer.
  // The drainer runs bets ONE at a time (each awaits confirm/fail before the next
  // fires), so a tap while a bet is mid-flight is simply processed next — NEVER a
  // second concurrent bet tx. The market-locked block + the conflicting-write block
  // (SF7) are enforced in the action layer, so a queued tap is always an open or a
  // grow (either side) on a live round.
  const place_bet = useCallback(
    (is_up: boolean) => {
      tap_queue.current.push(is_up)
      void drain_queue()
    },
    [drain_queue],
  )

  // Push one settled outcome onto the GAINS/LOSS log (V), most-recent-first,
  // capped. DEDUP BY the stable bucket `key` (HIGH 2b): if a row with the same key
  // already exists (e.g. the sweep announced a win and the per-position auto-claim
  // races the same bucket, or a session row meets its reload-seed twin), we do NOT
  // add a duplicate. Keyed on `key`, NOT `id` (id = Date.now(), always unique).
  // Pure presentation; never feeds a tx.
  const push_result = useCallback(
    (is_up: boolean, won: boolean, pnl_usd: number, key?: string) => {
      set_results(prev => {
        if (key != null && prev.some(r => r.key === key)) return prev
        const row: CrashResult = {
          id: Date.now(),
          key,
          isUp: is_up,
          won,
          pnlUsd: pnl_usd,
        }
        return [row, ...prev].slice(0, RESULTS_CAP)
      })
    },
    [],
  )

  // ----- announce ONE net outcome — the concise win/loss TOAST + flash + sfx -----
  // Drives the user-facing settle feedback from the NET P&L (proceeds − cost), so a
  // tiny early-exit profit reads "+$0.04" not the gross "$5.04", and a hedged
  // NET-WIN round can never flash "You lost" (it fires exactly ONCE from the net).
  // `won_override` (D7) forces the WIN treatment even on a near-zero net: a hedge
  // where ANY side won must NEVER flash "You lost $0.0". When omitted, the sign of
  // the net decides. The amount is shown to the CENT (fmt_signed_cents) so a small
  // realized win/loss is VISIBLE (the money rule's ≥$10 whole-dollar rounding hid
  // a real +$0.45 as "+$0"). The toast carries the signed magnitude.
  const announce_outcome = useCallback(
    (net_pnl_units: bigint, won_override?: boolean) => {
      const won =
        won_override != null ? won_override : net_pnl_units > 0n
      const net_usd = dusdc_to_usd(net_pnl_units)
      set_error(null)
      set_flash(won ? 'win' : 'lose')
      if (won) {
        // A real net win shows its signed cents; a "you won but net ~0" hedge
        // (won_override with net ≤ 0) reads as a flat "settled" to stay honest.
        set_notice(
          net_pnl_units > 0n
            ? `You won ${fmt_signed_cents(net_usd)}`
            : 'Settled — you broke even',
        )
        set_notice_kind('win')
        sfx.win()
        sfx.coin_shower()
      } else {
        set_notice(`You lost ${fmt_signed_cents(net_usd)}`)
        set_notice_kind('loss')
        sfx.loss()
        sfx.deflate()
      }
      setTimeout(() => set_flash(null), 1800)
    },
    [],
  )

  // ----- report ONE side's realized outcome — log row + balance bump (+toast) ----
  // TWO-DISTINCT-POSITIONS MODEL: each side resolves on its OWN (early cash-out, or
  // settlement claim/loss). `payout` is THIS side's realized proceeds (its cash-out
  // bid, or its settlement payout — 0n on a loss); `cost_1e6` is THIS side's paid;
  // `is_up` is THIS side. It ALWAYS logs ONE GAINS/LOSS row (the NET per-side P&L)
  // and bumps the displayed balance by the GROSS payout (the wallet really receives
  // gross). It fires the win/loss TOAST + flash only when `announce` is true
  // (default) — a hedged SETTLE passes announce=false on both sides and fires ONE
  // net toast itself, so two rows never fight over the toast (SF5). It DOES NOT
  // touch the position buckets — the caller owns which bucket to drop.
  const report_result = useCallback(
    (
      won: boolean,
      payout: bigint | null,
      is_up: boolean,
      cost_1e6: bigint,
      announce = true,
      // Stable bucket key (oracle|side|strike|expiry) for the history-row dedup.
      key?: string,
    ) => {
      if (!addr) return
      // NET P&L: this side's proceeds minus its all-in debit (cost + 3% rake).
      const pnl_units = (payout ?? 0n) - cost_1e6
      const pnl_usd = dusdc_to_usd(pnl_units)
      // The concise, COLOURED settle toast — driven by the NET P&L (B1/SF1).
      if (announce) announce_outcome(pnl_units)
      // GAINS/LOSS log row (V) for THIS side (its own net P&L), deduped by key.
      push_result(is_up, won, pnl_usd, key)
      // Reconcile: bump the displayed total up by this side's GROSS payout (the
      // wallet receives gross on a win), then a refresh snaps it to truth. Based on
      // the displayed total (optimistic ?? manager+wallet) so it never ghost-flashes.
      // GENERATION-TAG it (D5): stamp with the NEXT poll gen so a poll that started
      // before this bump can't clear it — only a read whose gen post-dates this
      // stamp (i.e. one that began after the redeem confirmed) wipes the override.
      // FUNCTIONAL UPDATER (multi-winner): the on-load sweep reports several winners
      // in sequence; reading `optimistic` from the closure here would let each
      // overwrite the last (last-payout-wins). The functional form STACKS each
      // winner's payout onto the live override. Same gen stamp.
      if (payout != null && payout > 0n) {
        set_optimistic(prev => {
          const base =
            prev?.value ?? (manager_balance ?? 0n) + (wallet_dusdc ?? 0n)
          return { value: base + payout, gen: poll_gen.current + 1 }
        })
      }
    },
    [addr, manager_balance, wallet_dusdc, push_result, announce_outcome],
  )

  // ----- CASH OUT ONE SIDE — exit a single bucket (early redeem) ---------------
  // TWO-DISTINCT-POSITIONS MODEL: each side has its OWN cash-out button. This sells
  // back ONLY the given side's bucket via a SINGLE router::cash_out leg
  // (build_cash_out_tx); the OTHER bucket stays open. redeem CREDITS the manager
  // (no deposit), so a one-leg redeem has no funding race. On success it reports
  // THIS side's result and drops ONLY this bucket (clearing the whole position if
  // it was the last one). The GLOBAL LOCK guards it (one redeem in flight); a bet
  // can't race a cash-out either (symmetric serialization preserved).
  const cash_out_side = useCallback(
    async (side: 'up' | 'down') => {
      if (tx_pending) return
      if (!addr || !position || !manager_id) return
      const is_up = side === 'up'
      const bucket = is_up ? position.up : position.down
      if (bucket.quantity <= 0n) return
      set_error(null)
      set_tx_pending(true)
      set_busy('cashout')
      set_cashout_side(side)
      try {
        // Early redeem needs a LIVE, quoteable oracle. Re-check at call time.
        const fresh = find_oracle(await fetch_oracles(), position.oracle_id)
        if (!fresh || fresh.status !== 'active') {
          set_error('Round settling — you can claim once it settles.')
          return
        }
        // This side's realized proceeds = its live bid, floored at its BARE cost
        // before the first quote (the redeem refunds no rake, so don't over-credit).
        const proceeds =
          (is_up ? cashout_bids.up : cashout_bids.down) ??
          bare_cost(bucket.cost_1e6)
        const tx = build_cash_out_tx({
          manager_id,
          oracle_id: position.oracle_id,
          expiry_ms: BigInt(position.expiry_ms),
          strike_1e9: BigInt(position.strike_1e9),
          is_up,
          quantity: bucket.quantity,
        })
        const res = await signAndExecute({ transaction: tx })
        const full = await client.waitForTransaction({
          digest: res.digest,
          options: { showEffects: true },
        })
        const status = (
          full.effects as { status?: { status?: string } } | undefined
        )?.status?.status
        if (status !== 'success') {
          set_error('Cash out did not go through — your position is unchanged.')
          refresh_balances()
          return
        }
        const cost = bucket.cost_1e6
        const won = proceeds > cost
        const bucket_key = event_key({
          oracle_id: position.oracle_id,
          is_up,
          strike: BigInt(position.strike_1e9).toString(),
          expiry: String(position.expiry_ms),
        })
        // D6: mark this bucket as just-cashed so the reconstruct can't resurrect it
        // while the redeemed indexer feed lags (~6s window; on-chain truth then wins).
        recently_cashed.current.set(bucket_key, Date.now() + 6_000)
        // Report THIS side's result (toast + log row + balance bump), keyed for the
        // history-row dedup (HIGH 2b — matches the reload-seed twin).
        report_result(won, proceeds, is_up, cost, true, bucket_key)
        // Drop ONLY this bucket; keep the other side open. If nothing remains,
        // clear the whole position. Mirror into the ref for the serial queue.
        const next: Position = {
          ...position,
          up: is_up ? EMPTY_BUCKET : position.up,
          down: is_up ? position.down : EMPTY_BUCKET,
        }
        if (position_empty(next)) {
          position_ref.current = null
          set_position(null)
        } else {
          position_ref.current = next
          set_position(next)
        }
        // Clear only this side's live bid; the other side keeps polling.
        set_cashout_bids(prev => ({
          up: is_up ? null : prev.up,
          down: is_up ? prev.down : null,
        }))
        refresh_balances()
      } catch (e) {
        set_error(`Cash out failed: ${(e as Error).message}`)
        // Converge to truth: clear the position so the reconstruct effect re-reads
        // the indexer (a redeemed bucket drops out, a surviving one comes back).
        set_position(null)
        set_cashout_bids({ up: null, down: null })
        refresh_balances()
      } finally {
        set_busy(null)
        set_cashout_side(null)
        set_tx_pending(false)
      }
    },
    [
      addr,
      position,
      manager_id,
      cashout_bids,
      client,
      signAndExecute,
      report_result,
      refresh_balances,
      tx_pending,
    ],
  )

  // ----- CLAIM the settled position (redeem_permissionless) — auto-claim path --
  // Once the round settles, the position wins iff settlement vs strike favours its
  // side (the SAME rule the contract uses). A WIN has a payout to claim; a LOSS
  // settles to $0 and needs no claim. IDEMPOTENCY (Bug #4): a per-position guard
  // (claimed_ref, keyed to the position identity) ensures the auto-claim effect
  // fires EXACTLY ONCE per settled position and NEVER re-loops — on success OR
  // failure. An already-redeemed abort is TERMINAL: we clear the position quietly,
  // never retry. log_both logs each held side's result (one toast) for the settle.
  //
  // The auto-claim guard, keyed to the position identity. Set ONCE the effect
  // attempts a settled position; never reset (so a settled position resolves to a
  // single attempt). Declared here so claim() can clear it on a NOT-READY early
  // return (oracle settled in state but its settlement_price hasn't landed in the
  // fresh fetch yet) — that case is NOT a terminal attempt, so the next poll must
  // be able to retry. A genuine win/loss/already-redeemed outcome is terminal.
  const claimed_ref = useRef<string | null>(null)
  // Per-position transient-failure retry counter (keyed by the SAME identity string
  // the auto-claim effect uses), so a sponsorship hiccup re-arms the claim a few
  // times before the error ever surfaces. Cleared when the position resolves.
  const claim_retries = useRef<Map<string, number>>(new Map())
  const claim = useCallback(async () => {
    if (!addr || !position || !manager_id) return
    // The position identity — MUST match `position_identity` in the auto-claim
    // effect (it keys both the single-attempt guard and the retry counter).
    const pid = `${position.oracle_id}|${position.expiry_ms}|${position.strike_1e9}|U${position.up.quantity}|D${position.down.quantity}`
    // R2: take the GLOBAL WRITE LOCK SYNCHRONOUSLY here — BEFORE the first await
    // (the get_oracles fetch below) — so the on-load claim_all sweep (or another
    // write) cannot fire router::claim for this same settled position during that
    // window and waste a sponsored tx. We read the live lock via the ref (the
    // closure's `tx_pending` is stale, not in deps): if anything already holds it,
    // CLEAR the per-identity guard and bail — the caller set it before calling, so
    // we must reset it or this settled position would never re-attempt; the `now`
    // dep re-fires the auto-claim effect each second, retrying once the lock frees.
    // Every exit path below releases the lock (the not-settled bail explicitly; the
    // inner try's finally for everything else).
    if (tx_pending_ref.current) {
      claimed_ref.current = null
      return
    }
    set_busy('claim')
    set_tx_pending(true)
    // Claim is only valid once the oracle is SETTLED with a published
    // settlement_price. Re-check at call time; read the FRESH oracle, not state.
    const fresh = find_oracle(await fetch_oracles(), position.oracle_id)
    const settle_1e9 = fresh?.settlement_price
    if (!fresh || fresh.status !== 'settled' || settle_1e9 == null) {
      // Not actually settled yet — this was NOT a real attempt; clear the guard so
      // the next poll can retry once the settlement_price lands. Release the lock
      // we took above (no tx was sent).
      claimed_ref.current = null
      set_busy(null)
      set_tx_pending(false)
      return
    }
    const settlement = BigInt(Math.round(settle_1e9))
    const strike = BigInt(position.strike_1e9)
    // In a binary round exactly ONE direction wins. The UP bucket wins iff
    // settlement >= strike; the DOWN bucket wins iff settlement < strike. The
    // winning side (if held) has a payout to claim ($1 × its contracts); the other
    // side is a $0 loss that never redeems but STILL logs a result row.
    const up_won = settlement >= strike
    const win_qty = up_won ? position.up.quantity : position.down.quantity
    const win_is_up = up_won
    const win_cost = up_won ? position.up.cost_1e6 : position.down.cost_1e6
    const lose_qty = up_won ? position.down.quantity : position.up.quantity
    const lose_is_up = !up_won
    const lose_cost = up_won ? position.down.cost_1e6 : position.up.cost_1e6
    const payout = win_qty > 0n ? win_qty : 0n
    const win_net_won = payout > win_cost
    // Log BOTH held sides' settlement outcomes (winner + loser) so a hedged round
    // produces TWO honest rows — but fire exactly ONE net toast/flash for the round
    // (SF5: two separate announces would let the loser overwrite the winner, so a
    // NET-WIN hedged round could flash "You lost"). We pass announce=false on the
    // per-side reports and announce the NET (payout − win_cost − lose_cost) once.
    // Per-side stable keys so a settlement row dedups against its reload-seed twin
    // (winner from the redeemed event, loser from the minted∩¬redeemed feed) — HIGH 2b.
    const side_key = (is_up: boolean): string =>
      event_key({
        oracle_id: position!.oracle_id,
        is_up,
        strike: strike.toString(),
        expiry: String(position!.expiry_ms),
      })
    const log_both = () => {
      if (win_qty > 0n)
        report_result(win_net_won, payout, win_is_up, win_cost, false, side_key(win_is_up))
      if (lose_qty > 0n)
        report_result(false, 0n, lose_is_up, lose_cost, false, side_key(lose_is_up))
      // ONE net toast/flash for the whole settle (only when something was held).
      // D7: if ANY held side WON at settlement, force the WIN treatment even on a
      // near-even net — a hedge where a side won must NEVER flash "You lost $0.0".
      // (announce_outcome shows the signed net for a real win, or "broke even" when
      // the forced win has net ≤ 0.) A pure loser (no winning side held) flashes
      // loss normally.
      if (win_qty > 0n || lose_qty > 0n)
        announce_outcome(payout - win_cost - lose_cost, win_qty > 0n ? true : undefined)
    }
    // The lock + busy flag were taken synchronously at the top (R2); the inner
    // try's finally releases them on every remaining exit path.
    set_error(null)
    try {
      if (payout > 0n) {
        const tx = build_claim_tx({
          manager_id,
          oracle_id: position.oracle_id,
          expiry_ms: BigInt(position.expiry_ms),
          strike_1e9: strike,
          is_up: win_is_up,
          quantity: win_qty,
        })
        const res = await signAndExecute({ transaction: tx })
        const full = await client.waitForTransaction({
          digest: res.digest,
          options: { showEffects: true },
        })
        const status = (
          full.effects as { status?: { status?: string } } | undefined
        )?.status?.status
        if (status !== 'success')
          // A landed-but-aborted claim is effectively an already-redeemed/gone
          // position (the only realistic abort after our fresh settled+price
          // guard). Use the recognizable phrase so the catch treats it as TERMINAL
          // + logs the settled outcome once, rather than a scary retrying error.
          throw new Error('claim aborted: position already redeemed')
      }
      // Log both sides' outcomes (winner + loser), then clear the whole position
      // (both buckets resolved at settlement).
      claim_retries.current.delete(pid)
      log_both()
      set_position(null)
      set_cashout_bids({ up: null, down: null })
      set_pending_bet(null)
      refresh_balances()
    } catch (e) {
      // TERMINAL — never re-loop. If the position was ALREADY redeemed (a prior
      // claim landed, e.g. across a reload), the redeem aborts; the winnings are
      // already in the manager. Either way we clear the position quietly so the
      // claimed_ref guard + the cleared position both stop the effect from
      // re-firing. We do NOT reset claimed_ref, so no infinite retry loop.
      const msg = (e as Error).message ?? ''
      // The facilitator tags a DETERMINISTIC on-chain revert as `tx-would-revert`
      // (the sponsor refuses to sponsor a tx whose dry-run aborts) — for a claim
      // that means the position is already redeemed/resolved, exactly the
      // already-redeemed case. Treat it identically: terminal, clear quietly. This
      // is what stops a settled-and-collected round from looping "sponsorship
      // failed" and reading as "stuck" (the payout is already in the manager).
      const terminal_revert =
        (e as { reason?: string })?.reason === 'tx-would-revert'
      if (terminal_revert || is_already_redeemed_error(msg)) {
        // ALREADY REDEEMED / would-revert — clear QUIETLY, no log_both(). The on-load
        // sweep already claimed + announced this bucket (toast + history row + bump);
        // calling log_both() here would DOUBLE-announce (second toast, second
        // persistent history row, transient double bump). The reload seed also
        // backfills the win from the PositionRedeemed events, so the row is never
        // lost. We mirror the sweep's silent continue. (HIGH 2a)
        claim_retries.current.delete(pid)
        set_position(null)
        set_cashout_bids({ up: null, down: null })
        set_pending_bet(null)
        refresh_balances()
      } else if (is_retryable_sponsor_error(msg)) {
        // TRANSIENT sponsorship/network failure — the claim never landed and the
        // winnings are still on-chain, so retry SILENTLY: keep the position, show
        // NO error, and re-arm the auto-claim after a short backoff (long enough
        // for the WS to reconnect). Bounded by MAX_CLAIM_RETRIES so a durable
        // outage eventually surfaces the error instead of retrying forever.
        const n = (claim_retries.current.get(pid) ?? 0) + 1
        if (n <= MAX_CLAIM_RETRIES) {
          claim_retries.current.set(pid, n)
          set_error(null)
          setTimeout(() => {
            // re-arm ONLY if this is still the held settled position (not superseded)
            if (claimed_ref.current === pid) claimed_ref.current = null
          }, CLAIM_RETRY_BACKOFF_MS)
          // NOTE: position is deliberately NOT cleared — the retry needs it.
        } else {
          // retries exhausted — surface the error and resolve terminally.
          claim_retries.current.delete(pid)
          set_error(`Auto-claim failed: ${msg}`)
          set_position(null)
          set_cashout_bids({ up: null, down: null })
          set_pending_bet(null)
          refresh_balances()
        }
      } else {
        claim_retries.current.delete(pid)
        set_error(`Auto-claim failed: ${msg}`)
        // Clear the position anyway so the effect can't re-loop on the same
        // settled position; the reconstruct re-reads truth on the next round.
        set_position(null)
        set_cashout_bids({ up: null, down: null })
        set_pending_bet(null)
        refresh_balances()
      }
    } finally {
      set_busy(null)
      set_tx_pending(false)
    }
  }, [addr, position, manager_id, client, signAndExecute, report_result, announce_outcome, refresh_balances])

  // ----- WITHDRAW to wallet (round-trip cash-out) -----
  // Moves the manager's internal balance OUT to the wallet. Because the single
  // displayed number already counts manager + wallet, the total is unchanged by
  // a withdraw — so we don't animate it; we just reconcile after it confirms.
  const withdraw_all = useCallback(async () => {
    // GLOBAL LOCK guard: ignore a click while another sponsored write is pending.
    if (tx_pending) return
    if (!addr) return
    set_error(null)
    set_busy('withdraw')
    set_tx_pending(true)
    try {
      // Re-resolve the manager ON THE SPOT (indexer) if React state lost it — a
      // no-bet session where auto-resolve didn't land would otherwise make this
      // button silently no-op. fetch_manager is proven to work in-browser.
      const mgr = manager_id ?? (await fetch_manager(addr))
      if (!mgr) throw new Error('No game account found to withdraw from.')
      // SWEEP the FULL on-chain balance via router::withdraw_all — no amount, so it
      // recovers funds even when the client mis-reads the manager balance (the whole
      // reason this path exists). The router reads the real balance + transfers it.
      const tx = build_withdraw_all_tx(mgr)
      const res = await signAndExecute({ transaction: tx })
      await client.waitForTransaction({ digest: res.digest })
      set_withdraw_open(false)
      set_notice('Moved your game-account balance to your wallet.')
      set_notice_kind(null)
      refresh_balances()
    } catch (e) {
      const msg = (e as Error).message ?? ''
      // An empty manager balance aborts harmlessly — report it calmly, not as a
      // scary failure.
      if (/empty|nothing|EZero|no balance|abort/i.test(msg)) {
        set_withdraw_open(false)
        set_notice('Nothing to move — your game account is already empty.')
        set_notice_kind(null)
      } else {
        set_error(`Withdraw failed: ${msg}`)
      }
      refresh_balances()
    } finally {
      set_busy(null)
      set_tx_pending(false)
    }
  }, [addr, manager_id, client, signAndExecute, refresh_balances, tx_pending])

  // ----- derived display values -----
  // `held` is the single "the user has a live position" sentinel — TRUE when we
  // hold a confirmed position OR a bet is mid-flight (so the held view shows
  // instantly on the first tap, marked PENDING, before the bet confirms). The
  // round key for timing comes from `position` (set on confirm) else the selected
  // oracle. `held_expiry` is the round's expiry used for the countdown / settling.
  const held = (position != null && view.has_any) || pending_bet != null
  const held_expiry =
    position != null ? position.expiry_ms : oracle != null ? oracle.expiry : 0
  const expiry_ms_left = held
    ? held_expiry - now
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
    !held &&
    (!oracle || oracle.status !== 'active' || expiry_ms_left <= LOCK_WINDOW_MS)
  // D3-LOCK — re-arm the final-15s seal for the GROW path. `locked` above is gated
  // on `!held`, so a HELD user could still grow into the sealed window (and abort).
  // `grow_locked` is the same final-15s / not-active seal evaluated for the live
  // round regardless of held state; the grow betable below ANDs it in. (The held
  // card's CASH-OUT stays always live — this only seals NEW bets / grows.)
  const grow_locked =
    !oracle || oracle.status !== 'active' || expiry_ms_left <= LOCK_WINDOW_MS
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
    !held &&
    (oracle == null ||
      oracle.status === 'pending_settlement' ||
      oracle.status === 'settled' ||
      oracle.expiry <= now)
  // The ~15s settlement window is derivable from the round's own expiry: it runs
  // from oracle.expiry to oracle.expiry + 15s. Show the seconds left while the
  // window is live; null once it elapses (then the label + hairline loader carry
  // the state with no stale counter).
  // No settling/validating COUNTDOWN — just the static label + hairline loader (a
  // seconds counter here reads like a SECOND 15s lock window). Always null.
  const validating_secs: number | null = null
  const bet_settled = bet_oracle?.status === 'settled'
  const bet_pending = bet_oracle?.status === 'pending_settlement'
  // A position is only finalizable once the oracle has published its
  // settlement_price; "settled" status can briefly precede the price landing.
  const bet_claimable = bet_settled && bet_oracle?.settlement_price != null

  // HELD-BET SETTLING PHASE — the held analogue of `validating`. Once the held
  // round passes expiry (or the oracle flips to pending_settlement / settled) the
  // position can no longer be cashed out and is being settled on-chain; the
  // outcome (win/loss) lands when claim() clears the position. Throughout this
  // window the masthead shows the SETTLING treatment (the editorial hairline
  // loader, NOT "…") and the displayed numbers freeze — exactly like the pre-bet
  // validating window. Reuses the SAME `settling_now` signal the cash-out poll +
  // bip gate on (single source, no drift), scoped to a real held position.
  // Presentation only; never gates a tx.
  const held_settling = held && settling_now

  // MAX-SETTLING GUARD — never let `frozen` stick forever. The normal release is
  // claim() clearing the position once the oracle publishes settled+settlement_price
  // (the 20s oracle poll advances bet_oracle, then the auto-claim effect fires). But
  // if an expired oracle LINGERS in pending_settlement / settled-without-price, that
  // never happens and the display would stay pinned indefinitely. So: after a
  // conservative window of CONTINUOUS settling while the position is NOT yet
  // claimable, we release ONLY the visual freeze-pin (a calm fallback — the bip is
  // already silenced + the poll already stopped). We NEVER drop the position: the
  // auto-claim keeps polling, so the instant the price lands a claimable winner is
  // still claimed. The guard is gated on `!bet_claimable`, so a claimable/settled
  // winner is never affected.
  const MAX_SETTLING_MS = 60_000
  const settling_since = useRef<number | null>(null)
  if (held_settling) {
    if (settling_since.current == null) settling_since.current = now
  } else {
    settling_since.current = null
  }
  const settling_stuck =
    held_settling &&
    !bet_claimable &&
    settling_since.current != null &&
    now - settling_since.current >= MAX_SETTLING_MS

  // While validating (pre-bet) OR settling a held position we FREEZE every live
  // display number at its round-end value. We keep a ref of the last UNFROZEN
  // snapshot of the volatile figures and serve those while frozen, so nothing
  // drifts during the window; when the next round goes active / the bet resolves
  // the flag clears and the live values resume. The MAX-SETTLING guard drops the
  // pin if settling has stalled past the window (without a claimable winner).
  const frozen = validating || (held_settling && !settling_stuck)

  // AUTO-CLAIM (IDEMPOTENT — Bug #4 fix). When the held position's oracle settles,
  // fire the winning-side redeem_permissionless EXACTLY ONCE, invisibly. The guard
  // is keyed to the POSITION IDENTITY (oracle|expiry|strike|side|quantity), not a
  // boolean that resets — so once a settled position has been attempted, the effect
  // can NEVER re-fire for it on success OR failure (no infinite retry / "-1 -1 -1"
  // loop). claim() is terminal: it clears the position on success AND on an
  // already-redeemed/failed claim, so a settled position resolves to exactly ONE
  // logged outcome. A genuinely NEW position (different identity) gets its own
  // single attempt. (claimed_ref is declared above, alongside `claim`.)
  const position_identity = position
    ? `${position.oracle_id}|${position.expiry_ms}|${position.strike_1e9}|U${position.up.quantity}|D${position.down.quantity}`
    : null
  useEffect(() => {
    // Only when the position is settled, fully reconciled (no pending bet), no
    // other write in flight, and we have NOT already attempted THIS identity. The
    // `now` dep makes this re-evaluate each second so a transient not-ready bail
    // (which clears the guard) is retried promptly — while the per-identity guard
    // still prevents any re-fire once a real attempt is committed (no loop).
    if (
      position &&
      position_identity &&
      bet_claimable &&
      !pending_bet &&
      !busy &&
      !tx_pending &&
      claimed_ref.current !== position_identity
    ) {
      // Mark THIS identity attempted BEFORE firing so a re-render can't double-fire.
      claimed_ref.current = position_identity
      claim()
    }
  }, [
    position,
    position_identity,
    bet_claimable,
    pending_bet,
    busy,
    tx_pending,
    claim,
    now,
  ])

  // Aggregate cost/value across both buckets — kept ONLY to drive the chart-tint
  // verdict (the per-side cards compute their own numbers below). `cost_now` is the
  // total paid, `cashout_now` the total live mark-to-market.
  const cost_now = view.total_cost
  const cashout_now = view.cashout
  const have_cashout =
    held && (cashout_bids.up != null || cashout_bids.down != null || pending_bet != null)

  // The AUTHORITATIVE chart-tint verdict — drives the line tint while a bet is
  // held. While the round is live we use the aggregate bid-vs-cost P&L; once the
  // oracle has published a settlement_price we switch to the SETTLEMENT
  // verdict: the winning side's payout (its contracts × $1) exceeds the TOTAL cost
  // across both buckets (the same rule claim() uses). null when nothing held.
  const chart_winning: boolean | null = !held
    ? null
    : bet_oracle?.status === 'settled' && bet_oracle.settlement_price != null && position
      ? (() => {
          const settlement = BigInt(Math.round(bet_oracle.settlement_price))
          const strike = BigInt(position.strike_1e9)
          const win_qty =
            settlement >= strike ? position.up.quantity : position.down.quantity
          return win_qty > cost_now
        })()
      : have_cashout
        ? cashout_now > cost_now
        : null

  const signed_in = Boolean(addr)

  // THE on-chain total = manager internal balance + wallet-held dUSDC. Null only
  // until the very first read lands. This is the authoritative figure the
  // displayed balance reconciles to.
  const total_balance =
    manager_balance == null && wallet_dusdc == null
      ? null
      : (manager_balance ?? 0n) + (wallet_dusdc ?? 0n)
  // THE DISPLAYED balance = on-chain total, optimistically adjusted:
  //   · MINUS the ONE in-flight bet's debit (the pending bet), so the tap drops
  //     the balance INSTANTLY in red and the drop disappears as the bet confirms
  //     (the pending bet clears + the on-chain total has fallen). Clearly a
  //     PENDING preview — the bet is NOT confirmed until the tx lands successfully;
  //   · OR the absolute win-bump override (`optimistic`, set by report_result) which
  //     wins when present (a green count-up on settle) until refresh_balances
  //     snaps to truth.
  // On-chain truth always reconciles back: a failed tap drops the pending bet, a
  // refresh clears the win-bump — so the display can never permanently drift.
  // D9: the in-flight bet's debit drops the displayed balance optimistically — but
  // a fully-MANAGER-FUNDED re-bet spends from the manager, not fresh wallet coins.
  // The on-chain `total_balance` (manager + wallet) ALREADY contains the funds the
  // bet will spend, so subtracting the full debit AND flooring at 0 produced a
  // false "$0" mid-flight. We subtract the debit but NEVER below 0, and the floor
  // is honest because total_balance always covers the bet (the funding check
  // guaranteed available >= need before we engaged the lock).
  const committed_pending = pending_bet ? pending_bet.debit_1e6 : 0n
  const displayed_balance =
    optimistic != null
      ? // D9: subtract the in-flight bet's debit from the win-bump override too, so a
        // bet placed while a win-bump is live still shows its instant drop (never
        // below 0) instead of the debit being masked by the override.
        optimistic.value > committed_pending
        ? optimistic.value - committed_pending
        : 0n
      : total_balance == null
        ? null
        : total_balance > committed_pending
          ? total_balance - committed_pending
          : 0n

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

  // ----- STALENESS — never show a quoted-but-now-STALE odds as live -------------
  // A kept quote reads as fresh ONLY while (a) it was quoted on the CURRENT round
  // (identity stamp — old-round odds must never display as live on a new round)
  // and (b) it is within ODDS_STALE_MS of landing. The TTL is sized off the poll
  // cadence (declared together at module scope) so a healthy poll NEVER expires
  // between ticks — staleness only engages when quotes genuinely stop (reads
  // failing / tab hidden), flipping the side to "Pricing…" instead of a frozen
  // number. `now` (1s tick) drives re-evaluation. NO lopsidedness coupling — a
  // side is never disabled for being a longshot/favorite.
  const up_fresh =
    up_cost == null ||
    (up_cost_at.current.oracle_id === oracle?.oracle_id &&
      now - up_cost_at.current.at <= ODDS_STALE_MS)
  const down_fresh =
    down_cost == null ||
    (down_cost_at.current.oracle_id === oracle?.oracle_id &&
      now - down_cost_at.current.at <= ODDS_STALE_MS)

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
  // Null out a STALE in-band side's payout (staleness gate) so the D12 "Pricing…"
  // render + the enable gate both treat it as not-quoted — never a frozen "1.9x".
  const up_payout = up_fresh ? payout_of(up_cost, true) : null
  const down_payout = down_fresh ? payout_of(down_cost, false) : null

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
  // draws the dashed ENTRY/STRIKE line itself from side + strike). The strike is
  // the held round's strike; the side is the position's NET-LEAN side (the side
  // carrying more contracts) so the ENTRY label tints toward the dominant bet; a
  // perfectly hedged position defaults to UP (the tint is cosmetic only — the
  // win/loss verdict comes from `chartWinning`, not this glyph).
  const chart_price_usd = spot != null ? Number(spot) / 1e9 : null
  const chart_strike_usd = position
    ? Number(BigInt(position.strike_1e9)) / 1e9
    : strike != null
      ? Number(strike) / 1e9
      : null
  const chart_side: 'UP' | 'DOWN' | null = held
    ? view.net_lean === 'DOWN'
      ? 'DOWN'
      : 'UP'
    : null

  // Countdown heartbeat: a subtle sub-pulse in the final 5s of a held round.
  const beat_ref = useRef(false)
  useEffect(() => {
    const final5 = held && expiry_ms_left > 0 && expiry_ms_left <= 5_000
    if (final5 && !beat_ref.current) {
      sfx.heartbeat()
      beat_ref.current = true
      setTimeout(() => {
        beat_ref.current = false
      }, 900)
    }
  }, [held, expiry_ms_left])

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
  // While `validating`, every volatile ROUND figure must STOP moving and hold
  // what it read at the moment the round ended: the live price (chart head +
  // tag) and the per-side payouts/multiples. We keep a ref of the last
  // NON-validating snapshot of those values and serve it while validating; once
  // the next round goes active `validating` clears and the live values flow
  // again. The odds poll is already gated on `oracle.status === 'active'` so
  // up/down cost stop refreshing on their own — this snapshot makes the freeze
  // explicit + also pins the live price (which otherwise keeps polling). The
  // BALANCE is deliberately NOT snapshotted here: it is the user's real money and
  // must stay live through the freeze (see `disp_balance_str`). Pure
  // presentation; the snapshot never feeds a tx and state keeps reconciling.
  // `upQuoted`/`downQuoted` pin the per-side "a real quote backs this number"
  // flag too: quotes stop during the freeze, so the LIVE freshness gate decays to
  // false mid-window — without the pin the cards would flip to "Pricing…" in the
  // middle of the freeze instead of holding their round-end numbers.
  const frozen_snapshot = useRef<{
    chartPriceUsd: number | null
    upWin: number
    downWin: number
    upMult: number | null
    downMult: number | null
    upQuoted: boolean
    downQuoted: boolean
  }>({
    chartPriceUsd: null,
    upWin: stake_usd * 2,
    downWin: stake_usd * 2,
    upMult: null,
    downMult: null,
    upQuoted: false,
    downQuoted: false,
  })

  // THE HOUSE (PLP vault) LOGIC moved to the /house tab (src/shell), which owns
  // `useHouse` directly — Play no longer renders or drives the vault. App is the
  // pure bet + chart + cash-out screen now.

  // ----- map the preserved app state -> the ported e05 design's `data` -------
  // Balance couplet uses the CENTS-visible balance formatter so any realized change
  // (a +$0.45 win on a $148 balance) is VISIBLE, while a fat testnet balance still
  // never clips (k/M collapse above $10k). Below the collapse: full 2-decimal cents.
  const fmt_money_whole = (units: bigint): string => fmt_balance(units)

  // Resolve the FROZEN display values: while not validating, REFRESH the snapshot
  // with the live figures and pass the live values straight through; while
  // validating, leave the snapshot untouched and serve it (so the numbers hold at
  // their round-end value). `chart_price_usd` is the live spot the chart head +
  // tag glide toward; pinning it here (plus the `frozen` flag the chart reads to
  // stop easing) holds the head still during the window.
  const live_balance_str =
    displayed_balance != null ? fmt_money_whole(displayed_balance) : '—'
  // The LIVE per-side "a real, fresh, same-round quote backs the number" flags —
  // the e05 renders the big WIN number only when true ("Pricing…" otherwise).
  const up_quoted_live = up_cost_stake != null && up_fresh
  const down_quoted_live = down_cost_stake != null && down_fresh
  if (!frozen) {
    frozen_snapshot.current = {
      chartPriceUsd: chart_price_usd,
      upWin: up_win,
      downWin: down_win,
      upMult: up_mult,
      downMult: down_mult,
      upQuoted: up_quoted_live,
      downQuoted: down_quoted_live,
    }
  }
  const snap = frozen_snapshot.current
  const disp_chart_price_usd = frozen ? snap.chartPriceUsd : chart_price_usd
  const disp_up_win = frozen ? snap.upWin : up_win
  const disp_down_win = frozen ? snap.downWin : down_win
  const disp_up_mult = frozen ? snap.upMult : up_mult
  const disp_down_mult = frozen ? snap.downMult : down_mult
  const disp_up_quoted = frozen ? snap.upQuoted : up_quoted_live
  const disp_down_quoted = frozen ? snap.downQuoted : down_quoted_live
  // BALANCE IS EXEMPT FROM THE FREEZE. The freeze pins ROUND figures (price,
  // odds, win/multiple) at their round-end value so they don't drift mid-settle —
  // but the balance is the user's real money, which can change at ANY time
  // (an external deposit / add-funds lands on the fullnode independent of the
  // round lifecycle) and must NEVER be held stale. A stuck validating/settling
  // window (e.g. the oracle not transitioning as expected) would otherwise
  // freeze the balance indefinitely. Always serve the live balance string; the
  // steady poll above keeps it fresh through every state.
  const disp_balance_str = live_balance_str

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

  // DUAL-SIDE MODEL: BOTH sides are ALWAYS tappable. A tap on either side folds
  // into that side's bucket (UP and DOWN live under distinct on-chain MarketKeys
  // and never net), so there is no cross-side gate — the user freely accumulates
  // UP and/or DOWN in the same round. A side is disabled only when the market is
  // locked / not active / unaffordable / no quote yet, and (symmetric guard) while
  // any write is in flight (serialization — one bet tx at a time).
  // D3-LOCK: gate on `!grow_locked` (the held-AGNOSTIC final-15s/not-active seal)
  // so a GROW in the sealed window is blocked too — not `!locked` (which is gated
  // on !held and would let a held user grow into the seal). The held card's
  // cash-out stays live (it doesn't read base_betable).
  const base_betable =
    !grow_locked &&
    strike != null &&
    oracle?.status === 'active' &&
    can_afford(stake_usd) &&
    !tx_pending
  // D12: require a REAL per-side payout quote (up_payout/down_payout are null until
  // a genuine ask loads) to ENABLE — never enable off the static stake×2 fallback.
  // NO LOPSIDEDNESS GATING (owner): both sides are ALWAYS bettable once quoted —
  // a near-1.0x favorite and a 1.7x longshot both render + tap. The ONLY backstop is
  // the protocol's real on-chain rejection IF it happens (the friendly OOB message
  // in run_bet); we never pre-emptively disable a side.
  const up_enabled = base_betable && up_cost_stake != null && up_payout != null
  const down_enabled =
    base_betable && down_cost_stake != null && down_payout != null

  // Held-round masthead state: 'settling' once the held round is past expiry /
  // settling (the masthead then shows the SETTLING treatment + the hairline
  // loader, never "…"); null while the round is still live (the real mm:ss timer
  // shows the true remaining time throughout the round).
  const held_special: 'settling' | null = held_settling ? 'settling' : null
  // The ~15s on-chain settlement window for a HELD position runs from its expiry
  // to expiry + 15s. Surface the live seconds left (item #5) so the masthead shows
  // a real countdown alongside "SETTLING ROUND" instead of just a static label;
  // null once the window elapses (the label + hairline loader then carry the state).
  // No settling COUNTDOWN — just "SETTLING ROUND" + the hairline loader (a second
  // 15s timer reads like a doubled lock window). Always null.
  const held_settling_secs: number | null = null

  // ----- PER-SIDE held VMs — TWO DISTINCT POSITIONS, each its own card ---------
  // Build one SideVM per side that holds contracts (qty > 0). Every figure is for
  // THAT side alone (its qty, its cost, its live bid), honest by construction — no
  // merged/netted number. The value floors at the side's BARE cost before its first
  // quote (the redeem refunds no rake, so we never over-credit). The shared
  // settling/pending state gates whether the per-card CTA can fire.
  const fmt_contracts = (qty: bigint): string => {
    const c = Number(qty) / Number(ONE_CONTRACT_QTY)
    return `${c.toFixed(c >= 10 ? 0 : 1)} contracts`
  }
  // The live-P&L deadband (in $): |liveNet| under this reads NEUTRAL grey, so a
  // position hovering at break-even never strobes green↔red on quote jitter.
  const LIVE_NET_DEADBAND = 0.02
  const make_side_vm = (
    is_up: boolean,
    qty: bigint,
    cost: bigint,
    // The side's already-floored mark-to-market value (view.up_bid/down_bid):
    // its live bid floored at BARE cost pre-quote, with the pending bet's bare
    // cost folded in (SF3 — never the raw 0n bid that bypasses the floor).
    value: bigint,
  ): SideVM => {
    const side_word = is_up ? 'UP' : 'DOWN'
    // A quote (or an optimistic value) is available when this side has a live bid
    // OR a pending bet IS ON THIS SIDE (SF4 — a pending bet on the OTHER side must
    // not fabricate a quote/negative P&L on this unbet side).
    const has_quote =
      (is_up ? cashout_bids.up : cashout_bids.down) != null ||
      (pending_bet != null && pending_bet.is_up === is_up)
    // The LOCKED flag for THIS card: the held round is settling (no cash-out, outcome
    // unknown). Keyed off the App-level held_settling (== held && settling_now).
    const settling = held_settling
    // LIVE P&L (the chrome + hero driver) = exit-now value − cost, in $.
    const exit_value_usd = dusdc_to_usd(value)
    const cost_usd = dusdc_to_usd(cost)
    const live_net = exit_value_usd - cost_usd
    // State: 'neutral' pre-quote (no phantom) OR while settling, OR inside the
    // deadband; else winning / losing by the SIGN of the live net.
    const state: SideVM['state'] =
      !has_quote || settling
        ? 'neutral'
        : live_net >= LIVE_NET_DEADBAND
          ? 'winning'
          : live_net <= -LIVE_NET_DEADBAND
            ? 'losing'
            : 'neutral'
    // Hero string with caret. Neutral/no-quote shows the plain signed net (or $0.00
    // pre-quote) with no caret; winning/losing prepend ▴/▾.
    const net_str = has_quote ? fmt_signed_cents(live_net) : '+$0.00'
    const live_net_str =
      state === 'winning'
        ? `▴ ${net_str}`
        : state === 'losing'
          ? `▾ ${net_str}`
          : net_str
    const now_sublabel =
      state === 'winning'
        ? 'winning now'
        : state === 'losing'
          ? 'losing now'
          : 'about even'
    // Conditional settle payout (qty × $1) — ALWAYS grey/"IF", never tinted.
    const win_units = qty
    return {
      side: side_word,
      contractsStr: fmt_contracts(qty),
      liveNet: live_net,
      liveNetStr: live_net_str,
      state,
      nowSublabel: now_sublabel,
      exitValueStr: `value now ${fmt_usd_cents(value)}`,
      paidStr: `paid ${fmt_usd_cents(cost)}`,
      // '+' prefix: the wager already left at bet time, so the settle credit is a
      // literal +$X cash-in — signed like every other landing amount, FOMO intact.
      ifWinTotalStr: `+${fmt_usd_cents(win_units)}`,
      // The button carries the SIGNED LIVE NET — the real cash-out-now gain, which
      // CAN be negative (shown honestly with "take"). Plain "Cash out" pre-quote.
      cashoutCtaStr: has_quote
        ? `Cash out · take ${fmt_signed_cents(live_net)}`
        : 'Cash out',
      cashoutPositive: live_net >= 0,
      // Firable on a CONFIRMED bucket with a quote, no pending bet, no write in
      // flight. The pending overlay belongs to the side being placed — block its
      // cash-out until it confirms (matches the old single-card guard).
      canCashout:
        position != null &&
        qty > 0n &&
        has_quote &&
        pending_bet == null &&
        !tx_pending,
      busyCashout:
        busy === 'cashout' && cashout_side === (is_up ? 'up' : 'down'),
      settling,
      // Honest both-outcomes while settling: winner gets gross qty×$1, loser gets $0.
      ifWinsStr: `IF ${side_word} WINS → you get ${fmt_usd(win_units)}`,
      ifLosesStr: `IF ${side_word} LOSES → you get $0`,
    }
  }
  // The per-side held map: a side appears only when it holds contracts. We fold the
  // pending bet into the matching side (via the view's up_qty/up_cost etc.) so the
  // optimistic preview shows on the side being placed.
  const held_sides: { up?: SideVM; down?: SideVM } = {}
  if (held) {
    if (view.up_qty > 0n)
      held_sides.up = make_side_vm(true, view.up_qty, view.up_cost, view.up_bid)
    if (view.down_qty > 0n)
      held_sides.down = make_side_vm(
        false,
        view.down_qty,
        view.down_cost,
        view.down_bid,
      )
  }

  const data: CrashData = {
    signedIn: signed_in,
    balanceStr: disp_balance_str,
    roundStr: '· live round',
    // Identity: the cluster shows the `<name>@suize` SuiNS handle when resolved,
    // else the truncated, click-to-copy hex address. The copy payload is ALWAYS
    // the full address (addressFull), never the handle.
    addressFull: addr ?? null,
    addressShort: fmt_addr(addr),
    handle: signed_in ? handle : null,

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
      // QUOTED only when a quote exists AND it is fresh + same-round — a stale
      // side reads as not-quoted so the e05 shows "Pricing…", not a frozen
      // number. Freeze-pinned alongside win/mult (disp_*_quoted) so the cards
      // hold their round-end render through the settling window.
      disp_up_quoted,
      Boolean(up_enabled),
    ),
    down: side_vm(
      disp_down_win,
      disp_down_mult,
      disp_down_quoted,
      Boolean(down_enabled),
    ),
    // Manager-create still shows a spinner on the UP control (the first tap path).
    // Betting taps no longer set a per-side busy (they stack), so the spinner only
    // reflects the one-time manager bootstrap.
    busyUp: busy === 'manager',
    busyDown: false,

    held: held
      ? {
          // The round's locked settlement LINE (relabelled from "ENTRY", which read
          // as a cost basis). fmt_strike unchanged; the e05 layer adds the
          // "up wins above / down wins below" hint.
          entryStr: position
            ? `LINE ${fmt_strike(BigInt(position.strike_1e9))}`
            : strike != null
              ? `LINE ${fmt_strike(strike)}`
              : 'LINE —',
          sides: held_sides,
          pending: bet_pending,
          settled: bet_settled,
          settling: held_settling,
          countdownText: countdown,
          countdownSpecial: held_special,
          settlingSecs: held_settling_secs,
          busyClaim: busy === 'claim',
        }
      : null,

    chartSamples: chart_samples_ref.current,
    spot: disp_chart_price_usd,
    strike: chart_strike_usd,
    chartSide: chart_side,
    chartWinning: chart_winning,

    flash: flash,
    // GAINS/LOSS results log (V) — most recent first, already capped.
    results,

    // House (PLP vault) data moved to the /house tab — not in Play's CrashData.

    error,
    notice,
    noticeKind: notice_kind,
    reconstructFailed: reconstruct_failed,
    // GLOBAL WRITE LOCK — true while ANY sponsored write (bet, cash out, claim,
    // supply, withdraw, redeem, manager-create) is in flight; the e05 skin greys
    // out + disables EVERY action control so no second write can start. A bet tap
    // while a BET is in flight is QUEUED (bet-vs-bet serialization); a tap while a
    // NON-bet write holds the lock is BLOCKED synchronously in placeBet (SF7), so a
    // bet can never race a supply/redeem/withdraw and reuse the same wallet coins.
    txPending: tx_pending,
  }

  const actions: CrashActions = {
    selectStake: usd => {
      const i = STAKE_PRESETS_USD.indexOf(usd as (typeof STAKE_PRESETS_USD)[number])
      sfx.stake_select(i >= 0 ? i / (STAKE_PRESETS_USD.length - 1) : 0.5)
      set_stake_usd(usd)
    },
    setCustomStake: usd => {
      sfx.tap()
      // Floor the custom stake at $1 — a bet can never be sized below $1. We
      // clamp the value the input feeds in (NaN/0/negatives all snap up to 1)
      // BEFORE applying the affordability cap, so the stake stays in [1, max].
      const floored = Number.isFinite(usd) ? Math.max(1, Math.floor(usd)) : 1
      const clamped =
        max_affordable_usd != null && max_affordable_usd >= 1
          ? Math.min(floored, max_affordable_usd)
          : floored
      set_stake_usd(clamped)
    },
    placeBet: side => {
      // DUAL-SIDE + SERIALIZED. Either side is always tappable — a tap folds into
      // its own bucket. A tap fired while a BET is already in flight is QUEUED by
      // place_bet (never a second concurrent bet tx — bet-vs-bet serialization).
      // SF7: also block a tap while ANY OTHER sponsored write holds the lock
      // (cash-out / claim / supply / redeem / withdraw / manager-create). Without
      // this, a multi-touch tap mid-supply would queue+fire a bet that reuses the
      // same wallet coins the supply is spending → equivocation (coins locked to
      // epoch end). We allow queueing ONLY when the lock is held by a bet
      // (busy === 'bet'); every other holder blocks the tap synchronously.
      if (busy === 'cashout' || busy === 'claim') return
      if (tx_pending && busy !== 'bet') return
      const want_up = side === 'UP'
      // NO PRE-EMPTIVE LOPSIDEDNESS BLOCK (owner): every tap is allowed through. If
      // the protocol actually rejects (ask out of the mintable band at mint time),
      // run_bet surfaces the friendly "left the price band" message as the backstop —
      // we never pre-block a "bad" bet.
      sfx.tap()
      place_bet(want_up)
    },
    cashOutSide: side => {
      if (tx_pending) return
      sfx.tap()
      sfx.splash()
      cash_out_side(side === 'UP' ? 'up' : 'down')
    },
    claimBet: () => {
      if (tx_pending) return
      claim()
    },
    // "Withdraw" opens the in-app sweep modal: it moves the user's manager
    // (game-account) dUSDC balance out to their connected wallet via
    // router::withdraw_all. This recovers funds that settled into the manager but
    // never auto-swept (and is reachable regardless of whether the client can read
    // the manager balance — the sweep needs no amount). (addFunds still funnels to
    // the PAY wallet for top-ups.)
    withdraw: () => set_withdraw_open(true),
    addFunds: () => window.open(WALLET_URL, '_blank', 'noopener'),
    signInGoogle: () => sign_in_google(),
    signOut: () => sign_out(),
    // The logo "back to bet" anchor: Play is the whole screen, so just scroll to
    // top (the old house_view scroll target is gone).
    goToBet: () => window.scrollTo({ top: 0, behavior: 'smooth' }),
    // A LOCKED sibling market in Play's context strip → the Markets tab grid.
    goToMarkets: () => navigate('/markets'),
  }

  return (
    <div className={`app${held ? ' held' : ''}`}>
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
          opened by the header Withdraw link. Manual fallback to the automatic
          on-load sweep — confirms moving the manager balance out to the wallet
          via router::withdraw_all. */}
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
              Move your entire game-account balance out to your connected
              wallet — including any settled winnings that haven’t landed yet.
            </p>
            <div className="modal-actions">
              <button
                className="btn ghost"
                onClick={() => set_withdraw_open(false)}
                disabled={busy !== null}
              >
                CANCEL
              </button>
              {/* NOT gated on the read balance: router::withdraw_all sweeps the real
                  on-chain amount, so recovery works even if manager_balance mis-reads. */}
              <button
                className="btn accent"
                onClick={withdraw_all}
                disabled={busy !== null}
              >
                {busy === 'withdraw' ? (
                  <span className="spin" />
                ) : manager_balance != null && manager_balance > 0n ? (
                  `WITHDRAW ${fmt_usd(manager_balance)}`
                ) : (
                  'WITHDRAW ALL'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
