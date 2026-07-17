// Hash / hex / base36 primitives shared by the serving face (index.ts) and the
// charge face (publish/extend/domains). ONE home — the base36 codec especially
// must stay byte-identical everywhere a subdomain is minted or decoded.

export function toHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, '0');
  }
  return out;
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  // `digest` accepts a BufferSource — pass the view directly (avoids the
  // `SharedArrayBuffer` widening that `.buffer` introduces).
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return toHex(new Uint8Array(digest));
}

/** Decode a standard-base64 string to bytes, or null if it isn't valid base64.
 * `atob` is a workerd global (WHATWG). */
export function base64ToBytes(b64: string): Uint8Array | null {
  try {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i) & 0xff;
    return bytes;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Base36 ↔ Sui object id.
//
// FIXED WIDTH: a 256-bit value's largest base36 representation is exactly 50
// chars, so every subdomain is LEFT-PADDED to 50 with '0'. `isBase36ObjectId`
// matches that exact width — a low-magnitude id can't slip below the match
// window. Decode absorbs the '0' pad, so the round-trip is exact.
// ---------------------------------------------------------------------------

/** Fixed subdomain width: the max base36 length a 256-bit object id produces. */
export const BASE36_OBJECT_ID_WIDTH = 50;

export function encodeObjectIdToBase36(objectId: string): string {
  const hex = objectId.startsWith('0x') ? objectId.slice(2) : objectId;
  const value = BigInt('0x' + hex);
  return value.toString(36).padStart(BASE36_OBJECT_ID_WIDTH, '0');
}

export function decodeBase36ToObjectId(subdomain: string): string {
  const cleaned = subdomain.toLowerCase().replace(/^0+/, '') || '0';
  let decimal = 0n;
  for (const ch of cleaned) {
    const digit = parseInt(ch, 36);
    decimal = decimal * 36n + BigInt(digit);
  }
  return '0x' + decimal.toString(16).padStart(64, '0');
}

/** A subdomain that is a FIXED-WIDTH (50-char) base36-encoded 256-bit id. */
export function isBase36ObjectId(subdomain: string): boolean {
  return new RegExp(`^[0-9a-z]{${BASE36_OBJECT_ID_WIDTH}}$`, 'i').test(subdomain);
}

// ---------------------------------------------------------------------------
// Sui GraphQL RPC (zero-dep). One plain `fetch` of `{query,variables}`; a
// GraphQL `errors` body THROWS so a failed read FAILS CLOSED (never a hit).
// ---------------------------------------------------------------------------

export async function suiGraphql<T>(
  graphqlUrl: string,
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(graphqlUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`Sui GraphQL HTTP ${res.status}`);
  const body = (await res.json()) as { data?: T; errors?: Array<{ message?: string }> };
  if (body.errors?.length) throw new Error(`Sui GraphQL error: ${body.errors[0]?.message ?? 'query error'}`);
  return body.data as T;
}

/** ULEB128-encode a non-negative integer (the BCS length prefix). */
export function uleb128(n: number): number[] {
  const out: number[] = [];
  let v = n >>> 0;
  do {
    let b = v & 0x7f;
    v >>>= 7;
    if (v !== 0) b |= 0x80;
    out.push(b);
  } while (v !== 0);
  return out;
}

/**
 * BCS-encode a Move `0x1::string::String` (ULEB128 length + UTF-8 bytes) and
 * base64 it — the form a GraphQL `DynamicFieldName.bcs` needs. Byte-identical
 * to `bcs.string().serialize(s)`.
 */
export function bcsStringBase64(s: string): string {
  const utf8 = new TextEncoder().encode(s);
  const bytes = new Uint8Array([...uleb128(utf8.length), ...utf8]);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}
