/// Suize — the standalone subscription module (the recurring half of the rail).
///
/// One product fact, stated once (detail: `packages/move-subs/SPEC.md`): a
/// `Subscription<T>` is a **Party-owned, soulbound** object the user signs into
/// existence with ONE transaction, paying the first period inline so premium is
/// active immediately. Every later renewal is the SAME shape — a user-signed,
/// gas-sponsored tx that pays exactly one period and advances the paid-through
/// clock — so the off-chain relayer never holds a key and the chain itself is the
/// double-charge guard (a second in-window renewal aborts `ETooEarly`).
///
/// === WHY A PARTY OBJECT (not shared, not address-owned) ===
/// The renewal path must (a) be triggerable on a schedule without the relayer
/// signing as the owner, yet (b) never be double-spent under a race. A shared
/// object loses the fast-path and invites contention; a plain address-owned
/// object can't be co-driven by a sponsor in the clean way Party allows. A
/// single-owner `Party` object is owned by exactly one address (the user) and
/// goes through consensus, so:
///   - only the user authorizes a mutation (the user signs every renewal — their
///     own zkLogin session; the backend only SPONSORS gas),
///   - concurrent renewal attempts serialize, and the loser aborts cleanly on the
///     `ETooEarly` time-gate rather than racing a balance.
/// The object is SOULBOUND — `Subscription<T>` has `key` but NO `store`, so the
/// only exit is `cancel` (which `object::delete`s it). It can never be wrapped,
/// sold, or party-transferred out of its module by a third party.
///
/// === PUSH, NOT PULL (the funding model) ===
/// Unlike `account.move`'s pull-from-a-funded-balance model, a `Subscription` holds
/// NO balance. Each period the caller PUSHES exactly one period's `Balance<T>` into
/// `create` / `renew`; the module asserts `payment.value() == amount`, carves the
/// 2% (with a $0.01 floor) to the treasury, and `send_funds` the rest to the
/// merchant. Nothing is custodied between periods — the user signs and funds each
/// renewal, so there is no standing allowance to drain and no balance to under-fund.
///
/// === COIN-TYPE DECISION (generic core, USDC in practice) ===
/// `Subscription<phantom T>` is generic over ONE settlement coin. In production it
/// is `Subscription<USDC>`; keeping it generic lets the unit tests fabricate a
/// throwaway coin type with zero external deps and keeps the door open for other
/// settlement coins. Phantom because `T` appears only inside the pushed
/// `Balance<T>`, never stored on the object.
///
/// === FEE POLICY ===
/// 2% (`DEFAULT_FEE_BPS`) with a $0.01 floor (`DEFAULT_FEE_FLOOR`, 10_000 at 6
/// decimals), MERCHANT-ABSORBED: the user pays exactly `amount`, the treasury takes
/// `min(max(amount*bps/10_000, floor), amount)`, the merchant gets the rest. The
/// rate + floor + treasury live in ONE Suize-controlled shared `SubsConfig`,
/// mutated only via the `SubsAdminCap` (possession-is-authority — no merchant can
/// zero their own fee). The floor clamps to `amount` so a tiny subscription never
/// underflows (the merchant just receives 0 — see `settle`).
module subs::subscription;

use std::type_name::{Self, TypeName};
use sui::{
    balance::{Self, Balance},
    clock::Clock,
    event,
    party,
};

// === Errors ===
// Abort codes are part of this module's PUBLIC CONTRACT: the unit tests and the
// off-chain relayer both pattern-match on the exact code. Do NOT renumber.

