/// Suize — the per-user sandbox VAULT (custody) module.
///
/// Each user gets their OWN vault. It is NEVER pooled: one user, one `Vault`,
/// one `Mandate`. The vault custodies the user's *sandbox* funds — the risk
/// capital the user consciously dedicates to the autonomous agent. The agent
/// (a separate, scoped keypair) can move those funds ONLY through the
/// mandate-gated `agent_consume`, so it can never exceed its budget, act out of
/// scope/expiry, use a revoked cap, or redirect funds to an arbitrary address.
///
/// THE TIGHT CAGE: the agent path moves balance *inside* the vault (idle →
/// deployed) and returns NO `Coin` to the caller. Funds stay in Move custody
/// across the whole action. The real protocol adapters (NAVI / DeepBook), built
/// in SEPARATE later tasks, will REPLACE the "move to deployed" step with the
/// actual composable protocol call while keeping the exact same pattern:
///   1. `vault.mandate_id` matches the driving mandate  (this module),
///   2. `mandate::consume_budget` gate (the 5 asserts)   (the `mandate` module),
///   3. the protocol round-trip — funds never leave Move custody,
///   4. emit the activity-log event.
///
/// === COIN-TYPE DECISION (generic core, specialize later) ===
/// The core is a single generic `Vault<phantom T>` over ONE primary coin type,
/// with one idle pot + one deployed pot of `Balance<T>`. This proves the
/// structure and the gate end-to-end with a single test coin type, with zero
/// external dependencies. The multi-coin reality of the MVP (USDC supply on
/// NAVI + SUI/DEEP for DeepBook) is handled when the adapters land — either by
/// instantiating one `Vault<USDC>` per coin the agent operates, or by extending
/// the struct with the additional balances noted in the adapter TODOs below.
/// Keeping the core generic means the adapter work specializes/extends it
/// without reshaping this primitive.
///
/// SCOPE OF THIS MODULE: vault core + the agent gate ONLY. No NAVI/DeepBook
/// dependencies are added here; the adapter slots are documented as TODOs.
/// Force-unwind / `withdraw_all` is likewise deferred to the adapter tasks
/// (it needs to unwind real protocol positions); for the core, withdraw is
/// idle-only.
module suize::vault;

use suize::mandate::{Self, Mandate, AgentCap};
use sui::balance::{Self, Balance};
use sui::clock::Clock;
use sui::coin::{Self, Coin};
use sui::event;

// === Errors ===
// Abort codes are part of this module's public contract: tests pattern-match on
// the exact code. Do NOT renumber.

/// A non-owner tried to call an owner-only function (`deposit` / `withdraw_idle`
/// / `create_vault`).
const ENotOwner: u64 = 0;
/// The requested amount exceeds the available balance (idle pot). Asserted by
/// THIS module before any `balance::split`, so callers get this stable code
/// rather than the framework's internal split abort.
const EInsufficientBalance: u64 = 1;
/// The mandate passed to `agent_consume` is not the one this vault is bound to.
/// A vault may only ever be driven by its OWN mandate.
const EVaultMandateMismatch: u64 = 2;

// === Structs ===

/// The per-user sandbox vault. A SHARED object so the off-chain agent keypair
/// (distinct from the owner) can reference and mutate it in its own
/// transactions, exactly like the shared `Mandate`. Every mutation is gated:
/// owner paths assert `sender == owner`; the agent path runs the vault↔mandate
/// check and then the full mandate gate.
///
/// `phantom T` is the vault's coin type. It is phantom because `T` appears only
/// inside `Balance<T>` (which carries its own type witness); the `Vault` itself
/// needs no runtime `T` value.
public struct Vault<phantom T> has key {
    id: UID,
    /// The user. Authority root for every owner-only function.
    owner: address,
    /// The mandate this vault is bound to — the single leash that may drive it.
    /// Checked first in `agent_consume` so a vault can never be moved by a
    /// foreign mandate even if that mandate's own gate would pass.
    mandate_id: ID,
    /// The user's IDLE sandbox funds — deposited, not yet deployed by the agent.
    /// `withdraw_idle` returns from here; `agent_consume` moves out of here.
    idle: Balance<T>,
    /// A stand-in "DEPLOYED" pot. For the core this is where `agent_consume`
    /// parks funds to PROVE the gate without external deps; it represents capital
    /// the real adapters will instead push into NAVI/DeepBook. Funds here are
    /// still in Move custody and still belong to the vault/owner.
    deployed: Balance<T>,
    // TODO(adapters — NAVI): an `Option<navi::AccountCap>` slot. NAVI binds a
    //   lending position to an AccountCap; the vault must custody that cap so
    //   `agent_supply` / `agent_withdraw` drive a position owned by the vault,
    //   not by the agent. Not added now (would pull in the NAVI dependency).
    // TODO(adapters — DeepBook): a `Balance<DEEP>` slot to pay DeepBook v3 pool
    //   fees during `agent_swap` (`swap_exact_base_for_quote`). Not added now
    //   (would pull in the DeepBook dependency + the DEEP coin type).
}

// === Events ===
// These feed the same on-chain activity-log surface the `mandate` events do.
// `AgentDeployed` is the vault-side receipt that mirrors `mandate::AgentActed`.

public struct VaultCreated has copy, drop {
    vault_id: ID,
    owner: address,
    mandate_id: ID,
}

public struct Deposited has copy, drop {
    vault_id: ID,
    amount: u64,
    idle: u64,
}

public struct WithdrawnIdle has copy, drop {
    vault_id: ID,
    amount: u64,
    idle: u64,
}

/// Emitted when the agent deploys sandbox funds through the gate. In the core
/// this records the internal idle→deployed move; once adapters land it records
/// the real protocol deployment (same shape, same meaning to the UI/log).
public struct AgentDeployed has copy, drop {
    vault_id: ID,
    scope_tag: u8,
    amount: u64,
}

