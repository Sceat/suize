// The charge gate — Suize as a NORMAL MERCHANT on the open x402 facilitator.
//
// This worker never verifies or settles a payment itself: it (1) reads the
// facilitator's PUBLISHED fee policy (GET /supported?payTo=<merchant>), (2)
// computes its own terms with the shared split math (@suize/x402 splitOutputs —
// the identical math the facilitator re-enforces at verify), (3) mints the 402,
// and (4) on the paid retry checks the presented terms EQUAL its own quote, then
// delegates POST /verify + POST /settle to the facilitator. The recovered payer
// (facilitator-attested) is the ONE auth primitive: whoever pays, owns.
//
// FAIL-CLOSED + IDEMPOTENT (the money contract, mirrored from @suize/pay):
// a facilitator outage / non-JSON / `facilitator_unready` is NOT a "not paid" —
// it surfaces 503 so the payer retries the SAME X-PAYMENT header (settle is
// idempotent by digest; a settled payer never re-pays through an outage). Only
// a DEFINITIVE invalid mints a fresh challenge.

import { mintPaymentRequired } from "@suize/pay";
import type {
  Output,
  PaymentPayload,
  PaymentRequired,
  PaymentRequirements,
  SettleResponse,
  VerifyResponse,
} from "@suize/pay";
import { formatUsdc, recoverPayer, splitOutputs } from "@suize/x402";
import { caip2, SUI_ADDRESS_RE, USDC_TYPES } from "@suize/shared";
import { network, type Env } from "./env";

export class PaymentError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** True → the route answers a fresh 402 challenge with this message. */
    readonly challenge = false,
  ) {
    super(message);
    this.name = "PaymentError";
  }
}

// ── the facilitator's published policy (cached briefly per isolate) ───────────

export interface FeePolicy {
  feeBps: bigint;
  feeFloor: bigint;
  treasury: string;
  asset: string;
  network: `${string}:${string}`;
}

const POLICY_TTL_MS = 5 * 60 * 1000;
let _policy: { value: FeePolicy; at: number; key: string } | null = null;

/** GET {facilitator}/supported?payTo=<merchant> → the effective fee policy this
 * facilitator will ENFORCE for our payments. Fail-closed: an unready facilitator
 * (unresolved treasury) or an unreachable one throws 503 — no terms are minted
 * from a stale or unknown policy. */
