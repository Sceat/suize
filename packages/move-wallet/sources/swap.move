/// Suize — the DeepBook SPOT-SWAP adapter (the degen tier's SUI↔USDC primitive
/// AND the general "convert / optimize" swap utility).
///
/// This is the SECOND mandate-gated custody adapter (after `vault::agent_consume`,
/// the internal-move proof). It REPLACES that module's "idle → deployed" stand-in
/// with the REAL composable protocol call — DeepBook v3
/// `pool::swap_exact_base_for_quote` (Coin-in / Coin-out) — while keeping the
/// exact same TIGHT-CAGE pattern:
///   1. the vault may only be driven by ITS OWN mandate   (`EVaultMandateMismatch`)
///   2. `mandate::consume_budget` — the 5 asserts (the gate; aborts propagate)
///   3. the protocol round-trip — funds NEVER leave Move custody
///   4. emit the activity-log event.
///
/// === WHY A SEPARATE TWO-SIDED VAULT (the custody decision) ===
/// The core `Vault<phantom T>` custodies ONE coin type (one idle + one deployed
/// pot). A spot swap is irreducibly TWO-SIDED: it consumes one asset and produces
/// the other, and DeepBook fees are paid in a THIRD coin (`DEEP`). DeepBook's own
/// `Pool<Base, Quote>` is shaped exactly this way, so this adapter introduces a
/// `SwapVault<phantom Base, phantom Quote>` that mirrors it: a `base` pot, a
/// `quote` pot, and a `deep` fee pot, all `Balance<_>` in Move custody, all bound
/// to the same single `Mandate`. The degen tier is locked to SUI↔USDC (see
/// CLAUDE.md), so a two-sided object is the HONEST model — not a leaky generic.
/// The proven `Vault<T>` primitive is left untouched (zero regression).
///
/// === THE CAGE, CONCRETELY (the non-negotiable) ===
/// `agent_swap_*` splits the input asset OUT OF the vault's own balance into a
/// transient `Coin`, threads a `Coin<DEEP>` for fees from the vault's own DEEP
/// pot, calls the pool, and JOINS ALL THREE returned coins (leftover input,
/// output, leftover DEEP) straight back into the vault's pots. No `Coin` is ever
/// returned to the caller, so the agent has NOTHING to redirect to an attacker —
/// the funds are caged through the entire round-trip. (DeepBook can return the
/// inputs untouched when the size is below the pool minimum; re-absorbing all
/// three coins handles that no-op case for free.)
///
/// === WHAT IS UNIT-TESTED vs WHAT NEEDS A LIVE RUN (read this) ===
/// DeepBook's `Pool` is a `key`-ONLY shared object (no `store`) created through a
/// fee-paying, registry- + reference-pool-dependent flow; it is impractical to
/// fabricate in a Move unit test. So the REAL swap is isolated behind the single
/// internal seam `do_swap_base_to_quote` / `do_swap_quote_to_base` (the ONLY
/// DeepBook-touching lines). The GATE + the full 3-coin CUSTODY round-trip are
/// the part that can go wrong in OUR code, and those are exercised end-to-end in
/// `swap_tests` against a same-shaped STUB swap. The real `pool::swap_exact_*`
/// call is COMPILE-VERIFIED here against the pinned DeepBook dep, but exercising
/// it against a live `Pool` requires a localnet/testnet/mainnet integration run
/// (see `docs` note in the test file). We do NOT fake a passing test of the real
/// swap.
module suize::swap;

use suize::mandate::{Self, Mandate, AgentCap};
use sui::balance::{Self, Balance};
use sui::clock::Clock;
use sui::coin::{Self, Coin};
use sui::event;

// The REAL DeepBook v3 spot AMM + the DEEP fee coin. These are the production
// custody round-trip; see the per-call seam below. (`token::deep::DEEP` is the
// SOURCE type the `deepbook` package compiles against; the LIVE mainnet DEEP coin
// is a separately-published package — the off-chain agent supplies the real
// `Pool` object + the real DEEP coins at PTB-build time. See Move.toml notes.)
use deepbook::pool::{Self, Pool};
use token::deep::DEEP;

// === Errors ===
// Abort codes are part of this module's public contract: tests pattern-match on
// the exact code. Do NOT renumber. Numbering is local to this module.

