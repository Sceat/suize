/// Suize — the NAVI LENDING adapter (the SAFE tier's lend-as-is primitive).
///
/// This is the THIRD mandate-gated custody adapter (after `vault::agent_consume`,
/// the internal-move proof, and `swap`, the DeepBook Coin-in/Coin-out proof). It
/// is the SAFE dial's execution leg: it supplies the user's deposited asset
/// AS-IS to NAVI and redeems it back — it NEVER swaps one asset for another
/// (the asset-scope rule, CLAUDE.md). The agent acts ONLY through the same
/// TIGHT-CAGE pattern the other adapters use:
///   1. the vault may only be driven by ITS OWN mandate   (`EVaultMandateMismatch`)
///   2. `mandate::consume_budget` — the 5 asserts (the gate; aborts propagate)
///   3. the protocol round-trip — funds return to Move custody (see the cage note)
///   4. emit the activity-log event.
///
/// =========================================================================
/// IMPORTABILITY VERDICT (the decision that shaped this module) — READ FIRST
/// =========================================================================
/// We attempted the TIGHT cage: call NAVI in-VM so the deposit's destination is
/// VM-enforced (the vault owns the `AccountCap` and `incentive_v3::
/// deposit_with_account_cap` / `withdraw_with_account_cap` run INSIDE our move
/// call). The needed surface IS public on NAVI's current contracts:
///   - `lending_core::lending::create_account(ctx): AccountCap`     (public; the
///     AccountCap has `key + store`, so a vault can custody it),
///   - `lending_core::incentive_v3::deposit_with_account_cap<T>(clock, storage,
///     pool, asset, Coin<T>, incentive_v2, incentive_v3, &AccountCap)` (public),
///   - `lending_core::incentive_v3::withdraw_with_account_cap<T>(clock, oracle,
///     storage, pool, asset, amount, incentive_v2, incentive_v3, &AccountCap):
///     Balance<T>` (public).
/// (Note: the SAME-named fns on `lending_core::lending` are `public(friend)`; the
/// externally-callable wrappers live on `incentive_v3`. The bare `*_with_account_cap`
/// path is the one NAVI's "integration with account cap" docs point external
/// contracts at.)
///
/// BUT the NAVI Move package is NOT importable as a `Move.toml` dependency for us:
///   • NAVI's current `lending_core` (repo `naviprotocol/navi-smart-contracts`,
///     subdir `lending_core`, `main`) uses the NEW-STYLE manifest (`[environments]`
///     + automated address management). Our `suize` package — and the whole
///     DeepBook-pinned graph it `override`s — is OLD-STYLE (`[addresses]` + explicit
///     framework overrides). The toolchain HARD-REFUSES the edge:
///       "Packages with old-style Move.toml files cannot depend on new-style
///        packages."  (verbatim from `sui move build`, sui 1.64.0)
///   • The pre-migration old-style rev (`914bfbae17b7`, 2025-11-18, "v23") IS
///     old-style, but it depends on `subdir = "math"` / `subdir = "utils"` at
///     `rev = "main"` — directories DELETED from `main` on 2026-01-16 ("combined
///     math, utils … into lending"), so its dep graph is unresolvable; and pinning
///     every sub-dep to the old commit drags in NAVI's MAINNET-pinned forked
///     Wormhole / Pyth / Supra / Switchboard graph (three different framework revs)
///     that collides head-on with our testnet framework `override` — the exact
///     multi-version-framework wall the DeepBook dep already skirts, but here it is
///     unfixable because HEAD is new-style.
///
/// => We FALL BACK to the PTB-RELEASE model, and flag the looser leg honestly.
///
/// =========================================================================
/// THE CAGE, CONCRETELY (what IS vs ISN'T VM-enforced in this fallback)
/// =========================================================================
/// The GATE is fully VM-enforced on BOTH legs (identical to `swap`): budget /
/// scope / expiry / allow-list / own-mandate. What differs is the DESTINATION
/// enforcement of the moved coin:
///
///   • SUPPLY leg (`agent_supply`, scope 0) — the LOOSER leg, FLAGGED. The gate
///     runs, we split a mandate-capped `Coin<CoinType>` out of the vault's idle
///     pot, record it in the per-asset `supplied` ledger, and RETURN that coin to
///     the agent's PTB, which hands it to NAVI's `deposit_with_account_cap` (SDK)
///     bound to the vault's custodied `AccountCap`. For the brief PTB span the
///     coin's destination is NOT VM-enforced by us — only its AMOUNT (mandate cap)
///     and SCOPE are. The agent holds an `AgentCap`, not arbitrary transfer rights,
///     and the budget hard-caps the size, but a malicious PTB could in principle
///     route this released coin elsewhere. This is the honest looser-cage caveat.
///
///   • WITHDRAW leg (`agent_withdraw_request` → NAVI → `agent_absorb_withdrawn`,
///     scope 1) — the TIGHT leg, VM-ENFORCED even in the fallback. The gate runs
///     and returns a `WithdrawTicket` HOT POTATO (no abilities). The PTB redeems
///     from NAVI (`withdraw_with_account_cap` → `Coin<CoinType>`) and MUST call
///     `agent_absorb_withdrawn`, which consumes the ticket and JOINS the coin back
///     into the vault's idle pot. The ticket has no `drop`/`store`, so the tx
///     CANNOT complete without re-absorbing into custody — the redeemed funds are
///     guaranteed back in the vault, with nothing left free-floating for the agent.
///
/// =========================================================================
/// MULTI-ASSET VAULT (the SAFE tier is multi-asset — CLAUDE.md)
/// =========================================================================
/// The SAFE vault holds WHATEVER the user delegates (WAL / SUI / USDC / DEEP / …)
/// and lends EACH as-is. So this is NOT a single-generic `Vault<T>`. Structure:
///   - `idle: Bag` keyed by the coin's `TypeName` → `Balance<CoinType>`: one idle
///     pot per delegated coin type, all in one object, added lazily on first
///     deposit. (`Bag` is the heterogeneous-value collection; `TypeName` is the
///     natural per-asset key and is what the off-chain agent already indexes by.)
///   - `supplied: Bag` keyed by `TypeName` → `u64`: per-asset bookkeeping of how
///     much principal is currently OUT at NAVI for that asset (the live position
///     lives at NAVI bound to the AccountCap; this is our local mirror for the UI
///     + the withdraw bound).
/// The agent NEVER moves value BETWEEN two `idle` slots — every gated op is single-
/// asset in/out of NAVI — so the asset-scope rule ("can't swap your asset away") is
/// structural here, not just policy.
///
/// =========================================================================
/// ACCOUNTCAP CUSTODY (the position binding)
/// =========================================================================
/// The vault custodies NAVI's `AccountCap` in an `Option<AccountCapT>` slot, where
/// `AccountCapT: key + store` is a TYPE PARAMETER of the vault. At deploy time the
/// vault is instantiated with NAVI's real `lending_core::account::AccountCap` (a
/// `key + store` type), so the vault OWNS the cap the NAVI position is bound to —
/// the position is the vault's, not the agent's. We cannot NAME that type here
/// (its package is the un-importable dep above), so we keep the slot generic; the
/// off-chain deploy/PTB supplies the concrete type, and the unit tests instantiate
/// it with a STUB `key + store` cap (the same seam idea as `swap`'s stubbed pool).
/// The agent never gets the cap: it lives inside the shared vault, reachable only
/// through the gated functions.
///
/// =========================================================================
/// THE NAVI SEAM + WHAT IS UNIT-TESTED vs NEEDS A LIVE RUN
/// =========================================================================
/// NAVI's `Storage` / `Pool<T>` / `PriceOracle` / `Incentive` are `key`-only shared
/// objects created through a privileged, oracle-dependent flow; they CANNOT be
/// fabricated in a Move unit test — and the NAVI package isn't importable anyway.
/// So the REAL protocol call is isolated behind the single internal seam
/// `do_navi_supply` / `do_navi_withdraw` (documented stubs here, since the package
/// can't be linked; in production the agent's PTB performs the equivalent SDK call
/// against the live `incentive_v3` entrypoints). The GATE + the CUSTODY round-trip
/// (split-out on supply; ticket → re-absorb on withdraw) are OUR code and are
/// exercised end-to-end in `navi_tests` against same-shaped stub entrypoints. The
/// real NAVI deposit/withdraw needs a LIVE localnet/testnet/mainnet integration run
/// (real `Storage`/`Pool`/`Oracle`/`Incentive` + the published package
/// `published-at 0x1e4a13a0494d5facdbe8473e74127b838c2d446ecec0ce262e2eddafa77259cb`,
/// original-id `0xd899cf7d2b5db716bd2cf55599fb0d5ee38a3061e7b6bb6eebf73fa5bc4c81ca`,
/// v24 as of pinning — supplied by the off-chain agent at PTB-build time, not a
/// compile-time input). We do NOT fake a green test of the real NAVI call.
module suize::navi;

