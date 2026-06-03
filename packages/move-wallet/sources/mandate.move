/// Suize — the on-chain "leash" (a.k.a. the mandate / the cage).
///
/// This is the single non-negotiable primitive of the whole product: the
/// VM-enforced authority cap for an off-chain AI agent that moves a user's
/// *sandbox* funds. The agent is just a delegated keypair; it can only ever
/// act through `consume_budget`, which asserts every action against a shared
/// `Mandate` object. The over-limit transaction is therefore *impossible to
/// construct*, not merely "denied by a backend" — that's the entire thesis.
///
/// Modeled on DeepBook v3's `BalanceManager` + `TradeCap` + allow-list:
///   - the owner mints capped capabilities (`AgentCap`),
///   - the agent acts through them,
///   - the owner can revoke any capability at any time (the kill switch).
///
/// SCOPE OF THIS MODULE: this is the *pure authorization gate* only. It tracks
/// budget / scope / expiry / allow-list and emits the activity-log event. It
/// does NOT move any real `Balance<T>`. The vault + strategy adapter modules
/// (built later) will wrap the real coin operations *inside* a call to
/// `consume_budget`, so a strategy action and its budget debit are atomic.
module suize::mandate;

use sui::{clock::Clock, event, vec_set::{Self, VecSet}};

// === Errors ===
// Abort codes are part of this module's public contract: tests and the
// off-chain agent both pattern-match on the exact code. Do NOT renumber.

/// The mandate has passed its expiry; the agent can no longer act.
const EExpired: u64 = 0;
/// A non-owner tried to call an owner-only function.
const ENotOwner: u64 = 1;
/// The presented `AgentCap` is not (or no longer) on the allow-list.
const ECapNotAllowed: u64 = 2;
/// The requested amount exceeds the remaining budget.
const EOverBudget: u64 = 3;
/// The requested `scope_tag` is not in the mandate's allowed scope.
const EOutOfScope: u64 = 4;
/// The presented `AgentCap` was minted for a different mandate.
const ECapMandateMismatch: u64 = 5;

// === Structs ===

/// The leash. A SHARED object so the off-chain agent (a different keypair than
/// the owner) can reference and mutate it in its own transactions. All mutation
/// is gated: owner-only paths assert `sender == owner`; the agent path asserts
/// the full allow-list + budget + scope + expiry check.
public struct Mandate has key {
  id: UID,
  /// The user. Authority root for every owner-only function.
  owner: address,
  /// Remaining sandbox budget, in the smallest unit the caller accounts in
  /// (this gate is unit-agnostic; the vault module decides the unit). Strictly
  /// decremented by `consume_budget`; topped up only by the owner.
  budget_remaining: u64,
  /// Allowed strategy/venue tags (e.g. 0 = Suilend-supply, 1 = DeepBook-swap).
  /// A simple tag set is enough for now; richer per-protocol policy can layer
  /// on later without changing this primitive's shape.
  allowed_scope: VecSet<u8>,
  /// Unix-epoch millisecond deadline. The agent may act only while
  /// `clock.timestamp_ms() < expiry_ms`.
  expiry_ms: u64,
  /// The set of `AgentCap` object IDs currently authorized. Revoking simply
  /// removes the ID here, which is why an `AgentCap` has no `store`: it cannot
  /// be sold or moved away, and the only thing that grants it power is its
  /// continued membership in this set (the owner-controlled kill switch).
  allow_listed: VecSet<ID>,
}

/// A delegated agent capability. KEY ONLY, NO `store` — deliberately:
///   - non-transferable: the agent cannot resell or hand off its authority,
///   - bound to exactly one mandate via `mandate_id`,
///   - powerless on its own: it only works while its ID is in
///     `mandate.allow_listed`, so the owner's `revoke_agent_cap` is absolute.
///
/// Possession of the object is NOT the grant of authority here (unlike a plain
/// capability); the allow-list is. That makes revocation instant and total
/// without needing to claw back the object from the agent's address.
public struct AgentCap has key {
  id: UID,
  /// The mandate this cap is bound to. Checked first in `consume_budget` so a
  /// cap can never be used against a mandate it wasn't minted for.
  mandate_id: ID,
}

// === Events ===
// The on-chain activity log. The UI's hero "Log" surface and the agent's own
// bookkeeping read these. `AgentActed` is the per-move receipt.

public struct MandateCreated has copy, drop {
  mandate_id: ID,
  owner: address,
  budget: u64,
  expiry_ms: u64,
}

