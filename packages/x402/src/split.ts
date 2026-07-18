// The x402-Sui FEE SPLIT — the one shared implementation (single home).
//
// Both sides of the rail compute the SAME split from the same inputs:
//   - a MERCHANT computes its declared outputs from the fee policy
//     it read off the facilitator's GET /supported extra { feeBps, feeFloor, treasury };
//   - the FACILITATOR recomputes this split at verify/settle and enforces that the
//     payment credits each leg EXACTLY (payer/merchant-declared outputs are never
//     trusted — see the facilitator's doVerify).
//
// fee = min(max(amount·bps/10_000, floor), amount − 1), merchant-absorbed:
// the payer is debited `amount`; the merchant receives `amount − fee`.

import type { Output } from './types'

const BPS_DENOMINATOR = 10_000n

/**
 * The declared output split for paying `payTo` a gross of `amountAtomic` under an
 * operator fee policy. PURE (no client, no network) — the testable kernel.
 *
 * Outputs are [{merchant, net}, {treasury, fee}] UNLESS merchant === treasury, in
 * which case the legs collapse to ONE full-amount output (duplicate addresses break
 * exact-output matching by construction). A sub-unit amount where no fee can be
 * carved without a zero/negative leg also collapses to a single output — the only
 * physically-unavoidable single-output case (a 1-unit payment is $0.000001).
 * An operator MAY configure a zero fee (bps 0 + floor 0); a payer or merchant can
 * never bypass whatever the operator configured.
 */
export function splitOutputs(
  payTo: string,
  treasury: string,
  amountAtomic: bigint,
  feeBps: bigint,
  feeFloor: bigint,
): Output[] {
  const pct = (amountAtomic * feeBps) / BPS_DENOMINATOR
  let fee = pct > feeFloor ? pct : feeFloor // floor
  if (fee >= amountAtomic) fee = amountAtomic - 1n // clamp strictly below gross
  const net = amountAtomic - fee

  if (fee <= 0n || net <= 0n) {
    return [{ to: payTo, amount: amountAtomic.toString() }]
  }
  // MERGE same-address legs: each address must appear at most once in the outputs.
  if (treasury.toLowerCase() === payTo.toLowerCase()) {
    return [{ to: payTo, amount: amountAtomic.toString() }]
  }
  return [
    { to: payTo, amount: net.toString() },
    { to: treasury, amount: fee.toString() },
  ]
}
