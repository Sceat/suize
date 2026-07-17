// Publisher JWT minting — the mainnet Walrus publisher is self-hosted and gated
// by the publisher binary's NATIVE JWT auth (`walrus publisher --jwt-decode-secret`).
// This worker mints a fresh, single-use HS256 token per store PUT.
//
// Verified against the Walrus source (MystenLabs/walrus, verified 2026-07-14):
//   • crates/.../client/config.rs::secret_to_bytes — a `0x…` secret is HEX-DECODED
//     to raw bytes; the HMAC key is those bytes, NOT the ascii of the string.
//   • .../client/cli/args.rs — `jwt_algorithm` unset ⇒ HMAC HS256 (our header alg).
//   • .../client/daemon/auth.rs::Claim / check_valid_upload — the claims the
//     publisher verifies: `exp` (required), `iat` (required iff --jwt-expiring-sec>0,
//     then it asserts exp-iat == that value), `jti` (required; replay-cache key →
//     single-use), and — only when --jwt-verify-upload is on — `epochs` (must EQUAL
//     the query `epochs` exactly) and `send_object_to` (must EQUAL the query value).
//     `max_epochs`/`size`/`max_size` are the alt forms we deliberately omit.
// We bind `epochs` + `send_object_to` (the two query params every store already
// carries) so a leaked token can't be replayed against a different recipient or
// term. Missing-in-token-but-present-in-query is ALLOWED by the publisher, so
// binding is pure hardening, never a compatibility risk.

/** Token lifetime — kept short; a store PUT completes in seconds. */
const JWT_TTL_SEC = 300;

const enc = new TextEncoder();

/** base64url with NO padding (JWT §5) — the classic footgun: +→-, /→_, strip '='. */
const b64url = (bytes: Uint8Array): string => {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

/** Decode a `0x<hex>` secret to its raw HMAC key bytes (walrus secret_to_bytes). */
const hexSecretToKey = (secret: string): Uint8Array => {
  const h = secret.startsWith("0x") || secret.startsWith("0X") ? secret.slice(2) : secret;
  if (h.length === 0 || h.length % 2 !== 0 || /[^0-9a-fA-F]/.test(h)) {
    throw new Error("WALRUS_PUBLISHER_JWT_SECRET must be a 0x-prefixed even-length hex string");
  }
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
};

/**
 * Mint a fresh single-use HS256 publisher token binding this store's `epochs` +
 * `send_object_to`. `jti` is a random UUID (the publisher's replay cache rejects
 * a reused one); `exp` = now+300s, `iat` = now (so exp-iat == 300 satisfies a
 * `--jwt-expiring-sec 300` publisher). Returns the compact `header.payload.sig`.
 */
export const mintPublisherJwt = async (
  hexSecret: string,
  epochs: number,
  sendObjectTo: string,
): Promise<string> => {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "HS256", typ: "JWT" };
  const payload = {
    iat: now,
    exp: now + JWT_TTL_SEC,
    jti: crypto.randomUUID(),
    epochs,
    send_object_to: sendObjectTo,
  };

  const signingInput = `${b64url(enc.encode(JSON.stringify(header)))}.${b64url(
    enc.encode(JSON.stringify(payload)),
  )}`;

  const key = await crypto.subtle.importKey(
    "raw",
    hexSecretToKey(hexSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(signingInput)));

  return `${signingInput}.${b64url(sig)}`;
};