/// A non-owner tried to call an owner-only function (`create_swap_vault` is a
/// free constructor, but `deposit_*` / `deposit_deep` are owner-gated).
const ENotOwner: u64 = 0;
/// The requested amount exceeds the available side balance (base or quote idle
/// pot). Asserted by THIS module before any `balance::split`, so callers get this
/// stable code rather than the framework's internal split abort.
const EInsufficientBalance: u64 = 1;
/// The swap vault's bound mandate is not the one passed to `agent_swap_*`. A
/// swap vault may only ever be driven by its OWN mandate.
const EVaultMandateMismatch: u64 = 2;
/// The vault's DEEP fee pot cannot cover the requested `deep_fee` for this swap.
/// Checked here so the owner gets a clear "top up DEEP" signal rather than a
/// framework split abort deep inside the pool call.
const EInsufficientDeep: u64 = 3;
/// The `Pool` passed to `agent_swap_*` is NOT the one this vault is pinned to.
/// THE CAGE FIX (C1): without this, a jailbroken agent could pass its OWN
/// `create_permissionless_pool`-minted pool and route the vault's funds through
/// it at `min_out = 0`, draining the sandbox for dust. The vault is bound to a
/// single owner-set `allowed_pool_id`; only that pool may ever be driven.
const EWrongPool: u64 = 4;
/// `min_out` (the slippage floor) was zero. THE CAGE FIX (C1, defense-in-depth):
/// a `min_out = 0` lets a round-trip return dust even against the pinned pool, so
/// we reject it outright. The deterministic core supplies a real floor; the agent
/// can never disarm slippage protection by passing zero.
const EZeroMinOut: u64 = 5;

// === Structs ===

/// The per-user TWO-SIDED sandbox vault for spot swaps. A SHARED object (like the
/// `Mandate` and the core `Vault`) so the off-chain agent keypair can drive it in
/// its own transactions. Every mutation is gated: owner paths assert
/// `sender == owner`; the agent path runs the vault↔mandate check then the full
/// mandate gate.
///
/// `Base` / `Quote` are `phantom` for the same reason as the core vault: the
/// types appear only inside `Balance<_>` (which carry their own witnesses). For
/// the degen tier this is instantiated as `SwapVault<SUI, USDC>` (Base = SUI,
/// Quote = USDC), matching DeepBook's `Pool<Base, Quote>` orientation.
public struct SwapVault<phantom Base, phantom Quote> has key {
    id: UID,
    /// The user. Authority root for every owner-only function.
    owner: address,
    /// The single mandate this vault is bound to — the only leash that may drive
    /// it. Checked first in `agent_swap_*` so a foreign mandate can never move
    /// this vault even if that mandate's own gate would pass.
    mandate_id: ID,
    /// THE PINNED POOL (C1 fix). The object ID of the ONE DeepBook `Pool<Base,
    /// Quote>` this vault is allowed to trade against. Owner-set at creation (and
    /// rotatable via `set_allowed_pool`). `agent_swap_*` asserts
    /// `object::id(pool) == allowed_pool_id`, so a jailbroken agent CANNOT route
    /// the vault's funds through a pool of its own making (e.g. a self-created
    /// permissionless pool with no liquidity and `min_out = 0`) — the pool is part
    /// of the cage, not a free runtime arg.
    allowed_pool_id: ID,
    /// The BASE-side custody pot (e.g. SUI). The agent swaps OUT OF here on a
    /// base→quote swap and the leftover/output lands back here.
    base: Balance<Base>,
    /// The QUOTE-side custody pot (e.g. USDC). Symmetric to `base`.
    quote: Balance<Quote>,
    /// The DEEP fee pot. DeepBook v3 takes its taker fee in DEEP; the agent
    /// threads a `Coin<DEEP>` from here into every swap and the unused remainder
    /// is re-absorbed. Owner-funded via `deposit_deep`. Kept INSIDE the vault so
    /// the agent never holds free DEEP either.
    deep: Balance<DEEP>,
}

// === Events ===
// Same on-chain activity-log surface as the `mandate` / `vault` events. This is
// the swap-side receipt the UI's hero "Log" reads.

public struct SwapVaultCreated has copy, drop {
    vault_id: ID,
    owner: address,
    mandate_id: ID,
    /// The pool this vault is pinned to at creation (C1).
    allowed_pool_id: ID,
}

