# DeepBook Predict — Integration Notes (verified)

Source branch: `predict-testnet-4-16` of `MystenLabs/deepbookv3`, package
`packages/predict/sources/`. Signatures below are copied verbatim from the live
source and are what every `moveCall` in `src/sui.ts` targets.

## Verified on-chain / API facts

- RPC: `https://fullnode.testnet.sui.io:443`
- Package: `0xf5ea2b3749c65d6e56507cc35388719aadb28f9cab873696a2f8687f5c785138`
- Predict shared object (`Predict`): `0xc8736204d12f0a7277c86388a68bf8a194b0a14c5538ad13f22cbd8e2a38028a`
  - Confirmed via `GET /config` -> `predict_id` matches, quote_assets = `[dusdc::DUSDC]`.
- Clock: `0x6`
- `<Quote>` type arg: `0xe95040085976bfd54a1a07225cd46c8a2b4e8e2b6732f140a0fc49850ba73e1a::dusdc::DUSDC`
- **dUSDC decimals = 6** (verified via `suix_getCoinMetadata`). symbol `DUSDC`.
- API oracle objects: each `oracle_id` from `GET /predicts/{id}/oracles` is the
  on-chain **`{pkg}::oracle::OracleSVI`** SHARED object. Verified with
  `sui_getObject` -> `type = ...::oracle::OracleSVI`, `owner = Shared`.
  Pass it directly as `tx.object(oracle_id)` to mint/redeem/get_trade_amounts.
- Oracle list field for strike tick is `tick_size` (1e9-scaled), aliased in some
  responses as `strike_interval`. `min_strike` 1e9-scaled (e.g. 50000000000000 = $50k).
- All prices/strikes/spot are **1e9 fixed point** (`$1 = 1_000_000_000`).
- Live: ~19 BTC `active` oracles rolling every 15 minutes.

## market_key.move  (module `deepbook_predict::market_key`)

```move
public struct MarketKey has copy, drop, store {
    oracle_id: ID,
    expiry: u64,
    strike: u64,
    direction: u8,
}

public fun up(oracle_id: ID, expiry: u64, strike: u64): MarketKey
public fun down(oracle_id: ID, expiry: u64, strike: u64): MarketKey
public fun new(oracle_id: ID, expiry: u64, strike: u64, is_up: bool): MarketKey
```

MATCHES expected. We build the key inside the PTB with `up`/`down` (ID is
serialized as an address via `tx.pure.id`, the two u64s via `tx.pure.u64`).

## predict_manager.move  (module `deepbook_predict::predict_manager`)

```move
public struct PredictManager has key { ... }          // shared (no `store`)

public fun owner(self: &PredictManager): address
public fun position(self: &PredictManager, key: MarketKey): u64
public fun balance<T>(self: &PredictManager): u64      // VIEW (devInspect)
public fun deposit<T>(self: &mut PredictManager, coin: Coin<T>, ctx: &TxContext)
public fun withdraw<T>(self: &mut PredictManager, amount: u64, ctx: &mut TxContext): Coin<T>

public(package) fun new(ctx: &mut TxContext): ID       // shares internally, emits PredictManagerCreated
```

NOTES / DIFFERENCES vs the spec's expectations:

- `deposit<T>` takes `ctx: &TxContext` (immutable). Matches expected shape.
- `new` is `public(package)` and **shares the PredictManager internally** then
  returns only its `ID` (a value, not an object handle). It also emits
  `PredictManagerCreated { manager_id, owner }`.

## predict.move  (module `deepbook_predict::predict`)

```move
public struct Predict has key { ... }                  // the shared object

public fun create_manager(ctx: &mut TxContext): ID     // wraps predict_manager::new

// VIEW. Returns (mint_cost, redeem_payout) = (math::mul(ask,qty), math::mul(bid,qty))
public fun get_trade_amounts(
    predict: &Predict,
    oracle: &OracleSVI,
    key: MarketKey,
    quantity: u64,
    clock: &Clock,
): (u64, u64)

public fun mint<Quote>(
    predict: &mut Predict,
    manager: &mut PredictManager,
    oracle: &OracleSVI,
    key: MarketKey,
    quantity: u64,
    clock: &Clock,
    ctx: &mut TxContext,
)

public fun redeem<Quote>(
    predict: &mut Predict,
    manager: &mut PredictManager,
    oracle: &OracleSVI,
    key: MarketKey,
    quantity: u64,
    clock: &Clock,
    ctx: &mut TxContext,
)

public fun redeem_permissionless<Quote>(
    predict: &mut Predict,
    manager: &mut PredictManager,
    oracle: &OracleSVI,
    key: MarketKey,
    quantity: u64,
    clock: &Clock,
    ctx: &mut TxContext,
)
```