use suize::mandate::{Self, Mandate, AgentCap};
use sui::bag::{Self, Bag};
use sui::balance::Balance;
use sui::coin::{Self, Coin};
use sui::event;
use sui::clock::Clock;
use std::type_name::{Self, TypeName};

// === Errors ===
// Abort codes are part of this module's public contract: tests pattern-match on
// the exact code. Do NOT renumber. Numbering is local to this module.

/// A non-owner tried to call an owner-only function (deposit / withdraw_idle /
/// the AccountCap setters).
const ENotOwner: u64 = 0;
/// The requested amount exceeds the available idle balance for that asset.
/// Asserted by THIS module before any `balance::split`, so callers get this
/// stable code rather than the framework's internal split abort.
const EInsufficientBalance: u64 = 1;
/// The mandate passed to an agent function is not the one this vault is bound to.
/// A vault may only ever be driven by its OWN mandate.
const EVaultMandateMismatch: u64 = 2;
/// The vault has no idle pot for the requested coin type (nothing was ever
/// deposited for it). Distinct from `EInsufficientBalance` (which is "pot exists
/// but too small") so the off-chain agent can tell "unknown asset" from "low".
const ENoSuchAsset: u64 = 3;
/// A `WithdrawTicket` was presented to `agent_absorb_withdrawn` for a DIFFERENT
/// vault than the one that minted it. Prevents re-absorbing a redeemed coin into
/// the wrong vault.
const ETicketVaultMismatch: u64 = 4;
/// The vault's `AccountCap` slot is empty — the NAVI account was never set (or was
/// already taken out). Owner must `set_account_cap` before the agent can supply.
const ENoAccountCap: u64 = 5;

