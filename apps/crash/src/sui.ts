import { Transaction } from '@mysten/sui/transactions'
import { bcs } from '@mysten/sui/bcs'

// Structural client type covering only what we call. Avoids nominal conflicts
// between the `@mysten/sui` SuiClient and the copy bundled under
// `@mysten/wallet-standard` (dapp-kit), which TS otherwise sees as distinct.
export type ReadClient = {
  devInspectTransactionBlock: (args: {
    transactionBlock: Transaction
    sender: string
  }) => Promise<{
    error?: string | null
    results?:
      | Array<{
          returnValues?: Array<[number[], string]> | null
        }>
      | null
  }>
  getCoins: (args: { owner: string; coinType: string }) => Promise<{
    data: Array<{ coinObjectId: string; balance: string }>
  }>
  // suix_queryEvents — only the slice we read. The full dapp-kit client exposes a
  // richer filter/cursor; this structural shape covers our event-history reads.
  queryEvents: (args: {
    query: { MoveEventType: string }
    cursor?: { txDigest: string; eventSeq: string } | null
    limit?: number
    order?: 'ascending' | 'descending'
  }) => Promise<{
    data: Array<{
      parsedJson?: unknown
      timestampMs?: string | null
      id?: { txDigest: string; eventSeq: string }
    }>
    hasNextPage: boolean
    nextCursor?: { txDigest: string; eventSeq: string } | null
  }>
  // Plain object reads — the devInspect-free fallback for the manager balance
  // (read_manager_balance). Loosely typed (content.fields is dynamic Move data).
  getObject: (args: {
    id: string
    options?: { showContent?: boolean }
  }) => Promise<{
    // `content` is dynamic Move data (a union the SDK types as SuiParsedData) —
    // keep it `unknown` and cast at the use site so the real client is structurally
    // assignable to ReadClient.
    data?: { content?: unknown } | null
  }>
  getDynamicFields: (args: { parentId: string }) => Promise<{
    data: Array<{ name?: { type?: string }; objectId?: string }>
  }>
}
import {
  CLOCK_OBJECT,
  COIN_ZERO,
  DUSDC_TYPE,
  EVENT_POSITION_MINTED,
  EVENT_POSITION_REDEEMED,
  MOD_MANAGER,
  MOD_MARKET_KEY,
  MOD_PREDICT,
  MOD_ROUTER,
  PLP_TYPE,
  PREDICT_MANAGER_TYPE,
  PREDICT_OBJECT,
  ROUTER_CONFIG,
  VERSION_ID,
} from './config'

// ============================================================================
// Strike snapping (ATM)
// ============================================================================
// Snap a 1e9-scaled spot to the oracle grid: round to nearest tick, clamp to
// >= min_strike. All inputs/outputs are bigint in 1e9 scale.
export const snap_strike = (
  spot_1e9: bigint,
  min_strike_1e9: bigint,
  tick_1e9: bigint,
): bigint => {
  if (tick_1e9 <= 0n) return spot_1e9
  // round to nearest tick
  const half = tick_1e9 / 2n
  const snapped = ((spot_1e9 + half) / tick_1e9) * tick_1e9
  return snapped < min_strike_1e9 ? min_strike_1e9 : snapped
}

// ============================================================================
// MarketKey construction inside a PTB — READ PATH ONLY
// ============================================================================
// market_key::up(oracle_id: ID, expiry: u64, strike: u64): MarketKey
// market_key::down(oracle_id: ID, expiry: u64, strike: u64): MarketKey
// ID is serialized as an address (32 bytes). expiry & strike are u64.
// Used SOLELY by the odds-preview read (get_trade_amounts via devInspect). The
// write path (bet/cash_out/claim) never builds a key client-side — the router
// builds it on-chain from the raw (oracle_id, expiry, strike, is_up) fields.
const build_market_key = (
  tx: Transaction,
  oracle_id: string,
  expiry_ms: bigint,
  strike_1e9: bigint,
  is_up: boolean,
) =>
  tx.moveCall({
    target: `${MOD_MARKET_KEY}::${is_up ? 'up' : 'down'}`,
    arguments: [
      tx.pure.id(oracle_id),
      tx.pure.u64(expiry_ms),
      tx.pure.u64(strike_1e9),
    ],
  })

// ============================================================================
// Read odds via devInspect: get_trade_amounts(predict, oracle, key, qty, clock)
//   -> (mint_cost, redeem_payout)  [both in dUSDC base units, 1e6]
// We build a tx with a MarketKey + the view call and inspect the return values.
// ============================================================================
export type TradeAmounts = {
  ask_cost: bigint // dUSDC units it costs to BUY `quantity`
  bid_payout: bigint // dUSDC units you'd receive if you SOLD `quantity` now
}

