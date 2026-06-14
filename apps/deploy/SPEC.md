# Deploy by Suize — SPEC

> **Anti-drift truth for ONE piece: Deploy by Suize.** The global picture — the two primitives, the one payment rail, custody, network policy, brand laws — lives in the root `CLAUDE.md`. This file owns ONLY Deploy: its pricing model, the `deploy_sui` Move package, the backend `deploy` module, and the `deploy-worker`. State each fact once here; reference `CLAUDE.md` for the rail, never redeclare it.

**Deploy by Suize is the FIRST merchant on the Suize rail** — our own SaaS, the proof that one rail bills both one-off and recurring. An agent (or a human in the dashboard) POSTs a built static site; the backend uploads it to **Walrus** as one quilt + a manifest blob, mints an **immutable on-chain `Site`**, and serves it at `https://<base36(siteId)>.suize.site` with a re-hashed integrity guarantee on every byte. Deploy is the only flagship that goes **MAINNET** (it has no testnet-only dependency).

---

## 1. THE MODEL (owner-locked — replaces the old "$19.99 per single deploy + $1 trial")

Deploy bills through the **x402 V2 rail** in **two distinct shapes — one product proves both** (the rail itself, the gasless settlement, the fee, custody live in `CLAUDE.md` — referenced, never redeclared):

