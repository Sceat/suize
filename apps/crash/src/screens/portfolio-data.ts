// ============================================================================
// PORTFOLIO DATA — reconstruct OPEN positions + settled HISTORY from CHAIN TRUTH.
// ----------------------------------------------------------------------------
// The Portfolio tab is a routed dashboard screen, mounted INDEPENDENTLY of the
// immersive Play screen (App.tsx) — it shares none of App's render state. So it
// rebuilds everything from the same public primitives App reads (api.ts indexer
// feeds + sui.ts on-chain event/devInspect reads), keyed off the caller's
// PredictManager (resolved from the indexer, never localStorage). A refresh,
// a wiped cache, or a brand-new device all recover the identical truth — there
// is NOTHING client-persisted here.
//
// This module mirrors App's reconciliation RULES verbatim (the same position
// identity, the same 3% rake gross-up, the same settlement-vs-strike predicate)
// so the Portfolio never disagrees with Play about what is open or what a
// settled row realized. It deliberately re-derives them off the public helpers
// rather than importing App's render-coupled internals — Portfolio must not pull
// in App's hooks/lifecycle to read chain history.
// ============================================================================

import {
  fetch_manager,
  fetch_minted,
  fetch_oracles,
  fetch_redeemed,
  type MintedPosition,
  type Oracle,
  type RedeemedPosition,
} from '../api'
import {
  fetch_redeemed_events,
  read_trade_amounts,
  type ReadClient,
  type RedeemedEvent,
} from '../sui'
import { dusdc_to_usd } from '../format'
import { ONE_CONTRACT_QTY, ROUTER_FEE_BPS } from '../config'

// ---- shared math (mirrors App.tsx — single rules, re-derived off public consts)

// cost + the on-chain 3% router rake = the dUSDC that actually LEFT the wallet.
// The honest "paid" basis and the break-even for every P&L figure.
const debit_with_rake = (cost_1e6: bigint): bigint =>
  cost_1e6 + (cost_1e6 * ROUTER_FEE_BPS) / 10_000n

// Parse an indexer/event integer (JSON number or u64-string) to an EXACT bigint
// — no float round-trip, so the value is byte-identical to what was minted.
const to_bigint = (v: unknown, fallback: bigint): bigint => {
  if (typeof v === 'string' && v.length > 0) {
    try {
      return BigInt(v)
    } catch {
      return fallback
    }
  }
  if (typeof v === 'number' && Number.isFinite(v)) return BigInt(Math.trunc(v))
  return fallback
}

// Full MarketKey identity (oracle|manager|side|strike|expiry) — the same tuple
// the on-chain redeem addresses, so a redeemed row excludes its minted row 1:1.
const position_key = (p: {
  oracle_id?: string
  manager_id?: string
  is_up?: boolean
  strike?: number
  expiry?: number
}): string =>
  `${p.oracle_id ?? ''}|${p.manager_id ?? ''}|${p.is_up ? 'U' : 'D'}|${p.strike ?? ''}|${p.expiry ?? ''}`

// Event-form key (no manager): events + the indexer loser feed reconcile on
// oracle|side|strike|expiry. strike/expiry stay exact strings (no Number()).
const event_key = (e: {
  oracle_id: string
  is_up: boolean
  strike: string
  expiry: string
}): string => `${e.oracle_id}|${e.is_up ? 'U' : 'D'}|${e.strike}|${e.expiry}`

// ---- view-models the screen renders -----------------------------------------

// One OPEN side, reconstructed from chain. The cash-out VALUE ticks from a live
// devInspect redeem quote (read-only) — Portfolio NEVER signs; the Cash Out
// button hands the user to the Play screen where the live cash-out flow runs.
export type OpenPosition = {
  key: string // event-form key (stable across refresh) — React key
  oracleId: string
  side: 'UP' | 'DOWN'
  strike1e9: bigint
  expiryMs: number
  quantity: bigint // summed contracts on this side (1e6-scaled)
  contracts: number // quantity / 1e6 — the human contract count
  paidUsd: number // the all-in basis (bare cost grossed up by the rake)
  // live mark-to-market, filled by refreshOpenQuotes(); null until first quote
  valueUsd: number | null // bid_payout in $ if cashed out NOW
  netUsd: number | null // valueUsd − paidUsd (the signed live P&L)
  ifWinUsd: number // gross credit if this side settles in the money (qty × $1)
  status: 'live' | 'settling' // active vs past-expiry / settling (cash-out frozen)
}

