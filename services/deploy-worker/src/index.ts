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
// Env lives in ./env (ONE interface for both faces: this serving face + the
// charge face under ./api). The charge API answers on API_HOST; every other
// host resolves to a site.
// ---------------------------------------------------------------------------

import { packageIds, resolveNetwork } from '@suize/shared';
import type { Env } from './env';
import { handleApi, isApiHost, isApiPath } from './api';
import { siteForDomain } from './domains';
import {
  base64ToBytes,
  decodeBase36ToObjectId,
  isBase36ObjectId,
  sha256Hex,
  suiGraphql,
  toHex,
} from './util';
import type { Manifest, ManifestEntry } from './manifest';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Fallback base zone when the BASE_DOMAIN var is unset (its own zone → free first-level wildcard SSL). */
const DEFAULT_BASE_DOMAIN = 'suize.site';

/** The base zone we serve subdomains under — from wrangler [vars], with the historical default. */
const baseDomain = (env: Env): string =>
  (env.BASE_DOMAIN || DEFAULT_BASE_DOMAIN).toLowerCase();

/** The deploy_sui id block for this worker's network — the SINGLE source of truth
 * is @suize/shared (CLAUDE.md #15: ids live ONLY there). The serving face resolves
 * the DomainRegistry id from here, exactly as the charge face (chain.ts) does — no
 * duplicated wrangler var to drift. */
const deployPkg = (env: Env) => packageIds(resolveNetwork(env.SUI_NETWORK)).DEPLOY;

/** Subdomains that never map to a site (dashboard / infra surfaces). */
const RESERVED_SUBDOMAINS = new Set(['www', 'api', 'app', 'dashboard', 'admin']);

/** Manifest cache TTL. The manifest blob is IMMUTABLE — every deploy mints a
 * FRESH `Site` referencing a fresh, content-derived manifest blob id — so cache
 * it for a year. */
const IMMUTABLE_CACHE_SECONDS = 31536000;

/** Site-fields cache TTL — SHORT, because a `Site` carries ONE mutable field,
 * `paid_until_ms` (a paid /extend moves it). The blob refs on a Site never change,
 * but the billing field does, so this entry must expire fast enough that a renewal
 * un-lapses a site within the minute (never the 1-year immutable tier). */
const SITE_FIELDS_CACHE_SECONDS = 60;

/** Clock-skew grace on the hosting gate: a site is served until `paid_until_ms`
 * plus this window, so a just-expired site doesn't flicker at the epoch boundary. */
const LAPSE_GRACE_MS = 5 * 60_000;

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

// Manifest shape: ./manifest (written by the publish face; stored on Walrus;
// hash on-chain). v2 (`sealed`) sites serve the viewer bootstrap, not bytes.

/** On-chain `Site` fields the worker needs. */
interface SiteFields {
  quilt_id: string;
  manifest_blob_id: string;
  /** sha256 of the manifest bytes. On-chain `vector<u8>`, rendered by the live
   * GraphQL read as a BASE64 string (legacy JSON-RPC gave number[]; an operator
   * may store hex) — normalised by `manifestHashToHex`. */
  manifest_hash: number[] | string;
  /** Prepaid-through epoch (ms). The ONE mutable Site field — the hosting gate
   * compares it to now, so a lapsed site stops serving. 0 when absent/unparseable
   * → treated as "no gate" (never blocks a legacy site that predates the field). */
  paid_until_ms: number;
}

// Hex / hashing / base36 / GraphQL primitives live in ./util (shared with the
// charge face — the base36 codec especially must stay byte-identical).

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

/** Read the `Site` object's move fields over GraphQL. Throws if missing/not a Site.
 * `expectedType` is the exact `<pkg>::site::Site` this worker's network serves —
 * we assert the object's `type.repr` equals it, so a subdomain that resolves to a
 * NON-Site object (or a Site from an abandoned package) is rejected up front
 * rather than half-read. (GraphQL `MoveType.repr` is the fully-normalised form,
 * matching the 66-char package id in @suize/shared.) */
