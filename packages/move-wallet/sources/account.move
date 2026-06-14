/// Suize — the irreducible core: the `Account` (PAY + CHARGE primitives).
///
/// THE CORE (canonical, `docs/wallet/SPEC.md`): Suize is the money layer for AI
/// agents — "Stripe + Revolut for agents." Exactly TWO primitives:
///
///   ① PAY    — the user has a gasless USDC wallet; the user funds it (`deposit`)
///              and `spend()`s from it for anything. `spend` is OWNER-ONLY: the
///              user's own zkLogin session (a LOCAL Enoki MCP on the user's
///              machine) signs as the owner. The deposit balance is the ONLY cap;
///              there is no budget / scope / payee-allow-list / expiry
///              (monkey-simple).
///   ② CHARGE — anyone can charge an Account via an owner-approved `Subscription`
///              that a backend/anyone can `charge_subscription` on, capped
///              per-period and time-gated by the `Clock` so it can never debit
///              early or twice in a period. The 2% fee is split inside
///              `charge_subscription` (the CHARGE path) before the payee transfer.
///
/// === AUTHORITY MODEL (founder decision — OWNER-ONLY, fully non-custodial) ===
/// There is NO on-chain agent identity at all. Signing happens LOCALLY in the
/// user's own Enoki zkLogin session (a local MCP on the user's machine); the
/// backend NEVER signs. `spend` is authorized exactly like every other owner path:
/// `sender == account.owner`. The consequences:
///   - DEPOSIT funds the wallet; the OWNER (and only the owner) spends it. Keys
///     never leave the user's machine — fully non-custodial.
///   - There is no `agent@suize` global name, no SuiNS resolution, no `set_agent`,
///     no per-Account agent slot, and no on-chain delegation.
///   - KILL is the user stopping their local MCP / withdrawing their balance. No
///     on-chain `pause` switch is needed: nothing can spend without the owner's
///     own signature in the first place.
///
/// FEE MODEL (founder decision — Revolut-free-sends + Stripe-merchant-fees):
///   - `spend` (PAY) is FREE — sending coins to a payee pays nothing; the full
///     amount lands with the payee, nothing goes to `fee_recipient`.
///   - `charge` / `charge_subscription` / `pay` (CHARGE) take the fee — a business
///     accepting a payment pays it.
///
/// === FEE POLICY IS SUIZE'S, NOT THE USER'S (founder decision) ===
/// The take-rate does NOT live on the `Account` (a merchant could zero their own
/// `fee_bps` and pay Suize nothing, and there'd be no way to grant a specific
/// merchant a lower rate). It lives in ONE Suize-controlled shared `RailConfig`:
///   - `default_fee_bps` (200 = 2%) applies to every merchant by default,
///   - `overrides: Table<address, u16>` grants a per-merchant rate (typically a
///     discount, but any rate ≤ 10_000 is allowed),
///   - `fee_recipient` is the single Suize treasury for the whole rail.
/// `charge` / `charge_subscription` / `pay` each take `&RailConfig` and resolve the
/// rate against the relevant merchant address (the `charge` / `pay` merchant param,
/// the subscription's fixed `payee`). Only the holder of the `RailAdminCap` (the
/// publisher) can mutate the config.
///
/// This module SUPERSEDES the mandate/vault cage (kept in the package as legacy
/// adapters). The one good idea kept from the old cage is the `Clock`-gated,
/// per-period time-window — reused here for subscriptions.
///
/// === COIN-TYPE DECISION (generic core, USDC in practice) ===
/// `Account<phantom T>` is generic over ONE coin type, exactly like `Vault<T>`.
/// In production it is instantiated as `Account<USDC>` (Circle's testnet USDC,
/// pinned in `apps/wallet/src/data/coins.ts`). Keeping it generic lets the unit
/// tests fabricate a throwaway coin type with zero external dependencies and
/// keeps the door open for other settlement coins without reshaping the object.
///
/// === MOVE-FORK DECISIONS (mirrors `vault.move`) ===
/// - `Account` is a SHARED object so that `charge_subscription` (the permissionless
///   CHARGE rail) can be triggered by anyone/the backend scheduler in their own
///   transactions. Owner-only paths (`spend` / `withdraw` / sub create/cancel)
///   assert `sender == owner`.
/// - `withdraw` RETURNS a `Coin<T>` (composable — mirrors `vault::withdraw_idle`)
///   so the owner can route it inside a PTB. `spend` / `charge_subscription`
///   instead TRANSFER to the payee, because "pay the payee" is their semantic.
/// - Subscriptions live as child dynamic fields on the Account (keyed by a u64
///   sub id) — they are append-only owner-approved recurring authorizations, so
///   they belong ON the account, not as free-floating objects.
module suize::account;

use sui::{
    balance::{Self, Balance},
    clock::Clock,
    coin::{Self, Coin},
    dynamic_field as df,
    event,
    table::{Self, Table},
};

