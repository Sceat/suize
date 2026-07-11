// Suize Deploy — serving worker (Cloudflare).
//
// Resolves a host to an on-chain `deploy_sui::site::Site` object, fetches that
// site's MANIFEST blob from the Walrus aggregator, verifies its hash against the
// on-chain `manifest_hash`, then streams individual files (quilt patches) — each
// re-hashed against the manifest entry on cache-fill. Integrity is the
// differentiator: we verify the manifest hash AND re-hash every blob.
//
// Latency: a cold Walrus read is a multi-second sliver reconstruct, so blobs are
// layered edge-cache → R2 → aggregator (content-addressed by sha256, verified on
// every fill — see loadVerifiedBlob) and a cold manifest fill background-warms
// the whole site before the browser asks for its assets.
//
// Resolution:
//   <base36(siteId)>.suize.site       → base36-decode the subdomain → siteId
//   <custom-domain>                   → DomainRegistry dynamic-field lookup → siteId
//
// Serving model (simpler than versui's N on-chain resource reads):
//   one on-chain read (Site) + one manifest fetch → a path→patch map. O(1) chain
//   state per deploy. The manifest entry carries {patch, sha256, ct, size}.

// ---------------------------------------------------------------------------
// Env (from wrangler.toml [vars]). All PUBLIC config — no secrets in the worker.
// ---------------------------------------------------------------------------

interface Env {
  /** Sui GraphQL RPC URL for the network this worker serves (wrangler [vars] /
   * [env.mainnet.vars]). Replaces the retired public JSON-RPC fullnode — reads
   * run over GraphQL via raw `fetch`, mirroring packages/pay/src/subs.ts (zero-dep). */
  SUI_GRAPHQL_URL: string;
  /** Walrus aggregator base for the same network. */
  WALRUS_AGGREGATOR: string;
  /** `deploy_sui` package id — recorded for the operator; not read at runtime. */
  DEPLOY_PACKAGE_ID: string;
  /** Shared `DomainRegistry` object id — required for custom-domain resolution. */
  DOMAIN_REGISTRY_ID: string;
  /** The base zone we serve subdomains under. Optional — falls back to 'suize.site'. */
  BASE_DOMAIN?: string;
  /** R2 durable global blob cache, content-addressed by sha256 (can never be
   * stale; no invalidation path exists). Optional — without the binding the
   * worker serves from the edge cache + aggregator only. */
  BLOB_CACHE?: R2Bucket;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Fallback base zone when the BASE_DOMAIN var is unset (its own zone → free first-level wildcard SSL). */
const DEFAULT_BASE_DOMAIN = 'suize.site';

/** The base zone we serve subdomains under — from wrangler [vars], with the historical default. */
const baseDomain = (env: Env): string =>
  (env.BASE_DOMAIN || DEFAULT_BASE_DOMAIN).toLowerCase();

/** Subdomains that never map to a site (dashboard / infra surfaces). */
const RESERVED_SUBDOMAINS = new Set(['www', 'api', 'app', 'dashboard', 'admin']);

/** Site-fields + manifest cache TTL. Both are IMMUTABLE by construction — every
 * deploy mints a FRESH `Site` (no `&mut Site` entry point exists in `deploy_sui`)
 * and Walrus blob ids are content-derived — so cache them for a year. Only the
 * custom-domain mapping below is mutable and keeps a short TTL. */
const IMMUTABLE_CACHE_SECONDS = 31536000;

/** How many manifest entries a cold hit warms in the background (subrequest budget). */
const WARM_MAX_ENTRIES = 30;

/** Parallel blob fills during a background warm. */
const WARM_CONCURRENCY = 6;

/** Max `Link: rel=preload` entries emitted on an HTML response. */
const PRELOAD_MAX = 6;

/** How long a custom-domain → siteId mapping stays cached once resolved. */
const DOMAIN_CACHE_SECONDS = 300;

/** Negative (unlinked) lookups cache briefly only — a just-linked domain must go
 * live without waiting out the positive TTL. */
const DOMAIN_NEGATIVE_CACHE_SECONDS = 30;

/** Extensions treated as content-fingerprinted → immutable far-future cache. */
const IMMUTABLE_EXTENSIONS = new Set([
  '.js', '.mjs', '.css', '.woff', '.woff2', '.ttf', '.otf',
  '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.webp', '.wasm', '.avif',
]);

/** Text content types that need an explicit charset. */
const TEXT_TYPES = new Set([
  'text/html', 'text/css', 'text/javascript', 'text/plain', 'text/xml',
  'text/markdown', 'application/json', 'application/javascript',
  'application/xml', 'image/svg+xml',
]);

// ---------------------------------------------------------------------------
// Manifest shape (written by the backend; stored on Walrus; hash on-chain).
// ---------------------------------------------------------------------------

interface ManifestEntry {
  /** Walrus quilt patch id for this file. */
  patch: string;
  /** Lowercase hex sha256 of the file's ORIGINAL (decompressed) bytes. */
  sha256: string;
  /** Content-Type to serve with. */
  ct: string;
  /** Original byte length (advisory). */
  size: number;
}

interface Manifest {
  v: number;
  /** Path served for unmatched routes (SPA client-side routing). e.g. "/index.html". */
  spaFallback: string;
  files: Record<string, ManifestEntry>;
}

/** On-chain `Site` fields the worker needs. */
interface SiteFields {
  quilt_id: string;
  manifest_blob_id: string;
  /** sha256 of the manifest bytes. On-chain `vector<u8>`, rendered by the live
   * GraphQL read as a BASE64 string (legacy JSON-RPC gave number[]; an operator
   * may store hex) — normalised by `manifestHashToHex`. */
  manifest_hash: number[] | string;
}

// ---------------------------------------------------------------------------
// Hex / hashing helpers
// ---------------------------------------------------------------------------

function toHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, '0');
  }
  return out;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  // `digest` accepts a BufferSource — pass the view directly (avoids the
  // `SharedArrayBuffer` widening that `.buffer` introduces).
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return toHex(new Uint8Array(digest));
}

