// Suize Deploy — serving worker (Cloudflare).
//
// Resolves a host to an on-chain `deploy_sui::site::Site` object, fetches that
// site's MANIFEST blob from the Walrus aggregator, verifies its hash against the
// on-chain `manifest_hash`, then streams individual files (quilt patches) — each
// re-hashed against the manifest entry on cache-fill. Integrity is the
// differentiator: we verify the manifest hash AND re-hash every blob.
//
// Resolution:
//   <base36(siteId)>.deploy.suize.io  → base36-decode the subdomain → siteId
//   <custom-domain>                   → DomainRegistry dynamic-field lookup → siteId
//
// Serving model (simpler than versui's N on-chain resource reads):
//   one on-chain read (Site) + one manifest fetch → a path→patch map. O(1) chain
//   state per deploy. The manifest entry carries {patch, sha256, ct, size}.

// ---------------------------------------------------------------------------
// Env (from wrangler.toml [vars]). All PUBLIC config — no secrets in the worker.
// ---------------------------------------------------------------------------

interface Env {
  /** Sui testnet fullnode JSON-RPC URL. */
  SUI_RPC_URL: string;
  /** Walrus aggregator base (testnet). */
  WALRUS_AGGREGATOR: string;
  /** `deploy_sui` package id — recorded for the operator; not read at runtime. */
  DEPLOY_PACKAGE_ID: string;
  /** Shared `DomainRegistry` object id — required for custom-domain resolution. */
  DOMAIN_REGISTRY_ID: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** The base zone we serve subdomains under. */
const BASE_DOMAIN = 'deploy.suize.io';

/** Subdomains that never map to a site (dashboard / infra surfaces). */
const RESERVED_SUBDOMAINS = new Set(['www', 'api', 'app', 'dashboard', 'admin']);

/** How long the resolved Site fields stay in the edge cache. */
const SITE_CACHE_SECONDS = 60;

/** How long a custom-domain → siteId mapping stays cached (positive + negative). */
const DOMAIN_CACHE_SECONDS = 300;

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
  /** sha256 of the manifest bytes. On-chain `vector<u8>` → JSON number[] via RPC. */
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

/**
 * Normalise the on-chain `manifest_hash` to lowercase hex.
 * `sui_getObject` renders a Move `vector<u8>` as a JSON `number[]`; an operator
 * could also store it as a hex string. Accept both, reject anything else.
 */
function manifestHashToHex(raw: SiteFields['manifest_hash']): string | null {
  if (typeof raw === 'string') {
    const cleaned = raw.startsWith('0x') ? raw.slice(2) : raw;
    return /^[0-9a-f]+$/i.test(cleaned) ? cleaned.toLowerCase() : null;
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
// Sui RPC
// ---------------------------------------------------------------------------

async function suiRpc<T>(rpcUrl: string, method: string, params: unknown[]): Promise<T> {
  const res = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  if (!res.ok) throw new Error(`Sui RPC HTTP ${res.status}`);
  const json = (await res.json()) as { result?: T; error?: { message: string } };
  if (json.error) throw new Error(`Sui RPC error: ${json.error.message}`);
  return json.result as T;
}

/** Read the `Site` object's move fields. Throws if the object is missing/not a Site. */
async function fetchSiteFields(rpcUrl: string, siteId: string): Promise<SiteFields> {
  const result = await suiRpc<{
    data?: { content?: { fields?: Record<string, unknown> } };
  }>(rpcUrl, 'sui_getObject', [siteId, { showContent: true }]);

  const fields = result?.data?.content?.fields;
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
 * Resolve a custom domain to a site id via the on-chain DomainRegistry.
 * The registry holds `domains: Table<String, ID>`; we read the dynamic field
 * keyed by the host string. Returns null when unmapped or the registry is unset.
 */
async function resolveCustomDomain(host: string, env: Env): Promise<string | null> {
  const registryId = env.DOMAIN_REGISTRY_ID;
  if (!registryId || registryId.includes('PLACEHOLDER')) return null;

  const field = await suiRpc<{
    data?: { content?: { fields?: { value?: unknown } } };
  }>(env.SUI_RPC_URL, 'suix_getDynamicFieldObject', [
    registryId,
    { type: '0x1::string::String', value: host },
  ]);

  const value = field?.data?.content?.fields?.value;
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

  const fields = await fetchSiteFields(env.SUI_RPC_URL, siteId);
  await cache.put(
    cacheKey,
    new Response(JSON.stringify(fields), {
      headers: { 'Cache-Control': `max-age=${SITE_CACHE_SECONDS}` },
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
  await cache.put(
    cacheKey,
    new Response(JSON.stringify({ siteId }), {
      headers: { 'Cache-Control': `max-age=${DOMAIN_CACHE_SECONDS}` },
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

async function getVerifiedManifest(env: Env, site: SiteFields): Promise<Manifest> {
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
      headers: { 'Cache-Control': `max-age=${SITE_CACHE_SECONDS}` },
    }),
  );
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
// Serve one manifest entry: fetch the patch, re-hash on cache-fill, stream.
// ---------------------------------------------------------------------------

async function serveEntry(
  env: Env,
  request: Request,
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

  // Edge cache, keyed by the content hash (immutable) — survives across sites.
  const cache = caches.default;
  const blobCacheKey = new Request(`https://suize-deploy-cache/blob/${entry.sha256}`);
  let bytes: Uint8Array | null = null;

  const cachedBlob = await cache.match(blobCacheKey);
  if (cachedBlob) {
    bytes = new Uint8Array(await cachedBlob.arrayBuffer());
  } else {
    bytes = await fetchWalrusBytes(
      `${env.WALRUS_AGGREGATOR}/v1/blobs/by-quilt-patch-id/${encodeURIComponent(entry.patch)}`,
    );
    if (!bytes) return new Response('Upstream blob unavailable', { status: 502 });

    // INTEGRITY 2/2 — re-hash the bytes against the manifest entry on cache-fill.
    const actual = await sha256Hex(bytes);
    if (actual !== entry.sha256.toLowerCase()) {
      return new Response(
        `Integrity check failed for ${path} (expected ${entry.sha256}, got ${actual})`,
        { status: 502 },
      );
    }

    await cache.put(
      blobCacheKey,
      new Response(bytes, { headers: { 'Cache-Control': 'public, max-age=31536000, immutable' } }),
    );
  }

  return new Response(bytes, {
    status,
    headers: {
      'Content-Type': ensureCharset(entry.ct || 'application/octet-stream'),
      'Cache-Control': cacheControlFor(path),
      ETag: etag,
      'Access-Control-Allow-Origin': '*',
      'X-Suize-Integrity': 'verified',
      Vary: 'Accept-Encoding',
    },
  });
}

// ---------------------------------------------------------------------------
// Resolve host → siteId. Returns a Response on terminal cases (reserved/404).
// ---------------------------------------------------------------------------

async function resolveSiteId(host: string, env: Env): Promise<string | Response> {
  const lower = host.toLowerCase();

  if (lower === BASE_DOMAIN || lower.endsWith(`.${BASE_DOMAIN}`)) {
    if (lower === BASE_DOMAIN) {
      // Apex is the dashboard, not a site.
      return notFound('No site at the apex domain', host);
    }
    const subdomain = lower.slice(0, lower.length - `.${BASE_DOMAIN}`.length);
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
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

function serverError(message: string, host: string): Response {
  return new Response(errorPage('502', message, host), {
    status: 502,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
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
  async fetch(request: Request, env: Env): Promise<Response> {
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
      const manifest = await getVerifiedManifest(env, site);

      const path = normalisePath(url.pathname);
      const entry = manifest.files[path];

      if (entry) {
        return await serveEntry(env, request, path, entry, 200);
      }

      // Unmatched. A request WITH an extension is a genuine missing asset → 404.
      // An extensionless route falls through to the SPA fallback (index.html).
      if (hasExtension(path)) {
        const custom404 = manifest.files['/404.html'];
        if (custom404) return await serveEntry(env, request, '/404.html', custom404, 404);
        return notFound(`Not found: ${path}`, host);
      }

      const fallbackPath = normalisePath(manifest.spaFallback || '/index.html');
      const fallback = manifest.files[fallbackPath];
      if (!fallback) return notFound(`No SPA fallback (${fallbackPath})`, host);
      return await serveEntry(env, request, fallbackPath, fallback, 200);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return serverError(message, host);
    }
  },
};
