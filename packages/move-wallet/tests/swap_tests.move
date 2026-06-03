#[test_only]
/// Tests for `suize::swap` — the DeepBook spot-swap adapter — written TESTS-FIRST.
///
/// HEADLINE GUARANTEE UNDER TEST: the mandate-gated swap is a TIGHT CAGE. The
/// agent can move sandbox funds through a DeepBook round-trip ONLY within its
/// mandate (budget / scope / expiry / allow-list / own-mandate), and the funds
/// NEVER leave Move custody — every coin the pool returns (leftover input, output,
/// leftover DEEP) is re-absorbed into the `SwapVault`'s own pots; NOTHING is
/// handed back to the caller for the agent to redirect.
///
/// WHAT THESE TESTS COVER vs WHAT NEEDS A LIVE RUN
/// ----------------------------------------------------------------------------
/// DeepBook's `Pool<Base, Quote>` is a `key`-ONLY shared object instantiated via a
/// fee-paying, registry- + reference-pool-dependent flow; it is impractical to
/// fabricate in a Move unit test. So these tests drive the production GATE
/// (`gate_and_split_*`) and the production CUSTODY seal (`absorb_and_emit`)
/// through the `*_stub` entrypoints, which substitute ONLY the inner
/// `pool::swap_exact_*` line with a deterministic `stub_swap` of the identical
/// 3-coin shape. So the gated-swap pattern + the full 3-coin re-absorption are
/// tested against the REAL production logic; only the protocol call is mocked.
///
/// The REAL `pool::swap_exact_base_for_quote` / `swap_exact_quote_for_base` calls
/// in `agent_swap_base_to_quote` / `agent_swap_quote_to_base` are COMPILE-VERIFIED
/// (the package builds against the pinned DeepBook dep), but exercising them end-
/// to-end requires a LIVE `Pool` on localnet/testnet/mainnet — i.e. an integration
/// test that creates/uses a real SUI/USDC pool with real DEEP. That is a separate
/// integration run and is intentionally NOT faked here.
///
/// As in `vault_tests`, abort-code constants are referenced by fully-qualified
/// path inside `#[expected_failure(...)]` (importing them would only yield
/// "unused alias" warnings).
module suize::swap_tests;

use suize::mandate::{Self, Mandate, AgentCap};
use suize::swap::{Self, SwapVault};
use sui::clock::{Self, Clock};
use sui::coin::{Self, Coin};
use sui::test_scenario::{Self as ts, Scenario};

// === Test coin types ===
// Stand-ins for the degen pair: BASE ~ SUI, QUOTE ~ USDC. Bare `has drop`
// witnesses; `coin::mint_for_testing` fabricates balances without a TreasuryCap.
// DEEP is the framework-external fee coin; we mint a LOCAL `DEEP` test type only
// where the vault's DEEP type-arg is the `token::deep::DEEP` the module imports —
// so for the fee coin we mint via the module's own DEEP type through the
// adapter's deposit. (The vault is `SwapVault<BASE, QUOTE>`; its DEEP pot is fixed
// to the real DEEP type, which we fund using `coin::mint_for_testing` of that
// same type in `deposit_deep_as_owner`.)
public struct BASE has drop {}
public struct QUOTE has drop {}

// The DEEP type the adapter's fee pot uses (re-exported path for the test mints).
use token::deep::DEEP;

// === Test actors ===
const OWNER: address = @0xA;
const AGENT: address = @0xB;
const STRANGER: address = @0xC;

// === Test fixtures ===
const BUDGET: u64 = 1_000;
const EXPIRY_MS: u64 = 10_000;
// Scope-tag convention (CLAUDE.md v3): 2 = DeepBook swap.
const SCOPE_SWAP: u8 = 2;
const SCOPE_NOT_ALLOWED: u8 = 9;

// Fund both sides far above the budget so that, in the over-budget test, the
// BUDGET (not a side balance) is unambiguously the binding constraint.
const DEPOSIT_BASE: u64 = 5_000;
const DEPOSIT_QUOTE: u64 = 5_000;
const DEPOSIT_DEEP: u64 = 2_000;

// === Helpers ===

fun begin(): (Scenario, Clock) {
    let mut scenario = ts::begin(OWNER);
    let clock = clock::create_for_testing(scenario.ctx());
    (scenario, clock)
}

/// Create a default mandate as OWNER (scope: swap) and return its ID.
fun create_default_mandate(scenario: &mut Scenario, clock: &Clock): ID {
    scenario.next_tx(OWNER);
    mandate::create_mandate(
        BUDGET,
        vector[SCOPE_SWAP],
        EXPIRY_MS,
        clock,
        scenario.ctx(),
    );

    scenario.next_tx(OWNER);
    let mandate = scenario.take_shared<Mandate>();
    let id = object::id(&mandate);
    ts::return_shared(mandate);
    id
}

