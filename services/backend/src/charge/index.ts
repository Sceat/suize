// The hosted no-code merchant door — `api.suize.io/charge/<token>`.
//
// A merchant's charge (price + webhook + payTo) rides INSIDE a Suize-signed token
// (token.ts) — nothing is stored. This route is the LIVE Deploy gate generalized:
// GET mints the x402 402 for the token's {merchant, price}; POST verifies + settles on
// the UNTOUCHED rail (doVerify recomputes + enforces the 2%/$0.01 split itself) and
// then fires the signed order to the merchant's webhook. No Move object, no DB, no
// server-minted ids — the token is the config, the settle digest is the receipt.
//
// Reopens LOCKED #7 correctly: this is an AGENT-paid, machine-readable endpoint Suize
// hosts (identical wire to /deploy). The DELETED thing was the HUMAN checkout page.
import { caip2 } from "@suize/shared";
import {
  mintPaymentRequired,
  type PaymentPayload,
  type PaymentRequirements,
} from "@suize/pay";
import { recoverPayer, usdcAtomic } from "@suize/x402";
import { config } from "../config";
import { json } from "../http";
import { doVerify, doSettle, FACILITATOR_NETWORK } from "../facilitator/x402";
import { outputsFor, treasuryReady } from "../facilitator/fees";
import { verifyChargeToken, chargePublicKey, chargeKeyReady } from "./token";
import { fireChargeWebhook } from "./webhook";

const MAX_ORDER_BYTES = 16_384;

const b64 = (o: unknown): string =>
  Buffer.from(JSON.stringify(o), "utf8").toString("base64");
const b64jsonDecode = <T>(s: string): T | null => {
  try {
    return JSON.parse(Buffer.from(s, "base64").toString("utf8")) as T;
  } catch {
    return null;
  }
};

/** Read the opaque order blob from the POST body (≤16KB), JSON if it parses. */
const readOrder = async (req: Request): Promise<unknown> => {
  try {
    const text = await req.text();
    if (!text) return null;
    if (text.length > MAX_ORDER_BYTES) return null; // oversized → dropped
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  } catch {
    return null;
  }
};

/** Build the x402 402 body for a verified charge. Throws if treasury is unresolved. */
const mint402 = async (merchant: string, price: string, resourceUrl: string) => {
  const outputs = await outputsFor(merchant, usdcAtomic(price));
  return mintPaymentRequired(
    { to: merchant, price, network: FACILITATOR_NETWORK },
    { outputs, resourceUrl },
  );
};

/** GET /charge/<token> → the 402 challenge for the token's price. */
const handleGet = async (token: string, url: URL, origin: string | null): Promise<Response> => {
  const charge = await verifyChargeToken(token);
  if (!charge) return json({ error: "unknown or expired charge" }, 404, origin);
  try {
    const body = await mint402(charge.merchant, charge.price, url.href);
    return json(body, 402, origin, { "PAYMENT-REQUIRED": b64(body) });
  } catch {
    return json({ error: "rail not configured (treasury unresolved)" }, 503, origin);
  }
};

/** POST /charge/<token> + X-PAYMENT → verify, settle, fire the webhook. */
const handlePost = async (req: Request, token: string, url: URL, origin: string | null): Promise<Response> => {
  const charge = await verifyChargeToken(token);
  if (!charge) return json({ error: "unknown or expired charge" }, 404, origin);

  const raw = (req.headers.get("PAYMENT-SIGNATURE") ?? req.headers.get("X-PAYMENT") ?? "").trim();
  // A payment-less POST is the zero-shot entry point → answer the 402, not a 400.
  if (!raw) {
    try {
      const body = await mint402(charge.merchant, charge.price, url.href);
      return json(body, 402, origin, { "PAYMENT-REQUIRED": b64(body) });
    } catch {
      return json({ error: "rail not configured (treasury unresolved)" }, 503, origin);
    }
  }

  const payload = b64jsonDecode<PaymentPayload>(raw);
  if (!payload || typeof payload !== "object" || !payload.payload?.transaction) {
    return json({ error: "malformed X-PAYMENT payload" }, 402, origin);
  }

  // Build the requirements WE trust — sourced from the signed token, never the payer.
  // Mint the SAME 402 and take accepts[0], so extra.outputs + buildUrl match exactly
  // what an agent was told. doVerify then recomputes outputsFor(payTo, amount) and
  // enforces the split itself, so a payer cannot underpay or skip the fee.
  let payer: string;
  let requirements: PaymentRequirements;
  try {
    payer = await recoverPayer(payload.payload.transaction, payload.payload.signature);
    const body = await mint402(charge.merchant, charge.price, url.href);
    requirements = body.accepts[0]!;
  } catch {
    return json({ error: "unrecoverable payment or rail not configured" }, 402, origin);
  }

  const verified = await doVerify(payload, requirements);
  if (!verified.isValid) {
    return json(
      { error: verified.invalidMessage ?? verified.invalidReason ?? "payment did not verify" },
      402,
      origin,
    );
  }

  const order = await readOrder(req);

  const settled = await doSettle(payload, requirements);
  if (!settled.success) {
    const transient = settled.errorReason === "settle_failed";
    return json(
      { error: settled.errorMessage ?? settled.errorReason ?? "settlement failed" },
      transient ? 503 : 402,
      origin,
    );
  }

  // FULFILL — fire the signed order to the merchant (fire-and-forget; the agent's
  // response never blocks on the merchant's endpoint). The digest is the authority.
  fireChargeWebhook(charge.webhook, {
    v: 1,
    chargeRef: charge.ref ?? null,
    payer,
    amount: requirements.amount,
    asset: requirements.asset,
    network: requirements.network,
    merchant: charge.merchant,
    txDigest: settled.transaction,
    order,
    paidAt: Date.now(),
  });

  const receipt = { settleDigest: settled.transaction, payer, network: FACILITATOR_NETWORK };
  return json({ status: "settled", ...receipt }, 200, origin, { "PAYMENT-RESPONSE": b64(receipt) });
};

/** Route matcher for /charge/* — returns null synchronously for non-charge paths. */
export const handleChargeRoute = (
  req: Request,
  url: URL,
  origin: string | null,
): Response | Promise<Response> | null => {
  if (!url.pathname.startsWith("/charge/") && url.pathname !== "/charge") return null;

  // The published webhook/token public key — for verifyWebhook + docs.
  if (url.pathname === "/charge/pubkey" || url.pathname === "/.well-known/suize-charge-key") {
    if (req.method !== "GET") return json({ error: "method not allowed" }, 405, origin);
    if (!chargeKeyReady()) return json({ error: "charge door not configured" }, 503, origin);
    return json(chargePublicKey(), 200, origin);
  }

  if (!chargeKeyReady()) return json({ error: "charge door not configured" }, 503, origin);
  const token = decodeURIComponent(url.pathname.slice("/charge/".length));
  if (!token) return json({ error: "missing charge token" }, 404, origin);

  if (req.method === "GET") return handleGet(token, url, origin);
  if (req.method === "POST") return handlePost(req, token, url, origin);
  return json({ error: "method not allowed" }, 405, origin);
};

/** Boot-log surface (mirrors deployInfo / directoryInfo). */
export const chargeInfo = {
  network: caip2(config.suiNetwork),
  ready: () => chargeKeyReady() && treasuryReady(),
};