public struct AgentCapIssued has copy, drop {
  mandate_id: ID,
  cap_id: ID,
  agent: address,
}

public struct AgentCapRevoked has copy, drop {
  mandate_id: ID,
  cap_id: ID,
}

public struct BudgetToppedUp has copy, drop {
  mandate_id: ID,
  amount: u64,
  budget_remaining: u64,
}

/// Emitted on every successful agent action — the trust "show-your-work"
/// receipt and the idle-game event feed, all in one signal.
public struct AgentActed has copy, drop {
  mandate_id: ID,
  cap_id: ID,
  scope_tag: u8,
  amount: u64,
  budget_remaining: u64,
}

// === Owner-only functions ===

/// Create and SHARE a new mandate owned by the transaction sender.
///
/// `scope` is the initial set of allowed tags (duplicates collapse). `clock` is
/// accepted for symmetry / future "created_at" needs and to keep the owner flow
/// consistent with the agent flow; it is not asserted on here.
public fun create_mandate(
  budget: u64,
  scope: vector<u8>,
  expiry_ms: u64,
  _clock: &Clock,
  ctx: &mut TxContext,
) {
  let owner = ctx.sender();

  // Build the allowed-scope set from the provided tags.
  let mut allowed_scope = vec_set::empty<u8>();
  let mut i = 0;
  let n = scope.length();
  while (i < n) {
    let tag = scope[i];
    // Skip duplicates so callers don't have to pre-dedup; `insert` aborts
    // on an existing key, which we don't want here.
    if (!allowed_scope.contains(&tag)) {
      allowed_scope.insert(tag);
    };
    i = i + 1;
  };

  let mandate = Mandate {
    id: object::new(ctx),
    owner,
    budget_remaining: budget,
    allowed_scope,
    expiry_ms,
    allow_listed: vec_set::empty<ID>(),
  };

  event::emit(MandateCreated {
    mandate_id: object::id(&mandate),
    owner,
    budget,
    expiry_ms,
  });

  // Shared so the agent keypair can use it in its own transactions.
  transfer::share_object(mandate);
}

/// Mint a fresh `AgentCap` bound to `mandate`, allow-list it, and transfer it to
/// `agent`.
///
/// DELIVERY DECISION: we `transfer` the cap directly to the agent's address
/// rather than returning it. Rationale: the agent is a distinct off-chain
/// keypair, and the owner mints this cap in the owner's own transaction (e.g. a
/// PTB during onboarding). Transferring lands the object in the agent's account
/// so it can be used immediately without a second hand-off step. The cap has no
/// `store`, so it still cannot be transferred *onward* by the agent.
public fun issue_agent_cap(mandate: &mut Mandate, agent: address, ctx: &mut TxContext) {
  assert!(ctx.sender() == mandate.owner, ENotOwner);

  let cap = AgentCap {
    id: object::new(ctx),
    mandate_id: object::id(mandate),
  };
  let cap_id = object::id(&cap);

  mandate.allow_listed.insert(cap_id);

  event::emit(AgentCapIssued {
    mandate_id: object::id(mandate),
    cap_id,
    agent,
  });

  // KEY-only object → use the non-`store` transfer. This is the only way the
  // cap ever moves; the agent cannot move it again.
  transfer::transfer(cap, agent);
}

/// Revoke a capability — the kill switch. Removing `cap_id` from the allow-list
/// instantly and permanently disables it; the agent's next `consume_budget`
/// aborts with `ECapNotAllowed`. The object may still sit in the agent's
/// account, but it is now inert.
///
/// Idempotent-ish: aborts if `cap_id` was never on the list (so the owner gets a
/// clear signal they passed a wrong ID). Re-revoking an already-revoked cap will
/// abort for the same reason.
public fun revoke_agent_cap(mandate: &mut Mandate, cap_id: ID, ctx: &mut TxContext) {
  assert!(ctx.sender() == mandate.owner, ENotOwner);

  // `remove` aborts if absent; that's the desired "you passed a bad ID" signal.
  mandate.allow_listed.remove(&cap_id);

  event::emit(AgentCapRevoked {
    mandate_id: object::id(mandate),
    cap_id,
  });
}

/// Add to the remaining budget. Owner-only. Aborts on u64 overflow (default
/// Move checked arithmetic) — fine, no one tops up near 2^64.
public fun top_up_budget(mandate: &mut Mandate, amount: u64, ctx: &mut TxContext) {
  assert!(ctx.sender() == mandate.owner, ENotOwner);

  mandate.budget_remaining = mandate.budget_remaining + amount;

  event::emit(BudgetToppedUp {
    mandate_id: object::id(mandate),
    amount,
    budget_remaining: mandate.budget_remaining,
  });
}