// === Owner-only functions ===

/// Create and SHARE a new per-user vault, owned by the transaction sender and
/// bound to `mandate_id`. The caller is responsible for passing the ID of a
/// mandate they own (e.g. the one minted in the same onboarding PTB); the agent
/// gate later enforces that only THIS mandate can drive the vault.
public fun create_vault<T>(mandate_id: ID, ctx: &mut TxContext) {
    let owner = ctx.sender();

    let vault = Vault<T> {
        id: object::new(ctx),
        owner,
        mandate_id,
        idle: balance::zero<T>(),
        deployed: balance::zero<T>(),
    };

    event::emit(VaultCreated {
        vault_id: object::id(&vault),
        owner,
        mandate_id,
    });

    // Shared so the agent keypair can use it in its own transactions.
    transfer::share_object(vault);
}

/// Deposit `coin` into the vault's idle pot. Owner-only.
public fun deposit<T>(vault: &mut Vault<T>, coin: Coin<T>, ctx: &TxContext) {
    assert!(ctx.sender() == vault.owner, ENotOwner);

    let amount = coin::value(&coin);
    vault.idle.join(coin.into_balance());

    event::emit(Deposited {
        vault_id: object::id(vault),
        amount,
        idle: vault.idle.value(),
    });
}

/// Withdraw `amount` of idle funds back to a `Coin` for the owner. Owner-only.
/// Aborts `EInsufficientBalance` if `amount` exceeds the idle pot (checked here
/// so the abort code is this module's, not the framework's split abort).
///
/// IDLE-ONLY by design for the core: funds already in `deployed` (and, later,
/// inside NAVI/DeepBook) are not reachable here. The force-unwind /
/// `withdraw_all` path that unwinds deployed positions lands with the adapters.
public fun withdraw_idle<T>(vault: &mut Vault<T>, amount: u64, ctx: &mut TxContext): Coin<T> {
    assert!(ctx.sender() == vault.owner, ENotOwner);
    assert!(vault.idle.value() >= amount, EInsufficientBalance);

    let out = vault.idle.split(amount);

    event::emit(WithdrawnIdle {
        vault_id: object::id(vault),
        amount,
        idle: vault.idle.value(),
    });

    // `coin::from_balance` mints a fresh UID, hence the `&mut TxContext`.
    coin::from_balance(out, ctx)
}

// === Agent gate (the cage) ===

/// The agent's only way to move sandbox funds. PROVES funds move only within the
/// mandate and never leave custody.
///
/// Order of checks (part of the contract — tests assert which fires first):
///   1. `vault.mandate_id == object::id(mandate)`  → `EVaultMandateMismatch`
///      (a vault may only be driven by ITS OWN mandate; checked before the gate
///       so a foreign-but-valid mandate still can't touch this vault).
///   2. `mandate::consume_budget(...)` → the 5 mandate asserts (cap↔mandate,
///      allow-listed, not expired, in scope, within budget). Aborts propagate
///      with the mandate's own codes (`ECapMandateMismatch` / `ECapNotAllowed` /
///      `EExpired` / `EOutOfScope` / `EOverBudget`).
///   3. `idle >= amount` → `EInsufficientBalance` (vault-side wall; runs after
///      the budget gate, so an over-budget spend reports `EOverBudget`, while a
///      within-budget-but-over-idle spend reports `EInsufficientBalance`).
///   4. move `amount` from `idle` to `deployed` (internal split/join — NO `Coin`
///      is returned to the caller; funds stay inside the vault).
///   5. emit `AgentDeployed`.
///
/// ADAPTER NOTE: `agent_supply` / `agent_withdraw` (NAVI
/// `deposit_with_account_cap` / `withdraw_with_account_cap`, against the vault's
/// custodied AccountCap) and `agent_swap` (DeepBook `swap_exact_base_for_quote`,
/// Coin-in/Coin-out) will REPLACE step 4 with the real protocol call — same
/// gate, same custody guarantee, funds never leaving Move.
public fun agent_consume<T>(
    vault: &mut Vault<T>,
    mandate: &mut Mandate,
    cap: &AgentCap,
    scope_tag: u8,
    amount: u64,
    clock: &Clock,
) {
    // 1. This vault may only be driven by its own mandate.
    assert!(vault.mandate_id == object::id(mandate), EVaultMandateMismatch);

    // 2. The full mandate gate (5 asserts). Atomic with the move below: if any
    //    assert fails the whole tx reverts and no balance moves. On success the
    //    budget is already debited inside this call.
    mandate::consume_budget(mandate, cap, scope_tag, amount, clock);

    // 3. Vault-side balance wall — explicit so the abort code is ours.
    assert!(vault.idle.value() >= amount, EInsufficientBalance);

    // 4. Move funds INSIDE the vault. No Coin leaves; this is the custody cage.
    //    (Adapters replace this with the real NAVI/DeepBook call.)
    let moving = vault.idle.split(amount);
    vault.deployed.join(moving);

    // 5. Activity-log receipt.
    event::emit(AgentDeployed {
        vault_id: object::id(vault),
        scope_tag,
        amount,
    });
}

// === Read-only accessors ===
// Plain `public` (not `public(package)`): the off-chain agent and UI read these
// via `devInspect`, and the tests assert on them.

public fun owner<T>(vault: &Vault<T>): address { vault.owner }

public fun mandate_id<T>(vault: &Vault<T>): ID { vault.mandate_id }

public fun idle_value<T>(vault: &Vault<T>): u64 { vault.idle.value() }

public fun deployed_value<T>(vault: &Vault<T>): u64 { vault.deployed.value() }