// One settled HISTORY row — realized, immutable, deep-linkable. One row per
// (round × side) the user bet in — recovered COMPLETELY from the manager-scoped
// indexer feed + oracle settlement (not the capped event window), so no round
// the user played ever goes missing.
export type HistoryRow = {
  key: string // event/bucket key — React key + dedup
  side: 'UP' | 'DOWN'
  won: boolean // settlement crossed the line in this side's favour
  outcome: 'WIN' | 'LOSS' // the headline verdict
  stakeUsd: number // the all-in basis that left the wallet
  netUsd: number // signed realized P&L in $
  contracts: number // how many contracts this side held
  strikeUsd: number // the round's settlement line
  ts: number // settle wall-clock ms (sort + label)
  digest: string | null // settling tx digest → SuiVision link (when in window)
}

// A point on the cumulative-P&L "skill curve": running realized net after each
// settled round, oldest→newest, for the Portfolio chart.
export type PnlPoint = { ts: number; cum: number }

export type PortfolioData = {
  managerId: string | null
  open: OpenPosition[]
  history: HistoryRow[]
  // aggregate hero figures (realized only — open P&L is unrealized, excluded)
  netUsd: number // Σ realized net across all history
  wins: number
  losses: number
  accuracy: number | null // wins / settled, [0,1]; null when no settled rows
  // ---- skill stats (the "charts of my skills" surface) ----
  roundsPlayed: number // settled rounds the user bet in (history length)
  volumeUsd: number // Σ all-in stake across every settled round
  bestUsd: number // single best realized round (max net)
  streak: number // current win streak (consecutive WINs from the newest row)
  upWins: number
  upTotal: number
  downWins: number
  downTotal: number
  pnl: PnlPoint[] // cumulative realized net over time (oldest→newest)
}

export const EMPTY_PORTFOLIO: PortfolioData = {
  managerId: null,
  open: [],
  history: [],
  netUsd: 0,
  wins: 0,
  losses: 0,
  accuracy: null,
  roundsPlayed: 0,
  volumeUsd: 0,
  bestUsd: 0,
  streak: 0,
  upWins: 0,
  upTotal: 0,
  downWins: 0,
  downTotal: 0,
  pnl: [],
}

// ---- OPEN reconstruction (indexer minted feed × live oracles × redeemed) -----
// A side is OPEN while its oracle is still active OR pending_settlement (it has
// NOT settled — a settled winner becomes a claim, handled on Play) AND it has no
// matching redeemed record. We sum each (oracle, side) bucket's mints. Past
// expiry but not-yet-settled = 'settling' (cash-out frozen, like Play).
const reconstruct_open = (
  minted: MintedPosition[],
  redeemed: RedeemedPosition[],
  oracles: Oracle[],
  now: number,
): OpenPosition[] => {
  const byId = new Map(oracles.map(o => [o.oracle_id, o]))
  const redeemedKeys = new Set(redeemed.map(position_key))
  type Agg = {
    oracleId: string
    side: 'UP' | 'DOWN'
    strike1e9: bigint
    expiryMs: number
    quantity: bigint
    cost: bigint // BARE summed cost (grossed up once at the end)
    status: 'live' | 'settling'
  }
  const buckets = new Map<string, Agg>()
  for (const m of minted) {
    if (m.oracle_id == null || m.strike == null || m.expiry == null) continue
    const o = byId.get(m.oracle_id)
    // OPEN = oracle exists and is NOT settled (active / pending_settlement /
    // created). A settled oracle's position is a claim/loss → it belongs to
    // HISTORY, not OPEN.
    if (!o || o.status === 'settled') continue
    if (redeemedKeys.has(position_key(m))) continue
    const key = position_key(m)
    const strike = to_bigint(m.strike, 0n)
    const is_up = Boolean(m.is_up)
    const expiry = Math.trunc(m.expiry)
    const prev = buckets.get(key)
    if (prev) {
      prev.quantity += to_bigint(m.quantity, ONE_CONTRACT_QTY)
      prev.cost += to_bigint(m.cost, 0n)
    } else {
      buckets.set(key, {
        oracleId: m.oracle_id,
        side: is_up ? 'UP' : 'DOWN',
        strike1e9: strike,
        expiryMs: expiry,
        quantity: to_bigint(m.quantity, ONE_CONTRACT_QTY),
        cost: to_bigint(m.cost, 0n),
        status: expiry <= now ? 'settling' : 'live',
      })
    }
  }
  const rows: OpenPosition[] = []
  for (const b of buckets.values()) {
    if (b.quantity <= 0n) continue
    const paid = debit_with_rake(b.cost)
    rows.push({
      key: event_key({
        oracle_id: b.oracleId,
        is_up: b.side === 'UP',
        strike: b.strike1e9.toString(),
        expiry: String(b.expiryMs),
      }),
      oracleId: b.oracleId,
      side: b.side,
      strike1e9: b.strike1e9,
      expiryMs: b.expiryMs,
      quantity: b.quantity,
      contracts: Number(b.quantity) / Number(ONE_CONTRACT_QTY),
      paidUsd: dusdc_to_usd(paid),
      valueUsd: null,
      netUsd: null,
      ifWinUsd: Number(b.quantity) / Number(ONE_CONTRACT_QTY),
      status: b.status,
    })
  }
  // soonest-expiring first (the live one the user is watching leads)
  return rows.sort((a, b) => a.expiryMs - b.expiryMs)
}

