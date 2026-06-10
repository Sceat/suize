/// The single global renewal registry: `subscription -> site id`.
///
/// One shared `RenewalRegistry` is created + shared at publish time by `init`.
/// It is the on-chain join between a Suize rail subscription (identified by
/// `SubRef = { account_id, sub_key }` — the payer's `Account` object + its
/// `u64` subscription key) and the `Site` whose Walrus storage that
/// subscription auto-renews. The relayer reads it to know which site to extend
/// after each `charge_subscription` tick.
///
/// Keying BY the subscription (`SubRef`) makes one-subscription-renews-one-site
/// fall out of `Table` key uniqueness — a sub can never fund two sites.
/// Multiple subs pointing at one site is harmless and deliberately unguarded
/// (YAGNI). As in `domain_registry`, the on-chain check is the cap↔site
/// binding, so a `SiteAdminCap` can only ever link a subscription to ITS OWN
/// site, and only unlink an entry that currently points at its own site.
module deploy_sui::renewal_registry;

use deploy_sui::site::{Site, SiteAdminCap};
use deploy_sui::version::Version;
use sui::event;
use sui::table::{Self, Table};

// === Errors ===
// Abort codes are part of this package's public contract: tests pattern-match on
// the exact code. Do NOT renumber.

/// The subscription is already linked to a site. Linking is exclusive —
/// re-pointing a subscription requires an explicit `unlink_renewal` first.
const ERenewalTaken: u64 = 0;
/// The `SiteAdminCap` does not authorize this operation: on `link_renewal` it
/// is not bound to the passed `site`; on `unlink_renewal` it is not bound to
/// the site the subscription currently points at.
const EWrongCap: u64 = 1;
/// `unlink_renewal` was called for a subscription that is not in the registry.
const ENoSuchRenewal: u64 = 2;

// === Structs ===

/// A rail subscription's identity: the payer's `Account` object id + the
/// subscription's `u64` key within that account.
public struct SubRef has copy, drop, store {
    account_id: ID,
    sub_key: u64,
}

/// The one global registry. SHARED so the relayer can read any mapping and the
/// backend can write through its `SiteAdminCap`s. `Table` (dynamic-field
/// backed) keeps on-chain state O(1) per entry and scales past `VecMap`'s
/// linear bounds.
public struct RenewalRegistry has key {
    id: UID,
    subs: Table<SubRef, ID>,
}

// === Events ===

/// Emitted when a subscription is linked to a site's storage renewal.
public struct RenewalLinked has copy, drop {
    site_id: ID,
    account_id: ID,
    sub_key: u64,
}

/// Emitted when a subscription's renewal link is removed.
public struct RenewalUnlinked has copy, drop {
    account_id: ID,
    sub_key: u64,
}

// === Init ===

/// Publish-time setup: create + share the single global `RenewalRegistry`.
fun init(ctx: &mut TxContext) {
    transfer::share_object(RenewalRegistry {
        id: object::new(ctx),
        subs: table::new(ctx),
    });
}

// === Link / unlink ===

/// Link the subscription `{ account_id, sub_key }` to `site`. Asserts the
/// version gate, that `cap` authorizes `site` (`cap.site_id == object::id(site)`),
/// and that the subscription is not already linked; then records the mapping
/// and emits `RenewalLinked`. The subscription's on-chain validity is the
/// rail's concern — this registry only records the join.
public fun link_renewal(
    v: &Version,
    reg: &mut RenewalRegistry,
    cap: &SiteAdminCap,
    site: &Site,
    account_id: ID,
    sub_key: u64,
) {
    v.assert_version();

    let site_id = object::id(site);
    assert!(cap.cap_site_id() == site_id, EWrongCap);
    let sub_ref = SubRef { account_id, sub_key };
    assert!(!reg.subs.contains(sub_ref), ERenewalTaken);

    reg.subs.add(sub_ref, site_id);
    event::emit(RenewalLinked { site_id, account_id, sub_key });
}

