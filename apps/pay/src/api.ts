import { caip2, USDC_TYPES } from '@suize/shared'
import {
  buildGaslessOutputs,
  assertUnsignedBytesSafe,
  grpcClient,
  usdcAtomic,
  type Output,
  type PaymentRequirements,
  type PaymentPayload,
  type SettleResponse,
} from '@suize/x402'
import { API_BASE, NETWORK } from './config'

// ============================================================================
// Facilitator HTTP client — the VANILLA-x402 'exact' pay flow (the live rail).
// The payer pays GASLESSLY, signing LOCALLY:
//
//   1. GET  /terms?payTo&amount  → the declared fee split (outputs) for this
//      merchant+price (null/empty = the free tier, a single full-amount output).
//   2. build the gasless `send_funds` PTB for THAT split (@suize/x402
//      buildGaslessOutputs over the gRPC transport that bakes in the gasless
//      params); assertUnsignedBytesSafe gates it BEFORE signing.
//   3. sign the EXACT bytes with the connected wallet (Enoki zkLogin OR a standard
//      wallet — the SAME dapp-kit useSignTransaction call).
//   4. POST /settle { paymentPayload, paymentRequirements } → the facilitator
//      re-verifies + broadcasts (idempotent by digest) → the executed digest.
//
// The backend NEVER signs the payer leg — still gasless for the payer either way.
// Amounts on this wire are DECIMAL USDC strings ("0.50"); base-unit conversion is
// done HERE only to declare the split atomic amounts.
// ============================================================================

export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

const NET = caip2(NETWORK)
const ASSET = USDC_TYPES[NETWORK]
const MAX_TIMEOUT_SECONDS = 120

let _grpc: ReturnType<typeof grpcClient> | null = null
const grpc = () => (_grpc ??= grpcClient(NET))

/** GET /terms — the declared fee split for this merchant+price (decimal amount). */
async function fetchTerms(payTo: string, amount: string): Promise<Output[]> {
  let res: Response
  try {
    res = await fetch(`${API_BASE}/terms?` + new URLSearchParams({ payTo, amount }))
  } catch {
    throw new ApiError('Could not reach the Suize payment service — check your connection and retry.', 0)
  }
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { error?: string } | null
    throw new ApiError(data?.error || `terms failed (${res.status})`, res.status)
  }
  const body = (await res.json().catch(() => null)) as { outputs?: Output[] | null } | null
  return body?.outputs && body.outputs.length > 0
    ? body.outputs
    : [{ to: payTo, amount: usdcAtomic(amount).toString() }]
}

/** POST /settle — re-verify + broadcast the signed gasless tx (idempotent). */
async function settle(payload: PaymentPayload, requirements: PaymentRequirements): Promise<SettleResponse> {
  let res: Response
  try {
    res = await fetch(`${API_BASE}/settle`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ paymentPayload: payload, paymentRequirements: requirements }),
    })
  } catch {
    throw new ApiError('Could not reach the Suize payment service to settle.', 0)
  }
  const data = (await res.json().catch(() => null)) as (SettleResponse & { error?: string }) | null
  if (!res.ok) throw new ApiError(data?.error || `settle failed (${res.status})`, res.status)
  if (!data) throw new ApiError('empty response from /settle', 502)
  return data
}

/** A signer over base64 tx bytes — the connected wallet (dapp-kit signTransaction). */
export type SignBytes = (bytesB64: string) => Promise<string>

/** Base64-encode the x402 PaymentPayload (the X-PAYMENT header / authorize-mode return). */
const b64payload = (p: PaymentPayload): string =>
  btoa(unescape(encodeURIComponent(JSON.stringify(p))))

/**
 * Run the vanilla-x402 'exact' pay: terms → build gasless → sign → (settle | authorize).
 *
 * - `settle: true` (default) — settles on-chain, returns `{ digest }`.
 * - `settle: false` (AUTHORIZE — the Deploy no-Sui-key door) — builds + signs but DOES
 *   NOT settle, returning `{ payment }` (the b64 SIGNED-UNSETTLED PaymentPayload). The
 *   caller hands `payment` to an agent to submit as X-PAYMENT; the merchant settles it
 *   during the deploy, so nothing is on-chain before then (nothing to replay).
 *
 * `sign` runs LOCALLY (Enoki zkLogin OR a standard wallet) — the backend never signs
 * the payer leg. `onBuilt` lets the caller flip its phase copy AFTER the bytes are ready
 * but BEFORE the (possibly modal) signature.
 */
export async function payViaX402(opts: {
  sender: string
  payTo: string
  amount: string // decimal USDC
  memo: string
  sign: SignBytes
  onBuilt?: () => void
  /** false = AUTHORIZE (build+sign, no settle) → returns { payment }. Default true. */
  settle?: boolean
}): Promise<{ digest: string } | { payment: string }> {
  const { sender, payTo, amount, memo, sign, onBuilt } = opts
  const doSettle = opts.settle !== false

  const outputs = await fetchTerms(payTo, amount)

  const g = grpc()
  let bytes: string
  try {
    const built = await buildGaslessOutputs({ client: g, sender, asset: ASSET, outputs })
    bytes = built.bytes
    await assertUnsignedBytesSafe({ client: g, bytesB64: bytes, sender, asset: ASSET, outputs })
  } catch (e) {
    // A build failure is most often "sender holds no USDC for this amount" — map to 402.
    throw new ApiError(`build failed: ${(e as Error).message}`.slice(0, 200), 402)
  }

  onBuilt?.()
  const signature = await sign(bytes)

  const total = usdcAtomic(amount).toString()
  const requirements: PaymentRequirements = {
    scheme: 'exact',
    network: NET,
    amount: total,
    asset: ASSET,
    payTo,
    maxTimeoutSeconds: MAX_TIMEOUT_SECONDS,
    extra: { outputs },
  }
  const payload: PaymentPayload = {
    x402Version: 2,
    accepted: requirements,
    payload: { signature, transaction: bytes },
    extensions: { 'payment-identifier': { info: { id: memo } } },
  }

  // AUTHORIZE: hand back the SIGNED-UNSETTLED payload (the agent submits it as X-PAYMENT).
  if (!doSettle) return { payment: b64payload(payload) }

  const receipt = await settle(payload, requirements)
  if (!receipt.success || !receipt.transaction) {
    throw new ApiError(receipt.errorReason || 'Settlement failed.', 502)
  }
  return { digest: receipt.transaction }
}

// ── Reads (moved off the deleted rail.ts) ────────────────────────────────────

/** "0.50" rendered from atomic base units (mirror of the backend's formatUsdc). */
export { formatUsdc } from '@suize/x402'

/** Structural client slice (mirrors apps/crash/src/sui.ts) — avoids nominal
 *  conflicts between @mysten/sui and the dapp-kit-bundled copy. */
export type BalanceClient = {
  getBalance: (args: { owner: string; coinType: string }) => Promise<{ totalBalance: string }>
}

/** The connected address's USDC balance, in atomic base units. */
export const readUsdcBalance = async (client: BalanceClient, owner: string): Promise<bigint> => {
  const { totalBalance } = await client.getBalance({ owner, coinType: ASSET })
  return BigInt(totalBalance)
}
