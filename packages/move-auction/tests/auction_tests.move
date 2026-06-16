#[test_only]
/// Tests for `auction::auction` — the on-chain ad-slot auction (King-of-the-Hill).
///
/// Headline guarantees under test:
///   CREATE  — a slot is genesis-held by the directory at its start price; the
///             `SlotCreated` event is correct; an empty name / zero price abort
///             `EBadSlot` before the object exists.
///   BID     — a strictly-higher bid takes the slot, ratchets `price`/`holder`,
///             and emits a correct `BidPlaced`; a bid at-or-below the
///             standing price aborts `EBidTooLow`; two bids ratchet in order.
///   FEE     — the configured rate is applied (default 2%, a custom 3%, and the
///             $0.01 floor when the percentage is tiny); a wrong (unpinned) coin
///             aborts `EWrongCoin`.
///   ADMIN   — `set_fee` rejects `bps > 10_000` (`EInvalidRate`); `set_treasury` /
///             `set_directory` are honored.
///
/// Abort-code constants are referenced by fully-qualified path in
/// `#[expected_failure(abort_code = ...)]` (importing would only warn "unused alias").
module auction::auction_tests;

use auction::auction::{Self as auc, AdSlot, AuctionConfig, AuctionAdminCap, Version};
use std::string;
use sui::balance;
use sui::clock::{Self, Clock};
use sui::event;
use sui::test_scenario::{Self as ts, Scenario};

// === Test coin types ===
/// A bare witness to instantiate `Balance<TUSD>` (stands in for USDC).
public struct TUSD has drop {}
/// A SECOND throwaway coin — the "wrong" settlement coin for the coin-pin test.
public struct WRONG has drop {}

// === Test actors ===
const OWNER: address = @0xA; // publisher / admin (default treasury + directory after init)
const TREASURY: address = @0xE; // redirected fee recipient
const DIRECTORY: address = @0xD; // redirected slot-proceeds recipient
const BIDDER1: address = @0xB;
const BIDDER2: address = @0xC;

// === Test fixtures ===
const START: u64 = 50_000_000; // $50 genesis slot price
const NAME: vector<u8> = b"hero";

// === Helpers ===

/// Start as OWNER, publish (shared `AuctionConfig` + `AuctionAdminCap` to OWNER), and
/// PIN the settlement coin to TUSD — production pins the coin before any slot exists
/// (`create_slot` now aborts `ECoinUnpinned` otherwise). Clock fixed at t=0. Default
/// treasury + directory after init are the publisher.
fun begin(): (Scenario, Clock) {
    let mut scenario = ts::begin(OWNER);
    let clock = clock::create_for_testing(scenario.ctx());
    scenario.next_tx(OWNER);
    auc::init_for_testing(scenario.ctx());
    pin_coin_as_admin<TUSD>(&mut scenario);
    (scenario, clock)
}

fun cleanup(scenario: Scenario, clock: Clock) {
    clock::destroy_for_testing(clock);
    scenario.end();
}

/// Mint exactly `amount` TUSD as a `Balance` for a push bid.
fun pay(amount: u64): balance::Balance<TUSD> {
    balance::create_for_testing<TUSD>(amount)
}

/// Mint `amount` of the WRONG coin (for the coin-pin reject test).
fun pay_wrong(amount: u64): balance::Balance<WRONG> {
    balance::create_for_testing<WRONG>(amount)
}

/// As OWNER (admin), create + share a slot at `start_price`.
fun create_slot_as_admin(scenario: &mut Scenario, name: vector<u8>, start_price: u64) {
    scenario.next_tx(OWNER);
    let cap = scenario.take_from_sender<AuctionAdminCap>();
    let config = scenario.take_shared<AuctionConfig>();
    let version = scenario.take_shared<Version>();
    auc::create_slot(&version, &config, &cap, string::utf8(name), start_price, scenario.ctx());
    ts::return_shared(version);
    ts::return_shared(config);
    scenario.return_to_sender(cap);
}

/// As `who`, bid `amount` TUSD on the (single) shared slot.
fun bid_as(scenario: &mut Scenario, who: address, clock: &Clock, amount: u64) {
    scenario.next_tx(who);
    let mut slot = scenario.take_shared<AdSlot>();
    let config = scenario.take_shared<AuctionConfig>();
    let version = scenario.take_shared<Version>();
    auc::bid<TUSD>(&version, &mut slot, &config, pay(amount), clock, scenario.ctx());
    ts::return_shared(version);
    ts::return_shared(config);
    ts::return_shared(slot);
}

