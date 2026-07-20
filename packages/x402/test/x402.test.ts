// Unit tests — NO network. The on-chain pieces are exercised against a captured
// FIXTURE (a real testnet-built two-output send_funds tx, decodable BCS) and a
// mock client whose `simulateTransaction` returns the captured simulation.
import { describe, expect, test } from 'bun:test'
import { Transaction } from '@mysten/sui/transactions'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import {
  // types / paymentId
  isValidPaymentId,
  paymentIdOf,
  withPaymentId,
  PAYMENT_ID_EXT,
  // wire
  b64json,
  unb64json,
  readPaymentHeader,
  mintPaymentId,
  PAYMENT_SIG_HEADERS,
  // build
  usdcAtomic,
  formatUsdc,
  // verify
  outputProblems,
  assertOutputsExact,
  assertUnsignedBytesSafe,
  assertGaslessTxShape,
  expirationProblem,
  gaslessShapeProblem,
  GASLESS_ALLOWED_TARGETS,
  OutputsError,
  normalizeBalanceChanges,
  recoverPayer,
  // multisig sub-account
  formAgentSubaccount,
  deriveSubaccountAddress,
  combineForMultisig,
} from '../src/index'
import type { Output } from '../src/index'
import { parseSerializedSignature } from '@mysten/sui/cryptography'
import { MultiSigPublicKey } from '@mysten/sui/multisig'

// ─── Fixture: a real testnet two-output send_funds tx (98% + 2% split) ────────
// Captured author-time; the test never touches the network. Sender debited
// -100000, MERCHANT +98000, TREASURY +2000 of DUSDC. gasData here is NOT gasless
// (the funded sender paid SUI gas) — used to prove the pre-sign guard REJECTS it.
const FIXTURE_BYTES =
  'AAAEACAiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIgAgMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMCANB+AQAAAAAAAAfpUEAIWXa/1UoaByJc1GyKK06OK2cy8UCg/EmFC6c+GgVkdXNkYwVEVVNEQwAAAgDQBwAAAAAAAAAH6VBACFl2v9VKGgciXNRsiitOjitnMvFAoPxJhQunPhoFZHVzZGMFRFVTREMAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIHYmFsYW5jZQxyZWRlZW1fZnVuZHMBB+lQQAhZdr/VShoHIlzUbIorTo4rZzLxQKD8SYULpz4aBWR1c2RjBURVU0RDAAEBAgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIHYmFsYW5jZQpzZW5kX2Z1bmRzAQfpUEAIWXa/1UoaByJc1GyKK06OK2cy8UCg/EmFC6c+GgVkdXNkYwVEVVNEQwACAwAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIHYmFsYW5jZQxyZWRlZW1fZnVuZHMBB+lQQAhZdr/VShoHIlzUbIorTo4rZzLxQKD8SYULpz4aBWR1c2RjBURVU0RDAAEBAwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIHYmFsYW5jZQpzZW5kX2Z1bmRzAQfpUEAIWXa/1UoaByJc1GyKK06OK2cy8UCg/EmFC6c+GgVkdXNkYwVEVVNEQwACAwIAAAABAQAIeqhiymRcC5RADEnhG0kQEfyjXbg3NhzPxMb2nTVuhgGHk6dMXiEpHYsqnuARXluYGTePY2jZpKNnh/7sFxlX9tGJlzUAAAAAILTpgkjY77LfsuBCFd7ZWlhW+bTRW44EaAJUJB9IOsCdCHqoYspkXAuUQAxJ4RtJEBH8o124NzYcz8TG9p01boboAwAAAAAAAICEHgAAAAAAAA=='
const SENDER = '0x087aa862ca645c0b94400c49e11b491011fca35db837361ccfc4c6f69d356e86'
const ASSET = '0xe95040085976bfd54a1a07225cd46c8a2b4e8e2b6732f140a0fc49850ba73e1a::dusdc::DUSDC'
const MERCHANT = '0x2222222222222222222222222222222222222222222222222222222222222222'
const TREASURY = '0x3333333333333333333333333333333333333333333333333333333333333333'
const OUTPUTS: Output[] = [
  { to: MERCHANT, amount: '98000' },
  { to: TREASURY, amount: '2000' },
]
const FIXTURE_BC = [
  { coinType: '0x2::sui::SUI', address: SENDER, amount: '-1009880' },
  { coinType: ASSET, address: SENDER, amount: '-100000' },
  { coinType: ASSET, address: MERCHANT, amount: '98000' },
  { coinType: ASSET, address: TREASURY, amount: '2000' },
]