/// Emitted when the owner re-pins the vault to a different DeepBook pool (C1).
public struct AllowedPoolSet has copy, drop {
    vault_id: ID,
    allowed_pool_id: ID,
}

public struct SwapDeposited has copy, drop {
    vault_id: ID,
    /// `true` = base side, `false` = quote side. (DEEP deposits emit
    /// `DeepDeposited` instead.)
    is_base: bool,
    amount: u64,
    base: u64,
    quote: u64,
}

public struct DeepDeposited has copy, drop {
    vault_id: ID,
    amount: u64,
    deep: u64,
}

/// Emitted on every successful agent swap. `amount_in` is what was pulled from
/// the input side; `amount_out` is what the pool returned to the output side
/// (net of any leftover that was re-absorbed). `base_to_quote` records direction.
/// This is the per-swap "show-your-work" receipt + the idle-game event feed.
public struct AgentSwapped has copy, drop {
    vault_id: ID,
    scope_tag: u8,
    base_to_quote: bool,
    amount_in: u64,
    amount_out: u64,
    deep_spent: u64,
}

// === Constructor (free, owner-rooted) ===

/// Create and SHARE a per-user two-sided swap vault, owned by the sender and
/// bound to `mandate_id`. Like `vault::create_vault`, the caller passes the ID of
/// a mandate they own (e.g. the degen mandate minted in the same onboarding PTB);
/// the agent gate later enforces that ONLY that mandate can drive this vault.
///
/// `allowed_pool_id` PINS the vault to the single DeepBook `Pool<Base, Quote>` the
/// agent may ever trade against (C1). The owner supplies the canonical SUI↔USDC
/// pool's object ID here at onboarding; the agent gate then refuses any other pool.
/// Re-pin later via `set_allowed_pool`.
public fun create_swap_vault<Base, Quote>(
    mandate_id: ID,
    allowed_pool_id: ID,
    ctx: &mut TxContext,
) {
    let owner = ctx.sender();

    let vault = SwapVault<Base, Quote> {
        id: object::new(ctx),
        owner,
        mandate_id,
        allowed_pool_id,
        base: balance::zero<Base>(),
        quote: balance::zero<Quote>(),
        deep: balance::zero<DEEP>(),
    };

    event::emit(SwapVaultCreated {
        vault_id: object::id(&vault),
        owner,
        mandate_id,
        allowed_pool_id,
    });

    transfer::share_object(vault);
}

/// Owner-only: re-pin the vault to a different DeepBook `Pool` (C1). The authority
/// root is the same `sender == owner` check used by every owner path here. Lets the
/// user rotate to a new canonical pool without rebuilding the vault; the agent is
/// never granted this power (no `AgentCap` path reaches it).
public fun set_allowed_pool<Base, Quote>(
    vault: &mut SwapVault<Base, Quote>,
    allowed_pool_id: ID,
    ctx: &TxContext,
) {
    assert!(ctx.sender() == vault.owner, ENotOwner);
    vault.allowed_pool_id = allowed_pool_id;

    event::emit(AllowedPoolSet {
        vault_id: object::id(vault),
        allowed_pool_id,
    });
}

// === Owner-only deposits ===

/// Deposit base-side funds (e.g. SUI) into the vault. Owner-only.
public fun deposit_base<Base, Quote>(
    vault: &mut SwapVault<Base, Quote>,
    coin: Coin<Base>,
    ctx: &TxContext,
) {
    assert!(ctx.sender() == vault.owner, ENotOwner);

    let amount = coin::value(&coin);
    vault.base.join(coin.into_balance());

    event::emit(SwapDeposited {
        vault_id: object::id(vault),
        is_base: true,
        amount,
        base: vault.base.value(),
        quote: vault.quote.value(),
    });
}

/// Deposit quote-side funds (e.g. USDC) into the vault. Owner-only.
public fun deposit_quote<Base, Quote>(
    vault: &mut SwapVault<Base, Quote>,
    coin: Coin<Quote>,
    ctx: &TxContext,
) {
    assert!(ctx.sender() == vault.owner, ENotOwner);

    let amount = coin::value(&coin);
    vault.quote.join(coin.into_balance());

    event::emit(SwapDeposited {
        vault_id: object::id(vault),
        is_base: false,
        amount,
        base: vault.base.value(),
        quote: vault.quote.value(),
    });
}

