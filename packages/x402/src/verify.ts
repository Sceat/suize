// The facilitator's exact-fee enforcement — the heart of the V2 Sui scheme.
//
// The declared fee split (PaymentRequirements.extra.outputs) is the source of
// truth; a payer's tx must match it EXACTLY or it never settles. We simulate
// (never broadcast) and assert, over the asset's balance changes:
//   - the tx simulates to SUCCESS,
//   - every declared output is credited EXACTLY its amount, to an AddressOwner,
//   - NO undeclared address receives any of the asset (the skim cheat-vector),
//   - the payer is debited EXACTLY the sum of the declared outputs.
//
// `assertUnsignedBytesSafe` is the MANDATORY pre-sign guard for facilitator-
// built (buildUrl) bytes: before a payer signs bytes it did not construct, prove
// they are gasless, sent by the expected sender, and pay exactly the declared
// split — so a malicious facilitator can't slip in a hidden recipient.

import { Transaction } from '@mysten/sui/transactions'
import { verifyTransactionSignature } from '@mysten/sui/verify'
import { fromBase64, normalizeStructTag } from '@mysten/sui/utils'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import type { Output } from './types'

// ── gasless command-shape allow-list (F3, 2026-06-12) ─────────────────────────
// A POWER-door payer builds + submits its OWN PTB (the facilitator never built it),
// so an arbitrary PTB could route the asset through a non-AddressOwner path or an
// unexpected MoveCall. It can NEVER underpay the merchant or us (the declared-exact
// + payer-total binds in `outputProblems` cover that) — only let the payer overspend
// itself. We add the cheap guard anyway, MIRRORING the upstream @x402/sui facilitator
// (typescript/packages/mechanisms/sui constants.ts GASLESS_ALLOWED_TARGETS): every
// MoveCall target must be an allowlisted gasless stablecoin op, and the only
// non-MoveCall commands tolerated are the coin-object intent's SplitCoins / MergeCoins
// (the `tx.balance({type, balance})` source-from-a-Coin<T> path the probe proved).
const FRAMEWORK = '0x0000000000000000000000000000000000000000000000000000000000000002'
/** Allowlisted `package::module::function` targets (package fully normalized). The
 * SDK's `tx.balance({type, balance})` resolves to balance::redeem_funds (Address
 * Balance) or coin::into_balance (Coin<T>), then balance::send_funds to the payee.
 * These are the FOUR functions that actually exist in the Sui framework — VERIFIED
 * on testnet via sui_getNormalizedMoveFunction (2026-06-12). The earlier list also
 * carried `balance::withdrawal_split` + `balance::into_balance`, which DO NOT EXIST
 * on chain (the Sui-docs phrasing is stale); shipping phantom functions in a security
 * allowlist is a credibility wound, so they are removed. */
export const GASLESS_ALLOWED_TARGETS: ReadonlySet<string> = new Set([
  `${FRAMEWORK}::balance::send_funds`,
  `${FRAMEWORK}::balance::redeem_funds`,
  `${FRAMEWORK}::coin::send_funds`,
  `${FRAMEWORK}::coin::into_balance`,
])
/** Native PTB commands the CoinWithBalance intent may emit when sourcing from a
 * Coin<T> (split exact change off a coin, merge fragments). These move no asset to a
 * third party — the exact-fee balance-change check still binds every credit. */
const ALLOWED_NON_MOVECALL = new Set(['SplitCoins', 'MergeCoins'])

/** Normalize a decoded MoveCall target to `0x000…02::module::function`. */
const normalizeTarget = (pkg: string, module: string, fn: string): string =>
  normalizeStructTag(`${pkg}::${module}::${fn}`)

/**
 * Assert a decoded tx is GASLESS-SHAPED: gasPrice 0, gasPayment empty, and EVERY
 * command is either an allowlisted gasless MoveCall or a tolerated coin-object
 * SplitCoins/MergeCoins. Returns a problem string, or "" when the shape is safe.
 * Pure — no client. Reused by `assertUnsignedBytesSafe` (pre-sign) and the
 * facilitator's `doVerify` (the POWER door). */
