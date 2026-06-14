// ============================================================================
// suize_pay — the agent's x402 V2 wallet, two shapes from one tool:
//
//  (A) { url, method?, body? } — the PAID-FETCH loop. Request the resource; on a
//      402 read the x402 challenge (PAYMENT-REQUIRED header, else the JSON body),
//      build + LOCALLY SIGN the gasless 'exact' payment (settle402), and RETRY the
//      SAME request carrying PAYMENT-SIGNATURE (+ X-PAYMENT). On success return the
//      body + the settlement digest (from the PAYMENT-RESPONSE receipt header). A
//      SECOND 402 after we paid is REPORTED, never re-paid (the merchant rejected
//      our settled payment — re-paying would double-charge).
//
//  (B) { payTo, amount } — a DIRECT gasless USDC transfer. directTransfer mints a
//      single-output 'exact' payment, signs it locally, and POSTs it to the
//      facilitator's /settle → the digest. The agent equivalent of `spend`.
//
// Gas-free for the payer: the gasless Address-Balance `send_funds` PTB needs no
// SUI. The persisted zkLogin session signs the bytes on THIS machine — keys never
// leave it, the backend never signs the payer leg. The confirm dial (SUIZE_CONFIRM)
// gates BOTH shapes via the two-step confirm:true contract.
// ============================================================================

import { PAYMENT_SIG_HEADERS, PAYMENT_RESPONSE_HEADERS, type SettleResponse } from '@suize/x402'
import { confirmPolicy, parseUsdcDecimal, SUI_ADDRESS_RE, unb64json } from './config'
import { assertEpochLive, requireSession, type SuizeSession } from './session'
import {
  directTransfer,
  makeConfirmGate,
  readChallenge,
  settle402,
  type SettledPayment,
} from './x402-client'

export interface PayArgs {
  // ── shape A ──
  url?: unknown
  method?: unknown
  body?: unknown
  // ── shape B ──
  payTo?: unknown
  amount?: unknown
  // ── shared ──
  confirm?: unknown
}

/** Pull the digest out of a PAYMENT-RESPONSE receipt header (base64 SettleResponse). */
const digestFromReceipt = (headers: Headers): string | null => {
  for (const name of PAYMENT_RESPONSE_HEADERS) {
    const raw = headers.get(name)
    if (!raw) continue
    const r = unb64json<SettleResponse>(raw)
    if (r && typeof r.transaction === 'string' && r.transaction) return r.transaction
  }
  return null
}

/** Cap an opaque response body for return to the assistant (don't flood it). */
const MAX_BODY_CHARS = 8_000
const bodyText = async (res: Response): Promise<string> => {
  const t = await res.text().catch(() => '')
  return t.length > MAX_BODY_CHARS ? t.slice(0, MAX_BODY_CHARS) + '\n…[truncated]' : t
}

// ── Shape A — the paid-fetch loop ────────────────────────────────────────────

const HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'])