const u64_from_bytes = (bytes: number[] | Uint8Array): bigint =>
  BigInt(bcs.u64().parse(Uint8Array.from(bytes as number[])))

// The fullnode rejects devInspect with an unparseable sender (undefined/empty)
// → JSON-RPC -32602. Coerce ANY falsy sender (undefined, null, '') to the zero
// address, which is valid for a pure read. Single guard for every devInspect.
const ZERO_ADDRESS =
  '0x0000000000000000000000000000000000000000000000000000000000000000'
const safe_sender = (sender?: string | null): string =>
  sender && sender.length > 0 ? sender : ZERO_ADDRESS

export const read_trade_amounts = async (
  client: ReadClient,
  opts: {
    oracle_id: string
    expiry_ms: bigint
    strike_1e9: bigint
    is_up: boolean
    quantity: bigint
    sender?: string
  },
): Promise<TradeAmounts> => {
  const tx = new Transaction()
  const key = build_market_key(
    tx,
    opts.oracle_id,
    opts.expiry_ms,
    opts.strike_1e9,
    opts.is_up,
  )
  tx.moveCall({
    target: `${MOD_PREDICT}::get_trade_amounts`,
    arguments: [
      tx.object(PREDICT_OBJECT),
      tx.object(opts.oracle_id),
      key,
      tx.pure.u64(opts.quantity),
      tx.object(CLOCK_OBJECT),
    ],
  })

  // Bound each devInspect: the shared public testnet fullnode rate-limits / CORS-
  // stalls the high-frequency odds + cash-out polls, and a HUNG fetch would freeze
  // a poll forever (odds → "Pricing…", cash-out → stuck "+0"). Timeout every attempt
  // and retry ONCE on a transient (timeout/network) failure — but NEVER on a protocol
  // result (res.error / MoveAbort, e.g. an off-band strike), which is deterministic
  // so a retry is futile; surface it immediately so the caller can react.
  const TIMEOUT_MS = 8_000
  const inspect = async (): Promise<TradeAmounts> => {
    const res = await Promise.race([
      client.devInspectTransactionBlock({
        transactionBlock: tx,
        // devInspect needs a parseable sender; the zero address is fine for a pure
        // view. safe_sender() coerces undefined/null/'' so we never send a bad arg.
        sender: safe_sender(opts.sender),
      }),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error('get_trade_amounts: devInspect timed out')),
          TIMEOUT_MS,
        ),
      ),
    ])
    if (res.error) throw new Error(`get_trade_amounts devInspect: ${res.error}`)
    // The last command is the get_trade_amounts call; it returns two u64s.
    const results = res.results ?? []
    const last = results[results.length - 1]
    const ret = last?.returnValues
    if (!ret || ret.length < 2)
      throw new Error('get_trade_amounts returned no values')
    // returnValues entries are [ byteArray, typeString ].
    return { ask_cost: u64_from_bytes(ret[0][0]), bid_payout: u64_from_bytes(ret[1][0]) }
  }
  try {
    return await inspect()
  } catch (e) {
    // Deterministic protocol result → surface now, never retry. Transient
    // (timeout/network) → one retry covers a single fullnode blip.
    if (/devInspect: /.test((e as Error).message ?? '')) throw e
    return await inspect()
  }
}

// ============================================================================
// Read the MINTABLE ASK-PRICE BAND for an oracle via devInspect.
//   predict::ask_bounds(predict, oracle_id) -> (min_ask, max_ask)   [1e9-scaled]
// This is the resolved band (global ∩ per-oracle override). A bet whose executed
// per-contract ask falls outside [min_ask, max_ask] aborts with
// EAskPriceOutOfBounds (code 7). The bounds are PRICE_SCALE (1e9) per-contract.
// Used to gate the per-side bet button (too-lopsided sides go inert, not a fake
// 1.9x) and to fail-fast on the fresh re-quote. Cheap, read-only.
// ============================================================================
export type AskBounds = {
  min_ask_1e9: bigint // lower mintable per-contract ask (1e9)
  max_ask_1e9: bigint // upper mintable per-contract ask (1e9)
}

export const read_ask_bounds = async (
  client: ReadClient,
  oracle_id: string,
  sender?: string,
): Promise<AskBounds> => {
  const tx = new Transaction()
  tx.moveCall({
    target: `${MOD_PREDICT}::ask_bounds`,
    arguments: [tx.object(PREDICT_OBJECT), tx.pure.id(oracle_id)],
  })
  const res = await client.devInspectTransactionBlock({
    transactionBlock: tx,
    sender: safe_sender(sender),
  })
  if (res.error) throw new Error(`ask_bounds devInspect: ${res.error}`)
  const ret = res.results?.[res.results.length - 1]?.returnValues
  if (!ret || ret.length < 2)
    throw new Error('ask_bounds returned no values')
  return {
    min_ask_1e9: u64_from_bytes(ret[0][0]),
    max_ask_1e9: u64_from_bytes(ret[1][0]),
  }
}

