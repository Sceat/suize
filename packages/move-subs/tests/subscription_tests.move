#[test_only]
/// Tests for `subs::subscription` — the standalone, Party-owned, push-funded
/// subscription rail.
///
/// Headline guarantees under test:
///   CREATE  — first period paid inline; `paid_until_ms == now + period_ms`; the
///             `SubscriptionCreated` event carries every field; bad terms (zero
///             amount / zero period) and a wrong-sized payment abort BEFORE the
///             object exists.
///   RENEW   — advances `paid_until_ms` by EXACTLY one period; an early renewal
///             inside the 24h window is allowed and extends paid-through; a second
///             in-window renewal aborts `ETooEarly` (the double-charge guard);
///             after a lapse the new period starts at `now` (no back-billing).
///   FEE     — 2% with a $0.01 floor on tiny amounts, clamped to `amount` (a sub
///             smaller than the floor pays its whole value as fee, merchant gets 0,
///             no abort); a redirected treasury is honored.
///   CANCEL  — emits `paid_until_ms` (merchants may honor remaining time) and the
///             object is gone.
///   ADMIN   — `set_fee` rejects `bps > 10_000` (`EInvalidRate`).
///
/// As with the move-wallet suites, abort-code constants are NOT imported as aliases
/// — `#[expected_failure(abort_code = ...)]` references them by fully-qualified path
/// (`sub::ETooEarly`), so importing would only yield "unused alias" warnings.
module subs::subscription_tests;

use subs::subscription::{Self as sub, Subscription, SubsConfig, SubsAdminCap, Version};
use sui::balance;
use sui::clock::{Self, Clock};
use sui::event;
use sui::test_scenario::{Self as ts, Scenario};

// === Test coin type ===
// A bare witness to instantiate `Subscription<TUSD>` / `Balance<TUSD>` (stands in
// for USDC). `has drop` so the empty witness can be discarded; balances are
// fabricated with `balance::create_for_testing`, so no Supply is needed.
public struct TUSD has drop {}

/// A SECOND throwaway coin — the "wrong" settlement coin for the coin-type-pin tests
/// (stands in for any non-USDC token an attacker might pay a worthless period in).
public struct WRONG has drop {}

// === Test actors ===
const OWNER: address = @0xA; // the subscription owner + (here) the rail publisher/admin
const MERCHANT: address = @0xB; // the fixed payee
const TREASURY: address = @0xE; // the redirected fee recipient

// === Test fixtures ===
const AMOUNT: u64 = 19_990_000; // ~$19.99 at 6 decimals (the Deploy sub price)
const PERIOD_MS: u64 = 30 * 24 * 60 * 60 * 1_000; // ~30 days
const RENEW_WINDOW_MS: u64 = 86_400_000; // 24h — mirrors the module constant
const FEE_BPS: u64 = 200; // 2% — the default
const REF: vector<u8> = b"plan_pro";

// === Helpers ===

/// Start as OWNER (publisher/admin here), publish the rail (shared `SubsConfig` +
/// `SubsAdminCap` to OWNER). Clock fixed at t=0. The default treasury after init is
/// the publisher (OWNER); individual tests redirect it when they assert on it.
fun begin(): (Scenario, Clock) {
    let mut scenario = ts::begin(OWNER);
    let clock = clock::create_for_testing(scenario.ctx());
    scenario.next_tx(OWNER);
    sub::init_for_testing(scenario.ctx());
    (scenario, clock)
}

fun cleanup(scenario: Scenario, clock: Clock) {
    clock::destroy_for_testing(clock);
    scenario.end();
}

/// Mint exactly `amount` TUSD as a `Balance` for a push payment.
fun pay(amount: u64): balance::Balance<TUSD> {
    balance::create_for_testing<TUSD>(amount)
}

/// Mint `amount` of the WRONG coin (for the coin-pin reject test).
fun pay_wrong(amount: u64): balance::Balance<WRONG> {
    balance::create_for_testing<WRONG>(amount)
}

/// As OWNER, pin the settlement coin to `T` via the admin cap.
fun pin_coin_as_admin<T>(scenario: &mut Scenario) {
    scenario.next_tx(OWNER);
    let cap = scenario.take_from_sender<SubsAdminCap>();
    let mut config = scenario.take_shared<SubsConfig>();
    sub::set_coin_type<T>(&mut config, &cap);
    ts::return_shared(config);
    scenario.return_to_sender(cap);
}

