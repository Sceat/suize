# Deploy · by Suize

> Part of the **Suize** monorepo: this app is `@suize/deploy` at `apps/deploy`. It
> imports shared on-chain ids + deploy wire types from `@suize/shared`, and talks
> to the unified backend's `deploy` module at `services/backend` (routes
> `POST /deploy`, `GET /sites`, `GET /sites/:id`, `POST /domains`,
> `DELETE /domains/:domain`). Built in the **Crash-by-Suize** design palette so it
> reads as part of the same suite.

**Suize Deploy is an agent-native "Vercel for Sui."** An agent (or a human here in
the dashboard) POSTs a **built static site**; the backend uploads it to **Walrus**
as one quilt, writes a tiny on-chain **Site** object, and serves it at
`https://<base36(siteId)>.deploy.suize.io`. The backend's own **service wallet**
pays SUI (gas) + WAL (storage) — the agent signs nothing and holds nothing. **No
payments in the MVP** (the open route is the seam future billing hangs off).

This app is the **dashboard**: list/manage your sites, link custom domains, and
do a manual drag-drop deploy for testing. See `docs/deploy/SPEC.md` for the full
multi-component spec (Move package, backend module, Cloudflare worker, this UI).

## Screens

- **Sites list** — cards showing each site's name, **live URL** (one-tap copy),
  version, size, file count, created date, and any linked custom domains. Real
  fetch via `GET /sites` (scoped to `?owner=<addr>` when you're signed in and
  flip to "My sites").
- **Site detail** — the live URL + copy, on-chain meta (site id, owner, size,
  files), linked domains with **unlink**, and an **Add domain** flow: it calls
  `POST /domains` and surfaces the DNS **TXT ownership challenge** (name + value)
  plus the **CNAME** target the user adds at their registrar. The backend
  verifies the TXT then completes the on-chain `link_domain`.
- **Deploy (manual)** — **drag-drop a built folder** (or pick one): the dashboard
  packs it into a single `site.tar` **client-side** (a dependency-free ustar
  writer in `src/pack.ts`) and POSTs it to the same `/deploy` route agents use,
  then shows the resulting live URL + tx digest.

## Immutable deploys (honesty note)

Every deploy mints a **fresh, immutable `Site`** (new object id → new subdomain
and URL). There is **no overwrite/update path** in the MVP — a "re-deploy" is
just a new site, and a custom domain re-links to the new site id. This is what
makes the open (no-auth) route safe: nobody can clobber an existing site. The
dashboard never fabricates site data — when the backend is absent it shows calm
empty/loading/error states (e.g. "Backend offline", "Deploy not configured").

## Optional Suize-wallet login

Sign in with **Google (zkLogin)** via **Enoki** — or connect any testnet wallet
(Slush) — to scope the list to **your** sites (`owner = your address`). The
deploy route stays **open**; login is **read-only attribution only** (no gas, no
sponsorship — the backend pays for deploys). Without Enoki keys the app falls
back to the standard dapp-kit connect button and shows all sites. It never
crashes on missing keys.

## Stack

| Layer | Choice |
|---|---|
| Framework | React 19 + TypeScript + Vite 6 |
| Fetching | `@tanstack/react-query` (graceful empty/loading/error) |
| Auth (optional) | `@mysten/enoki` (Google zkLogin) + `@mysten/dapp-kit` |
| Sui SDK | `@mysten/sui` (Enoki client only) |
| Shared types/ids | `@suize/shared` (`DeployResponse`, `SiteInfo`, `DomainChallengeResponse`, `PACKAGE_IDS.DEPLOY`) |
| Tar packing | dependency-free ustar writer (`src/pack.ts`) |
| Design | Crash-by-Suize palette (Space Grotesk / Martian Mono / Newsreader; blue-on-white broadsheet + dark theme) |
| Runtime / manager | **bun** |

## Backend contract (what this app calls)

All wire types come from `@suize/shared` (single source of truth):

| Method + path | Body | Returns |
|---|---|---|
| `POST /deploy` | multipart: `name`, `site.tar`, optional `owner` | `DeployResponse` `{ siteId, subdomain, url, version, digest }` |
| `GET /sites` | `?owner=` (optional) | `SiteInfo[]` |
| `GET /sites/:id` | — | `SiteInfo` `{ siteId, name, owner, url, sizeBytes, fileCount, createdAtMs, domains[] }` |
| `POST /domains` | `{ siteId, domain }` | `DomainChallengeResponse` `{ domain, status, txtName, txtValue, cname }` |
| `DELETE /domains/:domain` | — | `{ status }` |

The route is **open** (no auth in the MVP). The backend module **503s** until its
deploy service wallet (`DEPLOY_WALLET_PRIVATE_KEY`) is set — the dashboard
surfaces that as a "Deploy not configured" state rather than an error wall.

## Configure

```bash
cp .env.example .env
# VITE_DEPLOY_API_URL=          # defaults to http://localhost:8080
# VITE_ENOKI_API_KEY=           # optional — only to scope "your sites"
# VITE_GOOGLE_CLIENT_ID=        # optional — Google zkLogin login
```

`VITE_DEPLOY_API_URL` points at the unified backend's deploy module (default
`http://localhost:8080`). In prod the backend is **one host** for sponsor + api +
deploy (e.g. `https://api.suize.io`).

## Run it

From the monorepo root (`~/dev/sui/suize`), `bun install` once links the
workspace. Then, to exercise the live deploy path, run the backend too:

```bash
# terminal 1 — the unified backend (deploy module needs DEPLOY_WALLET_PRIVATE_KEY)
cd services/backend && bun run start

# terminal 2 — the Deploy dashboard
cd apps/deploy && bun run dev          # Vite dev server, http://localhost:5183
```

Without the backend the dashboard still loads and renders its empty/loading/error
states (it never fabricates site data).

Type check / build:

```bash
bun run typecheck   # tsc --noEmit  (0 errors)
bun run build       # tsc -b && vite build -> dist/
```

## Architecture notes

- **`src/api.ts`** — the real backend client (correct paths/shapes per SPEC §7),
  base URL from `VITE_DEPLOY_API_URL`. Surfaces `status: 0` (backend offline) and
  `503` (deploy module unconfigured) as typed errors so the UI degrades calmly.
- **`src/pack.ts`** — packs the dropped folder into the `site.tar` the backend
  expects, with no third-party tar/zip dependency (a small POSIX ustar writer).
- **`src/config.ts`** — re-exports `PACKAGE_IDS.DEPLOY` from `@suize/shared`. The
  `deploy_sui` Move package is **not yet published**, so the id is a `'0x0'`
  PLACEHOLDER; the dashboard shows a "Chain pending" banner until it ships (it
  never signs with these — the backend's service wallet does).
- **Design** — `src/styles.css` ports the Crash token system verbatim (light
  blue-on-white broadsheet + a dark-theme token flip) and adds `.dx-*` component
  classes for the dashboard chrome. Same triad fonts as Crash.
