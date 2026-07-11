// FEE POLICY — the off-chain half of the x402 V2 'exact' scheme.
//
// The fee is NOT taken on-chain. The facilitator DECLARES a fee split and enforces
// that the payer's gasless send_funds tx credits each leg EXACTLY (assertOutputsExact
// in @suize/x402 does the enforcing). This module owns two things:
//
//   (1) WHO is the treasury — the operator's FEE_TREASURY. Either a plain 0x… address
//       (used as-is) or a SuiNS name resolved LIVE over gRPC, cached hourly and
//       FAIL-CLOSED: an unresolved name yields "" and we REFUSE to mint a split (a fee
//       with an unknown recipient would silently burn the rake). A transient miss keeps
//       the last good value; a name that never resolved denies until it does.
//
//   (2) the SPLIT for every payment — splitOutputs(payTo, treasury, amount): the
//       [merchant net, treasury fee] legs, with fee = min(max(amount·bps/10_000,
//       floor), amount−1) and a same-address MERGE. The only single-output results are
//       STRUCTURAL (merchant IS the treasury, or a sub-unit amount) — never a free tier.
//       The fee is never waived; MERCHANT_RATES only customizes the rate.

import { SUI_ADDRESS_RE } from "@suize/shared";
import type { SuiGrpcClient } from "@mysten/sui/grpc";
import { splitOutputs, type Output } from "@suize/x402";
import type { FeePolicy } from "./env";
import { resolveNameAddress } from "./sui";

// The split math lives in @suize/x402 (`splitOutputs`) — ONE shared implementation
// for merchants (computing declared outputs from GET /supported's published policy)
// and this facilitator (recomputing + enforcing the same split at verify/settle).
export { splitOutputs };

/** Thrown when FEE_TREASURY is a SuiNS name that has never resolved. TRANSIENT —
 * callers fail closed but must NEVER cache it as a terminal result (the name can
 * resolve a minute later and the same payment become valid). */
export class TreasuryUnresolvedError extends Error {
  constructor(treasury: string) {
    super(`FEE_TREASURY "${treasury}" unresolved — refusing to mint a split`);
    this.name = "TreasuryUnresolvedError";
  }
}

// ── treasury resolution — plain-address short-circuit OR live SuiNS, cached ─────
// A module-level cache persists across requests within an isolate (isolates are
// reused), so a name is resolved at most once per TTL, not per payment. A deployment
// has ONE FEE_TREASURY, so a single-slot cache is correct.
const TREASURY_TTL_MS = 60 * 60_000; // re-resolve a name at most hourly
let _treasury: { addr: string; at: number } | null = null;

/** A SuiNS handle in either `name.sui`, `label@org`, `@org`, or bare `org` form → the
 * dotted `.sui` name the resolver looks up. Returns null for an empty/garbage value. */
const dottedName = (raw: string): string | null => {
  const n = raw.trim();
  if (!n) return null;
  if (n.endsWith(".sui")) return n;
  if (n.includes("@")) {
    const [label, org] = n.split("@");
    if (!org) return null;
    return label ? `${label}.${org}.sui` : `${org}.sui`;
  }
  return `${n}.sui`;
};

/**
 * The treasury address for this policy. A plain-address FEE_TREASURY returns
 * immediately (always ready, no network). A SuiNS name is resolved over gRPC and
 * cached (≤1h); "" when it has never resolved (fail-closed). A transient miss keeps
 * the last good value.
 */
export const treasuryAddress = async (
  policy: FeePolicy,
  client: SuiGrpcClient,
): Promise<string> => {
  if (policy.treasuryIsAddress) return policy.treasury.toLowerCase(); // used as-is

  const now = Date.now();
  if (_treasury && now - _treasury.at < TREASURY_TTL_MS) return _treasury.addr;

  const name = dottedName(policy.treasury);
  if (name) {
    const addr = await resolveNameAddress(client, name);
    if (addr && SUI_ADDRESS_RE.test(addr)) {
      _treasury = { addr: addr.toLowerCase(), at: now };
      return _treasury.addr;
    }
  }
  console.error(
    `[facilitator/fees] FEE_TREASURY "${policy.treasury}" did not resolve — fail-closed`,
  );
  return _treasury?.addr ?? ""; // last-good over a transient miss; else fail-closed
};

/**
 * The declared output split for paying `payTo` a gross of `amountAtomic`, RECOMPUTED
 * from the operator policy. An unregistered merchant pays FEE_BPS; a MERCHANT_RATES
 * entry customizes the rate (never waives it). Throws (fail-closed) when the treasury
 * is unresolved — a hard refusal, never a silent free pass.
 */
export const outputsFor = async (
  policy: FeePolicy,
  client: SuiGrpcClient,
  payTo: string,
  amountAtomic: bigint,
): Promise<Output[]> => {
  const terms = policy.merchants.get(payTo.trim().toLowerCase());
  const feeBps = terms ? terms.feeBps : policy.feeBps;

  const treasury = await treasuryAddress(policy, client);
  if (!treasury) {
    throw new TreasuryUnresolvedError(policy.treasury);
  }
  return splitOutputs(payTo, treasury, amountAtomic, feeBps, policy.feeFloor);
};
