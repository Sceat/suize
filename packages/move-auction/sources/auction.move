/// Suize — the on-chain ad-slot auction (the directory's monetization).
///
/// One product fact, stated once: `agents.suize.io` sells a fixed set of advertising
/// slots by CONTINUOUS ENGLISH AUCTION (King-of-the-Hill). Each `AdSlot` is a SHARED
/// object holding the current `price` + `holder` + `creative`. A bid must STRICTLY
/// EXCEED the standing price; on a winning bid the module carves the configured fee
/// (default 2% with a $0.01 floor — admin-settable, but NEVER waived) to the treasury
/// and `send_funds` the REMAINDER to the directory's payout address. The slot then
/// ratchets to the new price/holder/creative and emits `BidPlaced`; the displaced
/// holder is NOT refunded (they held the placement as paid ad time).
///
/// === WHY THIS IS "A PRODUCT ON THE SUIZE RAIL" ===
/// The directory is the merchant: every bid's net lands at `config.directory`, and the
/// fee leg lands at the Suize treasury — so an ad sale IS a payment on the rail, the
/// fee is visible in the balance-change set, and the directory shows up in its own live
/// feed (the treasury-inbound feed enumerates it like any other x402 payment).
///
/// === PUSH, NO ESCROW ===
/// An `AdSlot` holds NO balance. Each bid PUSHES exactly its `Balance<T>`; the module
/// splits the fee to the treasury and sends the rest to the directory in the SAME tx.
/// Nothing is custodied between bids, so there is no escrow to leak — the `price` is
/// simply the gross of the last winning bid. Bids are USER-SIGNED + Enoki-sponsored
/// (the same shape as a `subs::subscription` renewal); the chain is the only "who holds
/// the slot" store.
///
/// === FEE POLICY (shared, admin-tuned, never waived) ===
/// `fee = min(max(bid * fee_bps / 10_000, fee_floor), bid)` — rate + floor + treasury +
/// directory live in ONE Suize-controlled shared `AuctionConfig`, mutated only via the
/// `AuctionAdminCap` (possession-is-authority). The floor is always at least $0.01, so
/// EVERY ad sale credits the treasury — the merchant-agnostic feed depends on it.
module auction::auction;

use std::string::String;
use std::type_name::{Self, TypeName};
use sui::{
    balance::{Self, Balance},
    clock::Clock,
    event,
};

// === Errors ===
// Abort codes are part of this module's PUBLIC CONTRACT (the unit tests + the off-chain
// backend pattern-match the exact code). Do NOT renumber.

/// A bid did not STRICTLY exceed the slot's current price (`payment.value() <= price`).
const EBidTooLow: u64 = 0;
/// The pushed `payment`'s coin type `T` did not match the pinned settlement coin
/// (`config.coin_type`) — a worthless token posing as a real bid. Append-only.
const EWrongCoin: u64 = 1;
/// An admin tried to set a fee rate above 100% (`bps > 10_000`). Guards `set_fee`.
/// (Admin auth itself is by `&AuctionAdminCap` possession — no `ENotAdmin` code.)
const EInvalidRate: u64 = 2;
/// `create_slot` was called with an empty `name` or a zero `start_price` — a nameless
/// or free slot is meaningless.
const EBadSlot: u64 = 3;
/// `create_slot` was called before the settlement coin was pinned (`config.coin_type`
/// is `none`). A slot must not exist while bids could be paid in an ARBITRARY coin —
/// pinning first is the on-chain invariant (physics, not script ordering): without
/// this, a junk-coin bid would pass the type-blind `bid_amount > price` check and take
/// the slot for free while the config is unpinned. Append-only; never renumber.
const ECoinUnpinned: u64 = 4;
/// The shared `Version` doesn't match this published code — a STALE package version is in
/// play (after an upgrade, before `migrate`) or the module was frozen (value 0). Every
/// user/creation entry asserts `assert_latest` FIRST, so old code paths are fenced. The
/// 100-band marks an infra/version error vs the 0–7 domain errors. Append-only.
const EWrongVersion: u64 = 100;

// === Constants ===