/// Unlink the subscription `{ account_id, sub_key }`. Asserts the version gate,
/// that the entry exists, and that `cap` is bound to the site the subscription
/// currently points at (so a cap can only unlink its OWN renewals); then
/// removes the mapping and emits `RenewalUnlinked`.
public fun unlink_renewal(
    v: &Version,
    reg: &mut RenewalRegistry,
    cap: &SiteAdminCap,
    account_id: ID,
    sub_key: u64,
) {
    v.assert_version();

    let sub_ref = SubRef { account_id, sub_key };
    assert!(reg.subs.contains(sub_ref), ENoSuchRenewal);
    let linked_site_id = *reg.subs.borrow(sub_ref);
    assert!(cap.cap_site_id() == linked_site_id, EWrongCap);

    reg.subs.remove(sub_ref);
    event::emit(RenewalUnlinked { account_id, sub_key });
}

// === Read accessors ===

/// Whether the subscription `{ account_id, sub_key }` is currently linked.
public fun contains(reg: &RenewalRegistry, account_id: ID, sub_key: u64): bool {
    reg.subs.contains(SubRef { account_id, sub_key })
}

/// The `Site` id the subscription renews. Aborts (framework) if absent —
/// callers guard with `contains` (the relayer does an existence check before
/// lookup).
public fun site_id_of(reg: &RenewalRegistry, account_id: ID, sub_key: u64): ID {
    *reg.subs.borrow(SubRef { account_id, sub_key })
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
/// Stand up the version gate + the renewal registry + a freshly created site,
/// returning the deployer-held `SiteAdminCap`. Used by the link/unlink tests.
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
fun test_link_renewal_happy_path() {
    let deployer = @0xD;
    let mut scenario = test_scenario::begin(deployer);
    setup(&mut scenario, deployer);
    {
        let v = scenario.take_shared<Version>();
        let mut reg = scenario.take_shared<RenewalRegistry>();
        let cap = scenario.take_from_sender<SiteAdminCap>();
        let site = scenario.take_shared<Site>();

        let account_id = object::id_from_address(@0xACC);
        assert!(!reg.contains(account_id, 1), 0);

        link_renewal(&v, &mut reg, &cap, &site, account_id, 1);

        assert!(reg.contains(account_id, 1), 1);
        assert!(reg.site_id_of(account_id, 1) == object::id(&site), 2);

        test_scenario::return_shared(site);
        scenario.return_to_sender(cap);
        test_scenario::return_shared(reg);
        test_scenario::return_shared(v);
    };
    scenario.end();
}

#[test]
#[expected_failure(abort_code = ERenewalTaken)]
fun test_link_renewal_aborts_when_taken() {
    let deployer = @0xD;
    let mut scenario = test_scenario::begin(deployer);
    setup(&mut scenario, deployer);
    {
        let v = scenario.take_shared<Version>();
        let mut reg = scenario.take_shared<RenewalRegistry>();
        let cap = scenario.take_from_sender<SiteAdminCap>();
        let site = scenario.take_shared<Site>();
        let account_id = object::id_from_address(@0xACC);

        link_renewal(&v, &mut reg, &cap, &site, account_id, 1);
        link_renewal(&v, &mut reg, &cap, &site, account_id, 1); // aborts ERenewalTaken

        test_scenario::return_shared(site);
        scenario.return_to_sender(cap);
        test_scenario::return_shared(reg);
        test_scenario::return_shared(v);
    };
    scenario.end();
}

#[test]
#[expected_failure(abort_code = EWrongCap)]
fun test_link_renewal_aborts_with_wrong_cap() {
    let deployer = @0xD;
    let mut scenario = test_scenario::begin(deployer);
    setup(&mut scenario, deployer);
    {
        let v = scenario.take_shared<Version>();
        let mut reg = scenario.take_shared<RenewalRegistry>();
        let real_cap = scenario.take_from_sender<SiteAdminCap>();
        let site = scenario.take_shared<Site>();

        // Mint a SECOND, unrelated site -> its cap is NOT bound to `site`.
        let wrong_cap = site::create_site(
            &v,
            string::utf8(b"other-site"),
            deployer,
            string::utf8(b"quilt2"),
            string::utf8(b"blob2"),
            b"\x02",
            object::id_from_address(@0xB3),
            object::id_from_address(@0xB4),
            1024,
            7,
            scenario.ctx(),
        );

        // Linking the FIRST site with the SECOND site's cap aborts EWrongCap.
        link_renewal(&v, &mut reg, &wrong_cap, &site, object::id_from_address(@0xACC), 1);

        transfer::public_transfer(wrong_cap, deployer);
        test_scenario::return_shared(site);
        scenario.return_to_sender(real_cap);
        test_scenario::return_shared(reg);
        test_scenario::return_shared(v);
    };
    scenario.end();
}

#[test]
fun test_unlink_renewal_happy_path() {
    let deployer = @0xD;
    let mut scenario = test_scenario::begin(deployer);
    setup(&mut scenario, deployer);
    {
        let v = scenario.take_shared<Version>();
        let mut reg = scenario.take_shared<RenewalRegistry>();
        let cap = scenario.take_from_sender<SiteAdminCap>();
        let site = scenario.take_shared<Site>();
        let account_id = object::id_from_address(@0xACC);

        link_renewal(&v, &mut reg, &cap, &site, account_id, 1);
        assert!(reg.contains(account_id, 1), 0);

        unlink_renewal(&v, &mut reg, &cap, account_id, 1);
        assert!(!reg.contains(account_id, 1), 1);

        test_scenario::return_shared(site);
        scenario.return_to_sender(cap);
        test_scenario::return_shared(reg);
        test_scenario::return_shared(v);
    };
    scenario.end();
}

#[test]
#[expected_failure(abort_code = ENoSuchRenewal)]
fun test_unlink_renewal_aborts_when_missing() {
    let deployer = @0xD;
    let mut scenario = test_scenario::begin(deployer);
    setup(&mut scenario, deployer);
    {
        let v = scenario.take_shared<Version>();
        let mut reg = scenario.take_shared<RenewalRegistry>();
        let cap = scenario.take_from_sender<SiteAdminCap>();

        // Never linked -> aborts ENoSuchRenewal.
        unlink_renewal(&v, &mut reg, &cap, object::id_from_address(@0xACC), 1);

        scenario.return_to_sender(cap);
        test_scenario::return_shared(reg);
        test_scenario::return_shared(v);
    };
    scenario.end();
}

#[test]
#[expected_failure(abort_code = EWrongCap)]
fun test_unlink_renewal_aborts_with_wrong_cap() {
    let deployer = @0xD;
    let mut scenario = test_scenario::begin(deployer);
    setup(&mut scenario, deployer);
    {
        let v = scenario.take_shared<Version>();
        let mut reg = scenario.take_shared<RenewalRegistry>();
        let real_cap = scenario.take_from_sender<SiteAdminCap>();
        let site = scenario.take_shared<Site>();
        let account_id = object::id_from_address(@0xACC);

        link_renewal(&v, &mut reg, &real_cap, &site, account_id, 1);

        // Mint a SECOND, unrelated site -> its cap is NOT bound to the stored id.
        let wrong_cap = site::create_site(
            &v,
            string::utf8(b"other-site"),
            deployer,
            string::utf8(b"quilt2"),
            string::utf8(b"blob2"),
            b"\x02",
            object::id_from_address(@0xB3),
            object::id_from_address(@0xB4),
            1024,
            7,
            scenario.ctx(),
        );

        // Unlinking with the SECOND site's cap aborts EWrongCap.
        unlink_renewal(&v, &mut reg, &wrong_cap, account_id, 1);

        transfer::public_transfer(wrong_cap, deployer);
        test_scenario::return_shared(site);
        scenario.return_to_sender(real_cap);
        test_scenario::return_shared(reg);
        test_scenario::return_shared(v);
    };
    scenario.end();
}