// ---- HISTORY (settled) -------------------------------------------------------
// Two honest sources, deduped by the event key:
//  (1) REDEEMED events — the EXACT realized payout + settle digest for every
//      cashed-out / settlement-claimed bucket (win OR an early-cashed loser).
//  (2) HELD-TO-SETTLEMENT LOSERS — minted on a now-settled oracle, never
//      redeemed (a loser pays $0, so it emits no redeem). Its realized P&L is
//      unambiguous: −debit. These are the only rows (1) cannot recover, since a
//      $0 loss never hits the redeemed feed.
// A winner that settled but was NOT yet claimed stays OPEN/claimable on Play —
// it is intentionally absent here until it redeems (then (1) picks it up).
// COMPLETE source: the manager-scoped indexer minted feed (server-side scoped =
// every mint the user ever made, NOT the ~200-row global event window) crossed
// with each oracle's settlement. Every (round × side) the user bet in on a
// SETTLED oracle becomes one row — won/lost from settlement-vs-strike, so NO
// round is ever dropped (the old path silently skipped any redeemed row whose
// mint had fallen out of the capped event window). The capped `redeemedEvents`
// feed is used ONLY to enrich the exact payout + the settle-tx digest where it
// is in the window; the row exists regardless.
const reconstruct_history = (
  redeemedEvents: RedeemedEvent[],
  minted: MintedPosition[],
  oracles: Oracle[],
): HistoryRow[] => {
  const byId = new Map(oracles.map(o => [o.oracle_id, o]))

  const enrich = new Map<string, { payout: bigint; digest: string | null; ts: number }>()
  for (const r of redeemedEvents) {
    const k = event_key(r)
    const prev = enrich.get(k)
    enrich.set(k, {
      payout: (prev?.payout ?? 0n) + to_bigint(r.payout, 0n),
      digest: r.digest ?? prev?.digest ?? null,
      ts: Math.max(prev?.ts ?? 0, r.ts ?? 0),
    })
  }

  type Agg = {
    side: 'UP' | 'DOWN'
    strike1e9: bigint
    expiry: number
    quantity: bigint
    cost: bigint
    won: boolean
  }
  const buckets = new Map<string, Agg>()
  for (const m of minted) {
    if (m.oracle_id == null || m.strike == null || m.expiry == null) continue
    const o = byId.get(m.oracle_id)
    if (!o || o.status !== 'settled' || o.settlement_price == null) continue
    const strike = to_bigint(m.strike, 0n)
    const settlement = BigInt(Math.round(o.settlement_price))
    const is_up = Boolean(m.is_up)
    const ekey = event_key({
      oracle_id: m.oracle_id,
      is_up,
      strike: strike.toString(),
      expiry: String(m.expiry),
    })
    const prev = buckets.get(ekey)
    if (prev) {
      prev.quantity += to_bigint(m.quantity, ONE_CONTRACT_QTY)
      prev.cost += to_bigint(m.cost, 0n)
    } else {
      buckets.set(ekey, {
        side: is_up ? 'UP' : 'DOWN',
        strike1e9: strike,
        expiry: Math.trunc(m.expiry),
        quantity: to_bigint(m.quantity, ONE_CONTRACT_QTY),
        cost: to_bigint(m.cost, 0n),
        won: is_up ? settlement >= strike : settlement < strike,
      })
    }
  }

  const rows: HistoryRow[] = []
  for (const [ekey, b] of buckets) {
    const cost = debit_with_rake(b.cost)
    const en = enrich.get(ekey)
    // exact payout from the redeem event when we have it; else the deterministic
    // settlement payout (a winner pays qty × $1, a loser $0).
    const payout = en ? en.payout : b.won ? b.quantity : 0n
    rows.push({
      key: ekey,
      side: b.side,
      won: b.won,
      outcome: b.won ? 'WIN' : 'LOSS',
      stakeUsd: dusdc_to_usd(cost),
      netUsd: dusdc_to_usd(payout - cost),
      contracts: Number(b.quantity) / Number(ONE_CONTRACT_QTY),
      strikeUsd: Number(b.strike1e9) / 1e9,
      ts: en?.ts || b.expiry,
      digest: en?.digest ?? null,
    })
  }
  return rows.sort((a, b) => b.ts - a.ts) // newest first
}