/// As OWNER, redirect the rail treasury to `addr`.
fun set_treasury_as_admin(scenario: &mut Scenario, addr: address) {
    scenario.next_tx(OWNER);
    let cap = scenario.take_from_sender<SubsAdminCap>();
    let mut config = scenario.take_shared<SubsConfig>();
    sub::set_treasury(&mut config, &cap, addr);
    ts::return_shared(config);
    scenario.return_to_sender(cap);
}

/// As OWNER, create a subscription paying the first period inline (push `amount`).
fun create_as_owner(scenario: &mut Scenario, clock: &Clock, amount: u64, period_ms: u64) {
    scenario.next_tx(OWNER);
    let version = scenario.take_shared<Version>();
    let config = scenario.take_shared<SubsConfig>();
    sub::create<TUSD>(&version, &config, MERCHANT, amount, period_ms, REF, pay(amount), clock, scenario.ctx());
    ts::return_shared(config);
    ts::return_shared(version);
}

/// As `who`, renew the OWNER's subscription (the object is single-owner Party →
/// taken from OWNER's address), pushing `amount`.
fun renew_as(scenario: &mut Scenario, who: address, clock: &Clock, amount: u64) {
    scenario.next_tx(who);
    let mut s = scenario.take_from_address<Subscription<TUSD>>(OWNER);
    let version = scenario.take_shared<Version>();
    let config = scenario.take_shared<SubsConfig>();
    sub::renew<TUSD>(&version, &mut s, &config, pay(amount), clock, scenario.ctx());
    ts::return_shared(config);
    ts::return_shared(version);
    ts::return_to_address(OWNER, s);
}

// === CREATE ===

#[test]
/// Happy path: first period paid inline, `paid_until_ms == now + period_ms`, the
/// `SubscriptionCreated` event is correct field-for-field, the object is owned by
/// OWNER and active.
fun test_create_happy_and_event() {
    let (mut scenario, mut clock) = begin();
    clock.set_for_testing(1_000_000); // a non-zero "now" so the +period math is visible

    create_as_owner(&mut scenario, &clock, AMOUNT, PERIOD_MS);

    let fee = (AMOUNT * FEE_BPS) / 10_000; // 2% > $0.01 floor here
    let paid_until = 1_000_000 + PERIOD_MS;

    // Assert the event in the create tx (events_by_type is scoped to the last tx).
    let evs = event::events_by_type<sub::SubscriptionCreated>();
    assert!(evs.length() == 1, 6);
    let sub_id = evs[0].created_subscription_id();
    assert!(
        evs[0] == sub::created_event_for_testing(
            sub_id, OWNER, MERCHANT, AMOUNT, PERIOD_MS, paid_until, fee, REF,
        ),
        7,
    );

    // Object exists, owned by OWNER, active, terms as created.
    scenario.next_tx(OWNER);
    {
        let s = scenario.take_from_address<Subscription<TUSD>>(OWNER);
        assert!(object::id(&s) == sub_id, 0);
        assert!(sub::merchant(&s) == MERCHANT, 1);
        assert!(sub::amount(&s) == AMOUNT, 2);
        assert!(sub::period_ms(&s) == PERIOD_MS, 3);
        assert!(sub::paid_until_ms(&s) == paid_until, 4);
        assert!(sub::ref(&s) == REF, 5);
        assert!(sub::is_active(&s, &clock), 8);
        ts::return_to_address(OWNER, s);
    };

    cleanup(scenario, clock);
}

#[test]
#[expected_failure(abort_code = sub::EBadTerms)]
/// Zero amount → `EBadTerms` (before any money moves).
fun test_create_zero_amount_aborts() {
    let (mut scenario, clock) = begin();
    scenario.next_tx(OWNER);
    let version = scenario.take_shared<Version>();
    let config = scenario.take_shared<SubsConfig>();
    sub::create<TUSD>(&version, &config, MERCHANT, 0, PERIOD_MS, REF, pay(0), &clock, scenario.ctx());
    ts::return_shared(config);
    ts::return_shared(version);
    cleanup(scenario, clock);
}

#[test]
#[expected_failure(abort_code = sub::EBadTerms)]
/// Zero period → `EBadTerms`.
fun test_create_zero_period_aborts() {
    let (mut scenario, clock) = begin();
    scenario.next_tx(OWNER);
    let version = scenario.take_shared<Version>();
    let config = scenario.take_shared<SubsConfig>();
    sub::create<TUSD>(&version, &config, MERCHANT, AMOUNT, 0, REF, pay(AMOUNT), &clock, scenario.ctx());
    ts::return_shared(config);
    ts::return_shared(version);
    cleanup(scenario, clock);
}