### IMPORTANT DIFFERENCES vs the brief's expected signatures — READ THIS

1. **`get_trade_amounts` does NOT return `(ask, bid)` per unit.** It returns
   `(mint_cost, redeem_payout)` = `(math::mul(ask, quantity), math::mul(bid, quantity))`.
   `math::mul(a,b) = a*b / 1e9`. So the returned numbers are already multiplied
   by quantity and are in **dUSDC base units (1e6)**, NOT per-unit 1e9 prices.
   - Implied probability = `cost / quantity` (per the scaling below).

2. **`mint` pulls payment from the manager's INTERNAL balance** via
   `manager.withdraw<Quote>(cost)`, NOT from a coin you pass in. Therefore you
   must `deposit<Quote>` enough dUSDC into the manager *before/within the same
   PTB* as the mint. We deposit inside the mint PTB (split + deposit + mint).

3. **`create_manager` shares the manager internally** and returns only an `ID`
   value — you cannot reference the freshly-shared `&mut PredictManager` later in
   the *same* PTB. So manager creation is its **own transaction**, and we read
   the created shared object id from `objectChanges` (type
   `{pkg}::predict_manager::PredictManager`, change type `created`). We persist
   it in `localStorage` keyed by address and reuse it for all later bets.

4. `mint` asserts `ctx.sender() == manager.owner()` and `!trading_paused` and
   `assert_live_oracle`. `redeem` asserts owner + `assert_quoteable_oracle`.
   `redeem_permissionless` asserts `oracle.is_settled()` and uses
   `deposit_permissionless` so anyone can trigger it; payout lands in the
   manager balance. We auto-fire it when the API reports `status == "settled"`.

5. Redeem/cash-out payout goes into the **manager's internal balance**, not back
   to the wallet directly. That internal balance IS the single number the whole
   app shows. To pull it to the wallet the "Cash out to wallet" action calls
   `predict_manager::withdraw<Quote>(manager, amount, ctx): Coin<Quote>` and
   transfers the coin to the user's own address (`build_withdraw_tx` in
   `src/sui.ts`). `withdraw` asserts `sender == manager.owner()`, satisfied in
   the user's own PTB.

6. **3% platform rake is ON-CHAIN, not in the client.** The bet move-call is
   built by `add_bet_move_call` in `src/sui.ts` (one isolated helper). Today it
   targets plain `predict::mint` (no rake). When the Move router ships, set
   `ROUTER_ENABLED = true` in `config.ts` and the helper targets
   `crash_sui::router::bet<Quote>(config, predict, manager, oracle, key, qty,
   clock, ctx)` — one extra leading shared-config arg. `router::bet` calls
   `predict::mint` then skims 3% to a treasury stored INSIDE the router config
   on-chain, so the fee is non-bypassable and no treasury address lives in client
   code. The client funds the manager with ~8% headroom
   (`bet_amount_with_buffer`) to cover the future rake + price drift.

## Scaling (the part that bites you)

Two fixed-point worlds:

| world         | scale | meaning                                  |
| ------------- | ----- | ---------------------------------------- |
| prices/strike | 1e9   | `1_000_000_000` = `$1.00` payout/contract |
| dUSDC coin    | 1e6   | `1_000_000` base units = `$1.00`          |

`get_trade_amounts` => `mul(price_1e9, quantity) = price_1e9 * quantity / 1e9`.
For the result to be in dUSDC 1e6 units, `quantity` itself is **1e6-scaled**:

- `quantity = 1_000_000` == **1 whole contract** (max payout $1.00 if it wins).
- `cost (1e6) = mul(ask_price_1e9, quantity_1e6) = ask_price_1e9 * 1e6 / 1e9`
  = `ask_price` expressed in dUSDC 1e6 units. e.g. ask $0.62 -> `620_000` units.

