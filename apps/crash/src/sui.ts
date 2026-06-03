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
}
import {
  CLOCK_OBJECT,
  DUSDC_TYPE,
  MOD_MANAGER,
  MOD_MARKET_KEY,
  MOD_PREDICT,
  MOD_ROUTER,
  PLP_TYPE,
  PREDICT_MANAGER_TYPE,
  PREDICT_OBJECT,
  ROUTER_CONFIG,
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

  const res = await client.devInspectTransactionBlock({
    transactionBlock: tx,
    // devInspect needs a parseable sender; the zero address is fine for a pure
    // view. safe_sender() coerces undefined/null/'' so we never send a bad arg.
    sender: safe_sender(opts.sender),
  })

  if (res.error) throw new Error(`get_trade_amounts devInspect: ${res.error}`)

  // The last command is the get_trade_amounts call; it returns two u64s.
  const results = res.results ?? []
  const last = results[results.length - 1]
  const ret = last?.returnValues
  if (!ret || ret.length < 2)
    throw new Error('get_trade_amounts returned no values')

  // returnValues entries are [ byteArray, typeString ].
  const ask_cost = u64_from_bytes(ret[0][0])
  const bid_payout = u64_from_bytes(ret[1][0])
  return { ask_cost, bid_payout }
}

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
  tx.moveCall({ target: `${MOD_ROUTER}::create_manager`, arguments: [] })
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
//   router::bet<Quote>(config, predict, manager, oracle, oracle_id, expiry,
//                      strike, is_up, quantity, payment, clock, ctx)
// The router DEPOSITS `payment` into the manager, builds the MarketKey itself
// (from oracle_id/expiry/strike/is_up — the client does NOT build a key here),
// skims the 3% rake to the on-chain treasury, then mints. So the client only has
// to hand it a Coin<DUSDC> covering (cost + rake) MINUS the manager's current
// balance — that shortfall is `payment_amount`, computed by the caller.
//
// We always split a fresh coin for `payment` (even when payment_amount === 0:
// the router's deposit of a 0-value coin is harmless), so the user's source
// coins are never consumed wholesale — only the exact shortfall moves.
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
  // The user's Coin<DUSDC> object ids to source `payment` from (merged here).
  dusdc_coin_ids: string[]
}): Transaction => {
  const tx = new Transaction()

  // Merge the user's dUSDC coins into one, then split off EXACTLY the shortfall
  // as the payment coin. SplitCoins/MergeCoins are native commands (not Move
  // targets), so they do not need Enoki allowlisting.
  const [primary, ...rest] = opts.dusdc_coin_ids
  const primary_coin = tx.object(primary)
  if (rest.length > 0)
    tx.mergeCoins(
      primary_coin,
      rest.map(id => tx.object(id)),
    )
  const [payment] = tx.splitCoins(primary_coin, [
    tx.pure.u64(opts.payment_amount),
  ])

  tx.moveCall({
    target: `${MOD_ROUTER}::bet`,
    typeArguments: [DUSDC_TYPE],
    arguments: [
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

// router::<fn><Quote>(predict, manager, oracle, oracle_id, expiry, strike,
//                     is_up, quantity, clock, ctx) — 9 args, no Config, no key.
const build_router_redeem_tx = (
  fn: 'cash_out' | 'claim',
  opts: RedeemOpts,
): Transaction => {
  const tx = new Transaction()
  tx.moveCall({
    target: `${MOD_ROUTER}::${fn}`,
    typeArguments: [DUSDC_TYPE],
    arguments: [
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
  return tx
}

// Cash out early (router::cash_out -> predict::redeem). Payout -> manager balance.
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

// Read the manager's internal dUSDC balance via devInspect:
//   predict_manager::balance<T>(self): u64
export const read_manager_balance = async (
  client: ReadClient,
  manager_id: string,
  sender: string,
): Promise<bigint> => {
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
  if (res.error) throw new Error(`manager balance: ${res.error}`)
  const ret = res.results?.[0]?.returnValues
  if (!ret || ret.length < 1) return 0n
  return u64_from_bytes(ret[0][0])
}

// ============================================================================
// Withdraw from the manager back to the user's wallet (round-trip cash-out).
//   router::withdraw<Quote>(manager, amount, ctx)
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
    arguments: [tx.object(opts.manager_id), tx.pure.u64(opts.amount)],
  })
  return tx
}

// ============================================================================
// BE THE HOUSE — liquidity provision (LP) through the router.
// ============================================================================
// router::supply<Quote>(predict, payment: Coin<Quote>, clock, ctx) — deposits
// `payment` dUSDC into Predict's shared LP vault and `public_transfer`s the
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
    arguments: [tx.object(PREDICT_OBJECT), payment, tx.object(CLOCK_OBJECT)],
  })
  return tx
}

// router::redeem_lp<Quote>(predict, lp_coin: Coin<PLP>, clock, ctx) — burns the
// supplied PLP shares and `public_transfer`s the underlying dUSDC back to
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
    arguments: [tx.object(PREDICT_OBJECT), lp_coin, tx.object(CLOCK_OBJECT)],
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