/** A mock gRPC client: only `simulateTransaction`, returning a canned result. */
const mockClient = (result: unknown) =>
  ({ simulateTransaction: async () => result }) as any

const okSim = {
  $kind: 'Transaction',
  Transaction: {
    status: { success: true, error: null },
    balanceChanges: FIXTURE_BC,
    transaction: { sender: SENDER },
  },
}

// ─────────────────────────────────────────────────────────────────────────────
describe('payment-identifier helpers', () => {
  const ok = 'pay_7d5d747be160e280504c099d984bcfe0'

  test('isValidPaymentId enforces 16-128 [A-Za-z0-9_-]', () => {
    expect(isValidPaymentId(ok)).toBe(true)
    expect(isValidPaymentId('pay_short')).toBe(false) // < 16
    expect(isValidPaymentId('a'.repeat(129))).toBe(false) // > 128
    expect(isValidPaymentId('has spaces here!!')).toBe(false)
    expect(isValidPaymentId('valid-id_with-dashes')).toBe(true)
    expect(isValidPaymentId(123 as unknown)).toBe(false)
    expect(isValidPaymentId(undefined)).toBe(false)
  })

  test('mintPaymentId produces a valid pay_ id', () => {
    const id = mintPaymentId()
    expect(id.startsWith('pay_')).toBe(true)
    expect(isValidPaymentId(id)).toBe(true)
    expect(mintPaymentId()).not.toBe(id) // unique
  })

  test('paymentIdOf reads from extensions[PAYMENT_ID_EXT].info.id', () => {
    const payload = { extensions: { [PAYMENT_ID_EXT]: { info: { id: ok } } } }
    expect(paymentIdOf(payload)).toBe(ok)
    expect(paymentIdOf({ extensions: {} })).toBeUndefined()
    expect(paymentIdOf(undefined)).toBeUndefined()
    // malformed id is ignored, not returned
    expect(paymentIdOf({ extensions: { [PAYMENT_ID_EXT]: { info: { id: 'x' } } } })).toBeUndefined()
  })

  test('withPaymentId merges non-destructively', () => {
    const prior = { [PAYMENT_ID_EXT]: { info: { required: false } }, other: { keep: 1 } }
    const merged = withPaymentId(prior, ok)
    expect(paymentIdOf({ extensions: merged })).toBe(ok)
    // preserves the server-sent info AND the unrelated extension
    expect((merged[PAYMENT_ID_EXT] as any).info.required).toBe(false)
    expect((merged.other as any).keep).toBe(1)
    expect(() => withPaymentId(undefined, 'tooshort')).toThrow()
  })
})

describe('gasless force lever (buildGaslessOutputs contract)', () => {
  // buildGaslessOutputs sets tx.setGasBudget(0n) before build — this is the
  // deterministic gasless election (core-resolver `setGasPayment`: budget===0n →
  // payment=[]), independent of the sender's SUI holdings. Settled empirically on
  // testnet (probe2 2026-06-12); proven by executed digests, e.g.
  // 49KahzkWjFsUbLCR4rJ9j7oRMFEncvBumQpv2qvWdWyF (SUI-holding sender, gasless).
  // We assert the lever itself here (no network); the live build adds gasPrice=0
  // + gasPayment=[] + a ValidDuring expiration via the gRPC resolver.
  test('setGasBudget(0n) parks budget at "0" pre-resolution (the lever)', () => {
    const tx = new Transaction()
    tx.setSender(SENDER)
    tx.moveCall({
      target: '0x2::balance::send_funds',
      typeArguments: [ASSET],
      arguments: [tx.balance({ type: ASSET, balance: 1000n }), tx.pure.address(MERCHANT)],
    })
    tx.setGasBudget(0n)
    expect(tx.getData().gasData.budget).toBe('0')
  })
})

describe('wire helpers', () => {
  test('b64json / unb64json round-trip', () => {
    const o = { x402Version: 2, accepts: [{ amount: '500000' }] }
    expect(unb64json<typeof o>(b64json(o))).toEqual(o)
  })

  test('readPaymentHeader accepts both inbound names, in order', () => {
    const xpayment = b64json({ tag: 'x-payment' })
    const sig = b64json({ tag: 'payment-signature' })
    // PAYMENT-SIGNATURE preferred over X-PAYMENT
    expect(
      readPaymentHeader({ get: (n) => (n === PAYMENT_SIG_HEADERS[0] ? sig : xpayment) }),
    ).toBe(sig)
    // falls back to X-PAYMENT
    expect(readPaymentHeader({ get: (n) => (n === 'X-PAYMENT' ? xpayment : null) })).toBe(xpayment)
    // none set
    expect(readPaymentHeader({ get: () => null })).toBeUndefined()
  })
})