/// As OWNER, set the fee rate + floor via the admin cap.
fun set_fee_as_admin(scenario: &mut Scenario, bps: u16, floor: u64) {
    scenario.next_tx(OWNER);
    let cap = scenario.take_from_sender<AuctionAdminCap>();
    let mut config = scenario.take_shared<AuctionConfig>();
    auc::set_fee(&mut config, &cap, bps, floor);
    ts::return_shared(config);
    scenario.return_to_sender(cap);
}

/// As OWNER, pin the settlement coin to `T`.
fun pin_coin_as_admin<T>(scenario: &mut Scenario) {
    scenario.next_tx(OWNER);
    let cap = scenario.take_from_sender<AuctionAdminCap>();
    let mut config = scenario.take_shared<AuctionConfig>();
    auc::set_coin_type<T>(&mut config, &cap);
    ts::return_shared(config);
    scenario.return_to_sender(cap);
}

// === CREATE ===

#[test]
/// Happy path: the slot is genesis-held by the directory (OWNER by default) at START,
/// the `SlotCreated` event is correct, and the object reflects the terms.
fun test_create_slot_happy_and_event() {
    let (mut scenario, clock) = begin();
    create_slot_as_admin(&mut scenario, NAME, START);

    let evs = event::events_by_type<auc::SlotCreated>();
    assert!(evs.length() == 1, 0);
    let slot_id = evs[0].created_slot_id();
    assert!(
        evs[0] == auc::slot_created_event_for_testing(slot_id, string::utf8(NAME), START, OWNER),
        1,
    );

    scenario.next_tx(OWNER);
    {
        let slot = scenario.take_shared<AdSlot>();
        assert!(object::id(&slot) == slot_id, 2);
        assert!(auc::name(&slot) == string::utf8(NAME), 3);
        assert!(auc::price(&slot) == START, 4);
        assert!(auc::holder(&slot) == OWNER, 5);
        assert!(auc::last_bid_ms(&slot) == 0, 6);
        ts::return_shared(slot);
    };

    cleanup(scenario, clock);
}

#[test]
#[expected_failure(abort_code = auc::EBadSlot)]
/// Zero start price → `EBadSlot`.
fun test_create_slot_zero_price_aborts() {
    let (mut scenario, clock) = begin();
    create_slot_as_admin(&mut scenario, NAME, 0);
    cleanup(scenario, clock);
}

#[test]
#[expected_failure(abort_code = auc::EBadSlot)]
/// Empty name → `EBadSlot`.
fun test_create_slot_empty_name_aborts() {
    let (mut scenario, clock) = begin();
    create_slot_as_admin(&mut scenario, b"", START);
    cleanup(scenario, clock);
}

// === BID ===

#[test]
/// A strictly-higher bid takes the slot: ratchets price/holder, emits a
/// correct `BidPlaced` with the 2% fee, and the object reflects the new state.
fun test_bid_happy_ratchets_and_event() {
    let (mut scenario, mut clock) = begin();
    create_slot_as_admin(&mut scenario, NAME, START);

    clock.set_for_testing(1_000_000);
    let new_price = 60_000_000; // $60 > $50
    bid_as(&mut scenario, BIDDER1, &clock, new_price);

    let fee = (new_price * 200) / 10_000; // 2% = 1_200_000
    let evs = event::events_by_type<auc::BidPlaced>();
    assert!(evs.length() == 1, 0);
    let slot_id = evs[0].bid_slot_id();
    assert!(
        evs[0] == auc::bid_event_for_testing(
            slot_id, string::utf8(NAME), BIDDER1, new_price, fee, 1_000_000,
        ),
        1,
    );

    scenario.next_tx(BIDDER1);
    {
        let slot = scenario.take_shared<AdSlot>();
        assert!(auc::price(&slot) == new_price, 2);
        assert!(auc::holder(&slot) == BIDDER1, 3);
        assert!(auc::last_bid_ms(&slot) == 1_000_000, 4);
        ts::return_shared(slot);
    };

    cleanup(scenario, clock);
}

#[test]
#[expected_failure(abort_code = auc::EBidTooLow)]
/// A bid EQUAL to the standing price → `EBidTooLow` (must strictly exceed).
fun test_bid_at_price_aborts() {
    let (mut scenario, clock) = begin();
    create_slot_as_admin(&mut scenario, NAME, START);
    bid_as(&mut scenario, BIDDER1, &clock, START);
    cleanup(scenario, clock);
}

#[test]
#[expected_failure(abort_code = auc::EBidTooLow)]
/// A bid BELOW the standing price → `EBidTooLow`.
fun test_bid_below_price_aborts() {
    let (mut scenario, clock) = begin();
    create_slot_as_admin(&mut scenario, NAME, START);
    bid_as(&mut scenario, BIDDER1, &clock, START - 1);
    cleanup(scenario, clock);
}

