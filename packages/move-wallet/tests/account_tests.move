#[test_only]
/// Tests for `suize::account` — the irreducible core (PAY + CHARGE) under the
/// OWNER-ONLY authority model, with fee policy in the SUIZE-controlled shared
/// `RailConfig` (not on the Account).
///
/// Headline guarantees under test:
///   PAY    — `spend` is OWNER-ONLY (the user's own LOCAL zkLogin session signs),
///            capped by the balance, a FREE transfer (no fee — the full amount
///            lands with the payee, the treasury gets nothing).
///   CHARGE — `charge` / `charge_subscription` / `pay` take the fee, RESOLVED from
///            the shared `RailConfig`: a merchant override if set, else the rail
///            default (2%). `charge_subscription` is owner-approved-once, then
///            permissionless but time-gated + per-period-capped.
///   FEE    — policy is SUIZE's: the rate + recipient live in one shared
///            `RailConfig`, mutated ONLY via the `RailAdminCap` (possession-is-auth,
///            so a non-admin simply cannot call the setters).
///
/// There is NO agent and NO on-chain pause: spending requires the owner's own
/// signature, so there is no agent identity to resolve and no kill switch to flip.
///
/// As with the other suites in this package, abort-code constants are NOT imported
/// as aliases — `#[expected_failure(abort_code = ...)]` references them by
/// fully-qualified path, so importing them would only yield "unused alias"
/// warnings.
module suize::account_tests;

use suize::account::{Self, Account, RailConfig, RailAdminCap};
use sui::clock::{Self, Clock};
use sui::coin::{Self, Coin};
use sui::event;
use sui::test_scenario::{Self as ts, Scenario};

// === Test coin type ===
// A bare witness type to instantiate `Coin<TUSD>` / `Account<TUSD>` (stands in
// for USDC). `has drop` so the empty witness can be discarded; balances are
// fabricated with `coin::mint_for_testing`, so no TreasuryCap is needed.
public struct TUSD has drop {}

// === Test actors ===
const OWNER: address = @0xA;       // the Account owner + (here) the rail publisher/admin
const STRANGER: address = @0xC;
const PAYEE: address = @0xD;
const TREASURY: address = @0xE;    // the rail fee_recipient (RailConfig)
const BACKEND: address = @0xF;     // the (permissionless) subscription charger
const MERCHANT: address = @0xB;    // a CHARGE recipient (`charge` / `pay` payee)

// === Test fixtures ===
// Funded large enough to cover several full PERIOD_CAP charges so that, in the
// charge tests, the per-period cap (not the balance) is the binding constraint.
const DEPOSIT: u64 = 100_000_000; // 100 USDC at 6 decimals
const FEE_BPS: u64 = 200; // 2% — the default
const DISCOUNT_BPS: u64 = 50; // 0.5% — a per-merchant override
const PERIOD_MS: u64 = 30 * 24 * 60 * 60 * 1_000; // ~30 days
const PERIOD_CAP: u64 = 19_990_000; // ~$19.99 at 6 decimals (Deploy sub)

// === Helpers ===

/// Start a scenario as OWNER (who is also the rail publisher/admin here), publish
/// the rail (`init_for_testing` → shared `RailConfig` + `RailAdminCap` to OWNER),
/// then set the fee_recipient to TREASURY. Clock fixed at t=0.
fun begin(): (Scenario, Clock) {
    let mut scenario = ts::begin(OWNER);
    let clock = clock::create_for_testing(scenario.ctx());

    // Publish the rail: shares the RailConfig, sends the RailAdminCap to OWNER.
    scenario.next_tx(OWNER);
    account::init_for_testing(scenario.ctx());

    // Point the rail fee_recipient at TREASURY (default after init is the publisher).
    scenario.next_tx(OWNER);
    {
        let cap = scenario.take_from_sender<RailAdminCap>();
        let mut config = scenario.take_shared<RailConfig>();
        account::set_fee_recipient(&cap, &mut config, TREASURY);
        ts::return_shared(config);
        scenario.return_to_sender(cap);
    };

    (scenario, clock)
}

fun cleanup(scenario: Scenario, clock: Clock) {
    clock::destroy_for_testing(clock);
    scenario.end();
}

/// As OWNER, set a per-merchant rate override on the shared `RailConfig`.
fun set_merchant_rate_as_admin(scenario: &mut Scenario, merchant: address, bps: u16) {
    scenario.next_tx(OWNER);
    let cap = scenario.take_from_sender<RailAdminCap>();
    let mut config = scenario.take_shared<RailConfig>();
    account::set_merchant_rate(&cap, &mut config, merchant, bps);
    ts::return_shared(config);
    scenario.return_to_sender(cap);
}

/// As OWNER, create + share an Account<TUSD>. The fee policy is NOT set here — it
/// lives in the shared `RailConfig`.
fun create_account_as_owner(scenario: &mut Scenario) {
    scenario.next_tx(OWNER);
    account::create_account<TUSD>(scenario.ctx());
}