/// Default take-rate: 2% (`fee_bps = 200`). Seeds `AuctionConfig.fee_bps` at `init`.
const DEFAULT_FEE_BPS: u16 = 200;
/// Default fee floor: $0.01 at 6 decimals (10_000). The fee is at LEAST this many base
/// units (clamped to the bid), so every ad sale always credits the treasury.
const DEFAULT_FEE_FLOOR: u64 = 10_000;
/// Basis-point denominator. `set_fee` rejects a rate AT OR ABOVE this (100%) — the
/// directory is the merchant being paid, so a winning bid must always leave it a
/// positive net leg (a 100% fee would send the whole bid to treasury, the directory 0).
const BPS_DENOMINATOR: u64 = 10_000;
/// The package version this published code expects. Bump on every upgrade that changes
/// version-gated behavior, then `migrate` to lift the shared `Version`. v1 = this gated
/// republish (the prior un-gated auction is abandoned).
const PACKAGE_VERSION: u64 = 1;

// === Structs ===

/// The module's one-time witness. Consumed by `init` to prove the `AuctionConfig` +
/// `AuctionAdminCap` are created exactly once, at publish, by the publisher.
public struct AUCTION has drop {}

/// The SINGLE, Suize-controlled, SHARED fee + payout policy. Non-generic — policy is
/// coin-agnostic. Created once at `init`, mutated ONLY via the `AuctionAdminCap`.
public struct AuctionConfig has key {
    id: UID,
    /// Where every fee is sent (the Suize treasury).
    treasury: address,
    /// Where each slot's NET proceeds go — the directory's own merchant address. This
    /// is what makes the ad sale a payment to the directory on the rail.
    directory: address,
    /// The take-rate in basis points (200 = 2%).
    fee_bps: u16,
    /// The minimum fee in base units ($0.01 = 10_000), clamped to the bid.
    fee_floor: u64,
    /// The PINNED settlement coin (USDC) once an admin calls `set_coin_type`. `none` =
    /// unpinned (any coin accepted); `some(T)` = `bid` REQUIRES the pushed `Balance<T>`'s
    /// `T` to equal it (`EWrongCoin`).
    coin_type: Option<TypeName>,
}

/// Possession-is-authority admin capability for `AuctionConfig` + slot creation. Held
/// by the publisher (Suize). Every admin fn takes `&AuctionAdminCap` — no address check,
/// no `ENotAdmin`: you simply cannot call an admin fn without the cap.
public struct AuctionAdminCap has key, store {
    id: UID,
}

/// A single advertising slot, sold by continuous English auction. SHARED (any bidder
/// mutates it through `bid`, which serializes through consensus). Holds NO balance.
/// `price` is the gross of the last winning bid; a new bid must strictly exceed it.
public struct AdSlot has key {
    id: UID,
    /// Human label (e.g. "hero", "feed-banner"). Fixed at creation.
    name: String,
    /// The current standing price — the gross of the last winning bid (base units).
    price: u64,
    /// The current ad holder (the last winning bidder). Genesis = the directory.
    holder: address,
    /// Wall-clock ms of the last winning bid (0 at genesis).
    last_bid_ms: u64,
}

/// The single shared version gate. Every user/creation entry (`bid`, `create_slot`)
/// takes `&Version` and calls `assert_latest()` first, so a stale package
/// version (after an upgrade, pre-`migrate`) — or a frozen module (value 0) — is locked
/// out. Created + shared once at `init`; lifted by the `AuctionAdminCap`-gated `migrate`.
public struct Version has key {
    id: UID,
    value: u64,
}

// === Events ===
// The on-chain activity log — the directory's live feed + the slot UI read these.

public struct SlotCreated has copy, drop {
    slot_id: ID,
    name: String,
    start_price: u64,
    holder: address,
}

public struct BidPlaced has copy, drop {
    slot_id: ID,
    slot_name: String,
    new_holder: address,
    new_price: u64,
    fee: u64,
    timestamp_ms: u64,
}

// === Init — the one-time config bootstrap ===

/// Runs ONCE at publish. Creates + SHARES the single `AuctionConfig` (treasury AND
/// directory default to the publisher; default 2% + $0.01 floor) and transfers the
/// `AuctionAdminCap` to the publisher. They then point treasury at `treasury@suize`,
/// point directory at the directory's payout address, pin USDC, and `create_slot` the
/// initial slots — all via the cap (the sync-auction-config script).
fun init(_otw: AUCTION, ctx: &mut TxContext) {
    transfer::share_object(AuctionConfig {
        id: object::new(ctx),
        treasury: ctx.sender(),
        directory: ctx.sender(),
        fee_bps: DEFAULT_FEE_BPS,
        fee_floor: DEFAULT_FEE_FLOOR,
        coin_type: option::none(),
    });
    transfer::share_object(Version { id: object::new(ctx), value: PACKAGE_VERSION });
    transfer::transfer(AuctionAdminCap { id: object::new(ctx) }, ctx.sender());
}