// ---- the one entry point: load the whole portfolio from chain ---------------
// Resolves the manager, then fetches all five feeds in parallel and reconciles.
// Returns EMPTY (managerId resolved or null) on a brand-new wallet with no
// history — never throws to the UI (each fetch is independently best-effort).
export const loadPortfolio = async (
  client: ReadClient,
  address: string,
): Promise<PortfolioData> => {
  const managerId = await fetch_manager(address)
  if (!managerId) return EMPTY_PORTFOLIO

  const now = Date.now()
  const [oracles, minted, redeemed, redeemedEvents] = await Promise.all([
    fetch_oracles().catch(() => [] as Oracle[]),
    fetch_minted(managerId).catch(() => [] as MintedPosition[]),
    fetch_redeemed(managerId).catch(() => [] as RedeemedPosition[]),
    fetch_redeemed_events(client, managerId).catch(() => [] as RedeemedEvent[]),
  ])

  const open = reconstruct_open(minted, redeemed, oracles, now)
  const history = reconstruct_history(redeemedEvents, minted, oracles)

  let net = 0
  let wins = 0
  let losses = 0
  let volume = 0
  let best = -Infinity
  let upWins = 0
  let upTotal = 0
  let downWins = 0
  let downTotal = 0
  for (const h of history) {
    net += h.netUsd
    volume += h.stakeUsd
    if (h.netUsd > best) best = h.netUsd
    if (h.won) wins++
    else losses++
    if (h.side === 'UP') {
      upTotal++
      if (h.won) upWins++
    } else {
      downTotal++
      if (h.won) downWins++
    }
  }
  const settled = wins + losses

  // current win streak — consecutive WINs from the newest settled row back
  let streak = 0
  for (const h of history) {
    if (h.won) streak++
    else break
  }

  // the skill curve — cumulative realized net, oldest → newest
  const pnl: PnlPoint[] = []
  let cum = 0
  for (const h of [...history].sort((a, b) => a.ts - b.ts)) {
    cum += h.netUsd
    pnl.push({ ts: h.ts, cum })
  }

  return {
    managerId,
    open,
    history,
    netUsd: net,
    wins,
    losses,
    accuracy: settled > 0 ? wins / settled : null,
    roundsPlayed: history.length,
    volumeUsd: volume,
    bestUsd: settled > 0 ? best : 0,
    streak,
    upWins,
    upTotal,
    downWins,
    downTotal,
    pnl,
  }
}

// ---- live cash-out quotes for the OPEN tickets -------------------------------
// One read-only devInspect per live side: bid_payout = what cashing out NOW
// pays. Frozen ('settling') sides are skipped (the round is past expiry; the
// cash-out value is no longer quotable). Returns a NEW array (immutable update)
// with valueUsd / netUsd filled where a quote came back; a failed quote leaves
// that ticket's value at its last good value (never a flicker to null).
export const refreshOpenQuotes = async (
  client: ReadClient,
  open: OpenPosition[],
  sender: string,
): Promise<OpenPosition[]> => {
  const quotes = await Promise.all(
    open.map(async p => {
      if (p.status !== 'live') return null
      try {
        const { bid_payout } = await read_trade_amounts(client, {
          oracle_id: p.oracleId,
          expiry_ms: BigInt(p.expiryMs),
          strike_1e9: p.strike1e9,
          is_up: p.side === 'UP',
          quantity: p.quantity,
          sender,
        })
        return dusdc_to_usd(bid_payout)
      } catch {
        return null
      }
    }),
  )
  return open.map((p, i) => {
    const v = quotes[i]
    if (v == null) return p
    return { ...p, valueUsd: v, netUsd: v - p.paidUsd }
  })
}
