// CHARGE↔Deploy join (x402 V2 'exact', first-party) — the payment gate in front of
// the deploy flow. A deploy is a one-off $0.50 settlement on the rail, settled DURING
// the deploy (atomically with the on-chain Site mint). "Deploy is the first merchant
// on the rail."
//
// NEW ARCHITECTURE (account.move DEAD; nonce-free since 2026-06-14): the payer signs a
// gasless Address-Balance `send_funds` PTB; the facilitator (this same process) VERIFIES
// the signed-but-NOT-executed tx pays the declared outputs EXACTLY (doVerify) and the
// deploy flow SETTLES it (doSettle) immediately before minting the Site. Deploy is a
// FIRST-PARTY merchant: the merchant IS the Suize treasury, so the requirement is a
// SINGLE output of the full $0.50 to the treasury (no fee split — the fee tier is
// irrelevant when 100% already lands on us).
//
// ONE DOOR, ONE AUTH PRIMITIVE — the signed payment payload IS the authorization:
//   A bare POST /deploy answers 402 with the x402 V2 PaymentRequired body (+ the
//   PAYMENT-REQUIRED header). The payer builds the gasless payment (POST /build with
//   the challenge's accepts[0] outputs, or its own send_funds PTB), signs LOCALLY, and
//   retries multipart with the b64 PaymentPayload in the X-PAYMENT header. There is NO
//   separate deploy-auth nonce/signature: the payment's signature already proves who
//   paid, and the RECOVERED PAYER becomes the on-chain `owner` (whoever pays, owns).
//
// TWO DOORS, ONE WIRE: the agent signs the payment ITSELF — with its own Sui key (the
// Sui-aware door) or its Suize zkLogin session via the MCP (the Suize door). Both submit
// the SAME X-PAYMENT; owner = the recovered payer. There is NO human/relay path.
//
// ONE-SITE-PER-PAYMENT is ENFORCED ON-CHAIN: create_site records the settled payment
// digest in a shared SiteDigestRegistry and aborts EDigestUsed on a duplicate (the
// multi-replica-safe consume guard — THE PRINCIPLE: the chain is the database). No
// per-replica in-memory dedup map.
//
// GATED until the treasury fee-recipient resolves (treasuryReady). Until then the deploy
// route runs un-gated (rate limits only) — the documented "abuse mitigation, not
// billing" mode. The moment the treasury resolves, the charge gate lights up.
import {
  DEPLOY_CHARGE_AMOUNT,
  DEPLOY_PREMIUM_CHARGE_AMOUNT,
  caip2,
  type SuiNetwork,
} from "@suize/shared";
import {
  mintPaymentRequired,
  type Network,
  type Output,
  type PaymentPayload,
  type PaymentRequired,
  type PaymentRequirements,
} from "@suize/pay";
import { formatUsdc } from "@suize/x402";
import { config } from "../config";
import { doVerify, doSettle } from "../facilitator/x402";
import { recoverPayer } from "@suize/x402";
import { treasuryAddress, treasuryReady } from "../facilitator/fees";

// ---------------------------------------------------------------------------
// The gate. The join is LIVE only when the treasury fee-recipient is resolvable
// (the merchant that the deploy settlement pays). `chargeGateReady` is the single
// predicate the deploy module's payment check reads.
// ---------------------------------------------------------------------------

const NETWORK: Network = caip2(config.suiNetwork as SuiNetwork);
/** An atomic USDC amount → the x402 wire's decimal string ("0.5" for 500_000). */
const priceDecimal = (amount: number): string => formatUsdc(BigInt(amount));
/** The STANDARD deploy price as the decimal wire string ("0.5" for 500_000). */
const DEPLOY_PRICE_DECIMAL = priceDecimal(DEPLOY_CHARGE_AMOUNT);
/** The PREMIUM (active-subscriber) deploy price ("0.1" for 100_000). */
const DEPLOY_PREMIUM_PRICE_DECIMAL = priceDecimal(DEPLOY_PREMIUM_CHARGE_AMOUNT);
const STD_AMOUNT_STR = BigInt(DEPLOY_CHARGE_AMOUNT).toString();
const PREMIUM_AMOUNT_STR = BigInt(DEPLOY_PREMIUM_CHARGE_AMOUNT).toString();