/// As OWNER, create + share a SwapVault<BASE, QUOTE> linked to `mandate_id`.
fun create_swap_vault_for(scenario: &mut Scenario, mandate_id: ID) {
    scenario.next_tx(OWNER);
    swap::create_swap_vault<BASE, QUOTE>(mandate_id, scenario.ctx());
}

fun deposit_base_as_owner(scenario: &mut Scenario, amount: u64) {
    scenario.next_tx(OWNER);
    let mut vault = scenario.take_shared<SwapVault<BASE, QUOTE>>();
    let coin = coin::mint_for_testing<BASE>(amount, scenario.ctx());
    swap::deposit_base<BASE, QUOTE>(&mut vault, coin, scenario.ctx());
    ts::return_shared(vault);
}

fun deposit_quote_as_owner(scenario: &mut Scenario, amount: u64) {
    scenario.next_tx(OWNER);
    let mut vault = scenario.take_shared<SwapVault<BASE, QUOTE>>();
    let coin = coin::mint_for_testing<QUOTE>(amount, scenario.ctx());
    swap::deposit_quote<BASE, QUOTE>(&mut vault, coin, scenario.ctx());
    ts::return_shared(vault);
}

fun deposit_deep_as_owner(scenario: &mut Scenario, amount: u64) {
    scenario.next_tx(OWNER);
    let mut vault = scenario.take_shared<SwapVault<BASE, QUOTE>>();
    let coin = coin::mint_for_testing<DEEP>(amount, scenario.ctx());
    swap::deposit_deep<BASE, QUOTE>(&mut vault, coin, scenario.ctx());
    ts::return_shared(vault);
}

/// Fully fund the vault: base + quote + DEEP.
fun fund_vault(scenario: &mut Scenario) {
    deposit_base_as_owner(scenario, DEPOSIT_BASE);
    deposit_quote_as_owner(scenario, DEPOSIT_QUOTE);
    deposit_deep_as_owner(scenario, DEPOSIT_DEEP);
}

fun issue_cap_to_agent(scenario: &mut Scenario) {
    scenario.next_tx(OWNER);
    let mut mandate = scenario.take_shared<Mandate>();
    mandate::issue_agent_cap(&mut mandate, AGENT, scenario.ctx());
    ts::return_shared(mandate);
}

fun cleanup(scenario: Scenario, clock: Clock) {
    clock::destroy_for_testing(clock);
    scenario.end();
}

// ============================================================================
// SUCCESS / CUSTODY PATHS
// ============================================================================

#[test]
/// Owner lifecycle: create → deposit base + quote + DEEP → values track exactly,
/// the vault↔mandate link is correct, and `deposit_deep` lands in the DEEP pot.
fun test_create_and_deposits_track() {
    let (mut scenario, clock) = begin();

    let mandate_id = create_default_mandate(&mut scenario, &clock);
    create_swap_vault_for(&mut scenario, mandate_id);
    fund_vault(&mut scenario);

    scenario.next_tx(OWNER);
    {
        let vault = scenario.take_shared<SwapVault<BASE, QUOTE>>();
        assert!(swap::owner<BASE, QUOTE>(&vault) == OWNER, 0);
        assert!(swap::mandate_id<BASE, QUOTE>(&vault) == mandate_id, 1);
        assert!(swap::base_value<BASE, QUOTE>(&vault) == DEPOSIT_BASE, 2);
        assert!(swap::quote_value<BASE, QUOTE>(&vault) == DEPOSIT_QUOTE, 3);
        assert!(swap::deep_value<BASE, QUOTE>(&vault) == DEPOSIT_DEEP, 4);
        ts::return_shared(vault);
    };

    cleanup(scenario, clock);
}

