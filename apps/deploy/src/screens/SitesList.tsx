import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useSuiClient } from '@mysten/dapp-kit'
import type { SiteInfo } from '@suize/shared'
import { fetch_sites_onchain } from '../chain'
import { DEPLOY_BASE_DOMAIN } from '../config'
import { fmt_id, fmt_date, fmt_ago, site_size, site_files } from '../format'
import {
  CopyButton,
  EmptyState,
  LoadingState,
  describe_error,
  IconGlobe,
  IconPlus,
  IconSeal,
} from '../ui'

// ============================================================================
// DASHBOARD HOME — a two-region layout, read DIRECTLY FROM CHAIN (never the
// backend, so it works backend-offline). Mirrors Crash's "main column + reduced
// side log" shape (the e05 bottom-left tape: a dot + uppercase label head over
// tight single-line rows):
//
//   CENTER (.dx-home__main) = the user's OWN sites only:
//     · Logged in  → "Your sites": the owner-scoped SiteCreated query (cards).
//     · Logged out → a clean "Sign in to see your sites" prompt (the masthead
//       "Sign in" is the action; at most a PLAIN text control here, no Google mark).
//
//   SIDE (.dx-home__rail) = "Recently deployed", ALWAYS shown (in or out): a
//     COMPACT log of recent public deploys — NOT full cards. Each row is the site
//     name + shortened host + time-ago, clickable → opens that site's detail.
//     Reads the public SiteCreated feed (newest-first, capped tight as a log).
//
// Each center card is a site "EDITION" block (class names kept; copy is plain):
// the site name over the live URL as a serif headline (copyable), a mono ledger
// (size · files · deployed date), domain chips, and a permanence mark. Graceful
// empty/loading/error states throughout — never fake rows.
// ============================================================================

// The "your sites" grid cap. The side log is a feed, capped tighter (below).
const SITES_CAP = 12
// The side log is a feed, not a registry: newest-first, capped tight.
const RECENT_LOG_CAP = 12

