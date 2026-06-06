# Suize Deploy — MVP Spec

> **Multi-agent consensus document.** Single source of truth for every component (Move, backend, worker, UI). Every build agent reads this first and builds to *these* contracts — no drift. Keep it simple; payments are deliberately out of scope.

**One line:** an agent POSTs a built static site → our backend deploys it to Walrus → it's live at `https://<subdomain>.deploy.suize.io`, with optional custom-domain linkage. The backend's own service wallet pays SUI (gas) + WAL (storage). The agent signs nothing and holds nothing.

---

## 0. Scope

**IN (build now):**
- `POST` a built static site (pre-built files; no build step) → auto-deploy to Walrus.
- Live at a free subdomain `https://<base36(siteId)>.deploy.suize.io`.
- Custom-domain linkage (point `example.com` at a site).
- A dashboard (`deploy.suize.io`) in the **Crash-by-Suize design palette** to view/manage sites.
- Backend **service wallet** funds SUI + WAL.

**OUT (do NOT build now):**
- Payments / subscription / x402 billing.
- Billing from the Suize wallet AI-spending account.
- A build step (we accept only pre-built static output).
- Visitor analytics (we surface *deploy* metadata only).
- Storage auto-renewal loop (fixed generous duration for MVP).
- Site updates / overwrite (each deploy is immutable — see §3).