1. **Each deploy = a direct one-off `$0.50` x402 settlement** (vanilla x402 V2 'exact' — the agent signs a gasless Address-Balance `send_funds` PTB, the facilitator verifies + settles it). Deploy is a **FIRST-PARTY** merchant (the merchant IS the Suize treasury), so the deploy requirement is a **SINGLE full-amount output** of the $0.50 to the treasury — no fee split (100% already lands on us). On settlement the site goes live on Walrus **immediately**; the $0.50 covers the deploy + an initial Walrus storage period (`DEPLOY_EPOCHS`, default 30). No subscription is required to ship a site.
2. **The subscription (`$19.99/mo` — PLACEHOLDER, see Open question) unlocks ONLY two things:**
   - **(a) custom domains** — point `example.com` at a site (§5);
   - **(b) auto-renewed Walrus storage** — the user signs a **push-not-pull** storage subscription on the standalone `subs` module (`subscription::create`, `ref` = the site id); each period the WALLET pushes one period via `subscription::renew` (gas-sponsored, user-signed — nobody reaches into the user's funds). The backend's only job is to keep the site's Walrus storage extended on settle (§4). Without the sub, a site lives until its initial storage period lapses, then expires (with warning, never silent).

The rail's **2% (1¢ minimum, merchant-absorbed)** is carved at settlement and visible in the on-chain balance-change set — the fee is in the receipt, not a hidden tax. For the deploy one-off Deploy is first-party (single output, no carve); the storage subscription rides the `subs` module's own 2%/1¢ fee policy (`packages/move-subs/SPEC.md`).

**COGS:** Walrus storage ≈ **`$0.023/GB/mo`** (100 GB ≈ $2.30/mo), paid in **WAL** (not USDC) from the deploy service wallet; Sui gas (pennies) for `create_site`; Cloudflare domain costs (variable, sub-only). Fat margin at typical (<100 GB) usage. *(Confirm exact COGS via `walrus info` on mainnet before the mainnet flip.)*

**IN:** POST a pre-built static site → live subdomain; custom-domain linkage (sub); a dashboard to view/manage sites; a service wallet funding SUI + WAL.
**OUT:** a build step (we accept only pre-built output); visitor analytics (deploy metadata only); site updates / overwrite (every deploy is immutable — §3).

---

## 2. THE CHARGE↔DEPLOY JOIN — **x402 V2 'exact', first-party, KEYLESS** (rewritten 2026-06-12)

Deploy is the **first merchant on the rail**, and the merchant IS the Suize treasury (first-party), so a deploy is a one-off **$0.50 x402 V2 'exact' settlement** with a **single full-amount output** (no fee split — 100% already lands on us). `account.move` is DEAD here. Wiring: `services/backend/src/deploy/payment.ts` + the gate in `index.ts`.

- A payment-less `POST /deploy` answers **402** with the **x402 V2 `PaymentRequired` body + `PAYMENT-REQUIRED` header** (price discovery is public; minted via `@suize/pay`'s `mintPaymentRequired`, facilitator/buildUrl pointed at this process's own origin). The 402's `error` carries the deploy rider: **whoever pays owns the site**; the `payLink` is `pay.suize.io?…&mode=authorize` (no secret).
- The agent builds the gasless `send_funds` payment (`POST /build` with the challenge's `accepts[0].extra.outputs`, or its own PTB), signs **locally**, and retries multipart with the b64 `PaymentPayload` in the **`X-PAYMENT`** header — **the sole authorization, NO separate deploy-auth nonce/signature** (nonce-free since 2026-06-14).
- `gateDeployPayment` (in-process — no HTTP loopback): unb64 the payload → its `accepted` must deep-equal OUR single-output terms → **recoverPayer → the on-chain `owner`** (whoever pays, owns; no payer==owner compare — the payer simply IS the owner) → `doVerify` (simulate-only, exact split). The Walrus work runs on the VERIFIED-but-unsettled payment; then `settleDeployPayment` (`doSettle` — broadcast keyless, idempotent by digest) settles it **immediately before** `create_site`, which records the settled digest in the on-chain **`SiteDigestRegistry`** (one-site-per-payment; a duplicate aborts **`EDigestUsed` → 409**, the multi-replica-safe consume guard — no in-process map). A retry with the same `X-PAYMENT` re-settles idempotently and re-mints only if the prior mint didn't land. No payment → no deploy. The **no-Sui-key door** is the SAME path: the human authorizes via `mode=authorize` (signs-but-doesn't-settle), the agent submits that signed payload as X-PAYMENT, owner = the human. E2E: `deploy.402.e2e.ts` + `deploy.paid.e2e.ts` + `deploy.paylink.e2e.ts`.

**Gate readiness** is now a single async predicate — `chargeGateReady()` = the Deploy treasury (`treasury@suize`, the fee_recipient) resolves. Until it does, the route runs **un-gated** (auth + rate limits + the daily gas-drain ceiling — abuse mitigation, not billing). The moment the treasury resolves, the gate lights up with zero further code change.

**The pipeline itself is PROVEN end-to-end:** it shipped our own landing — tar → Walrus quilt + manifest → on-chain `create_site` → served hash-verified by the worker at `https://50qfse0t2krlxbu9zvbx0xfz8m9ccssa0g7dt8lrx4oopads0c.suize.site` (Site `0xc96dd162…47b9d0c`, 30 epochs). Dogfood: Deploy's first real site is Suize's own front door. The nonce-free agent-pays path is proven on testnet — a fresh agent signs a gasless $0.50, submits it as X-PAYMENT, and the `Site` mints with `owner == the recovered payer`.

**Storage auto-renewal** is a separate, recurring leg on the standalone **`subs` module** (push-not-pull): the user signs a `subscription::create` with `ref` = the site id; each period the WALLET pushes one period via `subscription::renew` (gas-sponsored). The backend never charges — its only job is to keep the site's Walrus storage extended (see §4).

---

## 3. On-chain — `deploy_sui` (`packages/move-deploy`, Move 2024.beta, framework-only)

**Published on testnet** (real `Version` + `DomainRegistry` shared-object ids in `@suize/shared`). 10 tests pass, `sui move build` green. The **mainnet flip is a republish**, not a first publish. Framework-only: calls nothing beyond `object` / `transfer` / `event` / `table` (no vendored protocol deps).

**Modules: THREE** (`version` / `site` / `domain_registry`). The `charge_ledger` + `renewal_registry` modules were **REMOVED 2026-06-12** (the x402 V2 pivot): deploy billing is a keyless x402-exact settlement, and storage auto-renewal rides the standalone `subs` module (no on-chain subscription↔site registry — the join is `subs` event `ref` = the site id). **One-site-per-payment is now ENFORCED ON-CHAIN** (2026-06-14): the `site` module owns a shared **`SiteDigestRegistry { used: Table<vector<u8>, ID> }`** created at publish (its own `init`), and `create_site` records the settled payment digest there + aborts **`EDigestUsed`** on a duplicate — the multi-replica-safe consume guard that replaced the old in-process `settledDeploys` map. The orphaned prior-publish objects are **harmless** (nothing references them); the **mainnet republish** carries the registry.

The three modules (abort codes are a **public contract — never renumber**, scoped per module):

- **`version`** — one shared `Version { value: u64 }` + `assert_version` (called first by every state-changing fn); cap-gated `migrate` / `freeze_version` (the `AdminCap` is publisher/service-wallet-held; lifecycle is NOT version-gated so admin recovery always works). Abort `EWrongVersion = 0`.
- **`site`** — every deploy mints a **fresh, immutable, shared `Site`**. **Identity = the object id** — no `{owner,name}` determinism, no `update_site`, no overwrite. A "re-deploy" is a new `Site` at a new id → new URL; this is what makes the route safe (nobody clobbers a live site). Fields: `owner` (the recovered **payer** — whoever pays, owns; NOT Sui-ownership, grants no authority), `name` (label), `quilt_id`, `manifest_blob_id`, `manifest_hash: vector<u8>` (sha256 of the manifest, the serve-time integrity anchor), `size_bytes` / `file_count` (real metrics, so reads never return 0), `version` (always 1 in MVP). `create_site(_deployer: &DeployerCap, v, reg: &mut SiteDigestRegistry, payment_digest: vector<u8>, …)` is **GATED by the `DeployerCap`** (2026-06-14, Move audit): only the deploy service wallet that holds the single cap can mint a `Site`, so `owner` / `size_bytes` / the blob-object ids are **service-attested** — an attacker cannot forge a Site to (a) host free content on a `*.suize.site` subdomain bypassing the $0.50, or (b) point the storage-renewer at arbitrary Walrus blobs to drain the service wallet's WAL. It then asserts the digest is unseen (`EDigestUsed`) + records it (one-site-per-payment, the atomic on-chain lock), shares the `Site`, emits `SiteCreated { site_id, owner, name, size_bytes, file_count }`, and **returns** the `SiteAdminCap { site_id }` (composable — it does NOT transfer internally; the caller takes ownership). On-chain state is **O(1) per deploy** — three Walrus refs + the hash + one registry entry, never the file list. Abort `EDigestUsed = 0` (the first + only code in `site`; appended, renumbers nothing). **DeployerCap CUSTODY == the mint trust root** — it lives on the prod service wallet (`agent@suize`, alongside the SiteAdminCaps); if that hot key leaks, the holder can mint forged Sites. Acceptable for v1 (that key already signs every deploy tx); post-MVP, hold the cap on a separate cold/multisig address.
- **`domain_registry`** — one global shared `DomainRegistry { domains: Table<String, ID> }` (domain → site id). `link_domain` / `unlink_domain` assert `cap.site_id == site.id`, so a cap can only map a domain to ITS OWN site. DNS ownership is verified **off-chain** (§5) before `link_domain`; the cap is service-wallet-held — the backend is the only writer. Events `DomainLinked { domain, site_id }` / `DomainUnlinked { domain }`. Aborts: `EDomainTaken = 0`, `EWrongCap = 1`, `ENoSuchDomain = 2`.

Move write targets (in `@suize/shared` `PACKAGE_IDS.DEPLOY.TARGETS`): `site::create_site`, `domain_registry::{link_domain, unlink_domain}`, `version::{migrate, freeze_version}`. The service wallet calls these **directly** and pays its own SUI gas — **no Enoki sponsor** (the agent signs nothing in the deploy/site path; unlike Crash, Deploy is not a sponsored surface).

---

## 4. Walrus + the manifest

- **Upload (HTTP publisher — no CLI, no in-process WASM):** the backend PUTs to a Walrus **HTTP publisher** — `PUT <publisher>/v1/quilts?epochs=<DEPLOY_EPOCHS>` (multipart, one part per file, the part **name = the quilt-patch identifier**) for the site quilt; `PUT <publisher>/v1/blobs?epochs=<N>` (raw body) for the manifest. The publisher encodes, signs the storage tx, and **pays the WAL**. **Testnet** uses the public publisher (operator pays WAL → the deploy wallet needs only SUI for `create_site` gas). **Mainnet** points `WALRUS_PUBLISHER_URL` at a **self-hosted publisher** funded with WAL — the same HTTP code serves both.
- **Manifest** (stored on Walrus; its sha256 committed on-chain as `manifest_hash`):
  ```json
  { "v": 1, "spaFallback": "/index.html",
    "files": { "/index.html": { "patch": "<quiltPatchId>", "sha256": "<hex>", "ct": "text/html", "size": 1234 } } }
  ```
- **Duration:** fixed `DEPLOY_EPOCHS` (default **30** ≈ ~1 month at testnet's ~1-day epochs; max 183). The **$0.50** one-off buys this initial window. The **subscription** drives renewal: a deterministic backend extender (`services/backend/src/deploy/extend.ts`) keeps a PAID site's storage extended in place (blob-level `system::extend_blob` — cheap, **no re-upload**, no new write fee; the service wallet pays the WAL). **TWO triggers:** (1) an **on-settle hook** (`notifySettled`, fired fire-and-forget from the sponsor execute path) — a sponsored `subscription::renew`/`create` for the Deploy merchant extends that site's blobs in the same beat; (2) a **safety cron** every `EXTEND_TICK_MS` (default 6h) that pages Deploy-merchant `SubscriptionCreated` events, drops cancelled/lapsed subs, and repairs any near-expiry paid site. Every extend is clamped to ≤50 epochs ahead (the Walrus ~53 ceiling). The site's live storage end-epoch + `expiresAtMs` ride on `GET /sites/:id`. *(The on-demand extend `POST /sites/:id/extend` is a paid one-off $0.50 — same x402 gate.)*

---

## 5. Serving — `deploy-worker` (`services/deploy-worker`, Cloudflare edge)

Serves `*.suize.site` (the worker's `BASE_DOMAIN`; its own zone → free first-level wildcard SSL) + linked custom domains. **`suize.site` is authoritative** for served sites; the dashboard itself stays on `deploy.suize.io`.

Per request:
1. **Resolve host → siteId.** `<base36>.suize.site` → base36-decode the 50-char subdomain → siteId; a **custom domain** → on-chain `DomainRegistry` dynamic-field lookup → siteId. Reserved subdomains (`www`, `api`, `app`, `dashboard`, `admin`) and the apex never map to a site.
2. Read the on-chain `Site` → fetch the manifest blob from the Walrus aggregator. Both are **immutable by construction** (a deploy mints a fresh `Site`; no `&mut Site` entry point exists; blob ids are content-derived) so both are edge-cached for a year.
3. **Double-hash integrity — the differentiator:**
   - **1/2** — `sha256(manifest bytes) == Site.manifest_hash` (else **502**, never the bytes);
   - **2/2** — `sha256(every served file) == its manifest entry sha256` on cache-fill (else **502**).
   - On success every response carries the header **`X-Suize-Integrity: verified`**. (Walrus may gzip blobs without a `Content-Encoding`; the worker normalises to the original bytes so the re-hash matches the backend's hash over the original file.)
4. Path → manifest entry → stream with the right content-type + `immutable` cache for fingerprinted assets, `no-cache` for HTML; the sha256 is a perfect strong ETag (304 on `If-None-Match`). Unmatched extensionless route → `spaFallback`; unmatched asset → `/404.html` if present, else 404.
5. **Latency (a cold Walrus read is a multi-second sliver reconstruct — 10–20s first loads observed before this layer existed):** blobs load **edge cache → R2 (`BLOB_CACHE` bucket) → aggregator**, content-addressed by sha256 (a hit can never be stale; no invalidation path) and re-hashed on every fill. A cold manifest fill **background-warms every entry** (`waitUntil`, capped at 30 files) into edge + R2, the backend fires one warm GET at the site right after `create_site`, and HTML responses carry `Link: rel=preload` hints (`crossorigin`, matching Vite's emitted request modes) for the entry JS/CSS/fonts.

Public config only (no secrets in the worker): `SUI_RPC_URL`, `WALRUS_AGGREGATOR`, `DEPLOY_PACKAGE_ID` (operator record), `DOMAIN_REGISTRY_ID` (required for custom-domain resolution), plus the `BLOB_CACHE` R2 binding (one `suize-deploy-blob-cache` bucket, safely shared across testnet/mainnet — keys are content hashes). The base36 codec is **byte-identical** to the backend's (`services/backend/src/deploy/base36.ts`, fixed 50-char width) so encode/decode round-trips exactly.

---

## 6. Backend `deploy` module (`services/backend/src/deploy/`, HTTP-only)

A module in the **unified `services/backend`**, mounted via the standard route-matcher (`handleDeployRoute` + `deployReady` + `deployInfo`). 503s cleanly when `DEPLOY_WALLET_PRIVATE_KEY` is unset, and also when the on-chain ids are `0x0` placeholders (it detects that and 503s with a precise reason rather than building a doomed PTB — though on testnet the ids are now real).

| Method + path | Body | Returns |
|---|---|---|
| `POST /deploy` | multipart: `name`, `site.tar` + `X-PAYMENT` header (the signed gasless payment — the sole auth) | `DeployResponse { siteId, subdomain, url, version, digest }`; **402** (x402 V2 `PaymentRequired` + `PAYMENT-REQUIRED` header) when unpaid; **409** on a double-submit of a payment that already minted a site |
| `GET /sites` | `?owner=<addr>` (optional) | `SiteInfo[]` |
| `GET /sites/:id` | — | `SiteInfo` (+ live `storageEndEpoch` / `expiresAtMs`) |
| `POST /sites/:id/extend` | `X-PAYMENT` header (paid one-off $0.50; payer must == `Site.owner`) | `{ siteId, digest, storageEndEpoch, expiresAtMs }`; **402** when unpaid / not owner |
| `POST /domains` (`?verify=0`) | `{ siteId, domain }` | `DomainChallengeResponse` (issues the TXT challenge) |
| `POST /domains?verify=1` | `{ siteId, domain, ts, signature }` | verifies TXT + CNAME, links on-chain |
| `DELETE /domains/:domain` | `{ ts, signature }` | `{ status }` |

- **Auth = the payment** (nonce-free since 2026-06-14): there is **no anonymous deploy** and **no separate deploy-auth signature**. The `X-PAYMENT` header carries a signed gasless payment; the backend **recovers the payer** (`recoverPayer` — zkLogin, Ed25519, OR a 1-of-2 sub-account MultiSig) and uses it **as the on-chain `owner`** — no client-claimed `owner`, no service-wallet fallback, so a caller can only ever set THEMSELVES (the address that paid) as owner. **Whoever pays, owns.** Reads (`/sites`) are open.
- **Deploy service wallet:** one Ed25519 keypair from `DEPLOY_WALLET_PRIVATE_KEY` (its **own** secret — never reuse a key). Holds SUI (+ WAL on mainnet for the self-hosted publisher). Signs `create_site` / `link_domain` / `unlink_domain`.
- **Abuse limits (until the charge join gates the route):** per-IP token bucket + a process-global **daily gas-drain ceiling** (every deploy mints a real on-chain Site on the wallet's SUI) → 429 before any chain/Walrus work; bundle caps (100 MiB tar, 2000 files, 64-char name); tar-traversal rejection.
- **Site listing** reads `SiteCreated` events (filter by `owner` client-side; size/file-count ride on the event); per-site domains come from the `DomainLinked`/`DomainUnlinked` log (latest event per domain wins). No heavy indexer.
- **Domain linkage (sub-gated):** a **two-record DNS gate** — TXT (`_suize-verify.<domain>` = a random CSPRNG token, never derived from the signing key) proves ownership; CNAME (`<domain>` → `<base36(siteId)>.suize.site`) proves routing — both required before `link_domain` so we never link a domain that won't serve. Link AND unlink also require a **cryptographic owner signature** — op-bound + **stateless-timestamped** (`{ ts, signature }`: the client picks a fresh `ts`, the backend recovers the signer == `Site.owner` and accepts `ts` within a freshness window; **NO server-issued nonce store** — multi-replica-safe, a within-window replay is owner-gated + on-chain-idempotent). DNS control alone is not enough. Auto-SSL via a **Cloudflare-for-SaaS** adapter when `CF_API_TOKEN` + `CF_ZONE_ID` are set; **manual-CNAME fallback** otherwise (never a build blocker).

---

## 7. Dashboard — `apps/deploy` (`@suize/deploy`)

React 19 + Vite + `@tanstack/react-query`, in the **Crash-by-Suize design palette** (Space Grotesk / Martian Mono / Newsreader; blue-on-white broadsheet + dark theme) so the suite reads as one family. Hosted on `deploy.suize.io` (the dashboard host — distinct from `suize.site` where sites are served). Screens: **Sites list** (cards: name, live URL with copy, size, files, created, linked domains; `?owner` scope when signed in), **Site detail** (live URL, on-chain meta, linked domains + unlink, an Add-domain TXT-challenge flow), **Deploy (manual)** (drag-drop a built folder → packed to `site.tar` client-side via a dependency-free ustar writer in `src/pack.ts` → the same `/deploy` agents use), and an **Agents view** (the B2A surface: the plain HTTP contract + copy-paste curl / TS / MCP snippets — a first-class instructions surface, not a footnote).

**Optional login:** Google zkLogin via Enoki (or any testnet wallet) — read-only attribution to scope "your sites" today, and the seam the charge gate hangs off. The app never fabricates data: backend-absent / unconfigured states render calm empty/loading/error UI.

---

## 8. Network & mainnet

Deploy goes **MAINNET** (no testnet-only dependency, unlike Crash). The mainnet flip is: republish `deploy_sui` (the testnet ids → mainnet ids in `@suize/shared`); flip the backend `deploy` client + worker to mainnet RPC + mainnet Walrus aggregator/publisher; fund the deploy wallet with **WAL** (the one thing that bites if forgotten — Walrus writes are WAL-denominated) + SUI; pin the native USDC coin type. The mainnet gate + sequencing live in the root `CLAUDE.md` (LOCKED #12; the old `docs/MAINNET_CHECKLIST.md` is deleted with the rest of `docs/`).

**Single source of truth:** `NETWORK`, `PACKAGE_IDS`, Move targets, and all wire types live ONLY in `@suize/shared`. No app/service/worker hardcodes a package id or network.

---

## L3 (the deploy URL domain) — RESOLVED (verified 2026-06-10)

Runtime, types, and docs now agree on **`suize.site`** for served sites: the backend builds URLs from `config.deployBaseDomain` (default `suize.site`), the worker serves `suize.site`, and `@suize/shared`'s `DeployResponse` JSDoc reads `https://<base36(siteId)>.suize.site`. (The dashboard host `deploy.suize.io` is correct and intentional — only served-site URLs were ever in question.)

---

**Open question for the owner:** the subscription price is a **placeholder `$19.99/mo`** — confirm or lower it (the one-off deploy is locked at `$0.50`).