#[test]
#[expected_failure(abort_code = sub::EWrongAmount)]
/// Overpaying the first period → `EWrongAmount` (payment > amount).
fun test_create_overpay_aborts() {
    let (mut scenario, clock) = begin();
    scenario.next_tx(OWNER);
    let version = scenario.take_shared<Version>();
    let config = scenario.take_shared<SubsConfig>();
    sub::create<TUSD>(&version, &config, MERCHANT, AMOUNT, PERIOD_MS, REF, pay(AMOUNT + 1), &clock, scenario.ctx());
    ts::return_shared(config);
    ts::return_shared(version);
    cleanup(scenario, clock);
}

#[test]
#[expected_failure(abort_code = sub::EWrongAmount)]
/// Underpaying the first period → `EWrongAmount` (payment < amount).
fun test_create_underpay_aborts() {
    let (mut scenario, clock) = begin();
    scenario.next_tx(OWNER);
    let version = scenario.take_shared<Version>();
    let config = scenario.take_shared<SubsConfig>();
    sub::create<TUSD>(&version, &config, MERCHANT, AMOUNT, PERIOD_MS, REF, pay(AMOUNT - 1), &clock, scenario.ctx());
    ts::return_shared(config);
    ts::return_shared(version);
    cleanup(scenario, clock);
}

#[test]
#[expected_failure(abort_code = sub::EBadTerms)]
/// A period longer than ~10 years → `EBadTerms` (the overflow-safety cap on `period_ms`,
/// so `now + period_ms` can never overflow u64).
fun test_create_period_too_long_aborts() {
    let (mut scenario, clock) = begin();
    scenario.next_tx(OWNER);
    let version = scenario.take_shared<Version>();
    let config = scenario.take_shared<SubsConfig>();
    // 10 years + 1ms — one past MAX_PERIOD_MS (315_360_000_000).
    sub::create<TUSD>(&version, &config, MERCHANT, AMOUNT, 315_360_000_001, REF, pay(AMOUNT), &clock, scenario.ctx());
    ts::return_shared(config);
    ts::return_shared(version);
    cleanup(scenario, clock);
}

#[test]
#[expected_failure(abort_code = sub::EWrongCoin)]
/// Once the coin is pinned to TUSD ("USDC"), creating a subscription in a DIFFERENT coin
/// aborts `EWrongCoin` — a worthless-coin sub cannot exist against the pinned config.
fun test_create_wrong_coin_aborts() {
    let (mut scenario, clock) = begin();
    pin_coin_as_admin<TUSD>(&mut scenario);
    // A WRONG-coin create (exact amount, so it passes EWrongAmount) must abort EWrongCoin.
    scenario.next_tx(OWNER);
    let version = scenario.take_shared<Version>();
    let config = scenario.take_shared<SubsConfig>();
    sub::create<WRONG>(&version, &config, MERCHANT, AMOUNT, PERIOD_MS, REF, pay_wrong(AMOUNT), &clock, scenario.ctx());
    ts::return_shared(config);
    ts::return_shared(version);
    cleanup(scenario, clock);
}

#[test]
/// After pinning TUSD, a TUSD subscription still works (the pin allows the right coin),
/// and the config reports the pin as set.
fun test_create_pinned_coin_ok() {
    let (mut scenario, mut clock) = begin();
    clock.set_for_testing(1_000_000);
    pin_coin_as_admin<TUSD>(&mut scenario);
    scenario.next_tx(OWNER);
    {
        let config = scenario.take_shared<SubsConfig>();
        assert!(config.coin_type().is_some(), 0);
        ts::return_shared(config);
    };
    // A correct-coin (TUSD) create still succeeds (no abort).
    create_as_owner(&mut scenario, &clock, AMOUNT, PERIOD_MS);
    scenario.next_tx(OWNER);
    {
        let s = scenario.take_from_address<Subscription<TUSD>>(OWNER);
        assert!(sub::is_active(&s, &clock), 1);
        ts::return_to_address(OWNER, s);
    };
    cleanup(scenario, clock);
}

// === RENEW ===

