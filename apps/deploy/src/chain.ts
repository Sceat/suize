import type { EventId, SuiJsonRpcClient } from '@mysten/sui/jsonRpc'
import type { SiteInfo } from '@suize/shared'
import { PACKAGE_IDS } from '@suize/shared'
import { DEPLOY_BASE_DOMAIN } from './config'

// ============================================================================
// ON-CHAIN READER — the dashboard's list + detail read DIRECTLY from the Sui
// chain, never the backend. The data is all on-chain (a `Site` object per deploy
// + `SiteCreated` / `DomainLinked` / `DomainUnlinked` events), so browsing must
// work with the deploy backend completely offline. The backend stays the writer
// only (POST /deploy + domain link/unlink need its service wallet).
//
// Source of truth for the shapes we parse:
//   packages/move-deploy/sources/site.move
//     event SiteCreated { site_id: ID, owner: address, name: String,
//                         size_bytes: u64, file_count: u64 }
//     struct Site { owner, name, quilt_id, manifest_blob_id, manifest_hash,
//                   version, size_bytes, file_count }
//   packages/move-deploy/sources/domain_registry.move
//     event DomainLinked   { domain: String, site_id: ID }
//     event DomainUnlinked { domain: String }
//
// The SuiClient comes from dapp-kit's useSuiClient() (testnet fullnode), so the
// reader shares the app's one configured client — no second RPC pool.
// ============================================================================

const PKG = PACKAGE_IDS.DEPLOY.PACKAGE
const SITE_CREATED_TYPE = `${PKG}::site::SiteCreated`
const DOMAIN_LINKED_TYPE = `${PKG}::domain_registry::DomainLinked`
const DOMAIN_UNLINKED_TYPE = `${PKG}::domain_registry::DomainUnlinked`

// ---- base36 ↔ object id (BYTE-IDENTICAL to the worker + backend) -----------
// A 256-bit value's largest base36 form is exactly 50 chars; the worker LEFT-PADS
// every subdomain to 50 with '0' so the round-trip is exact. Mirror it verbatim
// (services/deploy-worker/src/index.ts: BASE36_OBJECT_ID_WIDTH = 50).
const BASE36_OBJECT_ID_WIDTH = 50

export const encode_site_subdomain = (siteId: string): string => {
  const hex = siteId.startsWith('0x') ? siteId.slice(2) : siteId
  return BigInt('0x' + hex)
    .toString(36)
    .padStart(BASE36_OBJECT_ID_WIDTH, '0')
}

// The free live URL for a site id: `<base36(siteId)>.<DEPLOY_BASE_DOMAIN>`.
export const site_url = (siteId: string): string =>
  `https://${encode_site_subdomain(siteId)}.${DEPLOY_BASE_DOMAIN}`

// ---- Event parsedJson shapes (exactly the Move event fields) ---------------

interface SiteCreatedJson {
  site_id: string
  owner: string
  name: string
  size_bytes: string | number
  file_count: string | number
}

interface DomainLinkedJson {
  domain: string
  site_id: string
}

interface DomainUnlinkedJson {
  domain: string
}

// A SiteCreated event mapped to the SiteInfo wire shape the UI already renders.
// `domains: []` here — the list keeps it lean (domains are a detail-view concern).
const to_site_info = (
  json: SiteCreatedJson,
  timestampMs: string | null | undefined,
): SiteInfo => ({
  siteId: json.site_id,
  owner: json.owner,
  name: json.name,
  url: site_url(json.site_id),
  sizeBytes: Number(json.size_bytes),
  fileCount: Number(json.file_count),
  createdAtMs: timestampMs != null ? Number(timestampMs) : 0,
  domains: [],
})

// ---- Public feed / your sites ----------------------------------------------

// All SiteCreated events, newest-first, capped. When `owner` is set, filter to
// that deployer's sites (mirrors the old GET /sites?owner= scoping, but on-chain).
export const fetch_sites_onchain = async (
  client: SuiJsonRpcClient,
  opts: { owner?: string | null; limit: number },
): Promise<SiteInfo[]> => {
  const page = await client.queryEvents({
    query: { MoveEventType: SITE_CREATED_TYPE },
    order: 'descending',
    // Over-fetch when filtering by owner so the post-filter cap can still fill.
    limit: opts.owner ? Math.max(opts.limit * 4, 50) : opts.limit,
  })

  const sites = page.data
    .map(e => to_site_info(e.parsedJson as SiteCreatedJson, e.timestampMs))
    .filter(s => (opts.owner ? s.owner === opts.owner : true))

  return sites.slice(0, opts.limit)
}

// ---- One site's detail ------------------------------------------------------

// The `Site` object fields + createdAtMs (from the matching SiteCreated event) +
// the site's CURRENT linked domains (best-effort, reduced from Domain events).
export const fetch_site_onchain = async (
  client: SuiJsonRpcClient,
  siteId: string,
): Promise<SiteInfo> => {
  const obj = await client.getObject({
    id: siteId,
    options: { showContent: true },
  })

  const content = obj.data?.content
  if (!content || content.dataType !== 'moveObject') {
    throw new ChainNotFoundError(siteId)
  }
  const f = content.fields as Record<string, unknown>

  // createdAtMs + a fallback owner come from the matching SiteCreated event (the
  // object itself carries no timestamp). Best-effort — the object is authoritative.
  const created = await find_site_created(client, siteId)

  return {
    siteId,
    name: typeof f.name === 'string' ? f.name : '',
    owner: typeof f.owner === 'string' ? f.owner : (created?.owner ?? ''),
    url: site_url(siteId),
    sizeBytes: Number(f.size_bytes ?? 0),
    fileCount: Number(f.file_count ?? 0),
    createdAtMs: created?.createdAtMs ?? 0,
    domains: await fetch_site_domains(client, siteId),
  }
}

