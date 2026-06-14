// The payment-PTB builder for the V2 Sui 'exact' scheme, plus the 6-dp USDC
// decimal<->atomic conversions.
//
// One `0x2::balance::send_funds<asset>` moveCall per declared output, each drawn
// from the payer's Address Balance OR Coin objects (the SDK's CoinWithBalance
// intent picks the source — coin::into_balance/send_funds are allowlisted). We
// build over the gRPC transport because that is where gasless eligibility
// (gasPrice=0, gasPayment=[]) resolves.
//
// DETERMINISTIC GASLESS (settled empirically on testnet, probe2 2026-06-12):
// `setGasBudget(0n)` FORCES the gasless election. The SDK resolver's gas-payment
// branch (core-resolver.mjs `setGasPayment`) is `budget === 0n || (!usesGasCoin
// && addressBalance >= budget+withdrawals) → payment = []` — so a preset budget
// of 0 takes the FIRST branch unconditionally, regardless of the sender's SUI
// holdings (SUI-in-coin-object senders included). Without it, gaslessness rides
// on the node fully rebating the gasless simulation to budget 0 — true on
// current testnet, but node-version-dependent (a captured fixture proves a node
// once returned a gas-paying budget for this exact shape). For a fully-rebatable
// payment PTB (no persistent owned object created) the protocol accepts budget 0
// and stamps a ValidDuring expiration; a tx that genuinely consumes gas is
// rejected at build ("Gas budget: 0 is lower than min") — which is correct, an
// x402 payment is never such a tx. NOTE: do NOT also setGasPrice(0)/setGasPayment([])
// manually — the protocol rejects an explicit price < RGP and a payment=[] tx
// with no expiration; only the resolver's own election is accepted.
//
// The facilitator's `assertUnsignedBytesSafe` (verify.ts) is the HARD gate that
// ENFORCES gaslessness before a payer signs — this builder biases toward it but
// the guard is the source of truth.

import { SuiGrpcClient } from '@mysten/sui/grpc'
import { Transaction } from '@mysten/sui/transactions'
import { toBase64 } from '@mysten/sui/utils'
import type { Network, Output } from './types'

/** CAIP-2 `sui:<ref>` → the public fullnode gRPC base url. Testnet only in v1. */
const GRPC_URLS: Record<string, string> = {
  'sui:testnet': 'https://fullnode.testnet.sui.io:443',
  'sui:mainnet': 'https://fullnode.mainnet.sui.io:443',
  'sui:devnet': 'https://fullnode.devnet.sui.io:443',
}

/** A gRPC client for `network` — the transport that bakes in gasless params. */
export function grpcClient(network: Network): SuiGrpcClient {
  const baseUrl = GRPC_URLS[network]
  if (!baseUrl) throw new Error(`unsupported network: ${network}`)
  const ref = network.split(':')[1] as 'testnet' | 'mainnet' | 'devnet'
  return new SuiGrpcClient({ network: ref, baseUrl })
}

/** Build the unsigned gasless payment tx for a declared fee split. Returns the
 * base64 TransactionData bytes (exactly what X-PAYMENT carries) and the tx. */
export async function buildGaslessOutputs(opts: {
  client: SuiGrpcClient
  sender: string
  asset: string
  outputs: Output[]
}): Promise<{ bytes: string; tx: Transaction }> {
  const { client, sender, asset, outputs } = opts
  const tx = new Transaction()
  tx.setSender(sender)
  for (const o of outputs) {
    tx.moveCall({
      target: '0x2::balance::send_funds',
      typeArguments: [asset],
      arguments: [tx.balance({ type: asset, balance: BigInt(o.amount) }), tx.pure.address(o.to)],
    })
  }
  // Force the gasless election (budget===0n branch) — see the header note.
  tx.setGasBudget(0n)
  // Building over gRPC resolves the remaining gasless params (gasPrice=0, gasPayment=[]).
  const built = await tx.build({ client })
  return { bytes: toBase64(built), tx }
}

// ─────────────────────────────────────────────────────────────────────────────
// 6-dp USDC decimal <-> atomic. The wire speaks decimal strings, the chain
// speaks atomic units. Strict: positive, ≤ 6 dp, no sign, no sci-notation.
// ─────────────────────────────────────────────────────────────────────────────
const USDC_DECIMALS = 6
const USDC_UNIT = 10n ** BigInt(USDC_DECIMALS)
const DECIMAL_RE = /^(\d+)(?:\.(\d{1,6}))?$/

/** "0.50" → 500000n. Throws on anything that isn't a positive ≤6-dp decimal. */
export function usdcAtomic(decimal: string): bigint {
  const m = DECIMAL_RE.exec(decimal.trim())
  if (!m) throw new Error(`invalid USDC amount: ${decimal}`)
  const whole = BigInt(m[1])
  const frac = BigInt((m[2] ?? '').padEnd(USDC_DECIMALS, '0') || '0')
  const units = whole * USDC_UNIT + frac
  if (units <= 0n) throw new Error(`USDC amount must be positive: ${decimal}`)
  return units
}

/** 500000n → "0.5" (trailing zeros trimmed; integral amounts have no point). */
export function formatUsdc(atomic: bigint): string {
  if (atomic < 0n) throw new Error(`USDC atomic amount must be non-negative: ${atomic}`)
  const whole = atomic / USDC_UNIT
  const frac = (atomic % USDC_UNIT).toString().padStart(USDC_DECIMALS, '0').replace(/0+$/, '')
  return frac ? `${whole}.${frac}` : whole.toString()
}
