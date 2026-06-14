# move-wallet — `account.move` (RETIRED from production — historical artifact)

> **RETIRED — DO NOT BUILD ON THIS (2026-06-12).** `account.move` is **retired from production: no mainnet publish, ever.** The live Suize rail is **vanilla x402 V2 'exact' over Sui's protocol-level gasless Address-Balance transfers** (the global picture + the rail standard live in the root `CLAUDE.md`), and the recurring half is the standalone **`packages/move-subs`** Party-object module. `account.move` survives ONLY as (a) the **testnet artifact** (published 2026-06-10; the on-chain objects are orphaned-harmless — nothing in v1 references them) and (b) the **AP2 issue #118 reference design** (on-chain mandate verification — proof-of-capability, not shipped). `RailConfig` / the four-verb model / the pull-relayer subscriptions described below are **NOT the production rail.** Everything from §1 down is preserved verbatim as the historical record of what was built and tested; read it as history, not as the current architecture.
>
> The single source of truth for the RETIRED `Account<USDC>` rail: the `Account<USDC>` object, the `Subscription` child, the four payment verbs, the fee mechanics, the abort-code contract, and the lifecycle (deposit / withdraw / cancel / kill). The global picture — what Suize is, the two-primitive law, custody posture, the live off-chain surface — lives in the root `CLAUDE.md`; this file owns only the (now-retired) chain artifact. House style: state each fact once, reference don't redeclare.
>
> **Package:** `suize` (`edition = "2024"`), module `suize::account` at `sources/account.move`. Framework-only build (`sui move build` + `sui move test` green; **30 `account` unit tests**, 100 total across the package). **PUBLISHED ON TESTNET 2026-06-10** — a republish carrying the two owner-approved amendments (`pay()` takes a plain `merchant: address`; `charge_subscription` carries a `memo` into `Charged`), superseding the earlier `0x9f4027e9…` testnet publish: package `0x789bf9…`, the `init`-shared `RailConfig` `0x8a8ecf…` captured, `RailAdminCap` + `UpgradeCap` held by the dev publisher wallet (full ids live ONLY in `@suize/shared`). Mainnet stays `0x0` — **the MAINNET publish remains the v1 gate.** The directory is named `move-wallet` for historical reasons but this is **THE RAIL**, not "the wallet" (the wallet app is just one consumer of it). A rename to `move-account` / `move-rail` is a future cleanup — do NOT rename now (it would churn package ids, imports, and `@suize/shared`).
>
> **Fee policy is SUIZE's, not the user's** (refactor): the take-rate no longer lives on the `Account`. It lives in ONE Suize-controlled shared `RailConfig` (a coin-agnostic, non-generic object), mutated only via the `RailAdminCap`. This closes two holes the per-Account `fee_bps` had: a merchant zeroing their own rate, and the inability to grant a specific merchant a discount. See §1b.

---

## 1. The struct

```move
public struct Account<phantom T> has key {
    id: UID,
    balance: Balance<T>,        // spendable funds — THIS balance IS the hard cap
    owner: address,             // authority root for every owner-only fn (incl. spend, charge)
    next_sub_id: u64,           // monotonic counter handing out subscription keys; never reused
}
```

- `Account<phantom T>` is **generic over one coin type**, instantiated as `Account<USDC>` in production (see the USDC type id in `CLAUDE.md`). Generic so the unit tests can fabricate a throwaway coin with zero external deps, and so the door stays open for other settlement coins without reshaping the object. `phantom` because `T` appears only inside `Balance<T>` (which carries its own type witness) — the `Account` itself needs no runtime `T` value.
- **The Account no longer carries `fee_bps` / `fee_recipient`** (refactor). Fee policy moved OFF the Account into the shared `RailConfig` (§1b) — a merchant must not be able to set their own rate. `create_account` therefore takes **no** `fee_recipient` argument anymore; `create_account_with_fee` is **removed**.
- **`Account` is a SHARED object.** Rationale — *shared ONLY because the relayer must deduct subscriptions without the owner signing*: `charge_subscription` (the permissionless recurring rail) and `deposit` (anyone tops up) must be callable in transactions the owner does not co-sign. (`pay` no longer touches ANY Account — see ④.) If subscriptions did not exist, this could be an owned object. Owner-only paths (`spend` / `charge` / `withdraw` / sub create+cancel) assert `sender == owner` regardless of the object being shared.
- **`balance` IS the cap.** There is no separate budget. Funding (`deposit`) raises the cap; `withdraw` to zero is the owner's hard stop.