export function gaslessShapeProblem(data: ReturnType<Transaction['getData']>): string {
  const price = data.gasData?.price
  if (!(price === '0' || price === 0 || price == null)) return `non-zero gasPrice: ${price}`
  const payment = data.gasData?.payment
  const emptyPayment =
    payment == null || (Array.isArray(payment) && payment.length === 0)
  if (!emptyPayment) return `non-empty gasPayment: ${JSON.stringify(payment)}`
  for (const cmd of data.commands) {
    if (cmd.$kind === 'MoveCall' && cmd.MoveCall) {
      const target = normalizeTarget(cmd.MoveCall.package, cmd.MoveCall.module, cmd.MoveCall.function)
      if (!GASLESS_ALLOWED_TARGETS.has(target)) return `disallowed target: ${target}`
    } else if (!ALLOWED_NON_MOVECALL.has(cmd.$kind)) {
      return `disallowed command: ${cmd.$kind}`
    }
  }
  return ''
}

/** Recover the payer address from a signed tx (the signature-verification step). */
export async function recoverPayer(txBytesB64: string, signatureB64: string): Promise<string> {
  const pk = await verifyTransactionSignature(fromBase64(txBytesB64), signatureB64)
  return pk.toSuiAddress()
}

type BalanceChange = { coinType: string; address: string; amount: string }

/** Normalize gRPC-simulate balanceChanges to {coinType, address, amount}. gRPC
 * simulate returns a flat `address`; JSON-RPC nests it under owner.AddressOwner
 * (an AddressOwner — never a shared/object owner, which we ignore by design). */
export function normalizeBalanceChanges(simTx: unknown): BalanceChange[] {
  const raw = (simTx as { balanceChanges?: unknown[] } | null)?.balanceChanges ?? []
  return raw.map((c) => {
    const x = c as {
      coinType: string
      address?: string
      amount: string | number
      owner?: { AddressOwner?: string }
    }
    return {
      coinType: x.coinType,
      address: x.address ?? x.owner?.AddressOwner ?? '',
      amount: String(x.amount),
    }
  })
}

/** Pure form of the exact-fee check: given normalized balance changes, return
 * the list of problems (empty = clean). Exported for unit testing without a
 * client. The discipline mirrors the proven emulation lib (5/5 acceptance). */
export function outputProblems(
  changes: BalanceChange[],
  asset: string,
  outputs: Output[],
  payer: string,
): string[] {
  const net = new Map<string, bigint>()
  for (const c of changes) {
    if (c.coinType !== asset) continue
    if (!c.address) continue // skip non-AddressOwner balance changes
    const key = c.address.toLowerCase()
    net.set(key, (net.get(key) ?? 0n) + BigInt(c.amount))
  }
  const problems: string[] = []
  let total = 0n
  const declared = new Set<string>()
  for (const o of outputs) {
    const key = o.to.toLowerCase()
    declared.add(key)
    const got = net.get(key) ?? 0n
    const want = BigInt(o.amount)
    if (got !== want) problems.push(`output ${o.to.slice(0, 12)}… expected +${want} got ${got}`)
    total += want
  }
  // No UNDECLARED positive recipient of the asset (the skim-to-3rd-party cheat).
  for (const [addr, delta] of net) {
    if (addr === payer.toLowerCase()) continue
    if (delta > 0n && !declared.has(addr)) {
      problems.push(`undeclared recipient ${addr.slice(0, 12)}… received +${delta}`)
    }
  }
  // Payer debited EXACTLY the total of the declared outputs.
  const payerDelta = net.get(payer.toLowerCase()) ?? 0n
  if (payerDelta !== -total) problems.push(`payer expected -${total} got ${payerDelta}`)
  return problems
}

/** Raised by the asserts below; `code` is the stable x402 invalidReason string. */
export class OutputsError extends Error {
  // An explicit field (not a constructor parameter-property) so this module stays
  // `erasableSyntaxOnly`-clean — a property the wallet's tsconfig requires when it
  // imports @suize/x402 source directly.
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
    this.name = 'OutputsError'
  }
}

/** Simulate the signed tx and assert it pays EXACTLY the declared split. Returns
 * the recovered/expected payer and its debit (the total). Throws OutputsError
 * (code = x402 invalidReason) on any mismatch. */