/// Deposit `amount` of freshly-minted TUSD into the account, sent by `from`.
fun deposit_as(scenario: &mut Scenario, from: address, amount: u64) {
    scenario.next_tx(from);
    let mut account = scenario.take_shared<Account<TUSD>>();
    let coin = coin::mint_for_testing<TUSD>(amount, scenario.ctx());
    account::deposit<TUSD>(&mut account, coin, scenario.ctx());
    ts::return_shared(account);
}

/// Standard arrangement: account + deposit. Spending is owner-only — no agent setup.
fun arrange_funded(scenario: &mut Scenario) {
    create_account_as_owner(scenario);
    deposit_as(scenario, OWNER, DEPOSIT);
}

/// Have `who` call `spend(amount → payee)`. Centralizes the take/return of the
/// shared Account. The `clock` is the scenario-local fixture (never shared).
fun spend_as(scenario: &mut Scenario, clock: &Clock, who: address, amount: u64, payee: address) {
    scenario.next_tx(who);
    let mut account = scenario.take_shared<Account<TUSD>>();
    account::spend<TUSD>(&mut account, amount, payee, b"x", clock, scenario.ctx());
    ts::return_shared(account);
}

/// Assert a Coin of `amount` is held by `who`, then burn it.
fun assert_and_burn_coin_of(scenario: &mut Scenario, who: address, amount: u64) {
    scenario.next_tx(who);
    let coin = scenario.take_from_sender<Coin<TUSD>>();
    assert!(coin::value(&coin) == amount, 0xFEE);
    coin::burn_for_testing(coin);
}

/// Have `who` call `charge(config, amount → merchant)` (the one-off owner CHARGE).
fun charge_as(
    scenario: &mut Scenario,
    clock: &Clock,
    who: address,
    amount: u64,
    merchant: address,
) {
    scenario.next_tx(who);
    let mut account = scenario.take_shared<Account<TUSD>>();
    let config = scenario.take_shared<RailConfig>();
    account::charge<TUSD>(&mut account, &config, merchant, amount, b"x", clock, scenario.ctx());
    ts::return_shared(config);
    ts::return_shared(account);
}

/// Have `who` call `pay(merchant, config, coin)` with a freshly-minted `amount`
/// coin (the permissionless raw-payer facilitator). The merchant is a PLAIN
/// address — no Account exists on either side ("your address is your account").
fun pay_as(scenario: &mut Scenario, clock: &Clock, who: address, amount: u64, merchant: address) {
    scenario.next_tx(who);
    let config = scenario.take_shared<RailConfig>();
    let coin = coin::mint_for_testing<TUSD>(amount, scenario.ctx());
    account::pay<TUSD>(merchant, &config, coin, b"x", clock, scenario.ctx());
    ts::return_shared(config);
}

/// Have BACKEND charge `sub_key` for `amount` (the permissionless terms-gated path).
fun charge_subscription_as(
    scenario: &mut Scenario,
    clock: &Clock,
    who: address,
    sub_key: u64,
    amount: u64,
) {
    scenario.next_tx(who);
    let mut account = scenario.take_shared<Account<TUSD>>();
    let config = scenario.take_shared<RailConfig>();
    account::charge_subscription<TUSD>(&mut account, &config, sub_key, amount, b"x", clock, scenario.ctx());
    ts::return_shared(config);
    ts::return_shared(account);
}

// === SUCCESS PATHS ===

#[test]
/// Owner lifecycle: create → deposit (by anyone) → withdraw. Balance tracks
/// exactly, and the withdrawn Coin lands with the owner. Fee config now lives on the
/// RailConfig (asserted separately in the fee tests), not the Account.
fun test_create_deposit_withdraw() {
    let (mut scenario, clock) = begin();

    create_account_as_owner(&mut scenario);
    // A third party (STRANGER) can top up — deposit is permissionless.
    deposit_as(&mut scenario, STRANGER, DEPOSIT);

    scenario.next_tx(OWNER);
    {
        let account = scenario.take_shared<Account<TUSD>>();
        assert!(account::balance_value<TUSD>(&account) == DEPOSIT, 0);
        assert!(account::owner<TUSD>(&account) == OWNER, 1);
        ts::return_shared(account);
    };

    // The rail config carries the fee policy: 2% default → TREASURY.
    scenario.next_tx(OWNER);
    {
        let config = scenario.take_shared<RailConfig>();
        assert!(account::default_fee_bps(&config) == 200, 2);
        assert!(account::fee_recipient(&config) == TREASURY, 3);
        ts::return_shared(config);
    };

    // Owner withdraws part of the balance back to a Coin.
    scenario.next_tx(OWNER);
    {
        let mut account = scenario.take_shared<Account<TUSD>>();
        let coin = account::withdraw<TUSD>(&mut account, 400_000, scenario.ctx());
        assert!(coin::value(&coin) == 400_000, 4);
        assert!(account::balance_value<TUSD>(&account) == DEPOSIT - 400_000, 5);
        transfer::public_transfer(coin, OWNER);
        ts::return_shared(account);
    };

    assert_and_burn_coin_of(&mut scenario, OWNER, 400_000);

    cleanup(scenario, clock);
}

