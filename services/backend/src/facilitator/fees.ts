// Facilitator FEE POLICY — the off-chain half of the x402 V2 'exact' scheme.
//
// New architecture (vanilla x402, account.move DEAD): the fee is NOT taken on-chain.
// The facilitator DECLARES a fee split in PaymentRequirements.extra.outputs, the
// payer's gasless send_funds PTB must credit each leg EXACTLY (assertOutputsExact
// in @suize/x402 enforces it). NO FREE TIER (owner law 2026-06-14: the fee is NEVER
// waived) — EVERY payment carries the fee: an unregistered merchant pays the default
// 2%, and the registry only customizes the rate. So this module owns two things:
//   (1) WHO is the treasury — RESOLVED LIVE from `treasury@suize` (the single source
//       of truth), cached + fail-closed. No hardcoded address anywhere (owner law
//       2026-06-14: "fees go to whatever treasury.suize.sui resolves to; we abstract");
//   (2) the SPLIT for EVERY merchant — outputsFor(payTo, amount): the [merchant net,
//       treasury fee] legs, with the 2% + $0.01-floor math and the same-address MERGE
//       that keeps the outputs exact-matchable. The only single-output results are
//       structural (merchant==treasury, or a sub-unit amount), never a free tier.
//
// FAIL-CLOSED: if `treasury@suize` can't be resolved (a SuiNS miss, or no record yet)
// the treasury is "" — we REFUSE to mint terms (a fee with an unknown recipient would
// silently burn the rake) and the deploy charge gate stays off.
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
import { config } from "../config";
import { grpcClient, treasuryResolver } from "../sui";

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
// SUIZE_MERCHANTS is a JSON map { "0x<addr>": { "feeBps": 250 }, … } of CUSTOM rate
// overrides. A payTo NOT in the map pays the DEFAULT 2% — there is NO free tier (owner
// law 2026-06-14: the fee is never waived). A malformed entry is skipped loudly (logged),
// never fatal — a bad env line must not take the whole facilitator down.
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

/** Whether `payTo` has a CUSTOM rate override in the registry. (Every merchant pays the
 * fee now — an unregistered one just pays the default; this only flags a custom rate.) */
export const isFeeTierMerchant = (payTo: string): boolean =>
  MERCHANTS.has(payTo.trim().toLowerCase());

// ── treasury — RESOLVED LIVE from `treasury@suize`, cached + fail-closed ────────
// The single source of truth is the SuiNS handle. We resolve it at most once per TTL
// (not per payment), keep the last good value across a transient miss, and return ""
// when it has never resolved — fail-closed for the fee-tier + deploy-gate paths.
// The gRPC client, adapted to the shared TreasuryResolver (name→address via
// NameService.lookupName). Built lazily, once.
let _resolver: ReturnType<typeof treasuryResolver> | null = null;
const resolver = () => (_resolver ??= treasuryResolver(grpcClient()));

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
    const addr = await resolveTreasury(resolver());
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
 * NO FREE TIER (owner law 2026-06-14: the fee is NEVER waived). EVERY payment carries
 * the fee: an UNREGISTERED merchant pays the DEFAULT 2%, and the `SUIZE_MERCHANTS`
 * registry only CUSTOMIZES the rate (it never makes a merchant free). The outputs are
 * [{merchant, amount−fee}, {treasury, fee}] with fee = min(max(amount·bps/10_000,
 * $0.01), amount−1). The ONLY single-output results are structural, NOT a free tier:
 * (a) merchant IS the treasury (first-party, e.g. the deploy charge — the two legs MERGE,
 * since duplicate addresses break assertOutputsExact), and (b) a sub-unit amount where no
 * fee can be carved (see splitOutputs). Throws (fail-closed) if `treasury@suize` is
 * unresolved — a hard refusal, never a silent free pass.
 */
export const outputsFor = async (
  payTo: string,
  amountAtomic: bigint,
): Promise<FeeOutput[]> => {
  // Unregistered merchant → DEFAULT fee; registry entry → its custom rate. No null/free path.
  const terms = MERCHANTS.get(payTo.trim().toLowerCase());
  const feeBps = terms ? terms.feeBps : FEE_BPS;

  const treasury = await treasuryAddress();
  if (!treasury) {
    // FAIL-CLOSED: `treasury@suize` unresolved → refuse to mint a split that would burn
    // the rake. The caller surfaces a 503/loud error — a hard refusal, not a free tier.
    throw new Error("treasury@suize unresolved — refusing to mint a split");
  }
  return splitOutputs(payTo, treasury, amountAtomic, feeBps);
};

/**
 * PURE split math + the same-address MERGE (exported for unit testing without a
 * client). fee = min(max(amount·bps/10_000, $0.01), amount−1); outputs are
 * [{merchant, net}, {treasury, fee}] — UNLESS merchant === treasury, in which case
 * the two legs collapse to ONE full-amount output (duplicate addresses break
 * assertOutputsExact's exact-match by construction). Works for ANY amount ≥ 2 units
 * (the floor clamps to amount−1, so the net stays ≥ 1); a sub-2-unit amount where no
 * fee can be carved collapses to a single output (the only physically-unavoidable case).
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

  // A sub-unit amount (≤ 1) can't carry a fee without a zero/negative leg — the only
  // physically-unavoidable single-output case (not a tier; a 1-unit payment is $0.000001).
  if (fee <= 0n || net <= 0n) {
    return [{ to: payTo, amount: amountAtomic.toString() }];
  }
  // MERGE same-address legs: payer/payTo/treasury must each appear at most once.
  if (treasury.toLowerCase() === payTo.toLowerCase()) {
    return [{ to: payTo, amount: amountAtomic.toString() }];
  }
  return [
    { to: payTo, amount: net.toString() },
    { to: treasury, amount: fee.toString() },
  ];
};

/** The fee bps a merchant is charged (for the informational `extra.feeBps`): a custom
 * rate from the registry, else the DEFAULT 2% — every merchant pays (no free tier). */
export const feeBpsFor = (payTo: string): number => {
  const terms = MERCHANTS.get(payTo.trim().toLowerCase());
  return Number(terms ? terms.feeBps : FEE_BPS);
};

/** Boot diagnostics (mirrors sponsorInfo / facilitatorInfo). */
export const feesInfo = {
  merchantCount: MERCHANTS.size,
  treasuryName: TREASURY_SUINS_NAME,
  network: caip2(config.suiNetwork),
} as const;