export async function assertOutputsExact(opts: {
  client: SuiGrpcClient
  txBytesB64: string
  asset: string
  outputs: Output[]
  /** When given, the simulated payer must equal this (the recovered signer). */
  expectedPayer?: string
}): Promise<{ payer: string; debit: bigint }> {
  const { client, txBytesB64, asset, outputs, expectedPayer } = opts
  const tx = Transaction.from(fromBase64(txBytesB64))
  const sim = await client.simulateTransaction({
    transaction: tx,
    include: { effects: true, balanceChanges: true, transaction: true },
  })

  const simTx = sim.$kind === 'Transaction' ? sim.Transaction : sim.FailedTransaction
  if (sim.$kind === 'FailedTransaction' || simTx?.status?.error) {
    throw new OutputsError(
      'invalid_exact_sui_payload_transaction_dry_run_failed',
      JSON.stringify(simTx?.status ?? {}).slice(0, 200),
    )
  }

  // The payer is the recovered signer when one was given, else the simulated
  // tx sender. (The exact-fee check itself proves the debit lands on this payer.)
  const changes = normalizeBalanceChanges(simTx)
  const payer = expectedPayer ?? (simTx?.transaction as { sender?: string } | undefined)?.sender ?? ''
  if (!payer) {
    throw new OutputsError('invalid_payload', 'could not determine payer')
  }

  const problems = outputProblems(changes, asset, outputs, payer)
  if (problems.length) {
    throw new OutputsError('invalid_exact_sui_payload_outputs_mismatch', problems.join('; '))
  }

  const debit = outputs.reduce((s, o) => s + BigInt(o.amount), 0n)
  return { payer, debit }
}

/** The MANDATORY pre-sign guard for facilitator-built (buildUrl) bytes. Decode,
 * assert sender match + gasless gasData, then the exact-fee check. Throws
 * OutputsError on any violation — a payer must NEVER sign bytes that fail this. */
export async function assertUnsignedBytesSafe(opts: {
  client: SuiGrpcClient
  bytesB64: string
  sender: string
  asset: string
  outputs: Output[]
}): Promise<{ payer: string; debit: bigint }> {
  const { client, bytesB64, sender, asset, outputs } = opts
  let data: ReturnType<Transaction['getData']>
  try {
    const tx = Transaction.from(fromBase64(bytesB64))
    data = tx.getData()
  } catch (e) {
    throw new OutputsError('invalid_payload', `undecodable tx bytes: ${(e as Error).message}`)
  }

  if ((data.sender ?? '').toLowerCase() !== sender.toLowerCase()) {
    throw new OutputsError(
      'invalid_exact_sui_payload_outputs_mismatch',
      `sender mismatch: bytes ${data.sender} ≠ expected ${sender}`,
    )
  }

  // Gasless + allowlisted-command shape: gasPrice 0, gasPayment empty, and every
  // command an allowlisted gasless op (the facilitator never gas-sponsors an owner
  // tx — the chain's Address-Balance gasless path covers it; an arbitrary command is
  // refused). `gaslessShapeProblem` is the single source of this rule (F3).
  const shape = gaslessShapeProblem(data)
  if (shape) {
    throw new OutputsError(
      'invalid_exact_sui_payload_outputs_mismatch',
      `not gasless: ${shape}`,
    )
  }

  // The unsigned bytes have no signature to recover — the sender we just matched
  // IS the payer for the exact-fee simulation.
  return assertOutputsExact({ client, txBytesB64: bytesB64, asset, outputs, expectedPayer: sender })
}

/**
 * Assert a (signed) tx's BYTES are gasless-command-shaped — the cheap pre-simulate
 * guard the FACILITATOR runs in `doVerify` on the POWER door, where the payer built
 * its OWN PTB (F3). Decodes the bytes and applies `gaslessShapeProblem`. Throws
 * OutputsError('invalid_exact_sui_payload_outputs_mismatch') on a disallowed shape;
 * 'invalid_payload' on undecodable bytes. No client / no network — pure decode.
 */
export function assertGaslessTxShape(txBytesB64: string): void {
  let data: ReturnType<Transaction['getData']>
  try {
    data = Transaction.from(fromBase64(txBytesB64)).getData()
  } catch (e) {
    throw new OutputsError('invalid_payload', `undecodable tx bytes: ${(e as Error).message}`)
  }
  const shape = gaslessShapeProblem(data)
  if (shape) {
    throw new OutputsError('invalid_exact_sui_payload_outputs_mismatch', `not gasless: ${shape}`)
  }
}