#[test]
/// The PAY primitive is a FREE transfer (founder decision — Revolut-style free
/// sends): a single owner `spend` debits exactly `amount` and pays the FULL `amount`
/// to the payee. NO fee is taken — the treasury gets NOTHING on `spend`.
fun test_spend_is_free_pays_full_amount() {
    let (mut scenario, clock) = begin();
    arrange_funded(&mut scenario);

    let amount = 100_000;

    spend_as(&mut scenario, &clock, OWNER, amount, PAYEE);

    scenario.next_tx(OWNER);
    {
        let account = scenario.take_shared<Account<TUSD>>();
        // Exactly `amount` left the balance (no extra fee debit).
        assert!(account::balance_value<TUSD>(&account) == DEPOSIT - amount, 0);
        ts::return_shared(account);
    };

    // Payee received the FULL amount (free transfer — fee = 0, net = amount).
    assert_and_burn_coin_of(&mut scenario, PAYEE, amount);

    // The treasury received NOTHING on spend: it holds no Coin<TUSD> at all.
    scenario.next_tx(TREASURY);
    assert!(!ts::has_most_recent_for_sender<Coin<TUSD>>(&scenario), 1);

    cleanup(scenario, clock);
}

#[test]
/// CHARGE happy path: owner creates a subscription; after one full period the
/// backend charges it. Fee split applies at the rail DEFAULT (2%); the FIXED payee is
/// paid; the window advances to `now`. (Charge is permissionless + terms-gated.)
fun test_create_and_charge_subscription_after_period() {
    let (mut scenario, mut clock) = begin();
    create_account_as_owner(&mut scenario);
    deposit_as(&mut scenario, OWNER, DEPOSIT);

    // OWNER approves the subscription at t=0 (last_charged_ms := 0).
    let sub_key;
    scenario.next_tx(OWNER);
    {
        let mut account = scenario.take_shared<Account<TUSD>>();
        sub_key = account::create_subscription<TUSD>(
            &mut account,
            PAYEE,
            PERIOD_CAP,
            PERIOD_MS,
            &clock,
            scenario.ctx(),
        );
        assert!(account::has_subscription<TUSD>(&account, sub_key), 0);
        let (p, cap, per, last) = account::subscription_info<TUSD>(&account, sub_key);
        assert!(p == PAYEE, 1);
        assert!(cap == PERIOD_CAP, 2);
        assert!(per == PERIOD_MS, 3);
        assert!(last == 0, 4);
        ts::return_shared(account);
    };

    // Advance to exactly one period later (the bound is `>=`, so == succeeds).
    clock.set_for_testing(PERIOD_MS);

    let amount = PERIOD_CAP;
    let fee = (amount * FEE_BPS) / 10_000;
    let net = amount - fee;

    // BACKEND (not the owner) charges it — permissionless trigger.
    charge_subscription_as(&mut scenario, &clock, BACKEND, sub_key, amount);

    scenario.next_tx(OWNER);
    {
        let account = scenario.take_shared<Account<TUSD>>();
        assert!(account::balance_value<TUSD>(&account) == DEPOSIT - amount, 5);
        // Window advanced to `now`.
        let (_, _, _, last) = account::subscription_info<TUSD>(&account, sub_key);
        assert!(last == PERIOD_MS, 6);
        ts::return_shared(account);
    };

    assert_and_burn_coin_of(&mut scenario, PAYEE, net);
    assert_and_burn_coin_of(&mut scenario, TREASURY, fee);

    cleanup(scenario, clock);
}

#[test]
/// PER-MERCHANT DISCOUNT on the recurring path: admin sets the subscription PAYEE's
/// rate to 0.5%; `charge_subscription` then splits 0.5%, not the 2% default.
fun test_charge_subscription_uses_merchant_override() {
    let (mut scenario, mut clock) = begin();
    create_account_as_owner(&mut scenario);
    deposit_as(&mut scenario, OWNER, DEPOSIT);

    // Discount the PAYEE (the subscription's fixed merchant) to 0.5%.
    set_merchant_rate_as_admin(&mut scenario, PAYEE, DISCOUNT_BPS as u16);

    let sub_key;
    scenario.next_tx(OWNER);
    {
        let mut account = scenario.take_shared<Account<TUSD>>();
        sub_key = account::create_subscription<TUSD>(
            &mut account, PAYEE, PERIOD_CAP, PERIOD_MS, &clock, scenario.ctx(),
        );
        ts::return_shared(account);
    };

    clock.set_for_testing(PERIOD_MS);

    let amount = PERIOD_CAP;
    let fee = (amount * DISCOUNT_BPS) / 10_000; // 0.5%, NOT 2%
    let net = amount - fee;

    charge_subscription_as(&mut scenario, &clock, BACKEND, sub_key, amount);

    assert_and_burn_coin_of(&mut scenario, PAYEE, net);
    assert_and_burn_coin_of(&mut scenario, TREASURY, fee);

    cleanup(scenario, clock);
}

