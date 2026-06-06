/// On-chain manifest for a single deployed static site.
///
/// Every `POST /deploy` mints a FRESH `Site`: the deploy service wallet uploads
/// the bundle to Walrus as one quilt + a manifest blob, then calls `create_site`
/// to record `{ owner, name, quilt_id, manifest_blob_id, manifest_hash }`
/// on-chain. The `Site` is SHARED (so the Cloudflare worker + anyone can read it
/// to serve the bytes), and the caller keeps the returned `SiteAdminCap` for
/// future domain ops.
///
/// IDENTITY = the object id. There is deliberately no `{owner, name}`
/// determinism and no `update_site`: deploys are immutable (a "re-deploy" is a
/// brand-new `Site` at a new id → new URL). This is what makes the open,
/// no-auth deploy route safe — nobody can clobber an existing site. `owner` is
/// best-effort ATTRIBUTION only (the deployer's address, or the service wallet
/// if none was passed); it is NOT Sui ownership and grants no authority.
module deploy_sui::site;

use deploy_sui::version::Version;
use std::string::String;
use sui::event;

// === Structs ===

/// A deployed site's on-chain manifest. SHARED (has only `key`), so the worker
/// can read it by id and serve the bytes from Walrus. On-chain state is O(1) per
/// deploy: just the three Walrus references + the manifest hash, never the file
/// list (that lives in the off-chain manifest blob, integrity-bound by
/// `manifest_hash`).
public struct Site has key {
    id: UID,
    /// Attribution: the deployer's address, or the service wallet if none was
    /// passed. NOT Sui ownership — grants no authority over the site.
    owner: address,
    /// Human label only (NOT an identity key — the object id is the identity).
    name: String,
    /// Walrus root quilt id holding the site's files.
    quilt_id: String,
    /// Walrus blob id holding the path -> quilt-patch manifest JSON.
    manifest_blob_id: String,
    /// sha256 of the manifest blob bytes — the worker re-hashes for serve-time
    /// integrity.
    manifest_hash: vector<u8>,
    /// Always 1 in the MVP (immutable deploys); reserved for a future updatable
    /// "project" model.
    version: u64,
    /// Total size of the deployed bundle in bytes (sum of all file sizes).
    size_bytes: u64,
    /// Number of files in the deployed bundle.
    file_count: u64,
}

/// Authority over a `Site`'s off-chain operations (domain linkage). Held by the
/// deploy service wallet — the only writer. `store` so the backend can custody
/// it. `site_id` binds it to exactly one `Site`; `domain_registry` checks it.
public struct SiteAdminCap has key, store {
    id: UID,
    site_id: ID,
}

// === Events ===

/// Emitted on every successful `create_site`. The backend reads these (filtered
/// by `owner`) to list a deployer's sites — no separate indexer needed.
public struct SiteCreated has copy, drop {
    site_id: ID,
    owner: address,
    name: String,
    size_bytes: u64,
    file_count: u64,
}

// === Create ===

/// Record a freshly deployed site on-chain and return its admin cap.
///
/// Asserts the version gate, mints the `Site` (version field = 1), SHARES it (so
/// the worker + anyone can read it), emits `SiteCreated`, and returns the
/// `SiteAdminCap` to the caller (the deploy service wallet) for later domain
/// ops. There is no update path — each deploy is a new, immutable `Site`.
public fun create_site(
    v: &Version,
    name: String,
    owner: address,
    quilt_id: String,
    manifest_blob_id: String,
    manifest_hash: vector<u8>,
    size_bytes: u64,
    file_count: u64,
    ctx: &mut TxContext,
): SiteAdminCap {
    v.assert_version();

    let site = Site {
        id: object::new(ctx),
        owner,
        name,
        quilt_id,
        manifest_blob_id,
        manifest_hash,
        version: 1,
        size_bytes,
        file_count,
    };
    let site_id = object::id(&site);

    event::emit(SiteCreated { site_id, owner, name: site.name, size_bytes, file_count });

    transfer::share_object(site);

    SiteAdminCap { id: object::new(ctx), site_id }
}

