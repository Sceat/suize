/// Seal access-control for PRIVATE (sealed) sites.
///
/// A sealed deploy's file bytes are Seal-encrypted at publish under the
/// identity prefix `[this package id]::[allowlist id]` — Seal's key servers
/// dry-run `seal_approve` here and release decryption keys ONLY to addresses on
/// the list. The viewer decrypts client-side; denial is cryptographic.
///
/// BINDING is one-directional and manifest-anchored: the allowlist is created
/// FIRST (its id must exist before encryption), then the site's MANIFEST — whose
/// hash is fixed on the on-chain `Site` — records `{ allowlistId }`. There is no
/// `site_id` on the allowlist (the site doesn't exist yet at creation time), and
/// none is needed: only the paid publish path writes manifests, so only the real
/// allowlist is ever consulted for a real site.
///
/// CREATION IS GATED by the same `DeployerCap` as `create_site` — an allowlist
/// mints only inside the PAID sealed-deploy flow (trust-boundary law: every fun
/// minting trusted state is cap-gated). The `AllowlistCap` (membership control)
/// goes to the SITE OWNER — Suize never manages a private site's viewers.
module deploy_sui::allowlist;

use deploy_sui::site::DeployerCap;
use deploy_sui::version::Version;
use sui::event;

// === Errors ===
// Abort codes are part of this package's public contract; scoped per module.
// Do NOT renumber.

/// The presented `AllowlistCap` does not control this `Allowlist`.
const EInvalidCap: u64 = 0;

/// `seal_approve` denial: the caller is not on the list (or the requested key
/// id is outside this allowlist's namespace). This is the code Seal key servers
/// surface as a cryptographic access denial.
const ENoAccess: u64 = 1;

/// The address is already on the list.
const EDuplicate: u64 = 2;

// === Structs ===

/// The viewer set for one sealed site. SHARED so Seal key servers (and the
/// viewer shell) can read it; mutated only through the cap-gated add/remove.
public struct Allowlist has key {
    id: UID,
    list: vector<address>,
}

/// Membership control over one `Allowlist`. Held by the SITE OWNER (transferred
/// at creation) — `store` so it is wallet-visible and transferable with normal
/// ownership tooling.
public struct AllowlistCap has key, store {
    id: UID,
    allowlist_id: ID,
}

// === Events ===

/// Emitted at creation — lets the worker/dashboard resolve the fresh allowlist
/// id from the tx without parsing object changes.
public struct AllowlistCreated has copy, drop {
    allowlist_id: ID,
    owner: address,
}

// === Create ===

/// Mint the allowlist for a sealed deploy: seeds the list with `owner` (a
/// private site's owner can always view it) and transfers the `AllowlistCap`
/// to them. Returns the allowlist id so the publish PTB / caller can thread it
/// into the Seal encryption identity + the site manifest.
///
/// Gated by `&DeployerCap`: only the paid publish path mints allowlists.
public fun create_for_owner(
    _deployer: &DeployerCap,
    v: &Version,
    owner: address,
    ctx: &mut TxContext,
): ID {
    v.assert_version();

    let allowlist = Allowlist {
        id: object::new(ctx),
        list: vector[owner],
    };
    let allowlist_id = object::id(&allowlist);

    let cap = AllowlistCap { id: object::new(ctx), allowlist_id };
    transfer::transfer(cap, owner);

    event::emit(AllowlistCreated { allowlist_id, owner });
    transfer::share_object(allowlist);

    allowlist_id
}

// === Membership (owner-controlled via the cap) ===

public fun add(allowlist: &mut Allowlist, cap: &AllowlistCap, v: &Version, account: address) {
    v.assert_version();
    assert!(cap.allowlist_id == object::id(allowlist), EInvalidCap);
    assert!(!allowlist.list.contains(&account), EDuplicate);
    allowlist.list.push_back(account);
}

public fun remove(allowlist: &mut Allowlist, cap: &AllowlistCap, v: &Version, account: address) {
    v.assert_version();
    assert!(cap.allowlist_id == object::id(allowlist), EInvalidCap);
    allowlist.list = allowlist.list.filter!(|x| x != account);
}

