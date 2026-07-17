// The open x402 Sui facilitator — a Cloudflare Worker. Spec-pure endpoints:
//
//   GET  /health   → { ok:true, ... }                          liveness (no network)
//   GET  /supported→ { kinds:[{ x402Version:2, scheme:'exact', network, extra }],
//                      extensions, signers, ready }             the capability + fee policy
//   POST /verify   → 200 VerifyResponse { isValid, payer } | { isValid:false, ... }
//   POST /settle   → 200 SettleResponse { success, transaction, network, payer, amount }
//   POST /build    → 200 { bytes }                             OPTIONAL: the unsigned
//                    gasless send_funds bytes the payer signs LOCALLY (keyless — the
//                    payer could equally build these itself via @suize/x402).
//
// The fee split is RECOMPUTED from the operator policy at verify and settle — a payer's
// declared outputs are never trusted (see x402.ts + fees.ts). Everything is keyless: the
// facilitator holds no key; it simulates, then broadcasts the payer-signed tx.

import type { Output } from "@suize/x402";
import type { PaymentPayload, PaymentRequirements } from "@suize/x402";
import {
  buildGaslessOutputs,
  assertUnsignedBytesSafe,
  splitOutputs,
  usdcAtomic,
  OutputsError,
} from "@suize/x402";
import { SUI_ADDRESS_RE, USDC_DECIMAL_RE } from "@suize/shared";
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

// ── POST /build — the OPTIONAL payer convenience: hand back the UNSIGNED gasless
// bytes the payer signs LOCALLY. The facilitator holds no key — it only assembles
// the send_funds PTB from the DECLARED outputs (the same bytes the payer could build
// itself via @suize/x402's buildGaslessOutputs; the MCP does exactly that). Body:
//   { sender, outputs }              — build for an explicit split (the 402's outputs), OR
//   { sender, payTo, amount }        — derive the split from THIS operator's fee policy.
// We re-run assertUnsignedBytesSafe on what we built (never hand back bytes that
// aren't gasless or don't pay the split exactly). A build failure is a PAYER-side
// condition (the sender can't fund the split) → answer 402, never 5xx (a 5xx has its
// body + CORS stripped by the CDN and reads as an opaque network error). ────────────
const MAX_OUTPUTS = 8;

const resolveBuildOutputs = async (
  policy: FeePolicy,
  client: ReturnType<typeof grpcClient>,
  b: Record<string, unknown>,
): Promise<{ outputs: Output[] } | { error: string; status: number }> => {
  const explicit = b.outputs;
  if (Array.isArray(explicit)) {
    if (explicit.length === 0 || explicit.length > MAX_OUTPUTS) {
      return { error: `outputs must be 1..${MAX_OUTPUTS} legs`, status: 400 };
    }
    const outputs: Output[] = [];
    for (const o of explicit) {
      const to = typeof (o as Output)?.to === "string" ? (o as Output).to.trim() : "";
      const amount = typeof (o as Output)?.amount === "string" ? (o as Output).amount.trim() : "";
      if (!SUI_ADDRESS_RE.test(to) || !/^\d+$/.test(amount) || BigInt(amount) <= 0n) {
        return { error: "each output needs a 0x address + positive atomic-unit amount string", status: 400 };
      }
      outputs.push({ to, amount });
    }
    return { outputs };
  }
  // Derive from { payTo, amount } via THIS operator's split.
  const payTo = typeof b.payTo === "string" ? b.payTo.trim() : "";
  const amountRaw = typeof b.amount === "string" ? b.amount.trim() : "";
  if (!SUI_ADDRESS_RE.test(payTo)) return { error: "missing or malformed payTo (0x…64-hex)", status: 400 };
  if (!USDC_DECIMAL_RE.test(amountRaw)) return { error: "missing or malformed amount (positive decimal USDC, ≤ 6 dp)", status: 400 };
  const treasury = await treasuryAddress(policy, client);
  if (!treasury) return { error: "facilitator not ready (treasury unresolved)", status: 503 };
  const merchant = policy.merchants.get(payTo.toLowerCase());
  const outputs = splitOutputs(payTo, treasury, usdcAtomic(amountRaw), merchant ? merchant.feeBps : policy.feeBps, policy.feeFloor);
  return { outputs };
};

export const handleBuild = async (req: Request, policy: FeePolicy): Promise<Response> => {
  const body = await readBody(req);
  if (typeof body !== "object" || body === null) return json({ error: "invalid JSON body" }, 400);
  const b = body as Record<string, unknown>;
  const sender = typeof b.sender === "string" ? b.sender.trim() : "";
  if (!SUI_ADDRESS_RE.test(sender)) return json({ error: "missing or malformed sender (0x…64-hex)" }, 400);

  const client = grpcClient(policy.network, policy.grpcUrl);
  const resolved = await resolveBuildOutputs(policy, client, b);
  if ("error" in resolved) return json({ error: resolved.error }, resolved.status);

  try {
    const { bytes } = await buildGaslessOutputs({ client, sender, asset: policy.asset, outputs: resolved.outputs });
    // Belt-and-braces: never hand back bytes that aren't gasless or don't pay the split.
    await assertUnsignedBytesSafe({ client, bytesB64: bytes, sender, asset: policy.asset, outputs: resolved.outputs });
    return json({ bytes }, 200);
  } catch (e) {
    // A build/dry-run failure is a PAYER-side condition (the sender can't fund the
    // declared split) — a 402 carries the reason with CORS intact; a 5xx would not.
    const reason = e instanceof OutputsError ? e.message : (e as Error).message ?? "could not build the payment";
    return json({ error: reason }, 402);
  }
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
      if (request.method === "POST" && url.pathname === "/build") {
        return handleBuild(request, policy);
      }

      return json({ error: "not found — the facilitator serves GET /health, GET /supported, POST /verify, POST /settle, POST /build" }, 404);
    } catch (e) {
      console.error("[facilitator] unhandled:", (e as Error)?.message ?? e);
      return json({ error: "internal error" }, 500);
    }
  },
};

// The public type surface for external consumers of the module.
export type { Output, Env, FeePolicy };