// ============================================================================
// REALIZED HISTORY — query the on-chain PositionMinted / PositionRedeemed events.
// ----------------------------------------------------------------------------
// PositionRedeemed is the ONLY source of the EXACT realized amount + the
// settlement-vs-cashout discriminator the indexer feed lacks:
//   parsedJson: { manager_id, oracle_id, is_up, strike, expiry, quantity, payout,
//                 bid_price, is_settled, owner, executor }
//   is_settled:true  = settlement claim (won; payout == quantity)
//   is_settled:false = early cash-out (payout < quantity)
// PositionMinted carries the per-bucket cost:
//   parsedJson: { manager_id, oracle_id, is_up, strike, expiry, quantity, cost, ... }
// We page recent events (cap ~200) DESC and filter client-side to OUR manager_id.
// ============================================================================
export type RedeemedEvent = {
  manager_id: string
  oracle_id: string
  is_up: boolean
  strike: string // u64 as string (exact)
  expiry: string
  quantity: string
  payout: string
  is_settled: boolean
  // The settling tx digest + its wall-clock ms, carried straight off the event
  // envelope (id.txDigest / timestampMs) so a history row can deep-link to
  // SuiVision and sort/label by the real settle time. Optional: a pre-existing
  // consumer (gather_realized_results_from_events) simply ignores them, and a
  // sparse/old event without an envelope just renders with no link.
  digest?: string
  ts?: number
}
export type MintedEvent = {
  manager_id: string
  oracle_id: string
  is_up: boolean
  strike: string
  expiry: string
  quantity: string
  cost: string
}

// A predict event's parsedJson is loosely typed; pull the fields we need as
// strings (Sui returns u64s as strings) without trusting the shape blindly.
const ev_str = (o: Record<string, unknown>, k: string): string => {
  const v = o[k]
  if (typeof v === 'string') return v
  if (typeof v === 'number' && Number.isFinite(v)) return String(Math.trunc(v))
  return ''
}
const ev_bool = (o: Record<string, unknown>, k: string): boolean =>
  o[k] === true || o[k] === 'true'

// Page `move_event_type` events (DESC, newest first) up to `cap`, mapping each
// parsedJson via `map`. Read-only; on any RPC error returns whatever was gathered
// so far (best-effort history — a hiccup never blocks the UI).
// Hard ceiling on pages scanned. The MoveEventType filter is GLOBAL (every
// manager's events), and `map` filters to OURS client-side — so a SPARSE manager
// buried in a huge global feed would never hit `cap` matched rows and the loop
// would walk the entire predict history. Bound the walk to MAX_PAGES × limit
// events scanned (10 × 50 = 500) — plenty for a recent history, never unbounded.
const MAX_EVENT_PAGES = 10
const query_events = async <T>(
  client: ReadClient,
  move_event_type: string,
  // The mapper also receives the event ENVELOPE (its tx digest + wall-clock ms)
  // so a row can deep-link to SuiVision and label by real settle time. parsedJson
  // carries no digest — only the envelope does — hence the second arg.
  map: (
    j: Record<string, unknown>,
    env: { digest?: string; ts?: number },
  ) => T | null,
  cap = 200,
): Promise<T[]> => {
  const out: T[] = []
  let cursor: { txDigest: string; eventSeq: string } | null = null
  let pages = 0
  try {
    while (out.length < cap && pages < MAX_EVENT_PAGES) {
      pages++
      const page = await client.queryEvents({
        query: { MoveEventType: move_event_type },
        cursor,
        limit: 50,
        order: 'descending',
      })
      for (const e of page.data) {
        const j = e.parsedJson
        if (j && typeof j === 'object') {
          const ts = e.timestampMs ? Number(e.timestampMs) : undefined
          const row = map(j as Record<string, unknown>, {
            digest: e.id?.txDigest,
            ts: Number.isFinite(ts) ? ts : undefined,
          })
          if (row) out.push(row)
        }
      }
      if (!page.hasNextPage || !page.nextCursor) break
      cursor = page.nextCursor
    }
  } catch {
    // best-effort — return what we have
  }
  return out
}

// All PositionRedeemed events for OUR manager (newest first, capped).
export const fetch_redeemed_events = (
  client: ReadClient,
  manager_id: string,
): Promise<RedeemedEvent[]> =>
  query_events<RedeemedEvent>(
    client,
    EVENT_POSITION_REDEEMED,
    (j, env) => {
      if (ev_str(j, 'manager_id') !== manager_id) return null
      return {
        manager_id,
        oracle_id: ev_str(j, 'oracle_id'),
        is_up: ev_bool(j, 'is_up'),
        strike: ev_str(j, 'strike'),
        expiry: ev_str(j, 'expiry'),
        quantity: ev_str(j, 'quantity'),
        payout: ev_str(j, 'payout'),
        is_settled: ev_bool(j, 'is_settled'),
        digest: env.digest,
        ts: env.ts,
      }
    },
  )