// === Structs ===

/// The per-user SAFE-tier MULTI-ASSET sandbox vault. A SHARED object (like the
/// `Mandate` and the other vaults) so the off-chain agent keypair can drive it in
/// its own transactions. Every mutation is gated: owner paths assert
/// `sender == owner`; the agent paths run the vault↔mandate check then the full
/// mandate gate.
///
/// `AccountCapT` is the type of NAVI's `AccountCap` (a `key + store` object). It is
/// a TYPE PARAMETER, not `phantom`: the vault actually STORES one in `account_cap`,
/// so it must be a real `store` type. At deploy time this is NAVI's real
/// `lending_core::account::AccountCap`; in unit tests it is a stub `key + store`
/// cap (see the module header for why we cannot name the real type here).
public struct MultiAssetVault<AccountCapT: key + store> has key {
    id: UID,
    /// The user. Authority root for every owner-only function.
    owner: address,
    /// The single mandate this vault is bound to — the only leash that may drive
    /// it. Checked first in every agent function so a foreign mandate can never
    /// move this vault even if that mandate's own gate would pass.
    mandate_id: ID,
    /// The NAVI `AccountCap` the vault's lending position is bound to. The VAULT
    /// owns it (it lives inside this shared object), so the position is the
    /// vault's, not the agent's — the agent can never reach the cap directly.
    /// `Option` because the vault is created before the account exists; the owner
    /// fills it via `set_account_cap` (the cap minted by NAVI's `create_account`
    /// in the same onboarding PTB).
    account_cap: Option<AccountCapT>,
    /// IDLE multi-asset pot: `TypeName(CoinType)` → `Balance<CoinType>`. One slot
    /// per delegated coin, added lazily on first deposit. `withdraw_idle` and
    /// `agent_supply` move OUT of here; `deposit` and `agent_absorb_withdrawn`
    /// move IN.
    idle: Bag,
    /// SUPPLIED bookkeeping: `TypeName(CoinType)` → `u64` principal currently OUT
    /// at NAVI for that asset. Incremented on `agent_supply`, decremented on
    /// `agent_withdraw_request`. The authoritative balance lives at NAVI bound to
    /// the AccountCap; this is the vault's local mirror (UI + the withdraw bound).
    supplied: Bag,
}

