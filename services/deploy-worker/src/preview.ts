// Site-preview metadata — the READ door for the suize.io dashboard.
//
// The dashboard renders a card per deployed site and needs each site's
// OpenGraph/Twitter/<head> metadata, but it can't fetch site HTML cross-origin
// (the sites live on *.suize.site with no permissive CORS on arbitrary files).
// So this worker parses the head server-side and hands back a tiny JSON shape.
//
// This is a pure READ path: it never touches the charge secrets (env.ts
// `chargeConfigured` is irrelevant here) and NEVER fetches or leaks the bytes of
// a SEALED (Seal-encrypted private) site — the on-chain `Site.sealed` bit is the
// gate, resolved before any content read.
//
// Contract (FROZEN — the dashboard is built against this exact shape):
//   GET /preview?site=<0x… siteId>
//     → 200 { siteId, title, description, image, favicon }   (any field may be null)
//     → 200 { siteId, sealed: true }                          (never touch content)
//     → 200 { siteId, lapsed: true }                          (paid_until_ms in the past)
//     → 404 { error: "site not found" }                       (unknown / invalid id)
//
// Reads go DIRECT: the on-chain `Site` (over GraphQL, exactly as the serving
// face resolves it) gives `sealed` + `paid_until_ms` + the manifest blob id; the
// manifest + the site's own index.html come straight from the Walrus aggregator
// (the serving face's cached read helpers are module-private, so the small hash
// normalisation + a bounded, gzip-aware blob read are reproduced here over the
// shared `util.ts` primitives). Sealed/lapsed are decided from the fresh chain
// read; only the immutable parse result is edge-cached (keyed by the manifest
// blob id — the content version — so a re-deploy, which mints a fresh Site + a
// fresh manifest, can never serve a stale card).

import { packageIds, resolveNetwork, SUI_ADDRESS_RE } from "@suize/shared";
import type { Env } from "./env";
import { json } from "./http";
import type { Manifest } from "./manifest";
import {
  base64ToBytes,
  encodeObjectIdToBase36,
  sha256Hex,
  suiGraphql,
  toHex,
} from "./util";

/** Fallback base zone (mirrors index.ts) when BASE_DOMAIN is unset. */
const DEFAULT_BASE_DOMAIN = "suize.site";
const baseDomain = (env: Env): string =>
  (env.BASE_DOMAIN || DEFAULT_BASE_DOMAIN).toLowerCase();

/** Only the first 64 KiB of index.html are parsed — the <head> lives up top and
 * a pathologically huge index can never blow the isolate. */
const MAX_HEAD_BYTES = 64 * 1024;

/** Hard ceiling on how many bytes of the index blob we pull off the wire (a
 * normal index.html — and its gzip — fit whole; anything larger is truncated,
 * yielding at worst all-null metadata rather than an OOM). */
const FETCH_CEILING = 1024 * 1024;

/** The parsed metadata is content-addressed + IMMUTABLE per deploy (a re-deploy
 * mints a new siteId + manifest), so cache it hard: an hour in the browser, a
 * day at the edge. */
const METADATA_CACHE_CONTROL = "public, max-age=3600, s-maxage=86400";

/** `lapsed` is the ONE mutable bit (an `extend_site` flips it back), so it gets
 * a short cache and is never stored in the edge parse-cache. */
const LAPSED_CACHE_CONTROL = "public, max-age=30";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SitePreviewFields {
  manifestBlobId: string;
  manifestHashHex: string | null;
  paidUntilMs: number;
  sealed: boolean;
}

interface HeadMeta {
  title: string | null;
  description: string | null;
  image: string | null;
  favicon: string | null;
}

const EMPTY_META: HeadMeta = { title: null, description: null, image: null, favicon: null };

// ---------------------------------------------------------------------------
// On-chain Site read (fresh every request — `paid_until_ms` is mutable).
// ---------------------------------------------------------------------------

/**
 * Normalise the on-chain `manifest_hash` (`vector<u8>`) to lowercase hex.
 * Reproduces index.ts `manifestHashToHex`: GraphQL renders the vector as base64
 * (44 chars ending '='), an operator may store hex, legacy JSON-RPC gave a
 * number[]; the base64/hex forms never collide for a 32-byte digest.
 */
function manifestHashToHex(raw: unknown): string | null {
  if (typeof raw === "string") {
    const cleaned = raw.startsWith("0x") ? raw.slice(2) : raw;
    if (/^[0-9a-f]+$/i.test(cleaned)) return cleaned.toLowerCase();
    const bytes = base64ToBytes(raw);
    return bytes ? toHex(bytes) : null;
  }
  if (Array.isArray(raw)) return toHex(Uint8Array.from(raw.map((n) => Number(n) & 0xff)));
  return null;
}

/** Read the `Site`'s preview-relevant fields over GraphQL, asserting it is a
 * `Site` of THIS network's deploy package. Returns null on unknown/invalid id,
 * a non-Site object, or a read failure — the caller maps that to a 404. */
