// =============================================================================
// Live chain data for the front page (T-005b). Replaces the placeholder gallery
// + counters with REAL on-chain SiteCreated events, so nothing on suize.io is
// fabricated (honesty law). Zero extra deps: one GraphQL fetch of the deploy_sui
// SiteCreated feed, mapped to the DeploySite shape the gallery already renders.
// Fails to an EMPTY result (never fake rows) so a read blip degrades gracefully.
// =============================================================================

import { graphqlUrl, packageIds, WALRUS_EPOCHS } from '@suize/shared'
import { normalizeSuiObjectId } from '@mysten/sui/utils'
import { NETWORK } from './config'
import type { DeploySite } from './types'

const GRAPHQL_URL = graphqlUrl(NETWORK)
const DEPLOY_PACKAGE = packageIds(NETWORK).DEPLOY.PACKAGE
const GALLERY_SITE_LIMIT = 50

/** A real on-chain explorer link for a settlement / create tx digest. */
export const explorerTx = (digest: string): string => `https://suiscan.xyz/${NETWORK}/tx/${digest}`

// --- base36 subdomain (byte-identical to the worker's util.ts) ---------------
const BASE36_WIDTH = 50
const subdomainOf = (siteId: string): string =>
  BigInt('0x' + siteId.replace(/^0x/, '')).toString(36).padStart(BASE36_WIDTH, '0')

// --- wall-clock ms → Walrus epoch on the active network ----------------------
const epochOf = (ms: number): number => {
  const { genesisMs, durationMs } = WALRUS_EPOCHS[NETWORK]
  return Math.floor((ms - genesisMs) / durationMs)
}

const pressedAgo = (ms: number): string => {
  if (!ms) return 'recently'
  const s = Math.max(0, Math.floor((Date.now() - ms) / 1000))
  if (s < 90) return 'just now'
  const m = Math.floor(s / 60)
  if (m < 90) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 36) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

interface SiteCreatedJson {
  site_id?: string
  owner?: string
  name?: string
  paid_until_ms?: string | number
  sealed?: boolean
}

interface EventNode {
  timestamp?: string | null
  transaction?: { digest?: string | null } | null
  contents?: { json?: SiteCreatedJson | null } | null
}

const EVENTS_QUERY = `query($type: String!, $before: String) {
  events(last: 50, before: $before, filter: { type: $type }) {
    pageInfo { hasPreviousPage startCursor }
    nodes { timestamp transaction { digest } contents { json } }
  }
}`

const OBJECTS_QUERY = `query($keys: [ObjectKey!]!) {
  multiGetObjects(keys: $keys) { address }
}`

interface ObjectsData {
  multiGetObjects?: Array<{ address?: string | null } | null> | null
}

const gql = async <T>(query: string, variables: Record<string, unknown>): Promise<T> => {
  const res = await fetch(GRAPHQL_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  })
  if (!res.ok) throw new Error(`Sui GraphQL HTTP ${res.status}`)
  const body = (await res.json()) as { data?: T; errors?: { message?: string }[] }
  if (body.errors?.length) throw new Error(body.errors[0]?.message ?? 'graphql error')
  return body.data as T
}

const fetchExistingIds = async (ids: string[]): Promise<Set<string>> => {
  if (ids.length === 0) return new Set()
  const normalized = ids.map((id) => normalizeSuiObjectId(id))
  const data = await gql<ObjectsData>(OBJECTS_QUERY, {
    keys: normalized.map((address) => ({ address })),
  })
  return new Set(
    (data.multiGetObjects ?? []).flatMap((object) =>
      object?.address ? [normalizeSuiObjectId(object.address)] : [],
    ),
  )
}

const toNum = (v: unknown): number => {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : 0
  return Number.isFinite(n) ? n : 0
}

export interface LiveFigures {
  sitesLive: number
  paymentsSettled: number
  epochsFunded: number
}

export interface LiveData {
  sites: DeploySite[]
  figures: LiveFigures
}

