// Base36 ↔ Sui object id codec — the SHARED contract with the deploy-worker and
// the dashboard. A 256-bit Sui object id (0x + 64 hex) encodes to a FIXED-WIDTH,
// DNS-safe base36 subdomain (`<base36(siteId)>.deploy.suize.io`); the worker
// decodes it back to the object id. The two MUST stay BYTE-IDENTICAL, so this
// mirrors `encodeObjectIdToBase36`/`decodeBase36ToObjectId` in
// `services/deploy-worker/src/index.ts` exactly.
//
// FIXED WIDTH: a 256-bit value's largest base36 representation is exactly 50
// chars (`(2n**256n-1n).toString(36).length === 50`). We LEFT-PAD with '0' to 50
// so EVERY subdomain is the same length — the worker's `isBase36ObjectId` matches
// that exact width, so a low-magnitude id (e.g. 0x0…01) can't slip below the
// match window. Decode strips the leading-zero pad; the round-trip is exact.

/** Fixed subdomain width: the max base36 length a 256-bit object id produces. */
export const BASE36_OBJECT_ID_WIDTH = 50;

/**
 * Encode a Sui object id (`0x` + ≤64 hex) to its FIXED-WIDTH (50-char) base36
 * subdomain, left-padded with '0'. Throws on a malformed id.
 */
export const encodeObjectIdToBase36 = (objectId: string): string => {
  const hex = objectId.startsWith("0x") ? objectId.slice(2) : objectId;
  if (!/^[0-9a-fA-F]{1,64}$/.test(hex)) {
    throw new Error(`invalid object id for base36 encode: ${objectId}`);
  }
  const value = BigInt(`0x${hex}`);
  // Left-pad to the fixed width so 0x0…01 and the largest id share a length.
  return value.toString(36).padStart(BASE36_OBJECT_ID_WIDTH, "0");
};

/**
 * Decode a base36 subdomain back to a `0x`-prefixed, 64-hex Sui object id.
 * Mirrors the worker so the backend can self-verify the round-trip. The leading
 * '0' pad is absorbed by the numeric parse, so encode→decode is exact even for a
 * low-magnitude id.
 */
export const decodeBase36ToObjectId = (subdomain: string): string => {
  const cleaned = subdomain.toLowerCase().replace(/^0+/, "") || "0";
  let decimal = 0n;
  for (const ch of cleaned) {
    const digit = Number.parseInt(ch, 36);
    if (Number.isNaN(digit)) throw new Error(`invalid base36 char in subdomain: ${ch}`);
    decimal = decimal * 36n + BigInt(digit);
  }
  return `0x${decimal.toString(16).padStart(64, "0")}`;
};
