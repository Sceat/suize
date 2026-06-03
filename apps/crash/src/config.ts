// ============================================================================
// VERIFIED TESTNET CONSTANTS (DeepBook Predict, predict-testnet-4-16)
// Confirmed live against fullnode + read API. See INTEGRATION.md for the
// verbatim Move signatures these calls target.
// ============================================================================

export const RPC_URL = 'https://fullnode.testnet.sui.io:443'

export const PREDICT_PACKAGE =
  '0xf5ea2b3749c65d6e56507cc35388719aadb28f9cab873696a2f8687f5c785138'

// Main shared Predict object (the vault / protocol entrypoint).
export const PREDICT_OBJECT =
  '0xc8736204d12f0a7277c86388a68bf8a194b0a14c5538ad13f22cbd8e2a38028a'

// Sui system Clock.
export const CLOCK_OBJECT = '0x6'

// The <Quote> type argument for every generic fn (mint/redeem/deposit/...).
export const DUSDC_TYPE =
  '0xe95040085976bfd54a1a07225cd46c8a2b4e8e2b6732f140a0fc49850ba73e1a::dusdc::DUSDC'

// The vault LP-share coin minted on supply() and burned on redeem_lp(). Same
// 6-decimal scale as dUSDC (verified: plp::PLP is created with 6 decimals). A
// HOUSE position is held as a wallet Coin<PLP>; its dUSDC value = shares ×
// plp_share_price (from the vault summary). Read via getCoins(coinType=PLP).
export const PLP_TYPE =
  '0xf5ea2b3749c65d6e56507cc35388719aadb28f9cab873696a2f8687f5c785138::plp::PLP'

// PLP shares are 6-decimal (same as dUSDC base units). 1_000_000 == 1 share.
export const PLP_SCALE = 1_000_000n

// Read API base (GET, CORS open, browser-callable).
export const API_BASE = 'https://predict-server.testnet.mystenlabs.com'

// Module names within the package.
export const MOD_PREDICT = `${PREDICT_PACKAGE}::predict`
export const MOD_MANAGER = `${PREDICT_PACKAGE}::predict_manager`
export const MOD_MARKET_KEY = `${PREDICT_PACKAGE}::market_key`

// On-chain object types we match against in objectChanges.
export const PREDICT_MANAGER_TYPE = `${PREDICT_PACKAGE}::predict_manager::PredictManager`

// ----------------------------------------------------------------------------
// SCALING
// ----------------------------------------------------------------------------
// Two distinct fixed-point worlds, do NOT mix them up:
//
//  * PRICE_SCALE (1e9): every price / strike / spot from the protocol & API is
//    1e9-scaled. A per-contract price of 1_000_000_000 means "$1.00 payout".
//    A winning binary contract is worth exactly PRICE_SCALE.
//
//  * DUSDC_SCALE (1e6): dUSDC coin has 6 decimals (verified via getCoinMetadata).
//    Coin<DUSDC> base units: 1_000_000 == $1.00.
//
// get_trade_amounts returns (math::mul(ask, quantity), math::mul(bid, quantity))
// where math::mul(a,b) = a*b / 1e9. The returned cost/payout is consumed by
// manager.withdraw<Quote>(cost) / dispense_payout, i.e. they are RAW dUSDC base
// units (1e6). Therefore to make `mul(price_1e9, quantity)` land in 1e6 units:
//
//     cost_1e6 = price_1e9 * quantity / 1e9
//   =>  quantity = cost_1e6 * 1e9 / price_1e9
//
// So `quantity` is itself a 1e6-scaled count of contracts: quantity == 1_000_000
// means "1 whole contract" (which pays out PRICE_SCALE→1e6 == $1.00 if it wins).
// We pick quantity = 1 whole contract (1e6) for a fixed ~ "$ask" stake.
// ----------------------------------------------------------------------------

export const PRICE_SCALE = 1_000_000_000n // 1e9 fixed point for prices/strikes
export const DUSDC_SCALE = 1_000_000n // 1e6 base units per 1 dUSDC

// One whole binary contract, expressed in the protocol's 1e6-scaled quantity.
// Max payout if it wins = 1.00 dUSDC. Cost = ask_price (in $) which is < $1.
export const ONE_CONTRACT_QTY = DUSDC_SCALE // 1_000_000

// Quote stake used purely for odds preview (devInspect get_trade_amounts).
export const PREVIEW_QUANTITY = ONE_CONTRACT_QTY

// ----------------------------------------------------------------------------
// STAKE PRESETS
// ----------------------------------------------------------------------------
// "Stake" here = payout-capacity in $: 1 contract pays $1 max if it wins. So a
// $5 stake = 5 contracts = 5_000_000 quantity (max payout $5). The actual dUSDC
// spent is the cost (ask < $1 per contract, so < stake) + the on-chain 3% rake.
// The preset chips show the $ stake; the cost is displayed separately near the
// bet buttons.
export const STAKE_PRESETS_USD = [1, 5, 25, 100] as const

// Default selected stake on landing. $25 so the headline previews a meaningful
// "WIN $50" (~2x) instead of "WIN $2" from a $1 default.
export const DEFAULT_STAKE_USD = 25