// === Seal access check ===

/// The identity-namespace prefix every key id under this allowlist must carry:
/// the allowlist object id's raw bytes.
public fun namespace(allowlist: &Allowlist): vector<u8> {
    allowlist.id.to_bytes()
}

/// True iff `prefix` is a byte-prefix of `word`.
fun is_prefix(prefix: vector<u8>, word: vector<u8>): bool {
    if (prefix.length() > word.length()) {
        return false
    };
    let mut i = 0;
    while (i < prefix.length()) {
        if (prefix[i] != word[i]) {
            return false
        };
        i = i + 1;
    };
    true
}

/// The Seal key-server gate: dry-run (never broadcast, never sponsored). The
/// requested key `id` must live under this allowlist's namespace AND the caller
/// must be on the list. DELIBERATELY NOT version-gated — freezing the package
/// version for an upgrade must never brick decryption of existing sites.
entry fun seal_approve(id: vector<u8>, allowlist: &Allowlist, ctx: &TxContext) {
    assert!(is_prefix(namespace(allowlist), id), ENoAccess);
    assert!(allowlist.list.contains(&ctx.sender()), ENoAccess);
}

// === Read accessors ===

public fun members(allowlist: &Allowlist): vector<address> {
    allowlist.list
}

public fun cap_allowlist_id(cap: &AllowlistCap): ID {
    cap.allowlist_id
}

// === Tests ===

#[test_only]
use sui::test_scenario;
#[test_only]
use deploy_sui::site;
#[test_only]
use deploy_sui::version;

#[test_only]
/// Init the version gate + site module (mints the DeployerCap to `deployer`),
/// then create one allowlist for `owner`. Leaves the scenario one tx past
/// creation.
fun setup(scenario: &mut test_scenario::Scenario, deployer: address, owner: address) {
    { version::init_for_testing(scenario.ctx()); };
    scenario.next_tx(deployer);
    { site::init_for_testing(scenario.ctx()); };
    scenario.next_tx(deployer);
    {
        let v = scenario.take_shared<Version>();
        let deployer_cap = scenario.take_from_sender<DeployerCap>();
        create_for_owner(&deployer_cap, &v, owner, scenario.ctx());
        scenario.return_to_sender(deployer_cap);
        test_scenario::return_shared(v);
    };
    scenario.next_tx(owner);
}

#[test]
fun test_create_seeds_owner_and_transfers_cap() {
    let deployer = @0xD;
    let owner = @0xA;
    let mut scenario = test_scenario::begin(deployer);
    setup(&mut scenario, deployer, owner);
    {
        let allowlist = scenario.take_shared<Allowlist>();
        let cap = scenario.take_from_sender<AllowlistCap>(); // owner holds it

        assert!(allowlist.members() == vector[owner], 0);
        assert!(cap.cap_allowlist_id() == object::id(&allowlist), 1);

        scenario.return_to_sender(cap);
        test_scenario::return_shared(allowlist);
    };
    scenario.end();
}

#[test]
fun test_add_and_remove_members() {
    let deployer = @0xD;
    let owner = @0xA;
    let viewer = @0xB;
    let mut scenario = test_scenario::begin(deployer);
    setup(&mut scenario, deployer, owner);
    {
        let v = scenario.take_shared<Version>();
        let mut allowlist = scenario.take_shared<Allowlist>();
        let cap = scenario.take_from_sender<AllowlistCap>();

        allowlist.add(&cap, &v, viewer);
        assert!(allowlist.members() == vector[owner, viewer], 0);

        allowlist.remove(&cap, &v, viewer);
        assert!(allowlist.members() == vector[owner], 1);

        scenario.return_to_sender(cap);
        test_scenario::return_shared(allowlist);
        test_scenario::return_shared(v);
    };
    scenario.end();
}