#[test]
/// THE HEADLINE PROOF (base→quote): a mandate-gated SUI→USDC swap within budget.
/// Asserts the full custody round-trip:
///   - base side DOWN by amount_in, MINUS the leftover the pool returned,
///   - quote side UP by exactly out_amount,
///   - DEEP side DOWN by exactly what the pool spent (deep_fee − deep_leftover),
///   - mandate budget DOWN by amount_in (atomic with the swap),
///   - and NOTHING left custody — the conservation identity holds across all pots.
fun test_agent_swap_base_to_quote_full_custody() {
    let (mut scenario, clock) = begin();

    let mandate_id = create_default_mandate(&mut scenario, &clock);
    create_swap_vault_for(&mut scenario, mandate_id);
    fund_vault(&mut scenario);
    issue_cap_to_agent(&mut scenario);

    // Agent swaps 300 BASE → QUOTE. The (stubbed) pool returns:
    //   out_amount      = 290 QUOTE  (the swap output),
    //   deep_leftover   = 8 DEEP     (so it spent 10 − 8 = 2 DEEP of the fee),
    //   input_leftover  = 5 BASE     (lot-size remainder returned unspent).
    let amount_in = 300;
    let deep_fee = 10;
    let out_amount = 290;
    let deep_leftover = 8;
    let input_leftover = 5;

    scenario.next_tx(AGENT);
    {
        let mut vault = scenario.take_shared<SwapVault<BASE, QUOTE>>();
        let mut mandate = scenario.take_shared<Mandate>();
        let cap = scenario.take_from_sender<AgentCap>();

        swap::agent_swap_base_to_quote_stub<BASE, QUOTE>(
            &mut vault,
            &mut mandate,
            &cap,
            SCOPE_SWAP,
            amount_in,
            deep_fee,
            out_amount,
            deep_leftover,
            input_leftover,
            &clock,
            scenario.ctx(),
        );

        // Base: started DEPOSIT_BASE, split out `amount_in`, re-absorbed
        // `input_leftover`. Net = DEPOSIT_BASE − amount_in + input_leftover.
        assert!(
            swap::base_value<BASE, QUOTE>(&vault) == DEPOSIT_BASE - amount_in + input_leftover,
            0,
        );
        // Quote: started DEPOSIT_QUOTE, gained the swap output.
        assert!(swap::quote_value<BASE, QUOTE>(&vault) == DEPOSIT_QUOTE + out_amount, 1);
        // DEEP: started DEPOSIT_DEEP, split out `deep_fee`, re-absorbed the
        // leftover. Net spent = deep_fee − deep_leftover.
        assert!(
            swap::deep_value<BASE, QUOTE>(&vault) == DEPOSIT_DEEP - (deep_fee - deep_leftover),
            2,
        );
        // Budget debited by amount_in, atomic with the swap.
        assert!(mandate::budget_remaining(&mandate) == BUDGET - amount_in, 3);

        scenario.return_to_sender(cap);
        ts::return_shared(mandate);
        ts::return_shared(vault);
    };

    cleanup(scenario, clock);
}

#[test]
/// Symmetric headline proof (quote→base): USDC→SUI. Quote side falls, base side
/// rises, DEEP spent re-absorbed, budget debited, conservation holds.
fun test_agent_swap_quote_to_base_full_custody() {
    let (mut scenario, clock) = begin();

    let mandate_id = create_default_mandate(&mut scenario, &clock);
    create_swap_vault_for(&mut scenario, mandate_id);
    fund_vault(&mut scenario);
    issue_cap_to_agent(&mut scenario);

    let amount_in = 400;       // QUOTE in
    let deep_fee = 12;
    let out_amount = 395;      // BASE out
    let deep_leftover = 12;    // pool paid nothing (whitelist-like) → full refund
    let input_leftover = 0;    // perfectly divisible → no remainder

    scenario.next_tx(AGENT);
    {
        let mut vault = scenario.take_shared<SwapVault<BASE, QUOTE>>();
        let mut mandate = scenario.take_shared<Mandate>();
        let cap = scenario.take_from_sender<AgentCap>();

        swap::agent_swap_quote_to_base_stub<BASE, QUOTE>(
            &mut vault,
            &mut mandate,
            &cap,
            SCOPE_SWAP,
            amount_in,
            deep_fee,
            out_amount,
            deep_leftover,
            input_leftover,
            &clock,
            scenario.ctx(),
        );

        assert!(swap::base_value<BASE, QUOTE>(&vault) == DEPOSIT_BASE + out_amount, 0);
        assert!(
            swap::quote_value<BASE, QUOTE>(&vault) == DEPOSIT_QUOTE - amount_in + input_leftover,
            1,
        );
        // deep_leftover == deep_fee → spent 0 → DEEP pot unchanged.
        assert!(swap::deep_value<BASE, QUOTE>(&vault) == DEPOSIT_DEEP, 2);
        assert!(mandate::budget_remaining(&mandate) == BUDGET - amount_in, 3);

        scenario.return_to_sender(cap);
        ts::return_shared(mandate);
        ts::return_shared(vault);
    };

    cleanup(scenario, clock);
}