/** True once the Deploy merchant (= the treasury) is resolvable — the charge gate. */
export const chargeGateReady = (): Promise<boolean> => treasuryReady();

/** A clear reason the join isn't live yet (for the 402/503 body). */
export const chargeGateReason = (): string =>
  "rail not configured: Deploy treasury (fee_recipient) unresolved";

/** The Deploy treasury (merchant) the settlement must pay — resolved from SuiNS,
 * falling back to the network address (the same resolver the facilitator fee tier
 * uses). "" when unresolved (fail-closed: no terms minted). */
export const deployMerchant = (): Promise<string> => treasuryAddress();

// ---------------------------------------------------------------------------
// deployRequirements — the x402 V2 PaymentRequired body POST /deploy answers when
// no payment proof is presented. SINGLE OUTPUT (first-party — 100% of the $0.50 to
// the Deploy treasury; the fees /terms tier is irrelevant here, so we build the
// requirement directly with no extra.outputs split). The buildUrl / facilitator
// point back at THIS process's own origin (merchant and facilitator are one process
// here), derived from the request URL so local dev self-targets too.
// ---------------------------------------------------------------------------

/** Restore the real scheme behind the CF tunnel (the pod sees plain http);
 * any non-localhost host defaults to https so a minted action URL never eats a
 * scheme redirect that drops an agent's method/body. Returns the request origin. */
const originOf = (requestUrl: string, forwardedProto?: string | null): string => {
  try {
    const u = new URL(requestUrl);
    const local = u.hostname === "localhost" || u.hostname === "127.0.0.1";
    if (forwardedProto === "https" || !local) u.protocol = "https:";
    return u.origin;
  } catch {
    return "https://api.suize.io"; // last-resort fallback (never hit in practice)
  }
};

/** The deploy rider appended to the 402 body's error (the whoever-pays-owns contract). */
const DEPLOY_RIDER =
  "Suize Deploy: the payment IS the authorization — whoever pays owns the site (the " +
  "site's owner = the recovered payer). Sign the gasless payment yourself — with your " +
  "own Sui key, or your Suize session via the MCP — and retry as multipart/form-data " +
  "with fields name + site.tar plus the X-PAYMENT header carrying the b64 PaymentPayload. " +
  "One payment mints one site.";

/**
 * Mint the x402 V2 PaymentRequired POST /deploy answers when unpaid. The merchant
 * is the resolved Deploy treasury; the requirement is a SINGLE full-amount output
 * (first-party). The facilitator (build/verify/settle) is THIS process's origin.
 * Returns null when the treasury is unresolved (gate off → un-gated deploy).
 */
export const deployRequirements = async (
  requestUrl: string,
  forwardedProto?: string | null,
  /** Quote the discounted $0.10 rate (the caller resolved the payer is a Deploy
   * subscriber, e.g. from a `?sender=` hint). The verify still RE-checks premium —
   * this only makes the challenge self-describing. */
  premium = false,
): Promise<(PaymentRequired & { error: string }) | null> => {
  const merchant = await deployMerchant();
  if (!merchant) return null; // gate off — caller falls through to un-gated deploy
  const origin = originOf(requestUrl, forwardedProto);
  const body = mintPaymentRequired(
    {
      to: merchant,
      price: premium ? DEPLOY_PREMIUM_PRICE_DECIMAL : DEPLOY_PRICE_DECIMAL,
      facilitator: origin,
      network: NETWORK,
    },
    { resourceUrl: requestUrl },
    // NOTE: no `outputs` → mintPaymentRequired builds the single full-amount output
    // (first-party). The fee /terms tier is intentionally skipped here.
  );
  return {
    ...body,
    error: `payment required. ${DEPLOY_RIDER}`,
  };
};

// ---------------------------------------------------------------------------
// Payment gate — VERIFY the X-PAYMENT header in-process (no HTTP loopback), then
// the deploy flow SETTLES it right before the on-chain Site mint. The header carries
// the b64 PaymentPayload (the @suize/pay v2 wire).
//
// Single-use is ENFORCED ON-CHAIN (create_site + SiteDigestRegistry → EDigestUsed),
// not in a per-replica map — a retry on another replica or a double-submit aborts at
// the mint. doSettle is itself idempotent by digest (chain-fallback), so a re-presented
// header never double-charges; the on-chain dedup blocks a second Site.
// ---------------------------------------------------------------------------