/** Decode a standard-base64 string to bytes, or null if it isn't valid base64.
 * `atob` is a workerd global (WHATWG). Mirrors the decode in packages/pay/src/subs.ts. */
function base64ToBytes(b64: string): Uint8Array | null {
  try {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i) & 0xff;
    return bytes;
  } catch {
    return null;
  }
}

/**
 * Normalise the on-chain `manifest_hash` (a Move `vector<u8>`) to lowercase hex.
 * The rendering depends on the transport, so accept all three, reject anything else:
 *   • hex string    — an operator may store it that way (matches the hex regex).
 *   • BASE64 string — how Sui GraphQL renders `vector<u8>` (the LIVE read path).
 *   • number[]      — how the legacy JSON-RPC rendered it (kept for safety).
 * Ordering is safe for a 32-byte sha256: its base64 is 44 chars ending in '=' (32
 * isn't a multiple of 3), so it never matches the hex regex and falls to base64;
 * a 64-char hex string carries no '='/'+'/'/' and stays hex — the two never collide.
 */
function manifestHashToHex(raw: SiteFields['manifest_hash']): string | null {
  if (typeof raw === 'string') {
    const cleaned = raw.startsWith('0x') ? raw.slice(2) : raw;
    if (/^[0-9a-f]+$/i.test(cleaned)) return cleaned.toLowerCase();
    // Not hex → the GraphQL base64 rendering of the vector<u8>; decode → hex.
    const bytes = base64ToBytes(raw);
    return bytes ? toHex(bytes) : null;
  }
  if (Array.isArray(raw)) {
    return toHex(Uint8Array.from(raw.map((n) => n & 0xff)));
  }
  return null;
}

// ---------------------------------------------------------------------------
// Base36 ↔ Sui object id (shared codec with the backend/dashboard).
//
// FIXED WIDTH (must stay BYTE-IDENTICAL to `services/backend/src/deploy/base36.ts`):
// a 256-bit value's largest base36 representation is exactly 50 chars, so the
// backend LEFT-PADS every subdomain to 50 with '0'. `isBase36ObjectId` matches
// that exact width — a low-magnitude id (e.g. 0x0…01 → "0…01", 50 chars) can't
// slip below the match window. Decode absorbs the '0' pad, so the round-trip is
// exact (verified: encode(0x..01) → 50-char string → decode → 0x..01).
// ---------------------------------------------------------------------------

/** Fixed subdomain width: the max base36 length a 256-bit object id produces. */
const BASE36_OBJECT_ID_WIDTH = 50;

