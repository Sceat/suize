// Unit tests for the pure, network-free pieces of the x402 client: the requirement
// entry-picking (scheme 'exact' + network match) and the confirm-dial gate (the
// two-step confirm:true contract). No chain, no signing — pure logic only.
import { expect, test } from 'bun:test'
import type { PaymentRequired, PaymentRequirements } from '@suize/x402'
import { ConfirmationRequired, makeConfirmGate, pickRequirement } from '../src/x402-client'

const req = (over: Partial<PaymentRequirements>): PaymentRequirements => ({
  scheme: 'exact',
  network: 'sui:testnet',
  amount: '500000',
  asset: '0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC',
  payTo: '0x' + 'a'.repeat(64),
  maxTimeoutSeconds: 120,
  extra: { outputs: [{ to: '0x' + 'a'.repeat(64), amount: '500000' }] },
  ...over,
})

const required = (accepts: PaymentRequirements[]): PaymentRequired => ({ x402Version: 2, accepts })

test('pickRequirement selects the exact-scheme requirement on the session network', () => {
  const chosen = pickRequirement(required([req({})]), 'sui:testnet')
  expect(chosen?.scheme).toBe('exact')
  expect(chosen?.network).toBe('sui:testnet')
})

test('pickRequirement skips a wrong-network requirement', () => {
  expect(pickRequirement(required([req({ network: 'sui:mainnet' })]), 'sui:testnet')).toBeNull()
})

test('pickRequirement skips a non-exact scheme', () => {
  expect(pickRequirement(required([req({ scheme: 'permit' as any })]), 'sui:testnet')).toBeNull()
})

test('pickRequirement picks the matching one out of several offers', () => {
  const chosen = pickRequirement(
    required([req({ network: 'sui:mainnet' }), req({ scheme: 'other' as any }), req({ payTo: '0x' + 'b'.repeat(64) })]),
    'sui:testnet',
  )
  expect(chosen?.payTo).toBe('0x' + 'b'.repeat(64))
})

test('pickRequirement returns null on an empty / malformed accepts', () => {
  expect(pickRequirement({ x402Version: 2, accepts: [] }, 'sui:testnet')).toBeNull()
  expect(pickRequirement({ x402Version: 2 } as any, 'sui:testnet')).toBeNull()
})

// ── confirm dial ──────────────────────────────────────────────────────────────

const ctx = { units: 500_000n, amount: '0.5', payTo: '0x' + 'a'.repeat(64) }

test('confirm-each blocks without confirm:true (two-step contract)', () => {
  const gate = makeConfirmGate({ kind: 'each' }, false)
  expect(() => gate(ctx)).toThrow(ConfirmationRequired)
  try {
    gate(ctx)
  } catch (e) {
    expect((e as Error).message).toContain('CONFIRMATION REQUIRED')
    expect((e as Error).message).toContain('confirm": true')
  }
})

test('confirm-each proceeds once confirm:true is given', () => {
  expect(() => makeConfirmGate({ kind: 'each' }, true)(ctx)).not.toThrow()
})

test('auto always proceeds', () => {
  expect(() => makeConfirmGate({ kind: 'auto' }, false)(ctx)).not.toThrow()
})

test('auto_under approves strictly-under, blocks at/over the threshold', () => {
  const policy = { kind: 'auto_under' as const, thresholdUnits: 1_000_000n, thresholdText: '1' }
  // 0.5 < 1 → auto-approved
  expect(() => makeConfirmGate(policy, false)({ ...ctx, units: 500_000n })).not.toThrow()
  // exactly 1.0 is NOT under → blocked
  expect(() => makeConfirmGate(policy, false)({ ...ctx, units: 1_000_000n, amount: '1' })).toThrow(
    ConfirmationRequired,
  )
})
