// x402 V2 wire types — the EXACT field names the protocol puts on the wire
// (specs/x402-specification-v2.md §5) plus the V2 Sui-scheme additions. Amounts
// are ATOMIC-UNIT decimal strings on the wire, NEVER numbers (precision is the
// whole point). The fee split lives in `extra.outputs`; the idempotency id lives
// in the `payment-identifier` extension — NEVER as an ad-hoc `extra.paymentId`.

/** CAIP-2 network id, `namespace:reference` (e.g. `sui:testnet`). */
export type Network = `${string}:${string}`

/** A single settlement leg of the fee split. `amount` = atomic units, decimal
 * string. The payer's tx MUST credit each declared `to` EXACTLY this `amount`. */
export type Output = { to: string; amount: string }

export type PaymentRequirements = {
  scheme: string
  network: Network
  /** TOTAL atomic units (the sum of `extra.outputs`). */
  amount: string
  asset: string
  /** Primary recipient — the merchant. */
  payTo: string
  maxTimeoutSeconds: number
  extra: {
    /** The declared fee split — the payer's tx must match these EXACTLY. */
    outputs: Output[]
    /** Facilitator door: POST { sender, requirements } → unsigned gasless bytes. */
    buildUrl?: string
    /** Informational only — the Suize rake in basis points. */
    feeBps?: number
    [k: string]: unknown
  }
}

export type ResourceInfo = {
  url: string
  description?: string
  mimeType?: string
  serviceName?: string
}

export type PaymentRequired = {
  x402Version: 2
  error?: string
  resource?: ResourceInfo
  accepts: PaymentRequirements[]
  extensions?: Record<string, unknown>
}

/** The Sui-scheme payload: a signed-but-not-executed tx. Both fields base64. */
export type ExactSuiPayload = { signature: string; transaction: string }

export type PaymentPayload = {
  x402Version: number
  resource?: ResourceInfo
  accepted: PaymentRequirements
  payload: ExactSuiPayload
  extensions?: Record<string, unknown>
}

export type VerifyResponse = {
  isValid: boolean
  invalidReason?: string
  invalidMessage?: string
  payer?: string
}

export type SettleResponse = {
  success: boolean
  errorReason?: string
  errorMessage?: string
  payer?: string
  /** Tx digest, or "" on failure. */
  transaction: string
  network: Network
  amount?: string
}

// ─────────────────────────────────────────────────────────────────────────────
// payment-identifier extension (specs/extensions/payment_identifier.md)
// The id lives at extensions["payment-identifier"].info.id — 16-128 chars,
// [A-Za-z0-9_-]. NEVER a top-level / extra field.
// ─────────────────────────────────────────────────────────────────────────────
export const PAYMENT_ID_EXT = 'payment-identifier'
const PAYMENT_ID_RE = /^[A-Za-z0-9_-]{16,128}$/

/** True iff `id` is a spec-shaped payment identifier (16-128 [A-Za-z0-9_-]). */
export const isValidPaymentId = (id: unknown): id is string =>
  typeof id === 'string' && PAYMENT_ID_RE.test(id)

/** Read the payment-identifier `id` from a PaymentPayload or PaymentRequired
 * (or any object carrying `extensions`). Returns undefined when absent/invalid. */
export const paymentIdOf = (
  src: { extensions?: Record<string, unknown> } | null | undefined,
): string | undefined => {
  const ext = src?.extensions?.[PAYMENT_ID_EXT] as { info?: { id?: unknown } } | undefined
  const id = ext?.info?.id
  return isValidPaymentId(id) ? id : undefined
}

/** Merge a payment-identifier `id` into an extensions map (non-destructive — the
 * client must keep any info the server sent). Throws on a malformed id. */
export const withPaymentId = (
  extensions: Record<string, unknown> | undefined,
  id: string,
): Record<string, unknown> => {
  if (!isValidPaymentId(id)) throw new Error(`invalid payment-identifier id: ${id}`)
  const prev = (extensions?.[PAYMENT_ID_EXT] as { info?: Record<string, unknown> }) ?? {}
  return {
    ...extensions,
    [PAYMENT_ID_EXT]: { ...prev, info: { ...prev.info, id } },
  }
}
