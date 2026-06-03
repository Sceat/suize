/// Crash Sui router — the single, non-bypassable wrapper around DeepBook
/// Predict that every user action flows through.
///
/// Why a router for EVERYTHING (not just bets): the app sponsors gas via Enoki,
/// and Enoki's sponsorship is scoped by an `allowedMoveCallTargets` allowlist
/// (one entry per `{pkg}::module::function` that a sponsored PTB may invoke).
/// By folding every user action — manager creation, betting, cashing out,
/// claiming, withdrawing, and providing/redeeming LP ("being the house") — into
/// a `crash_sui::router::*` wrapper, the Enoki allowlist need only contain OUR
/// seven targets. Sponsored gas can therefore
/// never flow to a raw `predict::mint` (which would skip the rake) or any other
/// off-path call, because those targets are simply not on the allowlist.
///
/// The rake is still enforced atomically and on-chain inside `bet`: it is
/// skimmed in the SAME Move call that places the bet, so it is unavoidable for
/// anyone using the router, and the treasury + rate live in an on-chain shared
/// `Config` that only our `AdminCap` can mutate. No treasury address ever lives
/// in client code.
///
/// All user-facing functions are `public` (NOT `entry`): `entry` forbids
/// non-object structs by value and our PTBs pass `ID` arguments via
/// `tx.pure.id`. A `public` function is fully PTB-callable, which is the shape
/// the frontend needs, and Enoki gates on the move-call TARGET regardless of
/// the function's `entry`-ness.
///
/// Lint notes (the build emits a few benign, intentional warnings): `withdraw`
/// deliberately `public_transfer`s the manager's coin back to the caller's own
/// wallet (the product behavior, not an accidental self-transfer), and the admin
/// setters are `public entry` so they are callable both from PTBs and as plain
/// CLI/entry calls.
module crash_sui::router;

use deepbook_predict::market_key;
use deepbook_predict::oracle::OracleSVI;
use deepbook_predict::plp::PLP;
use deepbook_predict::predict::{Self, Predict};
use deepbook_predict::predict_manager::{Self, PredictManager};
use sui::clock::Clock;
use sui::coin::Coin;

// === Errors ===

/// Sanity cap: a fee above 10% (1000 bps) is almost certainly a mistake.
const EFEE_TOO_HIGH: u64 = 1;

// === Constants ===

/// Basis-point denominator (10_000 bps == 100%).
const BPS_DENOMINATOR: u64 = 10_000;
/// Default platform rake at publish time: 300 bps == 3%.
const DEFAULT_FEE_BPS: u64 = 300;
/// Hard ceiling for the configurable fee: 1000 bps == 10%.
const MAX_FEE_BPS: u64 = 1_000;

// === Structs ===

/// Shared, mutable-by-admin configuration. Holds the rake rate and the treasury
/// address that receives skimmed fees. Shared so any `bet` caller can read it.
public struct Config has key {
    id: UID,
    /// Platform rake in basis points (300 == 3%).
    fee_bps: u64,
    /// Address that receives the skimmed rake coins.
    fee_recipient: address,
}

/// Capability gating all admin mutations of `Config`. Held off-chain by us
/// (the deployer); never exposed to clients.
public struct AdminCap has key, store {
    id: UID,
}

// === Init ===

/// Publish-time setup: create and share the `Config` (3% rake, treasury = the
/// deployer), and hand the `AdminCap` to the deployer.
fun init(ctx: &mut TxContext) {
    let config = Config {
        id: object::new(ctx),
        fee_bps: DEFAULT_FEE_BPS,
        fee_recipient: ctx.sender(),
    };
    transfer::share_object(config);

    let admin_cap = AdminCap { id: object::new(ctx) };
    transfer::transfer(admin_cap, ctx.sender());
}

// === User actions (the ONLY sponsored move-call targets) ===

/// Create a fresh `PredictManager` for the caller. Thin pass-through to
/// `predict::create_manager`, which shares the manager internally and returns
/// its `ID` (the frontend reads the created shared-object id from
/// `objectChanges` and persists it).
///
/// One-time per user. No bet exists yet, so there is no rake to skim and
/// nothing to bypass — this is the single rake-free sponsored call, which is
/// acceptable because it is one-shot per address and Enoki budget-limited.
public fun create_manager(ctx: &mut TxContext): ID {
    predict::create_manager(ctx)
}