#[test]
/// The `Charged` receipt carries the caller's memo (the relayer's paymentId — what
/// makes a recurring debit /verify-matchable, mirroring `ChargePaid` / `Paid`).
/// Asserted field-for-field: the FIXED payee, the exact split, the memo, and the
/// charge-time timestamp; reserved trace fields empty.
fun test_charge_subscription_memo_lands_in_receipt() {
    let (mut scenario, mut clock) = begin();
    create_account_as_owner(&mut scenario);
    deposit_as(&mut scenario, OWNER, DEPOSIT);

    let sub_key;
    scenario.next_tx(OWNER);
    {
        let mut account = scenario.take_shared<Account<TUSD>>();
        sub_key = account::create_subscription<TUSD>(
            &mut account, PAYEE, PERIOD_CAP, PERIOD_MS, &clock, scenario.ctx(),
        );
        ts::return_shared(account);
    };

    clock.set_for_testing(PERIOD_MS);

    let amount = PERIOD_CAP;
    let fee = (amount * FEE_BPS) / 10_000;
    let net = amount - fee;

    // Charge inline (not via the helper) so the memo is this test's own paymentId.
    let account_id;
    scenario.next_tx(BACKEND);
    {
        let mut account = scenario.take_shared<Account<TUSD>>();
        let config = scenario.take_shared<RailConfig>();
        account_id = object::id(&account);
        account::charge_subscription<TUSD>(
            &mut account, &config, sub_key, amount, b"sub_pmt_7", &clock, scenario.ctx(),
        );
        ts::return_shared(config);
        ts::return_shared(account);
    };

    // Exactly one Charged receipt, every field as approved (incl. the memo).
    let receipts = event::events_by_type<account::Charged>();
    assert!(receipts.length() == 1, 0);
    assert!(
        receipts[0] == account::charged_event_for_testing(
            account_id, sub_key, PAYEE, amount, fee, net, b"sub_pmt_7", PERIOD_MS,
        ),
        1,
    );

    cleanup(scenario, clock);
}

#[test]
/// Two consecutive periods each allow exactly one charge. Proves the anti-drift
/// advance-to-now keeps a steady cadence across periods.
fun test_charge_subscription_two_periods() {
    let (mut scenario, mut clock) = begin();
    create_account_as_owner(&mut scenario);
    deposit_as(&mut scenario, OWNER, DEPOSIT);

    let sub_key;
    scenario.next_tx(OWNER);
    {
        let mut account = scenario.take_shared<Account<TUSD>>();
        sub_key = account::create_subscription<TUSD>(
            &mut account, PAYEE, PERIOD_CAP, PERIOD_MS, &clock, scenario.ctx(),
        );
        ts::return_shared(account);
    };

    let amount = 10_000_000;

    // Period 1: charge at t = PERIOD_MS.
    clock.set_for_testing(PERIOD_MS);
    charge_subscription_as(&mut scenario, &clock, BACKEND, sub_key, amount);

    // Period 2: charge at t = 2 * PERIOD_MS.
    clock.set_for_testing(2 * PERIOD_MS);
    charge_subscription_as(&mut scenario, &clock, BACKEND, sub_key, amount);

    scenario.next_tx(OWNER);
    {
        let account = scenario.take_shared<Account<TUSD>>();
        assert!(account::balance_value<TUSD>(&account) == DEPOSIT - 2 * amount, 0);
        let (_, _, _, last) = account::subscription_info<TUSD>(&account, sub_key);
        assert!(last == 2 * PERIOD_MS, 1);
        ts::return_shared(account);
    };

    cleanup(scenario, clock);
}

#[test]
/// Owner can cancel a subscription; afterwards the child field is gone.
fun test_cancel_subscription() {
    let (mut scenario, clock) = begin();
    create_account_as_owner(&mut scenario);
    deposit_as(&mut scenario, OWNER, DEPOSIT);

    let sub_key;
    scenario.next_tx(OWNER);
    {
        let mut account = scenario.take_shared<Account<TUSD>>();
        sub_key = account::create_subscription<TUSD>(
            &mut account, PAYEE, PERIOD_CAP, PERIOD_MS, &clock, scenario.ctx(),
        );
        ts::return_shared(account);
    };

    scenario.next_tx(OWNER);
    {
        let mut account = scenario.take_shared<Account<TUSD>>();
        assert!(account::has_subscription<TUSD>(&account, sub_key), 0);
        account::cancel_subscription<TUSD>(&mut account, sub_key, scenario.ctx());
        assert!(!account::has_subscription<TUSD>(&account, sub_key), 1);
        ts::return_shared(account);
    };

    cleanup(scenario, clock);
}

