import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useSuiClient } from '@mysten/dapp-kit'
import type { SiteInfo } from '@suize/shared'
import { fetch_recent_sites, computeStats } from '../chain'
import { DEPLOY_BASE_DOMAIN } from '../config'
import { fmt_bytes, fmt_count, fmt_ago, site_size, site_files } from '../format'
import {
  SitePreview,
  StatFigure,
  MiniBars,
  IconShield,
  IconArrowUpRight,
  IconSearch,
} from '../primitives'
import { EmptyState, LoadingState, describe_error } from '../ui'
import './showcase.css'

// ============================================================================
// SHOWCASE GALLERY — the PUBLIC front door (logged-out + everyone). This is the
// first surface the Walrus-track judges see, so it's the broadsheet's COVER
// PAGE: a wide editorial masthead, a circulation-figures ribbon derived live
// from chain, an editorial search/sort control bar, and a premium EDITION grid
// where every card frames a LIVE, scaled thumbnail of the real Walrus site.
//
// DATA HONESTY — everything renders straight off-chain (fetch_recent_sites): the
// RECENT public deploy feed, not "all-time totals" (the ribbon labels say so).
// Loading → <LoadingState>; error → <EmptyState {...describe_error}>; empty →
// a calm "no sites pressed yet" notice. The hero stays visible across all
// states. Never a fabricated count, row, or thumbnail — the preview IS the site.
// ============================================================================

// How many recent public deploys to pull for the cover gallery.
const GALLERY_CAP = 60

type SortKey = 'newest' | 'largest'