// All PositionMinted events for OUR manager (newest first, capped).
export const fetch_minted_events = (
  client: ReadClient,
  manager_id: string,
): Promise<MintedEvent[]> =>
  query_events<MintedEvent>(
    client,
    EVENT_POSITION_MINTED,
    j => {
      if (ev_str(j, 'manager_id') !== manager_id) return null
      return {
        manager_id,
        oracle_id: ev_str(j, 'oracle_id'),
        is_up: ev_bool(j, 'is_up'),
        strike: ev_str(j, 'strike'),
        expiry: ev_str(j, 'expiry'),
        quantity: ev_str(j, 'quantity'),
        cost: ev_str(j, 'cost'),
      }
    },
  )

// ============================================================================
// GLOBAL LEADERBOARD FEED — every trader's realized history (no manager filter)
// ----------------------------------------------------------------------------
// The per-manager feeds above scope to ONE manager_id. The Leaderboard ranks
// EVERY trader, so it pages PositionRedeemed GLOBALLY (no client-side manager
// filter) and groups by the event's `owner` (the real Sui address that signed
// the bet — what a judge clicks through to). The ranked metric is WIN-RATE over
// SETTLED positions, which is computable from THIS ONE feed alone (a settled row
// with payout>0 is a win, payout==0 a loss; an early cash-out, is_settled=false,
// is neither). We DELIBERATELY do NOT compute net P&L here: that needs the mint
// `cost`, and the redeemed/minted feeds page DIFFERENT time slices, so a "payout
// minus cost" across two truncated windows over-credits payout — a fabricated
// number. Win-rate from one self-consistent feed is the honest metric.
//
// Because there is no per-row drop, a global walk is dense: testnet volume is
// thin, so `hasNextPage` ends the walk in a handful of pages. We bound it at
// GLOBAL_MAX_PAGES × 50 anyway so a future busy mainnet never walks unbounded.
// NEVER invents rows — fewer real rows beats many fake ones; a sparse chain
// renders a sparse board, honestly.
// ============================================================================

// One realized cash-out/settle row, carrying the OWNER address + the wall-clock
// timestamp so the aggregator can order by recency for the streak read.
export type GlobalRedeemedRow = {
  owner: string
  manager_id: string
  oracle_id: string
  is_up: boolean
  strike: string
  expiry: string
  quantity: string
  payout: string // dUSDC base units (1e6) actually received
  is_settled: boolean // true = settlement claim (won/lost), false = early cash-out
  ts: number // event timestampMs (0 when absent)
}

// Page a global MoveEventType feed DESC (newest first), mapping each (parsedJson,
// timestampMs) via `map`. Mirrors query_events but (a) NO manager filter — every
// row is kept — and (b) threads the event timestamp into the row so the caller
// can order by recency. Best-effort: returns whatever was gathered on any error.
const GLOBAL_MAX_PAGES = 24 // 24 × 50 = up to 1200 recent events scanned
const query_events_global = async <T>(
  client: ReadClient,
  move_event_type: string,
  map: (j: Record<string, unknown>, ts: number) => T | null,
  cap = 1000,
): Promise<T[]> => {
  const out: T[] = []
  let cursor: { txDigest: string; eventSeq: string } | null = null
  let pages = 0
  try {
    while (out.length < cap && pages < GLOBAL_MAX_PAGES) {
      pages++
      const page = await client.queryEvents({
        query: { MoveEventType: move_event_type },
        cursor,
        limit: 50,
        order: 'descending',
      })
      for (const e of page.data) {
        const j = e.parsedJson
        if (j && typeof j === 'object') {
          const ts = Number(e.timestampMs ?? 0) || 0
          const row = map(j as Record<string, unknown>, ts)
          if (row) out.push(row)
        }
      }
      if (!page.hasNextPage || !page.nextCursor) break
      cursor = page.nextCursor
    }
  } catch {
    // best-effort — return what we have
  }
  return out
}

// Every trader's PositionRedeemed rows (newest first). Drops only rows missing
// the load-bearing `owner` address — a row a judge couldn't click through to is
// useless on a leaderboard.
export const fetch_redeemed_events_global = (
  client: ReadClient,
): Promise<GlobalRedeemedRow[]> =>
  query_events_global<GlobalRedeemedRow>(
    client,
    EVENT_POSITION_REDEEMED,
    (j, ts) => {
      const owner = ev_str(j, 'owner')
      if (!owner) return null
      return {
        owner,
        manager_id: ev_str(j, 'manager_id'),
        oracle_id: ev_str(j, 'oracle_id'),
        is_up: ev_bool(j, 'is_up'),
        strike: ev_str(j, 'strike'),
        expiry: ev_str(j, 'expiry'),
        quantity: ev_str(j, 'quantity'),
        payout: ev_str(j, 'payout'),
        is_settled: ev_bool(j, 'is_settled'),
        ts,
      }
    },
  )

