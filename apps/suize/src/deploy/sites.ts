// =============================================================================
// "My sites" — the connected wallet's own deploys, read straight from chain.
// One GraphQL sweep of SiteCreated (filtered to the owner) folded with
// SiteExtended (latest paid-through), so the dashboard is fully chain-derived:
// nothing here is stored off-chain, everything resolves from the wallet address.
// =============================================================================

import { graphqlUrl, packageIds } from '@suize/shared'
import { NETWORK } from '../config'
import { hostOf, urlOf, epochOf, untilLabel, dateLabel, sizeLabel } from './util'

const GRAPHQL_URL = graphqlUrl(NETWORK)
const DEPLOY_PACKAGE = packageIds(NETWORK).DEPLOY.PACKAGE

export interface OwnedSite {
  siteId: string
  name: string
  /** '' for sealed sites (no public host). */
  host: string
  url: string
  sizeBytes: number
  sizeLabel: string
  fileCount: number
  sealed: boolean
  createdAtMs: number
  paidUntilMs: number
  /** Absolute Walrus epoch the lease ends at. */
  expiresAtEpoch: number
  /** "18 days left" / "expired". */
  untilLabel: string
  /** Paid-through calendar date, e.g. "Jul 30, 2026". */
  paidThrough: string
  /** true once paid_until_ms is in the past — the site stops serving. */
  lapsed: boolean
  /** Create-tx digest (the on-chain receipt). */
  receiptDigest: string | null
}

interface EventNode {
  timestamp?: string | null
  transaction?: { digest?: string | null } | null
  contents?: { json?: Record<string, unknown> | null } | null
}

const EVENTS_QUERY = `query($type: String!, $before: String) {
  events(last: 50, before: $before, filter: { type: $type }) {
    pageInfo { hasPreviousPage startCursor }
    nodes { timestamp transaction { digest } contents { json } }
  }
}`

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

const toNum = (v: unknown): number => {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : 0
  return Number.isFinite(n) ? n : 0
}

interface EventsPage {
  events?: { pageInfo?: { hasPreviousPage?: boolean; startCursor?: string | null }; nodes?: EventNode[] } | null
}

const collect = async (type: string, maxPages: number): Promise<EventNode[]> => {
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

/** Every site owned by `owner`, newest first, with the live paid-through folded
 * from SiteExtended. Chain-derived — no wallet-specific store.
 *
 * KNOWN BOUND: the event type is network-global (the tx sender is the deploy
 * service wallet, so a server-side owner filter is impossible) and the sweep
 * caps at maxPages×50 most-recent events — an owner's sites older than that
 * window silently drop off. Fine at current volume (mirrors the MCP's accepted
 * bound); at scale this needs an owner-indexed source. */
export async function fetchOwnedSites(owner: string, maxPages = 8): Promise<OwnedSite[]> {
  if (DEPLOY_PACKAGE === '0x0' || !owner) return []
  const ownerLc = owner.toLowerCase()

  const [created, extended] = await Promise.all([
    collect(`${DEPLOY_PACKAGE}::site::SiteCreated`, maxPages),
    collect(`${DEPLOY_PACKAGE}::site::SiteExtended`, maxPages),
  ])

  // Latest paid-through per site from the extend feed (max wins; extends only push forward).
  const extendedUntil = new Map<string, number>()
  for (const n of extended) {
    const j = n.contents?.json as { site_id?: string; paid_until_ms?: string | number } | undefined
    if (!j?.site_id) continue
    const ms = toNum(j.paid_until_ms)
    extendedUntil.set(j.site_id, Math.max(extendedUntil.get(j.site_id) ?? 0, ms))
  }

  const now = Date.now()
  const nowEpoch = epochOf(now)
  const seen = new Set<string>()
  const sites: OwnedSite[] = []

  const ts = (n: EventNode): number => {
    const t = n.timestamp ? Date.parse(n.timestamp) : 0
    return Number.isFinite(t) ? t : 0
  }
  created.sort((a, b) => ts(b) - ts(a))

  for (const n of created) {
    const j = n.contents?.json as
      | { site_id?: string; owner?: string; name?: string; size_bytes?: string | number; file_count?: string | number; paid_until_ms?: string | number; sealed?: boolean }
      | undefined
    if (!j?.site_id || seen.has(j.site_id)) continue
    if (String(j.owner ?? '').toLowerCase() !== ownerLc) continue
    seen.add(j.site_id)

    const sealed = j.sealed === true
    const paidUntilMs = Math.max(toNum(j.paid_until_ms), extendedUntil.get(j.site_id) ?? 0)
    const lapsed = paidUntilMs > 0 && paidUntilMs <= now
    const sizeBytes = toNum(j.size_bytes)

    sites.push({
      siteId: j.site_id,
      name: j.name || '(untitled)',
      host: sealed ? '' : hostOf(j.site_id),
      url: sealed ? '' : urlOf(j.site_id),
      sizeBytes,
      sizeLabel: sizeLabel(sizeBytes),
      fileCount: toNum(j.file_count),
      sealed,
      createdAtMs: n.timestamp ? Date.parse(n.timestamp) : 0,
      paidUntilMs,
      expiresAtEpoch: paidUntilMs ? epochOf(paidUntilMs) : nowEpoch,
      untilLabel: untilLabel(paidUntilMs),
      paidThrough: dateLabel(paidUntilMs),
      lapsed,
      receiptDigest: n.transaction?.digest ?? null,
    })
  }

  return sites
}