describe('usdc decimal <-> atomic (6dp, strict)', () => {
  test('usdcAtomic parses positive ≤6-dp decimals', () => {
    expect(usdcAtomic('0.50')).toBe(500000n)
    expect(usdcAtomic('1')).toBe(1000000n)
    expect(usdcAtomic('0.000001')).toBe(1n)
    expect(usdcAtomic('  2.5  ')).toBe(2500000n)
  })

  test('usdcAtomic rejects junk, sign, sci-notation, >6dp, zero', () => {
    expect(() => usdcAtomic('0')).toThrow()
    expect(() => usdcAtomic('-1')).toThrow()
    expect(() => usdcAtomic('1e6')).toThrow()
    expect(() => usdcAtomic('0.0000001')).toThrow() // 7 dp
    expect(() => usdcAtomic('abc')).toThrow()
    expect(() => usdcAtomic('')).toThrow()
  })

  test('formatUsdc trims trailing zeros; round-trips', () => {
    expect(formatUsdc(500000n)).toBe('0.5')
    expect(formatUsdc(1000000n)).toBe('1')
    expect(formatUsdc(1n)).toBe('0.000001')
    expect(formatUsdc(usdcAtomic('12.34'))).toBe('12.34')
    expect(() => formatUsdc(-1n)).toThrow()
  })
})

describe('outputProblems (pure fee-enforcement core)', () => {
  test('clean exact match → no problems', () => {
    expect(outputProblems(FIXTURE_BC, ASSET, OUTPUTS, SENDER)).toEqual([])
  })

  test('flags a short-changed output', () => {
    const bc = FIXTURE_BC.map((c) =>
      c.address === MERCHANT ? { ...c, amount: '97000' } : c,
    )
    const p = outputProblems(bc, ASSET, OUTPUTS, SENDER)
    expect(p.some((x) => x.includes('expected +98000'))).toBe(true)
  })

  test('flags an UNDECLARED recipient (the skim cheat-vector)', () => {
    const thief = '0x9999999999999999999999999999999999999999999999999999999999999999'
    const bc = [...FIXTURE_BC, { coinType: ASSET, address: thief, amount: '500' }]
    const p = outputProblems(bc, ASSET, OUTPUTS, SENDER)
    expect(p.some((x) => x.includes('undeclared recipient'))).toBe(true)
  })

  test('flags a payer-debit mismatch', () => {
    const bc = FIXTURE_BC.map((c) =>
      c.address === SENDER && c.coinType === ASSET ? { ...c, amount: '-90000' } : c,
    )
    const p = outputProblems(bc, ASSET, OUTPUTS, SENDER)
    expect(p.some((x) => x.includes('payer expected -100000'))).toBe(true)
  })

  test('ignores balance changes of OTHER assets (e.g. SUI gas)', () => {
    // FIXTURE_BC carries a SUI debit; it must not affect the USDC check.
    expect(outputProblems(FIXTURE_BC, ASSET, OUTPUTS, SENDER)).toEqual([])
  })
})

describe('normalizeBalanceChanges', () => {
  test('reads flat gRPC address and nested owner.AddressOwner alike', () => {
    const n = normalizeBalanceChanges({
      balanceChanges: [
        { coinType: ASSET, address: MERCHANT, amount: '98000' },
        { coinType: ASSET, owner: { AddressOwner: TREASURY }, amount: 2000 },
      ],
    })
    expect(n).toEqual([
      { coinType: ASSET, address: MERCHANT, amount: '98000' },
      { coinType: ASSET, address: TREASURY, amount: '2000' },
    ])
  })
})