/// Deposit DEEP into the vault's fee pot. Owner-only. The agent draws on this to
/// pay DeepBook's taker fee on every swap; the owner tops it up here.
public fun deposit_deep<Base, Quote>(
    vault: &mut SwapVault<Base, Quote>,
    coin: Coin<DEEP>,
    ctx: &TxContext,
) {
    assert!(ctx.sender() == vault.owner, ENotOwner);

    let amount = coin::value(&coin);
    vault.deep.join(coin.into_balance());

    event::emit(DeepDeposited {
        vault_id: object::id(vault),
        amount,
        deep: vault.deep.value(),
    });
}

// === Owner-only withdrawals (idle-only, both sides) ===
// Force-unwind / withdraw_all of DEPLOYED protocol positions is a SEPARATE later
// task (per the build scope). These return idle side-funds to the owner.

/// Withdraw `amount` of base-side funds back to a Coin for the owner. Owner-only.
public fun withdraw_base<Base, Quote>(
    vault: &mut SwapVault<Base, Quote>,
    amount: u64,
    ctx: &mut TxContext,
): Coin<Base> {
    assert!(ctx.sender() == vault.owner, ENotOwner);
    assert!(vault.base.value() >= amount, EInsufficientBalance);
    coin::from_balance(vault.base.split(amount), ctx)
}

/// Withdraw `amount` of quote-side funds back to a Coin for the owner. Owner-only.
public fun withdraw_quote<Base, Quote>(
    vault: &mut SwapVault<Base, Quote>,
    amount: u64,
    ctx: &mut TxContext,
): Coin<Quote> {
    assert!(ctx.sender() == vault.owner, ENotOwner);
    assert!(vault.quote.value() >= amount, EInsufficientBalance);
    coin::from_balance(vault.quote.split(amount), ctx)
}

/// Withdraw `amount` of DEEP fee funds back to a Coin for the owner. Owner-only.
public fun withdraw_deep<Base, Quote>(
    vault: &mut SwapVault<Base, Quote>,
    amount: u64,
    ctx: &mut TxContext,
): Coin<DEEP> {
    assert!(ctx.sender() == vault.owner, ENotOwner);
    assert!(vault.deep.value() >= amount, EInsufficientDeep);
    coin::from_balance(vault.deep.split(amount), ctx)
}

// === Agent gate (the cage) — base → quote ===

/// The agent's mandate-gated SUI→USDC (base→quote) swap. PROVES the funds make
/// the full DeepBook round-trip without ever leaving Move custody.
///
/// Order of operations (the order is the contract — tests assert which fires
/// first):
///   1. `vault.mandate_id == object::id(mandate)`  → `EVaultMandateMismatch`.
///   2. `mandate::consume_budget(...)` → the 5 mandate asserts (cap↔mandate,
///      allow-listed, not expired, in scope, within budget). Aborts propagate
///      with the mandate's own codes. The budget is debited by `amount_in` HERE,
///      atomically with the swap below.
///   3. `base >= amount_in` → `EInsufficientBalance` (input-side wall; runs after
///      the budget gate so an over-budget spend reports `EOverBudget`).
///   4. `deep >= deep_fee` → `EInsufficientDeep` (fee-side wall).
///   5. split `amount_in` base + `deep_fee` DEEP OUT of the vault into transient
///      Coins, call the pool, and JOIN all three returned coins back IN:
///        - leftover base  → `base` pot,
///        - quote out      → `quote` pot,
///        - leftover DEEP  → `deep` pot.
///      No `Coin` is returned to the caller. THIS is the cage.
///   6. emit `AgentSwapped`.
///
/// `min_quote_out` is the agent's slippage floor, passed straight to DeepBook
/// (`EMinimumQuantityOutNotMet` aborts the whole tx if the pool can't meet it —
/// the deterministic-core `minOut` guarantee from CLAUDE.md). `deep_fee` is an
/// OVER-estimate the agent supplies; DeepBook consumes what it needs and the rest
/// is re-absorbed, so over-supplying is safe and never leaks.
public fun agent_swap_base_to_quote<Base, Quote>(
    vault: &mut SwapVault<Base, Quote>,
    mandate: &mut Mandate,
    cap: &AgentCap,
    pool: &mut Pool<Base, Quote>,
    scope_tag: u8,
    amount_in: u64,
    deep_fee: u64,
    min_quote_out: u64,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    // C1 — THE POOL PIN. The agent may only ever trade against the vault's pinned
    // pool; a self-created drain pool is rejected before any custody is touched.
    assert!(object::id(pool) == vault.allowed_pool_id, EWrongPool);

    // Steps 1–4 + the min_out floor + split the BASE input out of custody.
    let (base_in, deep_in) = gate_and_split_base(
        vault, mandate, cap, scope_tag, amount_in, deep_fee, min_quote_out, clock, ctx,
    );

    // Step 5a — the REAL DeepBook call (the ONLY protocol-touching line on this
    // path). Returns (leftover base, quote out, leftover DEEP).
    let (base_leftover, quote_out, deep_leftover) = do_swap_base_to_quote<Base, Quote>(
        pool, base_in, deep_in, min_quote_out, clock, ctx,
    );

    // Step 5b + 6 — re-absorb ALL THREE coins and emit (shared, single-source).
    absorb_and_emit(
        vault, scope_tag, true, amount_in, deep_fee,
        base_leftover, quote_out, deep_leftover,
    );
}