// Per-contract implied probability for an UP/DOWN side, derived from the
// quantity used in the preview. cost_1e6 / quantity_1e6 == per-unit price in $,
// and a binary contract's per-unit price IS its implied probability.
export const implied_pct_from_cost = (
  cost_1e6: bigint,
  quantity_1e6: bigint,
): number => {
  if (quantity_1e6 === 0n) return 0
  // per-unit price (in dollars) = cost / quantity  (both 1e6 => unitless dollars)
  const pct = (Number(cost_1e6) / Number(quantity_1e6)) * 100
  return Math.max(0, Math.min(100, pct))
}

// ============================================================================
// Manager lifecycle
// ============================================================================
// router::create_manager shares the PredictManager INTERNALLY (no usable handle
// to chain). So this MUST be its own tx; we read the new shared object id from
// objectChanges afterwards. Routing manager creation through OUR package keeps
// the user inside the five allowlisted targets (sponsorship never touches
// predict::* directly).
export const build_create_manager_tx = (): Transaction => {
  const tx = new Transaction()
  tx.moveCall({
    target: `${MOD_ROUTER}::create_manager`,
    arguments: [tx.object(VERSION_ID)],
  })
  return tx
}

// Extract the freshly created PredictManager shared object id from a tx result.
export const find_created_manager_id = (
  objectChanges:
    | Array<{ type: string; objectType?: string; objectId?: string }>
    | null
    | undefined,
): string | null => {
  if (!objectChanges) return null
  for (const c of objectChanges) {
    if (
      c.type === 'created' &&
      c.objectType === PREDICT_MANAGER_TYPE &&
      c.objectId
    )
      return c.objectId
  }
  return null
}

// ============================================================================
// Place a bet through the on-chain router (the ONLY mint path).
//   router::bet<Quote>(version, config, predict, manager, oracle, oracle_id,
//                      expiry, strike, is_up, quantity, payment, clock, ctx)
// The router DEPOSITS `payment` into the manager, builds the MarketKey itself
// (from oracle_id/expiry/strike/is_up — the client does NOT build a key here),
// skims the 3% rake to the on-chain treasury, then mints. So the client only has
// to hand it a Coin<DUSDC> covering (cost + rake) MINUS the manager's current
// balance — that shortfall is `payment_amount`, computed by the caller.
//
// We always split a fresh coin for `payment` (even when payment_amount === 0:
// the router's deposit of a 0-value coin is harmless), so the user's source
// coins are never consumed wholesale — only the exact shortfall moves.
//
// FULLY-MANAGER-FUNDED RE-BET: after a cash-out the manager holds the funds and
// the wallet may have ZERO dUSDC coin objects (`dusdc_coin_ids` empty). The mint
// is then fully funded from the manager, so `payment_amount` is 0n and there is no
// wallet coin to split from. In that case we mint a zero Coin<DUSDC> on-chain via
// `0x2::coin::zero` as the (harmless) 0-value payment — the caller MUST only pass
// an empty coin list when payment_amount is 0n (the funding check guarantees the
// manager covers the bet). `coin::zero` is on the sponsor allowlist (CRASH).
// ============================================================================
export const build_bet_tx = (opts: {
  manager_id: string
  oracle_id: string
  expiry_ms: bigint
  strike_1e9: bigint
  is_up: boolean
  quantity: bigint
  // Exact dUSDC base units (1e6) to fund the bet with (the manager shortfall).
  // May be 0n when the manager already holds enough — we still pass a 0-coin.
  payment_amount: bigint
  // The user's Coin<DUSDC> object ids to source `payment` from (merged here). MAY
  // be empty ONLY when payment_amount is 0n (manager fully funds) — then we use a
  // freshly-minted zero coin instead of splitting a wallet coin.
  dusdc_coin_ids: string[]
}): Transaction => {
  const tx = new Transaction()

  // Build the payment coin. With wallet coins: merge them into one and split off
  // EXACTLY the shortfall (SplitCoins/MergeCoins are native commands, no Enoki
  // allowlisting). With NO wallet coins (manager fully funds, payment_amount 0n):
  // mint a zero Coin<DUSDC> via 0x2::coin::zero (allowlisted) so we never call
  // tx.object(undefined).
  let payment
  if (opts.dusdc_coin_ids.length > 0) {
    const [primary, ...rest] = opts.dusdc_coin_ids
    const primary_coin = tx.object(primary)
    if (rest.length > 0)
      tx.mergeCoins(
        primary_coin,
        rest.map(id => tx.object(id)),
      )
    ;[payment] = tx.splitCoins(primary_coin, [tx.pure.u64(opts.payment_amount)])
  } else {
    payment = tx.moveCall({
      // NORMALIZED `0x2` form (COIN_ZERO from @suize/shared) so Enoki's normalized
      // allow-list comparison matches — a short `0x2::coin::zero` silently 400s.
      target: COIN_ZERO,
      typeArguments: [DUSDC_TYPE],
    })
  }

  tx.moveCall({
    target: `${MOD_ROUTER}::bet`,
    typeArguments: [DUSDC_TYPE],
    arguments: [
      tx.object(VERSION_ID),
      tx.object(ROUTER_CONFIG),
      tx.object(PREDICT_OBJECT),
      tx.object(opts.manager_id),
      tx.object(opts.oracle_id),
      tx.pure.id(opts.oracle_id),
      tx.pure.u64(opts.expiry_ms),
      tx.pure.u64(opts.strike_1e9),
      tx.pure.bool(opts.is_up),
      tx.pure.u64(opts.quantity),
      payment,
      tx.object(CLOCK_OBJECT),
    ],
  })
  return tx
}