async function fetchSiteFields(
  graphqlUrl: string,
  siteId: string,
  expectedType: string,
): Promise<SiteFields> {
  const query = `query($id: SuiAddress!) {
    object(address: $id) { asMoveObject { contents { type { repr } json } } }
  }`;
  const result = await suiGraphql<{
    object?: {
      asMoveObject?: {
        contents?: { type?: { repr?: string } | null; json?: Record<string, unknown> } | null;
      } | null;
    } | null;
  }>(graphqlUrl, query, { id: siteId });

  const contents = result?.object?.asMoveObject?.contents;
  const fields = contents?.json;
  if (!fields) throw new Error(`Site not found: ${siteId}`);
  if (contents?.type?.repr !== expectedType) {
    throw new Error(`Not a Site object: ${siteId} (type ${contents?.type?.repr ?? 'unknown'})`);
  }

  const quilt_id = fields['quilt_id'];
  const manifest_blob_id = fields['manifest_blob_id'];
  const manifest_hash = fields['manifest_hash'];
  if (typeof quilt_id !== 'string' || typeof manifest_blob_id !== 'string') {
    throw new Error(`Site object missing manifest fields: ${siteId}`);
  }
  // `paid_until_ms` is a u64 → GraphQL renders it as a decimal STRING. Parse
  // defensively; a missing/NaN value collapses to 0 (the hosting gate then no-ops).
  const paidUntil = Number(fields['paid_until_ms'] ?? 0);
  return {
    quilt_id,
    manifest_blob_id,
    manifest_hash: manifest_hash as SiteFields['manifest_hash'],
    paid_until_ms: Number.isFinite(paidUntil) ? paidUntil : 0,
  };
}

// Custom domain → site id: `siteForDomain` (./domains), the gRPC dynamic-field
// read the verify path already trusts. The old GraphQL read here was LIVE-proven
// broken: `object(address: <inner table UID>)` is null in Sui GraphQL (a Table's
// inner UID is not a top-level object node), so every linked custom domain 404'd
// "Domain not linked" while verify=1 — reading the SAME field over gRPC —
// resolved it. siteForDomain returns null on any failure (never throws), so an
// RPC outage degrades to the same notFound as an unlinked domain — never a 5xx.

// ---------------------------------------------------------------------------
// Edge cache for resolved Site fields (so we don't hit RPC every request).
// ---------------------------------------------------------------------------

async function getCachedSiteFields(env: Env, siteId: string): Promise<SiteFields> {
  const cache = caches.default;
  const cacheKey = new Request(`https://suize-deploy-cache/site/${siteId}`);

  const cached = await cache.match(cacheKey);
  if (cached) return (await cached.json()) as SiteFields;

  const fields = await fetchSiteFields(env.SUI_GRAPHQL_URL, siteId, `${deployPkg(env).PACKAGE}::site::Site`);
  await cache.put(
    cacheKey,
    new Response(JSON.stringify(fields), {
      // SHORT ttl: `paid_until_ms` is mutable (a paid /extend moves it), so this
      // entry must NOT ride the 1-year immutable tier — else an extend could not
      // un-lapse a site for a year.
      headers: { 'Cache-Control': `max-age=${SITE_FIELDS_CACHE_SECONDS}` },
    }),
  );
  return fields;
}