// === Agent gate (the cage) — quote → base ===

/// The symmetric USDC→SUI (quote→base) swap. Same gate, same custody guarantee;
/// see `agent_swap_base_to_quote` for the full contract. `min_base_out` is the
/// slippage floor.
public fun agent_swap_quote_to_base<Base, Quote>(
    vault: &mut SwapVault<Base, Quote>,
    mandate: &mut Mandate,
    cap: &AgentCap,
    pool: &mut Pool<Base, Quote>,
    scope_tag: u8,
    amount_in: u64,
    deep_fee: u64,
    min_base_out: u64,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    // C1 — THE POOL PIN (symmetric to base→quote).
    assert!(object::id(pool) == vault.allowed_pool_id, EWrongPool);

    // Steps 1–4 + the min_out floor + split the QUOTE input out of custody.
    let (quote_in, deep_in) = gate_and_split_quote(
        vault, mandate, cap, scope_tag, amount_in, deep_fee, min_base_out, clock, ctx,
    );

    // Step 5a — the REAL DeepBook call. Returns (base out, leftover quote,
    // leftover DEEP).
    let (base_out, quote_leftover, deep_leftover) = do_swap_quote_to_base<Base, Quote>(
        pool, quote_in, deep_in, min_base_out, clock, ctx,
    );

    // Step 5b + 6 — re-absorb ALL THREE coins and emit (shared, single-source).
    absorb_and_emit(
        vault, scope_tag, false, amount_in, deep_fee,
        base_out, quote_leftover, deep_leftover,
    );
}

// === Shared gate + custody helpers (single source of truth) ===
// These hold the load-bearing logic that the unit tests exercise THROUGH the
// production agent functions AND through the test-only stub-swap entrypoints, so
// the gated-swap + 3-coin re-absorption pattern is genuinely tested once, not
// re-implemented for the tests. ONLY the inner `do_swap_*` line differs between
// production (real pool) and the stub (uncreatable-pool substitute).

/// Steps 1–4 for a base→quote swap: vault↔mandate check, the full mandate gate
/// (which debits the budget), the input-side and DEEP-side balance walls, then
/// split the `amount_in` base + `deep_fee` DEEP OUT of the vault into transient
/// Coins ready to feed the pool. Returns `(base_in, deep_in)`.
fun gate_and_split_base<Base, Quote>(
    vault: &mut SwapVault<Base, Quote>,
    mandate: &mut Mandate,
    cap: &AgentCap,
    scope_tag: u8,
    amount_in: u64,
    deep_fee: u64,
    min_out: u64,
    clock: &Clock,
    ctx: &mut TxContext,
): (Coin<Base>, Coin<DEEP>) {
    // C1 — the slippage floor (defense-in-depth). A zero floor would let a
    // round-trip return dust even against the pinned pool; reject it outright.
    assert!(min_out > 0, EZeroMinOut);
    // 1. This vault may only be driven by its own mandate.
    assert!(vault.mandate_id == object::id(mandate), EVaultMandateMismatch);
    // 2. The full mandate gate (5 asserts) + budget debit. Atomic with the swap.
    mandate::consume_budget(mandate, cap, scope_tag, amount_in, clock);
    // 3 & 4. Vault-side walls — explicit so the abort codes are ours.
    assert!(vault.base.value() >= amount_in, EInsufficientBalance);
    assert!(vault.deep.value() >= deep_fee, EInsufficientDeep);

    let base_in = coin::from_balance(vault.base.split(amount_in), ctx);
    let deep_in = coin::from_balance(vault.deep.split(deep_fee), ctx);
    (base_in, deep_in)
}

