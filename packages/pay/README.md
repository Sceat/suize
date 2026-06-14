# @suize/pay

**Accept agent payments over HTTP 402 — one middleware, vanilla x402 V2, no keys, no signup. Your Sui address is your account.**

```ts
import { suize } from "@suize/pay";

const paywall = suize({ to: "0x<your Sui address>", price: "0.10" });

Bun.serve({ fetch: paywall.wrap(handler) }); // Bun / Hono / Next route handlers
// or:
app.use(paywall.express); //               Express / Connect
```

Any client that speaks **x402 V2 `exact` on Sui** — Stripe-, Coinbase-, and Google-AP2-class agents, or a Suize wallet — pays your endpoint in USDC. You write zero wallet code, hold zero keys, and settle in USDC the instant the request lands.

## How it works

`@suize/pay` does exactly two things over HTTP:

1. **No payment → 402.** A request without a valid payment gets the x402 V2 `PaymentRequired` body (and the same JSON, base64'd, in the `PAYMENT-REQUIRED` header). The one accepted requirement declares the price, the asset (native USDC), and the fee split in `extra.outputs`; the idempotency id rides the `payment-identifier` extension.
2. **Signed payment → verify, serve, receipt.** A retry carrying the payer's signed tx in `PAYMENT-SIGNATURE` (or `X-PAYMENT`) is checked against the exact terms you issued, settled on-chain, and your handler runs — with the settlement receipt appended in `PAYMENT-RESPONSE`.

Every payment is **single-use** (one settlement, one serve), **fail-closed** (a facilitator outage returns `503` "resend the same header", never a fresh quote — so a payer never double-pays), and **terms-bound** (a tampered split is rejected before any network call).

## The fee split

The fee leg is fetched from the facilitator's `/terms` and folded into `extra.outputs` — the merchant absorbs it, so the payer sees one price. If `/terms` is unreachable, `@suize/pay` **fails open on the fee, never on the sale**: it issues a vanilla single-output quote (you absorb no fee that moment) rather than refusing to serve. A vanilla single-output requirement is the **free tier**.

## Config

```ts
suize({
  to: "0x…",            // your merchant address — settlements land here (required)
  price: "0.10",        // decimal USDC string, ≤ 6 dp, > 0 (required)
  facilitator: "https://api.suize.io",   // optional — the verify/settle/terms host
  network: "sui:testnet",                // optional — "sui:testnet" | "sui:mainnet"
  payPage: "https://pay.suize.io",       // optional — the human pay-page fallback
});
```

Returns `{ wrap, express, challenge }`:

- `wrap(handler)` — wrap a fetch-style handler.
- `express` — the Express/Connect middleware (settles before `next()`).
- `challenge(url)` — mint a fresh tracked `PaymentRequired` for a custom transport.

`mintPaymentRequired(config, opts?)` is exported for building a 402 body without the stateful tracking layer.

## Subscriptions

`@suize/pay/subs` gates premium on an on-chain subscription — read straight from the chain, no Suize store to call.

```ts
import { suize } from "@suize/pay";
import { suizeSubs } from "@suize/pay/subs";

const subs = suizeSubs({ merchant: "0x<your address>" });
const oneOff = suize({ to: "0x<your address>", price: "0.10" });

async function premium(req: Request): Promise<Response> {
  // A subscriber? Serve free. The id comes from your own session/cookie/header.
  const subId = req.headers.get("x-subscription");
  if (subId && (await subs.isActive(subId))) {
    return new Response(JSON.stringify(data));
  }
  // Not subscribed → fall through to a one-off 402 charge.
  return oneOff.wrap(() => new Response(JSON.stringify(data)))(req);
}

Bun.serve({ fetch: premium });
```

`suizeSubs({ merchant, network?, graceMs?, cacheTtlMs?, rpcUrl? })` returns:

- `isActive(subscriptionId)` — is this subscription paid up for your merchant address? (TTL-cached, fails closed on a stranger's or expired sub.)
- `status(subscriptionId)` — the full on-chain status, or `null`.
- `activeFor(owner)` — every active subscription an address holds with you.
- `findByRef(refHex)` — locate a live subscription by your own plan/customer ref.
- `watch(handler, { pollMs?, cursor? })` — stream new/renewed/cancelled events; you persist the cursor.

A cancelled subscription still carries its paid-through time, so you may keep serving a cancelled-but-not-yet-expired customer with `graceMs`.

## Guarantees

- **Non-custodial** — the payer signs locally; `@suize/pay` and the facilitator never hold a key.
- **Zero dependencies** — drop it in with nothing else.
- **The chain is the database** — verification is one tx read; the on-chain receipt is the ground truth.

MIT.