#[test]
/// Renew at exactly `paid_until_ms` advances paid-through by EXACTLY one period and
/// emits the correct `SubscriptionRenewed`.
fun test_renew_happy_advances_one_period() {
    let (mut scenario, mut clock) = begin();
    create_as_owner(&mut scenario, &clock, AMOUNT, PERIOD_MS); // paid_until = PERIOD_MS

    // Jump to the exact paid-through boundary and renew.
    clock.set_for_testing(PERIOD_MS);
    renew_as(&mut scenario, OWNER, &clock, AMOUNT);

    let expected_paid_until = PERIOD_MS + PERIOD_MS; // exactly two periods, no drift
    let fee = (AMOUNT * FEE_BPS) / 10_000;

    // Assert the event in the SAME tx context as the renew (events_by_type is scoped
    // to the most-recent tx; advancing first would clear the buffer).
    let evs = event::events_by_type<sub::SubscriptionRenewed>();
    assert!(evs.length() == 1, 2);
    let sub_id = evs[0].renewed_subscription_id();
    assert!(
        evs[0] == sub::renewed_event_for_testing(
            sub_id, OWNER, MERCHANT, AMOUNT, fee, expected_paid_until, REF,
        ),
        3,
    );

    // Object state matches the event.
    scenario.next_tx(OWNER);
    {
        let s = scenario.take_from_address<Subscription<TUSD>>(OWNER);
        assert!(object::id(&s) == sub_id, 0);
        assert!(sub::paid_until_ms(&s) == expected_paid_until, 1);
        assert!(sub::is_active(&s, &clock), 4);
        ts::return_to_address(OWNER, s);
    };

    cleanup(scenario, clock);
}

#[test]
/// An early renewal INSIDE the 24h window (just before paid-through) is allowed and
/// EXTENDS the existing paid-through (no period lost — adds period on top of the
/// remaining time).
fun test_renew_early_inside_window_ok() {
    let (mut scenario, mut clock) = begin();
    create_as_owner(&mut scenario, &clock, AMOUNT, PERIOD_MS); // paid_until = PERIOD_MS

    // 1h before paid-through — inside the 24h window, not yet lapsed.
    let now = PERIOD_MS - 3_600_000;
    clock.set_for_testing(now);
    renew_as(&mut scenario, OWNER, &clock, AMOUNT);

    // base = max(paid_until, now) = paid_until (still in the future) → extends it.
    let expected = PERIOD_MS + PERIOD_MS;

    scenario.next_tx(OWNER);
    {
        let s = scenario.take_from_address<Subscription<TUSD>>(OWNER);
        assert!(sub::paid_until_ms(&s) == expected, 0);
        ts::return_to_address(OWNER, s);
    };

    cleanup(scenario, clock);
}

#[test]
#[expected_failure(abort_code = sub::ETooEarly)]
/// A second renewal in the same period (still > 24h ahead of the freshly-advanced
/// paid-through) aborts `ETooEarly` — the on-chain double-charge guard.
fun test_renew_double_in_window_aborts() {
    let (mut scenario, mut clock) = begin();
    create_as_owner(&mut scenario, &clock, AMOUNT, PERIOD_MS); // paid_until = PERIOD_MS

    clock.set_for_testing(PERIOD_MS);
    renew_as(&mut scenario, OWNER, &clock, AMOUNT); // paid_until -> 2*PERIOD_MS

    // Immediately try again at the same `now`: now + 24h << 2*PERIOD_MS → ETooEarly.
    renew_as(&mut scenario, OWNER, &clock, AMOUNT);

    cleanup(scenario, clock);
}

#[test]
#[expected_failure(abort_code = sub::ETooEarly)]
/// Renewing far too early (well outside the 24h window) aborts `ETooEarly`.
fun test_renew_too_early_aborts() {
    let (mut scenario, mut clock) = begin();
    create_as_owner(&mut scenario, &clock, AMOUNT, PERIOD_MS); // paid_until = PERIOD_MS

    // 1ms before the window opens (window opens at PERIOD_MS - RENEW_WINDOW_MS) → too early.
    clock.set_for_testing(PERIOD_MS - RENEW_WINDOW_MS - 1);
    renew_as(&mut scenario, OWNER, &clock, AMOUNT);

    cleanup(scenario, clock);
}

#[test]
/// Renewing AFTER a lapse starts the new period at `now` (no back-billing): the new
/// paid-through is EXACTLY `now + period`, not `old_paid_until + period`.
fun test_renew_after_lapse_no_backbilling() {
    let (mut scenario, mut clock) = begin();
    create_as_owner(&mut scenario, &clock, AMOUNT, PERIOD_MS); // paid_until = PERIOD_MS

    // Lapse: well past paid-through (3 full periods later).
    let now = PERIOD_MS * 3;
    clock.set_for_testing(now);
    renew_as(&mut scenario, OWNER, &clock, AMOUNT);

    // base = max(paid_until, now) = now → new paid_until = now + period (no catch-up).
    let expected = now + PERIOD_MS;

    scenario.next_tx(OWNER);
    {
        let s = scenario.take_from_address<Subscription<TUSD>>(OWNER);
        assert!(sub::paid_until_ms(&s) == expected, 0);
        assert!(sub::is_active(&s, &clock), 1);
        ts::return_to_address(OWNER, s);
    };

    cleanup(scenario, clock);
}