**Future seam (note, don't build — see §12):** a deploy will later be gated by **either** x402 (agent pays USDC, gasless via the existing sponsor) **or**, if the user is logged in with the Suize wallet, the **AI-spending mandate** pays with a confirmation in a new wallet chat via notification. The MVP keeps an open route + optional `owner` attribution so this slots in without rework.

---

## 1. Actors
| Actor | Responsibility |
|---|---|
| **Agent / dashboard user** | POSTs a built static site. Signs nothing. |
| **Backend `deploy` module** | Orchestrates: unpack → Walrus quilt upload → on-chain Site registration → domain linkage. Custodies the **deploy service wallet** (SUI+WAL). |
| **`deploy_sui` Move package** | On-chain Site manifest + global domain registry. |
| **Walrus** | Stores the site bytes (one quilt) + the manifest blob. |
| **`deploy-worker` (Cloudflare)** | Serves sites: resolves the on-chain manifest, streams bytes from Walrus, re-hashes for integrity. |
| **Dashboard `@suize/deploy`** | Human UI (Crash palette): list/manage sites + domains. |

---

## 2. The deploy flow (one call)
1. Agent → `POST /deploy` (multipart: `name`, `site.tar`, optional `owner` address). **No auth — open route** (payments will gate it later).
2. Backend unpacks; validates (static files; size/file-count caps); per file computes `sha256`, size, content-type.
3. Backend uploads **all files as ONE quilt** (`walrus store-quilt … --json`), funded by the deploy service wallet → per-file `quiltPatchId`.
4. Backend builds a **manifest** JSON (path → {patchId, sha256, ct, size}), uploads it as a Walrus blob → `manifest_blob_id`; computes `manifest_hash = sha256(manifest bytes)`.
5. Backend **creates a fresh `Site` object** with `{ owner?, name, quilt_id, manifest_blob_id, manifest_hash }`, signed by the deploy service wallet (pays its own gas); keeps the returned `SiteAdminCap` (for future domain ops).
6. Returns `{ siteId, subdomain: base36(siteId), url, version: 1, digest }`.

**Immutable deploys:** every POST mints a **new** `Site` (new id → new URL). There is **no overwrite/update path** in the MVP — this is what makes the open route safe (nobody can clobber an existing site). A "re-deploy" is just a new site; a custom domain re-links to the new `siteId` (§6).

---

## 3. On-chain model — `deploy_sui` (Move 2024.beta, framework/testnet)
Mirrors `packages/move-crash` conventions. Abort codes are a public contract.

### module `version` (minimal upgrade gate, mirror crash)
`Version { id, value: u64 }` shared object + `assert_version(&Version)`. Cheap; matches repo convention.

### module `site`
```move
public struct Site has key {
    id: UID,
    owner: address,             // attribution (the deployer; service-wallet addr if none passed). NOT Sui-ownership.
    name: String,               // human label only (NOT an identity key)
    quilt_id: String,           // Walrus root quilt id
    manifest_blob_id: String,   // Walrus blob holding the path->patch manifest
    manifest_hash: vector<u8>,  // sha256 of the manifest blob (serve-time integrity)
    version: u64,               // always 1 in MVP (immutable deploys); reserved for future updates
}
public struct SiteAdminCap has key, store { id: UID, site_id: ID }   // held by the deploy service wallet

// events: SiteCreated { site_id, owner, name }

// create: shares the Site (so the worker + anyone can read it), returns SiteAdminCap to the caller (service wallet)
public fun create_site(v: &Version, name: String, owner: address,
    quilt_id: String, manifest_blob_id: String, manifest_hash: vector<u8>, ctx): SiteAdminCap
```
**Site identity = the object id.** No `{owner,name}` determinism, no `derived_object`. Each deploy → a fresh shared `Site`. (`update_site` is intentionally NOT in the MVP; mutable "projects" are a future feature.)

### module `domain_registry`
```move
public struct DomainRegistry has key { id: UID, domains: Table<String, ID> }  // domain -> site id (one global, shared)

// events: DomainLinked { domain, site_id }  ·  DomainUnlinked { domain }

public fun link_domain(v: &Version, reg: &mut DomainRegistry, cap: &SiteAdminCap, site: &Site, domain: String)  // assert cap.site_id == site.id; abort if domain already taken
public fun unlink_domain(v: &Version, reg: &mut DomainRegistry, cap: &SiteAdminCap, domain: String)
```
DNS-ownership is verified **off-chain by the backend** before calling `link_domain` (§6). The `SiteAdminCap` is backend-held; the backend is the only writer.

---

## 4. Walrus + the manifest
- **Upload (HTTP publisher — no CLI):** the backend PUTs to a Walrus **HTTP publisher** (`PUT <publisher>/v1/quilts?epochs=<DEPLOY_EPOCHS>` for the site quilt — `multipart/form-data`, one part per file named by its quilt identifier; `PUT <publisher>/v1/blobs?epochs=…` raw-body for the manifest). The publisher encodes + signs the storage tx + pays WAL. **Testnet uses the PUBLIC publisher** (`publisher.walrus-testnet.walrus.space`, operator-pays-WAL → the deploy wallet needs only SUI for `create_site` gas); **mainnet** points `WALRUS_PUBLISHER_URL` at a **self-hosted publisher pod** — the SAME HTTP code serves both. (Shelling the `walrus` CLI / in-process `@mysten/walrus` WASM are both avoided.)
- **Manifest blob** (stored on Walrus; hash committed on-chain):
```json
{ "v": 1, "spaFallback": "/index.html",
  "files": {
    "/index.html": { "patch": "<quiltPatchId>", "sha256": "<hex>", "ct": "text/html", "size": 1234 }
  } }
```
- **On-chain stores only** `quilt_id`, `manifest_blob_id`, `manifest_hash` → **O(1) on-chain state per deploy** (versui wrote N resource entries per deploy; we don't).
- **Duration:** fixed `DEPLOY_EPOCHS` (default **30** ≈ ~2 months; testnet epoch ≈ 2 days, max 183). Per-payment durations (X epochs for x402, month-by-month for subscriptions) arrive with payments.

---

## 5. Serving — `deploy-worker` (Cloudflare)
Route `*.deploy.suize.io/*` + linked custom domains.
1. host → subdomain → `base36-decode` → `siteId`; **or** custom domain → `DomainRegistry` lookup → `siteId`.
2. read the `Site` object via Sui RPC (cache ~60s) → fetch the manifest blob from the Walrus aggregator → **verify `sha256(manifest) == manifest_hash`**.
3. request path → manifest entry → fetch `…/v1/blobs/by-quilt-patch-id/<patch>` from the aggregator → **re-hash bytes vs `entry.sha256` (on cache-fill)** → stream with correct content-type; `immutable` cache for fingerprinted assets, `no-cache` for HTML. Unknown path → `spaFallback`.
4. **MVP serves directly from the worker** (Cloudflare-cached). A client-side Service Worker (offline / browser→aggregator) is an optional later optimization.

Aggregator (testnet): `https://aggregator.walrus-testnet.walrus.space`. Reference `versui-worker-proxy/src/index.js` for the resolution/base36/aggregator/caching patterns — but build the **simpler manifest-blob model** (one manifest fetch, not N on-chain resource reads).

**Integrity is the differentiator:** versui stored `blob_hash` and never checked it. We verify the manifest hash *and* re-hash each blob against the manifest.

---

## 6. Domain linkage
- **Subdomain (automatic, free):** `https://<base36(siteId)>.deploy.suize.io`.
- **Custom domain** (e.g. `example.com`):
  1. User requests link (dashboard/API) → backend issues a DNS **TXT challenge** (`_suize-verify.example.com = <token>`).
  2. User adds the TXT record **and** a `CNAME example.com → <target>.deploy.suize.io`.
  3. Backend verifies the TXT via DNS lookup → calls `link_domain` on-chain → **provisions SSL via the Cloudflare Custom Hostnames adapter** (see below).
  4. Worker resolves the custom domain via `DomainRegistry`.

**SSL provisioning — the swappable adapter (resolved):** versui did NOT use Cloudflare for SaaS — it just told users to CNAME to `versui.app` and turn on the orange cloud (only works if the customer's domain is already on Cloudflare). For auto-SSL on *any* domain we use **Cloudflare for SaaS / Custom Hostnames** (`POST /zones/{zone}/custom_hostnames`).
- If `CF_API_TOKEN` + `CF_ZONE_ID` are set → backend provisions the custom hostname (auto-SSL) on link.
- If not set → backend still does TXT-verify + on-chain link, and returns **manual CNAME instructions** (customer proxies via CF themselves, versui-style). This is the fallback so the build is never blocked on the add-on.

**Operator note:** enabling Cloudflare for SaaS on the `suize.io` account is what makes "any custom domain just works." Pending owner decision; not a code blocker.

---

## 7. Backend `deploy` module (HTTP API)
A module in the **unified `services/backend`** (honors the locked "ONE backend" decision), mounted via the standard `(handleDeployRoute, deployReady, deployInfo)` trio in `services/backend/src/index.ts`.

| Method + path | Body | Returns |
|---|---|---|
| `POST /deploy` | multipart: `name`, `site.tar`, optional `owner` | `{ siteId, subdomain, url, version, digest }` |
| `GET /sites` | `?owner=` (optional) | list of sites (filtered by owner if given) |
| `GET /sites/:id` | — | site detail (size, domains, createdAt, url) |
| `POST /domains` | `{ siteId, domain }` | `{ status, txtChallenge }` → then verify+link |
| `DELETE /domains/:domain` | — | `{ status }` |

- **Deploy service wallet:** one Ed25519 keypair from env `DEPLOY_WALLET_PRIVATE_KEY` (bech32 `suiprivkey…`). Its **own secret** (repo rule: never reuse keys); the owner may fund the **same address** as the future agent if they want one pot. Holds SUI + WAL; configured for the `walrus` CLI and for signing Site PTBs (`@mysten/sui`). **Module 503s if unset** (like `handle`) so the backend still boots. **No Enoki sponsor in MVP** (the agent doesn't sign; the backend pays its own gas).
- **No auth:** the route is open (payments gate it later). Optional `owner` field is best-effort attribution only.
- **Limits:** max bundle size, max file count, per-IP token-bucket rate limit (reuse the sponsor module's bucket pattern) — abuse mitigation until payments land.
- **Site listing (MVP):** read `SiteCreated` events (filter by `owner`) via the Sui SDK; keep it simple, no heavy indexer.

---

## 8. Dashboard — `apps/deploy` (`@suize/deploy`, Crash palette)
React 19 + Vite, mirrors `apps/crash`. **Reuse the Crash design system verbatim** (fonts: Space Grotesk / Martian Mono / Newsreader; Crash color tokens + `styles.css`) — it must feel like the same product family. Keep the interface simple. Screens:

- **Auth — EXACT same Google login flow as Crash.** Copy `apps/crash`'s Google-zkLogin / Enoki flow 1:1 (same provider stack, same Enoki config, same login button + UX — not a generic "connect wallet"). After login, `owner = the user's zkLogin address`. The deploy route stays OPEN; login only scopes "your sites" and is the seam future payments hang off.
- **Sites list (the home surface)** — a simple list/grid of ALL sites owned by the logged-in address: name, live URL (copyable), size, created, linked domains. A clean empty state that guides a first deploy.
- **Site detail** — live URL + copy, linked domains, "Add domain" flow (TXT-challenge UI), danger zone (unlink).
- **Deploy (manual)** — drag-drop a built folder → `POST /deploy` (the same endpoint agents use), shows the resulting URL.
- **"Deploy from your agent" — a first-class instructions surface (NOT a footnote).** This is a B2A product: any third-party agentic system (Claude, Claude Code, Codex, custom) must be able to deploy with copy-paste clarity. Include:
  - The plain HTTP contract: `POST <deploy-api>/deploy` (multipart `name` + `site.tar`, optional `owner`) → `{ url, siteId, … }`; state plainly that it's **gasless + keyless + open** (no API key today).
  - A copy-paste **curl** example.
  - A copy-paste **TS/JS** snippet an agent can run.
  - A copy-paste **MCP tool / system-prompt spec** so a user can hand Claude Code / Codex a `deploy_site` tool pointed at our API (on-brand with Suize's B2A / MCP thesis).
- **Analytics (MVP):** deploy metadata only (count, last deploy, size). Visitor analytics later.
- **API base:** `VITE_DEPLOY_API_URL` (defaults to the local backend).

---

## 9. Repo layout (new pieces)
| Path | What | Mirrors |
|---|---|---|
| `packages/move-deploy/` (`deploy_sui`) | Move: `version` · `site` · `domain_registry` (+ tests) | `packages/move-crash` |
| `services/backend/src/deploy/` | the HTTP module (mount trio) | `services/backend/src/sponsor` + `handle` |
| `services/deploy-worker/` | Cloudflare Worker (`wrangler.toml`) — NEW workspace type | `versui-worker-proxy` (pattern only) |
| `apps/deploy/` (`@suize/deploy`) | the dashboard | `apps/crash` |
| `packages/shared/src/index.ts` | add `PACKAGE_IDS.DEPLOY` (placeholder id until published) + `DEPLOY_MOVE_TARGETS` + wire types (`DeployResponse`, `SiteInfo`, `DomainInfo`, …) | existing blocks |
| `docs/deploy/` | this SPEC + READMEs per new package/app | `docs/wallet` |

---

## 10. Conventions (locked)
- **Single source of truth:** `NETWORK`, `PACKAGE_IDS`, targets, wire types live ONLY in `@suize/shared`.
- **Move:** edition `2024.beta`, framework pinned `testnet`; abort codes are a public contract (never renumber).
- **Backend module** = `(handleXRoute, xReady, xInfo)` trio, mounted one line in `index.ts`; 503 cleanly when unconfigured.
- **Secrets** env-only, never committed, never in a frontend bundle; never reuse a key across modules.
- **nostub:** no placeholder logic. If a piece can't be finished, **flag it — don't fake it**.

---

## 11. Resolved decisions (was: open questions)
1. **Deploy service wallet:** dedicated `DEPLOY_WALLET_PRIVATE_KEY` (own secret; may fund the same address as the future agent). The agent itself is still a stub — there was no wallet to reuse.
2. **Auth:** OPEN `POST /deploy` (no API key). Optional `owner` attribution. Payments (x402 or wallet-subscription) gate it later.
3. **Cloudflare:** we control `deploy.suize.io`. versui did NOT use CF-for-SaaS. We build TXT-verify + on-chain mapping + worker resolution now; SSL via a CF-Custom-Hostnames adapter (enabled when `CF_API_TOKEN`+`CF_ZONE_ID` set; manual-CNAME fallback otherwise). Owner decides whether to enable CF-for-SaaS — not a code blocker.
4. **Custom domains:** in the MVP, with TXT ownership verification.
5. **Storage:** fixed `DEPLOY_EPOCHS` (default 30) for MVP; per-payment durations later.
6. **Site identity = object id.** Immutable per-deploy; no `{owner,name}` determinism, no update path.

---

## 12. Future seam — payments (DO NOT BUILD; spec'd separately later)
A deploy will later require **either**:
- **x402** — agent pays USDC; gasless via the existing `/sponsor`+`/execute`; payment = authorization; **or**
- **Suize-wallet login** — the AI-spending **mandate** pays the deploy treasury, confirmed in a **new wallet chat via notification** (the wallet's spending account is already a real on-chain caged mandate, scope `Spend`). Because both ends are our backends, we detect the logged-in wallet and route billing through it.

The MVP's open route + optional `owner` (§7, §8) is what these hang off — no rework needed.

---

## 13. Operator setup (post-build, gated)
1. Generate + fund the deploy service wallet (SUI + WAL on testnet); set `DEPLOY_WALLET_PRIVATE_KEY`.
2. Publish `deploy_sui` to testnet (gated, owner-approved); write the package id + `DomainRegistry`/`Version` object ids into `@suize/shared`.
3. Configure `services/deploy-worker` `wrangler.toml` (zone `deploy.suize.io`, `DOMAIN_REGISTRY_ID`, RPC, aggregator) + wildcard DNS `*.deploy.suize.io`.
4. (Optional) enable Cloudflare for SaaS + set `CF_API_TOKEN`/`CF_ZONE_ID` for custom-domain auto-SSL.
