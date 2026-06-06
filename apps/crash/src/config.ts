// ============================================================================
// VERIFIED TESTNET CONSTANTS (DeepBook Predict, predict-testnet-4-16)
// Confirmed live against fullnode + read API. See INTEGRATION.md for the
// verbatim Move signatures these calls target.
// ============================================================================

import { PACKAGE_IDS } from '@suize/shared'

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

// Move event types (the source of truth for REALIZED history). PositionRedeemed
// carries the EXACT realized `payout` + an `is_settled` discriminator (settlement
// claim vs early cash-out); PositionMinted carries the per-bucket `cost`. We
// query suix_queryEvents filtered by these MoveEventTypes and reconcile by the
// shared key (manager_id, oracle_id, is_up, strike, expiry). Verified live.
export const EVENT_POSITION_MINTED = `${PREDICT_PACKAGE}::predict::PositionMinted`
export const EVENT_POSITION_REDEEMED = `${PREDICT_PACKAGE}::predict::PositionRedeemed`

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

// The final-N-seconds BETTING SEAL window. A round locks for new bets/grows in its
// last LOCK_WINDOW_MS; the bet target then ROLLS to the next active round (PART B),
// so betting is continuous and only the looked-at round's final 15s is locked —
// never a doubled 15s across the settle. pick_live_btc_oracle uses the same guard.
export const LOCK_WINDOW_MS = 15_000

// ----------------------------------------------------------------------------
// STAKE PRESETS
// ----------------------------------------------------------------------------
// "Stake"/"wager" here = the dUSDC the user PARTS WITH IN TOTAL. The client sizes
// `quantity` (App.tsx quantity_for_stake) from the live per-contract ask so the
// DEBIT (bare cost + the on-chain 3% rake) ≈ the wager to sub-cent. The WIN payout
// (contracts × $1) differs per side with the odds; the preset chips show the $ wager.
export const STAKE_PRESETS_USD = [1, 5, 25, 100] as const

// Default selected stake on landing. $25 so the headline previews a meaningful
// "WIN $50" (~2x) instead of "WIN $2" from a $1 default.
export const DEFAULT_STAKE_USD = 25

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
// FRESH GATED + ACCUMULATOR PACKAGE — replaces the old 0x885b/0x453b2ad2 lineage
// entirely. Every router fn is now version-gated: a shared `Version` object is the
// FIRST arg to all seven entry fns, so a deprecated package version can be fenced
// off on-chain. The package also threads an on-chain fee accumulator.
//  - real published Move package on testnet
//  - router::bet links the LIVE predict pkg 0xf5ea..785138; its ABI params are
//    (Version, Config, &mut Predict, &mut PredictManager, &OracleSVI, ID, u64,
//     u64, bool, u64, Coin<Quote>, &Clock, &mut TxContext) — no deepbook/token leak
//  - create_manager/cash_out/claim/withdraw/supply/redeem_lp all version-gated
// SINGLE SOURCE OF TRUTH (LOCKED DECISION #5): the package id lives ONLY in
// @suize/shared; we re-export it here rather than duplicate the literal.
export const ROUTER_PACKAGE = PACKAGE_IDS.CRASH.PACKAGE

// Shared RouterConfig (Shared object) — holds fee_bps=300 + fee_recipient on-chain.
// Type ...::router::Config, owner Shared, fee_bps 300. SECOND arg to router::bet
// (after the Version gate).
export const ROUTER_CONFIG =
  '0x66bdf9a8050573d46d409d32ff0b19cd5983a082d4326289709057f68c14f5ee'

// Shared Version object (the gate) — FIRST arg to EVERY router entry fn. A
// deprecated package version is fenced off on-chain via this object, so an old
// build can no longer reach the live predict pkg through the router.
export const VERSION_ID =
  '0x6f0247af6e7b0580c7891771dd8a15469df4035a822a6e050871b12d1afc72a4'

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
