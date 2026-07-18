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
/// brand-new `Site` at a new id → new URL). This is what makes the deploy route
/// safe — nobody can clobber an existing site. `owner` is the cryptographically
/// recovered payer (whoever pays, owns): it is NOT Sui *object* ownership (the
/// Site is shared), but it IS the authorization identity for custom-domain
/// link/unlink — the off-chain worker requires the domain payer / signer to
/// equal this address. So `owner` grants no authority over the object's bytes,
/// but it is the site's account for domain ops.
///
/// The ONE mutable field is `paid_until_ms` (prepaid-months billing,
/// 2026-07-12): `extend_site` — cap-gated, one payment digest per call through
/// the same `SiteDigestRegistry` as `create_site` — pushes it forward. Every
/// SERVING field (quilt/manifest ids + hash) stays immutable, so serve-side
/// caches remain valid forever.
module deploy_sui::site;

use deploy_sui::version::Version;
use std::string::String;
use sui::clock::Clock;
use sui::event;
use sui::table::{Self, Table};

// === Errors ===
// Abort codes are part of this package's public contract: tests pattern-match on
// the exact code. Codes are scoped PER MODULE. Do NOT renumber.

/// The payment digest was already consumed by a prior `create_site` OR
/// `extend_site`. ONE mint/extend per payment: the `SiteDigestRegistry` is the
/// atomic on-chain consume guard, so a retry that lands on a different replica —
/// or any double-submit (replay) of the same settled payment — aborts here
/// instead of minting a second `Site` / granting a second free extension.
const EDigestUsed: u64 = 0;

/// `extend_site` must buy a POSITIVE duration.
const EZeroDuration: u64 = 1;

/// `delete_site` is OWNER-ONLY: the tx sender must equal `Site.owner` (the
/// cryptographically-recovered payer — whoever pays, owns). The `Site` is a
/// SHARED object, so Sui does NOT gate its deletion by object ownership — this
/// code enforces it. Any other signer's delete attempt aborts here, so a paid
/// site cannot be vandalized by a stranger passing it as a shared input.
const ENotOwner: u64 = 2;

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
    /// The wall-clock ms this site's hosting is PAID THROUGH (prepaid months at
    /// $0.25/mo; sealed 2×). The one mutable field — `extend_site` pushes it
    /// forward. Walrus storage is funded in one shot at deploy/extend; the
    /// prepay ceiling is capped at the Walrus max-epochs-ahead write limit.
    paid_until_ms: u64,
    /// True for a Seal-encrypted PRIVATE site (blobs encrypted at rest; viewers
    /// decrypt client-side after the on-chain allowlist's `seal_approve`).
    /// Public metadata on purpose — an encrypted site is visibly encrypted —
    /// and the billing bit: extends of a sealed site price at 2×.
    sealed: bool,
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

/// Emitted on every successful `create_site`. The worker/MCP/gallery read these
/// (filtered by `owner`) to list a deployer's sites — no separate indexer needed.
public struct SiteCreated has copy, drop {
    site_id: ID,
    owner: address,
    name: String,
    size_bytes: u64,
    file_count: u64,
    paid_until_ms: u64,
    sealed: bool,
}

/// Emitted on every successful `extend_site` — the cron + dashboards fold these
/// over `SiteCreated` to track a site's current paid-through time from events.
public struct SiteExtended has copy, drop {
    site_id: ID,
    paid_until_ms: u64,
}

/// Emitted on every successful `delete_site` — the gallery/worker fold these
/// over `SiteCreated` to drop a removed site from a deployer's listing, no
/// separate indexer needed. `owner` is the recovered payer that authorized it.
public struct SiteDeleted has copy, drop {
    site_id: ID,
    owner: address,
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
    paid_until_ms: u64,
    sealed: bool,
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
        paid_until_ms,
        sealed,
    };
    let site_id = object::id(&site);

    // Consume the digest: record digest -> site id (the value doubles as a
    // digest -> Site audit trail). Paired with the `contains` assert above, this
    // is the atomic per-payment lock.
    reg.used.add(payment_digest, site_id);

    event::emit(SiteCreated {
        site_id,
        owner,
        name: site.name,
        size_bytes,
        file_count,
        paid_until_ms,
        sealed,
    });

    transfer::share_object(site);

    SiteAdminCap { id: object::new(ctx), site_id }
}

// === Extend ===