// Exported (not used at serve time — the worker only DECODES host→siteId) so it
// stays byte-identical to the backend's encode and survives `noUnusedLocals`.
export function encodeObjectIdToBase36(objectId: string): string {
  const hex = objectId.startsWith('0x') ? objectId.slice(2) : objectId;
  const value = BigInt('0x' + hex);
  return value.toString(36).padStart(BASE36_OBJECT_ID_WIDTH, '0');
}

function decodeBase36ToObjectId(subdomain: string): string {
  const cleaned = subdomain.toLowerCase().replace(/^0+/, '') || '0';
  let decimal = 0n;
  for (const ch of cleaned) {
    const digit = parseInt(ch, 36);
    decimal = decimal * 36n + BigInt(digit);
  }
  return '0x' + decimal.toString(16).padStart(64, '0');
}

/** A subdomain that is a FIXED-WIDTH (50-char) base36-encoded 256-bit id. */
function isBase36ObjectId(subdomain: string): boolean {
  return new RegExp(`^[0-9a-z]{${BASE36_OBJECT_ID_WIDTH}}$`, 'i').test(subdomain);
}

// ---------------------------------------------------------------------------
// Sui GraphQL RPC (zero-dep — the public JSON-RPC fullnode is retired). One plain
// `fetch` of `{query,variables}`, mirroring packages/pay/src/subs.ts: throw on a
// GraphQL `errors` body so a failed read FAILS CLOSED (never served as a hit).
// ---------------------------------------------------------------------------

