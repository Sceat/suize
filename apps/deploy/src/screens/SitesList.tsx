import { useQuery } from '@tanstack/react-query'
import type { SiteInfo } from '@suize/shared'
import { fetch_sites } from '../api'
import { fmt_date, fmt_ago, site_size, site_files } from '../format'
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
// SITES LIST — the dashboard home. Each card is a premium "EDITION": an edition
// line (№ + label) over the live URL set as a serif headline (copyable), a mono
// metadata ledger (size · files · pressed date) with dotted leaders, domain
// chips, and a letterpress "pressed · permanent" mark. Real fetch via GET
// /sites (?owner= when scoped). Graceful empty/loading/error states — never
// fake rows when the backend is absent.
// ============================================================================

const SiteCard = ({
  site,
  index,
  onOpen,
}: {
  site: SiteInfo
  index: number
  onOpen: (id: string) => void
}) => (
  <button
    type="button"
    className="dx-card ed-stream"
    style={{ animationDelay: `${Math.min(index, 8) * 55}ms` }}
    onClick={() => onOpen(site.siteId)}
  >
    <div className="dx-card__head">
      <span className="dx-card__edition">
        <span className="dx-card__no tnum">
          №&nbsp;{String(index + 1).padStart(2, '0')}
        </span>
        <span className="dx-card__label">{site.name || 'Untitled site'}</span>
      </span>
      <span className="dx-chip is-live">
        <span className="dx-chip__dot" /> Live
      </span>
    </div>

    <div className="dx-card__url" onClick={e => e.stopPropagation()}>
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
        <span className="dx-led__k">Pressed</span>
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
        Pressed · permanent
        {fmt_ago(site.createdAtMs) ? ` · ${fmt_ago(site.createdAtMs)}` : ''}
      </span>
    </div>
  </button>
)

export const SitesList = ({
  owner,
  scoped,
  onOpen,
  onDeploy,
  onAgents,
}: {
  owner: string | null
  // True when an owner filter is applied (logged in + "my sites" view).
  scoped: boolean
  onOpen: (id: string) => void
  onDeploy: () => void
  onAgents: () => void
}) => {
  const q = useQuery({
    queryKey: ['sites', scoped ? owner : 'all'],
    queryFn: () => fetch_sites(scoped ? owner : undefined),
    retry: false,
  })

  return (
    <>
      <div className="dx-pagehead">
        <div>
          <p className="ed-eyebrow">
            {scoped ? 'Your press run' : 'The press run'}
          </p>
          <h1 className="dx-pagehead__title">Editions</h1>
        </div>
        <div className="dx-form-actions" style={{ marginTop: 0 }}>
          <button type="button" className="dx-btn" onClick={onAgents}>
            Deploy from your agent
          </button>
          <button type="button" className="dx-btn is-accent" onClick={onDeploy}>
            <IconPlus /> New edition
          </button>
        </div>
      </div>

      {q.isLoading && <LoadingState label="Setting the press run…" />}

      {q.isError && (
        <EmptyState kicker="Press offline" {...describe_error(q.error)} />
      )}

      {q.isSuccess && q.data.length === 0 && (
        <EmptyState
          kicker={scoped ? 'Your press run' : 'The press run'}
          title={scoped ? 'No editions yet' : 'Nothing pressed yet'}
          body={
            scoped
              ? 'Editions you press while signed in show up here. Press a built static folder to set your first run.'
              : 'Press a built static folder (or POST one as an agent) and it goes live on Walrus at a free subdomain — permanent the moment it lands.'
          }
          action={
            <div className="dx-form-actions" style={{ justifyContent: 'center' }}>
              <button
                type="button"
                className="dx-btn is-accent"
                onClick={onDeploy}
              >
                <IconPlus /> Press an edition
              </button>
              <button type="button" className="dx-btn" onClick={onAgents}>
                Deploy from your agent
              </button>
            </div>
          }
        />
      )}

      {q.isSuccess && q.data.length > 0 && (
        <>
          <div className="ed-sep" style={{ marginBottom: 18 }}>
            <span className="ed-sep__label">The press run</span>
            <span className="ed-sep__line" />
            <span className="dx-pagehead__count tnum">
              {q.data.length} edition{q.data.length === 1 ? '' : 's'}
            </span>
          </div>
          <div className="dx-grid">
            {q.data.map((s, i) => (
              <SiteCard key={s.siteId} site={s} index={i} onOpen={onOpen} />
            ))}
          </div>
        </>
      )}
    </>
  )
}