/// Steps 1–4 for a quote→base swap (symmetric to `gate_and_split_base`, splitting
/// the QUOTE side out). Returns `(quote_in, deep_in)`.
fun gate_and_split_quote<Base, Quote>(
    vault: &mut SwapVault<Base, Quote>,
    mandate: &mut Mandate,
    cap: &AgentCap,
    scope_tag: u8,
    amount_in: u64,
    deep_fee: u64,
    min_out: u64,
    clock: &Clock,
    ctx: &mut TxContext,
): (Coin<Quote>, Coin<DEEP>) {
    // C1 — the slippage floor (defense-in-depth), symmetric to the base side.
    assert!(min_out > 0, EZeroMinOut);
    assert!(vault.mandate_id == object::id(mandate), EVaultMandateMismatch);
    mandate::consume_budget(mandate, cap, scope_tag, amount_in, clock);
    assert!(vault.quote.value() >= amount_in, EInsufficientBalance);
    assert!(vault.deep.value() >= deep_fee, EInsufficientDeep);

    let quote_in = coin::from_balance(vault.quote.split(amount_in), ctx);
    let deep_in = coin::from_balance(vault.deep.split(deep_fee), ctx);
    (quote_in, deep_in)
}

/// Step 5b + 6 (direction-agnostic): re-absorb ALL THREE coins the pool returned
/// back into the vault's pots and emit `AgentSwapped`. THIS is the custody seal —
/// every coin is consumed into a `Balance`, so nothing can escape to the caller.
/// The coins arrive in the real call's FIXED order: `base_coin` (Coin<Base>),
/// `quote_coin` (Coin<Quote>), `deep_coin` (leftover DEEP). On a base→quote swap
/// the grown side is quote and `base_coin` is the leftover input; on quote→base it
/// is the reverse.
fun absorb_and_emit<Base, Quote>(
    vault: &mut SwapVault<Base, Quote>,
    scope_tag: u8,
    base_to_quote: bool,
    amount_in: u64,
    deep_fee: u64,
    base_coin: Coin<Base>,
    quote_coin: Coin<Quote>,
    deep_coin: Coin<DEEP>,
) {
    // The output value is the side that GREW: quote on base→quote, base otherwise.
    let amount_out = if (base_to_quote) {
        coin::value(&quote_coin)
    } else {
        coin::value(&base_coin)
    };
    // `deep_spent` is a RECEIPT STAT ONLY (it just feeds the event). The real pool
    // returns leftover DEEP <= deep_fee, so the subtraction is normally safe — but
    // we saturate defensively so an unexpected DEEP refund (e.g. a future rebate)
    // can NEVER underflow-abort an otherwise-valid swap. Custody does not depend on
    // this value; the coin itself is re-absorbed in full just below regardless.
    let deep_back = coin::value(&deep_coin);
    let deep_spent = if (deep_fee >= deep_back) { deep_fee - deep_back } else { 0 };

    // Re-absorb every coin — NOTHING leaves custody.
    vault.base.join(base_coin.into_balance());
    vault.quote.join(quote_coin.into_balance());
    vault.deep.join(deep_coin.into_balance());

    event::emit(AgentSwapped {
        vault_id: object::id(vault),
        scope_tag,
        base_to_quote,
        amount_in,
        amount_out,
        deep_spent,
    });
}

// === The DeepBook seam (the ONLY protocol-touching lines) ===
// Isolated so the gate + custody logic above is fully unit-testable against a
// stub of the SAME 3-coin shape, while these two functions hold the real,
// compile-verified `pool::swap_exact_*` calls that require a LIVE `Pool` to run.
// Kept `public(package)` (not private) only so a future integration-test module
// in this package could drive them against a real localnet pool; external callers
// cannot reach them.