const SiteCard = ({
  site,
  onOpen,
}: {
  site: SiteInfo
  onOpen: (id: string) => void
}) => (
  // STRETCHED-LINK pattern: the card is a non-interactive <article> with a
  // single absolutely-positioned <button class="dx-card__open"> that covers it
  // (inset:0) to open the detail. The genuinely-interactive children (live-URL
  // <a> + CopyButton) sit ABOVE it via .dx-card__url { z-index:1 } so they stay
  // independently clickable — and NO button is nested inside another button.
  <article className="dx-card ed-stream">
    <button
      type="button"
      className="dx-card__open"
      aria-label={`Open ${site.name || 'Untitled site'}`}
      onClick={() => onOpen(site.siteId)}
    />

    <div className="dx-card__head">
      <span className="dx-card__edition">
        <span className="dx-card__label">{site.name || 'Untitled site'}</span>
      </span>
      <span className="dx-chip is-live">Live</span>
    </div>

    <div className="dx-card__url">
      <a
        className="dx-card__urltext"
        href={site.url}
        target="_blank"
        rel="noreferrer"
      >
        {site.url.replace(/^https?:\/\//, '')}
      </a>
      <CopyButton value={site.url} label="Copy URL" />
    </div>

    <div className="dx-card__meta">
      <div className="dx-led">
        <span className="dx-led__k">Size</span>
        <span className="ed-leader" aria-hidden="true" />
        <span className="dx-led__v">
          {site_size(site.sizeBytes, site.fileCount)}
        </span>
      </div>
      <div className="dx-led">
        <span className="dx-led__k">Files</span>
        <span className="ed-leader" aria-hidden="true" />
        <span className="dx-led__v">
          {site_files(site.sizeBytes, site.fileCount)}
        </span>
      </div>
      <div className="dx-led">
        <span className="dx-led__k">Deployed</span>
        <span className="ed-leader" aria-hidden="true" />
        <span className="dx-led__v">{fmt_date(site.createdAtMs)}</span>
      </div>
    </div>

    {site.domains.length > 0 && (
      <div className="dx-card__domains">
        {site.domains.map(d => (
          <span key={d} className="dx-chip">
            <IconGlobe /> {d}
          </span>
        ))}
      </div>
    )}

    <div className="dx-card__foot">
      <span className="dx-imprint">
        <span className="dx-imprint__seal">
          <IconSeal />
        </span>
        Live · permanent on Walrus
        {fmt_ago(site.createdAtMs) ? ` · ${fmt_ago(site.createdAtMs)}` : ''}
      </span>
    </div>
  </article>
)

// Shorten a site's live URL to its host's leading label + the base domain, e.g.
// "5i0i…4a.suize.site" — a tight, recognisable host for a one-line log row.
const short_host = (url: string): string => {
  const host = url.replace(/^https?:\/\//, '').replace(/\/$/, '')
  const sub = host.endsWith(`.${DEPLOY_BASE_DOMAIN}`)
    ? host.slice(0, host.length - DEPLOY_BASE_DOMAIN.length - 1)
    : host
  const head = sub.length > 8 ? `${sub.slice(0, 4)}…${sub.slice(-2)}` : sub
  return `${head}.${DEPLOY_BASE_DOMAIN}`
}

// One COMPACT log row — site name + shortened host + time-ago, the whole row a
// button that opens the site's detail. Crash-tape density (tight, single line).
const RecentLogRow = ({
  site,
  onOpen,
}: {
  site: SiteInfo
  onOpen: (id: string) => void
}) => (
  <button
    type="button"
    className="dx-log__row"
    onClick={() => onOpen(site.siteId)}
    title={site.url.replace(/^https?:\/\//, '')}
  >
    <span className="dx-log__name">{site.name || 'Untitled site'}</span>
    <span className="dx-log__host tnum">{short_host(site.url)}</span>
    {fmt_ago(site.createdAtMs) && (
      <span className="dx-log__ago tnum">{fmt_ago(site.createdAtMs)}</span>
    )}
  </button>
)

// The "Recently deployed" side rail — ALWAYS shown, reads the public on-chain
// feed (independent of login). A reduced log, not the card grid.
const RecentLog = ({ onOpen }: { onOpen: (id: string) => void }) => {
  const client = useSuiClient()
  const q = useQuery({
    queryKey: ['sites-onchain', 'public'],
    queryFn: () => fetch_sites_onchain(client, { limit: RECENT_LOG_CAP }),
    retry: false,
  })
  const recent = q.data ?? []

  return (
    <aside className="dx-log" aria-label="Recently deployed">
      <div className="dx-log__head">
        <span className="dx-log__dot" aria-hidden="true" />
        <span className="dx-log__lbl">Recently deployed</span>
      </div>

      {q.isError ? (
        <p className="dx-log__empty">Chain unreachable — try again shortly.</p>
      ) : q.isLoading ? (
        <p className="dx-log__empty">Loading recent deploys…</p>
      ) : recent.length === 0 ? (
        <p className="dx-log__empty">No sites deployed yet.</p>
      ) : (
        <div className="dx-log__rows">
          {recent.map(s => (
            <RecentLogRow key={s.siteId} site={s} onOpen={onOpen} />
          ))}
        </div>
      )}
    </aside>
  )
}

export const SitesList = ({
  owner,
  canSignIn,
  connecting,
  onSignIn,
  onOpen,
  onDeploy,
  onAgents,
}: {
  // The signed-in address, or null when anonymous. Drives the CENTER content.
  owner: string | null
  // True when a plain in-page "Sign in" control can be surfaced (Enoki available).
  canSignIn: boolean
  connecting: boolean
  onSignIn: () => void
  onOpen: (id: string) => void
  onDeploy: () => void
  onAgents: () => void
}) => {
  const loggedIn = owner != null
  const client = useSuiClient()

  // CENTER = the user's OWN sites: the owner-scoped SiteCreated query. Disabled
  // (never runs) when logged out — the center then shows the sign-in prompt.
  const q = useQuery({
    queryKey: ['sites-onchain', owner],
    queryFn: () => fetch_sites_onchain(client, { owner, limit: SITES_CAP }),
    enabled: loggedIn,
    retry: false,
  })

  const sites = useMemo(() => q.data ?? [], [q.data])

  return (
    <div className="dx-home">
      <div className="dx-home__main">
        <div className="dx-pagehead">
          <div>
            {loggedIn ? (
              <>
                <p className="ed-eyebrow">
                  Signed in · <span className="tnum">{fmt_id(owner)}</span>
                </p>
                <h1 className="dx-pagehead__title">Your sites</h1>
              </>
            ) : (
              <>
                <p className="ed-eyebrow">Your sites</p>
                <h1 className="dx-pagehead__title">Sign in to see your sites</h1>
              </>
            )}
          </div>
          {loggedIn && (
            <div className="dx-form-actions" style={{ marginTop: 0 }}>
              <button type="button" className="dx-btn" onClick={onAgents}>
                Deploy from your agent
              </button>
              <button
                type="button"
                className="dx-btn is-accent"
                onClick={onDeploy}
              >
                <IconPlus /> New site
              </button>
            </div>
          )}
        </div>

        {/* Logged OUT — a clean, inviting prompt (no public feed in the center;
            that lives in the side log). The masthead "Sign in" is the action;
            we surface at most a PLAIN text control here (no Google mark). */}
        {!loggedIn && (
          <EmptyState
            kicker="Your sites"
            body="Signing in scopes this list to your address — every site you deploy shows up here. Browse what's live right now in the Recently deployed log."
            action={
              canSignIn ? (
                <div
                  className="dx-form-actions"
                  style={{ justifyContent: 'center' }}
                >
                  <button
                    type="button"
                    className="dx-btn is-accent"
                    disabled={connecting}
                    onClick={onSignIn}
                  >
                    {connecting && (
                      <span className="spin" aria-hidden="true" />
                    )}
                    {connecting ? 'Signing in…' : 'Sign in'}
                  </button>
                </div>
              ) : undefined
            }
          />
        )}

        {/* Logged IN — the owner-scoped card grid + its states. */}
        {loggedIn && (
          <>
            {q.isLoading && <LoadingState label="Loading sites…" />}

            {q.isError && (
              <EmptyState
                kicker="Chain unreachable"
                {...describe_error(q.error)}
              />
            )}

            {q.isSuccess && sites.length === 0 && (
              <EmptyState
                kicker="Your sites"
                title="You haven't deployed anything yet"
                body="Sites you deploy while signed in show up here. Deploy a built static folder to launch your first one."
                action={
                  <div
                    className="dx-form-actions"
                    style={{ justifyContent: 'center' }}
                  >
                    <button
                      type="button"
                      className="dx-btn is-accent"
                      onClick={onDeploy}
                    >
                      <IconPlus /> Deploy a site
                    </button>
                    <button type="button" className="dx-btn" onClick={onAgents}>
                      Deploy from your agent
                    </button>
                  </div>
                }
              />
            )}

            {q.isSuccess && sites.length > 0 && (
              <>
                <div className="ed-sep" style={{ marginBottom: 18 }}>
                  <span className="ed-sep__label">Your sites</span>
                  <span className="ed-sep__line" />
                  <span className="dx-pagehead__count tnum">
                    {sites.length} site{sites.length === 1 ? '' : 's'}
                  </span>
                </div>
                <div className="dx-grid">
                  {sites.map(s => (
                    <SiteCard key={s.siteId} site={s} onOpen={onOpen} />
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </div>

      <RecentLog onOpen={onOpen} />
    </div>
  )
}
