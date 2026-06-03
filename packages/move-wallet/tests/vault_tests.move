#[test_only]
/// Tests for `suize::vault` — written TESTS-FIRST.
///
/// The vault is the per-user custody object; the headline guarantee under test
/// is the AGENT GATE (`agent_consume`): the agent can only move funds *inside*
/// the vault (idle → deployed), only through its own mandate, and never beyond
/// the mandate's budget / scope / expiry / allow-list. The over-limit action is
/// impossible to construct, exactly like the `mandate` primitive it wraps.
///
/// As with `mandate_tests`, abort-code constants are NOT imported as aliases —
/// `#[expected_failure(abort_code = ...)]` references them by fully-qualified
/// path, so importing them would only yield "unused alias" warnings.
module suize::vault_tests;

use suize::mandate::{Self, Mandate, AgentCap};
use suize::vault::{Self, Vault};
use sui::clock::{Self, Clock};
use sui::coin::{Self, Coin};
use sui::test_scenario::{Self as ts, Scenario};

// === Test coin type ===
// A bare witness type used to instantiate `Coin<TUSD>` / `Vault<TUSD>` for the
// tests. `has drop` so the (empty) witness value can be discarded; we never need
// a TreasuryCap because `coin::mint_for_testing` fabricates balances directly.
public struct TUSD has drop {}

// === Test actors ===
const OWNER: address = @0xA;
const AGENT: address = @0xB;
const STRANGER: address = @0xC;

// === Test fixtures ===
const BUDGET: u64 = 1_000;
const EXPIRY_MS: u64 = 10_000;
// Scope-tag convention (from CLAUDE.md v3): 0 = NAVI supply, 1 = NAVI withdraw,
// 2 = DeepBook swap. We allow {supply, swap} on the default mandate.
const SCOPE_SUPPLY: u8 = 0;
const SCOPE_SWAP: u8 = 2;
const SCOPE_NOT_ALLOWED: u8 = 9;

// Deposit fixture: fund the vault with more than the budget so that, in the
// over-budget test, the BUDGET (not the idle balance) is unambiguously the
// binding constraint.
const DEPOSIT: u64 = 5_000;

// === Helpers ===

/// Start a scenario as OWNER with a clock fixed at t=0.
fun begin(): (Scenario, Clock) {
    let mut scenario = ts::begin(OWNER);
    let clock = clock::create_for_testing(scenario.ctx());
    (scenario, clock)
}

/// Create a default mandate as OWNER (scopes: supply + swap) and return its ID.
fun create_default_mandate(scenario: &mut Scenario, clock: &Clock): ID {
    scenario.next_tx(OWNER);
    mandate::create_mandate(
        BUDGET,
        vector[SCOPE_SUPPLY, SCOPE_SWAP],
        EXPIRY_MS,
        clock,
        scenario.ctx(),
    );

    // The mandate is shared in the same tx; fetch its ID for vault linking.
    scenario.next_tx(OWNER);
    let mandate = scenario.take_shared<Mandate>();
    let id = object::id(&mandate);
    ts::return_shared(mandate);
    id
}

/// As OWNER, create + share a Vault<TUSD> linked to `mandate_id`.
fun create_vault_for(scenario: &mut Scenario, mandate_id: ID) {
    scenario.next_tx(OWNER);
    vault::create_vault<TUSD>(mandate_id, scenario.ctx());
}