#[test]
/// THE NO-OP CASE: DeepBook returns the inputs UNTOUCHED when the size is below
/// the pool minimum (`out_amount = 0`, `input_leftover = amount_in`, full DEEP
/// refund). The custody seal must re-absorb the returned input so the base pot is
/// made whole, the quote pot is unchanged, and DEEP is unchanged — yet the budget
/// is STILL debited (the gate ran). Proves no funds are lost on a no-op swap.
fun test_agent_swap_below_min_size_noop_conserves_funds() {
    let (mut scenario, clock) = begin();

    let mandate_id = create_default_mandate(&mut scenario, &clock);
    create_swap_vault_for(&mut scenario, mandate_id);
    fund_vault(&mut scenario);
    issue_cap_to_agent(&mut scenario);

    let amount_in = 50;
    let deep_fee = 10;
    let out_amount = 0;              // below min size → no fill
    let deep_leftover = 10;          // full DEEP refund (nothing traded)
    let input_leftover = amount_in;  // inputs returned untouched

    scenario.next_tx(AGENT);
    {
        let mut vault = scenario.take_shared<SwapVault<BASE, QUOTE>>();
        let mut mandate = scenario.take_shared<Mandate>();
        let cap = scenario.take_from_sender<AgentCap>();

        swap::agent_swap_base_to_quote_stub<BASE, QUOTE>(
            &mut vault, &mut mandate, &cap, SCOPE_SWAP,
            amount_in, deep_fee, out_amount, deep_leftover, input_leftover,
            &clock, scenario.ctx(),
        );

        // Base made whole (split out then fully re-absorbed), quote + DEEP intact.
        assert!(swap::base_value<BASE, QUOTE>(&vault) == DEPOSIT_BASE, 0);
        assert!(swap::quote_value<BASE, QUOTE>(&vault) == DEPOSIT_QUOTE, 1);
        assert!(swap::deep_value<BASE, QUOTE>(&vault) == DEPOSIT_DEEP, 2);
        // Budget STILL debited — the gate fired even though the trade was a no-op.
        assert!(mandate::budget_remaining(&mandate) == BUDGET - amount_in, 3);

        scenario.return_to_sender(cap);
        ts::return_shared(mandate);
        ts::return_shared(vault);
    };

    cleanup(scenario, clock);
}

#[test]
/// Multiple gated swaps in sequence accumulate correctly and keep debiting the
/// budget — proving the cage composes across the agent's many 24/7 cycles. We do
/// a base→quote then a quote→base and assert the running balances + budget.
fun test_multiple_swaps_accumulate() {
    let (mut scenario, clock) = begin();

    let mandate_id = create_default_mandate(&mut scenario, &clock);
    create_swap_vault_for(&mut scenario, mandate_id);
    fund_vault(&mut scenario);
    issue_cap_to_agent(&mut scenario);

    // Swap 1: 200 BASE → 190 QUOTE, spent 2 DEEP, 0 leftover input.
    scenario.next_tx(AGENT);
    {
        let mut vault = scenario.take_shared<SwapVault<BASE, QUOTE>>();
        let mut mandate = scenario.take_shared<Mandate>();
        let cap = scenario.take_from_sender<AgentCap>();
        swap::agent_swap_base_to_quote_stub<BASE, QUOTE>(
            &mut vault, &mut mandate, &cap, SCOPE_SWAP,
            200, 10, 190, 8, 0, &clock, scenario.ctx(),
        );
        scenario.return_to_sender(cap);
        ts::return_shared(mandate);
        ts::return_shared(vault);
    };

    // Swap 2: 100 QUOTE → 98 BASE, spent 3 DEEP, 0 leftover input.
    scenario.next_tx(AGENT);
    {
        let mut vault = scenario.take_shared<SwapVault<BASE, QUOTE>>();
        let mut mandate = scenario.take_shared<Mandate>();
        let cap = scenario.take_from_sender<AgentCap>();
        swap::agent_swap_quote_to_base_stub<BASE, QUOTE>(
            &mut vault, &mut mandate, &cap, SCOPE_SWAP,
            100, 10, 98, 7, 0, &clock, scenario.ctx(),
        );

        // Base: −200 (swap1 in) +98 (swap2 out) = DEPOSIT_BASE − 102.
        assert!(swap::base_value<BASE, QUOTE>(&vault) == DEPOSIT_BASE - 200 + 98, 0);
        // Quote: +190 (swap1 out) −100 (swap2 in) = DEPOSIT_QUOTE + 90.
        assert!(swap::quote_value<BASE, QUOTE>(&vault) == DEPOSIT_QUOTE + 190 - 100, 1);
        // DEEP: −2 (swap1) −3 (swap2) = DEPOSIT_DEEP − 5.
        assert!(swap::deep_value<BASE, QUOTE>(&vault) == DEPOSIT_DEEP - 2 - 3, 2);
        // Budget: −200 −100 = BUDGET − 300.
        assert!(mandate::budget_remaining(&mandate) == BUDGET - 300, 3);

        scenario.return_to_sender(cap);
        ts::return_shared(mandate);
        ts::return_shared(vault);
    };

    cleanup(scenario, clock);
}

