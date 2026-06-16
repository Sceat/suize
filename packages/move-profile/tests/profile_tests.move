#[test_only]
/// Tests for `profile::profile` — the Business Profile NFT.
///
/// Headline guarantees: a paid create mints a soulbound `BusinessProfile` to the business +
/// emits `ProfileCreated`; a wrong fee / wrong coin / over-long field aborts before any object
/// exists; the owner can edit (paying again); the version gate freezes + migrates correctly.
///
/// Abort-code constants are referenced by fully-qualified path in
/// `#[expected_failure(abort_code = ...)]` (importing would only warn "unused alias").
module profile::profile_tests;

use profile::profile::{Self as prof, BusinessProfile, ProfileConfig, ProfileAdminCap, Version};
use std::string;
use sui::balance;
use sui::event;
use sui::test_scenario::{Self as ts, Scenario};

// === Test coin types ===
public struct USDC has drop {}
public struct WRONG has drop {}

// === Actors / fixtures ===
const OWNER: address = @0xA; // publisher / admin / treasury default
const BIZ: address = @0xB;
const FEE: u64 = 100_000; // $0.10

const NAME: vector<u8> = b"Acme AI";
const DESC: vector<u8> = b"Production-grade agents for any workflow.";
const LOGO: vector<u8> = b"https://logo.example/acme.png";
const BANNER: vector<u8> = b"https://banner.example/acme.png";
const SITE: vector<u8> = b"https://acme.example";

// === Helpers ===

/// Publish (init), then PIN the settlement coin to USDC (production pins USDC after publish).
fun begin(): Scenario {
    let mut s = ts::begin(OWNER);
    s.next_tx(OWNER);
    prof::init_for_testing(s.ctx());
    s.next_tx(OWNER);
    {
        let cap = s.take_from_sender<ProfileAdminCap>();
        let mut config = s.take_shared<ProfileConfig>();
        prof::set_coin_type<USDC>(&mut config, &cap);
        ts::return_shared(config);
        s.return_to_sender(cap);
    };
    s
}

fun pay(n: u64): balance::Balance<USDC> { balance::create_for_testing<USDC>(n) }
fun pay_wrong(n: u64): balance::Balance<WRONG> { balance::create_for_testing<WRONG>(n) }

/// As `who`, create a profile paying `payment` USDC.
fun create_as(s: &mut Scenario, who: address, payment: balance::Balance<USDC>) {
    s.next_tx(who);
    let version = s.take_shared<Version>();
    let config = s.take_shared<ProfileConfig>();
    prof::create_profile<USDC>(
        &version,
        &config,
        payment,
        string::utf8(NAME),
        string::utf8(DESC),
        string::utf8(LOGO),
        string::utf8(BANNER),
        string::utf8(SITE),
        s.ctx(),
    );
    ts::return_shared(config);
    ts::return_shared(version);
}

// === CREATE ===

#[test]
fun test_create_happy_and_event() {
    let mut s = begin();
    create_as(&mut s, BIZ, pay(FEE));

    let evs = event::events_by_type<prof::ProfileCreated>();
    assert!(evs.length() == 1, 0);

    s.next_tx(BIZ);
    {
        let p = s.take_from_sender<BusinessProfile>();
        assert!(prof::owner(&p) == BIZ, 1);
        assert!(prof::name(&p) == string::utf8(NAME), 2);
        assert!(prof::image_url(&p) == string::utf8(LOGO), 3);
        assert!(prof::banner_url(&p) == string::utf8(BANNER), 4);
        assert!(prof::website(&p) == string::utf8(SITE), 5);
        s.return_to_sender(p);
    };
    s.end();
}

#[test]
#[expected_failure(abort_code = prof::EWrongFee)]
fun test_create_wrong_fee_aborts() {
    let mut s = begin();
    create_as(&mut s, BIZ, pay(FEE + 1)); // over-pays → EWrongFee
    s.end();
}

#[test]
#[expected_failure(abort_code = prof::EWrongCoin)]
fun test_create_wrong_coin_aborts() {
    let mut s = begin();
    s.next_tx(BIZ);
    let version = s.take_shared<Version>();
    let config = s.take_shared<ProfileConfig>();
    prof::create_profile<WRONG>(
        &version,
        &config,
        pay_wrong(FEE),
        string::utf8(NAME),
        string::utf8(DESC),
        string::utf8(LOGO),
        string::utf8(BANNER),
        string::utf8(SITE),
        s.ctx(),
    );
    ts::return_shared(config);
    ts::return_shared(version);
    s.end();
}