// Find the SiteCreated event for one site id (for its created timestamp). Scans
// newest-first pages; returns null if not found within a bounded look-back.
const find_site_created = async (
  client: SuiJsonRpcClient,
  siteId: string,
): Promise<{ owner: string; createdAtMs: number } | null> => {
  let cursor: EventId | null = null
  for (let pageNo = 0; pageNo < 5; pageNo++) {
    const page = await client.queryEvents({
      query: { MoveEventType: SITE_CREATED_TYPE },
      order: 'descending',
      cursor,
      limit: 50,
    })
    for (const e of page.data) {
      const j = e.parsedJson as SiteCreatedJson
      if (j.site_id === siteId) {
        return {
          owner: j.owner,
          createdAtMs: e.timestampMs != null ? Number(e.timestampMs) : 0,
        }
      }
    }
    if (!page.hasNextPage || !page.nextCursor) break
    cursor = page.nextCursor
  }
  return null
}

// Best-effort current domains for a site: replay DomainLinked / DomainUnlinked in
// chronological order and keep the domains currently pointing at THIS site. A
// domain re-pointed to another site (linked there) drops off here. If the event
// scan can't complete cleanly, we return [] (the free subdomain always works).
const fetch_site_domains = async (
  client: SuiJsonRpcClient,
  siteId: string,
): Promise<string[]> => {
  try {
    const linked = await query_all_events<DomainLinkedJson>(
      client,
      DOMAIN_LINKED_TYPE,
    )
    const unlinked = await query_all_events<DomainUnlinkedJson>(
      client,
      DOMAIN_UNLINKED_TYPE,
    )

    // domain -> the site it currently points at (last link wins); an unlink with
    // a newer timestamp than the last link clears it.
    const linkTime = new Map<string, { site: string; at: number }>()
    for (const { json, at } of linked) {
      const prev = linkTime.get(json.domain)
      if (!prev || at >= prev.at) linkTime.set(json.domain, { site: json.site_id, at })
    }
    const unlinkTime = new Map<string, number>()
    for (const { json, at } of unlinked) {
      const prev = unlinkTime.get(json.domain)
      if (prev == null || at >= prev) unlinkTime.set(json.domain, at)
    }

    const current: string[] = []
    for (const [domain, link] of linkTime) {
      const unlink = unlinkTime.get(domain)
      const stillLinked = unlink == null || link.at > unlink
      if (stillLinked && link.site === siteId) current.push(domain)
    }
    return current.sort()
  } catch {
    return []
  }
}

// Page through ALL events of a type, oldest-first, returning {json, at(ms)}.
const query_all_events = async <T>(
  client: SuiJsonRpcClient,
  type: string,
): Promise<{ json: T; at: number }[]> => {
  const out: { json: T; at: number }[] = []
  let cursor: EventId | null = null
  for (let pageNo = 0; pageNo < 10; pageNo++) {
    const page = await client.queryEvents({
      query: { MoveEventType: type },
      order: 'ascending',
      cursor,
      limit: 50,
    })
    for (const e of page.data) {
      out.push({
        json: e.parsedJson as T,
        at: e.timestampMs != null ? Number(e.timestampMs) : 0,
      })
    }
    if (!page.hasNextPage || !page.nextCursor) break
    cursor = page.nextCursor
  }
  return out
}

// ---- SuiNS handle resolve (display only) -----------------------------------
// An onboarded Suize user has an on-chain SuiNS reverse record, so the testnet
// fullnode resolves their address back to one or more dotted names. The one
// ending in `.suize.sui` is their Suize handle; we display it as `<label>@suize`
// (strip the suffix, append `@suize`). Mirrors the backend's meCore reference
// (services/backend/src/handle/index.ts:213-229). Presentation only — never
// gates anything; any RPC hiccup just falls back to the hex address upstream.

const SUIZE_PARENT_SUFFIX = '.suize.sui'

// address -> `<label>@suize`, or null when the user has no Suize reverse record
// (or the RPC errored). Swallows all errors → null so callers can `?? fmt_id`.
export const resolveSuizeHandle = async (
  address: string,
  client: SuiJsonRpcClient,
): Promise<string | null> => {
  try {
    const { data } = await client.resolveNameServiceNames({
      address,
      format: 'dot',
    })
    const dotted = data.find(n => n.endsWith(SUIZE_PARENT_SUFFIX))
    if (!dotted) return null
    const label = dotted.slice(0, -SUIZE_PARENT_SUFFIX.length)
    return `${label}@suize`
  } catch {
    return null
  }
}

// A typed "site object not on chain" error so the UI can show a calm 404 state.
export class ChainNotFoundError extends Error {
  status = 404
  constructor(public siteId: string) {
    super(`Site not found on chain: ${siteId}`)
    this.name = 'ChainNotFoundError'
  }
}