#[test]
/// THE ANTI-REDIRECT PROOF (the literal threat model): after a successful gated
/// swap, the AGENT's account holds NO loose `Coin<BASE>`, `Coin<QUOTE>`, or
/// `Coin<DEEP>`. Every coin the pool returned was re-absorbed into the vault, so
/// there is nothing free-floating for the agent to transfer to an attacker. We
/// assert this with `ts::ids_for_sender`, which lists the object IDs the AGENT
/// owns by type — all three must be empty.
fun test_no_coin_leaks_to_agent_after_swap() {
    let (mut scenario, clock) = begin();

    let mandate_id = create_default_mandate(&mut scenario, &clock);
    create_swap_vault_for(&mut scenario, mandate_id);
    fund_vault(&mut scenario);
    issue_cap_to_agent(&mut scenario);

    scenario.next_tx(AGENT);
    {
        let mut vault = scenario.take_shared<SwapVault<BASE, QUOTE>>();
        let mut mandate = scenario.take_shared<Mandate>();
        let cap = scenario.take_from_sender<AgentCap>();
        // A normal swap that returns output + leftover input + leftover DEEP — all
        // three should be caged, none handed to the agent.
        swap::agent_swap_base_to_quote_stub<BASE, QUOTE>(
            &mut vault, &mut mandate, &cap, SCOPE_SWAP,
            300, 10, 290, 8, 5, &clock, scenario.ctx(),
        );
        scenario.return_to_sender(cap);
        ts::return_shared(mandate);
        ts::return_shared(vault);
    };

    // In a FRESH tx as the agent, enumerate what the agent owns. The only object
    // the agent should hold is its AgentCap — never any Coin.
    scenario.next_tx(AGENT);
    {
        let base_ids = ts::ids_for_sender<Coin<BASE>>(&scenario);
        let quote_ids = ts::ids_for_sender<Coin<QUOTE>>(&scenario);
        let deep_ids = ts::ids_for_sender<Coin<DEEP>>(&scenario);
        assert!(base_ids.is_empty(), 0);
        assert!(quote_ids.is_empty(), 1);
        assert!(deep_ids.is_empty(), 2);
    };

    cleanup(scenario, clock);
}

#[test]
/// Owner can withdraw each side back to a Coin after the agent has traded
/// (idle-only owner exit). Confirms `withdraw_base` / `withdraw_quote` /
/// `withdraw_deep` return the right amounts and decrement the pots.
fun test_owner_withdraw_each_side() {
    let (mut scenario, clock) = begin();

    let mandate_id = create_default_mandate(&mut scenario, &clock);
    create_swap_vault_for(&mut scenario, mandate_id);
    fund_vault(&mut scenario);

    scenario.next_tx(OWNER);
    {
        let mut vault = scenario.take_shared<SwapVault<BASE, QUOTE>>();
        let b = swap::withdraw_base<BASE, QUOTE>(&mut vault, 1_000, scenario.ctx());
        let q = swap::withdraw_quote<BASE, QUOTE>(&mut vault, 2_000, scenario.ctx());
        let d = swap::withdraw_deep<BASE, QUOTE>(&mut vault, 500, scenario.ctx());
        assert!(coin::value(&b) == 1_000, 0);
        assert!(coin::value(&q) == 2_000, 1);
        assert!(coin::value(&d) == 500, 2);
        assert!(swap::base_value<BASE, QUOTE>(&vault) == DEPOSIT_BASE - 1_000, 3);
        assert!(swap::quote_value<BASE, QUOTE>(&vault) == DEPOSIT_QUOTE - 2_000, 4);
        assert!(swap::deep_value<BASE, QUOTE>(&vault) == DEPOSIT_DEEP - 500, 5);
        coin::burn_for_testing(b);
        coin::burn_for_testing(q);
        coin::burn_for_testing(d);
        ts::return_shared(vault);
    };

    cleanup(scenario, clock);
}

// ============================================================================
// REFUSAL PROOFS (the design drivers — every one routes through the REAL gate)
// ============================================================================