/// Buy `add_ms` more milliseconds of paid hosting after a settled extend payment.
///
/// GATED by `&DeployerCap` (only the paid worker calls this, so the new
/// paid-through is service-attested against a real settlement), and gated by the
/// SAME `SiteDigestRegistry` as `create_site`: each settled payment digest
/// extends exactly ONCE — a replayed X-PAYMENT (the settle is idempotent by
/// digest) aborts `EDigestUsed` here instead of granting a second free extension.
///
/// RELATIVE, NOT ABSOLUTE (money-hat fix 2026-07-12): the duration is ADDED to
/// `max(now, paid_until_ms)`, computed ON-CHAIN. So (a) a lapsed site gets the
/// FULL purchased time (never extends from a past instant), and (b) two honest
/// concurrent extenders each stack their own duration — there is no shared
/// "target" that a second settled payment could find stale (the old absolute
/// form aborted the loser AFTER it had paid, stranding its funds).
///
/// EXTEND IS OPEN-PAYER by design: ANY payer may fund a site's extension — it
/// only ever ADDS paid time. The Walrus storage itself is extended off-chain by
/// the worker (service-wallet `system::extend_blob`), steered by this record.
public fun extend_site(
    _deployer: &DeployerCap,
    v: &Version,
    reg: &mut SiteDigestRegistry,
    payment_digest: vector<u8>,
    site: &mut Site,
    clock: &Clock,
    add_ms: u64,
) {
    v.assert_version();
    assert!(!reg.used.contains(payment_digest), EDigestUsed);
    assert!(add_ms > 0, EZeroDuration);

    let now = clock.timestamp_ms();
    let base = if (site.paid_until_ms > now) site.paid_until_ms else now;
    let new_paid_until = base + add_ms;

    let site_id = object::id(site);
    reg.used.add(payment_digest, site_id);
    site.paid_until_ms = new_paid_until;

    event::emit(SiteExtended { site_id, paid_until_ms: new_paid_until });
}

// === Delete ===

/// Permanently delete a `Site`, removing its on-chain manifest.
///
/// OWNER-SIGNED: the recovered payer recorded in `Site.owner` (whoever pays,
/// owns) is the ONLY signer that may delete it. Because the `Site` is SHARED
/// (see `create_site`), Sui does not enforce ownership at the transaction layer
/// as it would for an owned object — anyone can pass a shared object as input —
/// so this function enforces it explicitly: `ctx.sender() == site.owner`, else
/// `ENotOwner`. There is deliberately NO service/admin delete path: neither the
/// `DeployerCap` nor the `SiteAdminCap` can remove a site, only its owner can.
///
/// Asserts the version gate first (mirrors `create_site`/`extend_site`, so an
/// emergency `freeze` locks deletion alongside every other state change), then
/// the owner check, then unpacks the struct and deletes the `UID` via
/// `object::delete` (a shared-object deletion). Every other field is
/// String/ID/vector<u8>/u64/bool — all droppable — so they fall away. Emits
/// `SiteDeleted`.
///
/// This does NOT touch the `SiteDigestRegistry`: the payment→site audit trail
/// stays, so `site_for_digest` still resolves the (now-deleted) id for a
/// recovering worker. It also does NOT refund or shorten Walrus storage — the
/// blobs simply lapse at their already-funded end epoch.
public fun delete_site(site: Site, v: &Version, ctx: &TxContext) {
    v.assert_version();
    assert!(ctx.sender() == site.owner, ENotOwner);

    let site_id = object::id(&site);
    let Site {
        id,
        owner,
        name: _,
        quilt_id: _,
        manifest_blob_id: _,
        manifest_hash: _,
        quilt_blob_object: _,
        manifest_blob_object: _,
        version: _,
        size_bytes: _,
        file_count: _,
        paid_until_ms: _,
        sealed: _,
    } = site;
    id.delete();

    event::emit(SiteDeleted { site_id, owner });
}

