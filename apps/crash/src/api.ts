import { API_BASE, PREDICT_OBJECT } from './config'

// ---- Shapes returned by the read API (only the fields we use) ----

// A PredictManagerCreated record from the indexer. We use it to RESOLVE the
// caller's manager id (never localStorage). The endpoint already filters by
// owner, but we re-assert owner === addr client-side as defense in depth.
export type ManagerRecord = {
  manager_id?: string
  owner?: string
  [k: string]: unknown
}

export type OracleStatus =
  | 'active'
  | 'settled'
  | 'pending_settlement'
  | 'created'

export type Oracle = {
  oracle_id: string
  predict_id: string
  underlying_asset: string
  expiry: number // ms
  min_strike: number // 1e9-scaled
  tick_size: number // 1e9-scaled strike interval (a.k.a strike_interval)
  strike_interval?: number // some responses use this name
  status: OracleStatus
  created_at?: number
  activated_at?: number
  settled_at?: number | null
  settlement_price?: number | null // 1e9-scaled
}

export type LatestPrices = {
  oracle_id: string
  spot: number | null // 1e9-scaled
  forward: number | null // 1e9-scaled
  strike_interval?: number
}

export type MintedPosition = {
  trader?: string
  oracle_id?: string
  manager_id?: string // the bettor's PredictManager (present on the mint event)
  strike?: number
  is_up?: boolean
  quantity?: number
  cost?: number
  ask_price?: number
  expiry?: number
  // The API is loosely typed; keep it open.
  [k: string]: unknown
}

// A RedeemPosition record from the indexer's append-only redeemed feed. It marks
// that a minted position has already been cashed-out/claimed. We match it to a
// minted record on the SAME identity tuple (oracle_id + manager_id + is_up +
// strike + expiry) to exclude already-settled positions from the open-bet view.
// Both feeds carry `manager_id`, so a redeemed row matches its minted row 1:1
// (we scope BOTH queries by manager_id — see fetch_minted / fetch_redeemed).
export type RedeemedPosition = {
  owner?: string
  oracle_id?: string
  manager_id?: string
  strike?: number
  is_up?: boolean
  expiry?: number
  // Loosely typed like the minted feed.
  [k: string]: unknown
}

// The vault ("house") summary from the read API. Verified live shape against
// GET /predicts/<id>/vault/summary (HTTP 200). All *_balance / *_value /
// plp_total_supply / *_deposits / *_supplied / *_withdrawn fields are dUSDC base
// units (1e6). plp_share_price and utilization are plain floats (price ~1.0,
// utilization in [0,1]). Only the fields the HOUSE screen renders are typed;
// the rest of the (loosely-typed) envelope is ignored.
export type VaultSummary = {
  predict_id: string
  vault_value: number // total dUSDC backing all LP shares (the "house" TVL), 1e6
  plp_share_price: number // dUSDC value per 1.0 PLP share (float, ~1.0)
  plp_total_supply: number // total PLP shares outstanding (1e6 base units)
  utilization: number // [0,1] fraction of the vault currently at risk
  available_withdrawal: number // dUSDC LPs can pull right now (1e6)
  [k: string]: unknown
}

const get_json = async <T>(path: string): Promise<T> => {
  const res = await fetch(`${API_BASE}${path}`)
  if (!res.ok) throw new Error(`API ${path} -> ${res.status}`)
  return (await res.json()) as T
}

export const fetch_oracles = (): Promise<Oracle[]> =>
  get_json<Oracle[]>(`/predicts/${PREDICT_OBJECT}/oracles`)

// Real HOUSE data for the LP screen: vault TVL, share price, utilization, etc.
export const fetch_vault_summary = (): Promise<VaultSummary> =>
  get_json<VaultSummary>(`/predicts/${PREDICT_OBJECT}/vault/summary`)

export const fetch_latest_prices = (oracle_id: string): Promise<LatestPrices> =>
  get_json<LatestPrices>(`/oracles/${oracle_id}/prices/latest`)

// Minted positions scoped to a PredictManager. VERIFIED LIVE: the per-WALLET
// query (`/positions/minted?trader=<wallet>`) is stale/incomplete — for the live
// wallet it returned only an OLD, already-redeemed position and MISSED the open
// one, while the manager-scoped query returned BOTH (the open + the redeemed).
// Predict positions live under the PredictManager, so scope reconstruction by
// the manager id (resolved via fetch_manager) — NOT the wallet — to recover the
// real open bet on reload. Records still carry `trader` == wallet for display.
export const fetch_minted = (manager_id: string): Promise<MintedPosition[]> =>
  get_json<MintedPosition[]>(`/positions/minted?manager_id=${manager_id}`)

