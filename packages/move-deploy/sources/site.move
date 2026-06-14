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
use sui::table::{Self, Table};

// === Errors ===
// Abort codes are part of this package's public contract: tests pattern-match on
// the exact code. Codes are scoped PER MODULE — this is the first (and only) code
// in `site`, so it is 0. Do NOT renumber.

/// The payment digest was already consumed by a prior `create_site`. ONE site per
/// payment: the `SiteDigestRegistry` is the atomic on-chain consume guard, so a
/// retry that lands on a different backend replica — or any double-submit of the
/// same settled payment — aborts here instead of minting a second `Site`.
const EDigestUsed: u64 = 0;

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
    /// Sui object id of the Walrus `Blob` OBJECT holding the quilt. Distinct
    /// from `quilt_id` (the blob CONTENT id, which cannot be extended): this is
    /// what storage-extension calls target for auto-renewal.
    quilt_blob_object: ID,
    /// Sui object id of the Walrus `Blob` OBJECT holding the manifest. Distinct
    /// from `manifest_blob_id` (the blob CONTENT id); the storage-extension
    /// target for the manifest blob.
    manifest_blob_object: ID,
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

/// Mint authority for `create_site`. Minted ONCE at publish by `init` and
/// transferred to the publisher (the deploy service wallet on testnet; transferred
/// onward to the prod service wallet on mainnet). `create_site` requires
/// `&DeployerCap`, so the ONLY way to mint a `Site` is through the paid backend that
/// holds it. Without this gate `create_site` is a `public fun` whose `owner`,
/// `size_bytes`, and blob-object ids are caller-supplied — an attacker could (a) mint
/// a `*.suize.site` Site for FREE, bypassing the deploy charge, and (b) forge a Site
/// pointing at arbitrary Walrus `Blob` objects so the subscription storage-renewer
/// drains the service wallet's WAL on blobs it never deployed. `store` so the
/// publisher can transfer it to the prod service wallet.
public struct DeployerCap has key, store {
    id: UID,
}

