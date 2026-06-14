# @suize/x402

x402 V2 `exact`-scheme primitives for Sui. The shared layer for charging and
paying over HTTP 402 — gasless USDC payments built on Sui Address Balances, the
exact wire types, and the facilitator's exact-fee enforcement.

Your Sui address is your account. No accounts to create, no keys to hand over:
the payer signs locally, a facilitator builds, sponsors, submits, and verifies.

## Install

```sh
npm install @suize/x402 @mysten/sui
```

## The three roles

**Merchant** — answer a 402 with a challenge, then verify the retry. The fee
split lives in `extra.outputs`; the payer's transaction must match it exactly.

```ts
import { b64json, PAYMENT_REQUIRED_HEADER, usdcAtomic } from '@suize/x402'
import type { PaymentRequired } from '@suize/x402'

const total = usdcAtomic('0.50') // 500000n atomic units
const challenge: PaymentRequired = {
  x402Version: 2,
  resource: { url: 'https://api.example.com/report' },
  accepts: [{
    scheme: 'exact',
    network: 'sui:testnet',
    asset: '0x…::usdc::USDC',
    amount: total.toString(),
    payTo: MERCHANT,
    maxTimeoutSeconds: 120,
    extra: {
      // 2% with a $0.01 floor, merchant-absorbed.
      outputs: [
        { to: MERCHANT, amount: '490000' },
        { to: SUIZE_TREASURY, amount: '10000' },
      ],
    },
  }],
}
return new Response(null, { status: 402, headers: { [PAYMENT_REQUIRED_HEADER]: b64json(challenge) } })
```

**Payer** — build the gasless payment from the declared outputs, sign it, retry.

```ts
import { grpcClient, buildGaslessOutputs, b64json, PAYMENT_SIG_HEADERS } from '@suize/x402'

const client = grpcClient(req.network)
const { bytes } = await buildGaslessOutputs({
  client,
  sender: myAddress,
  asset: req.asset,
  outputs: req.extra.outputs,
})
const { signature } = await signer.signTransaction(Buffer.from(bytes, 'base64'))
const payload = { x402Version: 2, accepted: req, payload: { signature, transaction: bytes } }
await fetch(resource, { headers: { [PAYMENT_SIG_HEADERS[0]]: b64json(payload) } })
```

**Facilitator** — recover the signer, simulate, and enforce the exact fee split
(no broadcast). The declared `outputs` are the source of truth: every recipient
is credited exactly, the payer is debited exactly the sum, and no undeclared
address may receive the asset.

```ts
import { grpcClient, recoverPayer, assertOutputsExact } from '@suize/x402'

const client = grpcClient(req.network)
const payer = await recoverPayer(payload.transaction, payload.signature)
const { debit } = await assertOutputsExact({
  client,
  txBytesB64: payload.transaction,
  asset: req.asset,
  outputs: req.extra.outputs,
  expectedPayer: payer,
}) // throws OutputsError (code = x402 invalidReason) on any mismatch
```

For payers signing facilitator-built bytes, `assertUnsignedBytesSafe` is the
mandatory pre-sign guard: it proves the bytes are gasless, sent by the expected
sender, and pay exactly the declared split before a signature is ever produced.

## Idempotency

The optional `payment-identifier` extension carries an idempotency key at
`extensions["payment-identifier"].info.id`. Use `mintPaymentId()` to generate
one, `withPaymentId()` to attach it, and `paymentIdOf()` to read it back.

## License

MIT