// === Version gate (AuctionAdminCap-gated lifecycle) ===

/// First line of every version-gated entry. Aborts `EWrongVersion` when the shared value
/// doesn't match this published code (a stale upgrade awaiting `migrate`, or a freeze).
public fun assert_latest(self: &Version) {
    assert!(self.value == PACKAGE_VERSION, EWrongVersion);
}

/// The live version value (off-chain inspection / tests).
public fun version_value(self: &Version): u64 { self.value }

/// Lift the shared `Version` to `PACKAGE_VERSION` after an upgrade. Asserts the stored
/// value is strictly older — no double-migrate. Possession of `&AuctionAdminCap` is auth.
public fun migrate(_cap: &AuctionAdminCap, version: &mut Version) {
    assert!(version.value < PACKAGE_VERSION, EWrongVersion);
    version.value = PACKAGE_VERSION;
}

/// Emergency freeze: zero the version so EVERY gated entry aborts at once. Reversible by
/// `migrate` alone (0 < PACKAGE_VERSION lifts it back) — no permanent brick; a real code
/// upgrade bumps PACKAGE_VERSION first. Possession of `&AuctionAdminCap` is auth.
public fun freeze_all(_cap: &AuctionAdminCap, version: &mut Version) {
    version.value = 0;
}

// === Admin (AuctionAdminCap-gated) ===
// Possession of `&AuctionAdminCap` IS the authorization. The only abort is
// `EInvalidRate` on an out-of-range bps.

/// Redirect every future fee to a new treasury.
public fun set_treasury(config: &mut AuctionConfig, _cap: &AuctionAdminCap, addr: address) {
    config.treasury = addr;
}

/// Redirect every future slot's net proceeds to a new directory payout address.
public fun set_directory(config: &mut AuctionConfig, _cap: &AuctionAdminCap, addr: address) {
    config.directory = addr;
}

/// Set the take-rate (bps) + the fee floor (base units). Aborts `EInvalidRate` if
/// `bps >= 10_000` — a 100% fee would leave the directory's net leg at zero, and the
/// directory is the merchant a winning bid pays.
public fun set_fee(config: &mut AuctionConfig, _cap: &AuctionAdminCap, bps: u16, floor: u64) {
    assert!((bps as u64) < BPS_DENOMINATOR, EInvalidRate);
    config.fee_bps = bps;
    config.fee_floor = floor;
}

/// PIN the settlement coin to `T` (in production: USDC). Once set, `bid` rejects a
/// payment in any other coin (`EWrongCoin`). Re-callable to repoint.
public fun set_coin_type<T>(config: &mut AuctionConfig, _cap: &AuctionAdminCap) {
    config.coin_type = option::some(type_name::with_defining_ids<T>());
}

/// Create + SHARE a new ad slot, genesis-held by the directory at `start_price`.
/// Admin-only (cap-gated). Aborts `EBadSlot` on an empty name or zero start price.
public fun create_slot(
    version: &Version,
    config: &AuctionConfig,
    _cap: &AuctionAdminCap,
    name: String,
    start_price: u64,
    ctx: &mut TxContext,
) {
    version.assert_latest();
    assert!(start_price > 0 && name.length() > 0, EBadSlot);
    assert!(config.coin_type.is_some(), ECoinUnpinned);
    let slot = AdSlot {
        id: object::new(ctx),
        name,
        price: start_price,
        holder: config.directory,
        last_bid_ms: 0,
    };
    event::emit(SlotCreated {
        slot_id: object::id(&slot),
        name: slot.name,
        start_price,
        holder: slot.holder,
    });
    transfer::share_object(slot);
}

// === Bid — take the slot by over-bidding ===

/// Take a slot by pushing a bid that STRICTLY exceeds its current price. The bid's net
/// (after the fee) goes to the directory; the fee goes to the treasury; the slot
/// ratchets to the new price/holder. Callable by anyone (the slot is shared);
/// the bidder SIGNS (gas Enoki-sponsored).
///
/// Aborts: `EBidTooLow` (bid <= price) before any money moves; `EWrongCoin` (in
/// `settle`) if the coin is pinned and `T` doesn't match.
public fun bid<T>(
    version: &Version,
    slot: &mut AdSlot,
    config: &AuctionConfig,
    payment: Balance<T>,
    clock: &Clock,
    ctx: &TxContext,
) {
    version.assert_latest();
    let bid_amount = payment.value();
    assert!(bid_amount > slot.price, EBidTooLow);

    let fee = settle(config, bid_amount, payment);

    slot.price = bid_amount;
    slot.holder = ctx.sender();
    slot.last_bid_ms = clock.timestamp_ms();

    event::emit(BidPlaced {
        slot_id: object::id(slot),
        slot_name: slot.name,
        new_holder: slot.holder,
        new_price: slot.price,
        fee,
        timestamp_ms: slot.last_bid_ms,
    });
}