/// The site id a settled payment digest minted/extended, if any — the on-chain
/// digest→site audit trail. The worker's recovery path reads this to return the
/// already-created site when a retry of an already-consumed payment aborts
/// `EDigestUsed` (a death AFTER the on-chain effect but before the response).
public fun site_for_digest(reg: &SiteDigestRegistry, payment_digest: vector<u8>): Option<ID> {
    if (reg.used.contains(payment_digest)) option::some(*reg.used.borrow(payment_digest))
    else option::none()
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

public fun paid_until_ms(site: &Site): u64 {
    site.paid_until_ms
}

public fun sealed(site: &Site): bool {
    site.sealed
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
            1_752_000_000_000,
            false,
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
        assert!(site.paid_until_ms() == 1_752_000_000_000, 13);
        assert!(!site.sealed(), 14);

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
            0,
            false,
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
            0,
            false,
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
            0,
            false,
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

// ── extend_site ──────────────────────────────────────────────────────────────

#[test_only]
/// Shared boilerplate for the extend tests: init the version gate + registry,
/// then mint ONE site (digest 0xA1, paid through 1_000ms) owned by `deployer`.
fun setup_with_site(scenario: &mut test_scenario::Scenario, deployer: address) {
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
            b"\xA1",
            string::utf8(b"site"),
            deployer,
            string::utf8(b"q"),
            string::utf8(b"m"),
            b"\x01",
            object::id_from_address(@0xB1),
            object::id_from_address(@0xB2),
            10,
            1,
            1_000,
            false,
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
fun test_extend_site_adds_duration_and_consumes_digest() {
    let deployer = @0xD;
    let mut scenario = test_scenario::begin(deployer);
    setup_with_site(&mut scenario, deployer);
    {
        let v = scenario.take_shared<Version>();
        let mut reg = scenario.take_shared<SiteDigestRegistry>();
        let deployer_cap = scenario.take_from_sender<DeployerCap>();
        let mut site = scenario.take_shared<Site>();
        // Clock at 500ms; site paid through 1_000ms (from setup) — base = the
        // later (1_000), +2_000 → 3_000.
        let mut clock = sui::clock::create_for_testing(scenario.ctx());
        clock.set_for_testing(500);

        extend_site(&deployer_cap, &v, &mut reg, b"\xE1", &mut site, &clock, 2_000);

        assert!(site.paid_until_ms() == 3_000, 0);
        assert!(reg.digest_used(b"\xE1"), 1);

        clock.destroy_for_testing();
        scenario.return_to_sender(deployer_cap);
        test_scenario::return_shared(site);
        test_scenario::return_shared(reg);
        test_scenario::return_shared(v);
    };
    let effects = scenario.next_tx(deployer);
    assert!(effects.num_user_events() == 1, 2);
    scenario.end();
}

#[test]
fun test_extend_site_lapsed_site_extends_from_now_not_the_past() {
    let deployer = @0xD;
    let mut scenario = test_scenario::begin(deployer);
    setup_with_site(&mut scenario, deployer);
    {
        let v = scenario.take_shared<Version>();
        let mut reg = scenario.take_shared<SiteDigestRegistry>();
        let deployer_cap = scenario.take_from_sender<DeployerCap>();
        let mut site = scenario.take_shared<Site>();
        // Site LAPSED: paid through 1_000, clock now 10_000. A 2_000 extend must
        // yield 12_000 (now + duration), NOT 3_000 (paid_until + duration) — the
        // payer gets the full purchased time.
        let mut clock = sui::clock::create_for_testing(scenario.ctx());
        clock.set_for_testing(10_000);

        extend_site(&deployer_cap, &v, &mut reg, b"\xE9", &mut site, &clock, 2_000);
        assert!(site.paid_until_ms() == 12_000, 0);

        clock.destroy_for_testing();
        scenario.return_to_sender(deployer_cap);
        test_scenario::return_shared(site);
        test_scenario::return_shared(reg);
        test_scenario::return_shared(v);
    };
    scenario.end();
}

#[test]
#[expected_failure(abort_code = EDigestUsed)]
fun test_extend_site_aborts_on_replayed_digest() {
    let deployer = @0xD;
    let mut scenario = test_scenario::begin(deployer);
    setup_with_site(&mut scenario, deployer);
    {
        let v = scenario.take_shared<Version>();
        let mut reg = scenario.take_shared<SiteDigestRegistry>();
        let deployer_cap = scenario.take_from_sender<DeployerCap>();
        let mut site = scenario.take_shared<Site>();
        let clock = sui::clock::create_for_testing(scenario.ctx());

        // First extend consumes the digest; the REPLAY of the same settled
        // payment must abort instead of granting a second free extension.
        extend_site(&deployer_cap, &v, &mut reg, b"\xE1", &mut site, &clock, 2_000);
        extend_site(&deployer_cap, &v, &mut reg, b"\xE1", &mut site, &clock, 3_000);

        clock.destroy_for_testing();
        scenario.return_to_sender(deployer_cap);
        test_scenario::return_shared(site);
        test_scenario::return_shared(reg);
        test_scenario::return_shared(v);
    };
    scenario.end();
}

#[test]
#[expected_failure(abort_code = EZeroDuration)]
fun test_extend_site_aborts_on_zero_duration() {
    let deployer = @0xD;
    let mut scenario = test_scenario::begin(deployer);
    setup_with_site(&mut scenario, deployer);
    {
        let v = scenario.take_shared<Version>();
        let mut reg = scenario.take_shared<SiteDigestRegistry>();
        let deployer_cap = scenario.take_from_sender<DeployerCap>();
        let mut site = scenario.take_shared<Site>();
        let clock = sui::clock::create_for_testing(scenario.ctx());

        extend_site(&deployer_cap, &v, &mut reg, b"\xE2", &mut site, &clock, 0);

        clock.destroy_for_testing();
        scenario.return_to_sender(deployer_cap);
        test_scenario::return_shared(site);
        test_scenario::return_shared(reg);
        test_scenario::return_shared(v);
    };
    scenario.end();
}

#[test]
fun test_site_for_digest_returns_the_minted_site() {
    let deployer = @0xD;
    let mut scenario = test_scenario::begin(deployer);
    setup_with_site(&mut scenario, deployer);
    {
        let reg = scenario.take_shared<SiteDigestRegistry>();
        let site = scenario.take_shared<Site>();
        // setup_with_site minted under digest 0xA1.
        let found = site_for_digest(&reg, b"\xA1");
        assert!(found.is_some(), 0);
        assert!(found.destroy_some() == object::id(&site), 1);
        assert!(site_for_digest(&reg, b"\xFF").is_none(), 2);
        test_scenario::return_shared(site);
        test_scenario::return_shared(reg);
    };
    scenario.end();
}

// ── delete_site ──────────────────────────────────────────────────────────────

#[test]
fun test_delete_site_removes_object_and_emits_event() {
    let deployer = @0xD;
    let mut scenario = test_scenario::begin(deployer);
    // setup_with_site mints ONE site owned (attribution) by `deployer`.
    setup_with_site(&mut scenario, deployer);
    {
        let v = scenario.take_shared<Version>();
        let site = scenario.take_shared<Site>();
        // Sender == owner (deployer) → the delete is authorized.
        delete_site(site, &v, scenario.ctx());
        test_scenario::return_shared(v);
    };
    // Closing the delete tx: exactly one SiteDeleted event, and the shared Site
    // is GONE (no most-recent shared Site remains to take).
    let effects = scenario.next_tx(deployer);
    assert!(effects.num_user_events() == 1, 0);
    assert!(!test_scenario::has_most_recent_shared<Site>(), 1);
    scenario.end();
}

#[test]
#[expected_failure(abort_code = ENotOwner)]
fun test_delete_site_aborts_for_non_owner() {
    let deployer = @0xD;
    let attacker = @0xBAD;
    let mut scenario = test_scenario::begin(deployer);
    setup_with_site(&mut scenario, deployer);
    // Switch the signer to a stranger and try to delete the deployer's site.
    scenario.next_tx(attacker);
    {
        let v = scenario.take_shared<Version>();
        let site = scenario.take_shared<Site>();
        // sender=attacker != site.owner (deployer) → aborts ENotOwner, so a
        // paid site cannot be vandalized by whoever passes it as a shared input.
        delete_site(site, &v, scenario.ctx());
        test_scenario::return_shared(v);
    };
    scenario.end();
}

#[test]
#[expected_failure(abort_code = deploy_sui::version::EWrongVersion)]
fun test_delete_site_aborts_when_frozen() {
    let deployer = @0xD;
    let mut scenario = test_scenario::begin(deployer);
    setup_with_site(&mut scenario, deployer);
    {
        let mut v = scenario.take_shared<Version>();
        let admin = scenario.take_from_sender<version::AdminCap>();
        let site = scenario.take_shared<Site>();
        admin.freeze_version(&mut v);
        // Version gate is the FIRST line, before the owner check: even the owner
        // cannot delete while the package is frozen.
        delete_site(site, &v, scenario.ctx());
        scenario.return_to_sender(admin);
        test_scenario::return_shared(v);
    };
    scenario.end();
}