#[test]
/// Two bids ratchet in order: the higher second bid takes the slot from the first.
fun test_two_bids_ratchet() {
    let (mut scenario, clock) = begin();
    create_slot_as_admin(&mut scenario, NAME, START);

    bid_as(&mut scenario, BIDDER1, &clock, 60_000_000);
    bid_as(&mut scenario, BIDDER2, &clock, 70_000_000);

    scenario.next_tx(BIDDER2);
    {
        let slot = scenario.take_shared<AdSlot>();
        assert!(auc::price(&slot) == 70_000_000, 0);
        assert!(auc::holder(&slot) == BIDDER2, 1);
        ts::return_shared(slot);
    };

    cleanup(scenario, clock);
}

// === FEE ===

#[test]
/// A custom (non-2%) rate is applied: 3% on a $100 bid → fee = 3_000_000.
fun test_bid_custom_rate() {
    let (mut scenario, clock) = begin();
    create_slot_as_admin(&mut scenario, NAME, START);
    set_fee_as_admin(&mut scenario, 300, 10_000); // 3%

    bid_as(&mut scenario, BIDDER1, &clock, 100_000_000);

    let evs = event::events_by_type<auc::BidPlaced>();
    assert!(evs.length() == 1, 0);
    let slot_id = evs[0].bid_slot_id();
    assert!(
        evs[0] == auc::bid_event_for_testing(
            slot_id, string::utf8(NAME), BIDDER1, 100_000_000, 3_000_000, 0,
        ),
        1,
    );

    cleanup(scenario, clock);
}

#[test]
/// The $0.01 floor applies when the percentage is tiny: 1 bps on a $2 bid → pct = 200,
/// floored to 10_000 (and 10_000 < bid, so the floor — not the clamp — is the fee).
fun test_bid_fee_floor_applies() {
    let (mut scenario, clock) = begin();
    create_slot_as_admin(&mut scenario, NAME, 1_000_000); // $1 start
    set_fee_as_admin(&mut scenario, 1, 10_000); // 0.01% rate, $0.01 floor

    bid_as(&mut scenario, BIDDER1, &clock, 2_000_000); // $2 bid

    let evs = event::events_by_type<auc::BidPlaced>();
    assert!(evs.length() == 1, 0);
    // pct = 2_000_000 * 1 / 10_000 = 200; floored to 10_000; 10_000 < 2_000_000 → fee = 10_000.
    assert!(evs[0].bid_fee_for_testing() == 10_000, 1);

    cleanup(scenario, clock);
}

#[test]
#[expected_failure(abort_code = auc::EWrongCoin)]
/// Once the coin is pinned to TUSD, a bid in a DIFFERENT coin aborts `EWrongCoin`
/// (even though it strictly exceeds the price).
fun test_bid_wrong_coin_aborts() {
    let (mut scenario, clock) = begin();
    create_slot_as_admin(&mut scenario, NAME, START);
    pin_coin_as_admin<TUSD>(&mut scenario);

    scenario.next_tx(BIDDER1);
    let mut slot = scenario.take_shared<AdSlot>();
    let config = scenario.take_shared<AuctionConfig>();
    let version = scenario.take_shared<Version>();
    auc::bid<WRONG>(&version, &mut slot, &config, pay_wrong(60_000_000), &clock, scenario.ctx());
    ts::return_shared(version);
    ts::return_shared(config);
    ts::return_shared(slot);

    cleanup(scenario, clock);
}

#[test]
/// After pinning TUSD, a TUSD bid still works (the pin allows the right coin).
fun test_bid_pinned_coin_ok() {
    let (mut scenario, clock) = begin();
    create_slot_as_admin(&mut scenario, NAME, START);
    pin_coin_as_admin<TUSD>(&mut scenario);

    bid_as(&mut scenario, BIDDER1, &clock, 60_000_000);

    scenario.next_tx(BIDDER1);
    {
        let slot = scenario.take_shared<AdSlot>();
        assert!(auc::holder(&slot) == BIDDER1, 0);
        ts::return_shared(slot);
    };

    cleanup(scenario, clock);
}

// === ADMIN ===

#[test]
#[expected_failure(abort_code = auc::EInvalidRate)]
/// `set_fee` rejects a rate above 100% (`bps > 10_000`).
fun test_set_fee_rejects_over_100pct() {
    let (mut scenario, clock) = begin();
    set_fee_as_admin(&mut scenario, 10_001, 0);
    cleanup(scenario, clock);
}

#[test]
/// `set_fee` at a new valid rate + floor is reflected in the config accessors.
fun test_set_fee_updates_config() {
    let (mut scenario, clock) = begin();
    set_fee_as_admin(&mut scenario, 100, 5_000); // 1%, $0.005 floor

    scenario.next_tx(OWNER);
    {
        let config = scenario.take_shared<AuctionConfig>();
        assert!(auc::fee_bps(&config) == 100, 0);
        assert!(auc::fee_floor(&config) == 5_000, 1);
        ts::return_shared(config);
    };

    cleanup(scenario, clock);
}