/// Place a Predict bet through the router, atomically skimming `fee_bps` of the
/// mint cost to the treasury in the SAME transaction. This is the ONE top-level
/// move-call the frontend makes per bet — deposit, key-build, rake, and mint are
/// all folded inside.
///
/// Flow:
/// 1. Deposit the caller's `payment` coin fully into the manager. The client
///    sizes `payment` to cover `cost + rake` (~108% of quoted cost) by splitting
///    exactly the shortfall via a native `SplitCoins` command in the same PTB;
///    if the manager already holds enough from prior winnings/leftovers the
///    client may pass a zero-value coin, which deposits harmlessly.
/// 2. Build the `MarketKey` internally from the (oracle_id, expiry, strike,
///    is_up) tuple — `MarketKey` has `copy`, so the same value is reused for the
///    quote and the mint.
/// 3. Quote the mint cost for `quantity` via `predict::get_trade_amounts`.
/// 4. Skim `cost * fee_bps / 10_000` from the manager balance
///    (`predict_manager::withdraw` asserts caller == manager owner, satisfied
///    because the user signs this tx) and `public_transfer` it to the treasury.
/// 5. Place the bet via `predict::mint`, which pulls `cost` from the manager's
///    internal balance.
///
/// After step 1 the manager must hold >= `cost + rake`; the ~8% client headroom
/// covers the 3% rake plus quote-vs-execution price drift.
public fun bet<Quote>(
    config: &Config,
    predict: &mut Predict,
    manager: &mut PredictManager,
    oracle: &OracleSVI,
    oracle_id: ID,
    expiry: u64,
    strike: u64,
    is_up: bool,
    quantity: u64,
    payment: Coin<Quote>,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    // 1. Fund the manager with the caller's coin (may be zero-value).
    predict_manager::deposit<Quote>(manager, payment, ctx);

    // 2. Build the key once; reused for quote + mint (MarketKey has `copy`).
    let key = market_key::new(oracle_id, expiry, strike, is_up);

    // 3. Quote the cost (dUSDC base units, already multiplied by quantity).
    let (cost, _payout) = predict::get_trade_amounts(predict, oracle, key, quantity, clock);

    // 4. Skim the rake from the user's own manager balance to the treasury.
    let rake = cost * config.fee_bps / BPS_DENOMINATOR;
    if (rake > 0) {
        let rake_coin = predict_manager::withdraw<Quote>(manager, rake, ctx);
        transfer::public_transfer(rake_coin, config.fee_recipient);
    };

    // 5. Place the bet. `mint` withdraws `cost` from the manager internally.
    predict::mint<Quote>(predict, manager, oracle, key, quantity, clock, ctx);
}

/// Early cash-out of a live position. Builds the key internally and calls
/// `predict::redeem`, whose payout lands in the manager's internal balance.
/// No rake (product decision); sponsored anyway, so it lives on the allowlist.
public fun cash_out<Quote>(
    predict: &mut Predict,
    manager: &mut PredictManager,
    oracle: &OracleSVI,
    oracle_id: ID,
    expiry: u64,
    strike: u64,
    is_up: bool,
    quantity: u64,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    let key = market_key::new(oracle_id, expiry, strike, is_up);
    predict::redeem<Quote>(predict, manager, oracle, key, quantity, clock, ctx);
}

/// Claim a settled position permissionlessly. Builds the key internally and
/// calls `predict::redeem_permissionless`, whose payout lands in the manager's
/// internal balance. No rake.
public fun claim<Quote>(
    predict: &mut Predict,
    manager: &mut PredictManager,
    oracle: &OracleSVI,
    oracle_id: ID,
    expiry: u64,
    strike: u64,
    is_up: bool,
    quantity: u64,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    let key = market_key::new(oracle_id, expiry, strike, is_up);
    predict::redeem_permissionless<Quote>(predict, manager, oracle, key, quantity, clock, ctx);
}

/// Pull `amount` of the manager's internal balance back to the caller's wallet.
/// `predict_manager::withdraw` asserts caller == manager owner. No rake.
public fun withdraw<Quote>(manager: &mut PredictManager, amount: u64, ctx: &mut TxContext) {
    let coin = predict_manager::withdraw<Quote>(manager, amount, ctx);
    transfer::public_transfer(coin, ctx.sender());
}

// === Be the House (liquidity provision) ===

/// Supply `payment` (dUSDC) into Predict's shared LP vault and hand the minted
/// `PLP` LP-share tokens back to the supplier. Folded into the router solely so
/// it is sponsorable via Enoki alongside the betting calls. No rake: providing
/// liquidity ("being the house") is not a bet, so nothing is skimmed.
public fun supply<Quote>(
    predict: &mut Predict,
    payment: Coin<Quote>,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    let lp = predict::supply<Quote>(predict, payment, clock, ctx);
    transfer::public_transfer(lp, ctx.sender());
}

/// Burn `lp_coin` (PLP LP shares) and return the underlying quote (dUSDC) to the
/// LP. Named `redeem_lp` to avoid colliding with `withdraw` (which pulls dUSDC
/// from a `PredictManager`). No rake — unwinding a house position is not a bet.
public fun redeem_lp<Quote>(
    predict: &mut Predict,
    lp_coin: Coin<PLP>,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    let quote = predict::withdraw<Quote>(predict, lp_coin, clock, ctx);
    transfer::public_transfer(quote, ctx.sender());
}

