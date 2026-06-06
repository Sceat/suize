# crash_sui — single sponsored-path router for DeepBook Predict

A thin Move package whose `router` module is the **only** move-call target every
user action flows through. The app sponsors gas via Enoki, and Enoki scopes
sponsorship with an `allowedMoveCallTargets` allowlist (one entry per
`{pkg}::module::function`). By folding **every** user action — manager creation,
betting, cashing out, claiming, withdrawing, and providing/redeeming LP ("being
the house") — into a `crash_sui::router::*` wrapper, the Enoki allowlist need
only contain **our seven targets**. Sponsored gas can therefore never reach a raw
`predict::mint` (which would skip the rake) or any other off-path call,
because those targets are simply not on the allowlist.

The rake is enforced atomically **inside** `bet`: it is skimmed in the
same Move call that places the bet, so it is unavoidable **on the sponsored path** —
anyone using the router gets rake'd, and the Enoki allowlist (above) means a
**sponsored** tx can only ever reach `router::*`, never a raw `predict::mint`. The
rake is **not** unavoidable for a **self-payer**: a user paying their own gas can
build a tx that calls `predict::mint` directly and skip the router (and the rake)
entirely — the contract cannot prevent that. So the rake is non-bypassable on the
Enoki-gated path, not at the protocol level. The treasury + rate live in an
on-chain shared `Config` that only our `AdminCap` can mutate, and no treasury
address ever lives in client code. Precisely:
the rake is **3% (300 bps) of the pre-trade quoted cost** (`predict::get_trade_amounts`),
withdrawn from the manager *before* `predict::mint` pulls the actual post-trade
mint cost. So the platform collects 3% of the *quote*, not exactly 3% of what the
user ends up paying — it slightly under-collects on price drift and never
overcharges the user.

## Testnet vs. mainnet (read this)

**This source is the version-gated + accumulator-rake package** (gated from
`init`, rake routed via `coin::send_funds`). It is now **freshly published to
testnet too** — the prior ungated testnet demo is retired, and the deployed IDs
below point at the NEW gated package. The same source is the mainnet form.

Because adding the required `version: &Version` arg changes the seven public
signatures (which the `compatible` upgrade policy forbids), the gated package is
**published fresh** (a brand-new original-id), not upgraded over the old one — on
testnet now and on mainnet later.

A fresh publish auto-creates and shares the `Version` singleton in `init` at
`PACKAGE_VERSION`, so the seven user functions are gated from block one — no
bootstrap call. After a fresh publish: the dapp **repoints to the new package
id** and adds `version: &Version` as the **first** PTB argument to the seven
router calls, and the **@suize backend Enoki allowlist targets move to the new
package id**. Admin recovery (`migrate` / `freeze_all`, `set_fee_*`) is
deliberately NOT version-gated, so it keeps working even while the package is
frozen.

## Deployed IDs (Sui testnet — fresh gated + accumulator publish)

| Thing | ID |
| ----- | -- |
| **Package** | `0xcd1f6af85936cd3bc09267133a8d341eca9dc5961270496f7dbe74c0ebd31e19` |
| **Config** (shared; `fee_bps=300`, `fee_recipient=deployer`) | `0x66bdf9a8050573d46d409d32ff0b19cd5983a082d4326289709057f68c14f5ee` |
| **Version** (shared; `value=1`) | `0x6f0247af6e7b0580c7891771dd8a15469df4035a822a6e050871b12d1afc72a4` |
| **AdminCap** (owned by deployer) | `0xf41787566604bdc0218a78d222a5a825cdf5660e31abb7e2ce42faa29b4c3528` |
| **UpgradeCap** (owned by deployer) | `0xbbb53a32aead317348559e51fc04db796bb6468f8cfdcf1c4e825af8d886b9e1` |
| **AdminCap owner / deployer** | `0x087aa862ca645c0b94400c49e11b491011fca35db837361ccfc4c6f69d356e86` |
| Publish tx digest | `7FH2MnfMyUpQnm87JcMRq33GMRBfmHFJeNommxAbexoq` |

Links to the live DeepBook Predict package
`0xf5ea2b3749c65d6e56507cc35388719aadb28f9cab873696a2f8687f5c785138` —
**verified on-chain** (`sui_getNormalizedMoveFunction`): every `router::*`
parameter type resolves only to that package and the framework (`0x1`/`0x2`); no
deepbook/token address leaks into the ABI.

## The seven user-action functions (the ONLY sponsored targets)

All are `public fun` (NOT `entry`) so they are PTB-composable and accept `ID`
args via `tx.pure.id`. Enoki gates on the move-call **target**, independent of
`entry`-ness.

Every one takes `version: &Version` as the **first** parameter and asserts it
before doing anything (the version gate).

```move
// 1. One-time manager creation. Returns the new shared PredictManager's ID.
public fun create_manager(version: &Version, ctx: &mut TxContext): ID

// 2. The ONE top-level call per bet. Deposits payment, builds the key, skims
//    3% of the quoted cost to the treasury, and mints — all internally.
public fun bet<Quote>(
    version: &Version,
    config: &Config,
    predict: &mut Predict,
    manager: &mut PredictManager,
    oracle: &OracleSVI,
    oracle_id: ID,
    expiry: u64,
    strike: u64,
    is_up: bool,
    quantity: u64,
    payment: Coin<Quote>,
    clock: &Clock,
    ctx: &mut TxContext,
)

// 3. Early cash-out of a live position. Payout -> manager balance. No rake.
public fun cash_out<Quote>(
    version: &Version, predict: &mut Predict, manager: &mut PredictManager,
    oracle: &OracleSVI, oracle_id: ID, expiry: u64, strike: u64, is_up: bool,
    quantity: u64, clock: &Clock, ctx: &mut TxContext,
)

// 4. Claim a settled position permissionlessly. Payout -> manager balance. No rake.
public fun claim<Quote>(
    version: &Version, predict: &mut Predict, manager: &mut PredictManager,
    oracle: &OracleSVI, oracle_id: ID, expiry: u64, strike: u64, is_up: bool,
    quantity: u64, clock: &Clock, ctx: &mut TxContext,
)

// 5. Pull `amount` of the manager's internal balance back to the caller's wallet.
public fun withdraw<Quote>(
    version: &Version, manager: &mut PredictManager, amount: u64, ctx: &mut TxContext,
)

// 6. "Be the house": supply dUSDC into Predict's shared LP vault; PLP shares
//    are minted and sent to the supplier. No rake (LPing is not a bet).
public fun supply<Quote>(
    version: &Version, predict: &mut Predict, payment: Coin<Quote>,
    clock: &Clock, ctx: &mut TxContext,
)

// 7. Burn PLP shares, return the underlying dUSDC to the LP. Named `redeem_lp`
//    to avoid colliding with `withdraw` (manager balance). No rake.
public fun redeem_lp<Quote>(
    version: &Version, predict: &mut Predict, lp_coin: Coin<PLP>,
    clock: &Clock, ctx: &mut TxContext,
)
```

Admin + reads (NOT sponsored; the deployer calls these directly):

```move
public struct Config has key { id: UID, fee_bps: u64, fee_recipient: address } // shared
public struct AdminCap has key, store { id: UID }                              // deployer-held

public entry fun set_fee_recipient(_: &AdminCap, config: &mut Config, recipient: address)
public entry fun set_fee_bps(_: &AdminCap, config: &mut Config, bps: u64) // asserts bps <= 1000
public fun fee_bps(config: &Config): u64
public fun fee_recipient(config: &Config): address
```

### How `bet` enforces the rake

1. Deposits the caller's `payment` coin fully into the manager
   (`predict_manager::deposit`). The client sizes `payment` to cover
   `cost + rake` (~108%) by splitting exactly the shortfall via a native
   `SplitCoins` in the same PTB; a zero-value coin deposits harmlessly when the
   manager already holds enough.
2. Builds the `MarketKey` internally from `(oracle_id, expiry, strike, is_up)`
   (`MarketKey` has `copy`, reused for quote + mint).
3. Quotes the cost via `predict::get_trade_amounts`.
4. `rake = cost * fee_bps / 10_000`; if non-zero, withdraws it from the manager
   (`withdraw` asserts caller == owner) and routes it to the treasury via
   `coin::send_funds` (Sui Address Balances), not a fresh owned Coin object.
5. `predict::mint` pulls `cost` from the manager's internal balance.

## Enoki allowlist (the EXACT seven targets)

```
0xcd1f6af85936cd3bc09267133a8d341eca9dc5961270496f7dbe74c0ebd31e19::router::create_manager
0xcd1f6af85936cd3bc09267133a8d341eca9dc5961270496f7dbe74c0ebd31e19::router::bet
0xcd1f6af85936cd3bc09267133a8d341eca9dc5961270496f7dbe74c0ebd31e19::router::cash_out
0xcd1f6af85936cd3bc09267133a8d341eca9dc5961270496f7dbe74c0ebd31e19::router::claim
0xcd1f6af85936cd3bc09267133a8d341eca9dc5961270496f7dbe74c0ebd31e19::router::withdraw
0xcd1f6af85936cd3bc09267133a8d341eca9dc5961270496f7dbe74c0ebd31e19::router::supply
0xcd1f6af85936cd3bc09267133a8d341eca9dc5961270496f7dbe74c0ebd31e19::router::redeem_lp
```

These are the only `allowedMoveCallTargets` the Enoki app needs. Native PTB
commands (SplitCoins / MergeCoins / TransferObjects) are **not** individually
allowlisted by Enoki — only `moveCall` targets are (verified against
`@mysten/enoki` 1.0.8: `CreateSponsoredTransactionApiInput` carries only
`allowedMoveCallTargets?: string[]` and `allowedAddresses?: string[]`; the
sponsor request body sends just those plus the full TransactionKind bytes and
gates by move-call target). So a PTB that does `SplitCoins` + `router::bet` is
fully sponsorable with just the seven targets above.

## Admin model

- The **AdminCap** is an owned object held by the deployer
  (`0x087aa862ca645c0b94400c49e11b491011fca35db837361ccfc4c6f69d356e86`). Only
  its holder can call `set_fee_bps` / `set_fee_recipient`. Authority is the
  capability itself — there is no address-based check.
- The **Config** is a shared object so every `bet` caller can read it; only the
  AdminCap holder can mutate it.
- `set_fee_bps` caps the fee at **1000 bps (10%)** (`EFEE_TOO_HIGH`).
- **Verified live on testnet**: `set_fee_bps` round-trip 300 → 400 → 300, reading
  the shared Config back at the end (300 → 400 digest
  `BsfmTJgdoHv3J1YWWyUieFCUZ7vCMF4V11yci4sqeobf`; 400 → 300 digest
  `HYkEa3RSVMgk3J7wigQ5Y8AYMkTruJZUHmPC5dKQaMnw`, read-back `fee_bps == 300`,
  restored).

## Frontend call shapes

Type argument for every generic fn is `Quote = DUSDC`
(`0xe95040085976bfd54a1a07225cd46c8a2b4e8e2b6732f140a0fc49850ba73e1a::dusdc::DUSDC`).
`CLOCK` = `0x6`, `PREDICT` (shared) =
`0xc8736204d12f0a7277c86388a68bf8a194b0a14c5538ad13f22cbd8e2a38028a`.

> NOTE: every router call below now takes the shared `Version` object as its
> **first** argument (`tx.object(VERSION)`), inserted ahead of the args shown.
> The version gate asserts it before anything else.

```ts
const ROUTER = '0xcd1f6af85936cd3bc09267133a8d341eca9dc5961270496f7dbe74c0ebd31e19'
const CONFIG = '0x66bdf9a8050573d46d409d32ff0b19cd5983a082d4326289709057f68c14f5ee'
const VERSION = '0x6f0247af6e7b0580c7891771dd8a15469df4035a822a6e050871b12d1afc72a4'

// 1) create_manager — own tx, read new manager id from objectChanges
tx.moveCall({
  target: `${ROUTER}::router::create_manager`,
  arguments: [tx.object(VERSION)],
})

// 2) bet — the single top-level call; SplitCoins funds the payment coin
const [payment] = tx.splitCoins(srcCoin, [tx.pure.u64(fundAmount)]) // native, not allowlisted
tx.moveCall({
  target: `${ROUTER}::router::bet`,
  typeArguments: [DUSDC],
  arguments: [
    tx.object(CONFIG),          // config   : &Config            (object, shared)
    tx.object(PREDICT),         // predict  : &mut Predict        (object, shared)
    tx.object(managerId),       // manager  : &mut PredictManager (object, shared)
    tx.object(oracleId),        // oracle   : &OracleSVI          (object, shared)
    tx.pure.id(oracleId),       // oracle_id: ID                  (pure)
    tx.pure.u64(expiryMs),      // expiry   : u64                 (pure)
    tx.pure.u64(strike1e9),     // strike   : u64                 (pure)
    tx.pure.bool(isUp),         // is_up    : bool                (pure)
    tx.pure.u64(quantity),      // quantity : u64                 (pure, 1e6-scaled)
    payment,                    // payment  : Coin<Quote>         (coin, SplitCoins result)
    tx.object(CLOCK),           // clock    : &Clock              (object, 0x6)
  ],
})

// 3) cash_out — early redeem
tx.moveCall({
  target: `${ROUTER}::router::cash_out`,
  typeArguments: [DUSDC],
  arguments: [
    tx.object(PREDICT), tx.object(managerId), tx.object(oracleId),
    tx.pure.id(oracleId), tx.pure.u64(expiryMs), tx.pure.u64(strike1e9),
    tx.pure.bool(isUp), tx.pure.u64(quantity), tx.object(CLOCK),
  ],
})

// 4) claim — settled redeem (same arg shape as cash_out)
tx.moveCall({
  target: `${ROUTER}::router::claim`,
  typeArguments: [DUSDC],
  arguments: [
    tx.object(PREDICT), tx.object(managerId), tx.object(oracleId),
    tx.pure.id(oracleId), tx.pure.u64(expiryMs), tx.pure.u64(strike1e9),
    tx.pure.bool(isUp), tx.pure.u64(quantity), tx.object(CLOCK),
  ],
})

// 5) withdraw — pull manager balance to wallet (router transfers to sender)
tx.moveCall({
  target: `${ROUTER}::router::withdraw`,
  typeArguments: [DUSDC],
  arguments: [tx.object(managerId), tx.pure.u64(amount)], // manager: object, amount: pure u64
})

// 6) supply — "be the house": deposit dUSDC into the LP vault. PLP shares are
//    minted by Predict and transferred to the sender by the router.
const [lpPayment] = tx.splitCoins(srcCoin, [tx.pure.u64(supplyAmount)]) // native
tx.moveCall({
  target: `${ROUTER}::router::supply`,
  typeArguments: [DUSDC],
  arguments: [
    tx.object(PREDICT),  // predict : &mut Predict (object, shared)
    lpPayment,           // payment : Coin<Quote>  (coin, SplitCoins result of DUSDC)
    tx.object(CLOCK),    // clock   : &Clock        (object, 0x6)
  ],
})

// 7) redeem_lp — burn PLP shares, get dUSDC back (router transfers to sender)
const [lpCoin] = tx.splitCoins(plpSrcCoin, [tx.pure.u64(sharesToBurn)]) // native; PLP coin
tx.moveCall({
  target: `${ROUTER}::router::redeem_lp`,
  typeArguments: [DUSDC],
  arguments: [
    tx.object(PREDICT),  // predict : &mut Predict (object, shared)
    lpCoin,              // lp_coin : Coin<PLP>     (coin, PLP shares)
    tx.object(CLOCK),    // clock   : &Clock        (object, 0x6)
  ],
})
```

`PLP` (the LP-share coin type returned by `supply` / consumed by `redeem_lp`) is
`0xf5ea2b3749c65d6e56507cc35388719aadb28f9cab873696a2f8687f5c785138::plp::PLP`.

The `bet` path needs a funded manager + dUSDC to exercise end-to-end; it is
build + publish + ABI + admin verified. A live bet additionally needs the user
to hold dUSDC and a live (non-paused, in-bounds) oracle. Likewise `supply` /
`redeem_lp` are build + publish + ABI verified; a live LP round-trip needs the
user to hold dUSDC.

## Building / testing / deploying

```bash
cd move
sui move build   # exit 0, warning-free
sui move test    # 6 tests pass (admin round-trip + over-cap abort + rake math
                 #               + version assert pass/freeze + migrate guard)
./deploy.sh      # builds + publishes; prints ROUTER_PACKAGE / ROUTER_CONFIG / AdminCap
```

Build is fully offline/reproducible. `deploy.sh` works for this package (it greps
`objectChanges` for the published package, the `::router::Config`, and the
`AdminCap`). NOTE: a fresh `sui client publish` requires the prior
`[published.testnet]` entry in `Published.toml` to be absent (the CLI refuses to
re-publish an already-recorded package); remove that entry to redeploy as a new
package.

## Dependency wiring

DeepBook Predict deps are vendored under `move/deps/{predict,deepbook,token}`
(clones of the `predict-testnet-4-16` branch). `deps/predict/Move.toml` pins both
`published-at` and the `deepbook_predict` named address to the live publish
`0xf5ea2b3749c65d6e56507cc35388719aadb28f9cab873696a2f8687f5c785138`, so the
router **links** against the on-chain predict package instead of recompiling it.
`deepbook`/`token` are transitive deps (address `0x0`) the router never calls
directly; they compile as bundled source but do not leak into the router ABI
(verified). `crash_sui = "0x0"` in this package's `[addresses]`; MoveStdlib / Sui
framework are auto-injected and pinned to `testnet` in `Move.lock`.

## Files

- `move/Move.toml` — package manifest.
- `move/deploy.sh` — redeploy helper.
- `move/sources/router.move` — the `router` module (7 version-gated user fns,
  admin setters + version lifecycle, reads, `init`, and 3 unit tests: rake math,
  admin round-trip, over-cap abort). `bet`/`supply`/`redeem_lp` lack a full
  unit test on purpose: Predict's only `Predict`/`Currency` constructors are
  `#[test_only] public(package)` to `deepbook_predict` and thus unreachable from
  this package; those paths are verified on-chain instead, not faked in a test.
- `move/sources/version.move` — the `version` gate (`Version` object,
  `assert_latest`, package-internal create/migrate/freeze) + 3 unit tests:
  assert pass at current, abort when frozen, migrate guard rejects when current.
- `move/deps/{predict,deepbook,token}/` — vendored DeepBook Predict source deps.