### What this struct explicitly is NOT (anti-drift)

There is **no** `agent` field, **no** `set_agent`, **no** on-chain agent identity, **no** `paused` field, **no** `budget` / `scope` / `payee-allow-list` / `expiry`, and (now) **no `fee_bps` / `fee_recipient`** — the rate is the rail's, in `RailConfig`. Spending is OWNER-ONLY — the owner's own LOCAL zkLogin session signs (the backend never signs; see `CLAUDE.md` custody posture). Nothing can move funds without the owner's signature, so there is no standing authority to revoke and no on-chain kill switch is needed. The kill story (disarm the PAY app's Agent-enabled toggle — or stop a dev-side MCP — plus `withdraw`) is in `CLAUDE.md`; the on-chain fact is simply: no owner signature → no `spend`/`charge`.

---

## 1b. The fee policy — `RailConfig` + `RailAdminCap` (Suize-owned, per-merchant)

```move
public struct RailConfig has key {           // SHARED, NON-generic (fee policy is coin-agnostic)
    id: UID,
    default_fee_bps: u16,                     // rate for any merchant without an override (200 = 2%)
    fee_recipient: address,                   // the ONE Suize treasury every CHARGE fee lands in
    overrides: Table<address, u16>,           // per-merchant rate (merchant → bps); absent ⇒ default
}

public struct RailAdminCap has key, store { id: UID }   // possession-is-authority; held by the publisher
```

- **One shared `RailConfig` for the whole rail.** NON-generic on purpose — a basis-point rate + a recipient address apply to **any** `Account<T>`, so the config is not parameterised by the coin. Every CHARGE path (`charge` / `charge_subscription` / `pay`) takes `&RailConfig` (read-only) and resolves the rate against the relevant merchant address.
- **Rate resolution:** `overrides[merchant]` if present, else `default_fee_bps`. Overrides are typically per-merchant **discounts** (e.g. 50 bps = 0.5%), but any rate `≤ 10_000` (100%) is allowed. The relevant merchant per verb: **`charge`** → its `merchant` param; **`pay`** → its `merchant` address param (a PLAIN address — amendment 2026-06-10, no merchant Account); **`charge_subscription`** → the subscription's FIXED `payee`.
- **`init` (one-time witness `ACCOUNT`)** runs at publish: creates + **shares** the `RailConfig` (`default_fee_bps = 200`, `fee_recipient = ` the publisher, empty `overrides`) and transfers the `RailAdminCap` to the publisher. Emits `RailConfigCreated`. (A `#[test_only] init_for_testing(ctx)` runs the same path from a test scenario.)
- **Admin surface (each takes `&RailAdminCap` — possession IS the auth, NO address check, NO `ENotAdmin` code; you simply cannot call them without the cap):**
  - `set_default_fee_bps(cap, config, bps)` — set the rail default. Aborts `EInvalidRate` if `bps > 10_000`.
  - `set_fee_recipient(cap, config, addr)` — set the single treasury address.
  - `set_merchant_rate(cap, config, merchant, bps)` — grant/update a per-merchant override. Aborts `EInvalidRate` if `bps > 10_000`.
  - `remove_merchant_rate(cap, config, merchant)` — drop an override (merchant falls back to the default). Remove-safe (no-op if absent).
  - All four emit `RailConfigUpdated` (the fee-policy audit trail).
- **Why a cap, not the Account owner:** the rate is **Suize's revenue policy**, not the user's. A per-Account `fee_bps` let a merchant zero their own rate (pay Suize nothing) and gave no way to grant one merchant a discount. The cap-gated shared config fixes both: only Suize (the cap holder) can change rates, and per-merchant discounts are a single config write — no Account reshape, no upgrade.