#[test]
#[expected_failure(abort_code = EDuplicate)]
fun test_add_duplicate_aborts() {
    let deployer = @0xD;
    let owner = @0xA;
    let mut scenario = test_scenario::begin(deployer);
    setup(&mut scenario, deployer, owner);
    {
        let v = scenario.take_shared<Version>();
        let mut allowlist = scenario.take_shared<Allowlist>();
        let cap = scenario.take_from_sender<AllowlistCap>();

        allowlist.add(&cap, &v, owner); // owner already seeded -> abort

        scenario.return_to_sender(cap);
        test_scenario::return_shared(allowlist);
        test_scenario::return_shared(v);
    };
    scenario.end();
}

#[test]
#[expected_failure(abort_code = EInvalidCap)]
fun test_foreign_cap_cannot_mutate() {
    let deployer = @0xD;
    let owner = @0xA;
    let mut scenario = test_scenario::begin(deployer);
    setup(&mut scenario, deployer, owner);
    // A SECOND allowlist (fresh cap) for the same owner — its cap must not
    // control the first list.
    scenario.next_tx(deployer);
    {
        let v = scenario.take_shared<Version>();
        let deployer_cap = scenario.take_from_sender<DeployerCap>();
        create_for_owner(&deployer_cap, &v, owner, scenario.ctx());
        scenario.return_to_sender(deployer_cap);
        test_scenario::return_shared(v);
    };
    scenario.next_tx(owner);
    {
        let v = scenario.take_shared<Version>();
        // take_shared returns the MOST RECENT shared object first; grab both and
        // cross the cap of one against the other.
        let mut second = scenario.take_shared<Allowlist>();
        let first = scenario.take_shared<Allowlist>();
        let caps = vector[
            scenario.take_from_sender<AllowlistCap>(),
            scenario.take_from_sender<AllowlistCap>(),
        ];
        // Find the cap that does NOT control `second` and try to mutate with it.
        let foreign = if (caps[0].cap_allowlist_id() == object::id(&second)) { 1 } else { 0 };
        second.add(&caps[foreign], &v, @0xC); // -> EInvalidCap

        let mut caps = caps;
        scenario.return_to_sender(caps.pop_back());
        scenario.return_to_sender(caps.pop_back());
        caps.destroy_empty();
        test_scenario::return_shared(first);
        test_scenario::return_shared(second);
        test_scenario::return_shared(v);
    };
    scenario.end();
}

#[test]
fun test_seal_approve_allows_member_under_namespace() {
    let deployer = @0xD;
    let owner = @0xA;
    let mut scenario = test_scenario::begin(deployer);
    setup(&mut scenario, deployer, owner);
    {
        let allowlist = scenario.take_shared<Allowlist>();
        let mut id = namespace(&allowlist);
        id.push_back(0x42); // namespace + nonce
        seal_approve(id, &allowlist, scenario.ctx()); // sender == owner -> passes
        test_scenario::return_shared(allowlist);
    };
    scenario.end();
}

#[test]
#[expected_failure(abort_code = ENoAccess)]
fun test_seal_approve_denies_non_member() {
    let deployer = @0xD;
    let owner = @0xA;
    let stranger = @0xEE;
    let mut scenario = test_scenario::begin(deployer);
    setup(&mut scenario, deployer, owner);
    scenario.next_tx(stranger);
    {
        let allowlist = scenario.take_shared<Allowlist>();
        let mut id = namespace(&allowlist);
        id.push_back(0x42);
        seal_approve(id, &allowlist, scenario.ctx()); // sender == stranger -> abort
        test_scenario::return_shared(allowlist);
    };
    scenario.end();
}

#[test]
#[expected_failure(abort_code = ENoAccess)]
fun test_seal_approve_denies_foreign_namespace() {
    let deployer = @0xD;
    let owner = @0xA;
    let mut scenario = test_scenario::begin(deployer);
    setup(&mut scenario, deployer, owner);
    {
        let allowlist = scenario.take_shared<Allowlist>();
        // A key id under a DIFFERENT namespace — even a member must be denied.
        seal_approve(b"\xFF\xFF\xFF", &allowlist, scenario.ctx());
        test_scenario::return_shared(allowlist);
    };
    scenario.end();
}