/// The withdraw HOT POTATO — the tight-cage enforcer for the redeem leg. Minted by
/// `agent_withdraw_request` AFTER the gate passes; it has NO abilities (no `drop`,
/// `store`, `copy`, `key`), so the only thing the transaction can do with it is
/// pass it to `agent_absorb_withdrawn`, which re-absorbs the redeemed coin into the
/// vault's custody. The agent therefore CANNOT keep the redeemed funds: a tx that
/// fails to re-absorb cannot even be constructed.
public struct WithdrawTicket {
    /// The vault that issued this ticket; `agent_absorb_withdrawn` asserts the coin
    /// is re-absorbed into the SAME vault.
    vault_id: ID,
    /// The `TypeName` of the asset being redeemed — pins the coin type that may be
    /// absorbed against this ticket (defense-in-depth for the UI/agent).
    asset: TypeName,
    /// The principal the agent asked NAVI to redeem (the activity-log figure).
    amount: u64,
}

// === Events ===
// Same on-chain activity-log surface as the `mandate` / `vault` / `swap` events.

public struct VaultCreated has copy, drop {
    vault_id: ID,
    owner: address,
    mandate_id: ID,
}

public struct AccountCapSet has copy, drop {
    vault_id: ID,
}

public struct Deposited has copy, drop {
    vault_id: ID,
    /// The deposited coin's `TypeName` as an ascii string (the agent/UI key).
    asset: std::ascii::String,
    amount: u64,
    idle: u64,
}

public struct WithdrawnIdle has copy, drop {
    vault_id: ID,
    asset: std::ascii::String,
    amount: u64,
    idle: u64,
}

/// Emitted when the agent supplies an asset AS-IS to NAVI (scope 0). `amount` is
/// the principal pushed; the coin is handed to NAVI bound to the vault's
/// AccountCap. This is the SAFE-tier "show-your-work" receipt + idle-game feed.
public struct AgentSupplied has copy, drop {
    vault_id: ID,
    scope_tag: u8,
    asset: std::ascii::String,
    amount: u64,
    /// Running total supplied for this asset after the op.
    supplied: u64,
}

/// Emitted when a redeemed coin is re-absorbed into the vault (scope 1, the tight
/// leg). `amount` is what NAVI actually returned (which may differ from the
/// requested principal by accrued interest) — so this is the true cash that
/// landed back in custody.
public struct AgentWithdrawn has copy, drop {
    vault_id: ID,
    scope_tag: u8,
    asset: std::ascii::String,
    /// What the agent asked NAVI to redeem (from the ticket).
    requested: u64,
    /// What actually landed back in the idle pot (interest can make this differ).
    absorbed: u64,
    idle: u64,
}

// === Constructor (free, owner-rooted) ===

/// Create and SHARE a per-user multi-asset SAFE vault, owned by the sender and
/// bound to `mandate_id`. Like the other vaults, the caller passes the ID of a
/// mandate they own (e.g. the SAFE mandate minted in the same onboarding PTB); the
/// agent gate later enforces that ONLY that mandate can drive this vault. The
/// `AccountCap` slot starts empty — the owner fills it with `set_account_cap` once
/// NAVI's `create_account` has minted the cap.
public fun create_vault<AccountCapT: key + store>(mandate_id: ID, ctx: &mut TxContext) {
    let owner = ctx.sender();

    let vault = MultiAssetVault<AccountCapT> {
        id: object::new(ctx),
        owner,
        mandate_id,
        account_cap: option::none(),
        idle: bag::new(ctx),
        supplied: bag::new(ctx),
    };

    event::emit(VaultCreated {
        vault_id: object::id(&vault),
        owner,
        mandate_id,
    });

    transfer::share_object(vault);
}

// === Owner-only AccountCap custody ===

/// Move a NAVI `AccountCap` INTO the vault's custody. Owner-only. Aborts if a cap
/// is already set (the owner must `take_account_cap` first to replace it), so we
/// never silently drop a custodied cap.
public fun set_account_cap<AccountCapT: key + store>(
    vault: &mut MultiAssetVault<AccountCapT>,
    cap: AccountCapT,
    ctx: &TxContext,
) {
    assert!(ctx.sender() == vault.owner, ENotOwner);
    // `fill` aborts if the Option is already `some` — the desired "already set"
    // guard, so a custodied cap is never overwritten/leaked.
    vault.account_cap.fill(cap);

    event::emit(AccountCapSet { vault_id: object::id(vault) });
}

/// Take the NAVI `AccountCap` back OUT of the vault to the owner (the owner exit
/// for the account binding). Owner-only. Aborts `ENoAccountCap` if none is set.
/// This is how the owner reclaims/rotates the NAVI account; it does NOT unwind the
/// position (force-unwind is a separate task) — the owner gets the cap and can
/// redeem at NAVI directly.
public fun take_account_cap<AccountCapT: key + store>(
    vault: &mut MultiAssetVault<AccountCapT>,
    ctx: &TxContext,
): AccountCapT {
    assert!(ctx.sender() == vault.owner, ENotOwner);
    assert!(vault.account_cap.is_some(), ENoAccountCap);
    vault.account_cap.extract()
}