// === Internal — the fee split (push, no escrow) ===

/// Settle one pushed bid: optionally assert the coin pin, carve the fee to the
/// treasury, send the rest to the directory. Returns the fee for the event.
///
/// FEE = `min(max(bid * fee_bps / 10_000, fee_floor), bid)` — the 2% with a $0.01
/// floor, CLAMPED to the bid so a bid smaller than the floor never underflows (the
/// directory simply receives 0 — no abort; can't happen with a $50 start price, but
/// the clamp is the same belt-and-braces as `subs::settle`).
fun settle<T>(config: &AuctionConfig, bid_amount: u64, mut payment: Balance<T>): u64 {
    if (config.coin_type.is_some()) {
        assert!(type_name::with_defining_ids<T>() == *config.coin_type.borrow(), EWrongCoin);
    };

    // Widen to u128 so `bid_amount * fee_bps` cannot overflow u64; the quotient by
    // BPS_DENOMINATOR is always <= bid_amount, so the cast back to u64 is safe.
    let pct = (((bid_amount as u128) * (config.fee_bps as u128) / (BPS_DENOMINATOR as u128)) as u64);
    let floored = if (pct > config.fee_floor) pct else config.fee_floor;
    let fee = if (floored < bid_amount) floored else bid_amount;

    balance::send_funds(payment.split(fee), config.treasury);
    balance::send_funds(payment, config.directory);
    fee
}

// === Read-only accessors ===
// Plain `public`: the off-chain backend + UI read these via `devInspect`, the tests
// assert on them.

public fun name(slot: &AdSlot): String { slot.name }

public fun price(slot: &AdSlot): u64 { slot.price }

public fun holder(slot: &AdSlot): address { slot.holder }

public fun last_bid_ms(slot: &AdSlot): u64 { slot.last_bid_ms }

// --- AuctionConfig accessors ---

public fun treasury(config: &AuctionConfig): address { config.treasury }

public fun directory(config: &AuctionConfig): address { config.directory }

public fun fee_bps(config: &AuctionConfig): u16 { config.fee_bps }

public fun fee_floor(config: &AuctionConfig): u64 { config.fee_floor }

public fun coin_type(config: &AuctionConfig): Option<TypeName> { config.coin_type }

// === Test-only ===

/// Run the publish-time `init` from a test scenario (the OTW can't be fabricated by
/// tests otherwise). Shares the `AuctionConfig` and transfers the `AuctionAdminCap`
/// to the tx sender, exactly as a real publish would.
#[test_only]
public fun init_for_testing(ctx: &mut TxContext) {
    init(AUCTION {}, ctx)
}

/// Build the `BidPlaced` event a test EXPECTS, so `event::events_by_type<BidPlaced>()`
/// can be asserted field-for-field (event fields are private outside this module).
#[test_only]
public fun bid_event_for_testing(
    slot_id: ID,
    slot_name: String,
    new_holder: address,
    new_price: u64,
    fee: u64,
    timestamp_ms: u64,
): BidPlaced {
    BidPlaced { slot_id, slot_name, new_holder, new_price, fee, timestamp_ms }
}

/// Build the `SlotCreated` event a test EXPECTS.
#[test_only]
public fun slot_created_event_for_testing(
    slot_id: ID,
    name: String,
    start_price: u64,
    holder: address,
): SlotCreated {
    SlotCreated { slot_id, name, start_price, holder }
}

/// Read the `slot_id` off an emitted `BidPlaced` (private outside this module).
#[test_only]
public fun bid_slot_id(e: &BidPlaced): ID { e.slot_id }

/// Read the `fee` off an emitted `BidPlaced`.
#[test_only]
public fun bid_fee_for_testing(e: &BidPlaced): u64 { e.fee }

/// Read the `slot_id` off an emitted `SlotCreated`.
#[test_only]
public fun created_slot_id(e: &SlotCreated): ID { e.slot_id }
