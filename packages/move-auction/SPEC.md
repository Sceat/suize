# `packages/move-auction` — `suize_auction` (SPEC)

> The on-chain **ad-slot auction** — the monetization of the `agents.suize.io` directory
> (the discovery surface, `apps/agents/SPEC.md`). One Move module, `auction::auction`.
> Owns its own piece; defers the global picture + the one-off / subscription rail to the
> root `CLAUDE.md`. State each fact once.

## What it is

A fixed set of advertising slots, each sold by **continuous English auction**
(King-of-the-Hill). An `AdSlot` is a **shared** Move object holding the current `price`
+ `holder` + `creative` (the ad shown). A bid must **strictly exceed** the standing
price; on a winning bid the module carves the configured fee to the treasury, sends the
**remainder to the directory**, and ratchets the slot to the new price/holder/creative.
The displaced holder is **not refunded** — they held the placement as paid ad time.
Genesis price is **$50** (`AD_SLOT_START_PRICE = 50_000_000`).

This is what makes the directory **a product on the Suize rail**: every bid's net lands
at `config.directory` and the fee lands at the Suize treasury, so an ad sale is itself a
payment whose fee is visible in the balance-change set — and the directory shows up in
its own live feed (the treasury-inbound feed enumerates it like any x402 payment).

## Why King-of-the-Hill on a shared object (the rationale)

The slot is a **shared** object (not Party, not owned): *anyone* may bid, and the bids
serialize through consensus, so two simultaneous bids can't both win — the lower one
re-reads the ratcheted price and aborts `EBidTooLow`. The "who holds the slot" state is
**on-chain only**; there is no off-chain ownership store to drift or trust.

## Push, no escrow (the funding law)

An `AdSlot` holds **NO balance**. Each bid PUSHES exactly its `Balance<T>`; `settle`
carves the fee to the treasury and `balance::send_funds` the rest to the directory in
the SAME tx (Address Balances — no `Coin` minting). Nothing is custodied between bids,
so there is no escrow to leak — the `price` is simply the gross of the last winning bid.
Bids are **user-signed + Enoki-sponsored** (the same shape as a `subs::subscription`
renewal; sponsor allow-list = `AUCTION_MOVE_TARGETS`, gated on `AUCTION_PUBLISHED`).

## The contract (functions)