// === Errors ===
// Abort codes are part of this module's PUBLIC CONTRACT: the unit tests and the
// off-chain backend both pattern-match on the exact code. Do NOT renumber the
// surviving ones; new behaviour gets a NEW code at the end. The agent/paused
// codes from the retired agent model (`ENotAgent` / `EPaused` / `ENameUnresolved`)
// were dropped; the survivors keep their original numbers — `0`, `3`, `4`, `5`,
// `6` are UNCHANGED.

/// A non-owner tried to call an owner-only function (`spend` / `withdraw` /
/// `create_subscription` / `cancel_subscription`).
const ENotOwner: u64 = 0;
/// The requested amount exceeds the Account's available balance. Asserted by THIS
/// module before any `balance::split`, so callers get this stable code rather
/// than the framework's internal split abort.
const EInsufficientBalance: u64 = 3;
/// `charge_subscription` was called before the period elapsed
/// (`now < last_charged_ms + period_ms`) — the time-gate: a subscription can
/// NEVER be debited early.
const ETooEarly: u64 = 4;
/// `charge_subscription` requested more than the subscription's per-period
/// ceiling (`amount > period_cap`).
const EOverPeriodCap: u64 = 5;
/// A subscription with the given key does not exist on this Account (cancelled,
/// or never created).
const ESubscriptionNotFound: u64 = 6;
/// An admin tried to set a fee rate above 100% (`bps > 10_000`). Guards
/// `set_default_fee_bps` / `set_merchant_rate`. Reuses code `7` — formerly the
/// retired `ENameUnresolved` from the dropped SuiNS-agent model, now repurposed.
/// (Admin auth itself is by `&RailAdminCap` possession — no abort code; you simply
/// cannot call an admin fn without the cap.)
const EInvalidRate: u64 = 7;

// === Constants ===

/// Default take-rate: 2% (`fee_bps = 200`), the locked Suize rate. Percentage
/// only, no floor (micropayment-safe). Seeds `RailConfig.default_fee_bps` at
/// `init`; the admin can change it later. The basis-point denominator is
/// `BPS_DENOMINATOR`.
const DEFAULT_FEE_BPS: u16 = 200;
/// Basis-point denominator: `fee = amount * fee_bps / 10_000`. Also the hard upper
/// bound on any settable rate (100%).
const BPS_DENOMINATOR: u64 = 10_000;

// === Structs ===

/// The module's one-time witness. Consumed by `init` to prove the `RailConfig` +
/// `RailAdminCap` are created exactly once, at publish, by the publisher.
public struct ACCOUNT has drop {}

/// The SINGLE, Suize-controlled, SHARED fee policy for the whole rail. NON-generic
/// — fee policy is coin-agnostic (a basis-point rate + a recipient address apply to
/// any `Account<T>`). Created once at `init`, mutated ONLY via the `RailAdminCap`.
///
/// The rate for a given merchant is `overrides[merchant]` if present, else
/// `default_fee_bps`. `overrides` is typically used for per-merchant discounts, but
/// any rate ≤ `BPS_DENOMINATOR` (100%) is allowed. `fee_recipient` is the one Suize
/// treasury every CHARGE fee lands in.
public struct RailConfig has key {
    id: UID,
    /// The take-rate (bps) applied to any merchant without an override. 200 = 2%.
    default_fee_bps: u16,
    /// Where every CHARGE fee is sent (the Suize treasury).
    fee_recipient: address,
    /// Per-merchant rate overrides (`merchant address → bps`). Absent ⇒ default.
    overrides: Table<address, u16>,
}

/// Possession-is-authority admin capability for `RailConfig`. Held by the publisher
/// (Suize). Every config mutator takes `&RailAdminCap` — there is NO address check
/// and NO `ENotAdmin` code: you simply cannot call an admin fn without the cap.
public struct RailAdminCap has key, store {
    id: UID,
}

/// The user's spendable USDC wallet. A SHARED object so the permissionless CHARGE
/// rail (`charge_subscription`) can be triggered by anyone/the backend scheduler,
/// and so anyone can `deposit`. Every mutation is gated:
///   - owner paths (`spend` / `withdraw` / sub create/cancel) assert
///     `sender == owner`,
///   - `charge_subscription` is callable by anyone but is gated by the
///     owner-approved subscription's time-window + per-period cap.
///
/// There is NO `agent` field and NO `paused` field: spending is OWNER-ONLY —
/// the user's own LOCAL zkLogin session signs. Nothing can move funds without the
/// owner's signature, so no on-chain agent identity and no on-chain kill switch
/// are needed.
///
/// `phantom T` is the settlement coin type (USDC in production). Phantom because
/// `T` appears only inside `Balance<T>`, which carries its own type witness; the
/// `Account` itself needs no runtime `T` value.
public struct Account<phantom T> has key {
    id: UID,
    /// The Account's spendable funds. `deposit` joins into here; `spend` /
    /// `withdraw` / `charge_subscription` split out of here. This balance IS the
    /// cap — there is no separate budget.
    balance: Balance<T>,
    /// The user. Authority root for every owner-only function — including `spend`.
    owner: address,
    /// Monotonic counter handing out subscription keys (dynamic-field keys). Only
    /// ever increments, so a cancelled sub's key is never reused.
    next_sub_id: u64,
}