#[test]
#[expected_failure(abort_code = sub::EWrongAmount)]
/// A renewal pushing the wrong amount → `EWrongAmount` (even when the time-gate is
/// satisfied).
fun test_renew_wrong_amount_aborts() {
    let (mut scenario, mut clock) = begin();
    create_as_owner(&mut scenario, &clock, AMOUNT, PERIOD_MS);
    clock.set_for_testing(PERIOD_MS);
    renew_as(&mut scenario, OWNER, &clock, AMOUNT - 1);
    cleanup(scenario, clock);
}

// === FEE FLOOR / CLAMP ===

#[test]
/// Fee FLOOR: a small subscription where 2% < $0.01 pays the $0.01 floor, not the
/// percentage. amount = 20_000 (2 cents) → 2% = 400, but floor = 10_000 wins.
fun test_fee_floor_on_small_amount() {
    let (mut scenario, mut clock) = begin();
    let small = 20_000; // $0.02
    clock.set_for_testing(500);
    create_as_owner(&mut scenario, &clock, small, PERIOD_MS);

    let evs = event::events_by_type<sub::SubscriptionCreated>();
    assert!(evs.length() == 1, 0);
    let sub_id = evs[0].created_subscription_id();
    // pct = 20_000*200/10_000 = 400; floored to 10_000; 10_000 < 20_000 → fee = 10_000.
    assert!(
        evs[0] == sub::created_event_for_testing(
            sub_id, OWNER, MERCHANT, small, PERIOD_MS, 500 + PERIOD_MS, 10_000, REF,
        ),
        1,
    );
    cleanup(scenario, clock);
}

#[test]
/// Fee CLAMP: a subscription SMALLER than the floor pays its WHOLE value as fee, the
/// merchant gets 0, and NOTHING aborts. amount = 5_000 < floor 10_000 → fee = 5_000.
fun test_fee_clamped_to_amount_no_abort() {
    let (mut scenario, mut clock) = begin();
    let tiny = 5_000; // $0.005, below the $0.01 floor
    clock.set_for_testing(500);
    create_as_owner(&mut scenario, &clock, tiny, PERIOD_MS);

    let evs = event::events_by_type<sub::SubscriptionCreated>();
    assert!(evs.length() == 1, 0);
    let sub_id = evs[0].created_subscription_id();
    // floor 10_000 clamped to amount 5_000 → fee = 5_000 (merchant receives 0).
    assert!(
        evs[0] == sub::created_event_for_testing(
            sub_id, OWNER, MERCHANT, tiny, PERIOD_MS, 500 + PERIOD_MS, tiny, REF,
        ),
        1,
    );
    cleanup(scenario, clock);
}

// === TREASURY REDIRECT ===

#[test]
/// `set_treasury` redirects the fee recipient: the config reflects the new treasury,
/// and a create still settles (the fee leg goes to TREASURY). Proves the admin
/// redirect path is honored.
fun test_set_treasury_redirects_fee() {
    let (mut scenario, mut clock) = begin();
    set_treasury_as_admin(&mut scenario, TREASURY);

    scenario.next_tx(OWNER);
    {
        let config = scenario.take_shared<SubsConfig>();
        assert!(sub::treasury(&config) == TREASURY, 0);
        ts::return_shared(config);
    };

    clock.set_for_testing(500);
    create_as_owner(&mut scenario, &clock, AMOUNT, PERIOD_MS); // settles, fee → TREASURY

    let evs = event::events_by_type<sub::SubscriptionCreated>();
    assert!(evs.length() == 1, 1);

    cleanup(scenario, clock);
}

// === CANCEL ===

