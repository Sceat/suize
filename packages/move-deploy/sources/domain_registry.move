/// The single global custom-domain registry: `domain -> site id`.
///
/// One shared `DomainRegistry` is created + shared at publish time by `init`.
/// The Cloudflare worker resolves a custom domain (e.g. `example.com`) by
/// looking it up here to find the `Site` id to serve. DNS ownership is verified
/// OFF-CHAIN by the backend (a `_suize-verify` TXT challenge) BEFORE it calls
/// `link_domain`; the on-chain check is the cap↔site binding, so a `SiteAdminCap`
/// can only ever map a domain to ITS OWN site, and only unlink a domain that
/// currently points at its own site.
///
/// The `SiteAdminCap` is backend-held (the deploy service wallet is the only
/// writer), so in the MVP these are operator calls, not user-facing.
module deploy_sui::domain_registry;

use deploy_sui::site::{Self, Site, SiteAdminCap};
use deploy_sui::version::Version;
use std::string::String;
use sui::event;
use sui::table::{Self, Table};

// === Errors ===
// Abort codes are part of this package's public contract: tests pattern-match on
// the exact code. Do NOT renumber.

/// The domain is already linked to a site. Linking is exclusive — re-pointing a
/// domain requires an explicit `unlink_domain` first.
const EDomainTaken: u64 = 0;
/// The `SiteAdminCap` does not authorize this operation: on `link_domain` it is
/// not bound to the passed `site`; on `unlink_domain` it is not bound to the
/// site the domain currently points at.
const EWrongCap: u64 = 1;
/// `unlink_domain` was called for a domain that is not in the registry.
const ENoSuchDomain: u64 = 2;

// === Structs ===

/// The one global registry. SHARED so the worker can read any mapping and the
/// backend can write through its `SiteAdminCap`s. `Table` (dynamic-field backed)
/// keeps on-chain state O(1) per entry and scales past `VecMap`'s linear bounds.
public struct DomainRegistry has key {
    id: UID,
    domains: Table<String, ID>,
}

// === Events ===

/// Emitted when a custom domain is linked to a site.
public struct DomainLinked has copy, drop {
    domain: String,
    site_id: ID,
}

/// Emitted when a custom domain is unlinked.
public struct DomainUnlinked has copy, drop {
    domain: String,
}

// === Init ===

/// Publish-time setup: create + share the single global `DomainRegistry`.
fun init(ctx: &mut TxContext) {
    transfer::share_object(DomainRegistry {
        id: object::new(ctx),
        domains: table::new(ctx),
    });
}

// === Link / unlink ===

/// Link `domain` to `site`. Asserts the version gate, that `cap` authorizes
/// `site` (`cap.site_id == object::id(site)`), and that `domain` is not already
/// taken; then records the mapping and emits `DomainLinked`. DNS ownership of
/// `domain` is verified off-chain by the backend before this is called.
public fun link_domain(
    v: &Version,
    reg: &mut DomainRegistry,
    cap: &SiteAdminCap,
    site: &Site,
    domain: String,
) {
    v.assert_version();

    let site_id = object::id(site);
    assert!(cap.cap_site_id() == site_id, EWrongCap);
    assert!(!reg.domains.contains(domain), EDomainTaken);

    reg.domains.add(domain, site_id);
    event::emit(DomainLinked { domain, site_id });
}

/// Unlink `domain`. Asserts the version gate, that the domain exists, and that
/// `cap` is bound to the site the domain currently points at (so a cap can only
/// unlink its OWN domains); then removes the mapping and emits `DomainUnlinked`.
public fun unlink_domain(
    v: &Version,
    reg: &mut DomainRegistry,
    cap: &SiteAdminCap,
    domain: String,
) {
    v.assert_version();

    assert!(reg.domains.contains(domain), ENoSuchDomain);
    let linked_site_id = *reg.domains.borrow(domain);
    assert!(cap.cap_site_id() == linked_site_id, EWrongCap);

    reg.domains.remove(domain);
    event::emit(DomainUnlinked { domain });
}

// === Read accessors ===

/// Whether `domain` is currently linked.
public fun contains(reg: &DomainRegistry, domain: String): bool {
    reg.domains.contains(domain)
}

/// The `Site` id `domain` resolves to. Aborts (framework) if absent — callers
/// guard with `contains` (the worker does an existence check before lookup).
public fun site_id_of(reg: &DomainRegistry, domain: String): ID {
    *reg.domains.borrow(domain)
}

// === Tests ===

#[test_only]
use sui::test_scenario;
#[test_only]
use deploy_sui::version;
#[test_only]
use std::string;

