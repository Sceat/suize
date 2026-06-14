// ============================================================================
// settle402 — the ONE x402 V2 'exact' client engine the whole MCP pays through.
//
// Given a 402 `PaymentRequired` (the merchant's challenge) and the persisted
// zkLogin session, this:
//   1. picks the one `accepts[]` requirement we can satisfy (scheme 'exact' +
//      its CAIP-2 network == the session's network),
//   2. runs the client-side confirm dial (confirm-each / auto_under_<x> / auto)
//      — a two-step confirm:true contract, identical to the old suize_pay,
//   3. BUILDS the gasless payment tx two ways:
//        PATH A — construct it OURSELVES from the declared `extra.outputs`
//                 (or a single full-amount output) via @suize/x402
//                 buildGaslessOutputs, then self-verify with assertOutputsExact;
//        PATH B — on a PATH-A failure AND when `extra.buildUrl` is present, fetch
//                 the facilitator-built unsigned bytes and run the MANDATORY
//                 assertUnsignedBytesSafe guard before signing,
//   4. SIGNS the bytes LOCALLY with the Enoki zkLogin session (keys never leave
//      this machine; the backend never signs the payer leg),
//   5. returns the `PaymentPayload` + its base64 header value (incl. the
//      `accepted` echo and the payment-identifier extension echo).
//
// THE PAYER NEVER TRUSTS UNSEEN BYTES. PATH A is preferred precisely because we
// constructed every leg; PATH B only runs after assertUnsignedBytesSafe proves
// the facilitator's bytes are gasless, sent by us, and pay EXACTLY the split.
// ============================================================================

import { fromBase64 } from '@mysten/sui/utils'
import {
  grpcClient,
  buildGaslessOutputs,
  assertOutputsExact,
  assertUnsignedBytesSafe,
  b64json,
  formatUsdc,
  paymentIdOf,
  PAYMENT_ID_EXT,
  PAYMENT_REQUIRED_HEADER,
  type Network,
  type Output,
  type PaymentRequired,
  type PaymentRequirements,
  type PaymentPayload,
  type SettleResponse,
} from '@suize/x402'
import { combineForMultisig } from '@suize/x402'
import { CAIP2, SUIZE_API, unb64json, USDC_TYPES, type ConfirmPolicy } from './config'
import { signerFor, subaccountFor, type SuizeSession } from './session'

/** The confirm dial as a function: given the amount/recipient/resource, either
 * resolve (proceed) or throw a human-readable "CONFIRMATION REQUIRED" message the
 * tool relays to the user. The caller wires this from `confirmPolicy()` + the
 * tool's `confirm:true` arg. */
export type ConfirmGate = (ctx: {
  /** Atomic USDC units the payer will be debited (the sum of the outputs). */
  units: bigint
  /** Decimal USDC string for display ("0.5"). */
  amount: string
  /** Primary recipient (the merchant). */
  payTo: string
  /** The resource being paid for (the request URL), when known. */
  resourceUrl?: string
}) => void

/** Thrown by a ConfirmGate that needs user approval. The tool returns its message
 * as a NORMAL result (nothing was paid) — never an error. */
export class ConfirmationRequired extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConfirmationRequired'
  }
}

/** Build a ConfirmGate from the parsed policy + the tool's explicit `confirm` arg.
 * Pure: throws the relay message when approval is required and not yet given. */
export const makeConfirmGate = (policy: ConfirmPolicy, confirmed: boolean): ConfirmGate => {
  return ({ units, amount, payTo, resourceUrl }) => {
    const autoApproved =
      policy.kind === 'auto' || (policy.kind === 'auto_under' && units < policy.thresholdUnits)
    if (autoApproved || confirmed) return
    const why =
      policy.kind === 'auto_under'
        ? `the user's confirm policy auto-approves only payments under ${policy.thresholdText} USDC`
        : "the user's confirm policy is confirm-each"
    throw new ConfirmationRequired(
      [
        'CONFIRMATION REQUIRED — nothing has been paid yet.',
        '',
        `  Pay ${amount} USDC`,
        `  to  ${payTo}`,
        ...(resourceUrl ? [`  for ${resourceUrl}`] : []),
        '',
        `Because ${why}, show this payment to the user and ask them to approve it.`,
        'ONLY after the user explicitly approves, call the tool again with the SAME arguments plus "confirm": true.',
      ].join('\n'),
    )
  }
}

const SUI_ADDRESS_RE = /^0x[0-9a-fA-F]{64}$/