// === Read accessors ===

/// The `Site` this cap authorizes (used by `domain_registry` to bind a cap to a
/// site, and by `domain_registry`'s own accessor).
public fun cap_site_id(cap: &SiteAdminCap): ID {
    cap.site_id
}

public fun owner(self: &Site): address {
    self.owner
}

public fun name(self: &Site): String {
    self.name
}

public fun quilt_id(self: &Site): String {
    self.quilt_id
}

public fun manifest_blob_id(self: &Site): String {
    self.manifest_blob_id
}

public fun manifest_hash(self: &Site): vector<u8> {
    self.manifest_hash
}

public fun version(self: &Site): u64 {
    self.version
}

public fun size_bytes(site: &Site): u64 {
    site.size_bytes
}

public fun file_count(site: &Site): u64 {
    site.file_count
}

// === Tests ===

#[test_only]
use sui::test_scenario;
#[test_only]
use deploy_sui::version;
#[test_only]
use std::string;

#[test]
fun test_create_site_happy_path_shares_site_and_emits_event() {
    let deployer = @0xD;
    let mut scenario = test_scenario::begin(deployer);

    // Stand up the version gate exactly as `init` would.
    { version::init_for_testing(scenario.ctx()); };

    scenario.next_tx(deployer);
    {
        let v = scenario.take_shared<Version>();
        let cap = create_site(
            &v,
            string::utf8(b"my-site"),
            deployer,
            string::utf8(b"quilt-abc"),
            string::utf8(b"blob-xyz"),
            b"\x01\x02\x03",
            1024,
            7,
            scenario.ctx(),
        );
        // The cap is bound to the site that was just created + shared.
        transfer::public_transfer(cap, deployer);
        test_scenario::return_shared(v);
    };

    // Closing the create-tx returns its effects: exactly one SiteCreated event.
    let create_effects = scenario.next_tx(deployer);
    assert!(create_effects.num_user_events() == 1, 7);

    // The Site is shared and the cap landed with the deployer.
    {
        let site = scenario.take_shared<Site>();
        let cap = scenario.take_from_sender<SiteAdminCap>();

        assert!(site.owner() == deployer, 0);
        assert!(site.name() == string::utf8(b"my-site"), 1);
        assert!(site.quilt_id() == string::utf8(b"quilt-abc"), 2);
        assert!(site.manifest_blob_id() == string::utf8(b"blob-xyz"), 3);
        assert!(site.manifest_hash() == b"\x01\x02\x03", 4);
        assert!(site.version() == 1, 5);
        assert!(cap.cap_site_id() == object::id(&site), 6);
        assert!(site.size_bytes() == 1024, 8);
        assert!(site.file_count() == 7, 9);

        scenario.return_to_sender(cap);
        test_scenario::return_shared(site);
    };

    scenario.end();
}

#[test]
#[expected_failure(abort_code = deploy_sui::version::EWrongVersion)]
fun test_create_site_aborts_when_frozen() {
    let deployer = @0xD;
    let mut scenario = test_scenario::begin(deployer);
    { version::init_for_testing(scenario.ctx()); };

    scenario.next_tx(deployer);
    {
        let mut v = scenario.take_shared<Version>();
        let admin = scenario.take_from_sender<version::AdminCap>();
        admin.freeze_version(&mut v);

        let cap = create_site(
            &v, // frozen -> assert_version aborts EWrongVersion
            string::utf8(b"my-site"),
            deployer,
            string::utf8(b"quilt-abc"),
            string::utf8(b"blob-xyz"),
            b"\x01",
            1024,
            7,
            scenario.ctx(),
        );
        transfer::public_transfer(cap, deployer);
        scenario.return_to_sender(admin);
        test_scenario::return_shared(v);
    };
    scenario.end();
}
