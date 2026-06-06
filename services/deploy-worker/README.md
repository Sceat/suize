# `@suize/deploy-worker` — the Suize Deploy serving worker

A Cloudflare Worker that serves Walrus-hosted static sites at
`https://<base36(siteId)>.deploy.suize.io` (and at linked custom domains),
reading the site layout from an on-chain `deploy_sui::site::Site` object.

Spec: [`docs/deploy/SPEC.md`](../../docs/deploy/SPEC.md) §5. Pattern reference
(only): `versui-worker-proxy`. This worker uses the **simpler manifest-blob
model** — one on-chain read + one manifest fetch per site, not N on-chain
resource reads.

## How a request is served

```
GET https://<host>/<path>
  │
  ├─ 1. RESOLVE host → siteId
  │      • <base36(siteId)>.deploy.suize.io  → base36-decode the subdomain → 0x… siteId
  │      • reserved (www/api/app/dashboard/admin) or apex → 404
  │      • any other host (custom domain)     → suix_getDynamicFieldObject on the
  │                                              DomainRegistry (key 0x1::string::String
  │                                              = host) → siteId   (cached 5 min)
  │
  ├─ 2. READ the Site object  (sui_getObject, showContent; cached ~60 s)
  │      → { quilt_id, manifest_blob_id, manifest_hash }
  │
  ├─ 3. FETCH the manifest blob   GET {WALRUS_AGGREGATOR}/v1/blobs/<manifest_blob_id>
  │      → INTEGRITY 1/2: sha256(bytes) hex === manifest_hash (else 502)   (cached ~60 s)
  │      → parse JSON { v, spaFallback, files: { "/path": {patch, sha256, ct, size} } }
  │
  └─ 4. MAP path → entry → FETCH the patch
         GET {WALRUS_AGGREGATOR}/v1/blobs/by-quilt-patch-id/<patch>
         → INTEGRITY 2/2: on cache-fill, re-hash bytes vs entry.sha256 (else 502)
         → stream with Content-Type = entry.ct, a strong ETag (= entry.sha256),
           immutable far-future cache for fingerprinted assets, no-cache for HTML.
         Unmatched path:
           • with an extension  → /404.html if present, else the worker 404 page
           • without one        → spaFallback (index.html) for client-side routing
```

### Integrity is the differentiator

versui stored a `blob_hash` and never checked it. We verify **twice**:

1. the **manifest blob** against the on-chain `manifest_hash` (so the path→patch
   map itself can't be swapped), and
2. **every served file** against its manifest `sha256` on cache-fill (so a blob
   can't be tampered with at the aggregator).

A mismatch returns **502**, never the bytes. Verified responses carry
`X-Suize-Integrity: verified`.

### gzip handling

The Walrus aggregator can return blobs gzip-compressed **without** a
`Content-Encoding` header, and Workers' `fetch` does **not** auto-decompress.
We detect the gzip magic bytes (`0x1f 0x8b`), decompress to the **original**
bytes, hash *those* (matching the backend, which hashes the original file
bytes), and serve them. Cloudflare re-applies transport compression based on
the visitor's `Accept-Encoding`.

### Caching

`caches.default` (the edge cache) holds three keyed entries:

| key | TTL | content |
|---|---|---|
| `…/site/<siteId>` | ~60 s | resolved `Site` fields |
| `…/manifest/<manifest_blob_id>` | ~60 s | verified, parsed manifest |
| `…/domain/<host>` | 5 min | custom-domain → siteId (positive + negative) |
| `…/blob/<sha256>` | immutable | a verified file's bytes (content-addressed; shared across sites) |

## Caveat — base36 collisions

A base36 subdomain decodes deterministically to a `0x…64-hex` object id, but a
non-existent id simply fails the `sui_getObject` read and returns 502/404. There
is no on-chain "is this one of ours" gate at resolve time; safety comes from the
Site object having to exist and its manifest passing both hashes.

## Operator vars to fill (`wrangler.toml [vars]`)

These are **public** (on-chain ids + public endpoints) — safe to commit. The two
`…_ID` values are **PLACEHOLDERS** until `deploy_sui` is published to testnet
(SPEC §13):

| var | fill with | needed for |
|---|---|---|
| `SUI_RPC_URL` | testnet fullnode (default set) | always |
| `WALRUS_AGGREGATOR` | `https://aggregator.walrus-testnet.walrus.space` (default set) | always |
| `DEPLOY_PACKAGE_ID` | the published `deploy_sui` package id | recorded only (not read at runtime yet) |
| `DOMAIN_REGISTRY_ID` | the shared `DomainRegistry` object id | **custom-domain** resolution (subdomains work without it) |

### DNS / routing setup

1. Zone `deploy.suize.io` on the Cloudflare account.
2. Wildcard DNS record `*.deploy.suize.io` (proxied / orange-cloud) → this worker.
3. The route `*.deploy.suize.io/*` is declared in `wrangler.toml`.
4. Custom domains: add a route per linked domain (or enable Cloudflare for SaaS
   custom hostnames — see SPEC §6); the same worker resolves them via the
   `DomainRegistry`.

## Scripts

```bash
bun run typecheck   # tsc --noEmit
bun run dev         # wrangler dev   (local)
bun run deploy      # wrangler deploy (operator, after vars are filled)
```