/// An owner-approved recurring authorization, stored as a CHILD dynamic field on
/// the Account (keyed by a `u64` sub id). The owner approves ONCE
/// (`create_subscription`); thereafter anyone/the backend may
/// `charge_subscription` it, but only within the time-window and per-period cap.
/// The payee is FIXED at creation and can never be redirected — that is the whole
/// safety property of the CHARGE rail.
///
/// `store` so it can be held inside a dynamic field; no `key` (it has no
/// independent identity — it lives and dies with its parent Account field).
public struct Subscription has store, drop {
    /// The FIXED recipient. `charge_subscription` always pays exactly this
    /// address; it is never a caller-supplied argument.
    payee: address,
    /// The maximum that may be charged in any single period.
    period_cap: u64,
    /// The period length in milliseconds. A charge is only allowed once
    /// `now >= last_charged_ms + period_ms`.
    period_ms: u64,
    /// The wall-clock ms of the most recent charge (or of creation, see
    /// `create_subscription`). Advanced on every successful charge.
    last_charged_ms: u64,
}

// === Events ===
// The on-chain activity log — the wallet's hero timeline reads these. `Spent`
// and `Charged` ship `decision_hash` + `walrus_blob_id` from day one (reserved,
// empty for now) so the verifiable-trace layer needs no later schema migration.

public struct AccountCreated has copy, drop {
    account_id: ID,
    owner: address,
}

/// Emitted once at `init` when the rail's shared fee policy is created.
public struct RailConfigCreated has copy, drop {
    config_id: ID,
    default_fee_bps: u16,
    fee_recipient: address,
}

/// Emitted on every admin mutation of `RailConfig` — the fee-policy audit trail.
/// `merchant` is `option`-shaped as a sentinel: `@0x0` for the rail-wide fields
/// (`set_default_fee_bps` / `set_fee_recipient`), the merchant address for the
/// per-merchant ops (`set_merchant_rate` / `remove_merchant_rate`).
public struct RailConfigUpdated has copy, drop {
    config_id: ID,
    /// `b"default_fee_bps"` | `b"fee_recipient"` | `b"merchant_rate"` | `b"merchant_rate_removed"`.
    field: vector<u8>,
    /// The affected merchant for per-merchant ops; `@0x0` for rail-wide ops.
    merchant: address,
    /// The new bps (for rate ops); `0` for `fee_recipient` / removals.
    bps: u16,
    /// The new recipient (for `set_fee_recipient`); `@0x0` otherwise.
    fee_recipient: address,
}

public struct Deposited has copy, drop {
    account_id: ID,
    /// Who funded it (anyone may top up).
    from: address,
    amount: u64,
    /// Resulting balance after the deposit.
    balance: u64,
}

public struct Withdrawn has copy, drop {
    account_id: ID,
    amount: u64,
    balance: u64,
}

/// The PAY receipt — one per owner `spend`. `spend` is a FREE transfer, so on this
/// event `fee` is always `0` and `net == gross == amount` (the full amount lands
/// with the payee). The `fee`/`net` fields are kept (vs the `Charged` receipt,
/// which DOES carry the 2% fee) so the timeline / indexer read one uniform receipt
/// shape. `decision_hash` / `walrus_blob_id` are reserved (empty in v1) for the
/// verifiable-trace fast-follow.
public struct Spent has copy, drop {
    account_id: ID,
    payee: address,
    gross: u64,
    fee: u64,
    net: u64,
    memo: vector<u8>,
    timestamp: u64,
    decision_hash: vector<u8>,
    walrus_blob_id: vector<u8>,
}

public struct SubscriptionCreated has copy, drop {
    account_id: ID,
    sub_key: u64,
    payee: address,
    period_cap: u64,
    period_ms: u64,
}

/// The CHARGE receipt — one per successful subscription debit. Same fee split as
/// `Spent`; the payee is the subscription's FIXED payee, never a caller input.
/// `memo` mirrors `ChargePaid` / `Paid`: the caller (the relayer) stamps a
/// paymentId / renewal note here so a recurring debit is /verify-visible exactly
/// like a one-off — without it a renewal receipt couldn't be matched to its bill.
public struct Charged has copy, drop {
    account_id: ID,
    sub_key: u64,
    payee: address,
    gross: u64,
    fee: u64,
    net: u64,
    memo: vector<u8>,
    timestamp: u64,
    decision_hash: vector<u8>,
    walrus_blob_id: vector<u8>,
}

public struct SubscriptionCancelled has copy, drop {
    account_id: ID,
    sub_key: u64,
}