// Shorten a site's live URL to its host's leading label + the base domain, e.g.
// "5i0i…4a.suize.site" — a tight, recognisable host for the showcase tiles.
const short_host = (url: string): string => {
  const host = url.replace(/^https?:\/\//, '').replace(/\/$/, '')
  const sub = host.endsWith(`.${DEPLOY_BASE_DOMAIN}`)
    ? host.slice(0, host.length - DEPLOY_BASE_DOMAIN.length - 1)
    : host
  const head = sub.length > 8 ? `${sub.slice(0, 4)}…${sub.slice(-2)}` : sub
  return `${head}.${DEPLOY_BASE_DOMAIN}`
}

// The full host (for the search haystack + the card's title attr) — no shortening.
const full_host = (url: string): string =>
  url.replace(/^https?:\/\//, '').replace(/\/$/, '')

// ============================================================================
// One EDITION card — a live thumbnail (with a "Live" tab) over the name + host,
// closed by a ledger footer (size · files · age) with the integrity seal. The
// WHOLE card opens the detail via a single covering <button> (stretched-link);
// the SitePreview is already pointer-events:none so it never steals the click.
// No nested buttons. (The recent feed carries no domains/viaAgent, so there's no
// chip row here — those live on the owner-scoped dashboard cards.)
// ============================================================================
const GalleryCard = ({
  site,
  onOpen,
}: {
  site: SiteInfo
  onOpen: (siteId: string) => void
}) => {
  const name = site.name || 'Untitled site'
  const age = fmt_ago(site.createdAtMs)
  return (
    <article className="gx-card ed-stream">
      <button
        type="button"
        className="gx-card__open"
        aria-label={`Open ${name}`}
        onClick={() => onOpen(site.siteId)}
      />

      <div className="gx-card__shot">
        <span className="gx-card__tab">
          <span className="gx-card__tabdot" aria-hidden="true" />
          Live
        </span>
        <SitePreview url={site.url} title={name} aspect="16 / 10" />
      </div>

      <div className="gx-card__body">
        <h3 className="gx-card__name">{name}</h3>
        <span className="gx-card__host" title={full_host(site.url)}>
          {short_host(site.url)}
        </span>
      </div>

      <div className="gx-card__foot">
        <span className="gx-card__ledger">
          {site_size(site.sizeBytes, site.fileCount)}
          <span className="gx-card__dot" aria-hidden="true">
            ·
          </span>
          {site_files(site.sizeBytes, site.fileCount)} files
          {age && (
            <>
              <span className="gx-card__dot" aria-hidden="true">
                ·
              </span>
              {age}
            </>
          )}
        </span>
        <span className="gx-card__seal" title="Content integrity-verified on every byte">
          <IconShield size={12} />
          <span>Integrity-verified</span>
        </span>
      </div>
    </article>
  )
}

export const ShowcaseGallery = ({
  onOpen,
  onAgents,
}: {
  onOpen: (siteId: string) => void
  onAgents: () => void
}) => {
  const client = useSuiClient()
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<SortKey>('newest')
  const [searchFocused, setSearchFocused] = useState(false)

  // The public showcase feed — every site, any owner, newest-first. Reads the
  // SiteCreated event stream direct from chain, so it works backend-offline.
  const q = useQuery({
    queryKey: ['gallery'],
    queryFn: () => fetch_recent_sites(client, GALLERY_CAP),
    retry: false,
  })

  const sites = useMemo(() => q.data ?? [], [q.data])

  // Chain-derived aggregate stats over the loaded feed (PURE — no fakes).
  const stats = useMemo(() => computeStats(sites), [sites])

  // Filter (name + host substring) then sort. Memoized so typing stays smooth.
  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const filtered = needle
      ? sites.filter(s => {
          const name = (s.name || '').toLowerCase()
          const host = full_host(s.url).toLowerCase()
          return name.includes(needle) || host.includes(needle)
        })
      : sites
    const out = [...filtered]
    if (sort === 'largest') out.sort((a, b) => b.sizeBytes - a.sizeBytes)
    else out.sort((a, b) => (b.createdAtMs || 0) - (a.createdAtMs || 0))
    return out
  }, [sites, query, sort])

  return (
    <div className="gx-page">
      {/* 1. HERO — stays visible across every state below. */}
      <header className="gx-hero">
        <span className="ed-eyebrow gx-hero__eyebrow">
          <span className="gx-hero__pulse ed-pulse" aria-hidden="true" />
          The permanent agentic web
        </span>

        <h1 className="gx-hero__title">
          Sites your agents press to Walrus — <em>live forever.</em>
        </h1>

        <p className="gx-hero__lede">
          Every site here was deployed by an agent over a gasless USDC payment
          and is served straight from Walrus — content integrity-verified on
          every byte, and whoever pays owns the site. Built on Sui.
        </p>

        <div className="gx-hero__cta">
          <button type="button" className="dx-btn is-accent" onClick={onAgents}>
            Deploy from your agent
            <IconArrowUpRight size={12} />
          </button>
          <span className="gx-hero__note">
            <IconShield size={13} />
            Permanent on Walrus · integrity-verified
          </span>
        </div>
      </header>

      {/* 2. STATS RIBBON — circulation figures over the LOADED feed. Honest,
          neutral labels (recent on-chain deploys, never "all-time totals"). */}
      <section className="gx-ribbon" aria-label="Recent deploy activity">
        <div className="gx-ribbon__cell">
          <StatFigure
            label="Sites"
            value={fmt_count(stats.totalSites)}
            sub="in the recent feed"
          />
        </div>
        <div className="gx-ribbon__cell">
          <StatFigure
            label="On Walrus"
            value={fmt_bytes(stats.totalBytes)}
            sub="pressed permanent"
            tone="blue"
          />
        </div>
        <div className="gx-ribbon__cell">
          <StatFigure
            label="Deployed today"
            value={fmt_count(stats.last24h)}
            sub="in the last 24h"
            tone="bull"
          />
        </div>
        <div className="gx-ribbon__cell">
          <StatFigure
            label="Custom domains"
            value={fmt_count(stats.withDomains)}
            sub="linked on-chain"
          />
        </div>
        <div className="gx-ribbon__chart">
          <span className="gx-ribbon__chartlbl">Recent deploys</span>
          <MiniBars
            data={stats.deploysByDay.map(d => d.count)}
            height={42}
            title="Deploys per day across the recent feed"
          />
        </div>
      </section>

      {/* 3. CONTROLS — search (name + host) + Newest|Largest sort. Only once the
          feed has loaded with sites: the calm loading/empty/error notices below
          stand on their own, never under a dead search field. */}
      {q.isSuccess && sites.length > 0 && (
        <>
          <div className="ed-sep">
            <span className="ed-sep__label">Editions</span>
            <span className="ed-sep__line" />
          </div>

          <div className="gx-controls">
            <div className="gx-controls__lead">
              <span className="gx-controls__count tnum">
                {shown.length} of {sites.length} site
                {sites.length === 1 ? '' : 's'}
              </span>
            </div>

            <label className="gx-search">
              <span className={`gx-search__ic${searchFocused ? ' is-focus' : ''}`}>
                <IconSearch size={15} />
              </span>
              <input
                className="gx-search__input"
                type="search"
                inputMode="search"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                placeholder="Search by name or host…"
                value={query}
                onChange={e => setQuery(e.target.value)}
                onFocus={() => setSearchFocused(true)}
                onBlur={() => setSearchFocused(false)}
                aria-label="Search sites by name or host"
              />
            </label>

            <div className="gx-sort" role="group" aria-label="Sort sites">
              <button
                type="button"
                className={`gx-sort__btn${sort === 'newest' ? ' is-on' : ''}`}
                aria-pressed={sort === 'newest'}
                onClick={() => setSort('newest')}
              >
                Newest
              </button>
              <button
                type="button"
                className={`gx-sort__btn${sort === 'largest' ? ' is-on' : ''}`}
                aria-pressed={sort === 'largest'}
                onClick={() => setSort('largest')}
              >
                Largest
              </button>
            </div>
          </div>
        </>
      )}

      {/* 4. GRID + states. The hero/ribbon above stay put; only this region swaps. */}
      {q.isLoading && <LoadingState label="Loading the showcase…" />}

      {q.isError && (
        <EmptyState kicker="Chain unreachable" {...describe_error(q.error)} />
      )}

      {q.isSuccess && sites.length === 0 && (
        <EmptyState
          kicker="The press is ready"
          title="No sites pressed yet"
          body="Point your agent at the Deploy API and the first edition it ships will land here — live and permanent on Walrus."
          action={
            <div className="dx-form-actions" style={{ justifyContent: 'center' }}>
              <button type="button" className="dx-btn is-accent" onClick={onAgents}>
                Deploy from your agent
              </button>
            </div>
          }
        />
      )}

      {q.isSuccess && sites.length > 0 && shown.length === 0 && (
        <EmptyState
          kicker="No matches"
          title="Nothing matches that search"
          body={
            <>
              No site name or host contains “{query.trim()}”. Clear the search to
              see the full showcase.
            </>
          }
        />
      )}

      {q.isSuccess && shown.length > 0 && (
        <div className="gx-grid">
          {shown.map(s => (
            <GalleryCard key={s.siteId} site={s} onOpen={onOpen} />
          ))}
        </div>
      )}
    </div>
  )
}
