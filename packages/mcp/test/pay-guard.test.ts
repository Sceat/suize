// The NUMBER WALL guard — proves the MCP will NOT sign a payment whose terms
// don't equal the price it derived LOCALLY from @suize/shared. This is the money
// safety that stops a hostile / MITM'd charge door (SUIZE_API is an env override)
// from quoting an arbitrary amount to an arbitrary address and having the blind
// local signer drain the key's whole USDC balance. Pure — no network, no key.
import { afterEach, expect, test } from 'bun:test'
import { assertQuote, encodeHeader, postPaid } from '../src/deploy'
import { USDC_TYPE } from '../src/config'
import { deployPriceUsdc } from '@suize/shared'

const price = (months: number, sealed: boolean): bigint => BigInt(deployPriceUsdc(months, sealed))

const challenge = (
  amount: string,
  outputs: { to: string; amount: string }[],
  asset: string = USDC_TYPE,
) => ({ accepts: [{ asset, amount, extra: { outputs } }] })

const ATTACKER = '0x' + 'a'.repeat(64)
const MERCHANT = '0x' + '1'.repeat(64)
const TREASURY = '0x' + '2'.repeat(64)

test('assertQuote REJECTS an over-priced quote — the drain attack', () => {
  // A hostile charge door quotes 50,000 USDC to the attacker's own address; the
  // real deploy price is $0.10. The guard must refuse before any signing.
  const attack = challenge('50000000000', [{ to: ATTACKER, amount: '50000000000' }])
  expect(() => assertQuote(attack, price(1, false))).toThrow(/price mismatch/)
})

test('assertQuote REJECTS when the outputs match but the top-line amount is inflated', () => {
  const expected = price(1, false)
  const c = challenge('50000000000', [{ to: MERCHANT, amount: String(expected) }])
  expect(() => assertQuote(c, expected)).toThrow(/price mismatch/)
})

test('assertQuote REJECTS a substituted settlement asset', () => {
  const expected = price(1, false)
  const c = challenge(String(expected), [{ to: MERCHANT, amount: String(expected) }], '0xdead::coin::COIN')
  expect(() => assertQuote(c, expected)).toThrow(/settlement asset/)
})

test('assertQuote REJECTS a challenge with no payment terms', () => {
  expect(() => assertQuote({ accepts: [] } as never, price(1, false))).toThrow(/payment terms/)
})

test('assertQuote ACCEPTS a correctly-priced multi-output quote and returns the terms', () => {
  // 2 months, sealed → 2 × 2 × $0.10 = $0.40, split merchant + treasury fee.
  const expected = price(2, true)
  expect(expected).toBe(400_000n)
  const fee = 8_000n // 2% — the split shape; the guard only cares the sum matches
  const c = challenge(String(expected), [
    { to: MERCHANT, amount: String(expected - fee) },
    { to: TREASURY, amount: String(fee) },
  ])
  const { accepted, outputs } = assertQuote(c, expected)
  expect(BigInt(accepted.amount)).toBe(expected)
  expect(outputs.reduce((s, o) => s + BigInt(o.amount), 0n)).toBe(expected)
})

test('the accepted (correct-price) quote assembles into a signable X-PAYMENT header', () => {
  const expected = price(1, false)
  const c = challenge(String(expected), [{ to: MERCHANT, amount: String(expected) }])
  const { accepted } = assertQuote(c, expected)
  const header = encodeHeader(accepted, 'BASE64SIGNATURE', 'BASE64TXBYTES')
  const decoded = JSON.parse(atob(header))
  expect(decoded.x402Version).toBe(2)
  expect(decoded.accepted).toEqual(accepted)
  expect(decoded.payload).toEqual({ signature: 'BASE64SIGNATURE', transaction: 'BASE64TXBYTES' })
})

// ── postPaid: a transient post-payment failure re-sends the SAME X-PAYMENT ─────
// The double-charge fix on the client side: a settle/broadcast timeout (the tx may
// have LANDED) or a worker 5xx is re-POSTed with the IDENTICAL signed header — never
// re-signed — because the rail is idempotent by payment digest.
const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

test('postPaid re-sends the SAME X-PAYMENT once on a transient 402 settle failure, then succeeds', async () => {
  const HEADER = 'BASE64_XPAYMENT_HEADER'
  const seen: string[] = []
  let n = 0
  globalThis.fetch = (async (_url: unknown, init: { headers: Record<string, string> }) => {
    seen.push(init.headers['X-PAYMENT'])
    n++
    if (n === 1) {
      return new Response(JSON.stringify({ error: 'broadcast failed: The operation was aborted due to timeout' }), { status: 402 })
    }
    return new Response(JSON.stringify({ siteId: '0xabc', url: 'https://x.suize.site' }), { status: 200 })
  }) as unknown as typeof fetch

  const { res, body } = await postPaid(
    () => fetch('https://api.suize.site/deploy?months=1', { method: 'POST', headers: { 'X-PAYMENT': HEADER } }),
    0, // no delay in the test
  )
  expect(res.status).toBe(200)
  expect(body.siteId).toBe('0xabc')
  expect(seen).toEqual([HEADER, HEADER]) // same header both times — never rebuilt/re-signed
})

test('postPaid does NOT retry a plain unpaid 402 challenge (terminal for the same header)', async () => {
  let n = 0
  globalThis.fetch = (async () => {
    n++
    return new Response(JSON.stringify({ error: 'payment required. Suize: the payment IS the authorization' }), { status: 402 })
  }) as unknown as typeof fetch

  const { res } = await postPaid(() => fetch('https://api.suize.site/deploy?months=1', { method: 'POST', headers: { 'X-PAYMENT': 'H' } }), 0)
  expect(res.status).toBe(402)
  expect(n).toBe(1) // a fresh challenge is not a transient settle failure — no retry
})