---

## 2. The Subscription child

```move
public struct Subscription has store, drop {
    payee: address,             // FIXED at creation — never a caller argument, never redirectable
    period_cap: u64,            // max chargeable in any single period
    period_ms: u64,             // a charge is only allowed once now >= last_charged_ms + period_ms
    last_charged_ms: u64,       // wall-clock ms of the most recent charge (or of creation)
}
```

Subscriptions live as **child dynamic fields** on the Account, keyed by the `u64` sub id (`next_sub_id`, monotonic, never reused) — append-only owner-approved recurring authorizations, so they belong ON the account, not as free-floating objects. `store` (held in a dynamic field), no `key` (no independent identity — it lives and dies with its parent field). The **FIXED payee** + **per-period cap** + **`Clock` time-gate** are the whole safety property of the recurring path: even an arbitrary caller can only ever move the owner-approved amount to the owner-approved payee, once per period.

---

## 3. The four payment verbs (the entire rail surface)

Every product — Wallet, Deploy, Crash, any external merchant — is a consumer of these four verbs; nothing else moves money on the rail. **All four emit a receipt event with the fee VISIBLE** (monetization as a trust feature). The **2% is the rail's only rake, taken inline, ONLY when a merchant is paid** (verbs ②③④). **Sending (verb ①) is free.**

**The fee (verbs ②③④) is resolved from `&RailConfig`**, not the Account — each CHARGE verb now takes a `config: &RailConfig` argument and looks up the merchant's rate (override or default).

| # | Verb | Authority | Fee | Account needed? | Status |
|---|---|---|---|---|---|
| ① | `spend(account, amount, payee, memo, clock, ctx)` | OWNER-only | **FREE** | yes | **live (testnet)** |
| ② | `charge(account, config, merchant, amount, memo, clock, ctx)` | OWNER-only | **rate@merchant** | yes (payer) | **live (testnet)** |
| ③ | `charge_subscription(account, config, sub_key, amount, memo, clock, ctx)` | PERMISSIONLESS, terms-gated | **rate@payee** | yes | **live (testnet)** |
| ④ | `pay(merchant: address, config, payment: Coin<T>, memo, clock, ctx)` | PERMISSIONLESS — pays ANY address | **rate@merchant** | **NEITHER side** | **live (testnet)** |

*"rate@X" = `RailConfig.overrides[X]` if set, else `RailConfig.default_fee_bps` (default 200 = 2%).*

### ① `spend` — PAY, free P2P send (exists)

`spend<T>(account: &mut Account<T>, amount: u64, payee: address, memo: vector<u8>, clock: &Clock, ctx: &mut TxContext)`

The owner moves funds out to any payee. **OWNER-ONLY** (`sender == owner`), signed from the owner's own LOCAL zkLogin session. **A FREE transfer** (Revolut-style free sends): NO fee is taken — the **full** `amount` lands with the payee, nothing goes to `fee_recipient`. Check order (contract — tests assert which fires first): (1) caller IS owner → `ENotOwner` · (2) balance covers `amount` → `EInsufficientBalance`. Splits `amount` out of the balance, transfers a fresh `Coin<T>` to `payee`. Emits `Spent` with `fee = 0`, `net == gross == amount`. Capped only by the balance — no budget/scope/expiry.

### ② `charge` — one-off merchant charge (exists)

`charge<T>(account: &mut Account<T>, config: &RailConfig, merchant: address, amount: u64, memo: vector<u8>, clock: &Clock, ctx: &mut TxContext)`

