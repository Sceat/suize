#[test_only]
module suize::mandate_tests;

// NOTE: the abort-code constants (EExpired, ENotOwner, ...) are intentionally
// NOT imported here — `#[expected_failure(abort_code = suize::mandate::EXxx)]`
// references them by fully-qualified path, and importing the aliases too would
// just produce "unused alias" warnings.
use suize::mandate::{Self, Mandate, AgentCap};
use sui::clock::{Self, Clock};
use sui::test_scenario::{Self as ts, Scenario};

// === Test actors ===
const OWNER: address = @0xA;
const AGENT: address = @0xB;
const STRANGER: address = @0xC;

// === Test fixtures ===
const BUDGET: u64 = 1_000;
const EXPIRY_MS: u64 = 10_000;
const SCOPE_SUILEND: u8 = 0;
const SCOPE_DEEPBOOK: u8 = 1;
const SCOPE_NOT_ALLOWED: u8 = 9;

// === Helpers ===

/// Start a scenario as OWNER and create a clock fixed at t=0 (shared so any
/// actor can read it, mirroring how `sui::clock::Clock` is the shared 0x6 object
/// on-chain).
fun begin(): (Scenario, Clock) {
    let mut scenario = ts::begin(OWNER);
    let clock = clock::create_for_testing(scenario.ctx());
    (scenario, clock)
}

/// Create a mandate as OWNER with both Suilend + DeepBook scopes allowed.
fun create_default_mandate(scenario: &mut Scenario, clock: &Clock) {
    scenario.next_tx(OWNER);
    mandate::create_mandate(
        BUDGET,
        vector[SCOPE_SUILEND, SCOPE_DEEPBOOK],
        EXPIRY_MS,
        clock,
        scenario.ctx(),
    );
}

/// As OWNER, issue an AgentCap and transfer it to AGENT (production path).
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

// === SUCCESS PATHS ===

#[test]
/// Full happy path across multiple actors: owner creates + issues, agent acts
/// twice within limits, budget decrements correctly and accumulates.
fun test_create_issue_and_consume_decrements_budget() {
    let (mut scenario, clock) = begin();

    create_default_mandate(&mut scenario, &clock);
    issue_cap_to_agent(&mut scenario);

    // AGENT acts: spend 300 on a Suilend supply.
    scenario.next_tx(AGENT);
    {
        let mut mandate = scenario.take_shared<Mandate>();
        let cap = scenario.take_from_sender<AgentCap>();

        let remaining = mandate::consume_budget(
            &mut mandate,
            &cap,
            SCOPE_SUILEND,
            300,
            &clock,
        );
        assert!(remaining == 700, 0);
        assert!(mandate::budget_remaining(&mandate) == 700, 1);

        scenario.return_to_sender(cap);
        ts::return_shared(mandate);
    };

    // AGENT acts again: spend 200 on a DeepBook swap. Spends accumulate.
    scenario.next_tx(AGENT);
    {
        let mut mandate = scenario.take_shared<Mandate>();
        let cap = scenario.take_from_sender<AgentCap>();

        let remaining = mandate::consume_budget(
            &mut mandate,
            &cap,
            SCOPE_DEEPBOOK,
            200,
            &clock,
        );
        assert!(remaining == 500, 2);

        scenario.return_to_sender(cap);
        ts::return_shared(mandate);
    };

    cleanup(scenario, clock);
}

#[test]
/// Spending the entire remaining budget (amount == budget_remaining) is allowed
/// — the bound is `<=`, not `<`. Edge case worth pinning.
fun test_consume_exact_full_budget_succeeds() {
    let (mut scenario, clock) = begin();
    create_default_mandate(&mut scenario, &clock);
    issue_cap_to_agent(&mut scenario);

    scenario.next_tx(AGENT);
    {
        let mut mandate = scenario.take_shared<Mandate>();
        let cap = scenario.take_from_sender<AgentCap>();

        let remaining = mandate::consume_budget(&mut mandate, &cap, SCOPE_SUILEND, BUDGET, &clock);
        assert!(remaining == 0, 0);

        scenario.return_to_sender(cap);
        ts::return_shared(mandate);
    };

    cleanup(scenario, clock);
}

