/**
 * Facilitator HTTP client for the /confirm popup — the VANILLA-x402 'exact' pay
 * flow (the new rail; `account.move` is dead). The popup pays from the signed-in
 * Suize session, gaslessly, signing LOCALLY:
 *
 *   1. GET  /terms?payTo&amount  → the declared fee split (outputs) for this
 *      merchant+price (null = the free tier, a single full-amount output).
 *   2. build the gasless `send_funds` PTB for THAT split (@suize/x402
 *      buildGaslessOutputs) — over the gRPC transport that bakes in the gasless
 *      params. assertUnsignedBytesSafe gates it BEFORE signing (never sign bytes
 *      that aren't gasless + exact — display=build holds end-to-end here because
 *      THIS window builds the outputs from the terms it showed).
 *   3. sign the EXACT bytes with the local zkLogin session (caller-provided signer).
 *   4. POST /settle { paymentPayload, paymentRequirements } → the facilitator
 *      re-verifies + broadcasts (idempotent by digest) → the executed digest.
 *
 * The backend NEVER signs the payer leg — it only re-verifies + broadcasts the
 * payer's own signed gasless tx. Amounts on the wire are DECIMAL USDC strings.
 */

import { caip2, USDC_TYPES } from '@suize/shared';
import {
  buildGaslessOutputs,
  assertUnsignedBytesSafe,
  grpcClient,
  usdcAtomic,
  type Output,
  type PaymentRequirements,
  type PaymentPayload,
  type SettleResponse,
} from '@suize/x402';
import { API_BASE, NETWORK } from '../lib/env';

export class FacilitatorError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

const NET = caip2(NETWORK);
const ASSET = USDC_TYPES[NETWORK];
const MAX_TIMEOUT_SECONDS = 120;

let _grpc: ReturnType<typeof grpcClient> | null = null;
const grpc = () => (_grpc ??= grpcClient(NET));

/** GET /terms — the declared fee split for this merchant+price (decimal amount). */
async function fetchTerms(payTo: string, amount: string): Promise<Output[]> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/terms?` + new URLSearchParams({ payTo, amount }));
  } catch {
    throw new FacilitatorError('Could not reach the payment service — check your connection and retry.', 0);
  }
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new FacilitatorError(data?.error || `terms failed (${res.status})`, res.status);
  }
  const body = (await res.json().catch(() => null)) as { outputs?: Output[] | null } | null;
  // null/empty outputs = the free tier: a single full-amount output to the merchant.
  const split = body?.outputs && body.outputs.length > 0
    ? body.outputs
    : [{ to: payTo, amount: usdcAtomic(amount).toString() }];
  return split;
}

/** POST /settle — re-verify + broadcast the signed gasless tx (idempotent). */
async function settle(
  payload: PaymentPayload,
  requirements: PaymentRequirements,
): Promise<SettleResponse> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/settle`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ paymentPayload: payload, paymentRequirements: requirements }),
    });
  } catch {
    throw new FacilitatorError('Could not reach the payment service to settle.', 0);
  }
  const data = (await res.json().catch(() => null)) as (SettleResponse & { error?: string }) | null;
  if (!res.ok) throw new FacilitatorError(data?.error || `settle failed (${res.status})`, res.status);
  if (!data) throw new FacilitatorError('empty response from /settle', 502);
  return data;
}

/** A signer over base64 tx bytes — the local zkLogin session (dapp-kit signTransaction). */
export type SignBytes = (bytesB64: string) => Promise<string>;

/** Base64-encode the x402 PaymentPayload (the X-PAYMENT header / authorize-mode return). */
const b64payload = (p: PaymentPayload): string =>
  btoa(unescape(encodeURIComponent(JSON.stringify(p))));

/**
 * Run the vanilla-x402 'exact' pay: terms → build gasless → sign → (settle | authorize).
 *
 * - `settle: true` (default) — settles on-chain and returns `{ digest }`.
 * - `settle: false` (AUTHORIZE mode — the Deploy no-Sui-key door) — builds + signs but
 *   DOES NOT settle, returning `{ payment }` (the b64 SIGNED-UNSETTLED PaymentPayload).
 *   The caller hands `payment` to an agent to submit as X-PAYMENT; the merchant settles
 *   it during the deploy, so nothing is on-chain before then (nothing to replay).
 *
 * Throws FacilitatorError on a definitive failure.
 *
 * @param sign  signs the EXACT gasless bytes with the LOCAL session (never the backend).
 */
export async function payViaX402(opts: {
  sender: string;
  payTo: string;
  amount: string; // decimal USDC
  memo: string;
  sign: SignBytes;
  /** false = AUTHORIZE (build+sign, no settle) → returns { payment }. Default true. */
  settle?: boolean;
}): Promise<{ digest: string } | { payment: string }> {
  const { sender, payTo, amount, memo, sign } = opts;
  const doSettle = opts.settle !== false;

  // 1. the declared split for this merchant+price.
  const outputs = await fetchTerms(payTo, amount);

  // 2. build the gasless payment PTB for THAT split + the mandatory pre-sign guard.
  const g = grpc();
  let bytes: string;
  try {
    const built = await buildGaslessOutputs({ client: g, sender, asset: ASSET, outputs });
    bytes = built.bytes;
    await assertUnsignedBytesSafe({ client: g, bytesB64: bytes, sender, asset: ASSET, outputs });
  } catch (e) {
    throw new FacilitatorError(`Could not prepare your payment: ${(e as Error).message}`.slice(0, 200), 502);
  }

  // 3. sign the EXACT bytes locally.
  const signature = await sign(bytes);

  // 4. assemble the x402 PaymentRequirements + PaymentPayload.
  const total = usdcAtomic(amount).toString();
  const requirements: PaymentRequirements = {
    scheme: 'exact',
    network: NET,
    amount: total,
    asset: ASSET,
    payTo,
    maxTimeoutSeconds: MAX_TIMEOUT_SECONDS,
    extra: { outputs },
  };
  const payload: PaymentPayload = {
    x402Version: 2,
    accepted: requirements,
    payload: { signature, transaction: bytes },
    extensions: {
      // the 402 paymentId rides the spec payment-identifier extension (memo carries it).
      'payment-identifier': { info: { id: memo } },
    },
  };

  // AUTHORIZE: hand back the SIGNED-UNSETTLED payload (the agent submits it as X-PAYMENT).
  if (!doSettle) return { payment: b64payload(payload) };

  // SETTLE: re-verify + broadcast (idempotent by digest).
  const receipt = await settle(payload, requirements);
  if (!receipt.success || !receipt.transaction) {
    throw new FacilitatorError(receipt.errorReason || 'Settlement failed.', 502);
  }
  return { digest: receipt.transaction };
}