The owner-authorized one-off charge from a **funded Suize Account** — the non-recurring CHARGE path (a single 402 settlement). **OWNER-only** (`sender == owner`): like `spend`, there are no on-chain terms to gate a one-off, so it must be owner-signed; the difference from `spend` is the **fee split inline** (a merchant is being paid). The rate is **resolved from `config` against `merchant`** (`overrides[merchant]` or `default_fee_bps`), and the fee goes to `config.fee_recipient`. **Reuses the `split_and_pay` helper** (now taking the resolved bps + recipient). Check order: (1) caller IS owner → `ENotOwner` · (2) balance covers `amount` → `EInsufficientBalance`. Pays `net = amount - fee` → `merchant` by **transfer** of a fresh `Coin<T>` (NOT a deposit into a merchant Account — mirrors `charge_subscription`). Emits **`ChargePaid`** (same shape as `Charged`, no `sub_key`; reserves `decision_hash` + `walrus_blob_id`).

### ③ `charge_subscription` — recurring charge (exists)

`charge_subscription<T>(account: &mut Account<T>, config: &RailConfig, sub_key: u64, amount: u64, memo: vector<u8>, clock: &Clock, ctx: &mut TxContext)`

The recurring CHARGE path. **PERMISSIONLESS-BUT-TERMS-GATED** — callable by ANYONE / the backend relayer (a scheduled debit can't wait for an owner tap; the deterministic backend that drives renewals is NOT the owner). **Design choice (documented):** it does NOT require `sender == owner` — the subscription TERMS are the protection (fixed payee + per-period cap + `Clock` time-gate), so even an arbitrary caller can only move the owner-approved amount to the owner-approved payee, once per period. Requiring the owner's signature would break the "anyone can trigger a due renewal" property a recurring rail needs. The payee is the subscription's FIXED `payee`, never a caller argument. **Takes the fee resolved from `config` against that FIXED `payee`** (`split_and_pay`). **`memo` (amendment 2026-06-10)** follows the `charge`/`pay` convention: a caller-supplied UTF-8 note (the relayer's `paymentId`) recorded verbatim in the `Charged` receipt — it carries NO authority (the terms are the leash); it only makes a renewal receipt matchable off-chain (`/verify`), exactly like a one-off. Emits `Charged`. Check order below.

**Anti-drift advance:** on success `last_charged_ms` is set to `now` (NOT `+= period_ms`) — advancing by the period would let a late scheduler "catch up" by firing N charges in a row (a debit storm); advancing to `now` guarantees AT MOST ONE charge per real period.

### ④ `pay` — raw-payer facilitator (exists)

`pay<T>(merchant: address, config: &RailConfig, payment: Coin<T>, memo: vector<u8>, clock: &Clock, ctx: &mut TxContext)`

