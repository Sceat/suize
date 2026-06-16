import type { EventId, SuiJsonRpcClient } from '@mysten/sui/jsonRpc'
import { parseSerializedSignature } from '@mysten/sui/cryptography'
import { MultiSigPublicKey } from '@mysten/sui/multisig'
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

// ---- "Your sites" = your main address ∪ your agent sub-account(s) -----------
//
// An agent deploys from its SUB-ACCOUNT — a 1-of-2 multisig { main, agent } — so
// those sites are owned by the sub-account ADDRESS, not your main address, and a
// plain `owner === main` filter hides them (the "No sites yet" bug). The link is
// purely ON-CHAIN (never localStorage): the sub-account signs its gasless payment
// with the multisig, and that serialized signature embeds the FULL committee. So
// for each non-main site owner we read ONE transaction it sent, parse the multisig
// committee, and keep the owner iff YOUR main address is a member. The signature
// IS the link — no paste, no stored state.

const MY_SITES_EVENT_PAGES = 3 // newest-first SiteCreated pages to scan (×50)
const SUBACCT_CHECK_CAP = 24 // max distinct non-main owners we committee-check

interface RawSiteEvent {
  json: SiteCreatedJson
  timestampMs: string | null | undefined
}

// Newest-first SiteCreated events across up to `pages` pages of 50.
const recent_site_events = async (
  client: SuiJsonRpcClient,
  pages: number,
): Promise<RawSiteEvent[]> => {
  const out: RawSiteEvent[] = []
  let cursor: EventId | null = null
  for (let p = 0; p < pages; p++) {
    const page = await client.queryEvents({
      query: { MoveEventType: SITE_CREATED_TYPE },
      order: 'descending',
      cursor,
      limit: 50,
    })
    for (const e of page.data) {
      out.push({ json: e.parsedJson as SiteCreatedJson, timestampMs: e.timestampMs })
    }
    if (!page.hasNextPage || !page.nextCursor) break
    cursor = page.nextCursor
  }
  return out
}

// Is `candidate` an agent sub-account whose multisig committee includes `main`?
// Reads ONE transaction the candidate SENT (its gasless payment is multisig-signed)
// and checks committee membership. A zkLogin member's address derives structurally
// (no proof check needed for an address). Any read/parse failure → false, so this
// NEVER yields a false positive (a site you don't control can't show as yours).
const subaccount_includes_main = async (
  client: SuiJsonRpcClient,
  candidate: string,
  main: string,
): Promise<boolean> => {
  try {
    const page = await client.queryTransactionBlocks({
      filter: { FromAddress: candidate },
      options: { showInput: true },
      order: 'descending',
      limit: 1,
    })
    for (const tx of page.data) {
      for (const sig of tx.transaction?.txSignatures ?? []) {
        const parsed = parseSerializedSignature(sig)
        if (parsed.signatureScheme !== 'MultiSig') continue
        const committee = new MultiSigPublicKey(parsed.multisig.multisig_pk).getPublicKeys()
        if (committee.some(m => m.publicKey.toSuiAddress() === main)) return true
      }
    }
  } catch {
    /* unreadable candidate → treat as not-yours */
  }
  return false
}

// "Your sites": every site owned by your `main` address, PLUS every site owned by
// an agent sub-account whose multisig committee includes `main` (each tagged
// `viaAgent`). Fully chain-derived — no localStorage. Newest-first, capped.
export const fetch_my_sites = async (
  client: SuiJsonRpcClient,
  main: string,
  limit: number,
): Promise<SiteInfo[]> => {
  const mainLc = main.toLowerCase()
  const events = await recent_site_events(client, MY_SITES_EVENT_PAGES)

  // Distinct non-main owners = candidate sub-accounts (dedup; cap the on-chain checks).
  const candidates: string[] = []
  const seen = new Set<string>()
  for (const e of events) {
    const owner = (e.json.owner ?? '').toLowerCase()
    if (!owner || owner === mainLc || seen.has(owner)) continue
    seen.add(owner)
    if (candidates.length < SUBACCT_CHECK_CAP) candidates.push(e.json.owner)
  }

  // Committee-check candidates in parallel; collect the ones that are YOUR sub-accounts.
  const checks = await Promise.all(
    candidates.map(async addr =>
      (await subaccount_includes_main(client, addr, mainLc)) ? addr.toLowerCase() : null,
    ),
  )
  const mine = new Set(checks.filter((a): a is string => a != null))

  const sites: SiteInfo[] = []
  const deduped = new Set<string>()
  for (const e of events) {
    const owner = (e.json.owner ?? '').toLowerCase()
    const isMain = owner === mainLc
    const isAgent = mine.has(owner)
    if (!isMain && !isAgent) continue
    if (deduped.has(e.json.site_id)) continue
    deduped.add(e.json.site_id)
    const info = to_site_info(e.json, e.timestampMs)
    sites.push(isAgent ? { ...info, viaAgent: true } : info)
  }
  return sites.slice(0, limit)
}