#[test]
#[expected_failure(abort_code = suize::mandate::EOverBudget)]
/// Agent tries to swap more than the remaining BUDGET. Both sides are funded far
/// above the spend, so BUDGET is the binding constraint → `EOverBudget` from the
/// mandate gate, which runs BEFORE the vault touches any balance.
fun test_swap_over_budget_aborts() {
    let (mut scenario, clock) = begin();

    let mandate_id = create_default_mandate(&mut scenario, &clock);
    create_swap_vault_for(&mut scenario, mandate_id);
    fund_vault(&mut scenario);
    issue_cap_to_agent(&mut scenario);

    scenario.next_tx(AGENT);
    {
        let mut vault = scenario.take_shared<SwapVault<BASE, QUOTE>>();
        let mut mandate = scenario.take_shared<Mandate>();
        let cap = scenario.take_from_sender<AgentCap>();
        // BUDGET + 1 (both sides hold 5_000, so budget fails first).
        swap::agent_swap_base_to_quote_stub<BASE, QUOTE>(
            &mut vault, &mut mandate, &cap, SCOPE_SWAP,
            BUDGET + 1, 10, 0, 10, BUDGET + 1, &clock, scenario.ctx(),
        );
        scenario.return_to_sender(cap);
        ts::return_shared(mandate);
        ts::return_shared(vault);
    };

    cleanup(scenario, clock);
}

#[test]
#[expected_failure(abort_code = suize::swap::EInsufficientBalance)]
/// Within budget but the INPUT side can't cover `amount_in`. Gate passes
/// (amount <= budget), then the input-side wall fires → `EInsufficientBalance`.
/// We underfund base to 100 while budget allows 1_000, then swap 500 base.
fun test_swap_insufficient_input_aborts() {
    let (mut scenario, clock) = begin();

    let mandate_id = create_default_mandate(&mut scenario, &clock);
    create_swap_vault_for(&mut scenario, mandate_id);
    // Base underfunded vs budget; quote + DEEP funded so they aren't the wall.
    deposit_base_as_owner(&mut scenario, 100);
    deposit_quote_as_owner(&mut scenario, DEPOSIT_QUOTE);
    deposit_deep_as_owner(&mut scenario, DEPOSIT_DEEP);
    issue_cap_to_agent(&mut scenario);

    scenario.next_tx(AGENT);
    {
        let mut vault = scenario.take_shared<SwapVault<BASE, QUOTE>>();
        let mut mandate = scenario.take_shared<Mandate>();
        let cap = scenario.take_from_sender<AgentCap>();
        // 500 <= BUDGET (gate OK) but 500 > base(100) → EInsufficientBalance.
        swap::agent_swap_base_to_quote_stub<BASE, QUOTE>(
            &mut vault, &mut mandate, &cap, SCOPE_SWAP,
            500, 10, 490, 8, 0, &clock, scenario.ctx(),
        );
        scenario.return_to_sender(cap);
        ts::return_shared(mandate);
        ts::return_shared(vault);
    };

    cleanup(scenario, clock);
}

#[test]
#[expected_failure(abort_code = suize::swap::EInsufficientDeep)]
/// Within budget, input covered, but the DEEP fee pot can't cover `deep_fee`.
/// Runs after the input wall → `EInsufficientDeep`. Base/quote funded; DEEP
/// underfunded to 1 while the swap asks for deep_fee = 10.
fun test_swap_insufficient_deep_aborts() {
    let (mut scenario, clock) = begin();

    let mandate_id = create_default_mandate(&mut scenario, &clock);
    create_swap_vault_for(&mut scenario, mandate_id);
    deposit_base_as_owner(&mut scenario, DEPOSIT_BASE);
    deposit_quote_as_owner(&mut scenario, DEPOSIT_QUOTE);
    deposit_deep_as_owner(&mut scenario, 1); // DEEP underfunded.
    issue_cap_to_agent(&mut scenario);

    scenario.next_tx(AGENT);
    {
        let mut vault = scenario.take_shared<SwapVault<BASE, QUOTE>>();
        let mut mandate = scenario.take_shared<Mandate>();
        let cap = scenario.take_from_sender<AgentCap>();
        // deep_fee = 10 > deep(1) → EInsufficientDeep (base 300 <= base 5_000 OK).
        swap::agent_swap_base_to_quote_stub<BASE, QUOTE>(
            &mut vault, &mut mandate, &cap, SCOPE_SWAP,
            300, 10, 290, 8, 0, &clock, scenario.ctx(),
        );
        scenario.return_to_sender(cap);
        ts::return_shared(mandate);
        ts::return_shared(vault);
    };

    cleanup(scenario, clock);
}