async function readSiteForPreview(env: Env, siteId: string): Promise<SitePreviewFields | null> {
  const expectedType = `${packageIds(resolveNetwork(env.SUI_NETWORK)).DEPLOY.PACKAGE}::site::Site`;
  const query = `query($id: SuiAddress!) {
    object(address: $id) { asMoveObject { contents { type { repr } json } } }
  }`;
  let result: {
    object?: {
      asMoveObject?: {
        contents?: { type?: { repr?: string } | null; json?: Record<string, unknown> } | null;
      } | null;
    } | null;
  };
  try {
    result = await suiGraphql(env.SUI_GRAPHQL_URL, query, { id: siteId });
  } catch {
    return null; // GraphQL error / invalid address → not found
  }

  const contents = result?.object?.asMoveObject?.contents;
  const f = contents?.json;
  if (!f || contents?.type?.repr !== expectedType) return null;

  const manifestBlobId = f["manifest_blob_id"];
  if (typeof manifestBlobId !== "string") return null;

  return {
    manifestBlobId,
    manifestHashHex: manifestHashToHex(f["manifest_hash"]),
    paidUntilMs: Number(f["paid_until_ms"] ?? 0) || 0,
    sealed: f["sealed"] === true,
  };
}

// ---------------------------------------------------------------------------
// Walrus reads — manifest (hash-verified) + a bounded, gzip-aware index blob.
// ---------------------------------------------------------------------------

/** Undo transport gzip (aggregator may gzip WITHOUT a Content-Encoding header —
 * index.ts documents this). The magic bytes gate the attempt; a genuine
 * non-gzip payload (or a truncated stream) falls through to the raw bytes. */
async function maybeGunzip(bytes: Uint8Array): Promise<Uint8Array> {
  if (!(bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b)) return bytes;
  try {
    const body = new Response(bytes as unknown as ArrayBuffer).body;
    if (!body) return bytes;
    const out = await new Response(body.pipeThrough(new DecompressionStream("gzip"))).arrayBuffer();
    return new Uint8Array(out);
  } catch {
    return bytes;
  }
}

/** Fetch + verify the manifest blob against the on-chain `manifest_hash`. Null
 * on a transient failure (aggregator down, hash mismatch, bad JSON) — the caller
 * treats that as "no metadata yet", never caches it. */
async function loadManifest(env: Env, site: SitePreviewFields): Promise<Manifest | null> {
  let raw: Uint8Array;
  try {
    const res = await fetch(`${env.WALRUS_AGGREGATOR}/v1/blobs/${site.manifestBlobId}`);
    if (!res.ok) return null;
    raw = new Uint8Array(await res.arrayBuffer());
  } catch {
    return null;
  }

  const bytes = await maybeGunzip(raw);
  // Chain-anchored integrity: the manifest bytes must hash to `manifest_hash`
  // (raw, or transport-gunzipped — the hash is the arbiter, as in the serving
  // face). A null on-chain hash (malformed) means we can't verify → bail.
  if (site.manifestHashHex) {
    const ok =
      (await sha256Hex(bytes)) === site.manifestHashHex ||
      (await sha256Hex(raw)) === site.manifestHashHex;
    if (!ok) return null;
  } else {
    return null;
  }

  try {
    const manifest = JSON.parse(new TextDecoder().decode(bytes)) as Manifest;
    return manifest.files && typeof manifest.files === "object" ? manifest : null;
  } catch {
    return null;
  }
}

/** Pull the site's index.html blob, bounded to FETCH_CEILING bytes and
 * gzip-normalised. Null on a transient fetch failure. */
async function readIndexBlob(env: Env, patch: string): Promise<Uint8Array | null> {
  let res: Response;
  try {
    res = await fetch(
      `${env.WALRUS_AGGREGATOR}/v1/blobs/by-quilt-patch-id/${encodeURIComponent(patch)}`,
    );
  } catch {
    return null;
  }
  if (!res.ok || !res.body) return null;

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (total < FETCH_CEILING) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.length;
    }
  } catch {
    return null;
  } finally {
    await reader.cancel().catch(() => {});
  }

  const buf = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    buf.set(c, off);
    off += c.length;
  }
  return maybeGunzip(buf);
}

// ---------------------------------------------------------------------------
// <head> extraction — HTMLRewriter (workerd-native streaming parser).
// ---------------------------------------------------------------------------

function absolutize(raw: string, base: string): string | null {
  try {
    return new URL(raw, base).toString();
  } catch {
    return null;
  }
}