/// `renew` was called before the period's renewal window opened
/// (`now + RENEW_WINDOW_MS < paid_until_ms`) — the time-gate: a subscription can
/// NEVER be charged more than 24h ahead of its paid-through, and a second in-window
/// renewal aborts here (the on-chain double-charge guard).
const ETooEarly: u64 = 0;
/// The pushed `payment` did not equal exactly one period's `amount`
/// (`payment.value() != amount`) — over- OR under-payment. The caller must push the
/// exact period price.
const EWrongAmount: u64 = 1;
/// `create` was called with a zero `amount` or zero `period_ms` — a subscription
/// with no price or no period is meaningless.
const EBadTerms: u64 = 2;
/// An admin tried to set a fee rate above 100% (`bps > 10_000`). Guards `set_fee`.
/// (Admin auth itself is by `&SubsAdminCap` possession — no abort code.)
const EInvalidRate: u64 = 3;
/// The pushed `payment`'s coin type `T` did not match the merchant's PINNED settlement
/// coin (`config.coin_type`). Once an admin pins the coin (USDC) via `set_coin_type`, a
/// subscription paid in any OTHER coin — a worthless token posing as a real payment —
/// aborts here. Append-only (4); never renumber.
const EWrongCoin: u64 = 4;
/// The shared `Version` doesn't match this published code — a STALE package version (after
/// an upgrade, pre-`migrate`) or a frozen module (value 0). Every user entry
/// (`create`/`renew`/`cancel`) asserts `assert_latest` FIRST, so old code paths are fenced.
/// The 100-band marks an infra/version error vs the 0–4 domain errors. Append-only.
const EWrongVersion: u64 = 100;

// === Constants ===

/// Early-renew window: a renewal is allowed once the subscription is within 24h of
/// its paid-through (`now + RENEW_WINDOW_MS >= paid_until_ms`). Lets the relayer fire
/// a renewal slightly ahead of expiry so the site never lapses, while still
/// forbidding a second charge for the same period.
const RENEW_WINDOW_MS: u64 = 86_400_000; // 24h
/// Default take-rate: 2% (`fee_bps = 200`). Seeds `SubsConfig.fee_bps` at `init`.
const DEFAULT_FEE_BPS: u16 = 200;
/// Default fee floor: $0.01 at 6 decimals (10_000). The fee is at LEAST this many
/// base units, so a 2%-of-a-tiny-amount fee never rounds to dust — but it is clamped
/// to `amount` so it can never exceed the payment (see `settle`).
const DEFAULT_FEE_FLOOR: u64 = 10_000;
/// Basis-point denominator: `fee = amount * fee_bps / 10_000`. Also the hard upper
/// bound on any settable rate (100%).
const BPS_DENOMINATOR: u64 = 10_000;
/// The longest a single period may be (~10 years). `create` caps `period_ms` at this so
/// a near-`u64::MAX` period can't overflow `now + period_ms` — it aborts cleanly as
/// `EBadTerms` instead. Renewals reuse the fixed `period_ms`, so the cap is enforced once.
const MAX_PERIOD_MS: u64 = 315_360_000_000; // 10 * 365 * 24 * 60 * 60 * 1000
/// The package version this published code expects. Bump on every upgrade that changes
/// version-gated behavior, then `migrate` to lift the shared `Version`. v1 = this gated
/// republish (the prior un-gated subs publish is abandoned).
const PACKAGE_VERSION: u64 = 1;

// === Structs ===

/// The module's one-time witness. Consumed by `init` to prove the `SubsConfig` +
/// `SubsAdminCap` are created exactly once, at publish, by the publisher.
public struct SUBSCRIPTION has drop {}

/// The SINGLE, Suize-controlled, SHARED fee policy. NON-generic — fee policy is
/// coin-agnostic (a bps rate + a floor + a recipient apply to any
/// `Subscription<T>`). Created once at `init`, mutated ONLY via the `SubsAdminCap`.
public struct SubsConfig has key {
    id: UID,
    /// Where every fee is sent (the Suize treasury).
    treasury: address,
    /// The take-rate in basis points (200 = 2%).
    fee_bps: u16,
    /// The minimum fee in base units ($0.01 = 10_000 at 6 decimals), clamped to
    /// `amount` so a tiny subscription never underflows.
    fee_floor: u64,
    /// The PINNED settlement coin (USDC) once an admin calls `set_coin_type`. `none` =
    /// unpinned: any coin is accepted (the pre-pin / generic-core state). `some(T)` =
    /// `create`/`renew` REQUIRE the pushed `Balance<T>`'s `T` to equal it (`EWrongCoin`),
    /// so a `Subscription<JunkCoin>` cannot pose as a real (USDC) payment on-chain.
    coin_type: Option<TypeName>,
}