/// The single global payment-digest set: the on-chain "one site per payment"
/// lock. One shared `SiteDigestRegistry` is created + shared at publish time by
/// `init`. `create_site` records the settled payment digest here and aborts
/// `EDigestUsed` if it is already present, so the CHAIN — not a per-replica
/// in-memory map — is the atomic guard against a payment minting two sites
/// (a backend retry on another replica, or a double-submit). `Table`
/// (dynamic-field backed) keeps on-chain state O(1) per entry; the value is the
/// minted `Site` id, giving a digest -> site audit trail for free.
public struct SiteDigestRegistry has key {
    id: UID,
    used: Table<vector<u8>, ID>,
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

// === Init ===

/// Publish-time setup: create + share the single global `SiteDigestRegistry`
/// (the "one site per payment" lock, mirrors `domain_registry::init`), and mint the
/// single `DeployerCap` (the `create_site` mint authority) to the publisher — on
/// testnet the deploy service wallet, transferred onward to the prod service wallet
/// on mainnet. From here, ONLY the holder of that cap can mint a `Site`.
fun init(ctx: &mut TxContext) {
    transfer::share_object(SiteDigestRegistry {
        id: object::new(ctx),
        used: table::new(ctx),
    });
    transfer::transfer(DeployerCap { id: object::new(ctx) }, ctx.sender());
}

// === Create ===

/// Record a freshly deployed site on-chain and return its admin cap.
///
/// GATED by `&DeployerCap`: only the deploy service wallet that holds the single
/// cap may mint a `Site`. This is the trust root for everything downstream — the
/// `owner`, `size_bytes`, and blob-object ids are caller-supplied, so without this
/// gate anyone could forge a Site (free `*.suize.site` hosting bypassing the deploy
/// charge, or a renewer-draining Site pointing at arbitrary Walrus blobs). With it,
/// every on-chain Site field is service-wallet-attested.
///
/// Asserts the version gate; asserts `payment_digest` has not already minted a
/// site and records it in `reg` (the atomic on-chain consume guard — ONE site
/// per payment); mints the `Site` (version field = 1), SHARES it (so the worker
/// + anyone can read it), emits `SiteCreated`, and returns the `SiteAdminCap` to
/// the caller (the deploy service wallet) for later domain ops. There is no
/// update path — each deploy is a new, immutable `Site`.
public fun create_site(
    _deployer: &DeployerCap,
    v: &Version,
    reg: &mut SiteDigestRegistry,
    payment_digest: vector<u8>,
    name: String,
    owner: address,
    quilt_id: String,
    manifest_blob_id: String,
    manifest_hash: vector<u8>,
    quilt_blob_object: ID,
    manifest_blob_object: ID,
    size_bytes: u64,
    file_count: u64,
    ctx: &mut TxContext,
): SiteAdminCap {
    v.assert_version();

    // One site per payment: a settled payment digest can mint exactly one Site.
    // The chain is the lock — a retry on a different replica or a double-submit
    // of the same digest aborts here instead of minting a second Site. Record
    // BEFORE `object::new` so the guard fires before any state is built.
    assert!(!reg.used.contains(payment_digest), EDigestUsed);

    let site = Site {
        id: object::new(ctx),
        owner,
        name,
        quilt_id,
        manifest_blob_id,
        manifest_hash,
        quilt_blob_object,
        manifest_blob_object,
        version: 1,
        size_bytes,
        file_count,
    };
    let site_id = object::id(&site);

    // Consume the digest: record digest -> site id (the value doubles as a
    // digest -> Site audit trail). Paired with the `contains` assert above, this
    // is the atomic per-payment lock.
    reg.used.add(payment_digest, site_id);

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

/// Whether `payment_digest` has already minted a site (the consume-guard check;
/// off-chain inspection / tests).
public fun digest_used(reg: &SiteDigestRegistry, payment_digest: vector<u8>): bool {
    reg.used.contains(payment_digest)
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

public fun quilt_blob_object(self: &Site): ID {
    self.quilt_blob_object
}

public fun manifest_blob_object(self: &Site): ID {
    self.manifest_blob_object
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

#[test_only]
/// Stand up the shared `SiteDigestRegistry`, mirroring what `init` does at
/// publish time, for this module's tests AND `domain_registry`'s `setup`.
public fun init_for_testing(ctx: &mut TxContext) {
    init(ctx);
}

#[test]
fun test_create_site_happy_path_shares_site_and_emits_event() {
    let deployer = @0xD;
    let mut scenario = test_scenario::begin(deployer);

    // Stand up the version gate + the digest registry exactly as `init` would.
    { version::init_for_testing(scenario.ctx()); };
    scenario.next_tx(deployer);
    { init(scenario.ctx()); };

    scenario.next_tx(deployer);
    {
        let v = scenario.take_shared<Version>();
        let mut reg = scenario.take_shared<SiteDigestRegistry>();
        let deployer_cap = scenario.take_from_sender<DeployerCap>();
        let cap = create_site(
            &deployer_cap,
            &v,
            &mut reg,
            b"\xDE\xAD\xBE\xEF",
            string::utf8(b"my-site"),
            deployer,
            string::utf8(b"quilt-abc"),
            string::utf8(b"blob-xyz"),
            b"\x01\x02\x03",
            object::id_from_address(@0xB1),
            object::id_from_address(@0xB2),
            1024,
            7,
            scenario.ctx(),
        );
        // The digest is now consumed.
        assert!(reg.digest_used(b"\xDE\xAD\xBE\xEF"), 12);
        // The cap is bound to the site that was just created + shared.
        transfer::public_transfer(cap, deployer);
        scenario.return_to_sender(deployer_cap);
        test_scenario::return_shared(reg);
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
        assert!(site.quilt_blob_object() == object::id_from_address(@0xB1), 10);
        assert!(site.manifest_blob_object() == object::id_from_address(@0xB2), 11);

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
    { init(scenario.ctx()); };

    scenario.next_tx(deployer);
    {
        let mut v = scenario.take_shared<Version>();
        let mut reg = scenario.take_shared<SiteDigestRegistry>();
        let admin = scenario.take_from_sender<version::AdminCap>();
        let deployer_cap = scenario.take_from_sender<DeployerCap>();
        admin.freeze_version(&mut v);

        let cap = create_site(
            &deployer_cap,
            &v, // frozen -> assert_version aborts EWrongVersion
            &mut reg,
            b"\x01",
            string::utf8(b"my-site"),
            deployer,
            string::utf8(b"quilt-abc"),
            string::utf8(b"blob-xyz"),
            b"\x01",
            object::id_from_address(@0xB1),
            object::id_from_address(@0xB2),
            1024,
            7,
            scenario.ctx(),
        );
        transfer::public_transfer(cap, deployer);
        scenario.return_to_sender(admin);
        scenario.return_to_sender(deployer_cap);
        test_scenario::return_shared(reg);
        test_scenario::return_shared(v);
    };
    scenario.end();
}

#[test]
#[expected_failure(abort_code = EDigestUsed)]
fun test_create_site_aborts_on_duplicate_digest() {
    let deployer = @0xD;
    let mut scenario = test_scenario::begin(deployer);
    { version::init_for_testing(scenario.ctx()); };
    scenario.next_tx(deployer);
    { init(scenario.ctx()); };

    scenario.next_tx(deployer);
    {
        let v = scenario.take_shared<Version>();
        let mut reg = scenario.take_shared<SiteDigestRegistry>();
        let deployer_cap = scenario.take_from_sender<DeployerCap>();

        // First deploy with this digest: consumes it.
        let cap1 = create_site(
            &deployer_cap,
            &v,
            &mut reg,
            b"\xAA\xBB",
            string::utf8(b"site-1"),
            deployer,
            string::utf8(b"quilt-1"),
            string::utf8(b"blob-1"),
            b"\x01",
            object::id_from_address(@0xB1),
            object::id_from_address(@0xB2),
            1024,
            7,
            scenario.ctx(),
        );

        // SAME digest again -> aborts EDigestUsed (the on-chain one-site-per-payment
        // guard; a retry on another replica cannot mint a second Site).
        let cap2 = create_site(
            &deployer_cap,
            &v,
            &mut reg,
            b"\xAA\xBB",
            string::utf8(b"site-2"),
            deployer,
            string::utf8(b"quilt-2"),
            string::utf8(b"blob-2"),
            b"\x02",
            object::id_from_address(@0xB3),
            object::id_from_address(@0xB4),
            2048,
            3,
            scenario.ctx(),
        );

        transfer::public_transfer(cap1, deployer);
        transfer::public_transfer(cap2, deployer);
        scenario.return_to_sender(deployer_cap);
        test_scenario::return_shared(reg);
        test_scenario::return_shared(v);
    };
    scenario.end();
}
