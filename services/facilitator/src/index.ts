// The open x402 Sui facilitator — a Cloudflare Worker. Four endpoints, spec-pure:
//
//   GET  /health   → { ok:true, ... }                          liveness (no network)
//   GET  /supported→ { kinds:[{ x402Version:2, scheme:'exact', network, extra }],
//                      extensions, signers, ready }             the capability + fee policy
//   POST /verify   → 200 VerifyResponse { isValid, payer } | { isValid:false, ... }
//   POST /settle   → 200 SettleResponse { success, transaction, network, payer, amount }
//
// The fee split is RECOMPUTED from the operator policy at verify and settle — a payer's
// declared outputs are never trusted (see x402.ts + fees.ts). Everything is keyless: the
// facilitator holds no key; it simulates, then broadcasts the payer-signed tx.

import type { Output } from "@suize/x402";
import type { PaymentPayload, PaymentRequirements } from "@suize/x402";
import { policyFor, type Env, type FeePolicy } from "./env";
import { grpcClient } from "./sui";
import { treasuryAddress } from "./fees";
import { doVerify, doSettle } from "./x402";
import { json, preflight, getIp, rateOk } from "./http";

// ── GET /supported — the capability descriptor + the PUBLISHED fee policy ────────
// `extra` on the kind is what a merchant uses to compute its split client-side:
// assetTransferMethod, the default feeBps + feeFloor, and the resolved treasury. When
// the treasury can't resolve (a misconfigured / unresolved FEE_TREASURY), `ready` is
// false and `treasury` is "" — merchants should hold until the operator fixes it, and
// verify/settle fail closed meanwhile.
export const handleSupported = async (
  policy: FeePolicy,
  payTo?: string | null,
): Promise<Response> => {
  const client = grpcClient(policy.network, policy.grpcUrl);
  const treasury = await treasuryAddress(policy, client);
  // `?payTo=0x…` returns the EFFECTIVE rate for that merchant (a MERCHANT_RATES
  // override, else the default) — so an override merchant can compute the exact split
  // this facilitator will enforce, without the operator publishing the whole registry.
  const override = payTo ? policy.merchants.get(payTo.trim().toLowerCase()) : undefined;
  return json({
    kinds: [
      {
        x402Version: 2,
        scheme: "exact",
        network: policy.caip2,
        extra: {
          assetTransferMethod: "address-balance",
          feeBps: Number(override ? override.feeBps : policy.feeBps),
          feeFloor: Number(policy.feeFloor),
          treasury,
        },
      },
    ],
    extensions: ["payment-identifier"],
    signers: { "sui:*": [] },
    ready: Boolean(treasury),
  });
};

// ── request-body coercion for /verify + /settle ──────────────────────────────────
const readBody = async (req: Request): Promise<unknown | null> => {
  try {
    return await req.json();
  } catch {
    return null;
  }
};

/** Pull the {payload, requirements} pair off a body, tolerating the common envelope
 * spellings. Null when either is absent. */
const readVerifyBody = (
  body: unknown,
): { payload: PaymentPayload; requirements: PaymentRequirements } | null => {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  const payload = (b.paymentPayload ?? b.payload) as PaymentPayload | undefined;
  const requirements = (b.paymentRequirements ?? b.requirements ?? b.accepted) as
    | PaymentRequirements
    | undefined;
  if (!payload || !requirements) return null;
  return { payload, requirements };
};

export const handleVerify = async (req: Request, policy: FeePolicy): Promise<Response> => {
  const parsed = readVerifyBody(await readBody(req));
  if (!parsed) return json({ error: "invalid body: need { paymentPayload, paymentRequirements }" }, 400);
  const client = grpcClient(policy.network, policy.grpcUrl);
  const result = await doVerify(client, policy, parsed.payload, parsed.requirements);
  return json(result, 200); // a definitive invalid is a 200 with isValid:false (the protocol carries the reason)
};

export const handleSettle = async (req: Request, policy: FeePolicy): Promise<Response> => {
  const parsed = readVerifyBody(await readBody(req));
  if (!parsed) return json({ error: "invalid body: need { paymentPayload, paymentRequirements }" }, 400);
  const client = grpcClient(policy.network, policy.grpcUrl);
  const result = await doSettle(client, policy, parsed.payload, parsed.requirements);
  return json(result, 200); // a settle failure is a 200 with success:false (reason in the body)
};

// ── the Worker ───────────────────────────────────────────────────────────────────
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") return preflight();

    // Top-level guard: an unexpected throw must still answer with CORS + the JSON
    // error shape (a bare platform 500 has neither, and browsers surface it as an
    // opaque network failure).
    try {
      const url = new URL(request.url);
      const policy = policyFor(env);

      if (request.method === "GET" && url.pathname === "/health") {
        return json({ ok: true, scheme: "exact", network: policy.caip2 });
      }
      if (request.method === "GET" && url.pathname === "/supported") {
        return handleSupported(policy, url.searchParams.get("payTo"));
      }

      // Best-effort per-isolate guard on the write/compute paths. Real rate limiting is a
      // Cloudflare WAF rule (see README) — this only shaves obvious floods per isolate.
      if (!rateOk(getIp(request))) {
        return json({ error: "rate limited — slow down and retry" }, 429, { "Retry-After": "10" });
      }

      if (request.method === "POST" && url.pathname === "/verify") {
        return handleVerify(request, policy);
      }
      if (request.method === "POST" && url.pathname === "/settle") {
        return handleSettle(request, policy);
      }

      return json({ error: "not found — the facilitator serves GET /health, GET /supported, POST /verify, POST /settle" }, 404);
    } catch (e) {
      console.error("[facilitator] unhandled:", (e as Error)?.message ?? e);
      return json({ error: "internal error" }, 500);
    }
  },
};

// The public type surface for external consumers of the module.
export type { Output, Env, FeePolicy };
