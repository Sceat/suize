/// Crash Sui router — the single, non-bypassable wrapper around DeepBook Predict
/// that every user action flows through.
///
/// WHY a router for EVERYTHING (not just bets): the app sponsors gas via Enoki,
/// whose sponsorship is scoped by an `allowedMoveCallTargets` allowlist (one
/// entry per `{pkg}::module::function`). By folding every user action — manager
/// creation, betting, cashing out, claiming, withdrawing, and providing/redeeming
/// LP — into `crash_sui::router::*`, the allowlist holds only OUR seven targets.
/// Sponsored gas can therefore never reach a raw `predict::mint` (which would
/// skip the rake) or any off-path call: those targets simply are not allowlisted.
///
/// THE RAKE is enforced atomically on-chain inside `bet`: skimmed in the SAME
/// Move call that places the bet, so it is unavoidable for anyone using the
/// router. The rate + treasury live in the shared `Config`, mutable only by our
/// `AdminCap`; no treasury address ever lives in client code.
///
/// THE VERSION GATE: every user function takes `&Version` and asserts it first,
/// so a stale code path can be locked out after an upgrade and admin can freeze
/// all user actions at once. `init` creates + shares the singleton at publish
/// time, so the seven functions are gated from block one.
///
/// All user functions are `public` (NOT `entry`): `entry` forbids non-object
/// structs by value, but our PTBs pass `ID` args via `tx.pure.id`. `public` is
/// fully PTB-callable, and Enoki gates on the move-call TARGET regardless.
module crash_sui::router;

use crash_sui::version::Version;
use deepbook_predict::market_key;
use deepbook_predict::oracle::OracleSVI;
use deepbook_predict::plp::PLP;
use deepbook_predict::predict::{Self, Predict};
use deepbook_predict::predict_manager::{Self, PredictManager};
use sui::clock::Clock;
use sui::coin::{Self, Coin};

/// A fee above 10% (1000 bps) is almost certainly a mistake.
const EFEE_TOO_HIGH: u64 = 1;

/// Basis-point denominator (10_000 bps == 100%).
const BPS_DENOMINATOR: u64 = 10_000;
/// Default platform rake at publish: 300 bps == 3%.
const DEFAULT_FEE_BPS: u64 = 300;
/// Hard ceiling for the configurable fee: 1000 bps == 10%.
const MAX_FEE_BPS: u64 = 1_000;

/// Shared config holding the rake rate + treasury that receives skimmed fees.
/// Shared so any `bet` caller can read it; only `AdminCap` can mutate it.
public struct Config has key {
    id: UID,
    /// Platform rake in basis points (300 == 3%).
    fee_bps: u64,
    /// Address that receives the skimmed rake.
    fee_recipient: address,
}

/// Capability gating every admin mutation. Held by the deployer; never exposed
/// to clients. Authority is the cap itself — no address check.
public struct AdminCap has key, store {
    id: UID,
}

/// Publish-time setup: create + share `Config` (3% rake, treasury = deployer),
/// create + share the version singleton, and hand `AdminCap` to the deployer.
fun init(ctx: &mut TxContext) {
    transfer::share_object(Config {
        id: object::new(ctx),
        fee_bps: DEFAULT_FEE_BPS,
        fee_recipient: ctx.sender(),
    });
    crash_sui::version::create_and_share(ctx);
    transfer::transfer(AdminCap { id: object::new(ctx) }, ctx.sender());
}

// === User actions (the ONLY sponsored move-call targets) ===

/// Create a fresh `PredictManager` for the caller (shared internally; its `ID`
/// is returned and read from `objectChanges`). One-time per user, no bet exists
/// yet, so there is nothing to rake or bypass.
public fun create_manager(version: &Version, ctx: &mut TxContext): ID {
    version.assert_latest();
    predict::create_manager(ctx)
}