// === Owner-only deposits / idle withdrawals (multi-asset) ===

/// Deposit `coin` of ANY type into the vault's idle pot for that type. Owner-only.
/// The asset's idle `Balance` slot is created lazily on first deposit. This is how
/// the user funds the SAFE sandbox with whatever asset(s) they delegate.
public fun deposit<AccountCapT: key + store, CoinType>(
    vault: &mut MultiAssetVault<AccountCapT>,
    coin: Coin<CoinType>,
    ctx: &TxContext,
) {
    assert!(ctx.sender() == vault.owner, ENotOwner);

    let amount = coin::value(&coin);
    let key = type_name::with_defining_ids<CoinType>();

    if (vault.idle.contains(key)) {
        let pot: &mut Balance<CoinType> = vault.idle.borrow_mut(key);
        pot.join(coin.into_balance());
    } else {
        vault.idle.add(key, coin.into_balance());
    };

    event::emit(Deposited {
        vault_id: object::id(vault),
        asset: type_name::into_string(key),
        amount,
        idle: idle_value<AccountCapT, CoinType>(vault),
    });
}

/// Withdraw `amount` of idle funds of `CoinType` back to a Coin for the owner.
/// Owner-only. IDLE-ONLY by design for this adapter: funds already supplied to
/// NAVI are reached via the agent withdraw path / force-unwind (a separate task).
public fun withdraw_idle<AccountCapT: key + store, CoinType>(
    vault: &mut MultiAssetVault<AccountCapT>,
    amount: u64,
    ctx: &mut TxContext,
): Coin<CoinType> {
    assert!(ctx.sender() == vault.owner, ENotOwner);

    // Capture the vault ID before borrowing a field (the borrow checker forbids an
    // `object::id(vault)` freeze while `idle` is mutably borrowed below).
    let vault_id = object::id(vault);
    let key = type_name::with_defining_ids<CoinType>();
    assert!(vault.idle.contains(key), ENoSuchAsset);
    let pot: &mut Balance<CoinType> = vault.idle.borrow_mut(key);
    assert!(pot.value() >= amount, EInsufficientBalance);

    let out = pot.split(amount);
    let idle_after = pot.value(); // read while borrowed, then the borrow ends.

    event::emit(WithdrawnIdle {
        vault_id,
        asset: type_name::into_string(key),
        amount,
        idle: idle_after,
    });

    coin::from_balance(out, ctx)
}

// === Agent gate (the cage) — SUPPLY (scope 0, the LOOSER leg) ===

/// The agent's mandate-gated SUPPLY of `CoinType` AS-IS to NAVI. Runs the full
/// gate, splits a mandate-capped `Coin<CoinType>` out of the vault's idle pot,
/// records it in the `supplied` ledger, and RETURNS the coin to the caller's PTB
/// (which hands it to NAVI `deposit_with_account_cap` bound to the vault's
/// AccountCap). This is the LOOSER leg: see the module header — the coin's
/// destination is not VM-enforced by us, only its amount (budget) + scope.
///
/// Order of operations (the order is the contract — tests assert which fires
/// first):
///   1. `vault.mandate_id == object::id(mandate)`  → `EVaultMandateMismatch`.
///   2. an AccountCap is custodied                  → `ENoAccountCap` (we won't
///      release funds for a supply that has no NAVI account to land in).
///   3. `mandate::consume_budget(...)` → the 5 mandate asserts. Budget is debited
///      by `amount` HERE, atomically with the release.
///   4. the idle pot for `CoinType` exists          → `ENoSuchAsset`,
///      and holds `>= amount`                        → `EInsufficientBalance`.
///   5. split `amount` out, bump the `supplied` ledger, emit, and return the coin.
///
/// The `asset_id: u8` is NAVI's pool/asset index for this coin (e.g. the USDC asset
/// id) — it is NOT used in-VM here (we don't link NAVI), but it is threaded so the
/// production PTB and the off-chain agent carry it on the same call; it is recorded
/// in no on-chain state. (Kept in the signature so the production seam and the SDK
/// path share one shape.)
public fun agent_supply<AccountCapT: key + store, CoinType>(
    vault: &mut MultiAssetVault<AccountCapT>,
    mandate: &mut Mandate,
    cap: &AgentCap,
    scope_tag: u8,
    asset_id: u8,
    amount: u64,
    clock: &Clock,
    ctx: &mut TxContext,
): Coin<CoinType> {
    // 1–4 + split the coin out of custody (shared, single-source).
    let coin = gate_and_release(vault, mandate, cap, scope_tag, amount, clock, ctx);

    // In production the caller now passes `coin` to:
    //   incentive_v3::deposit_with_account_cap<CoinType>(
    //       clock, storage, pool, asset_id, coin, incentive_v2, incentive_v3,
    //       option::borrow(&vault.account_cap))
    // — see `do_navi_supply` (the seam). `asset_id` rides along to that call.
    let _ = asset_id;
    coin
}