So we bet `quantity = 1_000_000` (one contract). Cost is whatever the live ask
is (< $1). Implied prob % = `cost_1e6 / quantity_1e6 * 100`.

> The exact units assertion above is derived from the source (`math::mul`) and
> the dUSDC 6-decimals fact, and is consistent with `min_strike`/`spot` being
> 1e9. A real on-chain mint to byte-confirm requires holding dUSDC; the math is
> internally consistent and the devInspect odds read returns sane sub-$1 costs.

## devInspect parsing

`get_trade_amounts` and `balance<T>` are read via
`suiClient.devInspectTransactionBlock({ transactionBlock, sender })`. We take the
last command's `returnValues`; each entry is `[number[] /*BCS bytes*/, type]`.
Two `u64` returns are parsed with `bcs.u64().parse(Uint8Array.from(bytes))`.

## crash_sui::router (our package — `packages/move-crash`)

Deployed on **testnet** (`packages/move-crash`, package `crash_sui`). The `router` module is the
**single move-call target every user action flows through**, so the Enoki
sponsorship allowlist contains ONLY our seven `router::*` functions. Sponsored gas
can never reach a raw `predict::mint` (rake-skip) or any off-path call. The 3%
(300 bps) rake is skimmed atomically **inside** `router::bet`, to a treasury
stored in a shared `Config` mutable only via an `AdminCap` we hold. The two LP
("be the house") wrappers `supply` / `redeem_lp` take **no rake** (LPing is not a
bet). Full module docs in `move/README.md`.

| Thing | ID |
| ----- | -- |
| Package | `0x885bc905f8c39a8a179a6013a4a688c19d94f49ae3a98653452f97dcaff9d2c3` |
| Config (shared, init v `667332733`) | `0x001a7db5bacc9b2e05e8d51b8733f43280e68dea842fbb01c7c5639d512859f3` |
| AdminCap | `0x30d541bd14a5c26a99a3f2d2885851111e33ef7469cc1d504a1e37d607c3849d` |
| UpgradeCap | `0x865cf91c017990eaa543ffc43ffa8dea755e70fd2ac188730571989299c95271` |
| AdminCap owner (deployer) | `0x087aa862ca645c0b94400c49e11b491011fca35db837361ccfc4c6f69d356e86` |
| Publish digest | `HGiqjmXpYU3rPfHKSDXuSScmDcjiC57r5UKrYLqtFi5o` |

Verified on-chain (`sui_getNormalizedMoveFunction`): all seven user fns exist and
link the live predict package
`0xf5ea2b3749c65d6e56507cc35388719aadb28f9cab873696a2f8687f5c785138`.
`router::bet`'s parameter types reference only our package, predict, and the
framework `0x1`/`0x2` — no deepbook/token leak. The on-chain ABI exposes 12
positional parameters (the 11 the frontend passes plus the implicit `&mut
TxContext`): `&Config`, `&mut Predict`, `&mut PredictManager`, `&OracleSVI`,
`ID`, `u64`, `u64`, `bool`, `u64`, `Coin<Quote>`, `&Clock`, `&mut TxContext`.
The LP wrappers link predict + its LP-share type: `supply<Quote>` ABI is
`(&mut Predict, Coin<Quote>, &Clock, &mut TxContext)` and `redeem_lp<Quote>` is
`(&mut Predict, Coin<PLP>, &Clock, &mut TxContext)` where `PLP` =
`0xf5ea2b3749c65d6e56507cc35388719aadb28f9cab873696a2f8687f5c785138::plp::PLP`.
Admin gating verified live via `set_fee_bps` 300 → 400 → 300 (digests
`BsfmTJgdoHv3J1YWWyUieFCUZ7vCMF4V11yci4sqeobf` then
`HYkEa3RSVMgk3J7wigQ5Y8AYMkTruJZUHmPC5dKQaMnw`), reading the shared Config back
(read-back `fee_bps == 300`, restored).

### Enoki allowlist (the EXACT seven `allowedMoveCallTargets`)