/// As OWNER, deposit `amount` of freshly-minted TUSD into the vault.
fun deposit_as_owner(scenario: &mut Scenario, amount: u64) {
    scenario.next_tx(OWNER);
    let mut vault = scenario.take_shared<Vault<TUSD>>();
    let coin = coin::mint_for_testing<TUSD>(amount, scenario.ctx());
    vault::deposit<TUSD>(&mut vault, coin, scenario.ctx());
    ts::return_shared(vault);
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
/// Owner lifecycle: create → deposit → withdraw_idle. Balances track exactly,
/// the withdrawn Coin lands with the owner, and `deployed` stays at zero (no
/// agent action yet).
fun test_create_deposit_withdraw_idle() {
    let (mut scenario, clock) = begin();

    let mandate_id = create_default_mandate(&mut scenario, &clock);
    create_vault_for(&mut scenario, mandate_id);
    deposit_as_owner(&mut scenario, DEPOSIT);

    // Verify idle == DEPOSIT, deployed == 0, and the link is correct.
    scenario.next_tx(OWNER);
    {
        let vault = scenario.take_shared<Vault<TUSD>>();
        assert!(vault::idle_value<TUSD>(&vault) == DEPOSIT, 0);
        assert!(vault::deployed_value<TUSD>(&vault) == 0, 1);
        assert!(vault::owner<TUSD>(&vault) == OWNER, 2);
        assert!(vault::mandate_id<TUSD>(&vault) == mandate_id, 3);
        ts::return_shared(vault);
    };

    // Owner withdraws part of idle back to a Coin.
    scenario.next_tx(OWNER);
    {
        let mut vault = scenario.take_shared<Vault<TUSD>>();
        let coin = vault::withdraw_idle<TUSD>(&mut vault, 2_000, scenario.ctx());
        assert!(coin::value(&coin) == 2_000, 4);
        assert!(vault::idle_value<TUSD>(&vault) == DEPOSIT - 2_000, 5);
        // Hand the withdrawn coin to the owner (sender) for the next tx to see.
        transfer::public_transfer(coin, OWNER);
        ts::return_shared(vault);
    };

    // The owner now actually holds the withdrawn Coin in their account.
    scenario.next_tx(OWNER);
    {
        let coin = scenario.take_from_sender<Coin<TUSD>>();
        assert!(coin::value(&coin) == 2_000, 6);
        // Clean up the test coin (no drop on Coin).
        coin::burn_for_testing(coin);
    };

    cleanup(scenario, clock);
}

#[test]
/// The agent gate: a single `agent_consume` within budget moves idle → deployed
/// inside the vault (NO coin leaves), and the mandate's budget is decremented in
/// the same call. This is the "tight cage" success proof.
fun test_agent_consume_moves_idle_to_deployed_and_debits_budget() {
    let (mut scenario, clock) = begin();

    let mandate_id = create_default_mandate(&mut scenario, &clock);
    create_vault_for(&mut scenario, mandate_id);
    deposit_as_owner(&mut scenario, DEPOSIT);
    issue_cap_to_agent(&mut scenario);

    // AGENT deploys 300 of sandbox funds under the SUPPLY scope.
    scenario.next_tx(AGENT);
    {
        let mut vault = scenario.take_shared<Vault<TUSD>>();
        let mut mandate = scenario.take_shared<Mandate>();
        let cap = scenario.take_from_sender<AgentCap>();

        vault::agent_consume<TUSD>(
            &mut vault,
            &mut mandate,
            &cap,
            SCOPE_SUPPLY,
            300,
            &clock,
        );

        // Funds moved internally: idle down 300, deployed up 300, total constant.
        assert!(vault::idle_value<TUSD>(&vault) == DEPOSIT - 300, 0);
        assert!(vault::deployed_value<TUSD>(&vault) == 300, 1);
        // Budget debited by the same amount (atomic with the move).
        assert!(mandate::budget_remaining(&mandate) == BUDGET - 300, 2);

        scenario.return_to_sender(cap);
        ts::return_shared(mandate);
        ts::return_shared(vault);
    };

    cleanup(scenario, clock);
}

#[test]
/// Multiple consumes accumulate in `deployed` and keep debiting the budget,
/// proving the gate is stateful and composes across the agent's many cycles.
fun test_multiple_agent_consumes_accumulate() {
    let (mut scenario, clock) = begin();

    let mandate_id = create_default_mandate(&mut scenario, &clock);
    create_vault_for(&mut scenario, mandate_id);
    deposit_as_owner(&mut scenario, DEPOSIT);
    issue_cap_to_agent(&mut scenario);

    // First deploy: 300 under SUPPLY.
    scenario.next_tx(AGENT);
    {
        let mut vault = scenario.take_shared<Vault<TUSD>>();
        let mut mandate = scenario.take_shared<Mandate>();
        let cap = scenario.take_from_sender<AgentCap>();
        vault::agent_consume<TUSD>(&mut vault, &mut mandate, &cap, SCOPE_SUPPLY, 300, &clock);
        scenario.return_to_sender(cap);
        ts::return_shared(mandate);
        ts::return_shared(vault);
    };

    // Second deploy: 250 under SWAP. Both pots accumulate.
    scenario.next_tx(AGENT);
    {
        let mut vault = scenario.take_shared<Vault<TUSD>>();
        let mut mandate = scenario.take_shared<Mandate>();
        let cap = scenario.take_from_sender<AgentCap>();
        vault::agent_consume<TUSD>(&mut vault, &mut mandate, &cap, SCOPE_SWAP, 250, &clock);

        assert!(vault::deployed_value<TUSD>(&vault) == 550, 0);
        assert!(vault::idle_value<TUSD>(&vault) == DEPOSIT - 550, 1);
        assert!(mandate::budget_remaining(&mandate) == BUDGET - 550, 2);

        scenario.return_to_sender(cap);
        ts::return_shared(mandate);
        ts::return_shared(vault);
    };

    cleanup(scenario, clock);
}

// === FAILURE PATHS (the design drivers — written first) ===

#[test]
#[expected_failure(abort_code = suize::mandate::EOverBudget)]
/// Agent tries to deploy more than the remaining BUDGET. Because idle (DEPOSIT
/// = 5_000) comfortably exceeds the spend, the BUDGET is unambiguously the
/// binding constraint, so the abort is `EOverBudget` from the mandate gate —
/// which runs BEFORE the vault touches any balance.
fun test_agent_consume_over_budget_aborts() {
    let (mut scenario, clock) = begin();

    let mandate_id = create_default_mandate(&mut scenario, &clock);
    create_vault_for(&mut scenario, mandate_id);
    deposit_as_owner(&mut scenario, DEPOSIT);
    issue_cap_to_agent(&mut scenario);

    scenario.next_tx(AGENT);
    {
        let mut vault = scenario.take_shared<Vault<TUSD>>();
        let mut mandate = scenario.take_shared<Mandate>();
        let cap = scenario.take_from_sender<AgentCap>();
        // BUDGET + 1 (idle is far larger, so budget fails first).
        vault::agent_consume<TUSD>(&mut vault, &mut mandate, &cap, SCOPE_SUPPLY, BUDGET + 1, &clock);
        scenario.return_to_sender(cap);
        ts::return_shared(mandate);
        ts::return_shared(vault);
    };

    cleanup(scenario, clock);
}

#[test]
#[expected_failure(abort_code = suize::vault::EInsufficientBalance)]
/// Agent's spend is WITHIN budget but exceeds the idle balance. The mandate gate
/// passes (amount <= budget), then the vault's own idle-sufficiency assert fires
/// → `EInsufficientBalance`. We fund idle with only 100 but budget allows 1_000,
/// then try to deploy 500: gate OK, idle short → vault aborts.
fun test_agent_consume_insufficient_idle_aborts() {
    let (mut scenario, clock) = begin();

    let mandate_id = create_default_mandate(&mut scenario, &clock);
    create_vault_for(&mut scenario, mandate_id);
    // Underfund idle relative to the budget so the VAULT is the binding wall.
    deposit_as_owner(&mut scenario, 100);
    issue_cap_to_agent(&mut scenario);

    scenario.next_tx(AGENT);
    {
        let mut vault = scenario.take_shared<Vault<TUSD>>();
        let mut mandate = scenario.take_shared<Mandate>();
        let cap = scenario.take_from_sender<AgentCap>();
        // 500 <= BUDGET (passes gate) but 500 > idle(100) → EInsufficientBalance.
        vault::agent_consume<TUSD>(&mut vault, &mut mandate, &cap, SCOPE_SUPPLY, 500, &clock);
        scenario.return_to_sender(cap);
        ts::return_shared(mandate);
        ts::return_shared(vault);
    };

    cleanup(scenario, clock);
}

#[test]
#[expected_failure(abort_code = suize::mandate::ECapNotAllowed)]
/// After the owner revokes the agent's cap, `agent_consume` aborts with the
/// mandate's `ECapNotAllowed` (the kill-switch, now proven through the vault).
fun test_agent_consume_after_revoke_aborts() {
    let (mut scenario, clock) = begin();

    let mandate_id = create_default_mandate(&mut scenario, &clock);
    create_vault_for(&mut scenario, mandate_id);
    deposit_as_owner(&mut scenario, DEPOSIT);
    issue_cap_to_agent(&mut scenario);

    // Capture the cap's id so the owner can revoke it.
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
        ts::return_shared(mandate);
    };

    // AGENT's next deploy aborts at the gate.
    scenario.next_tx(AGENT);
    {
        let mut vault = scenario.take_shared<Vault<TUSD>>();
        let mut mandate = scenario.take_shared<Mandate>();
        let cap = scenario.take_from_sender<AgentCap>();
        vault::agent_consume<TUSD>(&mut vault, &mut mandate, &cap, SCOPE_SUPPLY, 100, &clock);
        scenario.return_to_sender(cap);
        ts::return_shared(mandate);
        ts::return_shared(vault);
    };

    cleanup(scenario, clock);
}