// Whole-dollar stake -> 1e6-scaled quantity (whole contracts). $5 -> 5_000_000.
// Rounds to whole contracts to keep `quantity` clean (no fractional contracts).
export const usd_to_quantity = (usd: number): bigint =>
  BigInt(Math.max(1, Math.round(usd))) * ONE_CONTRACT_QTY

// LocalStorage keys.
// The manager id + open position are NEVER persisted client-side: they are
// trusted state, resolved from chain/indexer truth each session (a wiped or
// spoofed localStorage must never affect funds). Only the gamification streak
// lives here, and it is purely decorative:
//   client-only, untrusted, resettable — cosmetic streak, not authoritative.
export const LS_STREAK = 'crashsui.streak'

// ----------------------------------------------------------------------------
// ON-CHAIN ROUTER (the 3% platform rake — enforced in Move, NOT in the client)
// ----------------------------------------------------------------------------
// A client-side rake is bypassable (anyone can edit the JS or call
// `predict::mint` raw), and the treasury address must not live in client code.
// So EVERY user action goes through a `crash_sui::router::*` wrapper — the only
// move-call targets that ever need Enoki gas-sponsorship. That keeps the Enoki
// allowlist down to OUR seven functions (see the allowlist note below), so
// sponsored gas can never reach a rake-skipping path. `router::bet` deposits the
// payment coin into the manager, skims 3% to a treasury stored INSIDE the
// router's shared Config, then mints — fully on-chain and non-bypassable.
//
// Deployed + VERIFIED ON-CHAIN (publish digest DFoWSxzzP7iGiENmpg3nLs8GsJTfpQPWqDzMG1MgG8CE):
//  - real published Move package on testnet
//  - router::bet links the LIVE predict pkg 0xf5ea..785138; its ABI params are
//    (Config, &mut Predict, &mut PredictManager, &OracleSVI, ID, u64, u64, bool,
//     u64, Coin<Quote>, &Clock, &mut TxContext) — no deepbook/token leak
//  - create_manager/cash_out/claim/withdraw all exist + link predict
export const ROUTER_PACKAGE =
  '0x885bc905f8c39a8a179a6013a4a688c19d94f49ae3a98653452f97dcaff9d2c3'

// Shared RouterConfig (Shared object) — holds fee_bps=300 + fee_recipient on-chain.
// Verified: type ...::router::Config, owner Shared, fee_bps 300. FIRST arg to router::bet.
export const ROUTER_CONFIG =
  '0x001a7db5bacc9b2e05e8d51b8733f43280e68dea842fbb01c7c5639d512859f3'

// Module path for the router's entry fns (the only signed write targets).
export const MOD_ROUTER = `${ROUTER_PACKAGE}::router`

// ----------------------------------------------------------------------------
// ENOKI SPONSORSHIP ALLOWLIST — the seven (and only seven) move-call targets the
// app ever signs. EVERY user write goes through one of these, so sponsored gas
// can never reach a rake-skipping predict::* path. This array is the SINGLE
// SOURCE OF TRUTH for that allowlist: the sponsored write path asserts (in dev)
// that every moveCall target in a tx is one of these before signing, and the
// Enoki Portal allowlist must mirror it verbatim.
//
//   <ROUTER_PACKAGE>::router::create_manager   (one-time manager setup)
//   <ROUTER_PACKAGE>::router::bet              (BET: UP/DOWN)
//   <ROUTER_PACKAGE>::router::cash_out         (BET: early exit)
//   <ROUTER_PACKAGE>::router::claim            (BET: settled payout)
//   <ROUTER_PACKAGE>::router::withdraw         (manager balance -> wallet)
//   <ROUTER_PACKAGE>::router::supply           (HOUSE: deposit dUSDC, get PLP)
//   <ROUTER_PACKAGE>::router::redeem_lp        (HOUSE: burn PLP, get dUSDC)
//
// IN-CODE per-request allowlisting is NOT reachable in @mysten/enoki 1.0.8 from a
// Enoki sponsorship allowlist is enforced SERVER-SIDE per API key in the Enoki
// Portal (the registered-wallet JWT path can't set it in browser code). The 7
// router targets to allowlist in the Portal are documented in .env.example.

// The Move router skims 3% on-chain. The client never computes or transfers the
// rake — it only ensures the manager holds enough to cover cost + the rake, so
// the payment coin funds with headroom (8% covers a 3% skim plus quote-vs-
// execution price drift). Any unused headroom stays in the user's own manager
// balance (still theirs, withdrawable).
export const BET_FUNDING_NUM = 108n // 1.08x  (cost*108/100)
export const BET_FUNDING_DEN = 100n

// The router's on-chain rake, in basis points (fee_bps=300 == 3%). Single source
// of truth for the client-side optimistic deduction: the router charges the user
// cost + this rake, so the displayed balance must drop by both. The 108% funding
// buffer above comfortably covers a 3% rake + quote-vs-execution price drift.
export const ROUTER_FEE_BPS = 300n

// Buffer a mint cost up to the amount the manager must hold for a bet (covers
// the future on-chain 3% rake + price drift). dUSDC 1e6 base units in/out.
export const bet_amount_with_buffer = (cost_1e6: bigint): bigint =>
  (cost_1e6 * BET_FUNDING_NUM) / BET_FUNDING_DEN