export const fetchPolicy = async (env: Env): Promise<FeePolicy> => {
  const base = (env.FACILITATOR_URL ?? "").replace(/\/$/, "");
  const merchant = (env.SUIZE_MERCHANT ?? "").toLowerCase();
  if (!base || !merchant) throw new PaymentError("charge rail not configured", 503);

  const key = `${base}|${merchant}`;
  if (_policy && _policy.key === key && Date.now() - _policy.at < POLICY_TTL_MS) {
    return _policy.value;
  }

  let body: {
    kinds?: { scheme?: string; network?: string; extra?: Record<string, unknown> }[];
    ready?: boolean;
  };
  try {
    const res = await fetch(`${base}/supported?payTo=${merchant}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    body = (await res.json()) as typeof body;
  } catch (err) {
    throw new PaymentError(`facilitator unreachable (${(err as Error).message})`, 503);
  }

  const net = network(env);
  const kind = body.kinds?.find((k) => k.scheme === "exact" && k.network === caip2(net));
  const extra = kind?.extra ?? {};
  const treasury = String(extra.treasury ?? "");
  if (!body.ready || !SUI_ADDRESS_RE.test(treasury)) {
    throw new PaymentError("facilitator not ready (treasury unresolved)", 503);
  }

  const value: FeePolicy = {
    feeBps: BigInt(Number(extra.feeBps ?? 0)),
    feeFloor: BigInt(Number(extra.feeFloor ?? 0)),
    treasury: treasury.toLowerCase(),
    asset: USDC_TYPES[net],
    network: caip2(net),
  };
  _policy = { value, at: Date.now(), key };
  return value;
};

// ── terms: ONE canonical builder for the 402 mint AND the verify compare ──────

/** The exact PaymentRequirements this merchant quotes for `amount` — the fee
 * split computed with the SAME shared math the facilitator enforces. */
export const quoteRequirements = (
  env: Env,
  policy: FeePolicy,
  amountAtomic: bigint,
  resourceUrl: string,
): { requirements: PaymentRequirements; outputs: Output[] } => {
  const merchant = (env.SUIZE_MERCHANT ?? "").toLowerCase();
  const outputs = splitOutputs(merchant, policy.treasury, amountAtomic, policy.feeBps, policy.feeFloor);
  const body = mintPaymentRequired(
    {
      to: merchant,
      price: formatUsdc(amountAtomic),
      facilitator: (env.FACILITATOR_URL ?? "").replace(/\/$/, ""),
      network: policy.network,
    },
    { resourceUrl, outputs: outputs as { to: string; amount: string }[] },
  );
  return { requirements: body.accepts[0], outputs: outputs as Output[] };
};

/** The full 402 body (PaymentRequired + a human/agent-readable error rider). */
export const mint402 = (
  env: Env,
  policy: FeePolicy,
  amountAtomic: bigint,
  resourceUrl: string,
  rider: string,
): PaymentRequired & { error: string } => {
  const merchant = (env.SUIZE_MERCHANT ?? "").toLowerCase();
  const { outputs } = quoteRequirements(env, policy, amountAtomic, resourceUrl);
  const body = mintPaymentRequired(
    {
      to: merchant,
      price: formatUsdc(amountAtomic),
      facilitator: (env.FACILITATOR_URL ?? "").replace(/\/$/, ""),
      network: policy.network,
    },
    { resourceUrl, outputs: outputs as { to: string; amount: string }[] },
  );
  return { ...body, error: `payment required. ${rider}` };
};

// ── the paid retry: terms compare + facilitator verify ────────────────────────

const b64jsonDecode = <T>(s: string): T | null => {
  try {
    const bin = atob(s);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i) & 0xff;
    return JSON.parse(new TextDecoder().decode(bytes)) as T;
  } catch {
    return null;
  }
};

/** Order-insensitive structural equality over plain JSON wire shapes. */
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

export interface VerifiedPayment {
  /** The recovered payer (facilitator-attested, or locally recovered on the
   * already-settled path) — the auth identity. */
  payer: string;
  payload: PaymentPayload;
  requirements: PaymentRequirements;
  /** True when /verify reported the payment ALREADY executed on-chain — i.e. a
   * RETRY of a payment that already settled (a death after settle but before the
   * on-chain effect / the response). The caller must NOT 402 ("pay again");
   * it re-drives the IDEMPOTENT on-chain effect (the SiteDigestRegistry mints
   * once, a re-link is a no-op) so the payer's already-spent funds produce the
   * work they paid for. Closes the settle-then-strand HIGH (money hat 2026-07-12). */
  alreadySettled: boolean;
}

const postJson = async <T>(env: Env, path: string, body: unknown): Promise<T> => {
  const base = (env.FACILITATOR_URL ?? "").replace(/\/$/, "");
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new PaymentError(`facilitator unreachable (${(err as Error).message})`, 503);
  }
  try {
    return (await res.json()) as T;
  } catch {
    throw new PaymentError(`facilitator returned non-JSON (HTTP ${res.status})`, 503);
  }
};

/**
 * Gate a paid request: decode the X-PAYMENT header, require the presented
 * `accepted` to EQUAL our own quote on every load-bearing field (a tampered
 * split/price is rejected before any facilitator call), then POST /verify.
 * Returns the verified payment + the facilitator-recovered payer.
 * Settlement is DEFERRED to {@link settlePayment} at the caller's money point.
 */
export const gatePayment = async (
  env: Env,
  headerValue: string,
  expected: PaymentRequirements,
): Promise<VerifiedPayment> => {
  const payload = b64jsonDecode<PaymentPayload>(headerValue.trim());
  if (!payload || typeof payload !== "object" || !payload.payload?.transaction) {
    throw new PaymentError("malformed X-PAYMENT payload", 402, true);
  }

  const accepted = payload.accepted as PaymentRequirements | undefined;
  const acceptedExtra = accepted?.extra as Record<string, unknown> | undefined;
  const expectedExtra = expected.extra as Record<string, unknown> | undefined;
  const termsMatch =
    !!accepted &&
    accepted.scheme === expected.scheme &&
    accepted.network === expected.network &&
    accepted.asset === expected.asset &&
    accepted.payTo === expected.payTo &&
    accepted.amount === expected.amount &&
    deepEqual(acceptedExtra?.outputs ?? [], expectedExtra?.outputs ?? []) &&
    // The op-binding rider: when a quote is bound to an operation (domain links
    // carry { op, domain, siteId }), the payload must echo it EXACTLY — a
    // settled payment can never be replayed against a different op's quote.
    deepEqual(acceptedExtra?.suize, expectedExtra?.suize);
  if (!termsMatch) {
    throw new PaymentError("presented terms do not match this quote", 402, true);
  }

  // Verify against OUR requirements (never the presented copy) — the facilitator
  // recomputes the split and rejects anything that doesn't pay it exactly.
  const verified = await postJson<VerifyResponse>(env, "/verify", {
    paymentPayload: payload,
    paymentRequirements: expected,
  });
  if (!verified.isValid) {
    // ALREADY-EXECUTED is NOT a rejection — it is a settled payment being
    // retried (the payer already paid; a prior attempt died before finishing the
    // on-chain effect). Recover the payer STRUCTURALLY (no network — the sig
    // carries the address) and hand it back as `alreadySettled`, so the route
    // re-drives its idempotent on-chain effect instead of demanding a re-pay.
    if ((verified.invalidReason ?? "").includes("already_executed")) {
      let payer: string;
      try {
        payer = (await recoverPayer(payload.payload.transaction, payload.payload.signature)).toLowerCase();
      } catch {
        throw new PaymentError("could not recover the payer of a settled payment", 402, true);
      }
      if (!SUI_ADDRESS_RE.test(payer)) {
        throw new PaymentError("recovered payer address is invalid", 402, true);
      }
      return { payer, payload, requirements: expected, alreadySettled: true };
    }
    throw new PaymentError(
      verified.invalidMessage ?? verified.invalidReason ?? "payment did not verify",
      402,
      true,
    );
  }
  const payer = String(verified.payer ?? "").toLowerCase();
  if (!SUI_ADDRESS_RE.test(payer)) {
    throw new PaymentError("facilitator verify returned no payer", 503);
  }

  return { payer, payload, requirements: expected, alreadySettled: false };
};

/** Delay before the single settle retry. A gasless send_funds finalizes ~1-3s after
 * broadcast, so a re-POST hits the facilitator's already-executed fast path. */
const SETTLE_RETRY_MS = 2500;

/** A settle failure worth ONE re-POST of the SAME payment: the facilitator's transient
 * reason (`facilitator_unready` — covers its "chain read failed"), or a broadcast that
 * failed to confirm in time (the deadline-abort whose tx may have LANDED). Settle is
 * idempotent by digest, so the retry recovers a landed tx and never double-charges.
 * Terminal verdicts (invalid_payload, outputs_mismatch, an on-chain-FAILED tx) never
 * carry these markers, so they are not retried. */
const settleRetryable = (r: SettleResponse): boolean =>
  r.errorReason === "facilitator_unready" || /^broadcast failed/i.test(r.errorMessage ?? "");

/**
 * SETTLE a verified payment through the facilitator and return the tx digest. A
 * transient settle failure (the tx may have landed but the facilitator's read had not
 * finalized) is re-POSTed ONCE — the same payment, never re-signed — before it is
 * treated as failed. `facilitator_unready` (and transport failures) are 503 — the
 * SAME header can retry; any other failure is a definitive 402 (fresh challenge).
 */
export const settlePayment = async (env: Env, v: VerifiedPayment): Promise<string> => {
  const post = () =>
    postJson<SettleResponse>(env, "/settle", {
      paymentPayload: v.payload,
      paymentRequirements: v.requirements,
    });

  let settled = await post();
  if (!settled.success && settleRetryable(settled)) {
    await new Promise((r) => setTimeout(r, SETTLE_RETRY_MS));
    settled = await post();
  }
  if (!settled.success) {
    const transient = settled.errorReason === "facilitator_unready";
    throw new PaymentError(
      settled.errorMessage ?? settled.errorReason ?? "settlement failed",
      transient ? 503 : 402,
      !transient,
    );
  }
  return settled.transaction;
};