#[test]
/// CHARGE one-off happy path at the DEFAULT rate: the owner `charge`s a funded
/// Account to pay a MERCHANT. Unlike `spend` (free), the 2% fee IS taken — `fee` →
/// TREASURY, `net = amount - fee` → MERCHANT. Exact fee math is asserted.
fun test_charge_one_off_splits_default_fee() {
    let (mut scenario, clock) = begin();
    arrange_funded(&mut scenario);

    let amount = 1_000_000;
    let fee = (amount * FEE_BPS) / 10_000; // 20_000
    let net = amount - fee; // 980_000

    charge_as(&mut scenario, &clock, OWNER, amount, MERCHANT);

    scenario.next_tx(OWNER);
    {
        let account = scenario.take_shared<Account<TUSD>>();
        assert!(account::balance_value<TUSD>(&account) == DEPOSIT - amount, 0);
        ts::return_shared(account);
    };

    // Merchant got the net; treasury got the fee (sum == gross — no leakage).
    assert_and_burn_coin_of(&mut scenario, MERCHANT, net);
    assert_and_burn_coin_of(&mut scenario, TREASURY, fee);

    cleanup(scenario, clock);
}

#[test]
/// PER-MERCHANT DISCOUNT on the one-off path: admin sets MERCHANT's rate to 0.5%;
/// `charge` then splits 0.5%, not the 2% default.
fun test_charge_one_off_uses_merchant_override() {
    let (mut scenario, clock) = begin();
    arrange_funded(&mut scenario);

    // Discount MERCHANT to 0.5%.
    set_merchant_rate_as_admin(&mut scenario, MERCHANT, DISCOUNT_BPS as u16);

    let amount = 1_000_000;
    let fee = (amount * DISCOUNT_BPS) / 10_000; // 5_000 (0.5%)
    let net = amount - fee; // 995_000

    charge_as(&mut scenario, &clock, OWNER, amount, MERCHANT);

    // Merchant got the discounted net; treasury got the smaller fee.
    assert_and_burn_coin_of(&mut scenario, MERCHANT, net);
    assert_and_burn_coin_of(&mut scenario, TREASURY, fee);

    cleanup(scenario, clock);
}

#[test]
/// PAY (open facilitator) happy path at the DEFAULT rate: an ARBITRARY sender
/// (STRANGER, NOT the owner — proving permissionless) pays a NEVER-SEEN plain
/// address with a raw minted coin. NO Account exists on EITHER side — "your
/// address is your account." The fee is read from the rail config: `fee` →
/// TREASURY, `net` → the merchant address.
fun test_pay_open_facilitator_splits_default_fee() {
    let (mut scenario, clock) = begin();
    // Deliberately NO create_account anywhere — the merchant is just an address.

    let amount = 1_000_000;
    let fee = (amount * FEE_BPS) / 10_000; // 20_000
    let net = amount - fee; // 980_000

    pay_as(&mut scenario, &clock, STRANGER, amount, MERCHANT);

    // MERCHANT (a plain address, no Account) got the net; treasury got the fee.
    assert_and_burn_coin_of(&mut scenario, MERCHANT, net);
    assert_and_burn_coin_of(&mut scenario, TREASURY, fee);

    cleanup(scenario, clock);
}

#[test]
/// The `Paid` receipt carries the facilitator's full audit surface: the payer, the
/// PLAIN merchant address, the exact gross/fee/net split, and the caller's memo
/// (the paymentId /verify matches on). Asserted field-for-field against the
/// expected event — clock pinned at t=0, reserved trace fields empty.
fun test_pay_receipt_carries_memo_and_merchant_address() {
    let (mut scenario, clock) = begin();

    let amount = 1_000_000;
    let fee = (amount * FEE_BPS) / 10_000; // 20_000
    let net = amount - fee; // 980_000

    scenario.next_tx(STRANGER);
    {
        let config = scenario.take_shared<RailConfig>();
        let coin = coin::mint_for_testing<TUSD>(amount, scenario.ctx());
        account::pay<TUSD>(MERCHANT, &config, coin, b"pmt_42", &clock, scenario.ctx());
        ts::return_shared(config);
    };

    // Exactly one Paid receipt, every field as quoted (incl. memo + merchant ADDRESS).
    let receipts = event::events_by_type<account::Paid>();
    assert!(receipts.length() == 1, 0);
    assert!(
        receipts[0] == account::paid_event_for_testing(
            STRANGER, MERCHANT, amount, fee, net, b"pmt_42", 0,
        ),
        1,
    );

    cleanup(scenario, clock);
}

#[test]
/// PER-MERCHANT DISCOUNT on the `pay` path: admin discounts the MERCHANT address
/// to 0.5%; `pay` then splits 0.5%, not 2%. Still no Account anywhere — the
/// override table keys on the plain merchant address.
fun test_pay_uses_merchant_override() {
    let (mut scenario, clock) = begin();

    // The merchant paid by `pay` is the plain MERCHANT address.
    set_merchant_rate_as_admin(&mut scenario, MERCHANT, DISCOUNT_BPS as u16);

    let amount = 1_000_000;
    let fee = (amount * DISCOUNT_BPS) / 10_000; // 5_000 (0.5%)
    let net = amount - fee; // 995_000

    pay_as(&mut scenario, &clock, STRANGER, amount, MERCHANT);

    assert_and_burn_coin_of(&mut scenario, MERCHANT, net);
    assert_and_burn_coin_of(&mut scenario, TREASURY, fee);

    cleanup(scenario, clock);
}

