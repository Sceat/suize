// The never-re-pay rule: a SECOND 402 after a payment was presented must be
// REPORTED, never re-settled (re-paying double-charges). We mock the session,
// the epoch check, and settle402 so no chain/signing runs, then drive suize_pay's
// paid-fetch loop with a stubbed global fetch and assert settle402 fires EXACTLY
// once across the 402 → pay → second-402 sequence.
import { afterEach, beforeEach, expect, mock, test } from 'bun:test'

const FAKE_SESSION = {
  version: 1 as const,
  provider: 'google' as const,
  network: 'testnet' as const,
  address: '0x' + '1'.repeat(64),
  publicKey: null,
  maxEpoch: 999_999,
  expiresAt: Date.now() + 3_600_000,
  randomness: 'r',
  ephemeralKeyPair: 'e',
  proof: {} as any,
}

// settle402 call counter — the heart of the assertion.
let settleCalls = 0

const realSession = await import('../src/session')
mock.module('../src/session', () => ({
  ...realSession,
  requireSession: () => FAKE_SESSION,
}))

mock.module('../src/chain', () => ({
  // epoch read used by assertEpochLive — keep the session live.
  grpcClient: () => ({ core: { getCurrentSystemState: async () => ({ systemState: { epoch: '1' } }) } }),
  // tx-history helper (reads.ts) — unused here, present so the mocked module is complete.
  graphqlQuery: async () => ({}),
}))

// Keep the real pure exports (pickRequirement/makeConfirmGate/ConfirmationRequired
// — other test files import these) and ONLY override settle402 with a counting stub.
const realX402 = await import('../src/x402-client')
mock.module('../src/x402-client', () => ({
  ...realX402,
  settle402: async () => {
    settleCalls++
    return {
      payload: { x402Version: 2, accepted: {}, payload: { signature: 'sig', transaction: 'tx' } },
      headerValue: 'BASE64PAYLOAD',
      requirement: {},
      units: 500_000n,
    }
  },
}))

const { suizePay } = await import('../src/pay')

const challengeBody = JSON.stringify({
  x402Version: 2,
  accepts: [
    {
      scheme: 'exact',
      network: 'sui:testnet',
      amount: '500000',
      asset: '0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC',
      payTo: '0x' + 'a'.repeat(64),
      maxTimeoutSeconds: 120,
      extra: { outputs: [{ to: '0x' + 'a'.repeat(64), amount: '500000' }] },
    },
  ],
})

const origFetch = globalThis.fetch
beforeEach(() => {
  settleCalls = 0
})
afterEach(() => {
  globalThis.fetch = origFetch
})

test('a SECOND 402 after payment is reported, never re-paid', async () => {
  let calls = 0
  globalThis.fetch = (async (url: any) => {
    calls++
    // Both the initial request AND the paid retry answer 402 (the merchant rejects).
    return new Response(challengeBody, { status: 402, headers: { 'content-type': 'application/json' } })
  }) as typeof fetch

  const out = await suizePay({ url: 'https://merchant.example/resource' })
  const parsed = JSON.parse(out)

  // The payment was built+signed exactly ONCE — the second 402 did NOT trigger a re-pay.
  expect(settleCalls).toBe(1)
  expect(parsed.paid).toBe(true)
  expect(parsed.served).toBe(false)
  expect(parsed.note).toContain('do NOT pay again')
  // initial request + one paid retry = 2 fetches; no third.
  expect(calls).toBe(2)
})

test('a happy path pays once and returns the served body + digest', async () => {
  let calls = 0
  globalThis.fetch = (async (url: any, init: any) => {
    calls++
    if (calls === 1) {
      return new Response(challengeBody, { status: 402, headers: { 'content-type': 'application/json' } })
    }
    // The paid retry succeeds, with a PAYMENT-RESPONSE receipt carrying the digest.
    const receipt = Buffer.from(
      JSON.stringify({ success: true, transaction: 'DiGeStABC123', network: 'sui:testnet' }),
      'utf8',
    ).toString('base64')
    return new Response('hello world', {
      status: 200,
      headers: { 'payment-response': receipt },
    })
  }) as typeof fetch

  const out = await suizePay({ url: 'https://merchant.example/resource' })
  const parsed = JSON.parse(out)
  expect(settleCalls).toBe(1)
  expect(parsed.served).toBe(true)
  expect(parsed.digest).toBe('DiGeStABC123')
  expect(parsed.body).toBe('hello world')
})

test('a non-402 first response is returned without paying', async () => {
  globalThis.fetch = (async () =>
    new Response('free content', { status: 200 })) as unknown as typeof fetch
  const out = await suizePay({ url: 'https://merchant.example/free' })
  const parsed = JSON.parse(out)
  expect(settleCalls).toBe(0)
  expect(parsed.paid).toBe(false)
  expect(parsed.body).toBe('free content')
})