// Shared arg shape for the router redeem paths (cash_out + claim). The router
// builds the MarketKey internally, so the client passes the raw key fields.
type RedeemOpts = {
  manager_id: string
  oracle_id: string
  expiry_ms: bigint
  strike_1e9: bigint
  is_up: boolean
  quantity: bigint
}

// router::<fn><Quote>(version, predict, manager, oracle, oracle_id, expiry,
//                     strike, is_up, quantity, clock, ctx) — 10 args, no Config,
//                     no key (version gate is the new FIRST arg).
const build_router_redeem_tx = (
  fn: 'cash_out' | 'claim',
  opts: RedeemOpts,
): Transaction => {
  const tx = new Transaction()
  tx.moveCall({
    target: `${MOD_ROUTER}::${fn}`,
    typeArguments: [DUSDC_TYPE],
    arguments: [
      tx.object(VERSION_ID),
      tx.object(PREDICT_OBJECT),
      tx.object(opts.manager_id),
      tx.object(opts.oracle_id),
      tx.pure.id(opts.oracle_id),
      tx.pure.u64(opts.expiry_ms),
      tx.pure.u64(opts.strike_1e9),
      tx.pure.bool(opts.is_up),
      tx.pure.u64(opts.quantity),
      tx.object(CLOCK_OBJECT),
    ],
  })
  // ATOMIC AUTO-SWEEP: the redeem above credits the payout into the manager's
  // internal balance; this second leg sweeps the FULL manager balance back to the
  // sender on-chain (no amount arg, version-gated), so a settle/cash-out lands in
  // the wallet in ONE tx and never piles up invisibly in the manager (which a
  // block explorer can't surface). router::withdraw_all<Quote>(version, manager).
  tx.moveCall({
    target: `${MOD_ROUTER}::withdraw_all`,
    typeArguments: [DUSDC_TYPE],
    arguments: [tx.object(VERSION_ID), tx.object(opts.manager_id)],
  })
  return tx
}

// Cash out early ONE bucket (router::cash_out -> predict::redeem). Payout -> manager
// balance. Per-side cash-out (two distinct positions) uses one of these per side.
export const build_cash_out_tx = (opts: RedeemOpts): Transaction =>
  build_router_redeem_tx('cash_out', opts)

// Claim a settled position (router::claim -> predict::redeem_permissionless).
// Payout -> manager balance. Permissionless on-chain, but routed through our
// package so it stays inside the allowlisted sponsored targets.
export const build_claim_tx = (opts: RedeemOpts): Transaction =>
  build_router_redeem_tx('claim', opts)

// Claim MANY settled positions in ONE PTB. Adds one `router::claim` moveCall per
// position with the EXACT same target/typeArgs/args as the single build_claim_tx
// above (the allowlisted path) — composing them into a single atomic tx so the
// on-load auto-claim sweeps every claimable position with one signature. Each
// claim is independent (no shared coins/results), so ordering/atomicity is safe:
// if one position were already redeemed the whole tx aborts, which is fine —
// auto-claim filters to currently-claimable positions before building. Throws on
// an empty list (the caller must guard "nothing to claim" before calling).
export const build_claim_all_tx = (positions: RedeemOpts[]): Transaction => {
  if (positions.length === 0)
    throw new Error('build_claim_all_tx: no positions to claim')
  const tx = new Transaction()
  for (const opts of positions) {
    tx.moveCall({
      target: `${MOD_ROUTER}::claim`,
      typeArguments: [DUSDC_TYPE],
      arguments: [
        tx.object(VERSION_ID),
        tx.object(PREDICT_OBJECT),
        tx.object(opts.manager_id),
        tx.object(opts.oracle_id),
        tx.pure.id(opts.oracle_id),
        tx.pure.u64(opts.expiry_ms),
        tx.pure.u64(opts.strike_1e9),
        tx.pure.bool(opts.is_up),
        tx.pure.u64(opts.quantity),
        tx.object(CLOCK_OBJECT),
      ],
    })
  }
  // ONE trailing sweep: every claim above credited the SAME manager (a user has a
  // single manager), so one withdraw_all collects them all to the wallet — settle
  // -> wallet, atomically. positions[0] is safe (empty list throws above).
  tx.moveCall({
    target: `${MOD_ROUTER}::withdraw_all`,
    typeArguments: [DUSDC_TYPE],
    arguments: [tx.object(VERSION_ID), tx.object(positions[0].manager_id)],
  })
  return tx
}