async function parseHead(html: Uint8Array, base: string): Promise<HeadMeta> {
  let ogTitle: string | null = null;
  let twTitle: string | null = null;
  let docTitle = "";
  let ogDesc: string | null = null;
  let twDesc: string | null = null;
  let metaDesc: string | null = null;
  let ogImage: string | null = null;
  let ogImageSecure: string | null = null;
  let twImage: string | null = null;
  let favicon: string | null = null;
  let inTitle = false;
  let headDone = false; // stop honouring matches once </head> is seen

  const rewriter = new HTMLRewriter()
    .on("head", {
      element(el) {
        el.onEndTag(() => {
          headDone = true;
        });
      },
    })
    .on("title", {
      element() {
        if (!headDone) inTitle = true;
      },
      text(t) {
        if (!inTitle) return;
        docTitle += t.text;
        if (t.lastInTextNode) inTitle = false;
      },
    })
    .on("meta", {
      element(el) {
        if (headDone) return;
        const prop = (el.getAttribute("property") || "").toLowerCase();
        const name = (el.getAttribute("name") || "").toLowerCase();
        const content = el.getAttribute("content");
        if (!content) return;
        if (prop === "og:title") ogTitle ??= content;
        if (prop === "og:description") ogDesc ??= content;
        if (prop === "og:image") ogImage ??= content;
        if (prop === "og:image:secure_url") ogImageSecure ??= content;
        if (name === "twitter:title") twTitle ??= content;
        if (name === "twitter:description") twDesc ??= content;
        if (name === "twitter:image" || name === "twitter:image:src") twImage ??= content;
        if (name === "description") metaDesc ??= content;
      },
    })
    .on("link", {
      element(el) {
        if (headDone || favicon) return;
        const rel = (el.getAttribute("rel") || "").toLowerCase().split(/\s+/);
        if (!rel.includes("icon")) return;
        const href = el.getAttribute("href");
        if (href) favicon = href;
      },
    });

  // Drive the parser over the capped head region and consume the output.
  await rewriter
    .transform(new Response(html.subarray(0, MAX_HEAD_BYTES) as unknown as ArrayBuffer))
    .arrayBuffer();

  const rawImage = ogImageSecure || ogImage || twImage;
  return {
    title: ogTitle || twTitle || docTitle.trim() || null,
    description: ogDesc || twDesc || metaDesc || null,
    image: rawImage ? absolutize(rawImage, base) : null,
    favicon: favicon ? absolutize(favicon, base) : null,
  };
}

// ---------------------------------------------------------------------------
// Metadata pipeline (edge-cached by the immutable manifest/content version).
// ---------------------------------------------------------------------------

/** Parse the site's index.html into head metadata. Returns EMPTY_META when the
 * site simply has no index.html (a definite, cacheable result), or null on a
 * transient Walrus failure (do NOT cache — a retry recovers). */
async function parseIndexMeta(env: Env, siteId: string, site: SitePreviewFields): Promise<HeadMeta | null> {
  const manifest = await loadManifest(env, site);
  if (!manifest) return null;

  const entry = manifest.files["/index.html"];
  if (!entry) return EMPTY_META; // no index.html → all-null, but definite

  const html = await readIndexBlob(env, entry.patch);
  if (!html) return null;

  const base = `https://${encodeObjectIdToBase36(siteId)}.${baseDomain(env)}/`;
  return parseHead(html, base);
}

async function extractMeta(env: Env, siteId: string, site: SitePreviewFields): Promise<HeadMeta> {
  const cache = caches.default;
  // Keyed by the manifest blob id = the content version: a re-deploy mints a new
  // one, busting the cache; the same content is served hot forever otherwise.
  const key = new Request(`https://suize-deploy-cache/preview-meta/${site.manifestBlobId}`);

  const hit = await cache.match(key);
  if (hit) return (await hit.json()) as HeadMeta;

  const meta = await parseIndexMeta(env, siteId, site);
  if (meta) {
    await cache.put(
      key,
      new Response(JSON.stringify(meta), { headers: { "Cache-Control": METADATA_CACHE_CONTROL } }),
    );
    return meta;
  }
  return EMPTY_META; // transient failure — served, not cached
}

// ---------------------------------------------------------------------------
// Route handler.
// ---------------------------------------------------------------------------

const notFound = (): Response => json({ error: "site not found" }, 404);

export const handlePreview = async (req: Request, env: Env): Promise<Response> => {
  const siteId = (new URL(req.url).searchParams.get("site") || "").toLowerCase();
  if (!SUI_ADDRESS_RE.test(siteId)) return notFound();

  const site = await readSiteForPreview(env, siteId);
  if (!site) return notFound();

  // SEALED wins first: it is immutable and we must never fetch/leak the
  // (encrypted) content — there is no card to render for a private site.
  if (site.sealed) {
    return json({ siteId, sealed: true }, 200, { "Cache-Control": METADATA_CACHE_CONTROL });
  }

  // LAPSED: paid-through is in the past → content may not serve. Mutable state,
  // so a short cache and no edge parse-cache entry.
  if (site.paidUntilMs > 0 && site.paidUntilMs < Date.now()) {
    return json({ siteId, lapsed: true }, 200, { "Cache-Control": LAPSED_CACHE_CONTROL });
  }

  const meta = await extractMeta(env, siteId, site);
  return json({ siteId, ...meta }, 200, { "Cache-Control": METADATA_CACHE_CONTROL });
};
