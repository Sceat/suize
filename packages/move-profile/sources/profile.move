/// Suize — the Business Profile NFT (one merchant identity, reused across ads + directory).
///
/// A business mints ONE `BusinessProfile` (an owned NFT with `Display<>`, so it renders in any
/// wallet / explorer): name · description · logo (`image_url`) · banner · website. The Suize ad
/// slots and the agents directory READ the holder/merchant's profile to render its branding —
/// so a business edits its identity ONCE and every ad + its directory row update together.
/// There is no per-slot creative blob.
///
/// === FLAT FEE (not the 2% rake) ===
/// `create_profile` + `edit_profile` each cost a FLAT fee (default $0.10) pushed to the Suize
/// treasury — a service charge / spam guard paid in the wallet (USDC). Separate from the x402
/// rail's 2% rake; this is the whole payment, sent in full to the treasury.
///
/// === NO REGISTRY ===
/// One profile per business by convention (the wallet creates one, then edits it). Off-chain
/// lookups resolve a business's profile by querying its OWNED `BusinessProfile` (take the
/// first) — no shared registry, nothing to contend on at mint.
module profile::profile;

use std::string::String;
use std::type_name::{Self, TypeName};
use sui::{
    balance::{Self, Balance},
    display,
    event,
    package,
};

// === Errors (PUBLIC CONTRACT — never renumber; scoped per module) ===
/// The pushed `payment` did not equal the config's flat fee (`payment.value() != fee`).
const EWrongFee: u64 = 0;
/// The pushed `payment`'s coin type `T` did not match the pinned settlement coin.
const EWrongCoin: u64 = 1;
/// `edit_profile` was called by someone other than the profile's `owner`.
const ENotOwner: u64 = 2;
/// A string field exceeded its byte cap (`MAX_FIELD_LEN` / `MAX_DESC_LEN`).
const EBadField: u64 = 3;
/// The shared `Version` doesn't match this published code (stale upgrade / freeze). The
/// 100-band marks an infra/version error vs the 0–3 domain errors.
const EWrongVersion: u64 = 100;

// === Constants ===
/// Default flat fee for create/edit: $0.10 at 6 decimals.
const DEFAULT_FEE: u64 = 100_000;
/// Max bytes for name / image_url / banner_url / website.
const MAX_FIELD_LEN: u64 = 256;
/// Max bytes for the description (longer than the other fields).
const MAX_DESC_LEN: u64 = 512;
/// The package version this published code expects.
const PACKAGE_VERSION: u64 = 1;

// === One-time witness (for `Display` + `Publisher`) ===
public struct PROFILE has drop {}

// === Structs ===

/// The business identity NFT — SOULBOUND (`key`, no `store`): owned by the business (the edit
/// authority), one per address by convention, NOT tradeable (an identity isn't an asset to
/// sell). `Display<BusinessProfile>` (set at `init`) still renders it in wallets / explorers.
public struct BusinessProfile has key {
    id: UID,
    /// The business address that minted it (the edit authority).
    owner: address,
    name: String,
    description: String,
    /// The logo / profile picture (an https image URL).
    image_url: String,
    /// The wide banner image (used by the ad slots).
    banner_url: String,
    /// The business's website.
    website: String,
}

/// The single, Suize-controlled, SHARED flat-fee + treasury policy. Mutated only via the
/// `ProfileAdminCap`.
public struct ProfileConfig has key {
    id: UID,
    /// Where the flat fee is sent (the Suize treasury).
    treasury: address,
    /// The flat fee for create/edit (base units).
    fee: u64,
    /// The PINNED settlement coin (USDC) once an admin pins it; `none` = any coin accepted.
    coin_type: Option<TypeName>,
}

/// Possession-is-authority admin capability for `ProfileConfig` + the version lifecycle.
public struct ProfileAdminCap has key, store { id: UID }

/// The version gate (mirrors `subs` / `auction`). Every user entry asserts it first.
public struct Version has key { id: UID, value: u64 }

// === Events ===
public struct ProfileCreated has copy, drop { profile_id: ID, owner: address, name: String }
public struct ProfileEdited has copy, drop { profile_id: ID, owner: address, name: String }

// === Init ===
fun init(otw: PROFILE, ctx: &mut TxContext) {
    // Display<BusinessProfile> so wallets / explorers render the NFT.
    let publisher = package::claim(otw, ctx);
    let mut disp = display::new<BusinessProfile>(&publisher, ctx);
    disp.add(b"name".to_string(), b"{name}".to_string());
    disp.add(b"description".to_string(), b"{description}".to_string());
    disp.add(b"image_url".to_string(), b"{image_url}".to_string());
    disp.add(b"link".to_string(), b"{website}".to_string());
    disp.add(b"project_url".to_string(), b"{website}".to_string());
    disp.update_version();
    transfer::public_transfer(disp, ctx.sender());
    transfer::public_transfer(publisher, ctx.sender());

    transfer::share_object(ProfileConfig {
        id: object::new(ctx),
        treasury: ctx.sender(),
        fee: DEFAULT_FEE,
        coin_type: option::none(),
    });
    transfer::share_object(Version { id: object::new(ctx), value: PACKAGE_VERSION });
    transfer::transfer(ProfileAdminCap { id: object::new(ctx) }, ctx.sender());
}