// ============================================================================
// Coin helpers
// ============================================================================
export const fetch_dusdc_coins = async (
  client: ReadClient,
  owner: string,
): Promise<{ total: bigint; coin_ids: string[] }> => {
  const coins = await client.getCoins({ owner, coinType: DUSDC_TYPE })
  let total = 0n
  const coin_ids: string[] = []
  for (const c of coins.data) {
    total += BigInt(c.balance)
    coin_ids.push(c.coinObjectId)
  }
  return { total, coin_ids }
}

// Read the manager's internal dUSDC balance.
//
// PRIMARY: devInspect predict_manager::balance<T>(self): u64 — one call.
// FALLBACK: if devInspect errors / yields no return value, read the balance
// STRAIGHT off the manager's BalanceManager bag (getObject + getDynamicFields —
// plain reads, same family as getCoins). devInspect has been observed to silently
// fail in some browser/RPC setups, which would HIDE a stranded internal balance
// (it both under-reports the displayed total AND blocks the withdraw button). The
// fallback guarantees a funded manager is never invisible. Only triggers when the
// devInspect path doesn't produce a value, so a healthy empty manager stays 1 call.
export const read_manager_balance = async (
  client: ReadClient,
  manager_id: string,
  sender: string,
): Promise<bigint> => {
  try {
    const tx = new Transaction()
    tx.moveCall({
      target: `${MOD_MANAGER}::balance`,
      typeArguments: [DUSDC_TYPE],
      arguments: [tx.object(manager_id)],
    })
    const res = await client.devInspectTransactionBlock({
      transactionBlock: tx,
      sender: safe_sender(sender),
    })
    if (!res.error) {
      const ret = res.results?.[0]?.returnValues
      if (ret && ret.length >= 1) return u64_from_bytes(ret[0][0])
    }
    // devInspect returned an error or no value — fall through to the direct read.
  } catch {
    // devInspect threw (the browser/RPC failure case) — fall through.
  }
  return read_manager_balance_via_fields(client, manager_id)
}

// The devInspect-free read: the manager holds its internal balance in a DeepBook
// BalanceManager bag (BalanceKey<T> -> Balance<T>). We walk
// manager.balance_manager.balances (a Bag) and read the DUSDC field's `value`.
// Pure object reads — robust where the shared-object devInspect is not.
const read_manager_balance_via_fields = async (
  client: ReadClient,
  manager_id: string,
): Promise<bigint> => {
  try {
    const mgr = await client.getObject({
      id: manager_id,
      options: { showContent: true },
    })
    const fields = (mgr?.data?.content as { fields?: Record<string, any> } | null)
      ?.fields
    const bag_id = fields?.balance_manager?.fields?.balances?.fields?.id?.id as
      | string
      | undefined
    if (!bag_id) return 0n
    const dyn = await client.getDynamicFields({ parentId: bag_id })
    const field = dyn.data.find(
      d => typeof d?.name?.type === 'string' && d.name.type.includes('dusdc::DUSDC'),
    )
    if (!field?.objectId) return 0n
    const val = await client.getObject({
      id: field.objectId,
      options: { showContent: true },
    })
    const raw = (val?.data?.content as { fields?: Record<string, any> } | null)
      ?.fields?.value
    return raw != null ? BigInt(raw as string | number) : 0n
  } catch {
    return 0n
  }
}

// ============================================================================
// Withdraw from the manager back to the user's wallet (round-trip cash-out).
//   router::withdraw<Quote>(version, manager, amount, ctx)
// The router calls predict_manager::withdraw (which asserts sender == owner) and
// transfers the resulting Coin<DUSDC> to ctx.sender() ON-CHAIN — so the client
// passes no recipient and adds no transferObjects (one allowlisted target).
// ============================================================================
export const build_withdraw_tx = (opts: {
  manager_id: string
  amount: bigint // dUSDC base units (1e6)
}): Transaction => {
  const tx = new Transaction()
  tx.moveCall({
    target: `${MOD_ROUTER}::withdraw`,
    typeArguments: [DUSDC_TYPE],
    arguments: [
      tx.object(VERSION_ID),
      tx.object(opts.manager_id),
      tx.pure.u64(opts.amount),
    ],
  })
  return tx
}