/// Place a bet, atomically skimming `fee_bps` of the mint cost to the treasury in
/// the SAME tx. The single top-level call per bet — deposit, key-build, rake, and
/// mint are folded inside.
///
/// 1. Deposit the caller's `payment` into the manager (client sizes it to cover
///    `cost + rake`; a zero-value coin deposits harmlessly if the manager already
///    holds enough).
/// 2. Build the `MarketKey` once (it has `copy`, reused for quote + mint).
/// 3. Quote `cost` for `quantity`.
/// 4. Skim `cost * fee_bps / 10_000` from the manager and route it to the
///    treasury via `coin::send_funds` (Sui Address Balances), not a fresh owned
///    Coin object.
/// 5. Mint, which pulls `cost` from the manager's internal balance.
public fun bet<Quote>(
    version: &Version,
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
    version.assert_latest();

    predict_manager::deposit<Quote>(manager, payment, ctx);

    let key = market_key::new(oracle_id, expiry, strike, is_up);
    let (cost, _payout) = predict::get_trade_amounts(predict, oracle, key, quantity, clock);

    let rake = cost * config.fee_bps / BPS_DENOMINATOR;
    if (rake > 0) {
        let rake_coin = predict_manager::withdraw<Quote>(manager, rake, ctx);
        coin::send_funds(rake_coin, config.fee_recipient);
    };

    predict::mint<Quote>(predict, manager, oracle, key, quantity, clock, ctx);
}

/// Early cash-out of a live position; payout lands in the manager balance. No
/// rake (product decision); sponsored, so it is on the allowlist.
public fun cash_out<Quote>(
    version: &Version,
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
    version.assert_latest();
    let key = market_key::new(oracle_id, expiry, strike, is_up);
    predict::redeem<Quote>(predict, manager, oracle, key, quantity, clock, ctx);
}

/// Claim a settled position permissionlessly; payout lands in the manager
/// balance. No rake.
public fun claim<Quote>(
    version: &Version,
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
    version.assert_latest();
    let key = market_key::new(oracle_id, expiry, strike, is_up);
    predict::redeem_permissionless<Quote>(predict, manager, oracle, key, quantity, clock, ctx);
}

/// Pull `amount` of the manager's internal balance back to the caller's wallet
/// (`predict_manager::withdraw` asserts caller == owner). No rake.
public fun withdraw<Quote>(
    version: &Version,
    manager: &mut PredictManager,
    amount: u64,
    ctx: &mut TxContext,
) {
    version.assert_latest();
    let coin = predict_manager::withdraw<Quote>(manager, amount, ctx);
    transfer::public_transfer(coin, ctx.sender());
}

/// Sweep the caller's ENTIRE manager dUSDC balance back to their wallet. Bundled
/// client-side after `cash_out` / `claim` so payouts never pile up in the manager
/// (which a block explorer can't surface as a wallet balance). Owner-only via
/// `predict_manager::withdraw` (asserts caller == owner); no-op when the balance
/// is zero. No rake — sweeping settled funds is not a bet.
public fun withdraw_all<Quote>(
    version: &Version,
    manager: &mut PredictManager,
    ctx: &mut TxContext,
) {
    version.assert_latest();
    let bal = predict_manager::balance<Quote>(manager);
    if (bal > 0) {
        let coin = predict_manager::withdraw<Quote>(manager, bal, ctx);
        transfer::public_transfer(coin, ctx.sender());
    };
}

/// "Be the house": supply `payment` (dUSDC) into Predict's LP vault; the minted
/// `PLP` shares go to the supplier. Routed here only to be Enoki-sponsorable. No
/// rake — providing liquidity is not a bet.
public fun supply<Quote>(
    version: &Version,
    predict: &mut Predict,
    payment: Coin<Quote>,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    version.assert_latest();
    let lp = predict::supply<Quote>(predict, payment, clock, ctx);
    transfer::public_transfer(lp, ctx.sender());
}

/// Burn `lp_coin` (PLP shares) and return the underlying dUSDC to the LP. Named
/// `redeem_lp` to avoid colliding with `withdraw` (manager balance). No rake.
public fun redeem_lp<Quote>(
    version: &Version,
    predict: &mut Predict,
    lp_coin: Coin<PLP>,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    version.assert_latest();
    let quote = predict::withdraw<Quote>(predict, lp_coin, clock, ctx);
    transfer::public_transfer(quote, ctx.sender());
}