// === Version gate (ProfileAdminCap-gated lifecycle) ===
public fun assert_latest(self: &Version) {
    assert!(self.value == PACKAGE_VERSION, EWrongVersion);
}
public fun version_value(self: &Version): u64 { self.value }
public fun migrate(_cap: &ProfileAdminCap, version: &mut Version) {
    assert!(version.value < PACKAGE_VERSION, EWrongVersion);
    version.value = PACKAGE_VERSION;
}
public fun freeze_all(_cap: &ProfileAdminCap, version: &mut Version) { version.value = 0; }

// === Admin (ProfileAdminCap-gated) ===
public fun set_treasury(config: &mut ProfileConfig, _cap: &ProfileAdminCap, addr: address) {
    config.treasury = addr;
}
public fun set_fee(config: &mut ProfileConfig, _cap: &ProfileAdminCap, fee: u64) {
    config.fee = fee;
}
public fun set_coin_type<T>(config: &mut ProfileConfig, _cap: &ProfileAdminCap) {
    config.coin_type = option::some(type_name::with_defining_ids<T>());
}

// === Create — mint the business profile (flat fee → treasury) ===
public fun create_profile<T>(
    version: &Version,
    config: &ProfileConfig,
    payment: Balance<T>,
    name: String,
    description: String,
    image_url: String,
    banner_url: String,
    website: String,
    ctx: &mut TxContext,
) {
    version.assert_latest();
    assert_fields(&name, &description, &image_url, &banner_url, &website);
    charge(config, payment);

    let owner = ctx.sender();
    let p = BusinessProfile {
        id: object::new(ctx),
        owner,
        name,
        description,
        image_url,
        banner_url,
        website,
    };
    event::emit(ProfileCreated { profile_id: object::id(&p), owner, name: p.name });
    transfer::transfer(p, owner);
}

// === Edit — owner replaces the fields (flat fee → treasury) ===
public fun edit_profile<T>(
    version: &Version,
    config: &ProfileConfig,
    profile: &mut BusinessProfile,
    payment: Balance<T>,
    name: String,
    description: String,
    image_url: String,
    banner_url: String,
    website: String,
    ctx: &TxContext,
) {
    version.assert_latest();
    assert!(ctx.sender() == profile.owner, ENotOwner);
    assert_fields(&name, &description, &image_url, &banner_url, &website);
    charge(config, payment);

    profile.name = name;
    profile.description = description;
    profile.image_url = image_url;
    profile.banner_url = banner_url;
    profile.website = website;
    event::emit(ProfileEdited { profile_id: object::id(profile), owner: profile.owner, name: profile.name });
}

// === Internal ===
fun charge<T>(config: &ProfileConfig, payment: Balance<T>) {
    assert!(payment.value() == config.fee, EWrongFee);
    if (config.coin_type.is_some()) {
        assert!(type_name::with_defining_ids<T>() == *config.coin_type.borrow(), EWrongCoin);
    };
    balance::send_funds(payment, config.treasury);
}

fun assert_fields(
    name: &String,
    description: &String,
    image_url: &String,
    banner_url: &String,
    website: &String,
) {
    assert!(
        name.length() <= MAX_FIELD_LEN
            && image_url.length() <= MAX_FIELD_LEN
            && banner_url.length() <= MAX_FIELD_LEN
            && website.length() <= MAX_FIELD_LEN
            && description.length() <= MAX_DESC_LEN,
        EBadField,
    );
}

// === Read-only accessors ===
public fun owner(p: &BusinessProfile): address { p.owner }
public fun name(p: &BusinessProfile): String { p.name }
public fun description(p: &BusinessProfile): String { p.description }
public fun image_url(p: &BusinessProfile): String { p.image_url }
public fun banner_url(p: &BusinessProfile): String { p.banner_url }
public fun website(p: &BusinessProfile): String { p.website }
public fun treasury(c: &ProfileConfig): address { c.treasury }
public fun fee(c: &ProfileConfig): u64 { c.fee }

// === Test-only ===
#[test_only]
public fun init_for_testing(ctx: &mut TxContext) { init(PROFILE {}, ctx) }

#[test_only]
public fun created_event_for_testing(profile_id: ID, owner: address, name: String): ProfileCreated {
    ProfileCreated { profile_id, owner, name }
}