/**
 * Fetch the real front-page feed: every deployed site (newest first) mapped to
 * the gallery shape, plus honest counters derived from the same events. Counters:
 * sitesLive and epochsFunded cover the bounded, existence-checked gallery window;
 * paymentsSettled covers the fetched create + extend event window (each event is
 * one settled x402 payment).
 */
export async function fetchLive(maxPages = 6): Promise<LiveData> {
  const empty: LiveData = { sites: [], figures: { sitesLive: 0, paymentsSettled: 0, epochsFunded: 0 } }
  if (DEPLOY_PACKAGE === '0x0') return empty

  interface EventsPage {
    events?: { pageInfo?: { hasPreviousPage?: boolean; startCursor?: string | null }; nodes?: EventNode[] } | null
  }
  const collect = async (type: string): Promise<EventNode[]> => {
    const acc: EventNode[] = []
    let before: string | null = null
    for (let p = 0; p < maxPages; p++) {
      const data: EventsPage = await gql<EventsPage>(EVENTS_QUERY, { type, before })
      const conn = data.events
      for (const n of conn?.nodes ?? []) acc.push(n)
      if (!conn?.pageInfo?.hasPreviousPage || !conn.pageInfo.startCursor) break
      before = conn.pageInfo.startCursor
    }
    return acc
  }

  let created: EventNode[]
  let extended: EventNode[]
  try {
    ;[created, extended] = await Promise.all([
      collect(`${DEPLOY_PACKAGE}::site::SiteCreated`),
      collect(`${DEPLOY_PACKAGE}::site::SiteExtended`),
    ])
  } catch {
    return empty // a read blip shows nothing, never fabricated rows
  }

  const now = Date.now()
  const nowEpoch = epochOf(now)
  const sites: DeploySite[] = []
  let epochsFunded = 0

  created.sort((a, b) => (b.timestamp ? Date.parse(b.timestamp) : 0) - (a.timestamp ? Date.parse(a.timestamp) : 0))

  // The gallery is intentionally bounded to the newest 50 distinct Site ids, so
  // the live-object check stays one small GraphQL batch per refresh.
  const seen = new Set<string>()
  const candidates: Array<{ node: EventNode; siteId: string }> = []
  for (const node of created) {
    const rawId = node.contents?.json?.site_id
    if (!rawId) continue
    let siteId: string
    try {
      siteId = normalizeSuiObjectId(rawId)
    } catch {
      continue
    }
    if (seen.has(siteId)) continue
    seen.add(siteId)
    candidates.push({ node, siteId })
    if (candidates.length === GALLERY_SITE_LIMIT) break
  }

  let existingIds: Set<string>
  try {
    existingIds = await fetchExistingIds(candidates.map(({ siteId }) => siteId))
  } catch {
    return empty
  }

  for (const { node: n, siteId } of candidates) {
    const j = n.contents?.json
    if (!j || !existingIds.has(siteId)) continue
    const sealed = j.sealed === true
    const sub = subdomainOf(siteId)
    const paidUntil = toNum(j.paid_until_ms)
    const endEpoch = paidUntil ? epochOf(paidUntil) : null
    if (endEpoch != null) epochsFunded += Math.max(0, endEpoch - nowEpoch)
    sites.push({
      siteId,
      name: j.name || '(untitled edition)',
      host: sealed ? 'private · wallet-gated' : `${sub}.suize.site`,
      url: sealed ? '' : `https://${sub}.suize.site`,
      expiresAtEpoch: endEpoch,
      receiptDigest: n.transaction?.digest ?? null,
      privacy: sealed ? 'private' : 'public',
      pressedAgo: pressedAgo(n.timestamp ? Date.parse(n.timestamp) : 0),
    })
  }

  const sitesLive = sites.filter((s) => s.expiresAtEpoch == null || s.expiresAtEpoch > nowEpoch).length
  const paymentsSettled = created.length + extended.length

  return { sites, figures: { sitesLive, paymentsSettled, epochsFunded } }
}