// ---- Public gallery feed + chain-derived stats -----------------------------

// The PUBLIC showcase feed: every site, any owner, newest-first, capped. Reads
// the SiteCreated event stream (no owner filter) — the front-door gallery's
// source. Pages via recent_site_events so a cap > 50 is honoured.
export const fetch_recent_sites = async (
  client: SuiJsonRpcClient,
  limit: number,
): Promise<SiteInfo[]> => {
  const pages = Math.max(1, Math.ceil(limit / 50))
  const events = await recent_site_events(client, pages)
  const out: SiteInfo[] = []
  const seen = new Set<string>()
  for (const e of events) {
    if (seen.has(e.json.site_id)) continue
    seen.add(e.json.site_id)
    out.push(to_site_info(e.json, e.timestampMs))
    if (out.length >= limit) break
  }
  return out
}

// PURE, chain-derived aggregate stats over a set of sites (no network, no fakes).
// `deploysByDay` is a dense ascending series ending today, so a sparkline never
// lies about gaps. Used by the global stats ribbon + the dashboard analytics.
export interface SiteStats {
  totalSites: number
  totalBytes: number
  totalFiles: number
  withDomains: number
  /** Sites deployed within the last 24h (the "today" pulse). */
  last24h: number
  /** Dense daily deploy counts, oldest→newest, length `days`. */
  deploysByDay: { dayMs: number; count: number }[]
}

const DAY = 86_400_000

export const computeStats = (sites: SiteInfo[], days = 30): SiteStats => {
  const now = Date.now()
  const todayStart = Math.floor(now / DAY) * DAY
  const buckets = new Map<number, number>()
  for (let i = days - 1; i >= 0; i--) buckets.set(todayStart - i * DAY, 0)

  let totalBytes = 0
  let totalFiles = 0
  let withDomains = 0
  let last24h = 0
  for (const s of sites) {
    totalBytes += Number.isFinite(s.sizeBytes) ? s.sizeBytes : 0
    totalFiles += Number.isFinite(s.fileCount) ? s.fileCount : 0
    if (s.domains.length > 0) withDomains++
    if (s.createdAtMs && now - s.createdAtMs <= DAY) last24h++
    if (s.createdAtMs) {
      const day = Math.floor(s.createdAtMs / DAY) * DAY
      if (buckets.has(day)) buckets.set(day, (buckets.get(day) ?? 0) + 1)
    }
  }

  return {
    totalSites: sites.length,
    totalBytes,
    totalFiles,
    withDomains,
    last24h,
    deploysByDay: [...buckets.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([dayMs, count]) => ({ dayMs, count })),
  }
}

// ---- One site's detail ------------------------------------------------------

// A site's FULL on-chain record — SiteInfo plus the Walrus + integrity anchors
// the dossier surfaces (the permanence proof). Every field is read straight off
// the immutable shared `Site` object (packages/move-deploy/sources/site.move).
export interface SiteFull extends SiteInfo {
  /** Walrus root quilt CONTENT id holding the site's files. */
  quiltId: string
  /** Walrus blob CONTENT id holding the path → quilt-patch manifest JSON. */
  manifestBlobId: string
  /** sha256 of the manifest blob bytes, hex — the serve-time integrity anchor. */
  manifestHashHex: string
  /** Sui object id of the Walrus Blob OBJECT holding the quilt (storage target). */
  quiltBlobObject: string
  /** Sui object id of the Walrus Blob OBJECT holding the manifest. */
  manifestBlobObject: string
  /** On-chain Site schema version (always 1 in MVP). */
  version: number
}

// A Move `vector<u8>` field comes back from the RPC either as a number[] of bytes
// or (some nodes) a base64 string. Normalise to a lowercase hex string; '' when
// genuinely absent. Display only — the worker is the authority on the real hash.
const vec_u8_to_hex = (v: unknown): string => {
  if (Array.isArray(v)) {
    return v.map(n => (Number(n) & 0xff).toString(16).padStart(2, '0')).join('')
  }
  if (typeof v === 'string' && v.length > 0) {
    try {
      const bin = atob(v)
      let out = ''
      for (let i = 0; i < bin.length; i++)
        out += bin.charCodeAt(i).toString(16).padStart(2, '0')
      return out
    } catch {
      return ''
    }
  }
  return ''
}

const str_field = (v: unknown): string => (typeof v === 'string' ? v : '')