| Fn | Auth | What it does |
|---|---|---|
| `bid<T>(slot, config, payment, creative, clock, ctx)` | user-signed (anyone), Enoki-sponsored | Asserts `payment.value() > slot.price` (`EBidTooLow`); coin-pin check (`EWrongCoin`); carves the fee to treasury, sends the rest to `config.directory`; sets `price`/`holder`/`creative`/`last_bid_ms`; **clears the per-slot `LastUpdate` cooldown so the new holder can edit immediately**; emits `BidPlaced`. |
| `update_creative(slot, creative, clock, ctx)` | the current `holder` (Enoki-sponsorable) | The holder REFRESHES their live creative for FREE — no payment, no new bid, `price`/`holder` untouched. Aborts `ENotHolder` (`ctx.sender() ≠ holder`), `EBadCreative` (> `MAX_CREATIVE_LEN`), `EUpdateTooSoon` (faster than `UPDATE_COOLDOWN_MS` = 10s — the rate limit is ON-CHAIN, tracked in a per-slot `LastUpdate` dynamic field, so it binds whether the edit is self-paid or sponsored). Emits `CreativeUpdated`. |
| `create_slot(config, &cap, name, start_price, ctx)` | `&AuctionAdminCap` | Creates + shares an `AdSlot` genesis-held by `config.directory` at `start_price`. Aborts `EBadSlot` (empty name / zero price) and **`ECoinUnpinned`** (the coin must be pinned FIRST — a slot may not exist while a bid could be paid in an arbitrary coin). Emits `SlotCreated`. |
| `set_treasury` / `set_directory` / `set_fee(bps,floor)` / `set_coin_type<T>` | `&AuctionAdminCap` | Suize-only policy (possession-is-auth; `set_fee` aborts `EInvalidRate` if `bps >= 10_000` — a 100% fee would zero the directory's net leg). |

**By design, `price` only ratchets UP and there is NO reset/recovery** — a high enough bid holds the slot forever (until out-bid). That permanence is the product ("over-bid to take the slot, hold it forever"), not a gap (owner-confirmed 2026-06-14).

## Fee policy (shared, admin-tuned, never waived)

`fee = min(max(bid * fee_bps / 10_000, fee_floor), bid)` — default 2%
(`DEFAULT_FEE_BPS = 200`) with a **$0.01 floor** (`DEFAULT_FEE_FLOOR = 10_000`), the
floor always at least $0.01 so **every** ad sale credits the treasury. Rate + floor +
treasury + directory live in ONE Suize-controlled shared `AuctionConfig`, mutated only
via the `AuctionAdminCap`. The fee math is u128-widened (same as `subs::settle`) so
`bid * fee_bps` can't overflow u64.

## Abort codes (PUBLIC CONTRACT — never renumber)

| Code | Name | When |
|---|---|---|
| `0` | `EBidTooLow` | a bid did not strictly exceed the standing price. |
| `1` | `EWrongCoin` | pushed `payment`'s `T` ≠ the pinned settlement coin. |
| `2` | `EInvalidRate` | `set_fee` with `bps >= 10_000` (100% would zero the directory's leg). |
| `3` | `EBadSlot` | `create_slot` with empty `name` or zero `start_price`. |
| `4` | `ECoinUnpinned` | `create_slot` before the settlement coin is pinned (the invariant that closes the junk-coin take-without-paying window). |
| `5` | `EBadCreative` | `bid` / `update_creative` with a `creative` longer than `MAX_CREATIVE_LEN` (512 bytes). |
| `6` | `ENotHolder` | `update_creative` by anyone other than the slot's current `holder`. |
| `7` | `EUpdateTooSoon` | `update_creative` again before `UPDATE_COOLDOWN_MS` (10s) elapsed (the on-chain edit rate limit). |

Admin fns need no abort code — `&AuctionAdminCap` possession IS the auth.

## Events

- `SlotCreated { slot_id, name, start_price, holder }`
- `BidPlaced { slot_id, slot_name, new_holder, new_price, fee, creative, timestamp_ms }`
- `CreativeUpdated { slot_id, holder, creative, timestamp_ms }` — the holder edited their live creative (no price/holder change).

## Package shape

Framework-only (`Sui` pinned to `framework/testnet` — the rev where Address Balances
shipped `balance::send_funds`). Edition `2024`, named address `auction = "0x0"`. Mirrors
`move-subs`'s shape; `AdSlot`/`AuctionConfig` are NON-generic (coin is relevant only at
`bid` time via the config pin).

## Build status

`sui move build` green; `sui move test` — **23/23 pass** (the 17 above + the 6
`update_creative` cases: happy edit + `CreativeUpdated` event, non-holder → `ENotHolder`,
inside-cooldown → `EUpdateTooSoon`, exactly-+10s boundary OK, a NEW holder not gated by
the previous holder's cooldown (bid resets `LastUpdate`), over-long edit → `EBadCreative`).

> **`update_creative` is BUILT + tested but NOT YET on-chain.** It ships as a package
> **UPGRADE** (NOT a republish — the upgrade is ABI-compatible: a new fn + a new event + a
> `LastUpdate` dynamic field, no struct/signature change, so the live `AdSlot`/`AuctionConfig`
> shared objects survive). Until `sui client upgrade` runs, `@suize/shared`'s
> `AUCTION_PACKAGE_LATEST` stays === `AUCTION_PACKAGE`; AFTER the upgrade set it to the v2
> package id (move-call TARGETS resolve there; `PACKAGE`/types/`AUCTION_PUBLISHED` keep the
> ORIGINAL id). Adversarially reviewed (3-lens) before the upgrade; 2 defects found + fixed
> (the latest-id target wiring; the cooldown carryover on a holder change).

The on-chain base the upgrade builds on is **PUBLISHED + LIVE
on testnet 2026-06-14 — the HARDENED v2** (republish digest
`6kjMqdJzNn46q1sZz2V2smw1eXzg1akfemKNhPgJAH5P`; package `0xe0c4eeec…`, shared
`AuctionConfig` `0x60783bfa…`, `AuctionAdminCap` `0x8df7762c…` + `UpgradeCap`
`0x3bbdadaa…` on the publisher/CLI dev wallet `0x087aa862…` = `AuctionConfig.directory`;
`treasury` synced to the resolved `treasury@suize`, coin pinned to testnet USDC — pinned
BEFORE the slots, as the `ECoinUnpinned` guard now requires; three slots
`hero`/`feed-banner`/`rankings-sidebar` at $50, served live by the backend `/ads/slots`;
all ids in `@suize/shared`). The bid recipe (`tx.balance` → `auction::bid`) was proven
with a live on-chain bid (digest `62pMSR4q…`) on the byte-identical-logic predecessor.
The **pre-hardening `0x07c192ad…` is ABANDONED** (superseded by this v2). Mainnet id
stays `0x0` — the mainnet publish is a republish.

> **ON-CHAIN CAVEAT (same as `subs`):** `AuctionConfig.treasury` is a LITERAL set at sync
> (Move can't resolve SuiNS) — if `treasury@suize` is repointed, an admin `set_treasury`
> is needed.