/// The one-off CHARGE receipt — one per `charge`. Same fee split + shape as
/// `Charged`, but with NO `sub_key` (a one-off has no subscription). The owner
/// authorizes a single merchant settlement (a 402 pay) from a funded Account; the
/// 2% fee is taken inline. `decision_hash` / `walrus_blob_id` reserved (empty in
/// v1) for the verifiable-trace fast-follow.
public struct ChargePaid has copy, drop {
    account_id: ID,
    merchant: address,
    gross: u64,
    fee: u64,
    net: u64,
    memo: vector<u8>,
    timestamp: u64,
    decision_hash: vector<u8>,
    walrus_blob_id: vector<u8>,
}

/// The open-facilitator receipt — one per `pay`. A raw payer (NO Suize Account)
/// settles a merchant with a `Coin<T>` they own; the 2% fee (resolved from the
/// shared `RailConfig` against the merchant address) is taken inline. There is NO
/// `account_id` because NO Account exists on either side of this path. `payer` is
/// the caller; `merchant` is the paid PLAIN address ("your address is your
/// account"); `decision_hash` / `walrus_blob_id` reserved (empty in v1).
public struct Paid has copy, drop {
    payer: address,
    merchant: address,
    gross: u64,
    fee: u64,
    net: u64,
    memo: vector<u8>,
    timestamp: u64,
    decision_hash: vector<u8>,
    walrus_blob_id: vector<u8>,
}

// === Init — the one-time rail-config bootstrap ===

/// Runs ONCE at publish. Creates + SHARES the single `RailConfig` (default 2% →
/// the publisher as `fee_recipient`, empty `overrides`) and transfers the
/// `RailAdminCap` to the publisher. The publisher is whoever signs the publish tx
/// (Suize); they can later retune the rate / recipient / per-merchant overrides via
/// the cap, and transfer the cap to a multisig/treasury.
fun init(_otw: ACCOUNT, ctx: &mut TxContext) {
    let publisher = ctx.sender();

    let config = RailConfig {
        id: object::new(ctx),
        default_fee_bps: DEFAULT_FEE_BPS,
        fee_recipient: publisher,
        overrides: table::new<address, u16>(ctx),
    };

    event::emit(RailConfigCreated {
        config_id: object::id(&config),
        default_fee_bps: DEFAULT_FEE_BPS,
        fee_recipient: publisher,
    });

    transfer::share_object(config);
    transfer::transfer(RailAdminCap { id: object::new(ctx) }, publisher);
}

// === Admin — fee policy (RailAdminCap-gated) ===
// Possession of `&RailAdminCap` IS the authorization (no address check, no
// `ENotAdmin`). The only abort is `EInvalidRate` on an out-of-range bps.

/// Set the rail-wide default take-rate (bps). Applies to every merchant without an
/// override. Aborts `EInvalidRate` if `bps > 10_000`.
public fun set_default_fee_bps(_cap: &RailAdminCap, config: &mut RailConfig, bps: u16) {
    assert!((bps as u64) <= BPS_DENOMINATOR, EInvalidRate);
    config.default_fee_bps = bps;
    event::emit(RailConfigUpdated {
        config_id: object::id(config),
        field: b"default_fee_bps",
        merchant: @0x0,
        bps,
        fee_recipient: @0x0,
    });
}

/// Set the single rail-wide fee recipient (the Suize treasury).
public fun set_fee_recipient(_cap: &RailAdminCap, config: &mut RailConfig, addr: address) {
    config.fee_recipient = addr;
    event::emit(RailConfigUpdated {
        config_id: object::id(config),
        field: b"fee_recipient",
        merchant: @0x0,
        bps: 0,
        fee_recipient: addr,
    });
}

/// Grant (or update) a per-merchant rate override. Typically a discount, but any
/// `bps <= 10_000` is allowed. Aborts `EInvalidRate` if out of range.
public fun set_merchant_rate(
    _cap: &RailAdminCap,
    config: &mut RailConfig,
    merchant: address,
    bps: u16,
) {
    assert!((bps as u64) <= BPS_DENOMINATOR, EInvalidRate);
    if (config.overrides.contains(merchant)) {
        *config.overrides.borrow_mut(merchant) = bps;
    } else {
        config.overrides.add(merchant, bps);
    };
    event::emit(RailConfigUpdated {
        config_id: object::id(config),
        field: b"merchant_rate",
        merchant,
        bps,
        fee_recipient: @0x0,
    });
}

/// Remove a per-merchant override (the merchant falls back to `default_fee_bps`).
/// A no-op-safe remove: only touches the table if the override exists.
public fun remove_merchant_rate(_cap: &RailAdminCap, config: &mut RailConfig, merchant: address) {
    if (config.overrides.contains(merchant)) {
        config.overrides.remove(merchant);
    };
    event::emit(RailConfigUpdated {
        config_id: object::id(config),
        field: b"merchant_rate_removed",
        merchant,
        bps: 0,
        fee_recipient: @0x0,
    });
}