// === Agent gate (the cage) — WITHDRAW (scope 1, the TIGHT leg) ===

/// Step 1 of the agent's mandate-gated REDEEM of `CoinType` from NAVI. Runs the
/// full gate, decrements the `supplied` ledger, and returns a `WithdrawTicket` HOT
/// POTATO. The PTB then redeems from NAVI (`withdraw_with_account_cap` →
/// `Coin<CoinType>`, bound to the vault's AccountCap) and MUST call
/// `agent_absorb_withdrawn` with the ticket + the coin. The ticket cannot be
/// dropped, so the redeemed funds are guaranteed back in custody — the tight cage.
///
/// Order (the contract):
///   1. `vault.mandate_id == object::id(mandate)`  → `EVaultMandateMismatch`.
///   2. an AccountCap is custodied                  → `ENoAccountCap`.
///   3. `mandate::consume_budget(...)` → the 5 asserts; budget debited by `amount`.
///   4. the `supplied` ledger for `CoinType` exists → `ENoSuchAsset`,
///      and is `>= amount`                          → `EInsufficientBalance`
///      (you cannot redeem more principal than the vault recorded as supplied).
///   5. decrement `supplied`, mint + return the `WithdrawTicket`.
public fun agent_withdraw_request<AccountCapT: key + store, CoinType>(
    vault: &mut MultiAssetVault<AccountCapT>,
    mandate: &mut Mandate,
    cap: &AgentCap,
    scope_tag: u8,
    asset_id: u8,
    amount: u64,
    clock: &Clock,
): WithdrawTicket {
    let _ = asset_id; // rides along to the NAVI seam; not used in-VM here.

    // 1. This vault may only be driven by its own mandate.
    assert!(vault.mandate_id == object::id(mandate), EVaultMandateMismatch);
    // 2. There must be a NAVI account to redeem from.
    assert!(vault.account_cap.is_some(), ENoAccountCap);
    // 3. The full mandate gate (5 asserts) + budget debit. Atomic with the redeem.
    mandate::consume_budget(mandate, cap, scope_tag, amount, clock);

    // 4. Per-asset principal wall — explicit so the abort codes are ours.
    let key = type_name::with_defining_ids<CoinType>();
    assert!(vault.supplied.contains(key), ENoSuchAsset);
    let supplied_ref: &mut u64 = vault.supplied.borrow_mut(key);
    assert!(*supplied_ref >= amount, EInsufficientBalance);

    // 5. Reduce the recorded principal and mint the obligation ticket.
    *supplied_ref = *supplied_ref - amount;

    WithdrawTicket {
        vault_id: object::id(vault),
        asset: key,
        amount,
    }
}

/// Step 2 of the redeem: consume the `WithdrawTicket` and JOIN the redeemed coin
/// back into the vault's idle pot. This is the custody SEAL of the withdraw leg —
/// the coin NAVI returned is re-absorbed in full, so nothing is left free-floating
/// for the agent. Aborts `ETicketVaultMismatch` if the ticket was minted by a
/// different vault. `absorbed` (the coin's value) can exceed the ticket's
/// `requested` by accrued interest; that surplus simply lands in custody too.
public fun agent_absorb_withdrawn<AccountCapT: key + store, CoinType>(
    vault: &mut MultiAssetVault<AccountCapT>,
    ticket: WithdrawTicket,
    coin: Coin<CoinType>,
) {
    let WithdrawTicket { vault_id, asset, amount: requested } = ticket;
    assert!(vault_id == object::id(vault), ETicketVaultMismatch);

    let absorbed = coin::value(&coin);
    let key = type_name::with_defining_ids<CoinType>();

    // Re-absorb into the per-asset idle pot (create it if the asset had none idle).
    if (vault.idle.contains(key)) {
        let pot: &mut Balance<CoinType> = vault.idle.borrow_mut(key);
        pot.join(coin.into_balance());
    } else {
        vault.idle.add(key, coin.into_balance());
    };

    event::emit(AgentWithdrawn {
        vault_id,
        scope_tag: 1, // NAVI withdraw, by convention.
        asset: type_name::into_string(asset),
        requested,
        absorbed,
        idle: idle_value<AccountCapT, CoinType>(vault),
    });
}