#[test]
/// Admin lifecycle: set default rate, set a merchant override, then remove it.
/// Proves resolution: override present ⇒ override; absent ⇒ default.
fun test_admin_set_and_remove_merchant_rate() {
    let (mut scenario, clock) = begin();

    scenario.next_tx(OWNER);
    {
        let cap = scenario.take_from_sender<RailAdminCap>();
        let mut config = scenario.take_shared<RailConfig>();

        // Default resolution for an unknown merchant.
        assert!(account::merchant_fee_bps(&config, MERCHANT) == 200, 0);
        assert!(!account::has_merchant_rate(&config, MERCHANT), 1);

        // Set an override → resolution changes.
        account::set_merchant_rate(&cap, &mut config, MERCHANT, DISCOUNT_BPS as u16);
        assert!(account::has_merchant_rate(&config, MERCHANT), 2);
        assert!(account::merchant_fee_bps(&config, MERCHANT) == (DISCOUNT_BPS as u16), 3);

        // Change the rail default; the override still wins for MERCHANT.
        account::set_default_fee_bps(&cap, &mut config, 300);
        assert!(account::default_fee_bps(&config) == 300, 4);
        assert!(account::merchant_fee_bps(&config, MERCHANT) == (DISCOUNT_BPS as u16), 5);
        // A different, un-overridden merchant gets the new default.
        assert!(account::merchant_fee_bps(&config, PAYEE) == 300, 6);

        // Remove the override → MERCHANT falls back to the (new) default.
        account::remove_merchant_rate(&cap, &mut config, MERCHANT);
        assert!(!account::has_merchant_rate(&config, MERCHANT), 7);
        assert!(account::merchant_fee_bps(&config, MERCHANT) == 300, 8);

        ts::return_shared(config);
        scenario.return_to_sender(cap);
    };

    cleanup(scenario, clock);
}

// === REFUSAL PATHS (the design drivers) ===

#[test]
#[expected_failure(abort_code = suize::account::ENotOwner)]
/// A NON-OWNER (STRANGER) cannot spend — `spend` is owner-only → `ENotOwner`.
fun test_spend_by_non_owner_aborts() {
    let (mut scenario, clock) = begin();
    arrange_funded(&mut scenario);

    spend_as(&mut scenario, &clock, STRANGER, 1_000, PAYEE);

    cleanup(scenario, clock);
}

#[test]
#[expected_failure(abort_code = suize::account::EInsufficientBalance)]
/// Owner tries to spend more than the balance → `EInsufficientBalance` (the
/// balance is the only cap).
fun test_spend_over_balance_aborts() {
    let (mut scenario, clock) = begin();
    arrange_funded(&mut scenario);

    spend_as(&mut scenario, &clock, OWNER, DEPOSIT + 1, PAYEE);

    cleanup(scenario, clock);
}

#[test]
#[expected_failure(abort_code = suize::account::ENotOwner)]
/// A NON-OWNER cannot `charge` — like `spend`, the one-off CHARGE is owner-only
/// (no on-chain terms gate a one-off) → `ENotOwner`.
fun test_charge_by_non_owner_aborts() {
    let (mut scenario, clock) = begin();
    arrange_funded(&mut scenario);

    charge_as(&mut scenario, &clock, STRANGER, 1_000, MERCHANT);

    cleanup(scenario, clock);
}

#[test]
#[expected_failure(abort_code = suize::account::EInsufficientBalance)]
/// Owner charging more than the balance aborts → `EInsufficientBalance` (this
/// module's guard, asserted before any split — same as `spend`).
fun test_charge_one_off_over_balance_aborts() {
    let (mut scenario, clock) = begin();
    arrange_funded(&mut scenario);

    charge_as(&mut scenario, &clock, OWNER, DEPOSIT + 1, MERCHANT);

    cleanup(scenario, clock);
}

#[test]
#[expected_failure(abort_code = suize::account::EInvalidRate)]
/// The admin cannot set a rate above 100% (10_000 bps) → `EInvalidRate`.
fun test_set_merchant_rate_over_max_aborts() {
    let (mut scenario, clock) = begin();

    scenario.next_tx(OWNER);
    {
        let cap = scenario.take_from_sender<RailAdminCap>();
        let mut config = scenario.take_shared<RailConfig>();
        account::set_merchant_rate(&cap, &mut config, MERCHANT, 10_001);
        ts::return_shared(config);
        scenario.return_to_sender(cap);
    };

    cleanup(scenario, clock);
}

#[test]
#[expected_failure(abort_code = suize::account::EInvalidRate)]
/// The admin cannot set the default rate above 100% → `EInvalidRate`.
fun test_set_default_fee_bps_over_max_aborts() {
    let (mut scenario, clock) = begin();

    scenario.next_tx(OWNER);
    {
        let cap = scenario.take_from_sender<RailAdminCap>();
        let mut config = scenario.take_shared<RailConfig>();
        account::set_default_fee_bps(&cap, &mut config, 10_001);
        ts::return_shared(config);
        scenario.return_to_sender(cap);
    };

    cleanup(scenario, clock);
}

