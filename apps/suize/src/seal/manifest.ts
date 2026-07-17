// =============================================================================
// Manifest v2 — the JSON blob (on Walrus) that describes a SEALED site. Its
// sha256 is fixed on the on-chain `Site.manifest_hash`, so the viewer can prove
// the manifest it fetched is exactly the one the owner published (the on-chain
// hash is the authority). Every file entry's `sha256`/`size` describe the STORED
// (Seal-encrypted) bytes — verified BEFORE decryption.
//
// This module is framework-free (no React, no dapp-kit) so the headless E2E
// proof imports the exact same manifest + identity logic the viewer runs.
// =============================================================================

/** One file in a v2 manifest. `patch` is the Walrus quilt-patch id of the
 *  ENCRYPTED bytes; `sha256`/`size` describe those stored (encrypted) bytes;
 *  `ct` is the ORIGINAL (decrypted) media type the publisher recorded. */
export interface ManifestFileV2 {
  patch: string
  sha256: string
  ct?: string
  size: number
}

/** The v2 manifest blob. `allowlistId` binds the site to its Seal policy;
 *  `spaFallback` is the entry document served for unknown paths. */
export interface ManifestV2 {
  v: 2
  sealed: boolean
  allowlistId: string
  spaFallback: string
  files: Record<string, ManifestFileV2>
}

/** Type guard — a fetched blob is a well-formed v2 sealed manifest. */
export function isManifestV2(x: unknown): x is ManifestV2 {
  if (!x || typeof x !== 'object') return false
  const m = x as Record<string, unknown>
  return (
    m.v === 2 &&
    typeof m.allowlistId === 'string' &&
    typeof m.files === 'object' &&
    m.files !== null
  )
}

/**
 * The Seal encryption IDENTITY for a whole sealed site: the allowlist object
 * id's raw bytes, suffixed with a single `0x01`. The Move `seal_approve` asserts
 * the requested id is prefixed by the allowlist's namespace (its id bytes), so
 * this is the ONE identity every file in the site is encrypted under. Returned
 * as a lower-case hex string with NO `0x` prefix (what `fromHex` consumes).
 */
export function sealIdentity(allowlistId: string): string {
  return allowlistId.replace(/^0x/, '').toLowerCase() + '01'
}

/**
 * Normalise a Move `vector<u8>` field to a lower-case hex string. Over gRPC
 * (`include: { json: true }`) it arrives as a number[]; over GraphQL it is a
 * base64 string. Handles both; '' when genuinely absent. (Ported from the deploy
 * dashboard's `vec_u8_to_hex` — one behaviour, two transports.)
 */
export function vecU8ToHex(v: unknown): string {
  if (Array.isArray(v)) {
    return v.map((n) => (Number(n) & 0xff).toString(16).padStart(2, '0')).join('')
  }
  if (typeof v === 'string' && v.length > 0) {
    try {
      const bin = atob(v)
      let out = ''
      for (let i = 0; i < bin.length; i++) out += bin.charCodeAt(i).toString(16).padStart(2, '0')
      return out
    } catch {
      return ''
    }
  }
  return ''
}

/** sha256 of bytes as a lower-case hex string (WebCrypto — browser + Bun). */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/** Best-effort media type for a served path — prefer the manifest's recorded
 *  `ct`, else guess from the extension. Drives the data-URL MIME the viewer
 *  inlines each asset under. */
const EXT_MIME: Record<string, string> = {
  html: 'text/html',
  htm: 'text/html',
  css: 'text/css',
  js: 'text/javascript',
  mjs: 'text/javascript',
  json: 'application/json',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  ico: 'image/x-icon',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  otf: 'font/otf',
  txt: 'text/plain',
  xml: 'application/xml',
  map: 'application/json',
}

export function mimeFor(path: string, ct?: string): string {
  if (ct && ct.length > 0) return ct
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  return EXT_MIME[ext] ?? 'application/octet-stream'
}

/**
 * Fetch a manifest blob from a Walrus aggregator and parse it as v2. Returns
 * both the parsed manifest AND the raw bytes, so the caller can hash-verify the
 * raw bytes against the on-chain `manifest_hash` (parse-then-reserialize would
 * not reproduce the exact stored bytes).
 */
export async function fetchManifest(
  aggregator: string,
  manifestBlobId: string,
): Promise<{ manifest: ManifestV2; raw: Uint8Array }> {
  const res = await fetch(`${aggregator}/v1/blobs/${encodeURIComponent(manifestBlobId)}`)
  if (!res.ok) throw new Error(`manifest fetch failed (${res.status})`)
  const raw = new Uint8Array(await res.arrayBuffer())
  let parsed: unknown
  try {
    parsed = JSON.parse(new TextDecoder().decode(raw))
  } catch {
    throw new Error('manifest is not valid JSON')
  }
  if (!isManifestV2(parsed)) throw new Error('not a sealed v2 manifest')
  return { manifest: parsed, raw }
}