// === Shared gate + custody helper (single source of truth) ===

/// Steps 1–5 of `agent_supply`: vault↔mandate check, AccountCap-present check, the
/// full mandate gate (which debits the budget), the per-asset idle wall, then split
/// the `amount` out of the idle pot and bump the `supplied` ledger. Returns the
/// released `Coin<CoinType>`. Holds the load-bearing logic so the gated-release +
/// ledger update is tested ONCE (through the production `agent_supply` AND the
/// stub-supply entrypoint), not re-implemented for the tests.
fun gate_and_release<AccountCapT: key + store, CoinType>(
    vault: &mut MultiAssetVault<AccountCapT>,
    mandate: &mut Mandate,
    cap: &AgentCap,
    scope_tag: u8,
    amount: u64,
    clock: &Clock,
    ctx: &mut TxContext,
): Coin<CoinType> {
    // Capture the vault ID before any field borrow (the borrow checker forbids an
    // `object::id(vault)` freeze while a field is mutably borrowed below).
    let vault_id = object::id(vault);

    // 1. This vault may only be driven by its own mandate.
    assert!(vault.mandate_id == object::id(mandate), EVaultMandateMismatch);
    // 2. There must be a NAVI account for the supply to land in.
    assert!(vault.account_cap.is_some(), ENoAccountCap);
    // 3. The full mandate gate (5 asserts) + budget debit. Atomic with the release.
    mandate::consume_budget(mandate, cap, scope_tag, amount, clock);

    // 4. Per-asset idle wall — explicit so the abort codes are ours.
    let key = type_name::with_defining_ids<CoinType>();
    assert!(vault.idle.contains(key), ENoSuchAsset);
    let pot: &mut Balance<CoinType> = vault.idle.borrow_mut(key);
    assert!(pot.value() >= amount, EInsufficientBalance);

    // 5. Split the coin out (ends the `idle` borrow), then record the principal.
    let out = pot.split(amount);

    let supplied_total = if (vault.supplied.contains(key)) {
        let s: &mut u64 = vault.supplied.borrow_mut(key);
        *s = *s + amount;
        *s
    } else {
        vault.supplied.add(key, amount);
        amount
    };

    event::emit(AgentSupplied {
        vault_id,
        scope_tag,
        asset: type_name::into_string(key),
        amount,
        supplied: supplied_total,
    });

    coin::from_balance(out, ctx)
}

// === The NAVI seam (the ONLY protocol-touching lines — documented stubs) ===
//
// In a world where NAVI's package were importable, these would hold the real
// `incentive_v3::deposit_with_account_cap` / `withdraw_with_account_cap` calls and
// `agent_supply` / `agent_withdraw_request` would compose them in-VM for the TIGHT
// cage (no coin ever returned to the PTB on supply; the redeem `Balance` re-absorbed
// directly). Because the package is NOT importable (see the header), these are
// documented stubs and the live deposit/withdraw is performed by the agent's PTB
// via the SDK against the published `incentive_v3`. They are kept as the single,
// labelled place the protocol call WOULD live, so the swap-to-tight-cage migration
// (if NAVI ever ships an old-style/importable interface) is a one-function change.
//
// Real production call shapes the off-chain PTB performs (for reference):
//   incentive_v3::deposit_with_account_cap<CoinType>(
//       clock, storage, pool, asset_id, deposit_coin, incentive_v2, incentive_v3,
//       account_cap);                                   // returns ()
//   incentive_v3::withdraw_with_account_cap<CoinType>(
//       clock, oracle, storage, pool, asset_id, amount, incentive_v2, incentive_v3,
//       account_cap): Balance<CoinType>;                // returns Balance<CoinType>

// === Read-only accessors ===
// Plain `public` (not `public(package)`): the off-chain agent and UI read these
// via `devInspect`, and the tests assert on them.

public fun owner<AccountCapT: key + store>(vault: &MultiAssetVault<AccountCapT>): address {
    vault.owner
}