The open facilitator: a one-off charge from ANY raw payer with a `Coin<T>` in hand — **NO Suize Account required on EITHER side** (owner amendment 2026-06-10): the merchant is a **plain `address`** — *"your address is your account,"* now literally true on-chain. This is the door for external 402 / AP2 agents that have USDC but no funded Account, paying any merchant that can receive USDC. **PERMISSIONLESS** (no owner gate — the payer's signature over the `payment: Coin<T>` input IS the authorization; you can only pay with a coin you own). There is **no `EInsufficientBalance` check** — the coin's value IS the amount, so you cannot over-spend a coin you handed in. **FEE SOURCE (refactor — see §4):** the rate + recipient are read from the shared **`RailConfig`**, resolved against the merchant ADDRESS being paid — NOT from any merchant-owned object (a merchant can't zero their own rate) and NOT a constant. `net` is **transferred** to `merchant` and `fee` to `config.fee_recipient`, both as fresh `Coin<T>`s (same payout primitive as `charge` — transfer, never a deposit-into-Account). Emits **`Paid`** with the fee visible (no `account_id` — NO Account on either side). Carves the fee off the handed-in coin with `coin::split`.

---

## 4. Fee mechanics (exact)

The fee is **inline, taken only on a merchant-paid path** (verbs ②③④). The rate is **resolved per-merchant from the shared `RailConfig`** (§1b), never from the Account:

```move
// rate resolution (the fee_bps_for helper):
fee_bps = overrides[merchant] if present else default_fee_bps   // default 200 = 2%
// then:
fee = (amount * (fee_bps as u64)) / BPS_DENOMINATOR             // BPS_DENOMINATOR = 10_000
net = amount - fee
//   fee → config.fee_recipient (Suize treasury)
//   net → merchant/payee
// both as fresh Coin<T>; returns (fee, net) for the event.
```

- **`fee_bps_for(config, merchant) -> u16`** resolves the rate. The merchant is: verb ② `merchant` param · verb ③ the sub's FIXED `payee` · verb ④ its `merchant` address param.
- **`split_and_pay(account, amount, payee, fee_bps, fee_recipient, ctx) -> (fee, net)`** is the CHARGE helper used by `charge_subscription` AND `charge` — it now takes the **resolved** bps + recipient (no longer reads them off the Account). The caller MUST have already asserted `balance >= amount`.
- **Integer-division floor** on the fee → Suize slightly **under-collects on dust** and **NEVER overcharges the payee** — deliberate, user-favoring rounding.
- **`spend` (①) bypasses the helper entirely** — it splits the full `amount` straight to the payee, `fee = 0`. It does NOT take `&RailConfig`.
- **`pay` (④)** cannot use `split_and_pay` (it operates on a raw `Coin<T>`, not the balance); it performs the **same arithmetic** against the handed-in coin via `coin::split`, with the rate from `fee_bps_for(config, merchant)` and the fee → `config.fee_recipient`.
- **Bounds:** any settable rate is validated `bps <= 10_000` (`EInvalidRate`). `fee_recipient` defaults to the publisher at `init` and is re-set via `set_fee_recipient` (admin-gated).

---

## 5. Lifecycle — deposit / create / withdraw / cancel / kill

- **`create_account<T>(ctx)`** — creates + **shares** an Account owned by `sender`. **No `fee_recipient` arg** (fee policy is in `RailConfig`, not the Account); `create_account_with_fee` is **removed**. Emits `AccountCreated` (now just `{ account_id, owner }`).
- **`init(ACCOUNT, ctx)`** (one-time) — at publish, creates + shares the `RailConfig` (2% default → publisher) and sends the `RailAdminCap` to the publisher (§1b). The admin fns (`set_default_fee_bps` / `set_fee_recipient` / `set_merchant_rate` / `remove_merchant_rate`) are the only way fee policy changes after that.
- **`deposit<T>(account, coin, ctx)`** — **ANYONE** tops up (the human funding their agent's allowance, or a third party). Joins into the balance, emits `Deposited`. Funding = the human moving USDC from their own wallet into the Account; the deposit IS the cap.
- **`create_subscription<T>(account, payee, period_cap, period_ms, clock, ctx): u64`** — **OWNER-ONLY**. Approve a recurring charge ONCE; stores a `Subscription` child keyed by a fresh `u64` (returned). **First-charge decision:** `last_charged_ms = now` at creation, so the FIRST charge must also wait one full `period_ms` (approve-once must not also debit-now; the merchant's first invoice is a separate up-front `charge`/`spend`; a subscription is purely the *recurring* leg). Emits `SubscriptionCreated`.
- **`withdraw<T>(account, amount, ctx): Coin<T>`** — **OWNER-ONLY**. **RETURNS** a `Coin<T>` (composable — so the owner can route it inside a PTB) rather than transferring; `spend`/`charge`/`charge_subscription` *transfer* because "pay the payee" is their semantic. Aborts `EInsufficientBalance` if `amount` exceeds the balance (checked here so the abort code is this module's, not the framework's split abort). Emits `Withdrawn`. Withdrawing to zero is the owner's hard "stop everything."
- **`cancel_subscription<T>(account, sub_key, ctx)`** — **OWNER-ONLY**. Removes the child field (`Subscription` has `drop`). Aborts `ESubscriptionNotFound` if absent. Emits `SubscriptionCancelled`.
- **Kill** is an off-chain + owner-tx story (disarm the signer — the PAY app's Agent-enabled toggle off, or on the dev CHARGE-side stop the local MCP — so no `spend`/`charge` signature can be produced; `cancel_subscription` to stop a recurring charge; `withdraw` to zero the cap) — the rationale lives in `CLAUDE.md`. On-chain there is no `pause`; the only signer is the owner.

### Read accessors (plain `public`, for `devInspect` + tests)

Account: `balance_value` · `owner` · `has_subscription` · `subscription_info` → `(payee, period_cap, period_ms, last_charged_ms)` (aborts `ESubscriptionNotFound` if absent). RailConfig: `default_fee_bps` · `fee_recipient` · `has_merchant_rate(merchant)` · `merchant_fee_bps(merchant)` (the resolved rate). (`fee_bps` / `fee_recipient` are no longer Account accessors — the rate moved to `RailConfig`.)

---

## 6. Abort codes — PUBLIC CONTRACT (preserve verbatim, NEVER renumber)

The unit tests and the off-chain backend both pattern-match on the exact code. The agent/paused codes from the retired agent model (`ENotAgent` `1`, `EPaused` `2`) were **dropped** when `spend` became owner-only and the `paused` field + SuiNS resolution were removed; the survivors keep their original numbers — `0`, `3`, `4`, `5`, `6` are UNCHANGED. Code `7` (formerly the dropped `ENameUnresolved`) is **repurposed** for `EInvalidRate`. **`1`, `2` remain retired/unused.** NEVER renumber a surviving code.

| Code | Name | Meaning |
|---|---|---|
| `0` | `ENotOwner` | A non-owner called an owner-only fn (`spend` / `charge` / `withdraw` / `create_subscription` / `cancel_subscription`). |
| `3` | `EInsufficientBalance` | Requested amount exceeds the balance. Asserted by THIS module before any `balance::split`, so callers get a stable code, not the framework's internal split abort. |
| `4` | `ETooEarly` | `charge_subscription` called before the period elapsed (`now < last_charged_ms + period_ms`) — a sub can NEVER be debited early. |
| `5` | `EOverPeriodCap` | `charge_subscription` requested more than the per-period ceiling (`amount > period_cap`). |
| `6` | `ESubscriptionNotFound` | No subscription with the given key (cancelled, or never created). |
| `7` | `EInvalidRate` | An admin tried to set a fee rate `> 10_000` bps (`set_default_fee_bps` / `set_merchant_rate`). |

**Admin auth needs NO abort code:** `set_*` / `remove_merchant_rate` take `&RailAdminCap` — possession IS the authorization, so a non-cap-holder simply cannot construct the call. There is **no `ENotAdmin`**.

**`spend` / `charge` check order:** (1) caller IS owner → `ENotOwner` · (2) balance covers `amount` → `EInsufficientBalance`.

**`charge_subscription` check order:** (1) sub exists → `ESubscriptionNotFound` · (2) period elapsed → `ETooEarly` · (3) `amount <= period_cap` → `EOverPeriodCap` · (4) balance covers `amount` → `EInsufficientBalance`.

**`pay` has NO abort codes of its own** — it is permissionless (no owner gate) and takes the coin's full value (no balance check; the coin you hand in IS the amount). `1`/`2` remain retired/free.

---

## 7. Events (the receipt stream — the wallet timeline reads these)

`AccountCreated` · `Deposited` · `Withdrawn` · `Spent` · `SubscriptionCreated` · `Charged` · `SubscriptionCancelled` · **`ChargePaid`** (verb ②) · **`Paid`** (verb ④) · **`RailConfigCreated`** (init) · **`RailConfigUpdated`** (every admin fee-policy change).

- **`AccountCreated`** = `{ account_id, owner }` — the fee fields were removed (fee policy is in `RailConfig` now).
- **`RailConfigCreated`** = `{ config_id, default_fee_bps, fee_recipient }` — emitted once at `init`.
- **`RailConfigUpdated`** = `{ config_id, field, merchant, bps, fee_recipient }` — the fee-policy audit trail. `field` ∈ `default_fee_bps` | `fee_recipient` | `merchant_rate` | `merchant_rate_removed`; `merchant = @0x0` for rail-wide ops.
- **`Spent`** = `{ account_id, payee, gross, fee, net, memo, timestamp, decision_hash, walrus_blob_id }` — the PAY receipt. `spend` is FREE so `fee = 0`, `net == gross == amount`; the `fee`/`net` fields are kept so the receipt shape matches the CHARGE receipts and the timeline/indexer read one uniform stream.
- **`Charged`** = same shape **plus `sub_key`**, and it **does** carry the real 2% fee. Its `memo` (amendment 2026-06-10) is the caller's verbatim stamp — the relayer's `paymentId` — so a renewal receipt is `/verify`-matchable exactly like a one-off.
- **`ChargePaid`** (verb ② `charge`) = `{ account_id, merchant, gross, fee, net, memo, timestamp, decision_hash, walrus_blob_id }` — the one-off CHARGE receipt; mirrors `Charged` WITHOUT `sub_key`, carries the real 2% fee.
- **`decision_hash` + `walrus_blob_id` ship from day one** (reserved, empty in v1) so the verifiable-trace layer (Walrus action-log, phase 2) needs no later schema migration.
- **`Paid`** (verb ④ `pay`) carries `{ payer, merchant, gross, fee, net, memo, timestamp, decision_hash, walrus_blob_id }` (no `account_id` — NO Account exists on either side of this path; `payer` = `ctx.sender()`, `merchant` = the plain paid address).

---

## 8. Tests & build status

- **30 unit tests** pass for `suize::account` (`sui move test`; **100 total** across the package incl. the legacy cage suites); `sui move build` green; framework-only (no vendored protocol deps).
- Fee-policy coverage: per-merchant **discount** on all three CHARGE verbs (`charge` / `charge_subscription` / `pay` split 0.5% when the merchant is overridden, 2% otherwise); the default-rate path; the admin set/remove-override lifecycle + resolution (override wins over default); `EInvalidRate` on `bps > 10_000` (default + per-merchant); a **non-admin cannot set rates** (no `RailAdminCap` → the setters are unreachable).
- The two CHARGE-via-config verbs are tested run by an **arbitrary non-owner sender** where applicable (`pay` permissionless, no payer Account). **Amendment coverage (2026-06-10):** `pay` settles a NEVER-SEEN plain merchant address (no Account anywhere); the `Paid` receipt is asserted field-for-field incl. the `memo` + the merchant ADDRESS; the override table resolves on the plain address; the `Charged` receipt carries the caller's `memo` (the relayer's `paymentId`) verbatim.
- **PUBLISHED ON TESTNET 2026-06-10** (the amended rail — republish digest `GBBD12nJ…`, package `0x789bf9…`, `RailConfig` `0x8a8ecf…` captured from `init`; full ids ONLY in `@suize/shared`). Mainnet stays `0x0` — **the MAINNET publish is the v1 gate.** The legacy cage tests (`mandate`/`vault`/`swap`/`navi`, 70/70) describe the OLD, dead product — do NOT read "the cage is green" as "the rail is built." See `CLAUDE.md` for the cage-retirement note and the mainnet sequence.

---

**Refactor note (fee policy moved to `RailConfig`):** previously every CHARGE verb read `fee_bps` + `fee_recipient` off an `Account` — verb ④ `pay` read them off the *merchant's* Account. That was unsafe for Suize's revenue: a merchant could set their own `fee_bps = 0` (pay Suize nothing), and there was no way to grant a specific merchant a lower rate. The rate is now **Suize's**, in one shared `RailConfig` (cap-gated), resolved **per-merchant** (override or default). **Amendment 2026-06-10 (owner):** `pay` no longer touches a merchant Account AT ALL — it takes a plain **`merchant: address`** and resolves the rate via `fee_bps_for(config, merchant)`. The old trade-off ("a Suize merchant needs an Account just to be resolvable") is GONE: **any address that can receive USDC is a payable merchant** — *"your address is your account."* Downstream: every CHARGE PTB (`charge` / `charge_subscription` / `pay`) must pass the shared `RailConfig` object id; `@suize/shared` carries the `RAIL_CONFIG` slot (captured REAL at the 2026-06-10 testnet publish) + the admin targets if Suize wants to sponsor/automate rate changes.