#[test]
#[expected_failure(abort_code = suize::mandate::ECapNotAllowed)]
/// After the owner revokes the agent's cap, the gated swap aborts with the
/// mandate's `ECapNotAllowed` — the kill switch, proven through the swap adapter.
fun test_swap_after_revoke_aborts() {
    let (mut scenario, clock) = begin();

    let mandate_id = create_default_mandate(&mut scenario, &clock);
    create_swap_vault_for(&mut scenario, mandate_id);
    fund_vault(&mut scenario);
    issue_cap_to_agent(&mut scenario);

    scenario.next_tx(AGENT);
    let cap_id = {
        let cap = scenario.take_from_sender<AgentCap>();
        let id = object::id(&cap);
        scenario.return_to_sender(cap);
        id
    };

    scenario.next_tx(OWNER);
    {
        let mut mandate = scenario.take_shared<Mandate>();
        mandate::revoke_agent_cap(&mut mandate, cap_id, scenario.ctx());
        ts::return_shared(mandate);
    };

    scenario.next_tx(AGENT);
    {
        let mut vault = scenario.take_shared<SwapVault<BASE, QUOTE>>();
        let mut mandate = scenario.take_shared<Mandate>();
        let cap = scenario.take_from_sender<AgentCap>();
        swap::agent_swap_base_to_quote_stub<BASE, QUOTE>(
            &mut vault, &mut mandate, &cap, SCOPE_SWAP,
            100, 10, 95, 8, 0, &clock, scenario.ctx(),
        );
        scenario.return_to_sender(cap);
        ts::return_shared(mandate);
        ts::return_shared(vault);
    };

    cleanup(scenario, clock);
}

#[test]
#[expected_failure(abort_code = suize::mandate::EExpired)]
/// Past expiry, the gated swap aborts with the mandate's `EExpired`. Clock is
/// advanced to exactly `expiry_ms` (the bound is strict `<`, so == fails).
fun test_swap_after_expiry_aborts() {
    let (mut scenario, mut clock) = begin();

    let mandate_id = create_default_mandate(&mut scenario, &clock);
    create_swap_vault_for(&mut scenario, mandate_id);
    fund_vault(&mut scenario);
    issue_cap_to_agent(&mut scenario);

    clock.set_for_testing(EXPIRY_MS);

    scenario.next_tx(AGENT);
    {
        let mut vault = scenario.take_shared<SwapVault<BASE, QUOTE>>();
        let mut mandate = scenario.take_shared<Mandate>();
        let cap = scenario.take_from_sender<AgentCap>();
        swap::agent_swap_base_to_quote_stub<BASE, QUOTE>(
            &mut vault, &mut mandate, &cap, SCOPE_SWAP,
            100, 10, 95, 8, 0, &clock, scenario.ctx(),
        );
        scenario.return_to_sender(cap);
        ts::return_shared(mandate);
        ts::return_shared(vault);
    };

    cleanup(scenario, clock);
}

#[test]
#[expected_failure(abort_code = suize::mandate::EOutOfScope)]
/// A scope tag the mandate never granted aborts with `EOutOfScope`, even though
/// budget + both sides + DEEP would all allow the swap. (The mandate was created
/// with only SCOPE_SWAP; we pass SCOPE_NOT_ALLOWED.)
fun test_swap_out_of_scope_aborts() {
    let (mut scenario, clock) = begin();

    let mandate_id = create_default_mandate(&mut scenario, &clock);
    create_swap_vault_for(&mut scenario, mandate_id);
    fund_vault(&mut scenario);
    issue_cap_to_agent(&mut scenario);

    scenario.next_tx(AGENT);
    {
        let mut vault = scenario.take_shared<SwapVault<BASE, QUOTE>>();
        let mut mandate = scenario.take_shared<Mandate>();
        let cap = scenario.take_from_sender<AgentCap>();
        swap::agent_swap_base_to_quote_stub<BASE, QUOTE>(
            &mut vault, &mut mandate, &cap, SCOPE_NOT_ALLOWED,
            100, 10, 95, 8, 0, &clock, scenario.ctx(),
        );
        scenario.return_to_sender(cap);
        ts::return_shared(mandate);
        ts::return_shared(vault);
    };

    cleanup(scenario, clock);
}