/// Possession-is-authority admin capability for `SubsConfig`. Held by the publisher
/// (Suize). Every config mutator takes `&SubsAdminCap` — there is NO address check
/// and NO `ENotAdmin` code: you simply cannot call an admin fn without the cap.
public struct SubsAdminCap has key, store {
    id: UID,
}

/// The single shared version gate. Every user entry (`create`, `renew`, `cancel`) takes
/// `&Version` and calls `assert_latest()` first, so a stale package version (after an
/// upgrade, pre-`migrate`) — or a frozen module (value 0) — is locked out. Created +
/// shared once at `init`; lifted by the `SubsAdminCap`-gated `migrate`.
public struct Version has key {
    id: UID,
    value: u64,
}

/// A live subscription. PARTY-OWNED (single-owner = the user) + SOULBOUND: `key`
/// but NO `store`, so the only exit is `cancel`. Holds NO balance — each period is
/// pushed into `renew`. The `merchant` + `amount` + `period_ms` are FIXED at
/// creation; only `paid_until_ms` advances. `phantom T` is the settlement coin.
public struct Subscription<phantom T> has key {
    id: UID,
    /// The FIXED recipient of every period's net. Set at creation, never redirected.
    merchant: address,
    /// The per-period price the caller must push EXACTLY (in base units).
    amount: u64,
    /// The period length in ms. Each renewal extends `paid_until_ms` by this.
    period_ms: u64,
    /// Wall-clock ms through which the subscription is paid. `is_active` ⇔
    /// `now < paid_until_ms`.
    paid_until_ms: u64,
    /// Merchant-supplied opaque reference (e.g. a plan / customer id) echoed into
    /// every event so the merchant can self-index renewals without a Suize lookup.
    ref: vector<u8>,
}

// === Events ===
// The on-chain activity log — both the merchant (self-indexing via `ref`) and the
// wallet timeline read these. Every event carries enough to reconcile a period
// without an off-chain store (push, not pull, on the read side too).

public struct SubscriptionCreated has copy, drop {
    subscription_id: ID,
    owner: address,
    merchant: address,
    amount: u64,
    period_ms: u64,
    paid_until_ms: u64,
    fee: u64,
    ref: vector<u8>,
}

public struct SubscriptionRenewed has copy, drop {
    subscription_id: ID,
    owner: address,
    merchant: address,
    amount: u64,
    fee: u64,
    paid_until_ms: u64,
    ref: vector<u8>,
}

public struct SubscriptionCancelled has copy, drop {
    subscription_id: ID,
    owner: address,
    merchant: address,
    /// Carried so a merchant MAY honor the remaining paid-through time after cancel.
    paid_until_ms: u64,
    ref: vector<u8>,
}

// === Init — the one-time config bootstrap ===

/// Runs ONCE at publish. Creates + SHARES the single `SubsConfig` (treasury = the
/// publisher, default 2% + $0.01 floor) and transfers the `SubsAdminCap` to the
/// publisher (whoever signs the publish tx). They can later retune the rate / floor
/// / treasury via the cap, and transfer the cap to a multisig/treasury.
fun init(_otw: SUBSCRIPTION, ctx: &mut TxContext) {
    transfer::share_object(SubsConfig {
        id: object::new(ctx),
        treasury: ctx.sender(),
        fee_bps: DEFAULT_FEE_BPS,
        fee_floor: DEFAULT_FEE_FLOOR,
        // Unpinned at publish — an admin pins USDC via `set_coin_type<USDC>` right after
        // (the sync-subs-config script). Until then any coin is accepted (the off-chain
        // merchant gate is the live defense; this on-chain pin is the second wall).
        coin_type: option::none(),
    });
    transfer::share_object(Version { id: object::new(ctx), value: PACKAGE_VERSION });
    transfer::transfer(SubsAdminCap { id: object::new(ctx) }, ctx.sender());
}

// === Version gate (SubsAdminCap-gated lifecycle) ===