/// REAL DeepBook base→quote swap. Coin<Base> + Coin<DEEP> in →
/// (leftover Coin<Base>, Coin<Quote> out, leftover Coin<DEEP>) out.
public(package) fun do_swap_base_to_quote<Base, Quote>(
    pool: &mut Pool<Base, Quote>,
    base_in: Coin<Base>,
    deep_in: Coin<DEEP>,
    min_quote_out: u64,
    clock: &Clock,
    ctx: &mut TxContext,
): (Coin<Base>, Coin<Quote>, Coin<DEEP>) {
    pool::swap_exact_base_for_quote<Base, Quote>(
        pool,
        base_in,
        deep_in,
        min_quote_out,
        clock,
        ctx,
    )
}

/// REAL DeepBook quote→base swap. Coin<Quote> + Coin<DEEP> in →
/// (Coin<Base> out, leftover Coin<Quote>, leftover Coin<DEEP>) out.
public(package) fun do_swap_quote_to_base<Base, Quote>(
    pool: &mut Pool<Base, Quote>,
    quote_in: Coin<Quote>,
    deep_in: Coin<DEEP>,
    min_base_out: u64,
    clock: &Clock,
    ctx: &mut TxContext,
): (Coin<Base>, Coin<Quote>, Coin<DEEP>) {
    pool::swap_exact_quote_for_base<Base, Quote>(
        pool,
        quote_in,
        deep_in,
        min_base_out,
        clock,
        ctx,
    )
}

// === Read-only accessors ===
// Plain `public` (not `public(package)`): the off-chain agent and UI read these
// via `devInspect`, and the tests assert on them.

public fun owner<Base, Quote>(vault: &SwapVault<Base, Quote>): address { vault.owner }

public fun mandate_id<Base, Quote>(vault: &SwapVault<Base, Quote>): ID { vault.mandate_id }

/// The DeepBook pool this vault is pinned to (C1). The UI/agent reads this to know
/// which pool to thread into `agent_swap_*`; any other pool is rejected `EWrongPool`.
public fun allowed_pool_id<Base, Quote>(vault: &SwapVault<Base, Quote>): ID {
    vault.allowed_pool_id
}

public fun base_value<Base, Quote>(vault: &SwapVault<Base, Quote>): u64 { vault.base.value() }

public fun quote_value<Base, Quote>(vault: &SwapVault<Base, Quote>): u64 { vault.quote.value() }

public fun deep_value<Base, Quote>(vault: &SwapVault<Base, Quote>): u64 { vault.deep.value() }

// === Test-only stub-swap entrypoints (the gate + custody, sans live Pool) ===
//
// DeepBook's `Pool` is `key`-only and cannot be fabricated in a Move unit test
// (see the module header). These entrypoints run the IDENTICAL production gate
// (`gate_and_split_*`) and custody seal (`absorb_and_emit`) as the real
// `agent_swap_*`, substituting ONLY the inner `do_swap_*` line with a
// deterministic `stub_swap_*` that has the SAME 3-coin shape. So the unit tests
// prove the gated-swap + full 3-coin re-absorption pattern against the real
// production logic; only the protocol call itself is mocked. The real
// `pool::swap_exact_*` path is compile-verified above and requires a live
// localnet/testnet/mainnet `Pool` to exercise (flagged in `swap_tests`).
//
// The stub lets the test dictate the pool's behavior explicitly (all three
// figures are what the "pool" RETURNS, mirroring the real call's three outputs):
//   - `out_amount`     : OUTPUT-side coin the "pool" mints (quote for b→q),
//   - `deep_leftover`  : DEEP the "pool" gives back (so it "spent" deep_fee minus
//                        this — exactly what the real call returns),
//   - `input_leftover` : INPUT-side coin returned unspent (models the lot-size
//                        remainder, or — with input_leftover == amount_in and
//                        out_amount == 0 — the below-min-size NO-OP case where the
//                        real pool returns the inputs untouched).
// Conservation is the test's responsibility to set up sanely; the CUSTODY logic
// under test simply re-absorbs whatever the pool returns.

