// @suize/pay/webhook — verify a Suize charge webhook, in one line, zero-dep.
//
// When an agent pays your hosted charge link (api.suize.io/charge/<token>), Suize
// settles on-chain and POSTs the order to your webhook, signed with the Suize CHARGE
// key. This verifies that signature so you can trust the order came from Suize.
//
//   import { verifyWebhook } from "@suize/pay/webhook";
//   const order = await verifyWebhook(req);   // throws if the signature is invalid
//   // order = { txDigest, payer, amount, merchant, ref, order, ... }
//
// THE TRUST CONTRACT (read this once):
//   1. The signature proves ORIGIN (this came from Suize) — verifyWebhook checks it.
//   2. The on-chain `txDigest` is the SOLE proof of PAYMENT. For physical / high-value
//      goods, read it on-chain and confirm it credits YOUR address before you fulfil.
//   3. DEDUPE on `txDigest` — we deliver at-least-once; fulfil EXACTLY ONCE per digest.
//
// Zero npm deps: built-in `node:crypto` (Ed25519 verify) + `fetch` (the pubkey, cached).
import { createPublicKey, verify as edVerify } from "node:crypto";

export interface SuizeOrder {
  /** the on-chain settle digest — THE proof of payment; dedupe + verify on this */
  txDigest: string;
  /** the paying agent's address */
  payer: string;
  /** atomic USDC base units paid (6 decimals; the listed price) */
  amount: string;
  asset: string;
  network: string;
  /** your payout address (= the charge's payTo) */
  merchant: string;
  /** your charge label/SKU (the `ref` you set), or null */
  chargeRef: string | null;
  /** the agent's order data (shipping, options, …), verbatim — or null */
  order: unknown;
  /** epoch ms the payment settled */
  paidAt: number;
}

export interface VerifyWebhookOptions {
  /** the facilitator base to fetch the public key from (default https://api.suize.io) */
  facilitator?: string;
  /** reject a body older than this (ms). Default 10 min. Dedupe-on-digest is the real
   *  replay guard; this is a courtesy bound. Set 0 to disable. */
  maxAgeMs?: number;
  /** pin the public key (base64url of the 32-byte Ed25519 key) to skip the fetch */
  publicKey?: string;
}

const DEFAULT_FACILITATOR = "https://api.suize.io";
const DEFAULT_MAX_AGE_MS = 10 * 60 * 1000;

// keyId → imported public KeyObject (rotation-safe: a new keyId triggers a fresh fetch)
const keyCache = new Map<string, ReturnType<typeof createPublicKey>>();

const importEd25519 = (b64url: string) =>
  createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: b64url }, format: "jwk" });

const fetchPublicKey = async (facilitator: string, keyId: string) => {
  const cached = keyCache.get(keyId);
  if (cached) return cached;
  const base = facilitator.replace(/\/+$/, "");
  const res = await fetch(`${base}/charge/pubkey`);
  if (!res.ok) throw new WebhookError(`could not fetch Suize charge public key (${res.status})`);
  const k = (await res.json()) as { keyId: string; publicKey: string };
  if (k.keyId !== keyId) {
    throw new WebhookError(`webhook keyId ${keyId} does not match the published key ${k.keyId}`);
  }
  const obj = importEd25519(k.publicKey);
  keyCache.set(keyId, obj);
  return obj;
};

export class WebhookError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebhookError";
  }
}

/** Verify a raw webhook body + its `X-Suize-Signature` header. Returns the typed order
 *  or throws WebhookError. Use this if you already have the raw body string. */
export const verifyWebhookBody = async (
  rawBody: string,
  signatureHeader: string | null | undefined,
  opts: VerifyWebhookOptions = {},
): Promise<SuizeOrder> => {
  if (!signatureHeader) throw new WebhookError("missing X-Suize-Signature header");
  const dot = signatureHeader.indexOf(".");
  if (dot <= 0) throw new WebhookError("malformed X-Suize-Signature header");
  const keyId = signatureHeader.slice(0, dot);
  const sig = Buffer.from(signatureHeader.slice(dot + 1), "base64url");

  const key = opts.publicKey ? importEd25519(opts.publicKey) : await fetchPublicKey(opts.facilitator ?? DEFAULT_FACILITATOR, keyId);
  const ok = edVerify(null, Buffer.from(rawBody, "utf8"), key, sig);
  if (!ok) throw new WebhookError("invalid Suize signature — not from Suize");

  let order: SuizeOrder;
  try {
    order = JSON.parse(rawBody) as SuizeOrder;
  } catch {
    throw new WebhookError("webhook body is not valid JSON");
  }
  if (!order.txDigest || !order.merchant) throw new WebhookError("webhook body missing txDigest/merchant");

  const maxAge = opts.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
  if (maxAge > 0 && typeof order.paidAt === "number" && Date.now() - order.paidAt > maxAge) {
    throw new WebhookError("webhook is stale (outside the freshness window)");
  }
  return order;
};

/** Verify a fetch-style `Request` (Bun / Hono / Next / Express-with-a-Request). Reads
 *  the body, checks the signature, returns the typed order. Throws WebhookError. */
export const verifyWebhook = async (req: Request, opts: VerifyWebhookOptions = {}): Promise<SuizeOrder> => {
  const rawBody = await req.text();
  return verifyWebhookBody(rawBody, req.headers.get("x-suize-signature"), opts);
};
