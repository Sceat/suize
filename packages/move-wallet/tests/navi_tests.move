#[test_only]
/// Tests for `suize::navi` — the NAVI lending adapter (the SAFE tier) — written
/// TESTS-FIRST.
///
/// HEADLINE GUARANTEES UNDER TEST:
///   • THE GATE is VM-enforced on BOTH legs: the agent supplies / redeems ONLY
///     within its mandate (budget / scope / expiry / allow-list / own-mandate).
///   • THE SAFE TIER IS MULTI-ASSET: the vault holds many coin types at once
///     (here WAL ~ COIN_A and USDC ~ COIN_B), lending EACH as-is; the agent never
///     moves value between two assets (asset-scope).
///   • THE WITHDRAW LEG IS A TIGHT CAGE: the redeem returns a `WithdrawTicket` hot
///     potato that MUST be consumed by re-absorbing NAVI's returned coin into the
///     vault — so the redeemed funds are guaranteed back in custody, nothing left
///     free for the agent. (The SUPPLY leg is the documented LOOSER leg: it returns
///     a mandate-capped coin the PTB hands to NAVI — destination not VM-enforced,
///     amount + scope are. See the module header.)
///   • THE VAULT CUSTODIES THE NAVI AccountCap: a `key + store` cap lives inside
///     the shared vault (here a STUB cap; in production NAVI's real
///     `lending_core::account::AccountCap`). Supply/withdraw abort if no cap is set.
///
/// WHAT THESE TESTS COVER vs WHAT NEEDS A LIVE RUN
/// ----------------------------------------------------------------------------
/// NAVI's `Storage` / `Pool<T>` / `PriceOracle` / `Incentive` are `key`-only shared
/// objects from a privileged, oracle-dependent flow — uncreatable in a Move unit
/// test — and NAVI's Move package is NOT importable as a dep anyway (old-vs-new
/// manifest wall; see `navi.move`). So these tests drive the production GATE
/// (`gate_and_release`) and the production CUSTODY paths (the `supplied` ledger +
/// the ticket/re-absorb seal) through the `*_stub` entrypoints, which substitute
/// ONLY the NAVI protocol call: supply burns the released coin (NAVI would consume
/// it); withdraw mints the coin NAVI would return and runs the REAL
/// `agent_absorb_withdrawn` seal. So the gated-supply ledger update + the gated-
/// withdraw re-absorption are tested against the REAL production logic; only the
/// protocol leg is mocked. The REAL `incentive_v3::deposit_with_account_cap` /
/// `withdraw_with_account_cap` calls are performed by the agent's PTB via the SDK
/// against the published package and require a LIVE localnet/testnet/mainnet
/// integration run — intentionally NOT faked here.
///
/// As in `swap_tests` / `vault_tests`, abort-code constants are referenced by
/// fully-qualified path in `#[expected_failure(...)]` (importing them would only
/// yield "unused alias" warnings).
module suize::navi_tests;

use suize::mandate::{Self, Mandate, AgentCap};
use suize::navi::{Self, MultiAssetVault};
use sui::clock::{Self, Clock};
use sui::coin::{Self, Coin};
use sui::test_scenario::{Self as ts, Scenario};

// === Test types ===
// Two delegated SAFE assets (multi-asset proof): COIN_A ~ WAL, COIN_B ~ USDC.
// Bare `has drop` witnesses; `coin::mint_for_testing` fabricates balances without a
// TreasuryCap.
public struct COIN_A has drop {}
public struct COIN_B has drop {}

/// STUB for NAVI's `lending_core::account::AccountCap` — a `key + store` object the
/// vault custodies. NAVI's real cap is `key + store` with an `owner: address`; we
/// only need the abilities here (we never call NAVI in-VM). Created via the
/// test-only minter below.
public struct StubAccountCap has key, store {
    id: UID,
}

// === Test actors ===
const OWNER: address = @0xA;
const AGENT: address = @0xB;
const STRANGER: address = @0xC;

// === Test fixtures ===
const BUDGET: u64 = 1_000;
const EXPIRY_MS: u64 = 10_000;
// Scope-tag convention (CLAUDE.md v3): 0 = NAVI supply, 1 = NAVI withdraw.
const SCOPE_SUPPLY: u8 = 0;
const SCOPE_WITHDRAW: u8 = 1;
const SCOPE_NOT_ALLOWED: u8 = 9;

// NAVI pool/asset index (rides along to the SDK call; unused in-VM). Arbitrary.
const ASSET_ID_A: u8 = 7;
const ASSET_ID_B: u8 = 1;

// Fund both assets above the budget so that, in the over-budget test, the BUDGET
// (not an idle balance) is unambiguously the binding constraint.
const DEPOSIT_A: u64 = 5_000;
const DEPOSIT_B: u64 = 5_000;

// === Helpers ===

fun begin(): (Scenario, Clock) {
    let mut scenario = ts::begin(OWNER);
    let clock = clock::create_for_testing(scenario.ctx());
    (scenario, clock)
}

fun mint_stub_cap(scenario: &mut Scenario): StubAccountCap {
    StubAccountCap { id: object::new(scenario.ctx()) }
}

fun destroy_stub_cap(cap: StubAccountCap) {
    let StubAccountCap { id } = cap;
    id.delete();
}