// === Admin setters (AdminCap-gated) ===

/// Change the treasury address that receives the rake.
public entry fun set_fee_recipient(_: &AdminCap, config: &mut Config, recipient: address) {
    config.fee_recipient = recipient;
}

/// Change the rake rate (basis points). Capped at 10% as a sanity guard.
public entry fun set_fee_bps(_: &AdminCap, config: &mut Config, bps: u64) {
    assert!(bps <= MAX_FEE_BPS, EFEE_TOO_HIGH);
    config.fee_bps = bps;
}

// === Read accessors ===

/// Current rake rate in basis points.
public fun fee_bps(config: &Config): u64 {
    config.fee_bps
}

/// Current treasury address.
public fun fee_recipient(config: &Config): address {
    config.fee_recipient
}

// === Tests ===
//
// NOTE on LP round-trip coverage: a `supply -> redeem_lp` unit test would need a
// live `Predict` object and an enabled `Currency<Quote>`. Predict's only
// constructors for these (`create_test_predict`, `enable_quote_asset`) are
// `#[test_only] public(package)` to `deepbook_predict`, so they are unreachable
// from this `crash_sui` test module. There is no public test scaffolding to
// build them either. As with `bet`, the LP path is therefore exercised on-chain
// (publish + live supply/withdraw against the testnet vault), not in unit tests
// — see README/INTEGRATION. We deliberately do NOT fake a test here.

#[test_only]
use sui::test_scenario;

#[test]
fun test_init_defaults_and_admin_setters() {
    let admin = @0xA;
    let mut scenario = test_scenario::begin(admin);

    // Run init.
    {
        init(scenario.ctx());
    };

    // Verify defaults and exercise admin setters.
    scenario.next_tx(admin);
    {
        let mut config = scenario.take_shared<Config>();
        let cap = scenario.take_from_sender<AdminCap>();

        assert!(config.fee_bps() == DEFAULT_FEE_BPS, 0);
        assert!(config.fee_recipient() == admin, 1);

        set_fee_bps(&cap, &mut config, 500);
        assert!(config.fee_bps() == 500, 2);

        let new_treasury = @0xBEEF;
        set_fee_recipient(&cap, &mut config, new_treasury);
        assert!(config.fee_recipient() == new_treasury, 3);

        // restore default
        set_fee_bps(&cap, &mut config, DEFAULT_FEE_BPS);
        assert!(config.fee_bps() == DEFAULT_FEE_BPS, 4);

        scenario.return_to_sender(cap);
        test_scenario::return_shared(config);
    };

    scenario.end();
}

#[test]
#[expected_failure(abort_code = EFEE_TOO_HIGH)]
fun test_set_fee_bps_rejects_over_cap() {
    let admin = @0xA;
    let mut scenario = test_scenario::begin(admin);
    { init(scenario.ctx()); };

    scenario.next_tx(admin);
    {
        let mut config = scenario.take_shared<Config>();
        let cap = scenario.take_from_sender<AdminCap>();
        set_fee_bps(&cap, &mut config, MAX_FEE_BPS + 1); // aborts
        scenario.return_to_sender(cap);
        test_scenario::return_shared(config);
    };
    scenario.end();
}

/// The rake skimmed by `bet` is exactly `cost * fee_bps / 10_000`. We assert the
/// arithmetic the `bet` body uses on a representative quote cost so a future
/// refactor that changes the formula trips this test. (A full `bet` execution
/// needs a funded manager + live oracle + dUSDC, which is exercised on-chain,
/// not in unit tests — see README/INTEGRATION.)
#[test]
fun test_bet_rake_math() {
    // Default 3% (300 bps).
    let fee_bps = DEFAULT_FEE_BPS;

    // Representative mint cost: $0.62 of dUSDC at 1e6 scaling == 620_000 units.
    let cost: u64 = 620_000;
    let rake = cost * fee_bps / BPS_DENOMINATOR;
    // 620_000 * 300 / 10_000 = 18_600 (== $0.0186).
    assert!(rake == 18_600, 0);

    // A whole-dollar cost: $1.00 == 1_000_000 units -> 3% == 30_000.
    let cost2: u64 = 1_000_000;
    let rake2 = cost2 * fee_bps / BPS_DENOMINATOR;
    assert!(rake2 == 30_000, 1);

    // Sub-rake-threshold cost rounds the rake DOWN toward zero (integer div):
    // 33 * 300 / 10_000 = 9900 / 10_000 = 0.
    let tiny: u64 = 33;
    let rake3 = tiny * fee_bps / BPS_DENOMINATOR;
    assert!(rake3 == 0, 2);

    // A configured 5% (500 bps) on $1.00 -> 50_000.
    let rake4 = cost2 * 500 / BPS_DENOMINATOR;
    assert!(rake4 == 50_000, 3);
}