#[test]
/// Cancel emits `SubscriptionCancelled` carrying `paid_until_ms`, and the object is
/// gone (no longer takeable from the owner).
fun test_cancel_emits_paid_until_and_destroys() {
    let (mut scenario, mut clock) = begin();
    clock.set_for_testing(2_000);
    create_as_owner(&mut scenario, &clock, AMOUNT, PERIOD_MS);
    let paid_until = 2_000 + PERIOD_MS;

    scenario.next_tx(OWNER);
    let sub_id;
    {
        let s = scenario.take_from_address<Subscription<TUSD>>(OWNER);
        let version = scenario.take_shared<Version>();
        sub_id = object::id(&s);
        sub::cancel<TUSD>(&version, s, scenario.ctx());
        ts::return_shared(version);
    };

    let evs = event::events_by_type<sub::SubscriptionCancelled>();
    assert!(evs.length() == 1, 0);
    assert!(
        evs[0] == sub::cancelled_event_for_testing(sub_id, OWNER, MERCHANT, paid_until, REF),
        1,
    );

    // Object gone: OWNER no longer has one.
    scenario.next_tx(OWNER);
    assert!(!ts::has_most_recent_for_address<Subscription<TUSD>>(OWNER), 2);

    cleanup(scenario, clock);
}

// === ADMIN ===

#[test]
#[expected_failure(abort_code = sub::EInvalidRate)]
/// `set_fee` rejects a rate above 100% (`bps > 10_000`).
fun test_set_fee_rejects_over_100pct() {
    let (mut scenario, clock) = begin();
    scenario.next_tx(OWNER);
    {
        let cap = scenario.take_from_sender<SubsAdminCap>();
        let mut config = scenario.take_shared<SubsConfig>();
        sub::set_fee(&mut config, &cap, 10_001, 0); // aborts EInvalidRate
        ts::return_shared(config);
        scenario.return_to_sender(cap);
    };
    cleanup(scenario, clock);
}

#[test]
/// `set_fee` at a new valid rate + floor is reflected in the config accessors.
fun test_set_fee_updates_config() {
    let (mut scenario, clock) = begin();
    scenario.next_tx(OWNER);
    {
        let cap = scenario.take_from_sender<SubsAdminCap>();
        let mut config = scenario.take_shared<SubsConfig>();
        sub::set_fee(&mut config, &cap, 100, 5_000); // 1%, $0.005 floor
        assert!(sub::fee_bps(&config) == 100, 0);
        assert!(sub::fee_floor(&config) == 5_000, 1);
        ts::return_shared(config);
        scenario.return_to_sender(cap);
    };
    cleanup(scenario, clock);
}

// === VERSION GATE ===

#[test]
#[expected_failure(abort_code = sub::EWrongVersion)]
/// After an emergency `freeze_all` (version → 0), EVERY user entry is fenced: a
/// `create` aborts `EWrongVersion` at the `assert_latest` first line. The admin takes
/// the cap + the shared `Version` and freezes; the subsequent create (via the helper,
/// which now threads `&version`) aborts.
fun test_create_aborts_when_frozen() {
    let (mut scenario, clock) = begin();
    scenario.next_tx(OWNER);
    {
        let cap = scenario.take_from_sender<SubsAdminCap>();
        let mut version = scenario.take_shared<Version>();
        sub::freeze_all(&cap, &mut version);
        ts::return_shared(version);
        scenario.return_to_sender(cap);
    };
    // Now frozen → this create aborts EWrongVersion.
    create_as_owner(&mut scenario, &clock, AMOUNT, PERIOD_MS);
    cleanup(scenario, clock);
}

#[test]
#[expected_failure(abort_code = sub::EWrongVersion)]
/// `migrate` aborts `EWrongVersion` when the shared `Version` is already at
/// `PACKAGE_VERSION` (no double-migrate): at genesis the value is 1, so migrating
/// asserts `value < PACKAGE_VERSION` and fails.
fun test_migrate_rejects_when_current() {
    let (mut scenario, clock) = begin();
    scenario.next_tx(OWNER);
    {
        let cap = scenario.take_from_sender<SubsAdminCap>();
        let mut version = scenario.take_shared<Version>();
        sub::migrate(&cap, &mut version); // already at PACKAGE_VERSION (1) → EWrongVersion
        ts::return_shared(version);
        scenario.return_to_sender(cap);
    };
    cleanup(scenario, clock);
}

#[test]
/// At genesis the shared `Version` is `PACKAGE_VERSION` (1): `assert_latest` passes and
/// `version_value` reads 1.
fun test_version_value_at_genesis() {
    let (mut scenario, clock) = begin();
    scenario.next_tx(OWNER);
    {
        let version = scenario.take_shared<Version>();
        sub::assert_latest(&version);
        assert!(sub::version_value(&version) == 1, 0);
        ts::return_shared(version);
    };
    cleanup(scenario, clock);
}