#[test]
#[expected_failure(abort_code = suize::mandate::EExpired)]
/// Past expiry, `agent_consume` aborts with the mandate's `EExpired`. We advance
/// the clock to exactly `expiry_ms` (the bound is strict `<`, so == also fails).
fun test_agent_consume_after_expiry_aborts() {
    let (mut scenario, mut clock) = begin();

    let mandate_id = create_default_mandate(&mut scenario, &clock);
    create_vault_for(&mut scenario, mandate_id);
    deposit_as_owner(&mut scenario, DEPOSIT);
    issue_cap_to_agent(&mut scenario);

    clock.set_for_testing(EXPIRY_MS);

    scenario.next_tx(AGENT);
    {
        let mut vault = scenario.take_shared<Vault<TUSD>>();
        let mut mandate = scenario.take_shared<Mandate>();
        let cap = scenario.take_from_sender<AgentCap>();
        vault::agent_consume<TUSD>(&mut vault, &mut mandate, &cap, SCOPE_SUPPLY, 100, &clock);
        scenario.return_to_sender(cap);
        ts::return_shared(mandate);
        ts::return_shared(vault);
    };

    cleanup(scenario, clock);
}

#[test]
#[expected_failure(abort_code = suize::mandate::EOutOfScope)]
/// A scope tag the mandate never granted aborts with the mandate's
/// `EOutOfScope`, even though budget + idle would both allow the spend.
fun test_agent_consume_out_of_scope_aborts() {
    let (mut scenario, clock) = begin();

    let mandate_id = create_default_mandate(&mut scenario, &clock);
    create_vault_for(&mut scenario, mandate_id);
    deposit_as_owner(&mut scenario, DEPOSIT);
    issue_cap_to_agent(&mut scenario);

    scenario.next_tx(AGENT);
    {
        let mut vault = scenario.take_shared<Vault<TUSD>>();
        let mut mandate = scenario.take_shared<Mandate>();
        let cap = scenario.take_from_sender<AgentCap>();
        // SCOPE_NOT_ALLOWED (9) was never granted.
        vault::agent_consume<TUSD>(&mut vault, &mut mandate, &cap, SCOPE_NOT_ALLOWED, 100, &clock);
        scenario.return_to_sender(cap);
        ts::return_shared(mandate);
        ts::return_shared(vault);
    };

    cleanup(scenario, clock);
}