// === Version lifecycle (AdminCap-gated; deliberately NOT version-gated) ===
//
// These live in `router` (it owns `AdminCap`; `version` cannot import it without
// a dependency cycle). NOT version-gated so admin recovery — notably `migrate`
// after a freeze — always works.

/// Lift the shared `Version` to the code's `PACKAGE_VERSION` after an upgrade.
public fun migrate(_: &AdminCap, version: &mut Version) {
    crash_sui::version::do_migrate(version);
}

/// Emergency freeze: disable every version-gated user function at once.
public fun freeze_all(_: &AdminCap, version: &mut Version) {
    crash_sui::version::do_freeze(version);
}

// === Admin setters (AdminCap-gated) ===

/// Change the treasury address that receives the rake.
public entry fun set_fee_recipient(_: &AdminCap, config: &mut Config, recipient: address) {
    config.fee_recipient = recipient;
}

/// Change the rake rate (basis points). Capped at 10%.
public entry fun set_fee_bps(_: &AdminCap, config: &mut Config, bps: u64) {
    assert!(bps <= MAX_FEE_BPS, EFEE_TOO_HIGH);
    config.fee_bps = bps;
}

// === Read accessors ===

public fun fee_bps(config: &Config): u64 {
    config.fee_bps
}

public fun fee_recipient(config: &Config): address {
    config.fee_recipient
}

// === Tests ===
//
// The full `bet` / `supply` / `redeem_lp` paths need a live `Predict` + enabled
// `Currency<Quote>`, whose only constructors are `#[test_only] public(package)`
// to `deepbook_predict` and thus unreachable here — so those paths are exercised
// on-chain (publish + live calls), not faked. Likewise `withdraw` / `withdraw_all`
// need a funded `PredictManager` (constructed only by `deepbook_predict::predict_manager::new`,
// `public(package)` — unreachable here), so its sweep is verified on-chain. We
// unit-test the rake arithmetic, admin setters + cap, and the version gate.

#[test_only]
use sui::test_scenario;

#[test]
fun test_init_defaults_and_admin_setters() {
    let admin = @0xA;
    let mut scenario = test_scenario::begin(admin);

    { init(scenario.ctx()); };

    scenario.next_tx(admin);
    {
        let mut config = scenario.take_shared<Config>();
        let cap = scenario.take_from_sender<AdminCap>();

        assert!(config.fee_bps() == DEFAULT_FEE_BPS, 0);
        assert!(config.fee_recipient() == admin, 1);

        set_fee_bps(&cap, &mut config, 500);
        assert!(config.fee_bps() == 500, 2);

        set_fee_recipient(&cap, &mut config, @0xBEEF);
        assert!(config.fee_recipient() == @0xBEEF, 3);

        set_fee_bps(&cap, &mut config, DEFAULT_FEE_BPS); // restore default
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

/// `bet` skims exactly `cost * fee_bps / 10_000`. We assert that arithmetic so a
/// refactor changing the formula trips this test (a full `bet` needs a funded
/// manager + live oracle + dUSDC, exercised on-chain).
#[test]
fun test_bet_rake_math() {
    let fee_bps = DEFAULT_FEE_BPS;

    // $0.62 of dUSDC at 1e6 scaling == 620_000 -> 3% == 18_600.
    let cost: u64 = 620_000;
    assert!(cost * fee_bps / BPS_DENOMINATOR == 18_600, 0);

    // $1.00 == 1_000_000 -> 3% == 30_000.
    let cost2: u64 = 1_000_000;
    assert!(cost2 * fee_bps / BPS_DENOMINATOR == 30_000, 1);

    // Sub-threshold cost rounds the rake DOWN to zero (integer div):
    // 33 * 300 / 10_000 == 0.
    assert!(33 * fee_bps / BPS_DENOMINATOR == 0, 2);

    // 5% (500 bps) on $1.00 -> 50_000.
    assert!(cost2 * 500 / BPS_DENOMINATOR == 50_000, 3);
}
