# deploy_sui — on-chain manifest + custom-domain registry for Suize Deploy

The Move package behind **Suize Deploy** (the agent-native "Vercel for Sui").
Build to `docs/deploy/SPEC.md` §3 — this README references it, never redeclares
it. An agent POSTs a built static site; the backend's **deploy service wallet**
uploads it to Walrus as one quilt + a manifest blob, then records an immutable
on-chain `Site` here and serves it at `https://<base36(siteId)>.deploy.suize.io`.

This package is intentionally **framework-only**: it calls nothing beyond the
Sui framework (`object` / `transfer` / `event` / `table`). No vendored protocol
deps (unlike `move-crash`, which vendors DeepBook Predict).

## Modules

### `version` — the upgrade gate (mirror of `crash_sui::version`)

A single shared `Version { id, value: u64 }` carries the live package version.
Every state-changing function in `site` + `domain_registry` takes `&Version` and
calls `assert_version()` first, so a stale code path can be locked out after an
upgrade. `init` creates + shares the singleton at `PACKAGE_VERSION` (value `1`)
and hands the `AdminCap` to the publisher (the deploy service wallet). The
cap-gated lifecycle (`migrate` / `freeze_version`) lives here and is **not**
version-gated, so admin recovery always works even while frozen.

```move
public struct Version has key { id: UID, value: u64 }              // shared
public struct AdminCap has key, store { id: UID }                  // publisher-held

public fun assert_version(self: &Version)                          // aborts EWrongVersion (0)
public fun value(self: &Version): u64
public fun migrate(_: &AdminCap, self: &mut Version)               // lift after upgrade
public fun freeze_version(_: &AdminCap, self: &mut Version)        // emergency freeze (value -> 0)
```

> `freeze` is a reserved name in Move, hence `freeze_version`.

### `site` — one immutable manifest per deploy