#[test]
/// Owner can top up the budget, and the agent can then spend the new headroom.
fun test_top_up_budget_extends_headroom() {
    let (mut scenario, clock) = begin();
    create_default_mandate(&mut scenario, &clock);
    issue_cap_to_agent(&mut scenario);

    // Drain the original budget.
    scenario.next_tx(AGENT);
    {
        let mut mandate = scenario.take_shared<Mandate>();
        let cap = scenario.take_from_sender<AgentCap>();
        mandate::consume_budget(&mut mandate, &cap, SCOPE_SUILEND, BUDGET, &clock);
        scenario.return_to_sender(cap);
        ts::return_shared(mandate);
    };

    // Owner tops up.
    scenario.next_tx(OWNER);
    {
        let mut mandate = scenario.take_shared<Mandate>();
        mandate::top_up_budget(&mut mandate, 500, scenario.ctx());
        assert!(mandate::budget_remaining(&mandate) == 500, 0);
        ts::return_shared(mandate);
    };

    // Agent spends the new headroom.
    scenario.next_tx(AGENT);
    {
        let mut mandate = scenario.take_shared<Mandate>();
        let cap = scenario.take_from_sender<AgentCap>();
        let remaining = mandate::consume_budget(&mut mandate, &cap, SCOPE_DEEPBOOK, 400, &clock);
        assert!(remaining == 100, 1);
        scenario.return_to_sender(cap);
        ts::return_shared(mandate);
    };

    cleanup(scenario, clock);
}

#[test]
/// Owner can extend expiry, letting the agent act at a time that would otherwise
/// be past the original deadline.
fun test_set_expiry_extends_deadline() {
    let (mut scenario, mut clock) = begin();
    create_default_mandate(&mut scenario, &clock);
    issue_cap_to_agent(&mut scenario);

    // Owner extends expiry well into the future.
    scenario.next_tx(OWNER);
    {
        let mut mandate = scenario.take_shared<Mandate>();
        mandate::set_expiry(&mut mandate, 100_000, scenario.ctx());
        assert!(mandate::expiry_ms(&mandate) == 100_000, 0);
        ts::return_shared(mandate);
    };

    // Advance clock past the ORIGINAL expiry but before the new one.
    clock.set_for_testing(50_000);

    scenario.next_tx(AGENT);
    {
        let mut mandate = scenario.take_shared<Mandate>();
        let cap = scenario.take_from_sender<AgentCap>();
        let remaining = mandate::consume_budget(&mut mandate, &cap, SCOPE_SUILEND, 100, &clock);
        assert!(remaining == 900, 1);
        scenario.return_to_sender(cap);
        ts::return_shared(mandate);
    };

    cleanup(scenario, clock);
}

// === FAILURE PATHS (the design drivers) ===

#[test]
#[expected_failure(abort_code = suize::mandate::EOverBudget)]
/// Spending more than the remaining budget aborts with EOverBudget.
fun test_over_budget_aborts() {
    let (mut scenario, clock) = begin();
    create_default_mandate(&mut scenario, &clock);
    issue_cap_to_agent(&mut scenario);

    scenario.next_tx(AGENT);
    {
        let mut mandate = scenario.take_shared<Mandate>();
        let cap = scenario.take_from_sender<AgentCap>();
        // BUDGET + 1 over the cap.
        mandate::consume_budget(&mut mandate, &cap, SCOPE_SUILEND, BUDGET + 1, &clock);
        scenario.return_to_sender(cap);
        ts::return_shared(mandate);
    };

    cleanup(scenario, clock);
}

#[test]
#[expected_failure(abort_code = suize::mandate::ECapNotAllowed)]
/// After the owner revokes the cap, the agent's next action aborts with
/// ECapNotAllowed. This is the kill-switch test — the headline guarantee.
fun test_consume_after_revoke_aborts() {
    let (mut scenario, clock) = begin();
    create_default_mandate(&mut scenario, &clock);
    issue_cap_to_agent(&mut scenario);

    // Grab the cap's ID so the owner can revoke it by ID.
    scenario.next_tx(AGENT);
    let cap_id = {
        let cap = scenario.take_from_sender<AgentCap>();
        let id = object::id(&cap);
        scenario.return_to_sender(cap);
        id
    };

    // OWNER revokes.
    scenario.next_tx(OWNER);
    {
        let mut mandate = scenario.take_shared<Mandate>();
        mandate::revoke_agent_cap(&mut mandate, cap_id, scenario.ctx());
        assert!(!mandate::is_cap_allowed(&mandate, cap_id), 0);
        ts::return_shared(mandate);
    };

    // AGENT tries to act → ECapNotAllowed.
    scenario.next_tx(AGENT);
    {
        let mut mandate = scenario.take_shared<Mandate>();
        let cap = scenario.take_from_sender<AgentCap>();
        mandate::consume_budget(&mut mandate, &cap, SCOPE_SUILEND, 100, &clock);
        scenario.return_to_sender(cap);
        ts::return_shared(mandate);
    };

    cleanup(scenario, clock);
}