#[test]
#[expected_failure(abort_code = prof::EBadField)]
fun test_create_overlong_name_aborts() {
    let mut s = begin();
    s.next_tx(BIZ);
    let version = s.take_shared<Version>();
    let config = s.take_shared<ProfileConfig>();
    let mut long = vector::empty<u8>();
    let mut i = 0u64;
    while (i < 257) { long.push_back(65); i = i + 1; }; // 257 bytes > MAX_FIELD_LEN (256)
    prof::create_profile<USDC>(
        &version,
        &config,
        pay(FEE),
        string::utf8(long),
        string::utf8(DESC),
        string::utf8(LOGO),
        string::utf8(BANNER),
        string::utf8(SITE),
        s.ctx(),
    );
    ts::return_shared(config);
    ts::return_shared(version);
    s.end();
}

// === EDIT ===

#[test]
fun test_edit_happy_replaces_fields() {
    let mut s = begin();
    create_as(&mut s, BIZ, pay(FEE));

    s.next_tx(BIZ);
    {
        let version = s.take_shared<Version>();
        let config = s.take_shared<ProfileConfig>();
        let mut p = s.take_from_sender<BusinessProfile>();
        prof::edit_profile<USDC>(
            &version,
            &config,
            &mut p,
            pay(FEE),
            string::utf8(b"Acme v2"),
            string::utf8(b"now with more agents"),
            string::utf8(b"https://logo2.example"),
            string::utf8(b"https://banner2.example"),
            string::utf8(b"https://acme-v2.example"),
            s.ctx(),
        );
        assert!(prof::name(&p) == string::utf8(b"Acme v2"), 0);
        assert!(prof::website(&p) == string::utf8(b"https://acme-v2.example"), 1);
        assert!(prof::owner(&p) == BIZ, 2);
        s.return_to_sender(p);
        ts::return_shared(config);
        ts::return_shared(version);
    };
    s.end();
}

#[test]
#[expected_failure(abort_code = prof::EWrongFee)]
fun test_edit_wrong_fee_aborts() {
    let mut s = begin();
    create_as(&mut s, BIZ, pay(FEE));
    s.next_tx(BIZ);
    {
        let version = s.take_shared<Version>();
        let config = s.take_shared<ProfileConfig>();
        let mut p = s.take_from_sender<BusinessProfile>();
        prof::edit_profile<USDC>(
            &version,
            &config,
            &mut p,
            pay(FEE - 1), // under-pays → EWrongFee
            string::utf8(b"x"),
            string::utf8(b"y"),
            string::utf8(b"https://z"),
            string::utf8(b"https://w"),
            string::utf8(b"https://v"),
            s.ctx(),
        );
        s.return_to_sender(p);
        ts::return_shared(config);
        ts::return_shared(version);
    };
    s.end();
}

// === ADMIN / VERSION ===

#[test]
fun test_set_fee_then_create_at_new_fee() {
    let mut s = begin();
    s.next_tx(OWNER);
    {
        let cap = s.take_from_sender<ProfileAdminCap>();
        let mut config = s.take_shared<ProfileConfig>();
        prof::set_fee(&mut config, &cap, 250_000); // $0.25
        assert!(prof::fee(&config) == 250_000, 0);
        ts::return_shared(config);
        s.return_to_sender(cap);
    };
    create_as(&mut s, BIZ, pay(250_000)); // must pay the new fee
    let evs = event::events_by_type<prof::ProfileCreated>();
    assert!(evs.length() == 1, 1);
    s.end();
}

#[test]
#[expected_failure(abort_code = prof::EWrongVersion)]
fun test_freeze_blocks_create() {
    let mut s = begin();
    s.next_tx(OWNER);
    {
        let cap = s.take_from_sender<ProfileAdminCap>();
        let mut version = s.take_shared<Version>();
        prof::freeze_all(&cap, &mut version);
        ts::return_shared(version);
        s.return_to_sender(cap);
    };
    create_as(&mut s, BIZ, pay(FEE)); // aborts EWrongVersion
    s.end();
}

#[test]
#[expected_failure(abort_code = prof::EWrongVersion)]
fun test_migrate_rejects_when_current() {
    let mut s = begin();
    s.next_tx(OWNER);
    {
        let cap = s.take_from_sender<ProfileAdminCap>();
        let mut version = s.take_shared<Version>();
        prof::migrate(&cap, &mut version); // already v1 → aborts
        ts::return_shared(version);
        s.return_to_sender(cap);
    };
    s.end();
}

#[test]
fun test_version_value_at_genesis() {
    let mut s = begin();
    s.next_tx(OWNER);
    {
        let version = s.take_shared<Version>();
        prof::assert_latest(&version);
        assert!(prof::version_value(&version) == 1, 0);
        ts::return_shared(version);
    };
    s.end();
}