Every `POST /deploy` mints a **fresh** shared `Site`. **Identity = the object
id** — no `{owner, name}` determinism, no `update_site`. A "re-deploy" is a brand
-new `Site` at a new id → new URL; this is what makes the open, no-auth deploy
route safe (nobody can clobber an existing site). `owner` is best-effort
ATTRIBUTION only (the deployer's address, or the service wallet) — NOT Sui
ownership, grants no authority.

```move
public struct Site has key {                  // SHARED (worker reads it to serve)
    id: UID,
    owner: address,             // attribution only
    name: String,               // human label (NOT an identity key)
    quilt_id: String,           // Walrus root quilt id
    manifest_blob_id: String,   // Walrus blob: path -> quilt-patch manifest
    manifest_hash: vector<u8>,  // sha256 of the manifest blob (serve-time integrity)
    version: u64,               // always 1 in the MVP (immutable deploys)
}
public struct SiteAdminCap has key, store { id: UID, site_id: ID }  // deploy-wallet-held

// event: SiteCreated { site_id, owner, name }

// asserts version, mints + SHARES the Site (version field = 1), emits
// SiteCreated, returns the SiteAdminCap to the caller (the service wallet).
public fun create_site(
    v: &Version, name: String, owner: address,
    quilt_id: String, manifest_blob_id: String, manifest_hash: vector<u8>,
    ctx: &mut TxContext,
): SiteAdminCap
```

On-chain state is **O(1) per deploy**: just the three Walrus references + the
manifest hash — never the file list (that lives in the off-chain manifest blob,
integrity-bound by `manifest_hash`).

### `domain_registry` — the one global `domain -> site id` map

One shared `DomainRegistry` (created + shared in `init`). The Cloudflare worker
resolves a custom domain by looking it up here to find the `Site` to serve. DNS
ownership is verified **off-chain** by the backend (a `_suize-verify` TXT
challenge) **before** `link_domain` is called; the on-chain check is the
cap↔site binding, so a `SiteAdminCap` can only map a domain to ITS OWN site, and
only unlink a domain currently pointing at its own site. The cap is
backend-held — the deploy service wallet is the only writer.

```move
public struct DomainRegistry has key { id: UID, domains: Table<String, ID> }  // shared, global

// events: DomainLinked { domain, site_id }  ·  DomainUnlinked { domain }

public fun link_domain(v: &Version, reg: &mut DomainRegistry, cap: &SiteAdminCap, site: &Site, domain: String)
public fun unlink_domain(v: &Version, reg: &mut DomainRegistry, cap: &SiteAdminCap, domain: String)
public fun contains(reg: &DomainRegistry, domain: String): bool
public fun site_id_of(reg: &DomainRegistry, domain: String): ID
```

## Abort codes (public contract — never renumber)

| Module | Constant | Code | Meaning |
| ------ | -------- | ---- | ------- |
| `version` | `EWrongVersion` | `0` | shared `Version` mismatches the running code (frozen, or awaiting `migrate`) |
| `domain_registry` | `EDomainTaken` | `0` | domain already linked — `unlink_domain` first to re-point |
| `domain_registry` | `EWrongCap` | `1` | `SiteAdminCap` not bound to the `site` (link) / linked site (unlink) |
| `domain_registry` | `ENoSuchDomain` | `2` | `unlink_domain` for a domain not in the registry |

> Codes are scoped per module, so `EWrongVersion` (version) and `EDomainTaken`
> (domain_registry) both being `0` is unambiguous — a Move abort carries the
> module address + name alongside the code.

## Move targets (for `@suize/shared` PACKAGE_IDS.DEPLOY)

After publish (gated — SPEC §13), the package id replaces the `0x0` placeholder
in `@suize/shared`. The state-changing targets are:

```
<DEPLOY_PACKAGE>::site::create_site
<DEPLOY_PACKAGE>::domain_registry::link_domain
<DEPLOY_PACKAGE>::domain_registry::unlink_domain
<DEPLOY_PACKAGE>::version::migrate
<DEPLOY_PACKAGE>::version::freeze_version
```

The backend's deploy service wallet calls these **directly** (it pays its own
gas — **no Enoki sponsor** in the MVP, unlike Crash). The two shared objects the
backend + worker reference: the `Version` (`DEPLOY_VERSION_OBJECT`) and the
`DomainRegistry` (`DEPLOY_DOMAIN_REGISTRY_OBJECT`), both `0x0` placeholders in
`@suize/shared` until publish.

## Building / testing

```bash
cd packages/move-deploy
sui move build   # exit 0; the [NOTE] about auto-injected deps is expected (we pin Sui explicitly)
sui move test    # 10 tests pass
```

Test coverage (`tests` live alongside each module):

- **`version`** — `init` shares Version + gives AdminCap; `assert_version` pass
  at current; abort `EWrongVersion` when frozen; `migrate` guard rejects when
  already current.
- **`site`** — `create_site` happy path (shares the Site, exactly one
  `SiteCreated` event, all fields + cap binding verified); abort `EWrongVersion`
  when the gate is frozen.
- **`domain_registry`** — `link_domain` happy path; abort `EDomainTaken` on a
  double link; `unlink_domain` happy path; abort `EWrongCap` when linking with a
  cap bound to a different site.

Build is fully offline/reproducible. The Sui framework + MoveStdlib are pinned to
`framework/testnet` (MoveStdlib is pulled transitively as a dep of Sui).

## Files

- `Move.toml` — manifest (`deploy_sui`, edition `2024.beta`, framework `testnet`).
- `Published.toml` — publish-metadata stub (no `[published.testnet]` yet —
  publishing is gated, SPEC §13).
- `sources/version.move` — the upgrade gate (Version object, AdminCap,
  `assert_version`, `init`, `migrate`/`freeze_version`) + 4 tests.
- `sources/site.move` — `Site` + `SiteAdminCap`, `create_site`, `SiteCreated`,
  read accessors + 2 tests.
- `sources/domain_registry.move` — `DomainRegistry`, `link_domain` /
  `unlink_domain`, `DomainLinked`/`DomainUnlinked`, read accessors + 4 tests.