// The `Site` object fields + createdAtMs (from the matching SiteCreated event) +
// the site's CURRENT linked domains (best-effort, reduced from Domain events).
export const fetch_site_onchain = async (
  client: SuiJsonRpcClient,
  siteId: string,
): Promise<SiteFull> => {
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
    name: str_field(f.name),
    owner: typeof f.owner === 'string' ? f.owner : (created?.owner ?? ''),
    url: site_url(siteId),
    sizeBytes: Number(f.size_bytes ?? 0),
    fileCount: Number(f.file_count ?? 0),
    createdAtMs: created?.createdAtMs ?? 0,
    domains: await fetch_site_domains(client, siteId),
    quiltId: str_field(f.quilt_id),
    manifestBlobId: str_field(f.manifest_blob_id),
    manifestHashHex: vec_u8_to_hex(f.manifest_hash),
    quiltBlobObject: str_field(f.quilt_blob_object),
    manifestBlobObject: str_field(f.manifest_blob_object),
    version: Number(f.version ?? 1),
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

// ---- Owner identity: a person, or a person's Suize agent -------------------
// A site's on-chain `owner` is whoever PAID — for an MCP/agent deploy that's the
// agent SUB-ACCOUNT (a 1-of-2 multisig { main, agent }), which has no handle of its
// own, so "Owned by 0x0ab0…" reads as a stranger. But the sub-account's committee
// (embedded in its own payment signature) names the human MAIN member, who DOES
// have a Suize handle. So we resolve the owner to one of:
//   · { kind: 'direct' } — a normal address (its own handle, or hex)
//   · { kind: 'agent' }   — a Suize sub-account → show the MAIN member's handle
// Fully chain-derived (no stored state). Presentation only — never gates anything.

export type OwnerIdentity =
  | { kind: 'direct'; address: string; handle: string | null }
  | { kind: 'agent'; address: string; mainAddress: string; mainHandle: string | null }

// The two committee members of a Suize agent sub-account, or null when `address`
// isn't one. Reads ONE transaction the address SENT (its gasless payment is
// multisig-signed) and accepts ONLY the Suize sub-account shape: a 1-of-2,
// threshold-1 multisig of two zkLogin members whose derived address == `address`.
const subaccountCommittee = async (
  address: string,
  client: SuiJsonRpcClient,
): Promise<string[] | null> => {
  try {
    const page = await client.queryTransactionBlocks({
      filter: { FromAddress: address },
      options: { showInput: true },
      order: 'descending',
      limit: 1,
    })
    for (const tx of page.data) {
      for (const sig of tx.transaction?.txSignatures ?? []) {
        const parsed = parseSerializedSignature(sig)
        if (parsed.signatureScheme !== 'MultiSig') continue
        const mpk = new MultiSigPublicKey(parsed.multisig.multisig_pk)
        const members = mpk.getPublicKeys()
        // The exact formAgentSubaccount shape: 1-of-2, both zkLogin (flag 5).
        if (members.length !== 2 || mpk.getThreshold() !== 1) continue
        if (!members.every(m => m.publicKey.flag() === 5)) continue
        if (mpk.toSuiAddress().toLowerCase() !== address.toLowerCase()) continue
        return members.map(m => m.publicKey.toSuiAddress())
      }
    }
  } catch {
    /* unreadable → not a recognizable sub-account */
  }
  return null
}

// Resolve a site owner to a human-readable identity. Tries the owner's OWN handle
// first; failing that, recognizes a Suize agent sub-account and resolves the MAIN
// member's handle (the member that carries a `@suize` handle — the agent's
// second-login address has none). Degrades to the hex address at every step.
export const resolveOwnerIdentity = async (
  owner: string,
  client: SuiJsonRpcClient,
): Promise<OwnerIdentity> => {
  const direct = await resolveSuizeHandle(owner, client)
  if (direct) return { kind: 'direct', address: owner, handle: direct }

  const committee = await subaccountCommittee(owner, client)
  if (committee) {
    const handles = await Promise.all(committee.map(a => resolveSuizeHandle(a, client)))
    const idx = handles.findIndex(h => h != null)
    const mainIdx = idx >= 0 ? idx : 0
    return {
      kind: 'agent',
      address: owner,
      mainAddress: committee[mainIdx],
      mainHandle: handles[mainIdx],
    }
  }

  return { kind: 'direct', address: owner, handle: null }
}

// ---- Coin balances (admin panel — read-only) -------------------------------
// The admin balance tab reads the deploy service wallet's operational balances
// straight from chain (public on-chain data). SUI (gas) + WAL (Walrus storage)
// are what the owner must keep topped up so deploys + storage-extends keep
// working. Returns base-unit bigints as strings (JSON-safe); the caller formats.

export const SUI_COIN_TYPE = '0x2::sui::SUI'

export interface CoinBalance {
  /** Total balance in base units (MIST for SUI, FROST for WAL — both 9 decimals). */
  totalBalance: string
  /** Number of distinct coin objects of this type the address holds. */
  coinObjectCount: number
}

// One coin type's total balance for `address`. Swallows nothing — the caller
// shows a calm error state on failure (never a fake 0). `coinType` defaults to SUI.
export const fetch_balance = async (
  client: SuiJsonRpcClient,
  address: string,
  coinType: string = SUI_COIN_TYPE,
): Promise<CoinBalance> => {
  const b = await client.getBalance({ owner: address, coinType })
  return {
    totalBalance: b.totalBalance,
    coinObjectCount: b.coinObjectCount,
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