// Sweep the ENTIRE manager internal balance to the wallet in ONE tx — no amount,
// no balance-read needed (router::withdraw_all reads the on-chain balance itself
// and transfers the full Coin<DUSDC> to ctx.sender()). This is the bulletproof
// RECOVERY path for funds stranded in the manager (a redeem that credited the
// manager without the auto-sweep, or a balance read that hid them): it works even
// when the client can't read the balance. version-gated like every router entry.
export const build_withdraw_all_tx = (manager_id: string): Transaction => {
  const tx = new Transaction()
  tx.moveCall({
    target: `${MOD_ROUTER}::withdraw_all`,
    typeArguments: [DUSDC_TYPE],
    arguments: [tx.object(VERSION_ID), tx.object(manager_id)],
  })
  return tx
}

// ============================================================================
// BE THE HOUSE — liquidity provision (LP) through the router.
// ============================================================================
// router::supply<Quote>(version, predict, payment: Coin<Quote>, clock, ctx) —
// deposits `payment` dUSDC into Predict's shared LP vault and `public_transfer`s the
// minted Coin<PLP> shares back to ctx.sender() ON-CHAIN. So the client passes
// only the payment coin (split to the exact amount); it adds no recipient and no
// transferObjects. We split EXACTLY `amount` from the user's merged dUSDC so the
// rest of their wallet is untouched (mirrors build_bet_tx's payment handling).
// SplitCoins/MergeCoins are native PTB commands (not Move targets) so they need
// no Enoki allowlisting — only router::supply does.
export const build_supply_tx = (opts: {
  amount: bigint // dUSDC base units (1e6) to supply into the vault
  dusdc_coin_ids: string[] // the user's Coin<DUSDC> object ids to source from
}): Transaction => {
  const tx = new Transaction()
  const [primary, ...rest] = opts.dusdc_coin_ids
  const primary_coin = tx.object(primary)
  if (rest.length > 0)
    tx.mergeCoins(
      primary_coin,
      rest.map(id => tx.object(id)),
    )
  const [payment] = tx.splitCoins(primary_coin, [tx.pure.u64(opts.amount)])
  tx.moveCall({
    target: `${MOD_ROUTER}::supply`,
    typeArguments: [DUSDC_TYPE],
    arguments: [
      tx.object(VERSION_ID),
      tx.object(PREDICT_OBJECT),
      payment,
      tx.object(CLOCK_OBJECT),
    ],
  })
  return tx
}

// router::redeem_lp<Quote>(version, predict, lp_coin: Coin<PLP>, clock, ctx) —
// burns the supplied PLP shares and `public_transfer`s the underlying dUSDC back to
// ctx.sender() ON-CHAIN (no recipient / transferObjects client-side). We merge
// the user's PLP coins into one, then split EXACTLY `shares` to burn — so a
// partial "cash out of the house" leaves the remaining shares intact. Passing
// shares == the full PLP balance redeems the entire house position.
export const build_redeem_lp_tx = (opts: {
  shares: bigint // PLP base units (1e6) to burn
  plp_coin_ids: string[] // the user's Coin<PLP> object ids to source from
}): Transaction => {
  const tx = new Transaction()
  const [primary, ...rest] = opts.plp_coin_ids
  const primary_coin = tx.object(primary)
  if (rest.length > 0)
    tx.mergeCoins(
      primary_coin,
      rest.map(id => tx.object(id)),
    )
  const [lp_coin] = tx.splitCoins(primary_coin, [tx.pure.u64(opts.shares)])
  tx.moveCall({
    target: `${MOD_ROUTER}::redeem_lp`,
    typeArguments: [DUSDC_TYPE],
    arguments: [
      tx.object(VERSION_ID),
      tx.object(PREDICT_OBJECT),
      lp_coin,
      tx.object(CLOCK_OBJECT),
    ],
  })
  return tx
}

// Read the caller's HOUSE position: total Coin<PLP> shares held + the source
// coin ids (for redeem_lp). Mirrors fetch_dusdc_coins but on the PLP coin type.
export const fetch_plp_coins = async (
  client: ReadClient,
  owner: string,
): Promise<{ shares: bigint; coin_ids: string[] }> => {
  const coins = await client.getCoins({ owner, coinType: PLP_TYPE })
  let shares = 0n
  const coin_ids: string[] = []
  for (const c of coins.data) {
    shares += BigInt(c.balance)
    coin_ids.push(c.coinObjectId)
  }
  return { shares, coin_ids }
}