/// Resolve the effective take-rate (bps) for a merchant: its override if set, else
/// the rail-wide default. The single rate source for `charge` / `charge_subscription`
/// / `pay`.
fun fee_bps_for(config: &RailConfig, merchant: address): u16 {
    if (config.overrides.contains(merchant)) *config.overrides.borrow(merchant)
    else config.default_fee_bps
}

// === Constructors ===

/// Create and SHARE a new Account owned by the transaction sender. Spending is
/// OWNER-ONLY — the owner's own LOCAL zkLogin session signs `spend`. The take-rate
/// is NOT carried here; it lives in the shared `RailConfig` and is resolved at
/// charge time, so a merchant can never set their own fee.
///
/// Shared so the permissionless CHARGE rail (`charge_subscription`) and `deposit`
/// can be called in transactions the owner does not co-sign.
public fun create_account<T>(ctx: &mut TxContext) {
    let owner = ctx.sender();

    let account = Account<T> {
        id: object::new(ctx),
        balance: balance::zero<T>(),
        owner,
        next_sub_id: 0,
    };

    event::emit(AccountCreated {
        account_id: object::id(&account),
        owner,
    });

    transfer::share_object(account);
}

// === Deposit (anyone) ===

/// Top up the Account. ANYONE may deposit (the user funding their own wallet, or a
/// third party). Merges `coin` into the spendable balance and emits `Deposited`.
public fun deposit<T>(account: &mut Account<T>, coin: Coin<T>, ctx: &TxContext) {
    let amount = coin::value(&coin);
    account.balance.join(coin.into_balance());

    event::emit(Deposited {
        account_id: object::id(account),
        from: ctx.sender(),
        amount,
        balance: account.balance.value(),
    });
}

// === PAY — the owner spend primitive ===

/// The owner's way to move funds out to a payee. OWNER-ONLY: `sender == owner`.
/// The owner signs this from their own LOCAL zkLogin session (the local Enoki
/// MCP) — the backend never signs, so this is fully non-custodial.
///
/// Order of checks (part of the contract — tests assert which fires first):
///   1. the caller IS the owner       → `ENotOwner`
///   2. balance covers `amount`       → `EInsufficientBalance`
///
/// FREE TRANSFER (founder decision — Revolut-style free sends): `spend` takes NO
/// fee. The FULL `amount` is transferred to `payee`; nothing goes to
/// `fee_recipient`. The 2% take-rate lives ONLY on the CHARGE path
/// (`charge_subscription`). Emits `Spent` with `fee = 0` / `net = amount` (the
/// receipt schema is unchanged otherwise so the timeline / indexer need no
/// migration; "free" reads as `fee == 0`). The deposit balance is the ONLY cap —
/// no budget/scope/expiry.
public fun spend<T>(
    account: &mut Account<T>,
    amount: u64,
    payee: address,
    memo: vector<u8>,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    // 1. Owner gate — only the owner's own signature may spend.
    assert!(ctx.sender() == account.owner, ENotOwner);
    // 2. Balance wall — explicit so the abort code is ours.
    assert!(account.balance.value() >= amount, EInsufficientBalance);

    // FREE transfer — no fee split. Pay the FULL amount to the payee.
    let out = account.balance.split(amount);
    transfer::public_transfer(coin::from_balance(out, ctx), payee);

    event::emit(Spent {
        account_id: object::id(account),
        payee,
        gross: amount,
        // spend is FREE — no fee taken, the full amount lands with the payee.
        fee: 0,
        net: amount,
        memo,
        timestamp: clock.timestamp_ms(),
        // Reserved for the verifiable-trace layer — empty in v1, in the schema
        // from day one so no later migration is needed.
        decision_hash: vector[],
        walrus_blob_id: vector[],
    });
}

// === Owner — withdraw ===

/// Pull `amount` back out to a `Coin<T>` for the owner. OWNER-ONLY. Aborts
/// `EInsufficientBalance` if `amount` exceeds the balance (checked here so the
/// abort code is this module's, not the framework's split abort).
///
/// RETURNS the Coin (composable — mirrors `vault::withdraw_idle`) so the owner
/// can route it within a PTB rather than forcing a fixed transfer.
public fun withdraw<T>(
    account: &mut Account<T>,
    amount: u64,
    ctx: &mut TxContext,
): Coin<T> {
    assert!(ctx.sender() == account.owner, ENotOwner);
    assert!(account.balance.value() >= amount, EInsufficientBalance);

    let out = account.balance.split(amount);

    event::emit(Withdrawn {
        account_id: object::id(account),
        amount,
        balance: account.balance.value(),
    });

    coin::from_balance(out, ctx)
}

// === CHARGE — subscriptions (the Clock-gated recurring rail) ===

