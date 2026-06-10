/// The single global single-use charge ledger: `charge tx digest -> site id`.
///
/// One shared `ChargeLedger` is created + shared at publish time by `init`; the
/// `LedgerCap` goes to the publisher (the deploy service wallet). Every paid
/// deploy burns its $0.50 charge digest here, so replay protection is on-chain
/// physics (`Table` key uniqueness) instead of in-memory state — it holds across
/// backend restarts and replicas.
///
/// WHY THE CAP GATE: charge digests are public on-chain the moment the charge
/// settles. An ungated ledger would let an attacker front-run RECORDING a
/// victim's digest (pointing it at the attacker's own site) before the victim's
/// deploy PTB lands, bricking the paid deploy. `LedgerCap`-gating means only the
/// deploy service wallet writes; `Table` key uniqueness is the replay physics.
///
/// Intended deploy PTB:
///   let cap = site::create_site(...);
///   charge_ledger::record_charge(v, ledger, ledger_cap, &cap, digest);
///   transfer cap;
module deploy_sui::charge_ledger;

use deploy_sui::site::SiteAdminCap;
use deploy_sui::version::Version;
use std::string::String;
use sui::event;
use sui::table::{Self, Table};

// === Errors ===
// Abort codes are part of this package's public contract: tests pattern-match on
// the exact code. Do NOT renumber.

/// The charge digest is already recorded — each charge pays for exactly one
/// deploy, ever.
const EChargeAlreadyUsed: u64 = 0;

// === Structs ===

/// Capability gating writes to the `ChargeLedger`. Held by the deploy service
/// wallet — the only writer (see the module doc for why the gate exists).
/// `store` so the backend can custody it.
public struct LedgerCap has key, store {
    id: UID,
}

/// The one global ledger. SHARED so anyone can read whether a digest was
/// consumed, while writes stay `LedgerCap`-gated. `Table` (dynamic-field backed)
/// keeps on-chain state O(1) per entry and scales past `VecMap`'s linear bounds.
public struct ChargeLedger has key {
    id: UID,
    charges: Table<String, ID>,
}

// === Events ===

/// Emitted when a charge digest is consumed by a deploy.
public struct ChargeRecorded has copy, drop {
    digest: String,
    site_id: ID,
}

// === Init ===

/// Publish-time setup: create + share the single global `ChargeLedger`, and
/// hand the `LedgerCap` to the publisher (the deploy service wallet).
fun init(ctx: &mut TxContext) {
    transfer::share_object(ChargeLedger {
        id: object::new(ctx),
        charges: table::new(ctx),
    });
    transfer::transfer(LedgerCap { id: object::new(ctx) }, ctx.sender());
}

// === Record ===

/// Consume `digest` for the site `site_cap` is bound to. Asserts the version
/// gate and that the digest was never used (`EChargeAlreadyUsed`); then records
/// `digest -> site id` and emits `ChargeRecorded`. Write access is the
/// `LedgerCap` itself — possession IS the auth, no further check needed.
public fun record_charge(
    v: &Version,
    ledger: &mut ChargeLedger,
    _cap: &LedgerCap,
    site_cap: &SiteAdminCap,
    digest: String,
) {
    v.assert_version();

    assert!(!ledger.charges.contains(digest), EChargeAlreadyUsed);

    let site_id = site_cap.cap_site_id();
    ledger.charges.add(digest, site_id);
    event::emit(ChargeRecorded { digest, site_id });
}

// === Read accessors ===

/// Whether `digest` was already consumed by a deploy.
public fun is_used(ledger: &ChargeLedger, digest: &String): bool {
    ledger.charges.contains(*digest)
}

/// The `Site` id `digest` paid for. Aborts (framework) if absent — callers
/// guard with `is_used` first.
public fun site_for_charge(ledger: &ChargeLedger, digest: &String): ID {
    *ledger.charges.borrow(*digest)
}

// === Tests ===

#[test_only]
use sui::test_scenario;
#[test_only]
use deploy_sui::site;
#[test_only]
use deploy_sui::version;
#[test_only]
use std::string;

#[test_only]
/// Stand up the version gate + the charge ledger (+ its cap) + a freshly created
/// site, leaving the `SiteAdminCap` and `LedgerCap` with the deployer.
fun setup(scenario: &mut test_scenario::Scenario, deployer: address) {
    { version::init_for_testing(scenario.ctx()); };
    scenario.next_tx(deployer);
    { init(scenario.ctx()); };
    scenario.next_tx(deployer);
    {
        let v = scenario.take_shared<Version>();
        let cap = site::create_site(
            &v,
            string::utf8(b"my-site"),
            deployer,
            string::utf8(b"quilt"),
            string::utf8(b"blob"),
            b"\x01",
            object::id_from_address(@0xB1),
            object::id_from_address(@0xB2),
            1024,
            7,
            scenario.ctx(),
        );
        transfer::public_transfer(cap, deployer);
        test_scenario::return_shared(v);
    };
    scenario.next_tx(deployer);
}

#[test]
fun test_record_charge_happy_path() {
    let deployer = @0xD;
    let mut scenario = test_scenario::begin(deployer);
    setup(&mut scenario, deployer);
    {
        let v = scenario.take_shared<Version>();
        let mut ledger = scenario.take_shared<ChargeLedger>();
        let ledger_cap = scenario.take_from_sender<LedgerCap>();
        let site_cap = scenario.take_from_sender<SiteAdminCap>();

        let digest = string::utf8(b"DigestAbc123");
        assert!(!ledger.is_used(&digest), 0);

        record_charge(&v, &mut ledger, &ledger_cap, &site_cap, digest);

        assert!(ledger.is_used(&digest), 1);
        assert!(ledger.site_for_charge(&digest) == site_cap.cap_site_id(), 2);

        scenario.return_to_sender(site_cap);
        scenario.return_to_sender(ledger_cap);
        test_scenario::return_shared(ledger);
        test_scenario::return_shared(v);
    };
    scenario.end();
}

#[test]
#[expected_failure(abort_code = EChargeAlreadyUsed)]
fun test_record_charge_aborts_when_digest_used() {
    let deployer = @0xD;
    let mut scenario = test_scenario::begin(deployer);
    setup(&mut scenario, deployer);
    {
        let v = scenario.take_shared<Version>();
        let mut ledger = scenario.take_shared<ChargeLedger>();
        let ledger_cap = scenario.take_from_sender<LedgerCap>();
        let site_cap = scenario.take_from_sender<SiteAdminCap>();
        let digest = string::utf8(b"DigestAbc123");

        record_charge(&v, &mut ledger, &ledger_cap, &site_cap, digest);
        record_charge(&v, &mut ledger, &ledger_cap, &site_cap, digest); // aborts EChargeAlreadyUsed

        scenario.return_to_sender(site_cap);
        scenario.return_to_sender(ledger_cap);
        test_scenario::return_shared(ledger);
        test_scenario::return_shared(v);
    };
    scenario.end();
}