/// First line of every version-gated entry. Aborts `EWrongVersion` when the shared value
/// doesn't match this published code (a stale upgrade awaiting `migrate`, or a freeze).
public fun assert_latest(self: &Version) {
    assert!(self.value == PACKAGE_VERSION, EWrongVersion);
}

/// The live version value (off-chain inspection / tests).
public fun version_value(self: &Version): u64 { self.value }

/// Lift the shared `Version` to `PACKAGE_VERSION` after an upgrade. Asserts the stored
/// value is strictly older — no double-migrate. Possession of `&SubsAdminCap` is auth.
public fun migrate(_cap: &SubsAdminCap, version: &mut Version) {
    assert!(version.value < PACKAGE_VERSION, EWrongVersion);
    version.value = PACKAGE_VERSION;
}

/// Emergency freeze: zero the version so EVERY gated entry aborts at once. Reversible by
/// `migrate` alone (0 < PACKAGE_VERSION lifts it back) — no permanent brick; a real code
/// upgrade bumps PACKAGE_VERSION first. Possession of `&SubsAdminCap` is auth.
public fun freeze_all(_cap: &SubsAdminCap, version: &mut Version) {
    version.value = 0;
}

// === Admin — fee policy (SubsAdminCap-gated) ===
// Possession of `&SubsAdminCap` IS the authorization (no address check, no
// `ENotAdmin`). The only abort is `EInvalidRate` on an out-of-range bps.

/// Redirect every future fee to a new treasury.
public fun set_treasury(config: &mut SubsConfig, _cap: &SubsAdminCap, addr: address) {
    config.treasury = addr;
}

/// Set the take-rate (bps) + the fee floor (base units). Aborts `EInvalidRate` if
/// `bps > 10_000`.
public fun set_fee(config: &mut SubsConfig, _cap: &SubsAdminCap, bps: u16, floor: u64) {
    assert!((bps as u64) <= BPS_DENOMINATOR, EInvalidRate);
    config.fee_bps = bps;
    config.fee_floor = floor;
}

/// PIN the settlement coin to `T` (in production: USDC). Once set, `create`/`renew`
/// reject a payment in any other coin (`EWrongCoin`), so a worthless-coin subscription
/// cannot exist against this config. Re-callable to repoint (e.g. the testnet→mainnet
/// USDC type). The fee policy stays coin-agnostic — this only constrains WHICH coin
/// counts as a real payment. Run via the sync-subs-config script after each publish.
public fun set_coin_type<T>(config: &mut SubsConfig, _cap: &SubsAdminCap) {
    config.coin_type = option::some(type_name::with_defining_ids<T>());
}

// === Create — first period paid inline, premium active immediately ===

/// Create a subscription, paying the FIRST period inline. ONE signature: the user
/// signs (gas sponsored), pushes exactly one period's `payment`, and walks away with
/// `paid_until_ms = now + period_ms` — premium is live the instant this returns.
///
/// The new `Subscription<T>` is PARTY-transferred to `single_owner(sender)` — owned
/// by the user, soulbound (no `store`), driveable only with the user's signature.
///
/// Aborts: `EBadTerms` (zero amount or zero period) before any money moves;
/// `EWrongAmount` (in `settle`) if `payment != amount`.
public fun create<T>(
    version: &Version,
    config: &SubsConfig,
    merchant: address,
    amount: u64,
    period_ms: u64,
    ref: vector<u8>,
    payment: Balance<T>,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    version.assert_latest();
    assert!(amount > 0 && period_ms > 0 && period_ms <= MAX_PERIOD_MS, EBadTerms);

    let fee = settle(config, merchant, amount, payment);

    let owner = ctx.sender();
    let paid_until_ms = clock.timestamp_ms() + period_ms;
    let sub = Subscription<T> {
        id: object::new(ctx),
        merchant,
        amount,
        period_ms,
        paid_until_ms,
        ref,
    };

    event::emit(SubscriptionCreated {
        subscription_id: object::id(&sub),
        owner,
        merchant,
        amount,
        period_ms,
        paid_until_ms,
        fee,
        ref,
    });

    transfer::party_transfer(sub, party::single_owner(owner));
}

// === Renew — one user-signed, sponsored period ===