/// Approve a recurring charge ONCE. OWNER-ONLY. Stores a `Subscription` as a
/// child dynamic field keyed by a fresh `u64` (returned so the caller can keep
/// the key for later `charge_subscription` / `cancel_subscription`).
///
/// FIRST-CHARGE DECISION: `last_charged_ms` is set to `now` at creation, so the
/// FIRST charge must also wait one full `period_ms`. Rationale: approve-once
/// should not also debit-now; the merchant's own first invoice is a separate
/// up-front `spend`, and a subscription is purely the *recurring* leg. (To allow
/// an immediate first charge instead, a caller would create with a back-dated
/// clock — not exposed; the conservative default is the safer one.)
public fun create_subscription<T>(
    account: &mut Account<T>,
    payee: address,
    period_cap: u64,
    period_ms: u64,
    clock: &Clock,
    ctx: &TxContext,
): u64 {
    assert!(ctx.sender() == account.owner, ENotOwner);

    let sub_key = account.next_sub_id;
    account.next_sub_id = sub_key + 1;

    let sub = Subscription {
        payee,
        period_cap,
        period_ms,
        last_charged_ms: clock.timestamp_ms(),
    };

    df::add(&mut account.id, sub_key, sub);

    event::emit(SubscriptionCreated {
        account_id: object::id(account),
        sub_key,
        payee,
        period_cap,
        period_ms,
    });

    sub_key
}

/// Charge a subscription. PERMISSIONLESS-BUT-TERMS-GATED — callable by ANYONE /
/// the backend scheduler (a scheduled debit can't wait for an owner tap, and the
/// deterministic backend that drives renewals is NOT the owner). This is the
/// backend RELAYER path; it does NOT depend on the owner signing.
///
/// WHY NOT require `sender == owner` here (the documented design choice): the
/// SUBSCRIPTION TERMS are the protection, not the caller's identity. The payee is
/// FIXED at creation, the amount is capped per period, and the `Clock` time-gate
/// forbids early/double debits — so even an arbitrary caller can only ever move
/// the owner-approved amount to the owner-approved payee, once per period.
/// Requiring the owner's signature here would break the "anyone can trigger a due
/// renewal" property the Stripe-style rail needs (a 3am renewal can't wait for the
/// owner to tap).
///
/// It only SUCCEEDS if every guard holds:
///   1. the subscription exists                     → `ESubscriptionNotFound`
///   2. the period has elapsed (time-gate)          → `ETooEarly`
///      (`now >= last_charged_ms + period_ms`; CANNOT debit early)
///   3. `amount <= period_cap`                      → `EOverPeriodCap`
///   4. balance covers `amount`                     → `EInsufficientBalance`
///
/// ANTI-DRIFT ADVANCE DECISION: on success `last_charged_ms` is advanced to `now`
/// (not `+= period_ms`). Advancing by the period would let a late scheduler
/// "catch up" by firing N charges in a row to close the gap (a debit storm);
/// advancing to `now` guarantees AT MOST ONE charge per real period and prevents
/// any double-charge within a period — the conservative, owner-favoring choice.
///
/// The payee is the subscription's FIXED `payee`; it is NOT a caller argument and
/// can never be redirected. This is the ONLY path that takes the 2% fee (`spend`
/// is a free transfer). Emits `Charged`.
///
/// `memo` follows the `charge` / `pay` convention: a caller-supplied UTF-8 note
/// (the relayer's paymentId) recorded verbatim in the receipt — it carries NO
/// authority (the subscription terms are the leash), it only makes the renewal
/// receipt matchable off-chain (/verify).
public fun charge_subscription<T>(
    account: &mut Account<T>,
    config: &RailConfig,
    sub_key: u64,
    amount: u64,
    memo: vector<u8>,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    // 1. The subscription must exist.
    assert!(df::exists_with_type<u64, Subscription>(&account.id, sub_key), ESubscriptionNotFound);

    let now = clock.timestamp_ms();
    let account_id = object::id(account);

    // Read the sub's guards (immutable borrow) before mutating the balance.
    let payee;
    {
        let sub: &Subscription = df::borrow(&account.id, sub_key);
        // 2. Time-gate — cannot debit before the period elapses.
        assert!(now >= sub.last_charged_ms + sub.period_ms, ETooEarly);
        // 3. Per-period ceiling.
        assert!(amount <= sub.period_cap, EOverPeriodCap);
        payee = sub.payee;
    };

    // 4. Balance wall — explicit so the abort code is ours.
    assert!(account.balance.value() >= amount, EInsufficientBalance);

    // Advance the window to `now` (anti-drift: at most one charge per period).
    {
        let sub: &mut Subscription = df::borrow_mut(&mut account.id, sub_key);
        sub.last_charged_ms = now;
    };

    // Rate is resolved from the SUIZE config against the FIXED payee (the merchant).
    let fee_bps = fee_bps_for(config, payee);
    let fee_recipient = config.fee_recipient;
    let (fee, net) = split_and_pay(account, amount, payee, fee_bps, fee_recipient, ctx);

    event::emit(Charged {
        account_id,
        sub_key,
        payee,
        gross: amount,
        fee,
        net,
        memo,
        timestamp: now,
        decision_hash: vector[],
        walrus_blob_id: vector[],
    });
}