#[test_only]
/// Test twin of `agent_swap_base_to_quote`: real gate + real custody seal, stub
/// swap. `coin::mint_for_testing` fabricates the output + leftover coins.
public fun agent_swap_base_to_quote_stub<Base, Quote>(
    vault: &mut SwapVault<Base, Quote>,
    mandate: &mut Mandate,
    cap: &AgentCap,
    scope_tag: u8,
    amount_in: u64,
    deep_fee: u64,
    min_out: u64,
    out_amount: u64,
    deep_leftover_amt: u64,
    input_leftover: u64,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    // REAL gate + split (steps 1–4 + the min_out floor) — same code path as
    // production. The pool-pin assert lives in `agent_swap_base_to_quote` (it needs
    // the real `Pool`, which is uncreatable here); everything else is identical.
    let (base_in, deep_in) = gate_and_split_base(
        vault, mandate, cap, scope_tag, amount_in, deep_fee, min_out, clock, ctx,
    );

    // STUB swap (replaces `do_swap_base_to_quote`): the real call takes a zero
    // quote coin internally, so we pass a zero quote here. Returns the SAME
    // (base leftover, quote out, leftover DEEP) shape as the real pool.
    let (base_leftover, quote_out, deep_leftover) = stub_swap(
        base_in, coin::zero<Quote>(ctx), deep_in,
        out_amount, deep_leftover_amt, input_leftover, true, ctx,
    );

    // REAL custody seal (step 5b + 6) — same code path as production.
    absorb_and_emit(
        vault, scope_tag, true, amount_in, deep_fee,
        base_leftover, quote_out, deep_leftover,
    );
}

#[test_only]
/// Test twin of `agent_swap_quote_to_base`: real gate + real custody seal, stub
/// swap.
public fun agent_swap_quote_to_base_stub<Base, Quote>(
    vault: &mut SwapVault<Base, Quote>,
    mandate: &mut Mandate,
    cap: &AgentCap,
    scope_tag: u8,
    amount_in: u64,
    deep_fee: u64,
    min_out: u64,
    out_amount: u64,
    deep_leftover_amt: u64,
    input_leftover: u64,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    let (quote_in, deep_in) = gate_and_split_quote(
        vault, mandate, cap, scope_tag, amount_in, deep_fee, min_out, clock, ctx,
    );

    // STUB swap: real call takes a zero base coin internally; pass a zero base
    // here. Returns (base out, quote leftover, leftover DEEP).
    let (base_out, quote_leftover, deep_leftover) = stub_swap(
        coin::zero<Base>(ctx), quote_in, deep_in,
        out_amount, deep_leftover_amt, input_leftover, false, ctx,
    );

    absorb_and_emit(
        vault, scope_tag, false, amount_in, deep_fee,
        base_out, quote_leftover, deep_leftover,
    );
}

#[test_only]
/// The deterministic stand-in for `pool::swap_exact_*`. Returns the SAME FIXED
/// `(Coin<Base>, Coin<Quote>, Coin<DEEP>)` tuple ORDER as both real calls
/// (base-first, quote-second, deep-third — regardless of direction), so the call
/// sites match `do_swap_*` exactly and `absorb_and_emit` receives the coins in the
/// orientation it expects. `base_to_quote` decides which side is the consumed
/// input vs the produced output:
///   - base→quote: base is input (returns `input_leftover` base + `out_amount`
///     quote),
///   - quote→base: quote is input (returns `out_amount` base + `input_leftover`
///     quote).
///
/// Consumes the supplied input + DEEP coins via `burn_for_testing` (the real pool
/// consumes them internally) and mints the leftovers + output + DEEP refund, so
/// the test coins balance without a TreasuryCap.
fun stub_swap<Base, Quote>(
    base_in: Coin<Base>,
    quote_in: Coin<Quote>,
    deep_coin: Coin<DEEP>,
    out_amount: u64,
    deep_leftover_amt: u64,
    input_leftover: u64,
    base_to_quote: bool,
    ctx: &mut TxContext,
): (Coin<Base>, Coin<Quote>, Coin<DEEP>) {
    // Burn whatever was fed in; the real pool consumes the inputs internally.
    coin::burn_for_testing(base_in);
    coin::burn_for_testing(quote_in);
    coin::burn_for_testing(deep_coin);

    let (base_out, quote_out) = if (base_to_quote) {
        // Base consumed → base leftover + quote output.
        (
            coin::mint_for_testing<Base>(input_leftover, ctx),
            coin::mint_for_testing<Quote>(out_amount, ctx),
        )
    } else {
        // Quote consumed → base output + quote leftover.
        (
            coin::mint_for_testing<Base>(out_amount, ctx),
            coin::mint_for_testing<Quote>(input_leftover, ctx),
        )
    };
    let deep_back = coin::mint_for_testing<DEEP>(deep_leftover_amt, ctx);
    (base_out, quote_out, deep_back)
}