/// Charge one period. Callable only by the user (the object is single-owner Party);
/// the relayer SPONSORS the gas, the user's session SIGNS. Permissioned by ownership,
/// gated in time by the renewal window.
///
/// DOUBLE-CHARGE PHYSICS: the window opens 24h before `paid_until_ms`
/// (`now + RENEW_WINDOW_MS >= paid_until_ms`); a second renewal within the same
/// period fails the same check (`ETooEarly`), and Party single-ownership serializes
/// concurrent attempts so the loser aborts cleanly rather than racing a balance.
///
/// ANTI-BACK-BILLING ADVANCE: `paid_until_ms = max(paid_until_ms, now) + period_ms`.
/// If the subscription lapsed (`now > paid_until_ms`), the new period starts at
/// `now` — the user is NOT back-billed for the dead time. If renewing early (within
/// the window, not yet lapsed), it extends the existing paid-through, so no period
/// is lost.
///
/// Aborts: `ETooEarly` (too far ahead of paid-through); `EWrongAmount` (in `settle`).
public fun renew<T>(
    version: &Version,
    sub: &mut Subscription<T>,
    config: &SubsConfig,
    payment: Balance<T>,
    clock: &Clock,
    ctx: &TxContext,
) {
    version.assert_latest();
    let now = clock.timestamp_ms();
    assert!(now + RENEW_WINDOW_MS >= sub.paid_until_ms, ETooEarly);

    let fee = settle(config, sub.merchant, sub.amount, payment);

    let base = if (sub.paid_until_ms > now) sub.paid_until_ms else now;
    sub.paid_until_ms = base + sub.period_ms;

    event::emit(SubscriptionRenewed {
        subscription_id: object::id(sub),
        owner: ctx.sender(),
        merchant: sub.merchant,
        amount: sub.amount,
        fee,
        paid_until_ms: sub.paid_until_ms,
        ref: sub.ref,
    });
}

// === Cancel — the only exit (soulbound destroy) ===

/// Cancel + destroy the subscription. Callable only by the user (single-owner
/// Party). Emits `SubscriptionCancelled` carrying `paid_until_ms` — a merchant MAY
/// honor the remaining paid-through time. No fee, no refund: nothing is custodied,
/// so there is nothing to return.
public fun cancel<T>(version: &Version, sub: Subscription<T>, ctx: &TxContext) {
    version.assert_latest();
    let Subscription { id, merchant, amount: _, period_ms: _, paid_until_ms, ref } = sub;

    event::emit(SubscriptionCancelled {
        subscription_id: id.to_inner(),
        owner: ctx.sender(),
        merchant,
        paid_until_ms,
        ref,
    });

    id.delete();
}

// === Internal — the fee split (push model) ===

/// Settle one pushed period: assert `payment` is EXACTLY `amount`, carve the fee to
/// the treasury, send the rest to the merchant. Returns the fee for the event.
///
/// FEE = `min(max(amount * fee_bps / 10_000, fee_floor), amount)` — the 2% with a
/// $0.01 floor, CLAMPED to `amount` so a subscription smaller than the floor never
/// underflows (the merchant simply receives 0 for that period — no abort). Both legs
/// go to the address funds accumulator via `send_funds` (Address Balances), so there
/// is no `Coin` minting and no gas object churn.
fun settle<T>(config: &SubsConfig, merchant: address, amount: u64, mut payment: Balance<T>): u64 {
    assert!(payment.value() == amount, EWrongAmount);
    // COIN-TYPE PIN: once an admin pins the settlement coin (USDC), reject a payment in
    // any other coin — a `Subscription<JunkCoin>` is not a real payment. `none` = unpinned
    // (generic core / pre-pin). Both `create` and `renew` route through here, so the pin
    // covers both. Comparison uses the same `with_defining_ids` form as `set_coin_type`.
    if (config.coin_type.is_some()) {
        assert!(type_name::with_defining_ids<T>() == *config.coin_type.borrow(), EWrongCoin);
    };

    // Widen the multiply to u128 so `amount * fee_bps` cannot overflow u64 (which
    // would abort safely above ~$1.84B, but is unnecessary). The product
    // (amount ≤ u64::MAX) * (fee_bps ≤ 10_000) fits u128 with vast headroom; the
    // quotient by BPS_DENOMINATOR is always ≤ amount, so the cast back to u64 is safe.
    let pct = (((amount as u128) * (config.fee_bps as u128) / (BPS_DENOMINATOR as u128)) as u64);
    let floored = if (pct > config.fee_floor) pct else config.fee_floor;
    let fee = if (floored < amount) floored else amount;

    balance::send_funds(payment.split(fee), config.treasury);
    balance::send_funds(payment, merchant);
    fee
}