```
0x885bc905f8c39a8a179a6013a4a688c19d94f49ae3a98653452f97dcaff9d2c3::router::create_manager
0x885bc905f8c39a8a179a6013a4a688c19d94f49ae3a98653452f97dcaff9d2c3::router::bet
0x885bc905f8c39a8a179a6013a4a688c19d94f49ae3a98653452f97dcaff9d2c3::router::cash_out
0x885bc905f8c39a8a179a6013a4a688c19d94f49ae3a98653452f97dcaff9d2c3::router::claim
0x885bc905f8c39a8a179a6013a4a688c19d94f49ae3a98653452f97dcaff9d2c3::router::withdraw
0x885bc905f8c39a8a179a6013a4a688c19d94f49ae3a98653452f97dcaff9d2c3::router::supply
0x885bc905f8c39a8a179a6013a4a688c19d94f49ae3a98653452f97dcaff9d2c3::router::redeem_lp
```

Native PTB commands (SplitCoins / MergeCoins / TransferObjects) are NOT
individually allowlisted by Enoki — only `moveCall` targets are. Verified against
`@mysten/enoki` 1.0.8: `CreateSponsoredTransactionApiInput` exposes only
`allowedMoveCallTargets?: string[]` + `allowedAddresses?: string[]`, and the
sponsor body sends just those plus the full TransactionKind bytes. So a PTB doing
`SplitCoins` + `router::bet` (or `SplitCoins` + `router::supply`) is sponsorable
with only the seven targets above.

### Router function call shapes (type arg `Quote = DUSDC`)

`DUSDC` = `0xe95040085976bfd54a1a07225cd46c8a2b4e8e2b6732f140a0fc49850ba73e1a::dusdc::DUSDC`.
`PREDICT` (shared) =
`0xc8736204d12f0a7277c86388a68bf8a194b0a14c5538ad13f22cbd8e2a38028a`. `CLOCK` =
`0x6`. `CONFIG` =
`0x001a7db5bacc9b2e05e8d51b8733f43280e68dea842fbb01c7c5639d512859f3`.

- **create_manager** — `router::create_manager()` — no type arg, no args (own tx;
  read the new `PredictManager` shared id from `objectChanges`). Returns `ID`.
- **bet&lt;DUSDC&gt;** — args in order:
  `config`(object `CONFIG`), `predict`(object `PREDICT`), `manager`(object),
  `oracle`(object), `oracle_id`(pure id), `expiry`(pure u64),
  `strike`(pure u64), `is_up`(pure bool), `quantity`(pure u64, 1e6-scaled),
  `payment`(Coin&lt;DUSDC&gt;, a SplitCoins result), `clock`(object `0x6`).
- **cash_out&lt;DUSDC&gt;** — args:
  `predict`(object), `manager`(object), `oracle`(object), `oracle_id`(pure id),
  `expiry`(pure u64), `strike`(pure u64), `is_up`(pure bool),
  `quantity`(pure u64), `clock`(object `0x6`).
- **claim&lt;DUSDC&gt;** — same arg shape as `cash_out`.
- **withdraw&lt;DUSDC&gt;** — args: `manager`(object), `amount`(pure u64). Router
  transfers the resulting `Coin<DUSDC>` to `ctx.sender()`.
- **supply&lt;DUSDC&gt;** — args in order: `predict`(object `PREDICT`),
  `payment`(Coin&lt;DUSDC&gt;, a SplitCoins result), `clock`(object `0x6`). Router
  transfers the minted `Coin<PLP>` LP shares to `ctx.sender()`. No rake.
- **redeem_lp&lt;DUSDC&gt;** — args in order: `predict`(object `PREDICT`),
  `lp_coin`(Coin&lt;PLP&gt;, the LP shares to burn), `clock`(object `0x6`). Router
  transfers the resulting `Coin<DUSDC>` to `ctx.sender()`. No rake.

### Frontend wiring (`src/config.ts`)

```
ROUTER_ENABLED = true
ROUTER_PACKAGE = 0x885bc905f8c39a8a179a6013a4a688c19d94f49ae3a98653452f97dcaff9d2c3
ROUTER_CONFIG  = 0x001a7db5bacc9b2e05e8d51b8733f43280e68dea842fbb01c7c5639d512859f3
```

Each user action becomes ONE top-level `router::*` moveCall (plus native
SplitCoins/MergeCoins/TransferObjects). The `bet` path needs a funded manager +
dUSDC to exercise live; it is build + publish + ABI + admin verified. The LP
wrappers `supply` / `redeem_lp` are build + publish + ABI verified; a live LP
round-trip needs the user to hold dUSDC.