#[test]
/// `set_treasury` + `set_directory` redirect the two payout legs: the config reflects
/// the new addresses, and a fresh slot is genesis-held by the new directory.
fun test_set_treasury_and_directory_redirect() {
    let (mut scenario, clock) = begin();

    scenario.next_tx(OWNER);
    {
        let cap = scenario.take_from_sender<AuctionAdminCap>();
        let mut config = scenario.take_shared<AuctionConfig>();
        auc::set_treasury(&mut config, &cap, TREASURY);
        auc::set_directory(&mut config, &cap, DIRECTORY);
        assert!(auc::treasury(&config) == TREASURY, 0);
        assert!(auc::directory(&config) == DIRECTORY, 1);
        ts::return_shared(config);
        scenario.return_to_sender(cap);
    };

    // A slot created now is genesis-held by the new directory.
    create_slot_as_admin(&mut scenario, NAME, START);
    scenario.next_tx(OWNER);
    {
        let slot = scenario.take_shared<AdSlot>();
        assert!(auc::holder(&slot) == DIRECTORY, 2);
        ts::return_shared(slot);
    };

    // A bid still settles (fee → TREASURY, net → DIRECTORY).
    bid_as(&mut scenario, BIDDER1, &clock, 60_000_000);
    let evs = event::events_by_type<auc::BidPlaced>();
    assert!(evs.length() == 1, 3);

    cleanup(scenario, clock);
}

// === Coin-pin invariant + footgun guards (review fixes 2026-06-14) ===

#[test]
#[expected_failure(abort_code = auc::ECoinUnpinned)]
/// `create_slot` BEFORE the settlement coin is pinned aborts `ECoinUnpinned` — a slot
/// can never exist while a bid could be paid in an ARBITRARY coin (this is the on-chain
/// invariant that closes the junk-coin take-without-paying window; uses a raw init, NOT
/// begin(), which pins).
fun test_create_slot_unpinned_aborts() {
    let mut scenario = ts::begin(OWNER);
    let clock = clock::create_for_testing(scenario.ctx());
    scenario.next_tx(OWNER);
    auc::init_for_testing(scenario.ctx()); // NO pin
    create_slot_as_admin(&mut scenario, NAME, START); // aborts ECoinUnpinned
    cleanup(scenario, clock);
}

#[test]
#[expected_failure(abort_code = auc::EInvalidRate)]
/// `set_fee` rejects EXACTLY 100% (`bps == 10_000`) — the directory must keep a positive net leg.
fun test_set_fee_rejects_exactly_100pct() {
    let (mut scenario, clock) = begin();
    set_fee_as_admin(&mut scenario, 10_000, 0);
    cleanup(scenario, clock);
}

// === VERSION GATE ===

#[test]
#[expected_failure(abort_code = auc::EWrongVersion)]
/// After an emergency `freeze_all`, a version-gated entry (`bid`) aborts `EWrongVersion`.
fun test_bid_aborts_when_frozen() {
    let (mut scenario, clock) = begin();
    create_slot_as_admin(&mut scenario, NAME, START);
    scenario.next_tx(OWNER);
    {
        let cap = scenario.take_from_sender<AuctionAdminCap>();
        let mut version = scenario.take_shared<Version>();
        auc::freeze_all(&cap, &mut version);
        ts::return_shared(version);
        scenario.return_to_sender(cap);
    };
    bid_as(&mut scenario, BIDDER1, &clock, 60_000_000); // aborts EWrongVersion
    cleanup(scenario, clock);
}

#[test]
#[expected_failure(abort_code = auc::EWrongVersion)]
/// `migrate` rejects when the version is ALREADY current — no double-migrate.
fun test_migrate_rejects_when_current() {
    let (mut scenario, clock) = begin();
    scenario.next_tx(OWNER);
    {
        let cap = scenario.take_from_sender<AuctionAdminCap>();
        let mut version = scenario.take_shared<Version>();
        auc::migrate(&cap, &mut version); // already == PACKAGE_VERSION → aborts EWrongVersion
        ts::return_shared(version);
        scenario.return_to_sender(cap);
    };
    cleanup(scenario, clock);
}

#[test]
/// `assert_latest` passes at the genesis version, and `version_value` reads it (= 1).
fun test_version_value_at_genesis() {
    let (mut scenario, clock) = begin();
    scenario.next_tx(OWNER);
    {
        let version = scenario.take_shared<Version>();
        auc::assert_latest(&version);
        assert!(auc::version_value(&version) == 1, 0);
        ts::return_shared(version);
    };
    cleanup(scenario, clock);
}