/** The result of a successful settle build: the wire payload + its header value. */
export interface SettledPayment {
  /** The full x402 PaymentPayload (incl. the `accepted` echo + extension echo). */
  payload: PaymentPayload
  /** base64(payload) — the value for PAYMENT-SIGNATURE / X-PAYMENT. */
  headerValue: string
  /** The requirement that was satisfied (the resource's settle needs it). */
  requirement: PaymentRequirements
  /** Atomic USDC units debited from the payer (the declared total). */
  units: bigint
}

/** Read the x402 challenge off a 402 Response: the PAYMENT-REQUIRED header first
 * (base64 JSON), else the JSON body. Returns null when neither yields an `accepts`
 * carrier. Shared by every 402 caller (paid fetch, deploy, extend). */
export const readChallenge = async (res: Response): Promise<PaymentRequired | null> => {
  const headerVal = res.headers.get(PAYMENT_REQUIRED_HEADER)
  if (headerVal) {
    const parsed = unb64json<PaymentRequired>(headerVal)
    if (parsed && Array.isArray(parsed.accepts)) return parsed
  }
  const body = (await res.clone().json().catch(() => null)) as PaymentRequired | null
  if (body && Array.isArray(body.accepts)) return body
  return null
}

/** Pick the one requirement this session can satisfy: scheme 'exact' AND its
 * CAIP-2 network equals the session's network. Returns null when none match. */
export const pickRequirement = (
  required: PaymentRequired,
  network: Network,
): PaymentRequirements | null => {
  const accepts = Array.isArray(required.accepts) ? required.accepts : []
  for (const r of accepts) {
    if (r?.scheme === 'exact' && r?.network === network) return r
  }
  return null
}

/** Resolve the outputs the payer must credit: the declared fee split, or a single
 * full-amount output to payTo (the free tier). Validates each leg's shape. */
const resolveOutputs = (r: PaymentRequirements): Output[] => {
  const declared = Array.isArray(r.extra?.outputs) ? r.extra.outputs : []
  const outputs: Output[] =
    declared.length > 0 ? declared : [{ to: r.payTo, amount: r.amount }]
  for (const o of outputs) {
    if (!o || typeof o.to !== 'string' || !SUI_ADDRESS_RE.test(o.to)) {
      throw new Error(`malformed output address in the 402 challenge: ${String(o?.to)}`)
    }
    if (typeof o.amount !== 'string' || !/^\d+$/.test(o.amount) || BigInt(o.amount) <= 0n) {
      throw new Error(`malformed output amount in the 402 challenge: ${String(o?.amount)}`)
    }
  }
  return outputs
}

/**
 * Build, confirm, and LOCALLY SIGN an x402 'exact' payment for `required`.
 *
 * Throws `ConfirmationRequired` (relayed as a normal tool result) when the dial
 * blocks, or a plain Error on any build/sign failure. Returns the wire payload +
 * its header value on success — the caller sends it back to the resource (or to
 * the facilitator's /settle for a direct transfer).
 */