// Append-only feed of positions that have been redeemed (cash-out OR settled
// claim). Used to EXCLUDE already-claimed positions from the reconstructed open
// bet (the minted feed carries NO redeemed flag, so this cross-reference is the
// only way to know). We scope by `manager_id`, NOT `owner`: VERIFIED LIVE, the
// `?owner=<wallet>` form IGNORES the filter and returns a 100-row GLOBAL feed
// (only 1 row was the caller's; 99 belonged to other wallets) — which would both
// miss the caller's own redeems past row 100 AND risk a false-positive match
// against a stranger's identical (oracle,expiry,strike,is_up) tuple. The
// `?manager_id=<mgr>` form is correctly scoped (returned ONLY this manager's
// redeems). The envelope has been seen BOTH as a bare array AND wrapped in
// `{ redeemed: [...] }`, so we accept either and default to [] (nothing redeemed
// yet is the normal case, fully supported).
export const fetch_redeemed = async (
  manager_id: string,
): Promise<RedeemedPosition[]> => {
  const body = await get_json<
    RedeemedPosition[] | { redeemed?: RedeemedPosition[] }
  >(`/positions/redeemed?manager_id=${manager_id}`)
  if (Array.isArray(body)) return body
  return body.redeemed ?? []
}

// Resolve the caller's PredictManager id from the indexer (NEVER localStorage).
// GET /managers?owner=<addr> returns the PredictManagerCreated events for that
// owner; we take the most recent one whose owner === addr.
//
// SECURITY: we trust the indexer ONLY for RESOLUTION (which manager id to pass).
// Every write (router::bet/cash_out/claim/withdraw) asserts sender === the
// manager's owner ON-CHAIN, so a wrong or malicious indexer result can only
// cause a FAILED tx — never a loss of funds. The owner re-check below is belt-
// and-suspenders in case the endpoint ever ignores the filter.
export const fetch_manager = async (owner: string): Promise<string | null> => {
  if (!owner) return null
  const rows = await get_json<ManagerRecord[]>(`/managers?owner=${owner}`)
  const mine = rows.filter(r => r.owner === owner && r.manager_id)
  // Newest last in the feed; take the last matching id as the live manager.
  const latest = mine[mine.length - 1]
  return latest?.manager_id ?? null
}

// ---- REAL BTC price history (chart backdrop) -----------------------------
// One real, timestamped past price point: wall-clock ms + close price (plain
// USD). The chart plots these as genuine mountainous history on load.
export type BtcHistoryPoint = { t: number; p: number }

// Fetch REAL recent BTC/USDT minute history from Binance's public, no-key
// klines endpoint so the chart shows authentic past price action immediately
// (no invented/seeded data). Each kline is an array: index 0 = openTime (ms),
// index 4 = close (string). We map those to { t, p } and return oldest->newest.
//
// GRACEFUL FALLBACK: Binance can fail in the browser (CORS, network, rate
// limit). On ANY error we return an EMPTY array — the caller then starts sparse
// and accumulates live oracle ticks. We NEVER fabricate/seed fake history.
export const fetch_btc_history = async (
  limit = 180,
): Promise<BtcHistoryPoint[]> => {
  try {
    const url = `https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1m&limit=${limit}`
    const res = await fetch(url)
    if (!res.ok) return []
    const rows = (await res.json()) as unknown[]
    if (!Array.isArray(rows)) return []
    const out: BtcHistoryPoint[] = []
    for (const row of rows) {
      if (!Array.isArray(row)) continue
      const t = Number(row[0])
      const p = Number(row[4])
      if (Number.isFinite(t) && Number.isFinite(p) && p > 0)
        out.push({ t, p })
    }
    return out
  } catch {
    return []
  }
}

// Normalize the strike-interval field name across responses.
export const strike_interval_of = (o: Oracle): number =>
  o.tick_size ?? o.strike_interval ?? 0

// Pick the BTC active oracle with the SOONEST FUTURE expiry — i.e. the current
// round to bet on. We DELIBERATELY do NOT skip a round in its final 15s: it's
// shown through its whole life (the last 15s are just LOCKED, not skipped). The
// caller advances to the next round only once the current one has expired / left
// 'active'.
export const pick_live_btc_oracle = (
  oracles: Oracle[],
  now = Date.now(),
): Oracle | null => {
  const candidates = oracles
    .filter(
      o =>
        o.underlying_asset === 'BTC' &&
        o.status === 'active' &&
        o.expiry > now,
    )
    .sort((a, b) => a.expiry - b.expiry)
  return candidates[0] ?? null
}

// Find a specific oracle by id (used to re-poll status for settlement).
export const find_oracle = (
  oracles: Oracle[],
  oracle_id: string,
): Oracle | undefined => oracles.find(o => o.oracle_id === oracle_id)