#[test]
#[expected_failure]
/// A NON-ADMIN (STRANGER holds no `RailAdminCap`) cannot set rates: trying to take a
/// `RailAdminCap` from a sender who has none aborts in the test framework. This
/// proves possession-is-authority — the setters are uncallable without the cap.
fun test_non_admin_cannot_set_rates() {
    let (mut scenario, clock) = begin();

    scenario.next_tx(STRANGER);
    {
        // STRANGER never received a RailAdminCap → this take aborts. Without a cap
        // there is NO way to reach `set_merchant_rate` / `set_default_fee_bps`.
        let cap = scenario.take_from_sender<RailAdminCap>();
        let mut config = scenario.take_shared<RailConfig>();
        account::set_merchant_rate(&cap, &mut config, MERCHANT, 0);
        ts::return_shared(config);
        scenario.return_to_sender(cap);
    };

    cleanup(scenario, clock);
}

#[test]
#[expected_failure(abort_code = suize::account::ENotOwner)]
/// A non-owner cannot withdraw → `ENotOwner`.
fun test_withdraw_by_non_owner_aborts() {
    let (mut scenario, clock) = begin();
    create_account_as_owner(&mut scenario);
    deposit_as(&mut scenario, OWNER, DEPOSIT);

    scenario.next_tx(STRANGER);
    {
        let mut account = scenario.take_shared<Account<TUSD>>();
        let coin = account::withdraw<TUSD>(&mut account, 1_000, scenario.ctx());
        transfer::public_transfer(coin, STRANGER);
        ts::return_shared(account);
    };

    cleanup(scenario, clock);
}

#[test]
#[expected_failure(abort_code = suize::account::EInsufficientBalance)]
/// Owner withdrawing more than the balance aborts → `EInsufficientBalance` (this
/// module's guard, not the framework split abort).
fun test_withdraw_over_balance_aborts() {
    let (mut scenario, clock) = begin();
    create_account_as_owner(&mut scenario);
    deposit_as(&mut scenario, OWNER, 1_000);

    scenario.next_tx(OWNER);
    {
        let mut account = scenario.take_shared<Account<TUSD>>();
        let coin = account::withdraw<TUSD>(&mut account, 1_001, scenario.ctx());
        transfer::public_transfer(coin, OWNER);
        ts::return_shared(account);
    };

    cleanup(scenario, clock);
}

#[test]
#[expected_failure(abort_code = suize::account::ENotOwner)]
/// A non-owner cannot create a subscription → `ENotOwner`.
fun test_create_subscription_by_non_owner_aborts() {
    let (mut scenario, clock) = begin();
    create_account_as_owner(&mut scenario);

    scenario.next_tx(STRANGER);
    {
        let mut account = scenario.take_shared<Account<TUSD>>();
        account::create_subscription<TUSD>(
            &mut account, PAYEE, PERIOD_CAP, PERIOD_MS, &clock, scenario.ctx(),
        );
        ts::return_shared(account);
    };

    cleanup(scenario, clock);
}

#[test]
#[expected_failure(abort_code = suize::account::ETooEarly)]
/// Charging BEFORE the period elapses aborts → `ETooEarly`. Created at t=0,
/// charged at t = PERIOD_MS - 1 (one ms short of the window).
fun test_charge_before_period_aborts() {
    let (mut scenario, mut clock) = begin();
    create_account_as_owner(&mut scenario);
    deposit_as(&mut scenario, OWNER, DEPOSIT);

    let sub_key;
    scenario.next_tx(OWNER);
    {
        let mut account = scenario.take_shared<Account<TUSD>>();
        sub_key = account::create_subscription<TUSD>(
            &mut account, PAYEE, PERIOD_CAP, PERIOD_MS, &clock, scenario.ctx(),
        );
        ts::return_shared(account);
    };

    clock.set_for_testing(PERIOD_MS - 1);
    charge_subscription_as(&mut scenario, &clock, BACKEND, sub_key, 1_000);

    cleanup(scenario, clock);
}

#[test]
#[expected_failure(abort_code = suize::account::EOverPeriodCap)]
/// Charging MORE than the per-period cap aborts → `EOverPeriodCap`, even after the
/// period has elapsed and the balance would cover it.
fun test_charge_over_period_cap_aborts() {
    let (mut scenario, mut clock) = begin();
    create_account_as_owner(&mut scenario);
    deposit_as(&mut scenario, OWNER, DEPOSIT);

    let sub_key;
    scenario.next_tx(OWNER);
    {
        let mut account = scenario.take_shared<Account<TUSD>>();
        sub_key = account::create_subscription<TUSD>(
            &mut account, PAYEE, PERIOD_CAP, PERIOD_MS, &clock, scenario.ctx(),
        );
        ts::return_shared(account);
    };

    clock.set_for_testing(PERIOD_MS);
    // PERIOD_CAP + 1 exceeds the ceiling (balance is far larger).
    charge_subscription_as(&mut scenario, &clock, BACKEND, sub_key, PERIOD_CAP + 1);

    cleanup(scenario, clock);
}