#[test]
#[expected_failure(abort_code = suize::swap::EVaultMandateMismatch)]
/// A swap vault may only be driven by ITS OWN mandate. Build a vault bound to
/// mandate A, then drive it with mandate B (and a cap minted for B, so the
/// cap↔mandate check inside the gate would otherwise pass). The vault's own
/// `mandate_id` check fires FIRST → `EVaultMandateMismatch`.
fun test_swap_wrong_mandate_aborts() {
    let (mut scenario, clock) = begin();

    // Mandate A — the vault is bound to this one.
    let mandate_a_id = create_default_mandate(&mut scenario, &clock);
    create_swap_vault_for(&mut scenario, mandate_a_id);
    fund_vault(&mut scenario);

    // Mandate B — a second, independent mandate (also OWNER's), cap minted for B.
    scenario.next_tx(OWNER);
    mandate::create_mandate(
        BUDGET,
        vector[SCOPE_SWAP],
        EXPIRY_MS,
        &clock,
        scenario.ctx(),
    );

    scenario.next_tx(OWNER);
    let cap_b = {
        let mut mandate_b = scenario.take_shared<Mandate>();
        assert!(object::id(&mandate_b) != mandate_a_id, 0);
        let cap = mandate::issue_agent_cap_for_testing(&mut mandate_b, scenario.ctx());
        ts::return_shared(mandate_b);
        cap
    };

    scenario.next_tx(OWNER);
    {
        let mut vault = scenario.take_shared<SwapVault<BASE, QUOTE>>();
        let mut mandate_b = scenario.take_shared<Mandate>();
        assert!(swap::mandate_id<BASE, QUOTE>(&vault) != object::id(&mandate_b), 1);
        swap::agent_swap_base_to_quote_stub<BASE, QUOTE>(
            &mut vault, &mut mandate_b, &cap_b, SCOPE_SWAP,
            100, 10, 95, 8, 0, &clock, scenario.ctx(),
        );
        ts::return_shared(mandate_b);
        ts::return_shared(vault);
    };

    // Unreachable (the call aborts), but the cap has no drop and must be consumed
    // on every path for the test to compile.
    mandate::destroy_cap_for_testing(cap_b);
    cleanup(scenario, clock);
}

#[test]
#[expected_failure(abort_code = suize::swap::ENotOwner)]
/// A non-owner cannot deposit base into the vault → `ENotOwner`.
fun test_non_owner_deposit_base_aborts() {
    let (mut scenario, clock) = begin();

    let mandate_id = create_default_mandate(&mut scenario, &clock);
    create_swap_vault_for(&mut scenario, mandate_id);

    scenario.next_tx(STRANGER);
    {
        let mut vault = scenario.take_shared<SwapVault<BASE, QUOTE>>();
        let coin = coin::mint_for_testing<BASE>(1_000, scenario.ctx());
        swap::deposit_base<BASE, QUOTE>(&mut vault, coin, scenario.ctx());
        ts::return_shared(vault);
    };

    cleanup(scenario, clock);
}

#[test]
#[expected_failure(abort_code = suize::swap::ENotOwner)]
/// A non-owner cannot deposit DEEP into the fee pot → `ENotOwner`.
fun test_non_owner_deposit_deep_aborts() {
    let (mut scenario, clock) = begin();

    let mandate_id = create_default_mandate(&mut scenario, &clock);
    create_swap_vault_for(&mut scenario, mandate_id);

    scenario.next_tx(STRANGER);
    {
        let mut vault = scenario.take_shared<SwapVault<BASE, QUOTE>>();
        let coin = coin::mint_for_testing<DEEP>(1_000, scenario.ctx());
        swap::deposit_deep<BASE, QUOTE>(&mut vault, coin, scenario.ctx());
        ts::return_shared(vault);
    };

    cleanup(scenario, clock);
}

#[test]
#[expected_failure(abort_code = suize::swap::ENotOwner)]
/// A non-owner cannot withdraw base funds → `ENotOwner`. (Fund it first as OWNER
/// so the abort is the ownership check, not an empty-balance artifact.)
fun test_non_owner_withdraw_base_aborts() {
    let (mut scenario, clock) = begin();

    let mandate_id = create_default_mandate(&mut scenario, &clock);
    create_swap_vault_for(&mut scenario, mandate_id);
    fund_vault(&mut scenario);

    scenario.next_tx(STRANGER);
    {
        let mut vault = scenario.take_shared<SwapVault<BASE, QUOTE>>();
        let coin = swap::withdraw_base<BASE, QUOTE>(&mut vault, 100, scenario.ctx());
        transfer::public_transfer(coin, STRANGER);
        ts::return_shared(vault);
    };

    cleanup(scenario, clock);
}

#[test]
#[expected_failure(abort_code = suize::swap::EInsufficientBalance)]
/// Owner withdrawing more base than exists aborts with `EInsufficientBalance`
/// (the vault's own guard, not the framework's `balance::split` abort).
fun test_withdraw_base_over_balance_aborts() {
    let (mut scenario, clock) = begin();

    let mandate_id = create_default_mandate(&mut scenario, &clock);
    create_swap_vault_for(&mut scenario, mandate_id);
    deposit_base_as_owner(&mut scenario, 1_000);

    scenario.next_tx(OWNER);
    {
        let mut vault = scenario.take_shared<SwapVault<BASE, QUOTE>>();
        let coin = swap::withdraw_base<BASE, QUOTE>(&mut vault, 1_001, scenario.ctx());
        transfer::public_transfer(coin, OWNER);
        ts::return_shared(vault);
    };

    cleanup(scenario, clock);
}