describe('assertOutputsExact (decode + simulate + enforce)', () => {
  test('happy path: returns the payer + debit', async () => {
    const { payer, debit } = await assertOutputsExact({
      client: mockClient(okSim),
      txBytesB64: FIXTURE_BYTES,
      asset: ASSET,
      outputs: OUTPUTS,
      expectedPayer: SENDER,
    })
    expect(payer).toBe(SENDER)
    expect(debit).toBe(100000n)
  })

  test('derives the payer from the simulated sender when none given', async () => {
    const { payer } = await assertOutputsExact({
      client: mockClient(okSim),
      txBytesB64: FIXTURE_BYTES,
      asset: ASSET,
      outputs: OUTPUTS,
    })
    expect(payer).toBe(SENDER)
  })

  test('throws dry_run_failed on a FailedTransaction', async () => {
    const failSim = {
      $kind: 'FailedTransaction',
      FailedTransaction: { status: { success: false, error: { code: 'InsufficientGas' } } },
    }
    await expect(
      assertOutputsExact({ client: mockClient(failSim), txBytesB64: FIXTURE_BYTES, asset: ASSET, outputs: OUTPUTS, expectedPayer: SENDER }),
    ).rejects.toMatchObject({ code: 'invalid_exact_sui_payload_transaction_dry_run_failed' })
  })

  test('throws outputs_mismatch when the sim skims to an undeclared address', async () => {
    const thief = '0x9999999999999999999999999999999999999999999999999999999999999999'
    const badSim = {
      $kind: 'Transaction',
      Transaction: {
        status: { success: true, error: null },
        balanceChanges: [
          { coinType: ASSET, address: SENDER, amount: '-100000' },
          { coinType: ASSET, address: MERCHANT, amount: '98000' },
          { coinType: ASSET, address: thief, amount: '2000' },
        ],
        transaction: { sender: SENDER },
      },
    }
    const err = await assertOutputsExact({
      client: mockClient(badSim),
      txBytesB64: FIXTURE_BYTES,
      asset: ASSET,
      outputs: OUTPUTS,
      expectedPayer: SENDER,
    }).catch((e) => e as OutputsError)
    expect((err as OutputsError).code).toBe('invalid_exact_sui_payload_outputs_mismatch')
  })
})