/** A tagged payment failure → an HTTP status the deploy route surfaces. status 402
 * carries a fresh challenge (a definitive not-this-payment); 409/502/503 do not. */
export class DeployPaymentError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** True → the deploy route re-mints a 402 challenge (settle correctly). */
    readonly challenge = false,
  ) {
    super(message);
    this.name = "DeployPaymentError";
  }
}

const b64jsonDecode = <T>(s: string): T | null => {
  try {
    return JSON.parse(Buffer.from(s, "base64").toString("utf8")) as T;
  } catch {
    return null;
  }
};

/** Order-insensitive structural equality for the plain JSON x402 wire shapes. */
const deepEqual = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    const used = new Array(b.length).fill(false);
    return a.every((x) => {
      const i = b.findIndex((y, j) => !used[j] && deepEqual(x, y));
      if (i < 0) return false;
      used[i] = true;
      return true;
    });
  }
  const ka = Object.keys(a as object);
  const kb = Object.keys(b as object);
  if (ka.length !== kb.length) return false;
  return ka.every(
    (k) =>
      Object.prototype.hasOwnProperty.call(b, k) &&
      deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
  );
};

/** Build the requirement WE expect the payer to have accepted (the single full-amount
 * output to the resolved Deploy treasury, for the given decimal price). The presented
 * `accepted` must deep-equal it. */
const expectedRequirement = (merchant: string, price: string): PaymentRequirements =>
  mintPaymentRequired(
    { to: merchant, price, network: NETWORK },
    { paymentId: "pay_" + "0".repeat(32) }, // id is NOT compared (stripped below)
  ).accepts[0];

/** The single declared output (the chosen amount to the Deploy treasury). */
const deployOutputs = (merchant: string, amountStr: string): Output[] => [
  { to: merchant, amount: amountStr },
];

/** A verified (NOT-yet-settled) deploy payment — the payer the recovered signature
 * proves (→ the on-chain owner) plus the payload + requirements to settle later. */
export interface VerifiedDeployPayment {
  /** The recovered payer (the on-chain Site owner — whoever pays, owns). */
  payer: string;
  payload: PaymentPayload;
  requirements: PaymentRequirements;
}

/**
 * VERIFY (simulate-only — never broadcasts) the X-PAYMENT header pays the EXACT $0.50
 * to the Deploy treasury, and return the RECOVERED PAYER (→ the on-chain owner) plus
 * the payload/requirements to settle later. The payment's signature IS the deploy
 * authorization — there is no separate deploy-auth signature, and no payer==owner
 * compare (the payer simply IS the owner). Throws DeployPaymentError on any mismatch.
 *
 * Settlement is DEFERRED to {@link settleDeployPayment}, called from the deploy flow
 * immediately before create_site, so the settled digest threads into the on-chain
 * one-site-per-payment registry (the atomic, multi-replica-safe consume guard).
 *
 * @param headerValue  the raw X-PAYMENT header (b64 PaymentPayload).
 */