#[test_only]
/// Stand up the version gate + the domain registry + a freshly created site,
/// returning the deployer-held `SiteAdminCap`. Used by the link/unlink tests.
fun setup(scenario: &mut test_scenario::Scenario, deployer: address) {
    { version::init_for_testing(scenario.ctx()); };
    scenario.next_tx(deployer);
    { init(scenario.ctx()); };
    scenario.next_tx(deployer);
    { site::init_for_testing(scenario.ctx()); };
    scenario.next_tx(deployer);
    {
        let v = scenario.take_shared<Version>();
        let mut reg = scenario.take_shared<site::SiteDigestRegistry>();
        let deployer_cap = scenario.take_from_sender<site::DeployerCap>();
        let cap = site::create_site(
            &deployer_cap,
            &v,
            &mut reg,
            b"\x01",
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
        scenario.return_to_sender(deployer_cap);
        test_scenario::return_shared(reg);
        test_scenario::return_shared(v);
    };
    scenario.next_tx(deployer);
}

#[test]
fun test_link_domain_happy_path() {
    let deployer = @0xD;
    let mut scenario = test_scenario::begin(deployer);
    setup(&mut scenario, deployer);
    {
        let v = scenario.take_shared<Version>();
        let mut reg = scenario.take_shared<DomainRegistry>();
        let cap = scenario.take_from_sender<SiteAdminCap>();
        let site = scenario.take_shared<Site>();

        let domain = string::utf8(b"example.com");
        assert!(!reg.contains(domain), 0);

        link_domain(&v, &mut reg, &cap, &site, domain);

        assert!(reg.contains(domain), 1);
        assert!(reg.site_id_of(domain) == object::id(&site), 2);

        test_scenario::return_shared(site);
        scenario.return_to_sender(cap);
        test_scenario::return_shared(reg);
        test_scenario::return_shared(v);
    };
    scenario.end();
}

#[test]
#[expected_failure(abort_code = EDomainTaken)]
fun test_link_domain_aborts_when_taken() {
    let deployer = @0xD;
    let mut scenario = test_scenario::begin(deployer);
    setup(&mut scenario, deployer);
    {
        let v = scenario.take_shared<Version>();
        let mut reg = scenario.take_shared<DomainRegistry>();
        let cap = scenario.take_from_sender<SiteAdminCap>();
        let site = scenario.take_shared<Site>();
        let domain = string::utf8(b"example.com");

        link_domain(&v, &mut reg, &cap, &site, domain);
        link_domain(&v, &mut reg, &cap, &site, domain); // aborts EDomainTaken

        test_scenario::return_shared(site);
        scenario.return_to_sender(cap);
        test_scenario::return_shared(reg);
        test_scenario::return_shared(v);
    };
    scenario.end();
}

#[test]
fun test_unlink_domain_happy_path() {
    let deployer = @0xD;
    let mut scenario = test_scenario::begin(deployer);
    setup(&mut scenario, deployer);
    {
        let v = scenario.take_shared<Version>();
        let mut reg = scenario.take_shared<DomainRegistry>();
        let cap = scenario.take_from_sender<SiteAdminCap>();
        let site = scenario.take_shared<Site>();
        let domain = string::utf8(b"example.com");

        link_domain(&v, &mut reg, &cap, &site, domain);
        assert!(reg.contains(domain), 0);

        unlink_domain(&v, &mut reg, &cap, domain);
        assert!(!reg.contains(domain), 1);

        test_scenario::return_shared(site);
        scenario.return_to_sender(cap);
        test_scenario::return_shared(reg);
        test_scenario::return_shared(v);
    };
    scenario.end();
}

#[test]
#[expected_failure(abort_code = EWrongCap)]
fun test_link_domain_aborts_with_wrong_cap() {
    let deployer = @0xD;
    let mut scenario = test_scenario::begin(deployer);
    setup(&mut scenario, deployer);
    {
        let v = scenario.take_shared<Version>();
        let mut reg = scenario.take_shared<DomainRegistry>();
        let mut digest_reg = scenario.take_shared<site::SiteDigestRegistry>();
        let real_cap = scenario.take_from_sender<SiteAdminCap>();
        let deployer_cap = scenario.take_from_sender<site::DeployerCap>();
        let site = scenario.take_shared<Site>();

        // Mint a SECOND, unrelated site -> its cap is NOT bound to `site`. A fresh
        // digest (the `setup` site used b"\x01") keeps the consume guard happy.
        let wrong_cap = site::create_site(
            &deployer_cap,
            &v,
            &mut digest_reg,
            b"\x02",
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
        link_domain(&v, &mut reg, &wrong_cap, &site, string::utf8(b"example.com"));

        transfer::public_transfer(wrong_cap, deployer);
        test_scenario::return_shared(site);
        scenario.return_to_sender(real_cap);
        scenario.return_to_sender(deployer_cap);
        test_scenario::return_shared(digest_reg);
        test_scenario::return_shared(reg);
        test_scenario::return_shared(v);
    };
    scenario.end();
}