#[test]
#[expected_failure(abort_code = suize::vault::EVaultMandateMismatch)]
/// A vault may only be driven by ITS OWN mandate. Here we build a vault linked to
/// mandate A but drive it with mandate B (and a cap minted for B). The vault's
/// `mandate_id` check fires FIRST → `EVaultMandateMismatch`, before the gate.
fun test_agent_consume_wrong_mandate_aborts() {
    let (mut scenario, clock) = begin();

    // Mandate A — the vault will be bound to this one.
    let mandate_a_id = create_default_mandate(&mut scenario, &clock);
    create_vault_for(&mut scenario, mandate_a_id);
    deposit_as_owner(&mut scenario, DEPOSIT);

    // Mandate B — a second, independent mandate (also OWNER's), with a cap minted
    // for B so the cap↔mandate check inside the gate would otherwise pass.
    scenario.next_tx(OWNER);
    mandate::create_mandate(
        BUDGET,
        vector[SCOPE_SUPPLY, SCOPE_SWAP],
        EXPIRY_MS,
        &clock,
        scenario.ctx(),
    );

    // Mint a cap bound to B and keep it.
    scenario.next_tx(OWNER);
    let cap_b = {
        // take_shared returns the most-recently-shared Mandate (B).
        let mut mandate_b = scenario.take_shared<Mandate>();
        assert!(object::id(&mandate_b) != mandate_a_id, 0);
        let cap = mandate::issue_agent_cap_for_testing(&mut mandate_b, scenario.ctx());
        ts::return_shared(mandate_b);
        cap
    };

    // Drive the A-bound vault with mandate B → vault.mandate_id (A) != id(B).
    scenario.next_tx(OWNER);
    {
        let mut vault = scenario.take_shared<Vault<TUSD>>();
        let mut mandate_b = scenario.take_shared<Mandate>();
        // Sanity: the vault is bound to A, not the B we're passing.
        assert!(vault::mandate_id<TUSD>(&vault) != object::id(&mandate_b), 1);
        vault::agent_consume<TUSD>(&mut vault, &mut mandate_b, &cap_b, SCOPE_SUPPLY, 100, &clock);
        ts::return_shared(mandate_b);
        ts::return_shared(vault);
    };

    // Unreachable (the call aborts), but the cap has no drop and must be consumed
    // on every path for the test to compile.
    mandate::destroy_cap_for_testing(cap_b);
    cleanup(scenario, clock);
}