export const gateDeployPayment = async (
  headerValue: string,
  /** Resolve whether a payer holds an active Deploy subscription (→ may pay the
   * discounted $0.10 rate). Default: never premium (the extend route keeps the flat
   * $0.50). The main deploy route passes `hasValidDeploySub`. */
  isPremium: (payer: string) => Promise<boolean> = async () => false,
): Promise<VerifiedDeployPayment> => {
  const merchant = await deployMerchant();
  if (!merchant) throw new DeployPaymentError(chargeGateReason(), 503);

  const payload = b64jsonDecode<PaymentPayload>(headerValue.trim());
  if (!payload || typeof payload !== "object" || !payload.payload?.transaction) {
    throw new DeployPaymentError("malformed X-PAYMENT payload", 402, true);
  }

  // Recover the payer FIRST — the allowed price depends on whether THIS payer is a
  // Deploy subscriber. The recovered payer is BOTH the deploy authorization (the
  // payload is the private signed authorization) AND the on-chain owner.
  let payer: string;
  try {
    payer = await recoverPayer(payload.payload.transaction, payload.payload.signature);
  } catch {
    throw new DeployPaymentError("unrecoverable payment signature", 402, true);
  }

  // Which price did the payer present, and are they ALLOWED it? The standard $0.50 is
  // always allowed; the discounted $0.10 requires an active Deploy subscription (read
  // from chain). We only pay the premium-check RPC when the discounted amount is
  // presented — a plain $0.50 deploy skips it.
  const accepted = payload.accepted as PaymentRequirements | undefined;
  const amountStr = accepted?.amount;
  if (amountStr === PREMIUM_AMOUNT_STR) {
    if (!(await isPremium(payer))) {
      throw new DeployPaymentError(
        "the $0.10 rate requires an active Deploy subscription on the paying account",
        402,
        true,
      );
    }
  } else if (amountStr !== STD_AMOUNT_STR) {
    throw new DeployPaymentError(
      "presented amount is not a deploy price ($0.50, or $0.10 for subscribers)",
      402,
      true,
    );
  }

  // The presented `accepted` must match OUR terms (rebuilt for the chosen amount) on
  // the LOAD-BEARING fields: scheme/network/asset/payTo/amount + the single declared
  // output to the Deploy treasury. A tampered split is rejected before any chain read.
  // The advisory fields (extra.buildUrl, the payment-identifier extension) are NOT
  // compared — they don't affect settlement, and the buildUrl varies by origin.
  // amountStr is already proven to be exactly STD or PREMIUM, so pick its decimal
  // constant directly (no bigint→Number→string laundering).
  const priceStr = amountStr === PREMIUM_AMOUNT_STR ? DEPLOY_PREMIUM_PRICE_DECIMAL : DEPLOY_PRICE_DECIMAL;
  const expected = expectedRequirement(merchant, priceStr);
  const ours = deployOutputs(merchant, amountStr);
  const termsMatch =
    !!accepted &&
    accepted.scheme === expected.scheme &&
    accepted.network === expected.network &&
    accepted.asset === expected.asset &&
    accepted.payTo === expected.payTo &&
    accepted.amount === expected.amount &&
    deepEqual(accepted.extra?.outputs ?? [], ours);
  if (!termsMatch) {
    throw new DeployPaymentError("presented terms do not match the Deploy quote", 402, true);
  }

  // The requirements the facilitator core verifies against (the single declared
  // output — the source of truth for the exact-fee check).
  const requirements: PaymentRequirements = {
    ...expected,
    extra: { ...expected.extra, outputs: ours },
  };

  // VERIFY (simulate-only) — exact split + recovered signer == simulated sender +
  // a not-already-executed guard (an unsettled payload still verifies; a replay of a
  // settled one is rejected as already-executed). Settlement is deferred to the
  // deploy flow so the digest threads into the on-chain dedup registry.
  const verified = await doVerify(payload, requirements);
  if (!verified.isValid) {
    throw new DeployPaymentError(
      verified.invalidMessage ?? verified.invalidReason ?? "payment did not verify",
      402,
      true,
    );
  }

  return { payer, payload, requirements };
};

/**
 * SETTLE a verified deploy payment (broadcast the gasless tx keyless over gRPC,
 * idempotent by digest) and return the settled tx digest. Called from the deploy flow
 * IMMEDIATELY before create_site, so the digest threads into the on-chain
 * SiteDigestRegistry (the atomic one-site-per-payment guard). doSettle is idempotent,
 * so a retry of the same payload re-settles from the chain/cache; the on-chain dedup
 * (EDigestUsed) is what blocks a second Site, not this call.
 *
 * Throws DeployPaymentError: 503 on a transient broadcast hiccup (the SAME header can
 * retry), 402 on a definitive settle failure (re-mint a fresh challenge).
 */
export const settleDeployPayment = async (
  v: VerifiedDeployPayment,
): Promise<string> => {
  const settled = await doSettle(v.payload, v.requirements);
  if (!settled.success) {
    const transient = settled.errorReason === "settle_failed";
    throw new DeployPaymentError(
      settled.errorMessage ?? settled.errorReason ?? "settlement failed",
      transient ? 503 : 402,
      !transient,
    );
  }
  return settled.transaction;
};

/** Boot-log surface (mirrors the facilitator/deploy info objects). */
export const chargeInfo = {
  amount: DEPLOY_CHARGE_AMOUNT,
  price: DEPLOY_PRICE_DECIMAL,
  network: NETWORK,
  ready: chargeGateReady,
};

export { DEPLOY_PRICE_DECIMAL };