/// Cancel a subscription — removes the child field. OWNER-ONLY. Aborts
/// `ESubscriptionNotFound` if no such subscription exists. Emits
/// `SubscriptionCancelled`.
public fun cancel_subscription<T>(account: &mut Account<T>, sub_key: u64, ctx: &TxContext) {
    assert!(ctx.sender() == account.owner, ENotOwner);
    assert!(df::exists_with_type<u64, Subscription>(&account.id, sub_key), ESubscriptionNotFound);

    // `Subscription` has `drop`, so removing + discarding is enough.
    let _sub: Subscription = df::remove(&mut account.id, sub_key);

    event::emit(SubscriptionCancelled {
        account_id: object::id(account),
        sub_key,
    });
}

// === CHARGE — one-off merchant charge (the non-recurring 402 settlement) ===

/// The owner-authorized one-off charge from a FUNDED Account — the non-recurring
/// CHARGE path (a single 402 settlement). OWNER-ONLY: `sender == owner`, exactly
/// like `spend`. There are no on-chain terms to gate a one-off (unlike a
/// subscription's fixed payee + per-period cap + Clock), so it MUST be owner-signed
/// from the owner's own LOCAL zkLogin session.
///
/// The ONLY difference from `spend` is the 2% fee: a merchant is being paid, so the
/// fee is split inline via the SAME `split_and_pay` helper `charge_subscription`
/// uses — `fee` → `fee_recipient`, `net = amount - fee` → `merchant`, both
/// transferred as fresh `Coin<T>`s (the merchant is paid by transfer, NOT by a
/// deposit into a merchant Account — mirrors `charge_subscription` exactly).
///
/// Order of checks (mirrors `spend` — tests assert which fires first):
///   1. the caller IS the owner       → `ENotOwner`
///   2. balance covers `amount`       → `EInsufficientBalance`
///
/// Emits `ChargePaid` (the `Charged` shape without `sub_key`).
public fun charge<T>(
    account: &mut Account<T>,
    config: &RailConfig,
    merchant: address,
    amount: u64,
    memo: vector<u8>,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    // 1. Owner gate — only the owner's own signature may charge.
    assert!(ctx.sender() == account.owner, ENotOwner);
    // 2. Balance wall — explicit so the abort code is ours.
    assert!(account.balance.value() >= amount, EInsufficientBalance);

    let account_id = object::id(account);
    // Rate is resolved from the SUIZE config against the merchant being paid.
    let fee_bps = fee_bps_for(config, merchant);
    let fee_recipient = config.fee_recipient;
    let (fee, net) = split_and_pay(account, amount, merchant, fee_bps, fee_recipient, ctx);

    event::emit(ChargePaid {
        account_id,
        merchant,
        gross: amount,
        fee,
        net,
        memo,
        timestamp: clock.timestamp_ms(),
        decision_hash: vector[],
        walrus_blob_id: vector[],
    });
}

// === PAY (CHARGE) — the open facilitator (raw payer, no Account) ===

/// The open facilitator: a one-off charge from ANY raw payer with a `Coin<T>` in
/// hand — NO Suize Account required on the payer side, and NO Account on the
/// MERCHANT side either (owner amendment 2026-06-10): the merchant is a plain
/// `address` — "your address is your account." This is the door for external
/// 402 / AP2 agents that hold USDC but have no funded Account, paying any
/// merchant that can receive USDC.
///
/// PERMISSIONLESS (no owner gate): the payer's signature over the `payment: Coin<T>`
/// input IS the authorization — you can only pass a coin you own. There is no
/// `EInsufficientBalance` check because the coin's value IS the amount (you cannot
/// over-spend a coin you handed in).
///
/// FEE SOURCE (founder decision — Suize-owned policy): the rate + recipient are
/// read from the shared `RailConfig`, resolved against the merchant ADDRESS being
/// paid — NOT from any merchant-owned object (a merchant can't zero their own
/// rate) and NOT a module constant. `net` is transferred to the merchant and `fee`
/// to `config.fee_recipient`, both as fresh `Coin<T>`s — the same payout primitive
/// as `charge` / `charge_subscription`.
///
/// Emits `Paid` (no `account_id` — neither side has an Account here; the receipt
/// carries the merchant ADDRESS).
public fun pay<T>(
    merchant: address,
    config: &RailConfig,
    payment: Coin<T>,
    memo: vector<u8>,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    let fee_recipient = config.fee_recipient;

    let gross = coin::value(&payment);
    let fee = (gross * (fee_bps_for(config, merchant) as u64)) / BPS_DENOMINATOR;
    let net = gross - fee;

    // Carve the fee off the handed-in coin, then route both legs. Same arithmetic +
    // payout shape as `split_and_pay`, against a raw coin instead of the balance.
    let mut payment = payment;
    let fee_coin = coin::split(&mut payment, fee, ctx);

    transfer::public_transfer(fee_coin, fee_recipient);
    transfer::public_transfer(payment, merchant);

    event::emit(Paid {
        payer: ctx.sender(),
        merchant,
        gross,
        fee,
        net,
        memo,
        timestamp: clock.timestamp_ms(),
        decision_hash: vector[],
        walrus_blob_id: vector[],
    });
}