#[test]
#[expected_failure(abort_code = suize::vault::ENotOwner)]
/// A non-owner cannot deposit into the vault → `ENotOwner`.
fun test_non_owner_deposit_aborts() {
    let (mut scenario, clock) = begin();

    let mandate_id = create_default_mandate(&mut scenario, &clock);
    create_vault_for(&mut scenario, mandate_id);

    scenario.next_tx(STRANGER);
    {
        let mut vault = scenario.take_shared<Vault<TUSD>>();
        let coin = coin::mint_for_testing<TUSD>(1_000, scenario.ctx());
        vault::deposit<TUSD>(&mut vault, coin, scenario.ctx());
        ts::return_shared(vault);
    };

    cleanup(scenario, clock);
}

#[test]
#[expected_failure(abort_code = suize::vault::ENotOwner)]
/// A non-owner cannot withdraw idle funds → `ENotOwner`. (Fund it first as OWNER
/// so the abort is the ownership check, not an empty-balance artifact.)
fun test_non_owner_withdraw_idle_aborts() {
    let (mut scenario, clock) = begin();

    let mandate_id = create_default_mandate(&mut scenario, &clock);
    create_vault_for(&mut scenario, mandate_id);
    deposit_as_owner(&mut scenario, DEPOSIT);

    scenario.next_tx(STRANGER);
    {
        let mut vault = scenario.take_shared<Vault<TUSD>>();
        let coin = vault::withdraw_idle<TUSD>(&mut vault, 100, scenario.ctx());
        transfer::public_transfer(coin, STRANGER);
        ts::return_shared(vault);
    };

    cleanup(scenario, clock);
}

#[test]
#[expected_failure(abort_code = suize::vault::EInsufficientBalance)]
/// Owner withdrawing more idle than exists aborts with `EInsufficientBalance`
/// (the vault's own guard, not the framework's `balance::split` abort).
fun test_withdraw_idle_over_balance_aborts() {
    let (mut scenario, clock) = begin();

    let mandate_id = create_default_mandate(&mut scenario, &clock);
    create_vault_for(&mut scenario, mandate_id);
    deposit_as_owner(&mut scenario, 1_000);

    scenario.next_tx(OWNER);
    {
        let mut vault = scenario.take_shared<Vault<TUSD>>();
        let coin = vault::withdraw_idle<TUSD>(&mut vault, 1_001, scenario.ctx());
        transfer::public_transfer(coin, OWNER);
        ts::return_shared(vault);
    };

    cleanup(scenario, clock);
}