/// Move the expiry deadline (extend or shorten — both are legitimate owner
/// actions; shortening to "now" is effectively a soft pause).
public fun set_expiry(mandate: &mut Mandate, expiry_ms: u64, ctx: &mut TxContext) {
  assert!(ctx.sender() == mandate.owner, ENotOwner);
  mandate.expiry_ms = expiry_ms;
}

// === Agent gate (the core primitive) ===

/// The authorization gate every real strategy action will call through.
///
/// Checks, IN THIS ORDER (the order is part of the contract — tests assert the
/// specific code that fires first):
///   1. cap is bound to *this* mandate          → `ECapMandateMismatch`
///   2. cap is currently allow-listed            → `ECapNotAllowed`
///   3. mandate has not expired                  → `EExpired`
///   4. `scope_tag` is in the allowed scope      → `EOutOfScope`
///   5. `amount` fits the remaining budget       → `EOverBudget`
///
/// On success: debits `amount` from `budget_remaining`, emits `AgentActed`, and
/// returns the new `budget_remaining`.
///
/// This takes `&AgentCap` (a shared-immutable-or-owned reference is enough): we
/// never mutate the cap; all authority state lives on the mandate's allow-list.
public fun consume_budget(
  mandate: &mut Mandate,
  cap: &AgentCap,
  scope_tag: u8,
  amount: u64,
  clock: &Clock,
): u64 {
  let mandate_id = object::id(mandate);
  let cap_id = object::id(cap);

  // 1. The cap must belong to this exact mandate.
  assert!(cap.mandate_id == mandate_id, ECapMandateMismatch);
  // 2. The cap must still be authorized (not revoked).
  assert!(mandate.allow_listed.contains(&cap_id), ECapNotAllowed);
  // 3. The leash must not have expired.
  assert!(clock.timestamp_ms() < mandate.expiry_ms, EExpired);
  // 4. The action's venue/strategy tag must be in scope.
  assert!(mandate.allowed_scope.contains(&scope_tag), EOutOfScope);
  // 5. The spend must fit the remaining budget.
  assert!(amount <= mandate.budget_remaining, EOverBudget);

  // State change before emitting — debit the budget.
  mandate.budget_remaining = mandate.budget_remaining - amount;

  event::emit(AgentActed {
    mandate_id,
    cap_id,
    scope_tag,
    amount,
    budget_remaining: mandate.budget_remaining,
  });

  mandate.budget_remaining
}

// === Read-only accessors ===
// Used by later modules (vault/guardian) and by tests. `public(package)` would
// be too tight — the off-chain agent and UI also `devInspect` these — so they
// are plain `public`.

public fun owner(mandate: &Mandate): address { mandate.owner }

public fun budget_remaining(mandate: &Mandate): u64 { mandate.budget_remaining }

public fun expiry_ms(mandate: &Mandate): u64 { mandate.expiry_ms }

public fun is_in_scope(mandate: &Mandate, scope_tag: u8): bool {
  mandate.allowed_scope.contains(&scope_tag)
}

public fun is_cap_allowed(mandate: &Mandate, cap_id: ID): bool {
  mandate.allow_listed.contains(&cap_id)
}

/// The mandate this cap is bound to.
public fun cap_mandate_id(cap: &AgentCap): ID { cap.mandate_id }

// === Test-only helpers ===

#[test_only]
/// Mint an `AgentCap` and hand it back to the caller instead of transferring it,
/// so tests can hold the object directly. Mirrors `issue_agent_cap`'s allow-list
/// bookkeeping and event so test paths match production behavior.
public fun issue_agent_cap_for_testing(mandate: &mut Mandate, ctx: &mut TxContext): AgentCap {
  assert!(ctx.sender() == mandate.owner, ENotOwner);

  let cap = AgentCap {
    id: object::new(ctx),
    mandate_id: object::id(mandate),
  };
  mandate.allow_listed.insert(object::id(&cap));

  event::emit(AgentCapIssued {
    mandate_id: object::id(mandate),
    cap_id: object::id(&cap),
    agent: ctx.sender(),
  });

  cap
}

#[test_only]
/// Destroy a cap in tests (it has no `drop`, so it must be explicitly consumed).
public fun destroy_cap_for_testing(cap: AgentCap) {
  let AgentCap { id, mandate_id: _ } = cap;
  id.delete();
}