#[test]
#[expected_failure(abort_code = suize::mandate::EExpired)]
/// Acting at or after expiry aborts with EExpired. Advance the clock past
/// `expiry_ms` (the bound is strict `<`, so == expiry also fails).
fun test_consume_after_expiry_aborts() {
    let (mut scenario, mut clock) = begin();
    create_default_mandate(&mut scenario, &clock);
    issue_cap_to_agent(&mut scenario);

    // Move time to exactly the expiry boundary (strict `<` → this fails).
    clock.set_for_testing(EXPIRY_MS);

    scenario.next_tx(AGENT);
    {
        let mut mandate = scenario.take_shared<Mandate>();
        let cap = scenario.take_from_sender<AgentCap>();
        mandate::consume_budget(&mut mandate, &cap, SCOPE_SUILEND, 100, &clock);
        scenario.return_to_sender(cap);
        ts::return_shared(mandate);
    };

    cleanup(scenario, clock);
}

#[test]
#[expected_failure(abort_code = suize::mandate::EOutOfScope)]
/// Acting with a scope tag the mandate never allowed aborts with EOutOfScope.
fun test_consume_out_of_scope_aborts() {
    let (mut scenario, clock) = begin();
    create_default_mandate(&mut scenario, &clock);
    issue_cap_to_agent(&mut scenario);

    scenario.next_tx(AGENT);
    {
        let mut mandate = scenario.take_shared<Mandate>();
        let cap = scenario.take_from_sender<AgentCap>();
        // SCOPE_NOT_ALLOWED (9) was never granted.
        mandate::consume_budget(&mut mandate, &cap, SCOPE_NOT_ALLOWED, 100, &clock);
        scenario.return_to_sender(cap);
        ts::return_shared(mandate);
    };

    cleanup(scenario, clock);
}

#[test]
#[expected_failure(abort_code = suize::mandate::ENotOwner)]
/// A non-owner calling an owner-only function (here `top_up_budget`) aborts with
/// ENotOwner.
fun test_non_owner_owner_fn_aborts() {
    let (mut scenario, clock) = begin();
    create_default_mandate(&mut scenario, &clock);

    // STRANGER tries to top up the budget.
    scenario.next_tx(STRANGER);
    {
        let mut mandate = scenario.take_shared<Mandate>();
        mandate::top_up_budget(&mut mandate, 1_000, scenario.ctx());
        ts::return_shared(mandate);
    };

    cleanup(scenario, clock);
}

#[test]
#[expected_failure(abort_code = suize::mandate::ENotOwner)]
/// Also verify the issue path is owner-gated (STRANGER cannot mint caps).
fun test_non_owner_issue_cap_aborts() {
    let (mut scenario, clock) = begin();
    create_default_mandate(&mut scenario, &clock);

    scenario.next_tx(STRANGER);
    {
        let mut mandate = scenario.take_shared<Mandate>();
        mandate::issue_agent_cap(&mut mandate, STRANGER, scenario.ctx());
        ts::return_shared(mandate);
    };

    cleanup(scenario, clock);
}

#[test]
#[expected_failure(abort_code = suize::mandate::ECapMandateMismatch)]
/// A cap minted for mandate A cannot be used against mandate B →
/// ECapMandateMismatch. This is the first check in `consume_budget`, so it fires
/// even though the foreign cap is (trivially) not on B's allow-list either.
fun test_cap_from_other_mandate_aborts() {
    let (mut scenario, clock) = begin();

    // Mandate A (owned by OWNER) — we mint a cap bound to A and keep it.
    create_default_mandate(&mut scenario, &clock);
    scenario.next_tx(OWNER);
    let foreign_cap = {
        let mut mandate_a = scenario.take_shared<Mandate>();
        let cap = mandate::issue_agent_cap_for_testing(&mut mandate_a, scenario.ctx());
        ts::return_shared(mandate_a);
        cap
    };

    // Mandate B (a second, independent mandate, also OWNER's).
    scenario.next_tx(OWNER);
    mandate::create_mandate(
        BUDGET,
        vector[SCOPE_SUILEND],
        EXPIRY_MS,
        &clock,
        scenario.ctx(),
    );

    // Try to use A's cap against B. take_shared returns the most-recent shared
    // Mandate (B) here; assert the cap is indeed bound to a different id.
    scenario.next_tx(OWNER);
    {
        let mut mandate_b = scenario.take_shared<Mandate>();
        assert!(mandate::cap_mandate_id(&foreign_cap) != object::id(&mandate_b), 0);
        mandate::consume_budget(&mut mandate_b, &foreign_cap, SCOPE_SUILEND, 100, &clock);
        ts::return_shared(mandate_b);
    };

    // Unreachable cleanup (the call above aborts), but the compiler needs the
    // cap consumed on every path.
    mandate::destroy_cap_for_testing(foreign_cap);
    cleanup(scenario, clock);
}
