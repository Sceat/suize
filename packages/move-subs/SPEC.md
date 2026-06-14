# `packages/move-subs` — `suize_subs` (SPEC)

> The standalone subscription module: the **recurring** half of the Suize rail. One
> Move module, `subs::subscription`. Owns its own piece; defers the global picture +
> the one-off payment rail to the root `CLAUDE.md`. State each fact once.

## What it is

A `Subscription<T>` is a **Party-owned, soulbound** Move object the user signs into
existence with ONE transaction — paying the first period inline, so premium is active
the instant `create` returns. Every later renewal is the **same shape**: a
user-signed, gas-sponsored tx that pushes exactly one period's funds and advances the
paid-through clock. The off-chain relayer **never holds a key** — it only schedules +
sponsors gas; the user's own zkLogin session signs each renewal. The chain itself is
the double-charge guard.

`account.move` is DEAD in production; this module is the v1 subscription primitive.
Production type is `Subscription<USDC>`; `phantom T` is kept generic so tests fabricate
a throwaway coin.

## Why a Party object (the rationale)

A single-owner `Party` object is owned by exactly one address (the user) and is driven
through consensus. That buys two properties a shared or address-owned object can't give
cleanly together:

- **Only the user authorizes a renewal** — the relayer schedules + sponsors gas, the
  user's session signs. No delegated key, no standing allowance to drain.
- **Races abort cleanly** — concurrent renewal attempts serialize; the loser hits the
  `ETooEarly` time-gate and aborts rather than racing a balance.

**Soulbound:** `Subscription<T>` has `key` but NO `store`. It can never be wrapped,
sold, or party-transferred out of its module by a third party. The only exit is
`cancel`, which `object::delete`s it. (`transfer::party_transfer` — the non-`store`
variant — is legal precisely because the type is defined in this module.)

## Push, not pull (the funding law)

A `Subscription` holds **NO balance**. Each period the caller PUSHES exactly one
period's `Balance<T>` into `create` / `renew`; `settle` asserts `payment == amount`,
carves the fee to the treasury, and `balance::send_funds` the rest to the merchant
(Address Balances — no `Coin` minting, no gas-object churn). Nothing is custodied
between periods: the user signs + funds each renewal, so there is no allowance to drain
and no balance to under-fund. The read side is push too — every event carries enough
for the merchant to self-index renewals (`ref`) without a Suize lookup.

## The contract (functions)

| Fn | Auth | What it does |
|---|---|---|
| `create<T>(config, merchant, amount, period_ms, ref, payment, clock, ctx)` | user-signed | First period paid inline; mints + party-transfers the soulbound `Subscription<T>` to `single_owner(sender)`; `paid_until_ms = now + period_ms`. |
| `renew<T>(sub, config, payment, clock, ctx)` | user-signed (owner of the Party object), relayer-sponsored | One period; gated by the 24h window; `paid_until_ms = max(paid_until_ms, now) + period_ms`. |
| `cancel<T>(sub, ctx)` | user-signed | Destroys the object; emits `paid_until_ms` (merchants MAY honor remaining time). No refund — nothing is custodied. |
| `set_treasury(config, &cap, addr)` / `set_fee(config, &cap, bps, floor)` | `&SubsAdminCap` | Suize-only fee policy (possession-is-auth; `set_fee` aborts `EInvalidRate` if `bps > 10_000`). |

**Renewal window + anti-back-billing:** the window opens 24h before paid-through
(`now + RENEW_WINDOW_MS >= paid_until_ms`); a second in-window renewal aborts
`ETooEarly` (the on-chain double-charge guard). After a lapse the new period starts at
`now`, not at the stale paid-through — the user is never back-billed for dead time.

## Fee policy

2% (`DEFAULT_FEE_BPS = 200`) with a **$0.01 floor** (`DEFAULT_FEE_FLOOR = 10_000` at 6
decimals), **merchant-absorbed**: the user pays exactly `amount`; the treasury takes
`min(max(amount * fee_bps / 10_000, fee_floor), amount)`; the merchant gets the rest.
The floor clamps to `amount`, so a subscription smaller than the floor pays its whole
value as fee (merchant receives 0) and never underflows. Rate + floor + treasury live
in ONE Suize-controlled shared `SubsConfig`, mutated only via the `SubsAdminCap` — a
merchant can never zero their own fee.

## Abort codes (PUBLIC CONTRACT — never renumber)

| Code | Name | When |
|---|---|---|
| `0` | `ETooEarly` | `renew` more than 24h ahead of paid-through (incl. a same-period double renewal). |
| `1` | `EWrongAmount` | pushed `payment.value() != amount` (over- or under-pay). |
| `2` | `EBadTerms` | `create` with zero `amount` or zero `period_ms`. |
| `3` | `EInvalidRate` | `set_fee` with `bps > 10_000`. |

Admin fns need no abort code — `&SubsAdminCap` possession IS the auth.

## Events (all carry enough for merchant self-indexing via `ref`)

- `SubscriptionCreated { subscription_id, owner, merchant, amount, period_ms, paid_until_ms, fee, ref }`
- `SubscriptionRenewed { subscription_id, owner, merchant, amount, fee, paid_until_ms, ref }`
- `SubscriptionCancelled { subscription_id, owner, merchant, paid_until_ms, ref }`

## Package shape

Framework-only (`Sui` pinned to `framework/testnet` — the rev where Address Balances
shipped `balance::send_funds` + `transfer::party_transfer`, both required here). Edition
`2024`, named address `subs = "0x0"`. Mirrors `move-deploy`'s shape.

## Build status

`sui move build` green; `sui move test` — **17/17 pass** (full abort matrix: create
happy + event, `EBadTerms` ×2, `EWrongAmount` over/under, renew happy + exact-period
advance, early-in-window OK, double → `ETooEarly`, too-early → `ETooEarly`, lapse →
no-back-billing, fee floor, fee clamp-to-amount, cancel destroys + emits, `set_fee`
`EInvalidRate`, treasury redirect). **Publish status: PUBLISHED on testnet
2026-06-12** (publish digest `8L1uzC1SMC5g51bwB8QcXxhmzRniphZgaPm9w4rMBpgo`;
package `0x549edd06…`, shared `SubsConfig` `0xf2648a61…`, `SubsAdminCap`
`0xfe3a0e80…` + `UpgradeCap` `0x07a9483e…` on the publisher/CLI dev wallet
`0x087aa862…` = `SubsConfig.treasury`; ids wired into `@suize/shared`). Verified
end-to-end on testnet (`scripts/verify-testnet.ts`): sponsored create/renew/cancel,
party-object owner kind `ConsensusAddressOwner`, `getOwnedObjects` surfaces the
party object, the 24h-window renew advance, and the `ETooEarly` guard (via a
>24h-ahead sub). Mainnet id stays `0x0` — the mainnet publish is a republish.

**F6 (2026-06-12 review fix — fee math u128 widen):** `settle()` now computes the
fee as `((amount as u128) * (fee_bps as u128) / (BPS_DENOMINATOR as u128)) as u64`,
so `amount * fee_bps` cannot overflow u64 (the old `amount * (fee_bps as u64)` aborts
safely above ~$1.84B — non-exploitable, just an unnecessary abort). **NOT republished:
the deployed testnet module is non-exploitable as-is; the fixed source ships in the
mainnet republish.** `sui move test` stays **17/17** after the change.