describe('assertUnsignedBytesSafe (pre-sign guard)', () => {
  test('REJECTS a non-gasless tx (the fixture pays SUI gas)', async () => {
    // The fixture was built by a SUI-funded sender → gasData.price ≠ 0. A payer
    // must never sign facilitator bytes that are not gasless.
    const err = await assertUnsignedBytesSafe({
      client: mockClient(okSim),
      bytesB64: FIXTURE_BYTES,
      sender: SENDER,
      asset: ASSET,
      outputs: OUTPUTS,
    }).catch((e) => e as OutputsError)
    expect((err as OutputsError).code).toBe('invalid_exact_sui_payload_outputs_mismatch')
    expect((err as OutputsError).message).toContain('not gasless')
  })

  test('REJECTS a sender mismatch before anything else', async () => {
    const err = await assertUnsignedBytesSafe({
      client: mockClient(okSim),
      bytesB64: FIXTURE_BYTES,
      sender: '0x' + 'a'.repeat(64),
      asset: ASSET,
      outputs: OUTPUTS,
    }).catch((e) => e as OutputsError)
    expect((err as OutputsError).code).toBe('invalid_exact_sui_payload_outputs_mismatch')
    expect((err as OutputsError).message).toContain('sender mismatch')
  })

  test('REJECTS undecodable bytes', async () => {
    const err = await assertUnsignedBytesSafe({
      client: mockClient(okSim),
      bytesB64: 'bm90LWEtdHg=',
      sender: SENDER,
      asset: ASSET,
      outputs: OUTPUTS,
    }).catch((e) => e as OutputsError)
    expect((err as OutputsError).code).toBe('invalid_payload')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// F3 — the POWER-door gasless COMMAND-SHAPE allow-list. `gaslessShapeProblem` is
// the pure kernel (decoded-data → problem-or-""); `assertGaslessTxShape` decodes
// the bytes and throws. We test the kernel against synthetic decoded shapes (the
// fixture is non-gasless, so it can't exercise the command branch directly).
describe('gaslessShapeProblem (F3 — gasless command allow-list)', () => {
  const FW = '0x0000000000000000000000000000000000000000000000000000000000000002'
  const gasless = { price: '0', payment: [] as unknown[] }
  const move = (pkg: string, module: string, fn: string) => ({
    $kind: 'MoveCall' as const,
    MoveCall: { package: pkg, module, function: fn },
  })
  // Minimal decoded-data shape `gaslessShapeProblem` reads (gasData + commands).
  const data = (gasData: unknown, commands: unknown[]) =>
    ({ gasData, commands } as unknown as Parameters<typeof gaslessShapeProblem>[0])

  test('the canonical allow-list is EXACTLY the 4 framework fns that exist on-chain', () => {
    // The FOUR proven real (sui_getNormalizedMoveFunction, testnet 2026-06-12).
    expect(GASLESS_ALLOWED_TARGETS.has(`${FW}::balance::send_funds`)).toBe(true)
    expect(GASLESS_ALLOWED_TARGETS.has(`${FW}::balance::redeem_funds`)).toBe(true)
    expect(GASLESS_ALLOWED_TARGETS.has(`${FW}::coin::send_funds`)).toBe(true)
    expect(GASLESS_ALLOWED_TARGETS.has(`${FW}::coin::into_balance`)).toBe(true)
    expect(GASLESS_ALLOWED_TARGETS.size).toBe(4)
    // The two PHANTOMS that DO NOT EXIST on chain must NOT be allowlisted.
    expect(GASLESS_ALLOWED_TARGETS.has(`${FW}::balance::withdrawal_split`)).toBe(false)
    expect(GASLESS_ALLOWED_TARGETS.has(`${FW}::balance::into_balance`)).toBe(false)
  })

  test('PASS: an Address-Balance send (redeem_funds + send_funds, short-form 0x2)', () => {
    // The SDK emits short-form `0x2` targets — they must normalize into the allow-list.
    const cmds = [move('0x2', 'balance', 'redeem_funds'), move('0x2', 'balance', 'send_funds')]
    expect(gaslessShapeProblem(data(gasless, cmds))).toBe('')
  })

  test('PASS: the coin-object intent (SplitCoins/MergeCoins + into_balance + send_funds)', () => {
    const cmds = [
      { $kind: 'SplitCoins' },
      { $kind: 'MergeCoins' },
      move('0x2', 'coin', 'into_balance'),
      move('0x2', 'balance', 'send_funds'),
    ]
    expect(gaslessShapeProblem(data(gasless, cmds))).toBe('')
  })

  test('REJECT: a non-zero gasPrice (not gasless)', () => {
    const cmds = [move('0x2', 'balance', 'send_funds')]
    expect(gaslessShapeProblem(data({ price: '1000', payment: [] }, cmds))).toContain('non-zero gasPrice')
  })

  test('REJECT: a non-empty gasPayment (sponsored shape)', () => {
    const cmds = [move('0x2', 'balance', 'send_funds')]
    expect(gaslessShapeProblem(data({ price: '0', payment: [{ objectId: '0x1' }] }, cmds))).toContain('non-empty gasPayment')
  })

  test('REJECT: a MoveCall to a non-allowlisted target (arbitrary package)', () => {
    const evil = '0xdeadbeef' + 'cafe'.repeat(14) // arbitrary 0x…64 package
    const cmds = [move(evil, 'router', 'drain')]
    expect(gaslessShapeProblem(data(gasless, cmds))).toContain('disallowed target')
  })

  test('REJECT: a non-MoveCall command that is NOT SplitCoins/MergeCoins (e.g. TransferObjects)', () => {
    const cmds = [move('0x2', 'balance', 'send_funds'), { $kind: 'TransferObjects' }]
    expect(gaslessShapeProblem(data(gasless, cmds))).toContain('disallowed command: TransferObjects')
  })

  test('REJECT: a Publish/Upgrade command', () => {
    expect(gaslessShapeProblem(data(gasless, [{ $kind: 'Publish' }]))).toContain('disallowed command: Publish')
  })

  test('assertGaslessTxShape throws invalid_payload on undecodable bytes', () => {
    expect(() => assertGaslessTxShape('bm90LWEtdHg=')).toThrow()
    const err = (() => { try { assertGaslessTxShape('bm90LWEtdHg=') } catch (e) { return e as OutputsError } })()
    expect((err as OutputsError).code).toBe('invalid_payload')
  })

  test('assertGaslessTxShape REJECTS the non-gasless fixture (gasPrice ≠ 0)', () => {
    // The fixture pays SUI gas → the shape check fails before commands even matter.
    const err = (() => { try { assertGaslessTxShape(FIXTURE_BYTES) } catch (e) { return e as OutputsError } })()
    expect((err as OutputsError).code).toBe('invalid_exact_sui_payload_outputs_mismatch')
    expect((err as OutputsError).message).toContain('not gasless')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// expirationProblem (issue #1) — the epoch/chain expiration gate. Simulation is NOT
// epoch-aware, so an EXPIRED gasless payment simulates clean yet can never settle;
// verify must reject a passed window. Synthetic decoded shapes (the house kernel idiom,
// mirroring gaslessShapeProblem above) plus one real offline-built decode-proof.
describe('expirationProblem (epoch/chain expiration gate)', () => {
  const CHAIN = '69WiPg3DAQiwdxfncX6wYQ2siKwAe6L9BZthQea3JNMD' // testnet genesis digest (valid base58, 32B)
  const NOW = 1000n
  // Minimal decoded-data shape the kernel reads (expiration + gasData.payment).
  const data = (expiration: unknown, payment: unknown[] = []) =>
    ({ expiration, gasData: { payment } } as unknown as Parameters<typeof expirationProblem>[0])
  const valid = (over: Record<string, unknown> = {}) => ({
    $kind: 'ValidDuring',
    ValidDuring: { minEpoch: '999', maxEpoch: '1001', minTimestamp: null, maxTimestamp: null, chain: CHAIN, nonce: 1, ...over },
  })

  test('PASS: a ValidDuring window that contains the current epoch', () => {
    expect(expirationProblem(data(valid()), NOW, CHAIN)).toBe('')
  })

  test('REJECT: a ValidDuring window one epoch in the PAST (the issue-#1 bug)', () => {
    expect(expirationProblem(data(valid({ minEpoch: '998', maxEpoch: '999' })), NOW, CHAIN)).toContain('expired')
  })

  test('REJECT: a window not yet valid (minEpoch in the future)', () => {
    expect(expirationProblem(data(valid({ minEpoch: '1001', maxEpoch: '1002' })), NOW, CHAIN)).toContain('not yet valid')
  })

  test('REJECT: a window for the WRONG chain (cross-network replay)', () => {
    expect(expirationProblem(data(valid({ chain: 'SomeOtherChainIdentifier' })), NOW, CHAIN)).toContain('wrong chain')
  })

  test('REJECT: a window carrying the not-yet-supported timestamp fields', () => {
    expect(expirationProblem(data(valid({ minTimestamp: '1' })), NOW, CHAIN)).toContain('timestamp')
    expect(expirationProblem(data(valid({ maxTimestamp: '9' })), NOW, CHAIN)).toContain('timestamp')
  })

  test('PASS: null epoch bounds are unbounded on that side', () => {
    expect(expirationProblem(data(valid({ minEpoch: null, maxEpoch: null })), NOW, CHAIN)).toBe('')
  })

  test('Epoch(max): passes at/below max, rejects once past it', () => {
    expect(expirationProblem(data({ $kind: 'Epoch', Epoch: 1000 }), NOW, CHAIN)).toBe('')
    expect(expirationProblem(data({ $kind: 'Epoch', Epoch: 999 }), NOW, CHAIN)).toContain('expired')
  })

  test('None: REJECTED on a gasless shape, PASSED on a client-paid coin tx', () => {
    // A gasless tx (empty gasPayment) with None can never settle → reject.
    expect(expirationProblem(data({ $kind: 'None', None: true }, []), NOW, CHAIN)).toContain('cannot settle')
    // Absent expiration on a gasless shape → same.
    expect(expirationProblem(data(null, []), NOW, CHAIN)).toContain('cannot settle')
    // A client-paid coin tx (non-empty gasPayment) with None → no-expiry, pass.
    expect(expirationProblem(data({ $kind: 'None', None: true }, [{ objectId: '0x1' }]), NOW, CHAIN)).toBe('')
  })

  test('fails CLOSED on an unrecognized expiration kind', () => {
    expect(expirationProblem(data({ $kind: 'Whenever' }), NOW, CHAIN)).toContain('unrecognized')
  })

  test('DECODE-PROOF: a real offline-built gasless ValidDuring tx decodes into the kernel', async () => {
    // Proves Transaction.from(bytes).getData().expiration yields the exact shape the
    // kernel reads (the premortem unknown), against genuinely BCS-encoded bytes. No
    // network, deterministic.
    const tx = new Transaction()
    tx.setSender('0x' + '2'.repeat(64))
    tx.setGasBudget(0n)
    tx.setGasPrice(0)
    tx.setGasPayment([])
    tx.setExpiration({ ValidDuring: { minEpoch: '900', maxEpoch: '901', minTimestamp: null, maxTimestamp: null, chain: CHAIN, nonce: 7 } })
    tx.moveCall({ target: '0x2::balance::send_funds', typeArguments: [ASSET], arguments: [tx.pure.u64(1000n), tx.pure.address(MERCHANT)] })
    const decoded = Transaction.from(await tx.build()).getData()
    // The [900,901] window: expired at epoch 902, still valid at 901.
    expect(expirationProblem(decoded, 902n, CHAIN)).toContain('expired')
    expect(expirationProblem(decoded, 901n, CHAIN)).toBe('')
    // The chain bind is real: a different live chain id rejects the decoded window.
    expect(expirationProblem(decoded, 901n, 'DifferentChainId')).toContain('wrong chain')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// The 1-of-2 agent sub-account. Deterministic ed25519 members (fixed secret keys)
// so the derived address is stable across runs — no network.
describe('multisig agent sub-account', () => {
  // Two fixed 32-byte seeds → stable members A (lower addr) and B (higher addr).
  const A = Ed25519Keypair.fromSecretKey(new Uint8Array(32).fill(1))
  const B = Ed25519Keypair.fromSecretKey(new Uint8Array(32).fill(2))
  const aPk = A.getPublicKey()
  const bPk = B.getPublicKey()

  test('formAgentSubaccount → a stable address that re-derives identical', () => {
    const first = formAgentSubaccount(aPk, bPk).address
    const again = formAgentSubaccount(aPk, bPk).address
    expect(first).toBe(again)
    expect(first.startsWith('0x')).toBe(true)
    expect(deriveSubaccountAddress(aPk, bPk)).toBe(first)
  })

  test('canonical order is order-INDEPENDENT: form(a,b) === form(b,a)', () => {
    expect(formAgentSubaccount(aPk, bPk).address).toBe(formAgentSubaccount(bPk, aPk).address)
    expect(deriveSubaccountAddress(aPk, bPk)).toBe(deriveSubaccountAddress(bPk, aPk))
  })

  test('it really is a 1-of-2, threshold-1, weights-1/1 multisig', () => {
    const { multisig } = formAgentSubaccount(aPk, bPk)
    expect(multisig.getThreshold()).toBe(1)
    const members = multisig.getPublicKeys()
    expect(members).toHaveLength(2)
    expect(members.every((m) => m.weight === 1)).toBe(true)
  })

  test('combineForMultisig produces a parseable, member-valid 1-of-2 signature', async () => {
    const { multisig } = formAgentSubaccount(aPk, bPk)
    // No-network: sign a personal message with ONE member (A) alone, combine, and
    // prove the multisig verifies it — the 1-of-2 (either member signs) property.
    const msg = new TextEncoder().encode('suize-subaccount-spend')
    const aSig = (await A.signPersonalMessage(msg)).signature
    const msSig = combineForMultisig(multisig, aSig)
    expect(typeof msSig).toBe('string')
    expect(await multisig.verifyPersonalMessage(msg, msSig)).toBe(true)
    // The OTHER member (B) signing alone also satisfies the 1-of-2 threshold.
    const bSig = (await B.signPersonalMessage(msg)).signature
    expect(await multisig.verifyPersonalMessage(msg, combineForMultisig(multisig, bSig))).toBe(true)
  })
})

// ─── REGRESSION: recoverPayer on a real multisig-wrapping-zkLogin signature ───
// The 2026-06-15 demo blocker: the Suize-door agent pays from its sub-account, a
// 1-of-2 multisig of TWO zkLogin members. The OLD recoverPayer called
// verifyTransactionSignature(), whose zkLogin-TRANSACTION path is a stub that
// throws "does not support" — so the agent could never deploy. The fix derives the
// payer ADDRESS structurally (no proof check; SETTLE is the validity gate). This
// fixture is a REAL testnet multisig+zkLogin signature (flag 0x03) captured from
// the sub-account's own gasless payment — an Ed25519 multisig would NOT reproduce
// the bug (it verifies offline), so the regression MUST use zkLogin members.
describe('recoverPayer — multisig+zkLogin (the demo-blocker regression)', () => {
  // tx 5Q5vmz4kfRwJUpG1TXqySGWewoVNFBFQcSkPYBKrgcP, sender = the sub-account below.
  const REAL_MULTISIG_ZKLOGIN_SIG =
    'AwEDzgcFA0w2MDgyOTMzNzkxMjQxNzMxODk2NDc4MjM3MzkwNDEwOTQ3MDQwNDAwNjM3MDg4Mzk2NDMzOTkyNzk3MzIyNzE3MTQ0ODcxOTA2NDEyTTEwNjMzMDUzMDY1NzgyNjg2NTA3Nzk0MTE4NTY4NTI3MjM3Njc4MDMwNTg3MTE1ODYyNzMwMDczMDg2NTM1ODczNzc3NzI0NTc5ODk3ATEDAk0xNjA0NjE4NTIzOTkxOTM0NTE3Mjk4OTI0MDgyMjI2MjM1NTk3MjM0NzExNTU3MDEyOTM4MjM2MzE4NzE4NjU3Mzg1ODI3NjI3ODIwOU0xMTA0MTU2MzAzMjI0Njg5MTc2MDExMDczNTMzOTEwNjQwNTE1MTcxMzA0MDg5NzQ5ODE4NTEyMjMwMTUyNjYwMzE2ODE3NDg3Mjg1MwJMOTQ4NzMzNzQ3OTk4MTU5NzQ3MjcyMjY4NDY4Mzk4MzA3OTc2MjA1MzY0NDM4NTEwNTQ4MzQ0NTU1MTMzNjIyMDMwMTQ5ODgzNDM4Mkw3Mjg1ODc2NTU5NzkwMzczNTA1NTQwMDA0MzY2NDIwODk1MTUwMDcyNzk4MTkxMTg5ODg4NTIxNDcyODE1NDk4NjM4NTExMjUzMDAwAgExATADTTE0Mjc4MTM0NzAxMzQzMDMxNTEwMzE4MzU5NzIzNjc5NDAwMzYwMjgzMjM1NTI0NzgyNTE2NjEzMTIxNjM2NDgwNDE2NjgyMzM3OTcxTTEyMTIzNDAwMjY0MzI3MTg1MTAzOTI0MzEyOTQ1NTEwNTg0NzQ0OTI5NDE5MDU2NzIyMTkwMDk4MDc1NzU2OTA1NTgyMjE1MDQzNDQwATExeUpwYzNNaU9pSm9kSFJ3Y3pvdkwyRmpZMjkxYm5SekxtZHZiMmRzWlM1amIyMGlMQwFmZXlKaGJHY2lPaUpTVXpJMU5pSXNJbXRwWkNJNklqTXdNelZpWWpnMlpEazVaakl5WlRZeE16UTJOMkUyTmpnd09ESTFaV1ZpTUdRNE1UTTVZVElpTENKMGVYQWlPaUpLVjFRaWZRTTE0NDI3ODQyMjIyODU0MDg2MTU5NjEzMjU1NjU0NDg0Njk5MTI3MzgwNDk0OTIwNzYzNDA3ODUwNjc0MTAyNjYwODU3NTE3NjEwNDE5bQQAAAAAAABhAG6tHhWPH9lqfK4JCtqsHZobueKK+ZhX+J2fu+JcdPhMg8KhZx2C3rWN+gLJ2/w+1lO9RoI8fSCLjnAzmCLYUgWZ0h9dHOtc9483NUX9SQmg3yx23uR3fltGtIwFUfCuYQEAAgM8G2h0dHBzOi8vYWNjb3VudHMuZ29vZ2xlLmNvbR/l3oskPp9W67V7X5RwglkFEe+qVZvO7MCPfTHcNJWzAQM8G2h0dHBzOi8vYWNjb3VudHMuZ29vZ2xlLmNvbSxP4GziaguCiyiy3k1se5GcPbx5tGmk5Y4ifh9FqHQXAQEA'
  const SUBACCOUNT = '0x0ab04ca6fa82ac54e4292bfd5a8cba4cc8631a877689df00fb2b7bcd40900301'
  // The 1-of-2 committee members (both zkLogin) — the deploy dashboard's human↔agent link.
  const MEMBERS = [
    '0x069714573a14732decc49c7b4832a34cdfdf34308177dacc32303b4277c35855',
    '0xca138e3043409d3035dbbe1d2ef8b8ac01e6b3dfb83ecdc553ec3088f88f9c0a',
  ]

  test('derives the sub-account address — never throws "does not support"', async () => {
    // recoverPayer ignores the bytes on the MultiSig branch, so a placeholder is fine.
    const payer = await recoverPayer('AA==', REAL_MULTISIG_ZKLOGIN_SIG)
    expect(payer).toBe(SUBACCOUNT)
  })

  test('the multisig committee IS the on-chain human↔agent link (structural, no GraphQL)', () => {
    // The exact primitive apps/deploy fetch_my_sites uses to recognize "my agent's
    // sites": parse the committee from the signature, derive each member's address.
    const parsed = parseSerializedSignature(REAL_MULTISIG_ZKLOGIN_SIG)
    expect(parsed.signatureScheme).toBe('MultiSig')
    const mpk = new MultiSigPublicKey(
      (parsed as { multisig: { multisig_pk: ConstructorParameters<typeof MultiSigPublicKey>[0] } }).multisig.multisig_pk,
    )
    expect(mpk.toSuiAddress()).toBe(SUBACCOUNT)
    const addrs = mpk.getPublicKeys().map((m) => m.publicKey.toSuiAddress()).sort()
    expect(addrs).toEqual([...MEMBERS].sort())
  })
})