async function getCachedCustomDomain(env: Env, host: string): Promise<string | null> {
  const cache = caches.default;
  const cacheKey = new Request(`https://suize-deploy-cache/domain/${host}`);

  const cached = await cache.match(cacheKey);
  if (cached) return ((await cached.json()) as { siteId: string | null }).siteId;

  const siteId = await siteForDomain(env, host).catch(() => null);
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
// Walrus blob fetch + hash-driven gzip normalisation.
//
// The aggregator MAY return a blob gzip-compressed WITHOUT a `Content-Encoding`
// header (Worker `fetch` does NOT auto-decompress). But a site file can ALSO be
// a genuine gzip payload (.svgz/.gz) whose stored bytes ARE the manifest content.
// So the sha256 — not the magic bytes — is the arbiter: try the raw bytes first;
// only if they don't match the expected hash do we decompress and re-check. This
// serves a real .svgz correctly (raw matches) AND undoes transport gzip
// (decompressed matches) — the old "gunzip whenever the magic bytes appear"
// corrupted genuine gzip files into a permanent 502.
// ---------------------------------------------------------------------------

async function fetchWalrusBytes(url: string): Promise<Uint8Array | null> {
  const res = await fetch(url);
  if (!res.ok) return null;
  return new Uint8Array(await res.arrayBuffer());
}

/** Return the byte form (raw, else gunzipped) whose sha256 == `expectedHex`, or
 * null if neither matches. The hash is the integrity arbiter. */
async function matchOrDecompress(raw: Uint8Array, expectedHex: string): Promise<Uint8Array | null> {
  if ((await sha256Hex(raw)) === expectedHex) return raw;
  // Not a match as-is — maybe the aggregator transport-gzipped it; try decompress.
  if (raw.length >= 2 && raw[0] === 0x1f && raw[1] === 0x8b) {
    try {
      const ds = new DecompressionStream('gzip');
      const out = new Uint8Array(
        await new Response(new Response(raw as unknown as ArrayBuffer).body!.pipeThrough(ds)).arrayBuffer(),
      );
      if ((await sha256Hex(out)) === expectedHex) return out;
    } catch {
      /* not actually gzip */
    }
  }
  return null;
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

  const raw = await fetchWalrusBytes(`${env.WALRUS_AGGREGATOR}/v1/blobs/${site.manifest_blob_id}`);
  if (!raw) throw new Error(`Manifest blob unavailable: ${site.manifest_blob_id}`);

  // INTEGRITY 1/2 — the manifest bytes must hash to the on-chain manifest_hash
  // (raw, or transport-gunzipped — matchOrDecompress lets the hash decide).
  const expected = manifestHashToHex(site.manifest_hash);
  if (!expected) throw new Error('Site manifest_hash is malformed');
  const bytes = await matchOrDecompress(raw, expected);
  if (!bytes) {
    throw new Error(`Manifest hash mismatch (on-chain ${expected} != blob ${await sha256Hex(raw)})`);
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
  // Sealed sites skip the warm: their bytes are served by the viewer, not here.
  if (!manifest.sealed) warmSite(env, ctx, manifest);
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
  const raw = await fetchWalrusBytes(
    `${env.WALRUS_AGGREGATOR}/v1/blobs/by-quilt-patch-id/${encodeURIComponent(entry.patch)}`,
  );
  if (!raw) return new Response('Upstream blob unavailable', { status: 502 });

  // INTEGRITY 2/2 — the bytes must hash to the manifest entry (raw, or transport-
  // gunzipped — the hash decides; a genuine .svgz serves, transport gzip is undone).
  const bytes = await matchOrDecompress(raw, sha);
  if (!bytes) {
    return new Response(
      `Integrity check failed for ${path} (expected ${entry.sha256}, got ${await sha256Hex(raw)})`,
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

/** 410 Gone — the site existed but its prepaid hosting lapsed. `no-store` so the
 * gate re-evaluates each request against the (briefly-cached) on-chain field, and
 * a renewal is reflected as soon as that entry expires. */
function hostingLapsed(host: string): Response {
  return new Response(
    errorPage('410', "This site's hosting has lapsed. The owner can renew it to bring it back online.", host),
    {
      status: 410,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    },
  );
}

/**
 * A SEALED site's URL serves this bootstrap instead of bytes: the stored files
 * are Seal-encrypted, and only the suize.io viewer (wallet-connected, on the
 * site's viewer list) can decrypt them — client-side, never here.
 */
function sealedBootstrap(env: Env, siteId: string): Response {
  const viewer = `${(env.VIEWER_URL || 'https://suize.io').replace(/\/$/, '')}/#/view/${siteId}`;
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Private site — Suize</title>
<script>location.replace(${JSON.stringify(viewer)});</script>
<style>
  html,body{margin:0;height:100%;background:#0a0a0a;color:#e7e7e7;
    font-family:'Martian Mono',ui-monospace,SFMono-Regular,Menlo,monospace}
  .wrap{display:flex;flex-direction:column;align-items:center;justify-content:center;
    min-height:100%;gap:.75rem;padding:2rem;text-align:center}
  a{color:#7c5cff}
</style></head>
<body><div class="wrap">
  <div>This is a private site.</div>
  <div><a href="${viewer}">Open it in the Suize viewer</a> and sign in with your wallet.</div>
</div></body></html>`;
  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
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

    // The charge API answers on ITS host (api.suize.site; localhost in dev)
    // AND on the base-domain APEX for the API paths (`suize.site/deploy` —
    // otherwise a dead 404 surface). Every other host serves sites.
    if (isApiHost(host, env) || (host.toLowerCase() === baseDomain(env) && isApiPath(url.pathname))) {
      return handleApi(request, env);
    }

    // Only GET/HEAD are meaningful for static serving.
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
    }

    const resolved = await resolveSiteId(host, env);
    if (resolved instanceof Response) return resolved;
    const siteId = resolved;

    try {
      const site = await getCachedSiteFields(env, siteId);

      // Hosting gate: a site whose prepaid window has lapsed (past a small
      // clock-skew grace) stops serving — checked BEFORE any blob bytes are
      // streamed. 410 Gone: the site existed and its hosting lapsed. The
      // site-fields entry is cached only briefly (SITE_FIELDS_CACHE_SECONDS), so a
      // paid /extend brings it back within the minute.
      if (site.paid_until_ms > 0 && Date.now() > site.paid_until_ms + LAPSE_GRACE_MS) {
        return hostingLapsed(host);
      }

      const manifest = await getVerifiedManifest(env, ctx, site);

      // Sealed site: the URL serves the viewer bootstrap, never the (encrypted)
      // bytes — decryption is client-side in the suize.io viewer.
      if (manifest.sealed) return sealedBootstrap(env, siteId);

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
