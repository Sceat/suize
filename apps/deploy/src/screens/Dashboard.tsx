import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useSuiClient } from '@mysten/dapp-kit'
import type { SiteInfo } from '@suize/shared'
import {
  DEPLOY_CHARGE_AMOUNT,
  DEPLOY_PREMIUM_CHARGE_AMOUNT,
  DEPLOY_SUB_PRICE_USDC,
} from '@suize/shared'
import { fetch_my_sites, computeStats } from '../chain'
import { DEPLOY_BASE_DOMAIN, SUIZE_WALLET_URL } from '../config'
import { useSuizeHandle } from '../suins'
import { useDeploySub, planOwnersOf, useSiteExpiry } from '../plan'
import {
  fmt_id,
  fmt_bytes,
  fmt_count,
  fmt_usdc,
  fmt_date,
  fmt_ago,
  site_size,
  site_files,
} from '../format'
import {
  CopyButton,
  EmptyState,
  LoadingState,
  describe_error,
  IconExternal,
  IconGlobe,
  IconSeal,
  IconCheck,
} from '../ui'
import {
  SitePreview,
  StatFigure,
  MiniBars,
  Sparkline,
  Tabs,
  IconGrid,
  IconLayers,
  IconActivity,
  IconClock,
} from '../primitives'
import './dashboard.css'

// ============================================================================
// CONSOLE — the signed-in, Vercel-grade control surface, typeset in THE IMPRINT
// editorial DNA. Three tabs, ONE data read (your sites, direct from chain) plus a
// per-account subscription read (the SAME @suize/pay/subs `activeFor(owner)` the
// site Storage panel uses). EVERY figure is chain-derived — empty/loading/error
// all degrade to calm editorial states; a genuinely-absent metric reads "—",
// never a fabricated 0. We DO NOT mint a subscribe flow here: the subscription
// card is informational and points to a site's Storage panel for the action.
//
//   OVERVIEW   — a circulation-figure stat ribbon, the subscription card, and a
//                "Recent deployments" strip (the 3–6 newest, live previews).
//   SITES      — the full grid of YOUR sites (the gallery's premium edition card:
//                live preview · name · host · Live / via-agent / domain chips ·
//                a size·files·age ledger foot), the whole card a stretched link.
//   ANALYTICS  — chain-derived DEPLOYMENT + STORAGE analytics ONLY (we hold no
//                visitor analytics, and never imply we do): deploys/day · 30d,
//                cumulative storage, a size distribution, and a totals ledger.
// ============================================================================

type Tab = 'overview' | 'sites' | 'analytics'

// How many of the newest sites the Overview "Recent deployments" strip shows.
const RECENT_STRIP_CAP = 6

