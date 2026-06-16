// The Suize Charge token — a stateless, tamper-proof merchant charge.
//
// A merchant's "charge" (price + webhook + payTo) is NOT stored anywhere — it
// travels INSIDE a signed link: `api.suize.io/charge/<b64url(payload)>.<b64url(sig)>`.
// The facilitator verifies the Ed25519 signature with the Suize CHARGE key, reads
// {merchant, price, webhook} from the payload, and mints the SAME x402 402 the rail
// already mints — the 2% fee is enforced by doVerify exactly as for every payment.
//
// One key, Ed25519, secret in env (SUIZE_CHARGE_PRIVATE_KEY), public key published at
// GET /charge/pubkey (+ /.well-known/suize-charge-key) so a merchant's verifyWebhook
// can check the fulfillment POST. The SAME key signs the token (facilitator-verified)
// and the webhook (merchant-verified). `keyId` = first 16 hex of the pubkey → rotation.
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Ed25519PublicKey } from "@mysten/sui/keypairs/ed25519";
import { config } from "../config";

/** The charge payload baked into the link. v1 is the only version. */
export interface ChargePayload {
  v: 1;
  /** the merchant's payTo — bound to the authenticated session at create-time */
  merchant: string;
  /** decimal USDC string, ≤ 6dp (e.g. "0.10") — the listed price */
  price: string;
  /** the https URL Suize POSTs the settled order to */
  webhook: string;
  /** opaque merchant label/SKU, echoed into every webhook (≤ 256 chars) */
  ref?: string;
  /** epoch-ms expiry; omitted = no expiry */
  exp?: number;
}

const b64url = (b: Uint8Array): string =>
  Buffer.from(b).toString("base64url");
const b64urlStr = (s: string): string => Buffer.from(s, "utf8").toString("base64url");
const fromB64url = (s: string): Uint8Array => new Uint8Array(Buffer.from(s, "base64url"));

let _kp: Ed25519Keypair | null = null;
const keypair = (): Ed25519Keypair => {
  if (_kp) return _kp;
  if (!config.chargeKey) throw new Error("SUIZE_CHARGE_PRIVATE_KEY not set");
  _kp = Ed25519Keypair.fromSecretKey(config.chargeKey);
  return _kp;
};

/** Whether the charge door is armed (the signing key is present). */
export const chargeKeyReady = (): boolean => !!config.chargeKey;

/** The published public key + its id — for /charge/pubkey and verifyWebhook. */
export const chargePublicKey = (): { keyId: string; publicKey: string; scheme: "ed25519" } => {
  const raw = keypair().getPublicKey().toRawBytes();
  const hex = Buffer.from(raw).toString("hex");
  return { keyId: hex.slice(0, 16), publicKey: b64url(raw), scheme: "ed25519" };
};

/** Sign `payload` into the link tail `<b64url(json)>.<b64url(sig)>`. */
export const signChargeToken = async (payload: ChargePayload): Promise<string> => {
  const head = b64urlStr(JSON.stringify(payload));
  const sig = await keypair().sign(new TextEncoder().encode(head));
  return `${head}.${b64url(sig)}`;
};

/** Sign an arbitrary message body (the webhook) with the SAME CHARGE key. */
export const signWithChargeKey = async (bytes: Uint8Array): Promise<string> =>
  b64url(await keypair().sign(bytes));

/** Verify + decode a token. Returns null on a bad signature, malformed payload, or
 *  expiry — the facilitator answers 404/410 on null (never reveals which). */
export const verifyChargeToken = async (token: string): Promise<ChargePayload | null> => {
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const head = token.slice(0, dot);
  const sigB64 = token.slice(dot + 1);
  let ok = false;
  try {
    ok = await keypair()
      .getPublicKey()
      .verify(new TextEncoder().encode(head), fromB64url(sigB64));
  } catch {
    return null;
  }
  if (!ok) return null;
  let payload: ChargePayload;
  try {
    payload = JSON.parse(Buffer.from(fromB64url(head)).toString("utf8"));
  } catch {
    return null;
  }
  if (payload?.v !== 1 || typeof payload.merchant !== "string" || typeof payload.price !== "string" || typeof payload.webhook !== "string") {
    return null;
  }
  if (typeof payload.exp === "number" && payload.exp < Date.now()) return null;
  return payload;
};

// re-export for callers that hold a raw pubkey (none today; kept for symmetry)
export { Ed25519PublicKey };
