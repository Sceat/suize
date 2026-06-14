// Facilitator FEE POLICY — the off-chain half of the x402 V2 'exact' scheme.
//
// New architecture (vanilla x402, account.move DEAD): the fee is NOT taken on-chain.
// The facilitator DECLARES a fee split in PaymentRequirements.extra.outputs, the
// payer's gasless send_funds PTB must credit each leg EXACTLY (assertOutputsExact
// in @suize/x402 enforces it), and a single-output payment (no merchant in the
// registry) is the FREE tier. So this module owns two things:
//   (1) WHO is the treasury — RESOLVED LIVE from `treasury@suize` (the single source
//       of truth), cached + fail-closed. No hardcoded address anywhere (owner law
//       2026-06-14: "fees go to whatever treasury.suize.sui resolves to; we abstract");
//   (2) the SPLIT for a fee-tier merchant — outputsFor(payTo, amount): the
//       [merchant net, treasury fee] legs, with the 2% + $0.01-floor math and the
//       same-address MERGE that keeps the outputs exact-matchable.
//
// FAIL-CLOSED: if `treasury@suize` can't be resolved (a SuiNS miss, or no record yet)
// the treasury is "" — we REFUSE to mint fee-tier terms (a fee with an unknown
// recipient would silently burn the rake) and the deploy charge gate stays off.
// Free-tier (single-output) verify/settle never touch this.
//
// TRADEOFF (owner decision 2026-06-14, reversing 2026-06-12): runtime SuiNS resolution
// reopens the attack surface (a hijacked `treasury@suize` redirects fees). Accepted for
// a rotatable, single-source treasury; mitigated by caching (resolve ≤ hourly, not per
// payment) + keeping the last good value across a transient miss.