async function suiGraphql<T>(
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
function uleb128(n: number): number[] {
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
 * BCS-encode a Move `0x1::string::String` — identical to a `vector<u8>`: a ULEB128
 * length prefix + the UTF-8 bytes — and base64 it, the form a GraphQL
 * `DynamicFieldName.bcs` needs. Byte-identical to the backend's
 * `bcs.string().serialize(host)` (verified across ascii/unicode/long inputs).
 */
function bcsStringBase64(s: string): string {
  const utf8 = new TextEncoder().encode(s);
  const bytes = new Uint8Array([...uleb128(utf8.length), ...utf8]);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

/** Read the `Site` object's move fields over GraphQL. Throws if missing/not a Site. */
async function fetchSiteFields(graphqlUrl: string, siteId: string): Promise<SiteFields> {
  const query = `query($id: SuiAddress!) {
    object(address: $id) { asMoveObject { contents { json } } }
  }`;
  const result = await suiGraphql<{
    object?: { asMoveObject?: { contents?: { json?: Record<string, unknown> } | null } | null } | null;
  }>(graphqlUrl, query, { id: siteId });

  const fields = result?.object?.asMoveObject?.contents?.json;
  if (!fields) throw new Error(`Site not found: ${siteId}`);

  const quilt_id = fields['quilt_id'];
  const manifest_blob_id = fields['manifest_blob_id'];
  const manifest_hash = fields['manifest_hash'];
  if (typeof quilt_id !== 'string' || typeof manifest_blob_id !== 'string') {
    throw new Error(`Site object missing manifest fields: ${siteId}`);
  }
  return {
    quilt_id,
    manifest_blob_id,
    manifest_hash: manifest_hash as SiteFields['manifest_hash'],
  };
}

/**
 * Resolve a custom domain to a site id via the on-chain DomainRegistry, over
 * GraphQL. Mirrors the backend's `siteForDomain` transport 1:1 — the SAME parent
 * (the registry object id) and the SAME key (the host BCS-encoded as a
 * `0x1::string::String`). Returns null when unmapped or the registry is unset.
 *
 * KNOWN BUG (out of scope — owned by T-004): the registry maps
 * `domains: Table<String, ID>`, whose entries live under the Table's INNER UID,
 * not the registry object's id — so this parent is wrong and the field reads
 * null. Ported faithfully to keep behaviour unchanged; the FIX is a separate ticket.
 */
async function resolveCustomDomain(host: string, env: Env): Promise<string | null> {
  const registryId = env.DOMAIN_REGISTRY_ID;
  if (!registryId || registryId.includes('PLACEHOLDER')) return null;

  const query = `query($parent: SuiAddress!, $name: DynamicFieldName!) {
    object(address: $parent) {
      dynamicField(name: $name) { value { ... on MoveValue { json } } }
    }
  }`;
  const result = await suiGraphql<{
    object?: { dynamicField?: { value?: { json?: unknown } | null } | null } | null;
  }>(env.SUI_GRAPHQL_URL, query, {
    parent: registryId,
    name: { type: '0x1::string::String', bcs: bcsStringBase64(host) },
  });

  const value = result?.object?.dynamicField?.value?.json;
  // `Table<String, ID>` value renders as the ID string (or a wrapper carrying it).
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && typeof (value as { id?: unknown }).id === 'string') {
    return (value as { id: string }).id;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Edge cache for resolved Site fields (so we don't hit RPC every request).
// ---------------------------------------------------------------------------

async function getCachedSiteFields(env: Env, siteId: string): Promise<SiteFields> {
  const cache = caches.default;
  const cacheKey = new Request(`https://suize-deploy-cache/site/${siteId}`);

  const cached = await cache.match(cacheKey);
  if (cached) return (await cached.json()) as SiteFields;

  const fields = await fetchSiteFields(env.SUI_GRAPHQL_URL, siteId);
  await cache.put(
    cacheKey,
    new Response(JSON.stringify(fields), {
      headers: { 'Cache-Control': `max-age=${IMMUTABLE_CACHE_SECONDS}` },
    }),
  );
  return fields;
}

async function getCachedCustomDomain(env: Env, host: string): Promise<string | null> {
  const cache = caches.default;
  const cacheKey = new Request(`https://suize-deploy-cache/domain/${host}`);

  const cached = await cache.match(cacheKey);
  if (cached) return ((await cached.json()) as { siteId: string | null }).siteId;

  const siteId = await resolveCustomDomain(host, env);
  const ttl = siteId === null ? DOMAIN_NEGATIVE_CACHE_SECONDS : DOMAIN_CACHE_SECONDS;
  await cache.put(
    cacheKey,
    new Response(JSON.stringify({ siteId }), {
      headers: { 'Cache-Control': `max-age=${ttl}` },
    }),
  );
  return siteId;
}

// ---------------------------------------------------------------------------
// Walrus blob fetch + gzip normalisation.
//
// The aggregator may return blobs gzip-compressed WITHOUT a `Content-Encoding`
// header (Worker `fetch` does NOT auto-decompress). We normalise to the ORIGINAL
// bytes so the sha256 re-hash matches the manifest entry (which the backend
// computed over the original file bytes), and serve those original bytes.
// ---------------------------------------------------------------------------

async function fetchWalrusBytes(url: string): Promise<Uint8Array | null> {
  const res = await fetch(url);
  if (!res.ok) return null;

  const raw = new Uint8Array(await res.arrayBuffer());

  // If the upstream declared an encoding, the gzip is intentional transport — but
  // since we re-hash and re-serve raw bytes, normalise everything to original bytes.
  const isGzip = raw.length >= 2 && raw[0] === 0x1f && raw[1] === 0x8b;
  if (!isGzip) return raw;

  try {
    const ds = new DecompressionStream('gzip');
    const decompressed = await new Response(
      new Response(raw).body!.pipeThrough(ds),
    ).arrayBuffer();
    return new Uint8Array(decompressed);
  } catch {
    // Not actually gzip (false-positive magic bytes) — serve as-is.
    return raw;
  }
}

// ---------------------------------------------------------------------------
// Manifest fetch + verify (cached as the Site fields are cached upstream of it).
// ---------------------------------------------------------------------------

async function getVerifiedManifest(
  env: Env,
  ctx: ExecutionContext,
  site: SiteFields,
): Promise<Manifest> {
  const cache = caches.default;
  const cacheKey = new Request(`https://suize-deploy-cache/manifest/${site.manifest_blob_id}`);

  const cached = await cache.match(cacheKey);
  if (cached) return (await cached.json()) as Manifest;

  const bytes = await fetchWalrusBytes(`${env.WALRUS_AGGREGATOR}/v1/blobs/${site.manifest_blob_id}`);
  if (!bytes) throw new Error(`Manifest blob unavailable: ${site.manifest_blob_id}`);

  // INTEGRITY 1/2 — verify the manifest bytes against the on-chain hash.
  const expected = manifestHashToHex(site.manifest_hash);
  if (!expected) throw new Error('Site manifest_hash is malformed');
  const actual = await sha256Hex(bytes);
  if (actual !== expected) {
    throw new Error(`Manifest hash mismatch (on-chain ${expected} != blob ${actual})`);
  }

  let manifest: Manifest;
  try {
    manifest = JSON.parse(new TextDecoder().decode(bytes)) as Manifest;
  } catch {
    throw new Error('Manifest blob is not valid JSON');
  }
  if (!manifest.files || typeof manifest.files !== 'object') {
    throw new Error('Manifest has no files map');
  }

  await cache.put(
    cacheKey,
    new Response(JSON.stringify(manifest), {
      headers: { 'Cache-Control': `max-age=${IMMUTABLE_CACHE_SECONDS}` },
    }),
  );

  // First sight of this site in this colo — pre-fill every asset in the
  // background so the browser's follow-up JS/CSS requests land on warm caches.
  warmSite(env, ctx, manifest);
  return manifest;
}

// ---------------------------------------------------------------------------
// Path / header helpers
// ---------------------------------------------------------------------------

function normalisePath(p: string): string {
  let path = p.startsWith('/') ? p : `/${p}`;
  if (path === '/') path = '/index.html';
  // Directory-style request → index.html within it.
  if (path.endsWith('/')) path = `${path}index.html`;
  return path;
}

function ensureCharset(ct: string): string {
  const base = ct.split(';')[0].trim().toLowerCase();
  if (TEXT_TYPES.has(base) && !ct.toLowerCase().includes('charset')) {
    return `${base}; charset=utf-8`;
  }
  return ct;
}

function cacheControlFor(path: string): string {
  const ext = path.match(/\.[^.]+$/)?.[0]?.toLowerCase() ?? '';
  if (IMMUTABLE_EXTENSIONS.has(ext)) return 'public, max-age=31536000, immutable';
  if (ext === '.html' || ext === '') return 'no-cache, no-store, must-revalidate';
  return 'public, max-age=3600';
}

function hasExtension(path: string): boolean {
  return /\.[a-zA-Z0-9]+$/.test(path);
}

// ---------------------------------------------------------------------------
// Verified blob loading: edge cache → R2 → Walrus aggregator.
//
// Content-addressed by sha256 — a hit can never be stale, so both caches take
// far-future fills and there is NO invalidation path. The edge cache is
// per-colo and evictable; R2 is the durable global layer that spares every cold
// colo (and every aggregator cache eviction) the multi-second Walrus sliver
// reconstruct. Bytes are re-hashed on EVERY cache fill, so the integrity claim
// ("mismatch → 502, never the bytes") holds across all three sources.
// ---------------------------------------------------------------------------

async function loadVerifiedBlob(
  env: Env,
  ctx: ExecutionContext,
  path: string,
  entry: ManifestEntry,
  opts?: { backfillR2?: boolean },
): Promise<Uint8Array | Response> {
  const sha = entry.sha256.toLowerCase();
  const cache = caches.default;
  const cacheKey = new Request(`https://suize-deploy-cache/blob/${sha}`);
  const fillEdge = (bytes: Uint8Array) =>
    cache.put(
      cacheKey,
      new Response(bytes, { headers: { 'Cache-Control': 'public, max-age=31536000, immutable' } }),
    );

  // 1. Edge cache (per-colo) — filled only post-verification, served as-is.
  const cached = await cache.match(cacheKey);
  if (cached) {
    const bytes = new Uint8Array(await cached.arrayBuffer());
    // A warm pass must guarantee R2 durability even when the edge short-circuits
    // (blob edge-cached pre-R2, or R2 evicted the object independently). Kept off
    // the normal serve path so an edge hit stays zero-R2-ops.
    const bucket = env.BLOB_CACHE;
    if (opts?.backfillR2 && bucket) {
      ctx.waitUntil(bucket.head(sha).then((found) => (found ? null : bucket.put(sha, bytes))));
    }
    return bytes;
  }

  // 2. R2 (global, durable) — verify on read; a corrupt object is dropped.
  const r2Object = await env.BLOB_CACHE?.get(sha);
  if (r2Object) {
    const bytes = new Uint8Array(await r2Object.arrayBuffer());
    if ((await sha256Hex(bytes)) === sha) {
      ctx.waitUntil(fillEdge(bytes));
      return bytes;
    }
    ctx.waitUntil(env.BLOB_CACHE!.delete(sha));
  }

  // 3. Walrus aggregator — the source of truth.
  const bytes = await fetchWalrusBytes(
    `${env.WALRUS_AGGREGATOR}/v1/blobs/by-quilt-patch-id/${encodeURIComponent(entry.patch)}`,
  );
  if (!bytes) return new Response('Upstream blob unavailable', { status: 502 });

  // INTEGRITY 2/2 — re-hash the bytes against the manifest entry.
  const actual = await sha256Hex(bytes);
  if (actual !== sha) {
    return new Response(
      `Integrity check failed for ${path} (expected ${entry.sha256}, got ${actual})`,
      { status: 502 },
    );
  }

  ctx.waitUntil(fillEdge(bytes));
  if (env.BLOB_CACHE) ctx.waitUntil(env.BLOB_CACHE.put(sha, bytes));
  return bytes;
}

/**
 * Background-warm every manifest entry into the edge + R2 caches. Triggered on
 * a cold manifest fill (the first request a colo sees for a site) — by the time
 * the browser has parsed the HTML and asks for its JS/CSS, those fills are
 * already in flight, collapsing the cold waterfall to one round-trip. Entries
 * beyond WARM_MAX_ENTRIES stay lazy (they fill on first demand as before).
 */
function warmSite(env: Env, ctx: ExecutionContext, manifest: Manifest): void {
  ctx.waitUntil(
    (async () => {
      const entries = Object.entries(manifest.files).slice(0, WARM_MAX_ENTRIES);
      let next = 0;
      const drain = async (): Promise<void> => {
        while (next < entries.length) {
          const [path, entry] = entries[next++];
          await loadVerifiedBlob(env, ctx, path, entry, { backfillR2: true }).catch(() => {});
        }
      };
      await Promise.all(Array.from({ length: WARM_CONCURRENCY }, drain));
    })(),
  );
}

/**
 * `Link: rel=preload` header for an HTML response, built from the manifest —
 * the worker knows what the page needs before the browser has parsed a byte.
 * `crossorigin` matches Vite's `<script type="module" crossorigin>` /
 * `<link rel="stylesheet" crossorigin>` request modes (a mode mismatch would
 * double-fetch instead of reusing the preload).
 */
function preloadHeaderFor(manifest: Manifest): string | null {
  const links: string[] = [];
  for (const path of Object.keys(manifest.files)) {
    if (links.length >= PRELOAD_MAX) break;
    if (/\.m?js$/.test(path)) links.push(`<${path}>; rel=preload; as=script; crossorigin`);
    else if (path.endsWith('.css')) links.push(`<${path}>; rel=preload; as=style; crossorigin`);
    else if (path.endsWith('.woff2')) links.push(`<${path}>; rel=preload; as=font; crossorigin`);
  }
  return links.length ? links.join(', ') : null;
}

// ---------------------------------------------------------------------------
// Serve one manifest entry: load verified bytes, stream with caching headers.
// ---------------------------------------------------------------------------

async function serveEntry(
  env: Env,
  ctx: ExecutionContext,
  request: Request,
  manifest: Manifest,
  path: string,
  entry: ManifestEntry,
  status: number,
): Promise<Response> {
  const etag = `"${entry.sha256}"`;

  // Conditional request — the sha256 is a perfect strong ETag.
  const ifNoneMatch = request.headers.get('If-None-Match');
  if (ifNoneMatch && ifNoneMatch.split(',').some((t) => t.trim().replace(/^W\//, '') === etag)) {
    return new Response(null, {
      status: 304,
      headers: { ETag: etag, 'Cache-Control': cacheControlFor(path) },
    });
  }

  const loaded = await loadVerifiedBlob(env, ctx, path, entry);
  if (loaded instanceof Response) return loaded;

  const headers: Record<string, string> = {
    'Content-Type': ensureCharset(entry.ct || 'application/octet-stream'),
    'Cache-Control': cacheControlFor(path),
    ETag: etag,
    'Access-Control-Allow-Origin': '*',
    'X-Content-Type-Options': 'nosniff',
    'X-Suize-Integrity': 'verified',
    Vary: 'Accept-Encoding',
  };

  // HTML carries preload hints for its assets (entry JS/CSS/fonts).
  if ((entry.ct || '').toLowerCase().startsWith('text/html')) {
    const link = preloadHeaderFor(manifest);
    if (link) headers['Link'] = link;
  }

  return new Response(loaded, { status, headers });
}

// ---------------------------------------------------------------------------
// Resolve host → siteId. Returns a Response on terminal cases (reserved/404).
// ---------------------------------------------------------------------------

async function resolveSiteId(host: string, env: Env): Promise<string | Response> {
  const lower = host.toLowerCase();

  const base = baseDomain(env);
  if (lower === base || lower.endsWith(`.${base}`)) {
    if (lower === base) {
      // Apex is the dashboard, not a site.
      return notFound('No site at the apex domain', host);
    }
    const subdomain = lower.slice(0, lower.length - `.${base}`.length);
    // Only single-label subdomains map to sites (no nested labels).
    if (subdomain.includes('.')) return notFound(`Unknown subdomain: ${subdomain}`, host);
    if (RESERVED_SUBDOMAINS.has(subdomain)) return notFound(`Reserved subdomain: ${subdomain}`, host);
    if (!isBase36ObjectId(subdomain)) return notFound(`Not a site subdomain: ${subdomain}`, host);
    return decodeBase36ToObjectId(subdomain);
  }

  // Custom domain → on-chain registry lookup.
  const siteId = await getCachedCustomDomain(env, lower);
  if (!siteId) return notFound(`Domain not linked: ${host}`, host);
  return siteId;
}

// ---------------------------------------------------------------------------
// Minimal error pages (worker-owned; never proxied to Walrus).
// ---------------------------------------------------------------------------

function notFound(message: string, host: string): Response {
  return new Response(errorPage('404', message, host), {
    status: 404,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'X-Content-Type-Options': 'nosniff' },
  });
}

function serverError(message: string, host: string): Response {
  return new Response(errorPage('502', message, host), {
    status: 502,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'X-Content-Type-Options': 'nosniff' },
  });
}

function errorPage(code: string, message: string, host: string): string {
  const safe = message.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]!));
  const safeHost = host.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]!));
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${code} — Suize Deploy</title>
<style>
  html,body{margin:0;height:100%;background:#0a0a0a;color:#e7e7e7;
    font-family:'Martian Mono',ui-monospace,SFMono-Regular,Menlo,monospace}
  .wrap{display:flex;flex-direction:column;align-items:center;justify-content:center;
    min-height:100%;gap:.75rem;padding:2rem;text-align:center}
  .code{font-size:clamp(3rem,12vw,6rem);font-weight:700;letter-spacing:-.04em;color:#7c5cff}
  .msg{opacity:.7;font-size:.85rem;max-width:34rem}
  .host{opacity:.4;font-size:.75rem;margin-top:1rem}
</style></head>
<body><div class="wrap">
  <div class="code">${code}</div>
  <div class="msg">${safe}</div>
  <div class="host">${safeHost} · Suize Deploy</div>
</div></body></html>`;
}

// ---------------------------------------------------------------------------
// Worker entry.
// ---------------------------------------------------------------------------

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const host = url.hostname;

    // Only GET/HEAD are meaningful for static serving.
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
    }

    const resolved = await resolveSiteId(host, env);
    if (resolved instanceof Response) return resolved;
    const siteId = resolved;

    try {
      const site = await getCachedSiteFields(env, siteId);
      const manifest = await getVerifiedManifest(env, ctx, site);

      const path = normalisePath(url.pathname);
      const entry = manifest.files[path];

      if (entry) {
        return await serveEntry(env, ctx, request, manifest, path, entry, 200);
      }

      // Unmatched. A request WITH an extension is a genuine missing asset → 404.
      // An extensionless route falls through to the SPA fallback (index.html).
      if (hasExtension(path)) {
        const custom404 = manifest.files['/404.html'];
        if (custom404) return await serveEntry(env, ctx, request, manifest, '/404.html', custom404, 404);
        return notFound(`Not found: ${path}`, host);
      }

      const fallbackPath = normalisePath(manifest.spaFallback || '/index.html');
      const fallback = manifest.files[fallbackPath];
      if (!fallback) return notFound(`No SPA fallback (${fallbackPath})`, host);
      return await serveEntry(env, ctx, request, manifest, fallbackPath, fallback, 200);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return serverError(message, host);
    }
  },
};
