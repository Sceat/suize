// HTTP transport helpers for the x402 V2 'exact' Sui scheme. The wire carries
// base64-encoded JSON in headers. We ACCEPT both the spec header (X-PAYMENT*)
// and the canonical V2 name (PAYMENT-*) inbound, and EMIT both outbound, so a
// merchant interoperates with either family of client.

/** base64(JSON) — what every x402 header carries. */
export const b64json = (o: unknown): string =>
  Buffer.from(JSON.stringify(o), 'utf8').toString('base64')

/** base64(JSON) → T. Throws on malformed base64 / JSON (caller decides the 4xx). */
export const unb64json = <T>(s: string): T =>
  JSON.parse(Buffer.from(s, 'base64').toString('utf8')) as T

/** The 402 challenge header (server → client). */
export const PAYMENT_REQUIRED_HEADER = 'PAYMENT-REQUIRED'

/** Inbound payment-payload header names, in preference order (client → server). */
export const PAYMENT_SIG_HEADERS = ['PAYMENT-SIGNATURE', 'X-PAYMENT'] as const

/** Outbound settlement-receipt header names — emit ALL (server → client). */
export const PAYMENT_RESPONSE_HEADERS = ['PAYMENT-RESPONSE', 'X-PAYMENT-RESPONSE'] as const

/** A Headers-like: a real Headers, or any { get(name) } (e.g. a plain map shim). */
type HeadersLike = { get(name: string): string | null | undefined }

/** Read the first present payment-payload header (case-insensitive via Headers).
 * Returns the raw base64 value, or undefined when none is set. */
export const readPaymentHeader = (headers: HeadersLike): string | undefined => {
  for (const name of PAYMENT_SIG_HEADERS) {
    const v = headers.get(name)
    if (v) return v
  }
  return undefined
}

/** Recommended payment-identifier id: `pay_` + 32 lowercase hex (uuid, dashless).
 * 36 chars, well within the 16-128 [A-Za-z0-9_-] window. Uses the Web Crypto API
 * (`globalThis.crypto.randomUUID`) so this stays ISOMORPHIC — it bundles for the
 * browser (Vite/rollup) as cleanly as it runs on Bun/Node ≥19, with no `node:crypto`
 * import to externalize. */
export const mintPaymentId = (): string => `pay_${crypto.randomUUID().replace(/-/g, '')}`