export const settle402 = async (
  required: PaymentRequired,
  session: SuizeSession,
  confirmGate: ConfirmGate,
  resourceUrl?: string,
): Promise<SettledPayment> => {
  const network = CAIP2[session.network]
  const requirement = pickRequirement(required, network)
  if (!requirement) {
    throw new Error(
      `the 402 challenge offers no 'exact' requirement on ${network} — this merchant cannot be paid from this wallet`,
    )
  }

  const outputs = resolveOutputs(requirement)
  const units = outputs.reduce((s, o) => s + BigInt(o.amount), 0n)

  // The confirm dial — a block here means NOTHING was built or signed.
  confirmGate({ units, amount: formatUsdc(units), payTo: requirement.payTo, resourceUrl })

  const asset = requirement.asset
  if (typeof asset !== 'string' || !asset) {
    throw new Error('the 402 challenge is missing the settlement asset (extra.asset)')
  }
  const client = grpcClient(network)

  // The PAYER is the agent's 1-of-2 sub-account multisig {MAIN, AGENT} — the address
  // the agent's funds live in (deposit = hard cap). The agent member signs ALONE
  // (threshold 1, proven /tmp/multisig-spike step1/step3). When no MAIN pubkey was
  // connected there is no multisig → the agent pays from its own bare address.
  const subaccount = subaccountFor(session)
  const payer = subaccount?.address ?? session.address

  // ── PATH A — build the gasless tx OURSELVES, then self-verify the split. ────
  let bytes: string
  try {
    const built = await buildGaslessOutputs({ client, sender: payer, asset, outputs })
    // Self-check before signing OUR OWN bytes (cheap insurance the SDK resolved a
    // gasless tx paying exactly the split — the same gate the facilitator runs).
    await assertOutputsExact({
      client,
      txBytesB64: built.bytes,
      asset,
      outputs,
      expectedPayer: payer,
    })
    bytes = built.bytes
  } catch (pathAError) {
    // ── PATH B — fall back to the facilitator-built bytes (buildUrl), guarded. ─
    const buildUrl = typeof requirement.extra?.buildUrl === 'string' ? requirement.extra.buildUrl : ''
    if (!buildUrl) {
      throw new Error(
        `could not build the payment locally and the challenge has no buildUrl fallback: ${(pathAError as Error).message}`,
      )
    }
    let res: Response
    try {
      res = await fetch(buildUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sender: payer, outputs }),
      })
    } catch {
      throw new Error(`could not reach the payment build service at ${buildUrl} — check the connection and retry`)
    }
    const data = (await res.json().catch(() => null)) as { bytes?: string; error?: string } | null
    if (!res.ok || !data?.bytes) {
      throw new Error(data?.error || `payment build failed (${res.status})`)
    }
    // MANDATORY pre-sign guard: prove the facilitator's bytes are gasless, sent by
    // us, and pay EXACTLY the declared split — a payer must NEVER sign unseen bytes
    // that fail this.
    await assertUnsignedBytesSafe({ client, bytesB64: data.bytes, sender: payer, asset, outputs })
    bytes = data.bytes
  }

  // ── SIGN LOCALLY with the persisted zkLogin session (zero remote calls). ────
  // The AGENT member signs the bytes alone; when paying from the sub-account, wrap
  // that single member signature into the 1-of-2 multisig signature (threshold 1, so
  // the agent's lone sig satisfies it) — otherwise the bare member sig is the wire sig.
  const { signature: memberSignature } = await signerFor(session).signTransaction(fromBase64(bytes))
  const signature = subaccount ? combineForMultisig(subaccount.multisig, memberSignature) : memberSignature

  // Echo the satisfied requirement + the payment-identifier extension the server
  // sent (the merchant deep-equals `accepted` and matches the id it issued).
  const id = paymentIdOf(required)
  const payload: PaymentPayload = {
    x402Version: 2,
    ...(required.resource ? { resource: required.resource } : {}),
    accepted: requirement,
    payload: { signature, transaction: bytes },
    ...(id ? { extensions: { [PAYMENT_ID_EXT]: { info: { id } } } } : {}),
  }

  return { payload, headerValue: b64json(payload), requirement, units }
}

// ── The direct-transfer path (no merchant 402): mint a single-output challenge,
// settle it, POST the signed payload to the facilitator's /settle. Shared by
// suize_pay shape B and suize_kill — the ONE place a "send N USDC to addr" lives.

/** Build + locally sign a direct USDC transfer of `units` to `payTo` (a P2P send with
 * no merchant 402, gated by the same dial as a paid fetch), then settle it through the
 * facilitator (idempotent — a re-POST of the same signed tx returns the same digest,
 * never a double charge). Returns the settle receipt, or relays a ConfirmationRequired
 * message when the dial blocks (caller surfaces it verbatim). */
export const directTransfer = async (
  session: SuizeSession,
  payTo: string,
  units: bigint,
  confirmGate: ConfirmGate,
): Promise<SettleResponse> => {
  const amount = units.toString()
  const challenge: PaymentRequired = {
    x402Version: 2,
    accepts: [
      {
        scheme: 'exact',
        network: CAIP2[session.network],
        amount,
        asset: USDC_TYPES[session.network],
        payTo,
        maxTimeoutSeconds: 120,
        extra: { outputs: [{ to: payTo, amount }], buildUrl: `${SUIZE_API}/build` },
      },
    ],
  }
  const settled = await settle402(challenge, session, confirmGate)

  let res: Response
  try {
    res = await fetch(`${SUIZE_API}/settle`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ paymentPayload: settled.payload, paymentRequirements: settled.requirement }),
    })
  } catch {
    throw new Error(`could not reach the settlement service at ${SUIZE_API} — check the connection and retry`)
  }
  const receipt = (await res.json().catch(() => null)) as SettleResponse | null
  if (!res.ok || !receipt) throw new Error(`settlement request failed (${res.status})`)
  if (!receipt.success) {
    throw new Error(`settlement failed: ${receipt.errorReason ?? receipt.errorMessage ?? 'unknown'}`)
  }
  return receipt
}