// === Read-only accessors ===
// Plain `public` (not `public(package)`): the off-chain relayer + UI read these via
// `devInspect`, and the tests assert on them.

public fun merchant<T>(sub: &Subscription<T>): address { sub.merchant }

public fun amount<T>(sub: &Subscription<T>): u64 { sub.amount }

public fun period_ms<T>(sub: &Subscription<T>): u64 { sub.period_ms }

public fun paid_until_ms<T>(sub: &Subscription<T>): u64 { sub.paid_until_ms }

public fun ref<T>(sub: &Subscription<T>): vector<u8> { sub.ref }

/// `true` while the subscription is paid through the current time.
public fun is_active<T>(sub: &Subscription<T>, clock: &Clock): bool {
    clock.timestamp_ms() < sub.paid_until_ms
}

// --- SubsConfig accessors ---

public fun treasury(config: &SubsConfig): address { config.treasury }

public fun fee_bps(config: &SubsConfig): u16 { config.fee_bps }

public fun fee_floor(config: &SubsConfig): u64 { config.fee_floor }

/// The pinned settlement coin, or `none` if unpinned. The sync-subs-config script reads
/// this to stay idempotent (only re-pins when unset or pointing at a different coin).
public fun coin_type(config: &SubsConfig): Option<TypeName> { config.coin_type }

// === Test-only ===

/// Run the publish-time `init` from a test scenario (the OTW can't be fabricated by
/// tests otherwise). Shares the `SubsConfig` and transfers the `SubsAdminCap` to the
/// tx sender, exactly as a real publish would.
#[test_only]
public fun init_for_testing(ctx: &mut TxContext) {
    init(SUBSCRIPTION {}, ctx)
}

/// Build the `SubscriptionCreated` event a test EXPECTS, so
/// `event::events_by_type<SubscriptionCreated>()` can be asserted field-for-field
/// (event fields are private outside this module; a constructor beats a pile of
/// accessors).
#[test_only]
public fun created_event_for_testing(
    subscription_id: ID,
    owner: address,
    merchant: address,
    amount: u64,
    period_ms: u64,
    paid_until_ms: u64,
    fee: u64,
    ref: vector<u8>,
): SubscriptionCreated {
    SubscriptionCreated { subscription_id, owner, merchant, amount, period_ms, paid_until_ms, fee, ref }
}

/// The `SubscriptionRenewed` expectation builder.
#[test_only]
public fun renewed_event_for_testing(
    subscription_id: ID,
    owner: address,
    merchant: address,
    amount: u64,
    fee: u64,
    paid_until_ms: u64,
    ref: vector<u8>,
): SubscriptionRenewed {
    SubscriptionRenewed { subscription_id, owner, merchant, amount, fee, paid_until_ms, ref }
}

/// The `SubscriptionCancelled` expectation builder.
#[test_only]
public fun cancelled_event_for_testing(
    subscription_id: ID,
    owner: address,
    merchant: address,
    paid_until_ms: u64,
    ref: vector<u8>,
): SubscriptionCancelled {
    SubscriptionCancelled { subscription_id, owner, merchant, paid_until_ms, ref }
}

/// Read the `subscription_id` off an emitted event (private outside this module).
/// Lets a test fetch the object id from the receipt without first taking the
/// party-owned object (which would advance the tx and clear the event buffer).
#[test_only]
public fun created_subscription_id(e: &SubscriptionCreated): ID { e.subscription_id }

#[test_only]
public fun renewed_subscription_id(e: &SubscriptionRenewed): ID { e.subscription_id }