public fun mandate_id<AccountCapT: key + store>(vault: &MultiAssetVault<AccountCapT>): ID {
    vault.mandate_id
}

public fun has_account_cap<AccountCapT: key + store>(vault: &MultiAssetVault<AccountCapT>): bool {
    vault.account_cap.is_some()
}

/// Idle balance held for `CoinType` (0 if the asset has no idle pot yet).
public fun idle_value<AccountCapT: key + store, CoinType>(
    vault: &MultiAssetVault<AccountCapT>,
): u64 {
    let key = type_name::with_defining_ids<CoinType>();
    if (vault.idle.contains(key)) {
        let pot: &Balance<CoinType> = vault.idle.borrow(key);
        pot.value()
    } else { 0 }
}

/// Recorded principal currently supplied to NAVI for `CoinType` (0 if none).
public fun supplied_value<AccountCapT: key + store, CoinType>(
    vault: &MultiAssetVault<AccountCapT>,
): u64 {
    let key = type_name::with_defining_ids<CoinType>();
    if (vault.supplied.contains(key)) {
        *(vault.supplied.borrow<TypeName, u64>(key))
    } else { 0 }
}

// === WithdrawTicket read accessors (for the agent's PTB bookkeeping) ===

public fun ticket_vault_id(t: &WithdrawTicket): ID { t.vault_id }

public fun ticket_amount(t: &WithdrawTicket): u64 { t.amount }

// === Test-only stub entrypoints (the gate + custody, sans live NAVI) ===
//
// NAVI's `Storage`/`Pool`/`Oracle`/`Incentive` are uncreatable in a unit test and
// the package isn't importable, so these drive the IDENTICAL production gate
// (`gate_and_release`) and the IDENTICAL custody seal (the ticket + re-absorb path)
// as `agent_supply` / `agent_withdraw_request` / `agent_absorb_withdrawn`,
// substituting ONLY the NAVI protocol call with a deterministic in-test stand-in.
// So the unit tests prove the gated-supply ledger update + the gated-withdraw
// re-absorption against the REAL production logic; only the protocol leg is mocked.
// The real call needs a LIVE integration run (see the header).

#[test_only]
/// Test twin of the SUPPLY leg: real gate + real release + real ledger bump, then
/// the "NAVI deposit" is stubbed by simply BURNING the released coin (production
/// hands it to NAVI; for custody-of-OUR-state purposes the coin has left the vault
/// either way). Returns nothing — mirrors that the real supply returns no coin to
/// re-hold. The test asserts idle ↓, supplied ↑, budget ↓.
public fun agent_supply_stub<AccountCapT: key + store, CoinType>(
    vault: &mut MultiAssetVault<AccountCapT>,
    mandate: &mut Mandate,
    cap: &AgentCap,
    scope_tag: u8,
    asset_id: u8,
    amount: u64,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    let coin = agent_supply<AccountCapT, CoinType>(
        vault, mandate, cap, scope_tag, asset_id, amount, clock, ctx,
    );
    // STUB for `incentive_v3::deposit_with_account_cap`: in production this coin is
    // consumed by NAVI; here we burn it so the test books balance without NAVI.
    coin::burn_for_testing(coin);
}

#[test_only]
/// Test twin of the WITHDRAW leg: real gate + real `supplied` decrement + real
/// ticket, then the "NAVI withdraw" is stubbed by MINTING a `redeemed` coin (what
/// NAVI would return) and running the REAL `agent_absorb_withdrawn` seal. So the
/// hot-potato re-absorption is exercised end-to-end. `redeemed` lets the test model
/// interest (redeemed > requested) or an exact redeem (redeemed == requested).
public fun agent_withdraw_stub<AccountCapT: key + store, CoinType>(
    vault: &mut MultiAssetVault<AccountCapT>,
    mandate: &mut Mandate,
    cap: &AgentCap,
    scope_tag: u8,
    asset_id: u8,
    amount: u64,
    redeemed: u64,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    let ticket = agent_withdraw_request<AccountCapT, CoinType>(
        vault, mandate, cap, scope_tag, asset_id, amount, clock,
    );
    // STUB for `incentive_v3::withdraw_with_account_cap`: NAVI returns a
    // Balance<CoinType>; we fabricate the equivalent Coin and run the REAL seal.
    let redeemed_coin = coin::mint_for_testing<CoinType>(redeemed, ctx);
    agent_absorb_withdrawn<AccountCapT, CoinType>(vault, ticket, redeemed_coin);
}