#[test]
#[expected_failure(abort_code = suize::account::ETooEarly)]
/// DOUBLE-CHARGE within a period aborts → `ETooEarly`. First charge at t=PERIOD_MS
/// succeeds (advancing the window to PERIOD_MS); a second charge in the SAME period
/// (t = PERIOD_MS + 1) is one full period too early.
fun test_double_charge_within_period_aborts() {
    let (mut scenario, mut clock) = begin();
    create_account_as_owner(&mut scenario);
    deposit_as(&mut scenario, OWNER, DEPOSIT);

    let sub_key;
    scenario.next_tx(OWNER);
    {
        let mut account = scenario.take_shared<Account<TUSD>>();
        sub_key = account::create_subscription<TUSD>(
            &mut account, PAYEE, PERIOD_CAP, PERIOD_MS, &clock, scenario.ctx(),
        );
        ts::return_shared(account);
    };

    // First charge succeeds at t = PERIOD_MS.
    clock.set_for_testing(PERIOD_MS);
    charge_subscription_as(&mut scenario, &clock, BACKEND, sub_key, 1_000);

    // Second charge, same period (now < last_charged_ms + period_ms) → ETooEarly.
    clock.set_for_testing(PERIOD_MS + 1);
    charge_subscription_as(&mut scenario, &clock, BACKEND, sub_key, 1_000);

    cleanup(scenario, clock);
}

#[test]
#[expected_failure(abort_code = suize::account::ESubscriptionNotFound)]
/// Charging a non-existent subscription key aborts → `ESubscriptionNotFound`.
fun test_charge_missing_subscription_aborts() {
    let (mut scenario, mut clock) = begin();
    create_account_as_owner(&mut scenario);
    deposit_as(&mut scenario, OWNER, DEPOSIT);

    clock.set_for_testing(PERIOD_MS);
    // Key 999 was never created.
    charge_subscription_as(&mut scenario, &clock, BACKEND, 999, 1_000);

    cleanup(scenario, clock);
}

#[test]
#[expected_failure(abort_code = suize::account::ESubscriptionNotFound)]
/// Cancelling a non-existent subscription aborts → `ESubscriptionNotFound`.
fun test_cancel_missing_subscription_aborts() {
    let (mut scenario, clock) = begin();
    create_account_as_owner(&mut scenario);

    scenario.next_tx(OWNER);
    {
        let mut account = scenario.take_shared<Account<TUSD>>();
        account::cancel_subscription<TUSD>(&mut account, 0, scenario.ctx());
        ts::return_shared(account);
    };

    cleanup(scenario, clock);
}

#[test]
#[expected_failure(abort_code = suize::account::ENotOwner)]
/// A non-owner cannot cancel a subscription → `ENotOwner`.
fun test_cancel_subscription_by_non_owner_aborts() {
    let (mut scenario, clock) = begin();
    create_account_as_owner(&mut scenario);
    deposit_as(&mut scenario, OWNER, DEPOSIT);

    let sub_key;
    scenario.next_tx(OWNER);
    {
        let mut account = scenario.take_shared<Account<TUSD>>();
        sub_key = account::create_subscription<TUSD>(
            &mut account, PAYEE, PERIOD_CAP, PERIOD_MS, &clock, scenario.ctx(),
        );
        ts::return_shared(account);
    };

    scenario.next_tx(STRANGER);
    {
        let mut account = scenario.take_shared<Account<TUSD>>();
        account::cancel_subscription<TUSD>(&mut account, sub_key, scenario.ctx());
        ts::return_shared(account);
    };

    cleanup(scenario, clock);
}

#[test]
#[expected_failure(abort_code = suize::account::EInsufficientBalance)]
/// A charge within the cap + after the period but exceeding the BALANCE aborts →
/// `EInsufficientBalance`. Fund with a small balance, set a large cap, then try to
/// charge more than the balance.
fun test_charge_over_balance_aborts() {
    let (mut scenario, mut clock) = begin();

    create_account_as_owner(&mut scenario);
    deposit_as(&mut scenario, OWNER, 5_000); // small balance

    let sub_key;
    scenario.next_tx(OWNER);
    {
        let mut account = scenario.take_shared<Account<TUSD>>();
        // Cap is large so the balance is the binding constraint.
        sub_key = account::create_subscription<TUSD>(
            &mut account, PAYEE, 1_000_000, PERIOD_MS, &clock, scenario.ctx(),
        );
        ts::return_shared(account);
    };

    clock.set_for_testing(PERIOD_MS);
    // 10_000 <= cap (passes cap), but > balance(5_000) → EInsufficientBalance.
    charge_subscription_as(&mut scenario, &clock, BACKEND, sub_key, 10_000);

    cleanup(scenario, clock);
}