const paidFetch = async (args: PayArgs, session: SuizeSession): Promise<string> => {
  const url = String(args.url).trim()
  let target: URL
  try {
    target = new URL(url)
  } catch {
    throw new Error(`malformed url — expected an absolute http(s) URL, got "${url}"`)
  }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    throw new Error('url must be an http(s) URL')
  }
  const method = (typeof args.method === 'string' ? args.method : 'GET').toUpperCase()
  if (!HTTP_METHODS.has(method)) throw new Error(`unsupported method: ${method}`)
  const hasBody = args.body !== undefined && args.body !== null && method !== 'GET' && method !== 'HEAD'
  const bodyInit =
    hasBody && typeof args.body !== 'string' ? JSON.stringify(args.body) : (args.body as string | undefined)
  const baseHeaders: Record<string, string> = {}
  if (hasBody) baseHeaders['content-type'] = typeof args.body === 'string' ? 'text/plain' : 'application/json'

  const doFetch = (extra?: Record<string, string>): Promise<Response> =>
    fetch(url, { method, headers: { ...baseHeaders, ...extra }, ...(hasBody ? { body: bodyInit } : {}) })

  // 1. First request — no payment.
  let res: Response
  try {
    res = await doFetch()
  } catch {
    throw new Error(`could not reach ${url} — check the connection and retry`)
  }
  if (res.status !== 402) {
    return JSON.stringify({ url, status: res.status, paid: false, body: await bodyText(res) }, null, 2)
  }

  // 2. 402 — read the challenge, build + sign, retry with the payment header.
  const challenge = await readChallenge(res)
  if (!challenge) {
    throw new Error('the resource answered 402 but no x402 challenge was found (no PAYMENT-REQUIRED header or body)')
  }
  await assertEpochLive(session)

  const gate = makeConfirmGate(confirmPolicy(), args.confirm === true)
  let settled: SettledPayment
  try {
    settled = await settle402(challenge, session, gate, url)
  } catch (e) {
    // A confirmation request is a NORMAL result (nothing was paid) — surface its
    // message verbatim; any other error propagates as a tool error.
    if ((e as Error).name === 'ConfirmationRequired') return (e as Error).message
    throw e
  }

  const sigHeaders: Record<string, string> = {}
  for (const name of PAYMENT_SIG_HEADERS) sigHeaders[name] = settled.headerValue

  let retry: Response
  try {
    retry = await doFetch(sigHeaders)
  } catch {
    throw new Error(`paid, but could not reach ${url} on the retry — check the connection (do NOT pay again)`)
  }

  // 3a. SECOND 402 after we paid → the merchant rejected our settled payment.
  // REPORT it, NEVER re-pay (a re-pay double-charges). The signed tx may have
  // already broadcast merchant-side — the digest is recoverable via suize_receipts.
  if (retry.status === 402) {
    const reason = (await retry.clone().json().catch(() => null)) as { error?: string } | null
    return JSON.stringify(
      {
        url,
        paid: true,
        served: false,
        note:
          'the merchant returned a SECOND 402 after the payment was presented — do NOT pay again. ' +
          (reason?.error ? `reason: ${reason.error}. ` : '') +
          'If USDC left the wallet, find the digest with suize_receipts.',
      },
      null,
      2,
    )
  }

  // 3b. Served — return the body + the settlement digest from the receipt header.
  const digest = digestFromReceipt(retry.headers)
  return JSON.stringify(
    {
      url,
      status: retry.status,
      paid: true,
      served: true,
      ...(digest ? { digest } : {}),
      body: await bodyText(retry),
    },
    null,
    2,
  )
}

// ── Shape B — a direct gasless transfer (build → sign → POST /settle) ─────────

const sendUsdc = async (args: PayArgs, session: SuizeSession): Promise<string> => {
  const payTo = String(args.payTo).trim()
  if (!SUI_ADDRESS_RE.test(payTo)) throw new Error('malformed payTo — expected a 0x…64-hex Sui address')
  const amount = typeof args.amount === 'string' ? args.amount.trim() : String(args.amount ?? '')
  const units = parseUsdcDecimal(amount)
  if (units === null) {
    throw new Error('malformed amount — a positive decimal USDC string with ≤ 6 dp, e.g. "0.50"')
  }
  await assertEpochLive(session)

  const gate = makeConfirmGate(confirmPolicy(), args.confirm === true)
  let receipt: SettleResponse
  try {
    receipt = await directTransfer(session, payTo, units, gate)
  } catch (e) {
    if ((e as Error).name === 'ConfirmationRequired') return (e as Error).message
    throw e
  }
  return JSON.stringify(
    { digest: receipt.transaction, payTo, amount, payer: receipt.payer ?? session.address },
    null,
    2,
  )
}

// ── The tool entry — route by argument shape ─────────────────────────────────

export const suizePay = async (args: PayArgs): Promise<string> => {
  const session = requireSession()
  const hasUrl = typeof args.url === 'string' && (args.url as string).trim() !== ''
  const hasPayTo = typeof args.payTo === 'string' && (args.payTo as string).trim() !== ''

  if (hasUrl && hasPayTo) {
    throw new Error('pass EITHER { url } (pay a 402 resource) OR { payTo, amount } (a direct transfer) — not both')
  }
  if (hasUrl) return paidFetch(args, session)
  if (hasPayTo) return sendUsdc(args, session)
  throw new Error('suize_pay needs { url } to pay a 402 resource, or { payTo, amount } for a direct transfer')
}