// === Internal helpers ===

/// The CHARGE fee split (used by `charge_subscription` AND `charge`; `spend` is
/// free and pays the payee directly; `pay` runs the same arithmetic against a raw
/// coin instead of the balance). Splits the `fee_bps` fee off `amount`, transfers
/// `fee` → `fee_recipient` and `net = amount - fee` → `payee`, both as fresh
/// `Coin<T>`s minted from the Account balance. Returns `(fee, net)` for the
/// event. The rate + recipient are RESOLVED BY THE CALLER from the shared
/// `RailConfig` (no longer read off the Account). Caller MUST have already asserted
/// `balance >= amount`.
///
/// Integer-division floor on the fee means we slightly under-collect on dust and
/// NEVER overcharge the payee — the deliberate, user-favoring rounding.
fun split_and_pay<T>(
    account: &mut Account<T>,
    amount: u64,
    payee: address,
    fee_bps: u16,
    fee_recipient: address,
    ctx: &mut TxContext,
): (u64, u64) {
    let fee = (amount * (fee_bps as u64)) / BPS_DENOMINATOR;
    let net = amount - fee;

    // Split the gross out of the balance, then carve the fee off it. Doing the
    // balance work first keeps the whole thing atomic with the asserts above.
    let mut gross_bal = account.balance.split(amount);
    let fee_bal = gross_bal.split(fee);

    transfer::public_transfer(coin::from_balance(fee_bal, ctx), fee_recipient);
    transfer::public_transfer(coin::from_balance(gross_bal, ctx), payee);

    (fee, net)
}

// === Read-only accessors ===
// Plain `public` (not `public(package)`): the off-chain backend + UI read these
// via `devInspect`, and the tests assert on them.

public fun balance_value<T>(account: &Account<T>): u64 { account.balance.value() }

public fun owner<T>(account: &Account<T>): address { account.owner }

// --- RailConfig accessors (the fee policy now lives here, not on the Account) ---

/// The rail-wide default take-rate (bps).
public fun default_fee_bps(config: &RailConfig): u16 { config.default_fee_bps }

/// The single rail fee recipient (Suize treasury).
public fun fee_recipient(config: &RailConfig): address { config.fee_recipient }

/// Whether a per-merchant override is set for `merchant`.
public fun has_merchant_rate(config: &RailConfig, merchant: address): bool {
    config.overrides.contains(merchant)
}

/// The effective take-rate (bps) for `merchant`: its override if set, else the
/// default. The same resolution `charge` / `charge_subscription` / `pay` use.
public fun merchant_fee_bps(config: &RailConfig, merchant: address): u16 {
    fee_bps_for(config, merchant)
}

public fun has_subscription<T>(account: &Account<T>, sub_key: u64): bool {
    df::exists_with_type<u64, Subscription>(&account.id, sub_key)
}

/// `(payee, period_cap, period_ms, last_charged_ms)` for a subscription. Aborts
/// `ESubscriptionNotFound` if absent.
public fun subscription_info<T>(account: &Account<T>, sub_key: u64): (address, u64, u64, u64) {
    assert!(df::exists_with_type<u64, Subscription>(&account.id, sub_key), ESubscriptionNotFound);
    let sub: &Subscription = df::borrow(&account.id, sub_key);
    (sub.payee, sub.period_cap, sub.period_ms, sub.last_charged_ms)
}

// === Test-only ===

/// Run the publish-time `init` from a test scenario (the OTW can't be fabricated by
/// tests otherwise). Shares the `RailConfig` and transfers the `RailAdminCap` to the
/// tx sender, exactly as a real publish would.
#[test_only]
public fun init_for_testing(ctx: &mut TxContext) {
    init(ACCOUNT {}, ctx)
}

/// Build the `Paid` receipt a test EXPECTS, so `event::events_by_type<Paid>()`
/// results can be asserted field-for-field (event fields are private outside this
/// module; a constructor beats a pile of accessors). `decision_hash` /
/// `walrus_blob_id` are pinned empty — exactly what v1 emits.
#[test_only]
public fun paid_event_for_testing(
    payer: address,
    merchant: address,
    gross: u64,
    fee: u64,
    net: u64,
    memo: vector<u8>,
    timestamp: u64,
): Paid {
    Paid { payer, merchant, gross, fee, net, memo, timestamp, decision_hash: vector[], walrus_blob_id: vector[] }
}

/// Same idea for the `Charged` receipt — the subscription-debit expectation.
#[test_only]
public fun charged_event_for_testing(
    account_id: ID,
    sub_key: u64,
    payee: address,
    gross: u64,
    fee: u64,
    net: u64,
    memo: vector<u8>,
    timestamp: u64,
): Charged {
    Charged { account_id, sub_key, payee, gross, fee, net, memo, timestamp, decision_hash: vector[], walrus_blob_id: vector[] }
}