import {
  TREASURY_SUINS_NAME,
  resolveTreasury,
  SUI_ADDRESS_RE,
  caip2,
} from "@suize/shared";
import { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import { config } from "../config";

// ── fee math (mirrors subs::subscription on-chain: 2% with a $0.01 floor) ──────
// The on-chain subscription module carves min(max(amount*bps/10_000, floor), amount).
// The facilitator declares the SAME shape in the outputs so a one-off `exact`
// payment and a subscription renewal rake identically. MERCHANT-ABSORBED: the
// payer is debited `amount`; the merchant receives `amount − fee`.
const FEE_BPS = 200n; // 2%
const FEE_FLOOR = 10_000n; // $0.01 at 6 decimals
const BPS_DENOMINATOR = 10_000n;

/** A declared settlement leg — the wire's `Output` shape (atomic-unit string amount). */
export type FeeOutput = { to: string; amount: string };

/** A per-merchant rate override, parsed from the SUIZE_MERCHANTS env registry. */
type MerchantTerms = { feeBps: bigint };

// ── merchant registry — env-driven, parsed once ──────────────────────────────
// SUIZE_MERCHANTS is a JSON map { "0x<addr>": { "feeBps": 200 }, … }. ONLY the
// addresses in this map are fee-tier merchants; every other payTo is free tier
// (single output, no rake). A malformed entry is skipped loudly (logged), never
// fatal — a bad env line must not take the whole facilitator down.
const parseMerchants = (raw: string | undefined): Map<string, MerchantTerms> => {
  const map = new Map<string, MerchantTerms>();
  if (!raw || !raw.trim()) return map;
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch (e) {
    console.error("[facilitator/fees] SUIZE_MERCHANTS is not valid JSON — ignoring:", (e as Error).message);
    return map;
  }
  if (typeof obj !== "object" || obj === null) {
    console.error("[facilitator/fees] SUIZE_MERCHANTS must be a JSON object of { addr: { feeBps } } — ignoring");
    return map;
  }
  for (const [addr, terms] of Object.entries(obj as Record<string, unknown>)) {
    const key = addr.trim().toLowerCase();
    if (!SUI_ADDRESS_RE.test(key)) {
      console.error(`[facilitator/fees] SUIZE_MERCHANTS: bad address ${addr} — skipped`);
      continue;
    }
    const feeBpsRaw = (terms as { feeBps?: unknown })?.feeBps;
    const feeBps =
      typeof feeBpsRaw === "number" && Number.isInteger(feeBpsRaw) && feeBpsRaw >= 0 && feeBpsRaw <= 10_000
        ? BigInt(feeBpsRaw)
        : FEE_BPS; // default to 2% when feeBps is absent/invalid
    map.set(key, { feeBps });
  }
  return map;
};

const MERCHANTS = parseMerchants(config.suizeMerchants);

/** Whether `payTo` is a registered fee-tier merchant (else it is free tier). */
export const isFeeTierMerchant = (payTo: string): boolean =>
  MERCHANTS.has(payTo.trim().toLowerCase());

// ── treasury — RESOLVED LIVE from `treasury@suize`, cached + fail-closed ────────
// The single source of truth is the SuiNS handle. We resolve it at most once per TTL
// (not per payment), keep the last good value across a transient miss, and return ""
// when it has never resolved — fail-closed for the fee-tier + deploy-gate paths.
let _suiClient: SuiJsonRpcClient | null = null;
const suiClient = (): SuiJsonRpcClient =>
  (_suiClient ??= new SuiJsonRpcClient({ url: config.suiRpcUrl, network: config.suiNetwork }));

const TREASURY_TTL_MS = 60 * 60_000; // re-resolve at most hourly
let _treasury: { addr: string; at: number } | null = null;

/** The Suize treasury, resolved from `treasury@suize` and cached (≤1h). "" when it has
 * never resolved (fail-closed); a transient miss keeps the last good value. There is NO
 * override hook — the treasury is ALWAYS the live `treasury@suize` resolution, in every
 * environment (a test that needs to recycle its own spend funds its own dev wallet). */
export const treasuryAddress = async (): Promise<string> => {
  const now = Date.now();
  if (_treasury && now - _treasury.at < TREASURY_TTL_MS) return _treasury.addr;
  try {
    const addr = await resolveTreasury(suiClient());
    if (addr && SUI_ADDRESS_RE.test(addr)) {
      _treasury = { addr, at: now };
      return addr;
    }
    console.error("[facilitator/fees] treasury@suize did not resolve — fee-tier paths fail-closed");
  } catch (e) {
    console.error("[facilitator/fees] treasury resolution failed:", (e as Error).message);
  }
  return _treasury?.addr ?? ""; // last-good over a transient miss; else fail-closed
};

/** True when a treasury address is resolvable (boot readiness for fee-tier paths). */
export const treasuryReady = async (): Promise<boolean> => Boolean(await treasuryAddress());

// ── the split ─────────────────────────────────────────────────────────────────

/**
 * The declared output split for paying `payTo` a gross of `amountAtomic`.
 *
 * Returns `null` for the FREE tier — when `payTo` is NOT a registered merchant,
 * OR the amount is too small for a non-degenerate split (< 2× the floor, i.e. the
 * fee would meet/exceed the net). A null result means "single output, no rake":
 * the caller declares one output of the full amount to the merchant.
 *
 * For a fee-tier merchant: fee = min(max(amount·bps/10_000, $0.01), amount), and
 * the outputs are [{merchant, amount−fee}, {treasury, fee}]. CRITICAL: when the
 * merchant IS the treasury the two legs are MERGED into ONE output of the full
 * amount — duplicate addresses break assertOutputsExact's exact-match by
 * construction (each address must appear at most once in the declared outputs).
 */
export const outputsFor = async (
  payTo: string,
  amountAtomic: bigint,
): Promise<FeeOutput[] | null> => {
  const terms = MERCHANTS.get(payTo.trim().toLowerCase());
  if (!terms) return null; // free tier — not a registered merchant

  // A split is only meaningful when the net stays positive after a floored fee.
  // Below 2× the floor the fee would be ≥ the net — collapse to free tier.
  if (amountAtomic < FEE_FLOOR * 2n) return null;

  const treasury = await treasuryAddress();
  if (!treasury) {
    // FAIL-CLOSED: a fee-tier merchant but `treasury@suize` is unresolved → refuse to
    // mint a split that would burn the rake. The caller surfaces a 503/loud error.
    throw new Error("treasury@suize unresolved — refusing to mint a fee-tier split");
  }
  return splitOutputs(payTo, treasury, amountAtomic, terms.feeBps);
};

/**
 * PURE split math + the same-address MERGE (exported for unit testing without a
 * client). fee = min(max(amount·bps/10_000, $0.01), amount−1); outputs are
 * [{merchant, net}, {treasury, fee}] — UNLESS merchant === treasury, in which case
 * the two legs collapse to ONE full-amount output (duplicate addresses break
 * assertOutputsExact's exact-match by construction). Assumes amount ≥ 2× the floor.
 */
export const splitOutputs = (
  payTo: string,
  treasury: string,
  amountAtomic: bigint,
  feeBps: bigint,
): FeeOutput[] => {
  const pct = (amountAtomic * feeBps) / BPS_DENOMINATOR;
  let fee = pct > FEE_FLOOR ? pct : FEE_FLOOR; // floor
  if (fee >= amountAtomic) fee = amountAtomic - 1n; // clamp strictly below gross
  const net = amountAtomic - fee;

  // MERGE same-address legs: payer/payTo/treasury must each appear at most once.
  if (treasury.toLowerCase() === payTo.toLowerCase()) {
    return [{ to: payTo, amount: amountAtomic.toString() }];
  }
  return [
    { to: payTo, amount: net.toString() },
    { to: treasury, amount: fee.toString() },
  ];
};

/** The fee bps a merchant is charged (for the informational `extra.feeBps`), or 0
 * when free tier. */
export const feeBpsFor = (payTo: string): number => {
  const terms = MERCHANTS.get(payTo.trim().toLowerCase());
  return terms ? Number(terms.feeBps) : 0;
};

/** Boot diagnostics (mirrors sponsorInfo / facilitatorInfo). */
export const feesInfo = {
  merchantCount: MERCHANTS.size,
  treasuryName: TREASURY_SUINS_NAME,
  network: caip2(config.suiNetwork),
} as const;
