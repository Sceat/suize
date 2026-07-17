# x402 Sui facilitator

An open, **free-to-run** [x402](https://github.com/x402-foundation/x402) V2 **`exact`** payment
facilitator for [Sui](https://sui.io), packaged as a stateless [Cloudflare
Worker](https://developers.cloudflare.com/workers/). Fork it, point it at your own treasury,
`wrangler deploy`, and you are running an x402 facilitator that verifies and settles gasless
USDC payments on Sui.

It is **keyless**: the facilitator never holds a private key. A payer signs a gasless
Address-Balance `send_funds` transaction; the facilitator *simulates* it to prove it pays exactly
the fee split, then *broadcasts* the payer-signed bytes. There is no custody, no server-minted
state, **the chain is the database.**

```
run your own:  git clone https://github.com/Sceat/suize  →  set FEE_TREASURY  →  npx wrangler deploy
```

Suize's own product, [Suize Deploy](../deploy-worker), is just a merchant on the live instance
below, no special access, the same rail anyone can fork and run.

## Try it now

The live instance answers these two `GET`s with no setup, so you can see the real shape before
you write a line of code:

```bash
curl https://facilitator.suize.io/health
# {"ok":true,"scheme":"exact","network":"sui:mainnet"}

curl https://facilitator.suize.io/supported
# {"kinds":[{"x402Version":2,"scheme":"exact","network":"sui:mainnet","extra":{
#   "assetTransferMethod":"address-balance","feeBps":200,"feeFloor":10000,
#   "treasury":"0x9036f4be5ca0d0c2b890f12b398c032a00952aa41c2776507db0d018002373a7"}}],
#  "extensions":["payment-identifier"],"signers":{"sui:*":[]},"ready":true}
```

## Endpoints

Four endpoints, spec-pure. Nothing else.

| Method + path   | Purpose |
| --------------- | ------- |
| `GET  /health`    | Liveness. `{ ok, scheme, network }`. No network calls. |
| `GET  /supported` | Capability descriptor + the **published fee policy** merchants use to compute their splits. |
| `POST /verify`    | Verify a signed-but-not-executed payment pays the recomputed split. Pure read (simulate only). |
| `POST /settle`    | Broadcast a verified payment and await finality. Idempotent by transaction digest. |

`/verify` and `/settle` take a JSON body of `{ paymentPayload, paymentRequirements }` (the x402 V2
envelope). A definitive rejection is a **200** with `{ isValid: false, invalidReason }` (verify) or
`{ success: false, errorReason }` (settle), the protocol carries the reason in the body; only a
malformed request is a `4xx`.

### `GET /supported`

```jsonc
{
  "kinds": [
    {
      "x402Version": 2,
      "scheme": "exact",
      "network": "sui:testnet",
      "extra": {
        "assetTransferMethod": "address-balance",
        "feeBps": 200,            // your default rake (basis points)
        "feeFloor": 10000,        // your minimum fee (atomic USDC units; 10000 = $0.01)
        "treasury": "0x…"         // where the fee lands (resolved)
      }
    }
  ],
  "extensions": ["payment-identifier"],
  "signers": { "sui:*": [] },
  "ready": true                   // false when the treasury can't be resolved (fail-closed)
}
```

A merchant reads `extra` and builds a 402 whose declared outputs are the split
`[{ merchant, amount − fee }, { treasury, fee }]`. The payer's transaction must credit those legs
**exactly** or `/verify` rejects it.

---

## The fee policy (operator-owned)

**You own the fee.** It is set entirely by environment variables, there is no Suize account, no
gatekeeper, no revenue share to anyone but you. You can even run it fee-free (`FEE_BPS=0`,
`FEE_FLOOR=0`), that's a legitimate choice for an operator; what nobody can do is *bypass* whatever
you've configured.

- The fee for a payment of `amount` (atomic USDC units, 6 decimals) is:

  ```
  fee = min( max( amount × FEE_BPS / 10000, FEE_FLOOR ), amount − 1 )
  ```

  The declared split is `[{ payTo, amount − fee }, { FEE_TREASURY, fee }]`.

- **The fee is enforced at `/verify`, not merely advertised.** The facilitator **recomputes** the
  canonical split from *your* policy and asserts the payer's simulated transaction credits it
  exactly, a payer-declared or merchant-declared output set is **never trusted**. A payment that
  tries to pay the merchant in full and skip the treasury leg is rejected
  (`invalid_exact_sui_payload_outputs_mismatch`). It also rejects any **undeclared** recipient of
  the asset (the skim cheat-vector) and any payer debit that isn't exactly the sum of the split.

- **No hidden exemptions.** `MERCHANT_RATES` only *customizes* a merchant's rate; a merchant with
  no entry pays `FEE_BPS`. The only single-output results are *structural*, when the merchant **is**
  the treasury (first-party income), or a sub-unit amount too small to carve a fee without a zero
  leg.

- **Fail-closed treasury.** If `FEE_TREASURY` is a SuiNS name that can't be resolved (or is unset),
  the facilitator refuses to mint a split, `/supported` reports `ready: false` and every payment
  fails closed. It never mis-routes your fee to an unknown address. A plain `0x…` address is used
  as-is and is always ready.

---

## Configuration

All non-secret (there are no secrets, the facilitator holds no key). Set these as
`wrangler.toml` `[vars]`, or in `.dev.vars` for local dev.

| Variable        | Required | Default    | Meaning |
| --------------- | :------: | ---------- | ------- |
| `FEE_TREASURY`  | **yes**  | none       | Where the fee lands. A plain `0x…` Sui address (used as-is) **or** a SuiNS name (`treasury@your-org`, `your-org.sui`) resolved live over gRPC, hourly-cached, fail-closed. |
| `FEE_BPS`       | no       | `200`      | Default rake in basis points (`200` = 2%). |
| `FEE_FLOOR`     | no       | `10000`    | Minimum fee in atomic USDC units (`10000` = $0.01 at 6 dp). |
| `MERCHANT_RATES`| no       | none       | JSON map of per-merchant overrides: `{"0x<addr>":{"feeBps":100}}`. A malformed entry is skipped (logged), never fatal. |
| `SUI_NETWORK`   | no       | `testnet`  | `testnet` or `mainnet`. |
| `SUI_GRPC_URL`  | no       | public fullnode | Override the gRPC base url. |

---

## Quickstart (5 minutes)

```bash
# 1. Get the code.
git clone https://github.com/Sceat/suize && cd suize/services/facilitator

# 2. Install (Bun).
bun install

# 3. Point it at your treasury for local dev.
cp .dev.vars.example .dev.vars
#   edit .dev.vars → set FEE_TREASURY to your 0x address or SuiNS name

# 4. Run it locally.
npx wrangler dev --port 8801
curl localhost:8801/health
curl localhost:8801/supported     # confirm your fee policy + "ready": true

# 5. Ship it.
#   edit wrangler.toml → set FEE_TREASURY (and account_id / routes for your CF account)
npx wrangler deploy                # testnet
npx wrangler deploy --env mainnet  # mainnet
```

Then a merchant points its x402 middleware at `https://<your-worker>/verify` and
`/settle`, and reads `/supported` for your fee policy. That's it.

### Tests

```bash
bun test        # 26 passing, offline, pure split math, /supported shape, verify enforcement (mock transport)
bun run typecheck
```

---

## Rate limiting

The Worker ships **no real rate limiter**, that is the edge's job, and doing it in-isolate would
be theatre (each isolate is one of many and is recycled). Attach a **Cloudflare WAF / rate-limiting
rule** to the Worker route (per-IP, per-path), the right layer, zero code. The tiny per-isolate
guard in `src/http.ts` is a best-effort flood shaver only; do not rely on it.

---

## How it works

- **Gasless, Address-Balance.** Payments use Sui's protocol-level gasless transfers: the payer
  signs a `send_funds` PTB with `gasPrice = 0` and `gasPayment = []`. No fee object, no sponsor,
  *your address is your account.* The facilitator asserts this shape before it trusts anything.
- **Verify = simulate + exact-split.** The signed tx is *simulated* (never broadcast), and its USDC
  balance changes must match the recomputed split exactly; the recovered signer must equal the
  simulated sender (no proxy debits).
- **Settle = keyless, idempotent broadcast.** The transaction digest is the payment's identity. An
  already-executed digest returns its on-chain result without re-broadcasting; concurrent settles of
  the same digest join one in-flight request. A replay never double-charges, the chain is the guard.

The shared wire types + enforcement live in [`@suize/x402`](../../packages/x402), so an
external fork depends on a published package rather than copying verify code.

---

Built and maintained alongside [Suize](https://suize.io). MIT licensed, run your own, keep your fee.