// Shorten a site's live URL to its host's leading label + the base domain, e.g.
// "5i0i…4a.suize.site" — a tight, recognisable host for a card subline. (Mirrors
// SitesList's short_host so the chrome reads identically across screens.)
const short_host = (url: string): string => {
  const host = url.replace(/^https?:\/\//, '').replace(/\/$/, '')
  const sub = host.endsWith(`.${DEPLOY_BASE_DOMAIN}`)
    ? host.slice(0, host.length - DEPLOY_BASE_DOMAIN.length - 1)
    : host
  const head = sub.length > 8 ? `${sub.slice(0, 4)}…${sub.slice(-2)}` : sub
  return `${head}.${DEPLOY_BASE_DOMAIN}`
}

// ============================================================================
// SiteCard — the premium "edition" card, gallery-grade: a live Walrus preview
// over a name + short host, provenance chips (Live always, via-agent + domain
// when present), and a mono ledger foot (size · files · age). STRETCHED-LINK:
// a non-interactive <article> with one absolutely-positioned open-button (the
// whole card → onOpen); the live-URL anchor + CopyButton sit ABOVE it so they
// stay independently clickable, and no button nests inside another button.
// ============================================================================
const SiteCard = ({
  site,
  onOpen,
  eager = false,
}: {
  site: SiteInfo
  onOpen: (id: string) => void
  eager?: boolean
}) => {
  // The site's live Walrus storage window — lazy, best-effort (the card still
  // renders from chain without it). Same query key as the dossier → one cache.
  const expiresAtMs = useSiteExpiry(site.siteId)
  return (
    <article className="cx-card ed-stream">
      <button
        type="button"
        className="cx-card__open"
        aria-label={`Open ${site.name || 'Untitled site'}`}
        onClick={() => onOpen(site.siteId)}
      />

      <div className="cx-card__shot">
        <SitePreview url={site.url} title={site.name} eager={eager} />
      </div>

      <div className="cx-card__body">
        <div className="cx-card__head">
          <span className="cx-card__name">{site.name || 'Untitled site'}</span>
          <span className="cx-card__chips">
            {site.viaAgent && (
              <span className="dx-chip" title="Deployed by your agent's sub-account">
                via agent
              </span>
            )}
            <span className="dx-chip is-live">Live</span>
          </span>
        </div>

        <div className="cx-card__url">
          <a
            className="cx-card__host tnum"
            href={site.url}
            target="_blank"
            rel="noreferrer"
          >
            {short_host(site.url)}
          </a>
          <CopyButton value={site.url} label="Copy URL" />
        </div>

        {site.domains.length > 0 && (
          <div className="cx-card__domains">
            {site.domains.map(d => (
              <span key={d} className="dx-chip">
                <IconGlobe /> {d}
              </span>
            ))}
          </div>
        )}

        <div className="cx-card__foot">
          <span className="cx-led">
            <span className="cx-led__k">Size</span>
            <span className="cx-led__v tnum">
              {site_size(site.sizeBytes, site.fileCount)}
            </span>
          </span>
          <span className="cx-led__sep" aria-hidden="true" />
          <span className="cx-led">
            <span className="cx-led__k">Files</span>
            <span className="cx-led__v tnum">
              {site_files(site.sizeBytes, site.fileCount)}
            </span>
          </span>
          {fmt_ago(site.createdAtMs) && (
            <span className="cx-card__ago tnum">{fmt_ago(site.createdAtMs)}</span>
          )}
        </div>

        {expiresAtMs != null && (
          <div className="cx-card__expiry">
            <IconClock size={11} /> Storage through {fmt_date(expiresAtMs)}
          </div>
        )}
      </div>
    </article>
  )
}

// ============================================================================
// PlanRail — the Deploy storage plans as a SIDE panel (fixed in the right margin
// on wide screens; a horizontal strip in-flow on narrower ones). BOTH tiers are
// shown: the one you're on is highlighted, the other greyed — so "$19.99/mo" can
// never read as your price while you're on Free. READ-ONLY: the website never
// subscribes; your AGENT does that through the Deploy API. The rail just shows
// where you stand and points to your wallet to ask your agent.
// ============================================================================
const PLANS = [
  {
    id: 'free' as const,
    name: 'Free',
    price: 'Free',
    per: 'pay-as-you-go',
    perks: [
      'Deploy any site',
      'Initial storage included',
      `${fmt_usdc(DEPLOY_CHARGE_AMOUNT)} per deploy`,
    ],
  },
  {
    id: 'premium' as const,
    name: 'Premium',
    price: fmt_usdc(DEPLOY_SUB_PRICE_USDC),
    per: 'per month',
    perks: [
      'Custom domains',
      'All sites auto-renewed',
      `${fmt_usdc(DEPLOY_PREMIUM_CHARGE_AMOUNT)} per deploy`,
    ],
  },
]

const PlanRail = ({ owners }: { owners: string[] }) => {
  // Premium across the human's main + their agent sub-accounts (the plan lives on
  // the sub-account that deploys). While it settles, neither tier is marked current
  // (no wrong-highlight flash).
  const { sub, active, loading } = useDeploySub(owners)
  const current: 'free' | 'premium' | null = loading
    ? null
    : active
      ? 'premium'
      : 'free'

  return (
    <aside className="cx-planrail" aria-label="Storage plans">
      <p className="cx-planrail__head">Your plan</p>

      <div className="cx-planrail__cards">
        {PLANS.map(p => {
          const isCurrent = current === p.id
          const isMuted = current != null && !isCurrent
          return (
            <div
              key={p.id}
              className={`cx-plan${isCurrent ? ' is-current' : ''}${
                isMuted ? ' is-muted' : ''
              }`}
            >
              <div className="cx-plan__top">
                <span className="cx-plan__name">{p.name}</span>
                {isCurrent && <span className="cx-plan__tag">Current</span>}
              </div>
              <div className="cx-plan__price">
                <span className="cx-plan__amt tnum">{p.price}</span>
                <span className="cx-plan__per">{p.per}</span>
              </div>
              <ul className="cx-plan__perks">
                {p.perks.map(perk => (
                  <li key={perk}>
                    <IconCheck size={11} /> {perk}
                  </li>
                ))}
              </ul>
              {p.id === 'premium' && isCurrent && sub && (
                <p className="cx-plan__paid tnum">
                  Paid through {fmt_date(sub.paidUntilMs)}
                </p>
              )}
            </div>
          )
        })}
      </div>

      <div className="cx-planrail__ask">
        <p className="cx-planrail__asktext">
          {current === 'premium'
            ? 'Your agent manages this plan through the Deploy API. Cancel = deleting it on-chain.'
            : 'Plans are agent-driven — ask your agent to subscribe through the Deploy API.'}
        </p>
        <a
          className="dx-btn is-accent is-sm cx-planrail__btn"
          href={SUIZE_WALLET_URL}
          target="_blank"
          rel="noreferrer"
        >
          <IconExternal /> Open your Suize wallet
        </a>
      </div>
    </aside>
  )
}

// One compact "Recent deployments" strip card — preview + name + host + the live
// storage-through date (lazy, best-effort; same cache as the grid card + dossier).
const RecentCard = ({
  site,
  onOpen,
  eager,
}: {
  site: SiteInfo
  onOpen: (id: string) => void
  eager: boolean
}) => {
  const expiresAtMs = useSiteExpiry(site.siteId)
  return (
    <article className="cx-strip__card ed-stream">
      <button
        type="button"
        className="cx-strip__open"
        aria-label={`Open ${site.name || 'Untitled site'}`}
        onClick={() => onOpen(site.siteId)}
      />
      <div className="cx-strip__shot">
        <SitePreview url={site.url} title={site.name} aspect="16 / 9" eager={eager} />
      </div>
      <div className="cx-strip__meta">
        <span className="cx-strip__name">{site.name || 'Untitled site'}</span>
        <span className="cx-strip__host tnum">{short_host(site.url)}</span>
        {expiresAtMs != null && (
          <span className="cx-strip__expiry">
            <IconClock size={10} /> through {fmt_date(expiresAtMs)}
          </span>
        )}
      </div>
    </article>
  )
}

// ============================================================================
// OverviewTab — the circulation-figure stat ribbon + the "Recent deployments"
// strip. All figures from the SAME `sites` read. (The plan lives in the PlanRail
// side panel at the console level, not here.)
// ============================================================================
const OverviewTab = ({
  sites,
  onOpen,
  onAgents,
}: {
  sites: SiteInfo[]
  onOpen: (id: string) => void
  onAgents: () => void
}) => {
  const stats = useMemo(() => computeStats(sites), [sites])
  const recent = useMemo(() => sites.slice(0, RECENT_STRIP_CAP), [sites])

  return (
    <>
      <div className="cx-ribbon">
        <StatFigure
          label="Deployments"
          value={fmt_count(stats.totalSites)}
          sub={
            stats.last24h > 0
              ? `${fmt_count(stats.last24h)} in the last 24h`
              : 'permanent on Walrus'
          }
        />
        <span className="cx-ribbon__rule" aria-hidden="true" />
        <StatFigure
          label="Storage used"
          value={fmt_bytes(stats.totalBytes)}
          sub="across all your sites"
        />
        <span className="cx-ribbon__rule" aria-hidden="true" />
        <StatFigure label="Files" value={fmt_count(stats.totalFiles)} sub="pressed bytes" />
        <span className="cx-ribbon__rule" aria-hidden="true" />
        <StatFigure
          label="Custom domains"
          value={fmt_count(stats.withDomains)}
          sub={stats.withDomains === 1 ? 'site linked' : 'sites linked'}
          tone={stats.withDomains > 0 ? 'blue' : 'plain'}
        />
      </div>

      <div className="cx-recent">
          <div className="ed-sep" style={{ marginBottom: 16 }}>
            <span className="ed-sep__label">Recent deployments</span>
            <span className="ed-sep__line" />
            <button
              type="button"
              className="dx-btn is-ghost is-sm"
              onClick={onAgents}
            >
              Deploy from your agent
            </button>
          </div>

          {recent.length === 0 ? (
            <EmptyState
              kicker="Recent deployments"
              body="Sites your agent deploys for you show up here, newest first."
            />
          ) : (
            <div className="cx-strip">
              {recent.map((s, i) => (
                <RecentCard
                  key={s.siteId}
                  site={s}
                  onOpen={onOpen}
                  eager={i < 2}
                />
              ))}
            </div>
          )}
        </div>
    </>
  )
}

// ============================================================================
// SitesTab — the full grid of YOUR sites (the premium edition card). Empty →
// a calm EmptyState inviting an agent deploy.
// ============================================================================
const SitesTab = ({
  sites,
  onOpen,
  onAgents,
}: {
  sites: SiteInfo[]
  onOpen: (id: string) => void
  onAgents: () => void
}) => {
  if (sites.length === 0)
    return (
      <EmptyState
        kicker="Your sites"
        title="No sites yet"
        body="Sites are deployed by your agent — point it at the Deploy API and everything it ships for you shows up here."
        action={
          <div className="dx-form-actions" style={{ justifyContent: 'center' }}>
            <button type="button" className="dx-btn is-accent" onClick={onAgents}>
              Deploy from your agent
            </button>
          </div>
        }
      />
    )

  return (
    <>
      <div className="ed-sep" style={{ marginBottom: 18 }}>
        <span className="ed-sep__label">Your sites</span>
        <span className="ed-sep__line" />
        <span className="dx-pagehead__count tnum">
          {sites.length} site{sites.length === 1 ? '' : 's'}
        </span>
      </div>
      <div className="cx-grid">
        {sites.map((s, i) => (
          <SiteCard key={s.siteId} site={s} onOpen={onOpen} eager={i < 3} />
        ))}
      </div>
    </>
  )
}

// ============================================================================
// AnalyticsTab — chain-derived DEPLOYMENT + STORAGE analytics ONLY. We hold no
// visitor analytics and never imply we do. Every series is computed from the
// SAME `sites` read: deploys/day over 30d, a cumulative-storage sparkline (the
// running sum of sizeBytes by createdAtMs, oldest→newest), a size distribution,
// and a totals ledger.
// ============================================================================

const KB = 1024
const MB = 1024 * 1024

const AnalyticsTab = ({
  owner,
  sites,
}: {
  owner: string
  sites: SiteInfo[]
}) => {
  const stats = useMemo(() => computeStats(sites), [sites])

  // Cumulative storage over time — sort sites ascending by deploy time, then
  // accumulate sizeBytes. Sites without a real timestamp (createdAtMs === 0)
  // sink to the front; the running sum is still monotonic + honest.
  const cumulative = useMemo(() => {
    const asc = [...sites].sort((a, b) => a.createdAtMs - b.createdAtMs)
    let running = 0
    return asc.map(s => {
      running += Number.isFinite(s.sizeBytes) && s.sizeBytes > 0 ? s.sizeBytes : 0
      return running
    })
  }, [sites])

  // Size distribution — bucket each site by its on-disk footprint. A site with
  // absent metadata ({0,0}) has no real size, so it's excluded from the buckets
  // (counted only in the totals ledger), never bucketed as a fake "< 100 KB".
  const buckets = useMemo(() => {
    let small = 0
    let mid = 0
    let large = 0
    for (const s of sites) {
      if (s.sizeBytes === 0 && s.fileCount === 0) continue
      if (s.sizeBytes < 100 * KB) small++
      else if (s.sizeBytes <= MB) mid++
      else large++
    }
    return [
      { label: '< 100 KB', count: small },
      { label: '100 KB – 1 MB', count: mid },
      { label: '> 1 MB', count: large },
    ]
  }, [sites])
  const bucketMax = Math.max(1, ...buckets.map(b => b.count))

  // The subscription state for the totals ledger — the SAME shared chain read as
  // the panel + the header badge (one fetch, one cache).
  const { active: subActive, loading: subLoading } = useDeploySub(
    planOwnersOf(owner, sites),
  )
  const subState = subLoading
    ? 'Reading…'
    : subActive
      ? 'Auto-renewal on'
      : 'No active plan'

  return (
    <>
      <p className="dx-lede cx-analytics__lede">
        Your deployment &amp; storage activity, read live from chain.
      </p>

      <div className="cx-analytics">
        {/* (a) deploys / day · 30d + the last-24h pulse */}
        <div className="dx-panel cx-panel--wide">
          <h2 className="dx-panel__title">Deploys / day · 30d</h2>
          <div className="cx-chartrow">
            <div className="cx-chartrow__chart">
              <MiniBars
                data={stats.deploysByDay.map(d => d.count)}
                height={92}
                title="Deploys per day over the last 30 days"
              />
              <div className="cx-axis">
                <span>30d ago</span>
                <span>today</span>
              </div>
            </div>
            <div className="cx-chartrow__figure">
              <StatFigure
                label="Last 24h"
                value={fmt_count(stats.last24h)}
                sub="deploys today"
                tone={stats.last24h > 0 ? 'bull' : 'plain'}
              />
            </div>
          </div>
        </div>

        {/* (b) cumulative storage */}
        <div className="dx-panel">
          <h2 className="dx-panel__title">Cumulative storage</h2>
          <div className="cx-cumul">
            <Sparkline data={cumulative} width={240} height={64} />
            <StatFigure
              label="Total pressed"
              value={fmt_bytes(stats.totalBytes)}
              sub={`across ${fmt_count(stats.totalSites)} deploy${
                stats.totalSites === 1 ? '' : 's'
              }`}
              tone="blue"
            />
          </div>
        </div>

        {/* (c) sites by size */}
        <div className="dx-panel">
          <h2 className="dx-panel__title">Sites by size</h2>
          <div className="cx-dist">
            {buckets.map(b => (
              <div key={b.label} className="cx-dist__row">
                <span className="cx-dist__label">{b.label}</span>
                <span className="cx-dist__track" aria-hidden="true">
                  <span
                    className={`cx-dist__fill${b.count > 0 ? ' is-live' : ''}`}
                    style={{ width: `${(b.count / bucketMax) * 100}%` }}
                  />
                </span>
                <span className="cx-dist__count tnum">{fmt_count(b.count)}</span>
              </div>
            ))}
          </div>
        </div>

        {/* (d) totals ledger */}
        <div className="dx-panel">
          <h2 className="dx-panel__title">Totals</h2>
          <div className="dx-rows">
            <div className="dx-row">
              <span className="dx-row__k">Deployments</span>
              <span className="dx-row__v tnum">{fmt_count(stats.totalSites)}</span>
            </div>
            <div className="dx-row">
              <span className="dx-row__k">Storage used</span>
              <span className="dx-row__v tnum">{fmt_bytes(stats.totalBytes)}</span>
            </div>
            <div className="dx-row">
              <span className="dx-row__k">Files</span>
              <span className="dx-row__v tnum">{fmt_count(stats.totalFiles)}</span>
            </div>
            <div className="dx-row">
              <span className="dx-row__k">Custom domains</span>
              <span className="dx-row__v tnum">{fmt_count(stats.withDomains)}</span>
            </div>
            <div className="dx-row">
              <span className="dx-row__k">Storage plan</span>
              <span className="dx-row__v">{subState}</span>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

// ============================================================================
// Dashboard — the signed-in console shell: a page head with the identity eyebrow
// + the segmented tab control, then ONE owner-scoped chain read shared across all
// tabs. The header CTA opens the Agents view (the deploy door). Graceful states.
// ============================================================================
export const Dashboard = ({
  owner,
  tab,
  onTab,
  onOpen,
  onAgents,
  // onOk / onError complete the integrator's shared handler contract. This is a
  // READ-ONLY console (the writes — subscribe / extend / domains — live in a
  // site's Storage + domain panels, which own those toasts), so it has no own
  // success/error event to raise; aliased underscore-prefixed to stay in the
  // signature without firing spurious toasts.
  onOk: _onOk,
  onError: _onError,
}: {
  owner: string
  tab: Tab
  onTab: (t: Tab) => void
  onOpen: (id: string) => void
  onAgents: () => void
  onOk: (m: string) => void
  onError: (m: string) => void
}) => {
  const client = useSuiClient()
  const handle = useSuizeHandle(owner)

  // ONE owner-scoped read, shared across the three tabs (your main address ∪ your
  // agent sub-accounts; agent ones carry viaAgent). Newest-first, capped.
  const q = useQuery({
    queryKey: ['my-sites', owner],
    queryFn: () => fetch_my_sites(client, owner, 100),
    retry: false,
  })
  const sites = useMemo(() => q.data ?? [], [q.data])

  return (
    <div className="cx-console">
      <div className="dx-pagehead">
        <div>
          <p className="ed-eyebrow">
            Console · <span className="tnum">{handle ?? fmt_id(owner)}</span>
          </p>
          <h1 className="dx-pagehead__title">Your deployments</h1>
        </div>
        <div className="dx-form-actions" style={{ marginTop: 0 }}>
          <button type="button" className="dx-btn is-accent" onClick={onAgents}>
            <IconExternal /> Deploy from your agent
          </button>
        </div>
      </div>

      {/* The storage-plan side panel — fixed in the right margin on wide screens,
          a strip here on narrower ones. Read-only; the agent subscribes via API.
          Premium reflects the human's main + their agent sub-accounts (where the
          plan actually lives), derived from their sites. */}
      <PlanRail owners={planOwnersOf(owner, sites)} />

      <div className="cx-tabsrow">
        <Tabs
          tabs={[
            { id: 'overview', label: 'Overview', icon: <IconGrid /> },
            { id: 'sites', label: 'Sites', icon: <IconLayers /> },
            { id: 'analytics', label: 'Analytics', icon: <IconActivity /> },
          ]}
          value={tab}
          onChange={onTab}
        />
        {q.isSuccess && (
          <span className="cx-tabsrow__seal">
            <span className="dx-imprint">
              <span className="dx-imprint__seal">
                <IconSeal />
              </span>
              Permanent on Walrus
            </span>
          </span>
        )}
      </div>

      {q.isLoading && <LoadingState label="Loading your console…" />}

      {q.isError && (
        <EmptyState kicker="Chain unreachable" {...describe_error(q.error)} />
      )}

      {q.isSuccess && (
        <div className="cx-tabpanel ed-stream" key={tab}>
          {tab === 'overview' && (
            <OverviewTab sites={sites} onOpen={onOpen} onAgents={onAgents} />
          )}
          {tab === 'sites' && (
            <SitesTab sites={sites} onOpen={onOpen} onAgents={onAgents} />
          )}
          {tab === 'analytics' && <AnalyticsTab owner={owner} sites={sites} />}
        </div>
      )}
    </div>
  )
}
