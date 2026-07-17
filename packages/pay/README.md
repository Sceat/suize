# @suize/pay

**Accept agent payments over HTTP 402, one middleware, x402-compatible by design, no keys, no signup. Your Sui address is your account.**

```ts
import { suize } from "@suize/pay";

const paywall = suize({ to: "0x<your Sui address>", price: "0.10" });

Bun.serve({ fetch: paywall.wrap(handler) }); // Bun / Hono / Next route handlers
// or:
app.use(paywall.express); //               Express / Connect
```

Any client that speaks **x402 V2 `exact` on Sui**, an agent with its own key, an MCP session, or a Sui SDK, pays your endpoint in USDC. You write zero wallet code, hold zero keys, and settlement lands the instant the request lands.

## Install

```sh
npm install @suize/pay
```

Zero runtime dependencies. The x402 wire types are mirrored inline rather than imported from a workspace package, so installing this pulls in nothing else.

## How it works

`@suize/pay` does exactly two things over HTTP:

1. **No payment, 402.** A request without a valid payment gets the x402 V2 `PaymentRequired` body (and the same JSON, base64'd, in the `PAYMENT-REQUIRED` header). The one accepted requirement declares the price, the asset (native USDC), and the fee split in `extra.outputs`; the idempotency id rides the `payment-identifier` extension.
2. **Signed payment, verify, serve, receipt.** A retry carrying the payer's signed transaction in `PAYMENT-SIGNATURE` (or `X-PAYMENT`) is checked against the exact terms you issued, settled on-chain through a facilitator, and your handler runs, with the settlement receipt appended in `PAYMENT-RESPONSE`.

Every payment is **single-use** (one settlement, one serve), **fail-closed** (a facilitator outage returns `503` "resend the same header", never a fresh quote, so a payer never double-pays), and **terms-bound** (a tampered split is rejected before any network call).

## The fee split

The fee leg is folded into `extra.outputs`, so the payer sees one price and you never touch a second wallet. `@suize/pay` is fail-closed: if it can't resolve the canonical split, it answers `503` rather than issue an unpriced quote, and a facilitator recomputes and enforces the fee at `/verify` regardless, so a missing or tampered fee leg never slips a payment through unbilled. A single-output requirement is **structural** (merchant equals treasury), never a free tier.

## Config

```ts
suize({
  to: "0x…",            // your merchant address, settlements land here (required)
  price: "0.10",         // decimal USDC string, up to 6 dp, greater than 0 (required)
  facilitator: "https://facilitator.suize.io", // optional, the verify/settle/supported host
  network: "sui:testnet",              // optional, "sui:testnet" | "sui:mainnet"
});
```

Returns `{ wrap, express, challenge }`:

- `wrap(handler)`, wrap a fetch-style handler.
- `express`, the Express/Connect middleware (settles before `next()`).
- `challenge(url)`, mint a fresh tracked `PaymentRequired` for a custom transport.

`mintPaymentRequired(config, opts?)` is also exported, for minting a 402 body directly without the stateful tracking layer, the building block a merchant that already computes its own split (say, from a facilitator's `GET /supported`) passes `outputs` into.

## Guarantees

- **Non-custodial**, the payer signs locally; `@suize/pay` and the facilitator never hold a key.
- **Zero dependencies**, drop it in with nothing else.
- **The chain is the database**, verification is one transaction read; the on-chain receipt is the ground truth.

## License

MIT