/// Create a default mandate as OWNER (scopes: supply + withdraw) and return its ID.
fun create_default_mandate(scenario: &mut Scenario, clock: &Clock): ID {
    scenario.next_tx(OWNER);
    mandate::create_mandate(
        BUDGET,
        vector[SCOPE_SUPPLY, SCOPE_WITHDRAW],
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

/// As OWNER, create + share a MultiAssetVault<StubAccountCap> linked to `mandate_id`.
fun create_vault_for(scenario: &mut Scenario, mandate_id: ID) {
    scenario.next_tx(OWNER);
    navi::create_vault<StubAccountCap>(mandate_id, scenario.ctx());
}

/// As OWNER, custody a fresh stub AccountCap into the vault.
fun set_cap_as_owner(scenario: &mut Scenario) {
    scenario.next_tx(OWNER);
    let cap = mint_stub_cap(scenario);
    let mut vault = scenario.take_shared<MultiAssetVault<StubAccountCap>>();
    navi::set_account_cap<StubAccountCap>(&mut vault, cap, scenario.ctx());
    ts::return_shared(vault);
}

fun deposit_a_as_owner(scenario: &mut Scenario, amount: u64) {
    scenario.next_tx(OWNER);
    let mut vault = scenario.take_shared<MultiAssetVault<StubAccountCap>>();
    let coin = coin::mint_for_testing<COIN_A>(amount, scenario.ctx());
    navi::deposit<StubAccountCap, COIN_A>(&mut vault, coin, scenario.ctx());
    ts::return_shared(vault);
}

fun deposit_b_as_owner(scenario: &mut Scenario, amount: u64) {
    scenario.next_tx(OWNER);
    let mut vault = scenario.take_shared<MultiAssetVault<StubAccountCap>>();
    let coin = coin::mint_for_testing<COIN_B>(amount, scenario.ctx());
    navi::deposit<StubAccountCap, COIN_B>(&mut vault, coin, scenario.ctx());
    ts::return_shared(vault);
}

/// Full SAFE-tier setup: vault + custodied cap + both assets funded.
fun fund_vault(scenario: &mut Scenario) {
    set_cap_as_owner(scenario);
    deposit_a_as_owner(scenario, DEPOSIT_A);
    deposit_b_as_owner(scenario, DEPOSIT_B);
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
/// Owner lifecycle: create → set AccountCap → deposit two assets → values track
/// exactly per-asset, the vault↔mandate link is correct, and the cap is custodied.
fun test_create_set_cap_and_multi_asset_deposits_track() {
    let (mut scenario, clock) = begin();

    let mandate_id = create_default_mandate(&mut scenario, &clock);
    create_vault_for(&mut scenario, mandate_id);
    fund_vault(&mut scenario);

    scenario.next_tx(OWNER);
    {
        let vault = scenario.take_shared<MultiAssetVault<StubAccountCap>>();
        assert!(navi::owner<StubAccountCap>(&vault) == OWNER, 0);
        assert!(navi::mandate_id<StubAccountCap>(&vault) == mandate_id, 1);
        assert!(navi::has_account_cap<StubAccountCap>(&vault), 2);
        // Both assets are held independently — the multi-asset proof.
        assert!(navi::idle_value<StubAccountCap, COIN_A>(&vault) == DEPOSIT_A, 3);
        assert!(navi::idle_value<StubAccountCap, COIN_B>(&vault) == DEPOSIT_B, 4);
        // Nothing supplied yet.
        assert!(navi::supplied_value<StubAccountCap, COIN_A>(&vault) == 0, 5);
        assert!(navi::supplied_value<StubAccountCap, COIN_B>(&vault) == 0, 6);
        ts::return_shared(vault);
    };

    cleanup(scenario, clock);
}

#[test]
/// THE HEADLINE SUPPLY PROOF: a mandate-gated supply of COIN_A AS-IS to NAVI within
/// budget. Idle ↓ by amount, supplied ↑ by amount, budget ↓ by amount (atomic), and
/// the OTHER asset (COIN_B) is completely untouched (asset-scope / multi-asset).
fun test_agent_supply_within_budget_tracks_and_isolates_assets() {
    let (mut scenario, clock) = begin();

    let mandate_id = create_default_mandate(&mut scenario, &clock);
    create_vault_for(&mut scenario, mandate_id);
    fund_vault(&mut scenario);
    issue_cap_to_agent(&mut scenario);

    let amount = 300;

    scenario.next_tx(AGENT);
    {
        let mut vault = scenario.take_shared<MultiAssetVault<StubAccountCap>>();
        let mut mandate = scenario.take_shared<Mandate>();
        let cap = scenario.take_from_sender<AgentCap>();

        navi::agent_supply_stub<StubAccountCap, COIN_A>(
            &mut vault, &mut mandate, &cap,
            SCOPE_SUPPLY, ASSET_ID_A, amount, &clock, scenario.ctx(),
        );

        // COIN_A: idle down, supplied up.
        assert!(navi::idle_value<StubAccountCap, COIN_A>(&vault) == DEPOSIT_A - amount, 0);
        assert!(navi::supplied_value<StubAccountCap, COIN_A>(&vault) == amount, 1);
        // COIN_B untouched — the agent supplied A as-is, never swapped to B.
        assert!(navi::idle_value<StubAccountCap, COIN_B>(&vault) == DEPOSIT_B, 2);
        assert!(navi::supplied_value<StubAccountCap, COIN_B>(&vault) == 0, 3);
        // Budget debited by amount, atomic with the supply.
        assert!(mandate::budget_remaining(&mandate) == BUDGET - amount, 4);

        scenario.return_to_sender(cap);
        ts::return_shared(mandate);
        ts::return_shared(vault);
    };

    cleanup(scenario, clock);
}

#[test]
/// THE HEADLINE WITHDRAW PROOF (the TIGHT leg): supply then redeem COIN_A. The
/// redeem's returned coin is re-absorbed into the vault's idle pot via the ticket
/// seal — so idle comes back up, supplied comes back down, budget is debited by the
/// redeem amount, and NOTHING is left free-floating for the agent. We model NAVI
/// returning EXACTLY the principal (no interest) here.
fun test_agent_withdraw_reabsorbs_into_custody() {
    let (mut scenario, clock) = begin();

    let mandate_id = create_default_mandate(&mut scenario, &clock);
    create_vault_for(&mut scenario, mandate_id);
    fund_vault(&mut scenario);
    issue_cap_to_agent(&mut scenario);

    let supply_amt = 400;
    let withdraw_amt = 250;

    // Supply 400 A.
    scenario.next_tx(AGENT);
    {
        let mut vault = scenario.take_shared<MultiAssetVault<StubAccountCap>>();
        let mut mandate = scenario.take_shared<Mandate>();
        let cap = scenario.take_from_sender<AgentCap>();
        navi::agent_supply_stub<StubAccountCap, COIN_A>(
            &mut vault, &mut mandate, &cap,
            SCOPE_SUPPLY, ASSET_ID_A, supply_amt, &clock, scenario.ctx(),
        );
        scenario.return_to_sender(cap);
        ts::return_shared(mandate);
        ts::return_shared(vault);
    };

    // Redeem 250 A; NAVI returns exactly 250 (redeemed == requested).
    scenario.next_tx(AGENT);
    {
        let mut vault = scenario.take_shared<MultiAssetVault<StubAccountCap>>();
        let mut mandate = scenario.take_shared<Mandate>();
        let cap = scenario.take_from_sender<AgentCap>();
        navi::agent_withdraw_stub<StubAccountCap, COIN_A>(
            &mut vault, &mut mandate, &cap,
            SCOPE_WITHDRAW, ASSET_ID_A, withdraw_amt, withdraw_amt,
            &clock, scenario.ctx(),
        );

        // Idle: started DEPOSIT_A, −supply_amt (supplied out), +withdraw_amt
        // (re-absorbed) = DEPOSIT_A − supply_amt + withdraw_amt.
        assert!(
            navi::idle_value<StubAccountCap, COIN_A>(&vault)
                == DEPOSIT_A - supply_amt + withdraw_amt,
            0,
        );
        // Supplied: +supply_amt then −withdraw_amt.
        assert!(
            navi::supplied_value<StubAccountCap, COIN_A>(&vault) == supply_amt - withdraw_amt,
            1,
        );
        // Budget: −supply_amt (supply) −withdraw_amt (withdraw).
        assert!(
            mandate::budget_remaining(&mandate) == BUDGET - supply_amt - withdraw_amt,
            2,
        );

        scenario.return_to_sender(cap);
        ts::return_shared(mandate);
        ts::return_shared(vault);
    };

    cleanup(scenario, clock);
}

#[test]
/// INTEREST CASE: NAVI returns MORE than the requested principal (accrued yield).
/// The surplus simply lands in custody too — idle rises by the full `redeemed`, and
/// the surplus is NOT lost. Proves the SAFE tier actually captures the lend yield in
/// the vault, not in the agent's hands.
fun test_agent_withdraw_with_interest_lands_surplus_in_custody() {
    let (mut scenario, clock) = begin();

    let mandate_id = create_default_mandate(&mut scenario, &clock);
    create_vault_for(&mut scenario, mandate_id);
    fund_vault(&mut scenario);
    issue_cap_to_agent(&mut scenario);

    let supply_amt = 400;
    let withdraw_amt = 400;
    let redeemed = 412; // 12 units of accrued interest.

    scenario.next_tx(AGENT);
    {
        let mut vault = scenario.take_shared<MultiAssetVault<StubAccountCap>>();
        let mut mandate = scenario.take_shared<Mandate>();
        let cap = scenario.take_from_sender<AgentCap>();
        navi::agent_supply_stub<StubAccountCap, COIN_A>(
            &mut vault, &mut mandate, &cap,
            SCOPE_SUPPLY, ASSET_ID_A, supply_amt, &clock, scenario.ctx(),
        );
        scenario.return_to_sender(cap);
        ts::return_shared(mandate);
        ts::return_shared(vault);
    };

    scenario.next_tx(AGENT);
    {
        let mut vault = scenario.take_shared<MultiAssetVault<StubAccountCap>>();
        let mut mandate = scenario.take_shared<Mandate>();
        let cap = scenario.take_from_sender<AgentCap>();
        navi::agent_withdraw_stub<StubAccountCap, COIN_A>(
            &mut vault, &mut mandate, &cap,
            SCOPE_WITHDRAW, ASSET_ID_A, withdraw_amt, redeemed,
            &clock, scenario.ctx(),
        );

        // Idle gains the FULL redeemed amount (principal + interest).
        assert!(
            navi::idle_value<StubAccountCap, COIN_A>(&vault)
                == DEPOSIT_A - supply_amt + redeemed,
            0,
        );
        // Supplied tracks principal only → back to 0.
        assert!(navi::supplied_value<StubAccountCap, COIN_A>(&vault) == 0, 1);

        scenario.return_to_sender(cap);
        ts::return_shared(mandate);
        ts::return_shared(vault);
    };

    cleanup(scenario, clock);
}

#[test]
/// MULTI-ASSET, MULTI-CYCLE: the agent supplies BOTH assets across several cycles,
/// proving the cage composes per-asset and the budget is the single shared meter.
/// Supply 200 A, supply 150 B, withdraw 100 A — assert all three ledgers + budget.
fun test_multi_asset_cycles_accumulate() {
    let (mut scenario, clock) = begin();

    let mandate_id = create_default_mandate(&mut scenario, &clock);
    create_vault_for(&mut scenario, mandate_id);
    fund_vault(&mut scenario);
    issue_cap_to_agent(&mut scenario);

    // Cycle 1: supply 200 A.
    scenario.next_tx(AGENT);
    {
        let mut vault = scenario.take_shared<MultiAssetVault<StubAccountCap>>();
        let mut mandate = scenario.take_shared<Mandate>();
        let cap = scenario.take_from_sender<AgentCap>();
        navi::agent_supply_stub<StubAccountCap, COIN_A>(
            &mut vault, &mut mandate, &cap,
            SCOPE_SUPPLY, ASSET_ID_A, 200, &clock, scenario.ctx(),
        );
        scenario.return_to_sender(cap);
        ts::return_shared(mandate);
        ts::return_shared(vault);
    };

    // Cycle 2: supply 150 B.
    scenario.next_tx(AGENT);
    {
        let mut vault = scenario.take_shared<MultiAssetVault<StubAccountCap>>();
        let mut mandate = scenario.take_shared<Mandate>();
        let cap = scenario.take_from_sender<AgentCap>();
        navi::agent_supply_stub<StubAccountCap, COIN_B>(
            &mut vault, &mut mandate, &cap,
            SCOPE_SUPPLY, ASSET_ID_B, 150, &clock, scenario.ctx(),
        );
        scenario.return_to_sender(cap);
        ts::return_shared(mandate);
        ts::return_shared(vault);
    };

    // Cycle 3: withdraw 100 A (NAVI returns exactly 100).
    scenario.next_tx(AGENT);
    {
        let mut vault = scenario.take_shared<MultiAssetVault<StubAccountCap>>();
        let mut mandate = scenario.take_shared<Mandate>();
        let cap = scenario.take_from_sender<AgentCap>();
        navi::agent_withdraw_stub<StubAccountCap, COIN_A>(
            &mut vault, &mut mandate, &cap,
            SCOPE_WITHDRAW, ASSET_ID_A, 100, 100, &clock, scenario.ctx(),
        );

        // COIN_A: idle DEPOSIT_A − 200 + 100; supplied 200 − 100 = 100.
        assert!(navi::idle_value<StubAccountCap, COIN_A>(&vault) == DEPOSIT_A - 200 + 100, 0);
        assert!(navi::supplied_value<StubAccountCap, COIN_A>(&vault) == 100, 1);
        // COIN_B: idle DEPOSIT_B − 150; supplied 150.
        assert!(navi::idle_value<StubAccountCap, COIN_B>(&vault) == DEPOSIT_B - 150, 2);
        assert!(navi::supplied_value<StubAccountCap, COIN_B>(&vault) == 150, 3);
        // Budget: −200 (A supply) −150 (B supply) −100 (A withdraw) = BUDGET − 450.
        assert!(mandate::budget_remaining(&mandate) == BUDGET - 450, 4);

        scenario.return_to_sender(cap);
        ts::return_shared(mandate);
        ts::return_shared(vault);
    };

    cleanup(scenario, clock);
}

#[test]
/// THE ANTI-REDIRECT PROOF for the WITHDRAW leg: after a full supply→withdraw, the
/// AGENT's account holds NO loose `Coin<COIN_A>`. The redeemed coin was re-absorbed
/// into the vault by the ticket seal, so there is nothing free-floating for the
/// agent to transfer to an attacker. (`ts::ids_for_sender` must be empty.)
fun test_no_coin_leaks_to_agent_after_withdraw() {
    let (mut scenario, clock) = begin();

    let mandate_id = create_default_mandate(&mut scenario, &clock);
    create_vault_for(&mut scenario, mandate_id);
    fund_vault(&mut scenario);
    issue_cap_to_agent(&mut scenario);

    scenario.next_tx(AGENT);
    {
        let mut vault = scenario.take_shared<MultiAssetVault<StubAccountCap>>();
        let mut mandate = scenario.take_shared<Mandate>();
        let cap = scenario.take_from_sender<AgentCap>();
        navi::agent_supply_stub<StubAccountCap, COIN_A>(
            &mut vault, &mut mandate, &cap,
            SCOPE_SUPPLY, ASSET_ID_A, 300, &clock, scenario.ctx(),
        );
        navi::agent_withdraw_stub<StubAccountCap, COIN_A>(
            &mut vault, &mut mandate, &cap,
            SCOPE_WITHDRAW, ASSET_ID_A, 200, 200, &clock, scenario.ctx(),
        );
        scenario.return_to_sender(cap);
        ts::return_shared(mandate);
        ts::return_shared(vault);
    };

    // Fresh tx as the agent: the only object it should hold is its AgentCap.
    scenario.next_tx(AGENT);
    {
        let coin_ids = ts::ids_for_sender<Coin<COIN_A>>(&scenario);
        assert!(coin_ids.is_empty(), 0);
    };

    cleanup(scenario, clock);
}

#[test]
/// Owner can take the custodied AccountCap back out (the account-binding exit) and
/// then the vault reports no cap. Confirms `take_account_cap` round-trips the cap.
fun test_owner_take_account_cap() {
    let (mut scenario, clock) = begin();

    let mandate_id = create_default_mandate(&mut scenario, &clock);
    create_vault_for(&mut scenario, mandate_id);
    set_cap_as_owner(&mut scenario);

    scenario.next_tx(OWNER);
    {
        let mut vault = scenario.take_shared<MultiAssetVault<StubAccountCap>>();
        assert!(navi::has_account_cap<StubAccountCap>(&vault), 0);
        let cap = navi::take_account_cap<StubAccountCap>(&mut vault, scenario.ctx());
        assert!(!navi::has_account_cap<StubAccountCap>(&vault), 1);
        destroy_stub_cap(cap);
        ts::return_shared(vault);
    };

    cleanup(scenario, clock);
}

#[test]
/// Owner idle-withdraw of one asset works and is per-asset (the other untouched).
fun test_owner_withdraw_idle_per_asset() {
    let (mut scenario, clock) = begin();

    let mandate_id = create_default_mandate(&mut scenario, &clock);
    create_vault_for(&mut scenario, mandate_id);
    fund_vault(&mut scenario);

    scenario.next_tx(OWNER);
    {
        let mut vault = scenario.take_shared<MultiAssetVault<StubAccountCap>>();
        let a = navi::withdraw_idle<StubAccountCap, COIN_A>(&mut vault, 1_000, scenario.ctx());
        assert!(coin::value(&a) == 1_000, 0);
        assert!(navi::idle_value<StubAccountCap, COIN_A>(&vault) == DEPOSIT_A - 1_000, 1);
        // COIN_B untouched.
        assert!(navi::idle_value<StubAccountCap, COIN_B>(&vault) == DEPOSIT_B, 2);
        coin::burn_for_testing(a);
        ts::return_shared(vault);
    };

    cleanup(scenario, clock);
}

// ============================================================================
// REFUSAL PROOFS (the design drivers — every gated one routes through the REAL gate)
// ============================================================================

#[test]
#[expected_failure(abort_code = suize::mandate::EOverBudget)]
/// Agent tries to supply more than the remaining BUDGET. The asset is funded far
/// above the spend, so BUDGET is the binding constraint → `EOverBudget` from the
/// mandate gate, which runs BEFORE the vault touches any balance.
fun test_supply_over_budget_aborts() {
    let (mut scenario, clock) = begin();

    let mandate_id = create_default_mandate(&mut scenario, &clock);
    create_vault_for(&mut scenario, mandate_id);
    fund_vault(&mut scenario);
    issue_cap_to_agent(&mut scenario);

    scenario.next_tx(AGENT);
    {
        let mut vault = scenario.take_shared<MultiAssetVault<StubAccountCap>>();
        let mut mandate = scenario.take_shared<Mandate>();
        let cap = scenario.take_from_sender<AgentCap>();
        // BUDGET + 1; COIN_A holds 5_000, so the budget fails first.
        navi::agent_supply_stub<StubAccountCap, COIN_A>(
            &mut vault, &mut mandate, &cap,
            SCOPE_SUPPLY, ASSET_ID_A, BUDGET + 1, &clock, scenario.ctx(),
        );
        scenario.return_to_sender(cap);
        ts::return_shared(mandate);
        ts::return_shared(vault);
    };

    cleanup(scenario, clock);
}

#[test]
#[expected_failure(abort_code = suize::navi::EInsufficientBalance)]
/// Within budget but the asset's idle pot can't cover `amount`. Gate passes, then
/// the per-asset idle wall fires → `EInsufficientBalance`. We fund COIN_A to only
/// 100 while budget allows 1_000, then supply 500.
fun test_supply_insufficient_idle_aborts() {
    let (mut scenario, clock) = begin();

    let mandate_id = create_default_mandate(&mut scenario, &clock);
    create_vault_for(&mut scenario, mandate_id);
    set_cap_as_owner(&mut scenario);
    deposit_a_as_owner(&mut scenario, 100); // underfunded vs budget.
    issue_cap_to_agent(&mut scenario);

    scenario.next_tx(AGENT);
    {
        let mut vault = scenario.take_shared<MultiAssetVault<StubAccountCap>>();
        let mut mandate = scenario.take_shared<Mandate>();
        let cap = scenario.take_from_sender<AgentCap>();
        // 500 <= BUDGET (gate OK) but 500 > idle(100) → EInsufficientBalance.
        navi::agent_supply_stub<StubAccountCap, COIN_A>(
            &mut vault, &mut mandate, &cap,
            SCOPE_SUPPLY, ASSET_ID_A, 500, &clock, scenario.ctx(),
        );
        scenario.return_to_sender(cap);
        ts::return_shared(mandate);
        ts::return_shared(vault);
    };

    cleanup(scenario, clock);
}

#[test]
#[expected_failure(abort_code = suize::navi::ENoSuchAsset)]
/// Within budget, but the agent supplies an asset that was NEVER deposited (no idle
/// pot exists) → `ENoSuchAsset`. COIN_B is funded but we supply COIN_A, which has no
/// pot. (Distinguishes "unknown asset" from "low balance".)
fun test_supply_unknown_asset_aborts() {
    let (mut scenario, clock) = begin();

    let mandate_id = create_default_mandate(&mut scenario, &clock);
    create_vault_for(&mut scenario, mandate_id);
    set_cap_as_owner(&mut scenario);
    deposit_b_as_owner(&mut scenario, DEPOSIT_B); // only B funded; A has no pot.
    issue_cap_to_agent(&mut scenario);

    scenario.next_tx(AGENT);
    {
        let mut vault = scenario.take_shared<MultiAssetVault<StubAccountCap>>();
        let mut mandate = scenario.take_shared<Mandate>();
        let cap = scenario.take_from_sender<AgentCap>();
        // A has no idle pot at all → ENoSuchAsset (after the gate passes).
        navi::agent_supply_stub<StubAccountCap, COIN_A>(
            &mut vault, &mut mandate, &cap,
            SCOPE_SUPPLY, ASSET_ID_A, 100, &clock, scenario.ctx(),
        );
        scenario.return_to_sender(cap);
        ts::return_shared(mandate);
        ts::return_shared(vault);
    };

    cleanup(scenario, clock);
}

#[test]
#[expected_failure(abort_code = suize::navi::ENoAccountCap)]
/// Supply aborts if the vault has no custodied AccountCap — we won't release funds
/// for a supply that has no NAVI account to land in. Vault is funded but the cap was
/// never set. The check runs after the vault↔mandate check, before the gate.
fun test_supply_without_account_cap_aborts() {
    let (mut scenario, clock) = begin();

    let mandate_id = create_default_mandate(&mut scenario, &clock);
    create_vault_for(&mut scenario, mandate_id);
    // Fund the asset but DON'T set the AccountCap.
    deposit_a_as_owner(&mut scenario, DEPOSIT_A);
    issue_cap_to_agent(&mut scenario);

    scenario.next_tx(AGENT);
    {
        let mut vault = scenario.take_shared<MultiAssetVault<StubAccountCap>>();
        let mut mandate = scenario.take_shared<Mandate>();
        let cap = scenario.take_from_sender<AgentCap>();
        navi::agent_supply_stub<StubAccountCap, COIN_A>(
            &mut vault, &mut mandate, &cap,
            SCOPE_SUPPLY, ASSET_ID_A, 100, &clock, scenario.ctx(),
        );
        scenario.return_to_sender(cap);
        ts::return_shared(mandate);
        ts::return_shared(vault);
    };

    cleanup(scenario, clock);
}

#[test]
#[expected_failure(abort_code = suize::navi::EInsufficientBalance)]
/// Withdraw aborts if the agent tries to redeem MORE principal than the vault
/// recorded as supplied for that asset → `EInsufficientBalance` (on the `supplied`
/// ledger). We supply 100 A then try to redeem 200 A.
fun test_withdraw_over_supplied_aborts() {
    let (mut scenario, clock) = begin();

    let mandate_id = create_default_mandate(&mut scenario, &clock);
    create_vault_for(&mut scenario, mandate_id);
    fund_vault(&mut scenario);
    issue_cap_to_agent(&mut scenario);

    scenario.next_tx(AGENT);
    {
        let mut vault = scenario.take_shared<MultiAssetVault<StubAccountCap>>();
        let mut mandate = scenario.take_shared<Mandate>();
        let cap = scenario.take_from_sender<AgentCap>();
        navi::agent_supply_stub<StubAccountCap, COIN_A>(
            &mut vault, &mut mandate, &cap,
            SCOPE_SUPPLY, ASSET_ID_A, 100, &clock, scenario.ctx(),
        );
        // Redeem 200 > supplied(100) → EInsufficientBalance (200 <= BUDGET, gate OK).
        navi::agent_withdraw_stub<StubAccountCap, COIN_A>(
            &mut vault, &mut mandate, &cap,
            SCOPE_WITHDRAW, ASSET_ID_A, 200, 200, &clock, scenario.ctx(),
        );
        scenario.return_to_sender(cap);
        ts::return_shared(mandate);
        ts::return_shared(vault);
    };

    cleanup(scenario, clock);
}

#[test]
#[expected_failure(abort_code = suize::navi::ENoSuchAsset)]
/// Withdraw aborts if the agent redeems an asset that was never supplied (no
/// `supplied` ledger entry) → `ENoSuchAsset`. Vault funded + cap set, A supplied,
/// but we redeem B (never supplied).
fun test_withdraw_never_supplied_asset_aborts() {
    let (mut scenario, clock) = begin();

    let mandate_id = create_default_mandate(&mut scenario, &clock);
    create_vault_for(&mut scenario, mandate_id);
    fund_vault(&mut scenario);
    issue_cap_to_agent(&mut scenario);

    scenario.next_tx(AGENT);
    {
        let mut vault = scenario.take_shared<MultiAssetVault<StubAccountCap>>();
        let mut mandate = scenario.take_shared<Mandate>();
        let cap = scenario.take_from_sender<AgentCap>();
        navi::agent_supply_stub<StubAccountCap, COIN_A>(
            &mut vault, &mut mandate, &cap,
            SCOPE_SUPPLY, ASSET_ID_A, 100, &clock, scenario.ctx(),
        );
        // B was never supplied → no ledger entry → ENoSuchAsset.
        navi::agent_withdraw_stub<StubAccountCap, COIN_B>(
            &mut vault, &mut mandate, &cap,
            SCOPE_WITHDRAW, ASSET_ID_B, 50, 50, &clock, scenario.ctx(),
        );
        scenario.return_to_sender(cap);
        ts::return_shared(mandate);
        ts::return_shared(vault);
    };

    cleanup(scenario, clock);
}

#[test]
#[expected_failure(abort_code = suize::mandate::ECapNotAllowed)]
/// After the owner revokes the agent's cap, the gated supply aborts with the
/// mandate's `ECapNotAllowed` — the kill switch, proven through the NAVI adapter.
fun test_supply_after_revoke_aborts() {
    let (mut scenario, clock) = begin();

    let mandate_id = create_default_mandate(&mut scenario, &clock);
    create_vault_for(&mut scenario, mandate_id);
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
        let mut vault = scenario.take_shared<MultiAssetVault<StubAccountCap>>();
        let mut mandate = scenario.take_shared<Mandate>();
        let cap = scenario.take_from_sender<AgentCap>();
        navi::agent_supply_stub<StubAccountCap, COIN_A>(
            &mut vault, &mut mandate, &cap,
            SCOPE_SUPPLY, ASSET_ID_A, 100, &clock, scenario.ctx(),
        );
        scenario.return_to_sender(cap);
        ts::return_shared(mandate);
        ts::return_shared(vault);
    };

    cleanup(scenario, clock);
}

#[test]
#[expected_failure(abort_code = suize::mandate::EExpired)]
/// Past expiry, the gated supply aborts with the mandate's `EExpired`. Clock is
/// advanced to exactly `expiry_ms` (the bound is strict `<`, so == fails).
fun test_supply_after_expiry_aborts() {
    let (mut scenario, mut clock) = begin();

    let mandate_id = create_default_mandate(&mut scenario, &clock);
    create_vault_for(&mut scenario, mandate_id);
    fund_vault(&mut scenario);
    issue_cap_to_agent(&mut scenario);

    clock.set_for_testing(EXPIRY_MS);

    scenario.next_tx(AGENT);
    {
        let mut vault = scenario.take_shared<MultiAssetVault<StubAccountCap>>();
        let mut mandate = scenario.take_shared<Mandate>();
        let cap = scenario.take_from_sender<AgentCap>();
        navi::agent_supply_stub<StubAccountCap, COIN_A>(
            &mut vault, &mut mandate, &cap,
            SCOPE_SUPPLY, ASSET_ID_A, 100, &clock, scenario.ctx(),
        );
        scenario.return_to_sender(cap);
        ts::return_shared(mandate);
        ts::return_shared(vault);
    };

    cleanup(scenario, clock);
}

#[test]
#[expected_failure(abort_code = suize::mandate::EOutOfScope)]
/// A scope tag the mandate never granted aborts with `EOutOfScope`. The default
/// mandate grants {supply, withdraw}; we pass SCOPE_NOT_ALLOWED on a supply.
fun test_supply_out_of_scope_aborts() {
    let (mut scenario, clock) = begin();

    let mandate_id = create_default_mandate(&mut scenario, &clock);
    create_vault_for(&mut scenario, mandate_id);
    fund_vault(&mut scenario);
    issue_cap_to_agent(&mut scenario);

    scenario.next_tx(AGENT);
    {
        let mut vault = scenario.take_shared<MultiAssetVault<StubAccountCap>>();
        let mut mandate = scenario.take_shared<Mandate>();
        let cap = scenario.take_from_sender<AgentCap>();
        navi::agent_supply_stub<StubAccountCap, COIN_A>(
            &mut vault, &mut mandate, &cap,
            SCOPE_NOT_ALLOWED, ASSET_ID_A, 100, &clock, scenario.ctx(),
        );
        scenario.return_to_sender(cap);
        ts::return_shared(mandate);
        ts::return_shared(vault);
    };

    cleanup(scenario, clock);
}

#[test]
#[expected_failure(abort_code = suize::mandate::EOutOfScope)]
/// THE ASSET-SCOPE / SAFE-TIER PROOF: a SAFE mandate that grants ONLY {supply,
/// withdraw} must REFUSE a swap (scope tag 2 = DeepBook swap). This is the
/// "can't-swap-your-asset-away" guarantee at the scope level — the SAFE agent
/// physically cannot construct a swap action. We mint a supply-only mandate and try
/// to drive a supply call with the SWAP tag → `EOutOfScope`.
fun test_safe_mandate_refuses_swap_scope() {
    let (mut scenario, clock) = begin();

    // A SAFE mandate granting ONLY supply + withdraw (NO swap tag 2).
    let mandate_id = create_default_mandate(&mut scenario, &clock);
    create_vault_for(&mut scenario, mandate_id);
    fund_vault(&mut scenario);
    issue_cap_to_agent(&mut scenario);

    scenario.next_tx(AGENT);
    {
        let mut vault = scenario.take_shared<MultiAssetVault<StubAccountCap>>();
        let mut mandate = scenario.take_shared<Mandate>();
        let cap = scenario.take_from_sender<AgentCap>();
        // Scope tag 2 (DeepBook swap) is NOT in the SAFE mandate → EOutOfScope.
        navi::agent_supply_stub<StubAccountCap, COIN_A>(
            &mut vault, &mut mandate, &cap,
            2, ASSET_ID_A, 100, &clock, scenario.ctx(),
        );
        scenario.return_to_sender(cap);
        ts::return_shared(mandate);
        ts::return_shared(vault);
    };

    cleanup(scenario, clock);
}

#[test]
#[expected_failure(abort_code = suize::navi::EVaultMandateMismatch)]
/// A vault may only be driven by ITS OWN mandate. Build a vault bound to mandate A,
/// then drive it with mandate B (and a cap minted for B, so the cap↔mandate check
/// inside the gate would otherwise pass). The vault's own `mandate_id` check fires
/// FIRST → `EVaultMandateMismatch`.
fun test_supply_wrong_mandate_aborts() {
    let (mut scenario, clock) = begin();

    // Mandate A — the vault is bound to this one.
    let mandate_a_id = create_default_mandate(&mut scenario, &clock);
    create_vault_for(&mut scenario, mandate_a_id);
    fund_vault(&mut scenario);

    // Mandate B — a second, independent mandate (also OWNER's), cap minted for B.
    scenario.next_tx(OWNER);
    mandate::create_mandate(
        BUDGET,
        vector[SCOPE_SUPPLY, SCOPE_WITHDRAW],
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
        let mut vault = scenario.take_shared<MultiAssetVault<StubAccountCap>>();
        let mut mandate_b = scenario.take_shared<Mandate>();
        assert!(navi::mandate_id<StubAccountCap>(&vault) != object::id(&mandate_b), 1);
        navi::agent_supply_stub<StubAccountCap, COIN_A>(
            &mut vault, &mut mandate_b, &cap_b,
            SCOPE_SUPPLY, ASSET_ID_A, 100, &clock, scenario.ctx(),
        );
        ts::return_shared(mandate_b);
        ts::return_shared(vault);
    };

    // Unreachable (the call aborts), but the cap has no drop and must be consumed on
    // every path for the test to compile.
    mandate::destroy_cap_for_testing(cap_b);
    cleanup(scenario, clock);
}

#[test]
#[expected_failure(abort_code = suize::navi::ENotOwner)]
/// A non-owner cannot deposit into the vault → `ENotOwner`.
fun test_non_owner_deposit_aborts() {
    let (mut scenario, clock) = begin();

    let mandate_id = create_default_mandate(&mut scenario, &clock);
    create_vault_for(&mut scenario, mandate_id);

    scenario.next_tx(STRANGER);
    {
        let mut vault = scenario.take_shared<MultiAssetVault<StubAccountCap>>();
        let coin = coin::mint_for_testing<COIN_A>(1_000, scenario.ctx());
        navi::deposit<StubAccountCap, COIN_A>(&mut vault, coin, scenario.ctx());
        ts::return_shared(vault);
    };

    cleanup(scenario, clock);
}

#[test]
#[expected_failure(abort_code = suize::navi::ENotOwner)]
/// A non-owner cannot set an AccountCap into the vault → `ENotOwner`.
fun test_non_owner_set_cap_aborts() {
    let (mut scenario, clock) = begin();

    let mandate_id = create_default_mandate(&mut scenario, &clock);
    create_vault_for(&mut scenario, mandate_id);

    scenario.next_tx(STRANGER);
    {
        let cap = mint_stub_cap(&mut scenario);
        let mut vault = scenario.take_shared<MultiAssetVault<StubAccountCap>>();
        navi::set_account_cap<StubAccountCap>(&mut vault, cap, scenario.ctx());
        ts::return_shared(vault);
    };

    cleanup(scenario, clock);
}

#[test]
#[expected_failure(abort_code = suize::navi::ENotOwner)]
/// A non-owner cannot withdraw idle funds → `ENotOwner`. (Fund as OWNER first so the
/// abort is the ownership check, not an empty/unknown-asset artifact.)
fun test_non_owner_withdraw_idle_aborts() {
    let (mut scenario, clock) = begin();

    let mandate_id = create_default_mandate(&mut scenario, &clock);
    create_vault_for(&mut scenario, mandate_id);
    fund_vault(&mut scenario);

    scenario.next_tx(STRANGER);
    {
        let mut vault = scenario.take_shared<MultiAssetVault<StubAccountCap>>();
        let coin = navi::withdraw_idle<StubAccountCap, COIN_A>(&mut vault, 100, scenario.ctx());
        transfer::public_transfer(coin, STRANGER);
        ts::return_shared(vault);
    };

    cleanup(scenario, clock);
}

#[test]
#[expected_failure(abort_code = suize::navi::EInsufficientBalance)]
/// Owner withdrawing more idle than exists for an asset aborts with the vault's own
/// `EInsufficientBalance` (not the framework's `balance::split` abort).
fun test_withdraw_idle_over_balance_aborts() {
    let (mut scenario, clock) = begin();

    let mandate_id = create_default_mandate(&mut scenario, &clock);
    create_vault_for(&mut scenario, mandate_id);
    set_cap_as_owner(&mut scenario);
    deposit_a_as_owner(&mut scenario, 1_000);

    scenario.next_tx(OWNER);
    {
        let mut vault = scenario.take_shared<MultiAssetVault<StubAccountCap>>();
        let coin = navi::withdraw_idle<StubAccountCap, COIN_A>(&mut vault, 1_001, scenario.ctx());
        transfer::public_transfer(coin, OWNER);
        ts::return_shared(vault);
    };

    cleanup(scenario, clock);
}

#[test]
#[expected_failure(abort_code = suize::navi::ENoSuchAsset)]
/// Owner withdrawing an asset that was never deposited aborts `ENoSuchAsset` (no
/// idle pot exists for it).
fun test_withdraw_idle_unknown_asset_aborts() {
    let (mut scenario, clock) = begin();

    let mandate_id = create_default_mandate(&mut scenario, &clock);
    create_vault_for(&mut scenario, mandate_id);
    set_cap_as_owner(&mut scenario);
    deposit_a_as_owner(&mut scenario, 1_000); // only A funded.

    scenario.next_tx(OWNER);
    {
        let mut vault = scenario.take_shared<MultiAssetVault<StubAccountCap>>();
        // B has no idle pot → ENoSuchAsset.
        let coin = navi::withdraw_idle<StubAccountCap, COIN_B>(&mut vault, 1, scenario.ctx());
        transfer::public_transfer(coin, OWNER);
        ts::return_shared(vault);
    };

    cleanup(scenario, clock);
}

// ============================================================================
// C2 — WITHDRAW-TICKET ASSET/VALUE BIND (the cage-escape fix)
// ============================================================================
//
// These drive the REAL `agent_withdraw_request` + `agent_absorb_withdrawn`
// directly (not the `*_stub`, which always mints a MATCHING-type, exact-value
// coin and so cannot express the attack). The threat: the agent requests a
// withdraw of A (NAVI hands back real `Coin<A>`), then discharges the no-abilities
// ticket with a WRONG-TYPE or SHORT coin while pocketing the real funds.

#[test]
#[expected_failure(abort_code = suize::navi::ETicketAssetMismatch)]
/// THE TYPE-BIND PROOF (C2): a ticket minted for COIN_A cannot be discharged with a
/// `Coin<COIN_B>`. Supply A (so the `supplied` ledger has it), request a withdraw of
/// A to get a real ticket, then try to absorb a COIN_B coin (the "wrong-type junk"
/// the agent would substitute) → `ETicketAssetMismatch`.
fun test_absorb_wrong_asset_aborts() {
    let (mut scenario, clock) = begin();

    let mandate_id = create_default_mandate(&mut scenario, &clock);
    create_vault_for(&mut scenario, mandate_id);
    fund_vault(&mut scenario);
    issue_cap_to_agent(&mut scenario);

    scenario.next_tx(AGENT);
    {
        let mut vault = scenario.take_shared<MultiAssetVault<StubAccountCap>>();
        let mut mandate = scenario.take_shared<Mandate>();
        let cap = scenario.take_from_sender<AgentCap>();

        // Supply 300 A so the supplied-ledger has COIN_A.
        navi::agent_supply_stub<StubAccountCap, COIN_A>(
            &mut vault, &mut mandate, &cap,
            SCOPE_SUPPLY, ASSET_ID_A, 300, &clock, scenario.ctx(),
        );
        // Request a real ticket for 250 A.
        let ticket = navi::agent_withdraw_request<StubAccountCap, COIN_A>(
            &mut vault, &mut mandate, &cap,
            SCOPE_WITHDRAW, ASSET_ID_A, 250, &clock,
        );
        // The attack: discharge the A-ticket with a COIN_B coin → ETicketAssetMismatch.
        let junk = coin::mint_for_testing<COIN_B>(250, scenario.ctx());
        navi::agent_absorb_withdrawn<StubAccountCap, COIN_B>(&mut vault, ticket, junk);

        scenario.return_to_sender(cap);
        ts::return_shared(mandate);
        ts::return_shared(vault);
    };

    cleanup(scenario, clock);
}

#[test]
#[expected_failure(abort_code = suize::navi::ETicketUndervalued)]
/// THE VALUE-BIND PROOF (C2): even with the RIGHT type, a ticket for 250 A cannot be
/// discharged with a coin worth less than 250 — here a `coin::zero<COIN_A>()` (the
/// degenerate "keep the redeemed principal, hand back nothing" attack) → it has the
/// right type but value 0 < 250 → `ETicketUndervalued`.
fun test_absorb_undervalued_coin_aborts() {
    let (mut scenario, clock) = begin();

    let mandate_id = create_default_mandate(&mut scenario, &clock);
    create_vault_for(&mut scenario, mandate_id);
    fund_vault(&mut scenario);
    issue_cap_to_agent(&mut scenario);

    scenario.next_tx(AGENT);
    {
        let mut vault = scenario.take_shared<MultiAssetVault<StubAccountCap>>();
        let mut mandate = scenario.take_shared<Mandate>();
        let cap = scenario.take_from_sender<AgentCap>();

        navi::agent_supply_stub<StubAccountCap, COIN_A>(
            &mut vault, &mut mandate, &cap,
            SCOPE_SUPPLY, ASSET_ID_A, 300, &clock, scenario.ctx(),
        );
        let ticket = navi::agent_withdraw_request<StubAccountCap, COIN_A>(
            &mut vault, &mut mandate, &cap,
            SCOPE_WITHDRAW, ASSET_ID_A, 250, &clock,
        );
        // Right TYPE, value 0 < 250 → ETicketUndervalued.
        let short = coin::zero<COIN_A>(scenario.ctx());
        navi::agent_absorb_withdrawn<StubAccountCap, COIN_A>(&mut vault, ticket, short);

        scenario.return_to_sender(cap);
        ts::return_shared(mandate);
        ts::return_shared(vault);
    };

    cleanup(scenario, clock);
}
