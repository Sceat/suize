import { useEffect, useState } from 'react'
import { epochsRemaining, shortDigest } from '../data'
import { explorerTx } from '../live'
import type { LiveState } from '../useLive'
import type { DeploySite, Preview } from '../types'

// The front page — the gallery IS the news. Each card is a REAL on-chain
// DeploySite (live.ts → SiteCreated events); the epoch countdown is derived live
// from the Walrus epoch clock, and each receipt links to the real create tx on
// the explorer. Nothing here is fabricated (honesty law).

function ArrowIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden>
      <path
        d="M2.5 7.5 7.5 2.5M4 2.5h3.5V6"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function LockIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="5" y="10.5" width="14" height="9.5" rx="1.6" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )
}

function Shot({ preview }: { preview: Preview }) {
  return (
    <div className="shot">
      <div className="shot__top" />
      <div className="shot__body">
        {preview === 'folio' && <div className="pv-folio" />}
        {preview === 'docs' && (
          <div className="pv-docs">
            <div className="pv-docs__side" />
            <div className="pv-docs__main" />
          </div>
        )}
        {preview === 'status' && <div className="pv-status" />}
        {preview === 'landing' && <div className="pv-landing" />}
        {preview === 'deck' && <div className="pv-deck" />}
        {preview === 'locked' && (
          <div className="pv-locked">
            <div className="pv-locked__lock">
              <LockIcon />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// The real page, embedded. Public sites are served from our own worker with no
// frame restrictions, so we render the live URL at desktop width and scale it to
// the card (fixed CSS ratio, see styles.css). sandbox="allow-scripts" (NO
// allow-same-origin) keeps the frame origin-opaque and safe while still letting
// real pages paint. Sealed/private sites and any load failure fall back to the
// decorative Shot below (never iframe ciphertext or a viewer bootstrap).
function SitePreview({ site }: { site: DeploySite }) {
  const [failed, setFailed] = useState(false)
  const embeddable = site.privacy === 'public' && site.preview !== 'locked' && !!site.url && !failed
  if (!embeddable) return <Shot preview={site.preview} />
  return (
    <div className="shot shot--live">
      <div className="shot__top" />
      <iframe
        className="shot__frame"
        src={site.url}
        title={`${site.name} preview`}
        loading="lazy"
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
        scrolling="no"
        tabIndex={-1}
        aria-hidden
        onError={() => setFailed(true)}
      />
    </div>
  )
}

function Dateline({ site }: { site: DeploySite }) {
  return (
    <div className="story__dateline">
      <span className="story__cat">{site.category}</span> · {site.pressedAgo}
      {site.viaAgent ? ' · via agent' : ''}
    </div>
  )
}

const PRIVACY_TAG: Record<DeploySite['privacy'], { label: string; cls: string } | null> = {
  public: null,
  unlisted: { label: 'Unlisted', cls: 'tag--unlisted' },
  private: { label: 'Seal-encrypted', cls: 'tag--private' },
}

function EpochLabel({ site, short }: { site: DeploySite; short: boolean }) {
  const rem = epochsRemaining(site)
  if (rem === 'permanent') {
    return (
      <span className="epoch epoch--perm">
        <b>Permanent</b>
      </span>
    )
  }
  const soon = rem <= 2
  return (
    <span className={`epoch${soon ? ' epoch--soon' : ''}`}>
      <b>{rem}</b> {short ? 'left' : 'epochs left'}
    </span>
  )
}

function StoryMedia({ site }: { site: DeploySite }) {
  const media = (
    <>
      <SitePreview site={site} />
      <h3 className="story__name">{site.name}</h3>
    </>
  )
  return site.url ? (
    <a className="story__link" href={site.url} target="_blank" rel="noopener noreferrer">
      {media}
    </a>
  ) : (
    media
  )
}

function StoryCard({ site }: { site: DeploySite }) {
  const tag = PRIVACY_TAG[site.privacy]
  return (
    <article className="story">
      <Dateline site={site} />
      <StoryMedia site={site} />
      <div className="story__host">{site.host}</div>
      <div className="story__foot">
        {tag && <span className={`tag ${tag.cls}`}>{tag.label}</span>}
        <EpochLabel site={site} short={!!tag} />
        {site.receiptDigest && (
          <a className="receipt" href={explorerTx(site.receiptDigest)} target="_blank" rel="noopener noreferrer">
            {shortDigest(site.receiptDigest)}
          </a>
        )}
      </div>
    </article>
  )
}

function LeadStory({ site }: { site: DeploySite }) {
  const rem = epochsRemaining(site)
  return (
    <article className="story story--lead">
      <Dateline site={site} />
      <StoryMedia site={site} />
      {site.sub && <p className="story__sub">{site.sub}</p>}
      <div className="leadbar">
        <span className="epoch epoch--perm">
          <b>{rem === 'permanent' ? 'Permanent' : rem}</b>
          {rem === 'permanent' ? ' · funded pool' : ' epochs paid ahead'}
        </span>
        <span className="dots" />
        {site.receiptDigest && (
          <a className="receipt" href={explorerTx(site.receiptDigest)} target="_blank" rel="noopener noreferrer">
            receipt {shortDigest(site.receiptDigest)} <ArrowIcon />
          </a>
        )}
      </div>
    </article>
  )
}

export function Gallery({ live }: { live: LiveState }) {
  // Re-render on a slow tick so the derived epoch countdowns stay live.
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 1000)
    return () => window.clearInterval(id)
  }, [])

  // Show only PUBLIC editions on the front page (unlisted/private sites are not
  // advertised); the real feed is newest-first from live.ts.
  const sites: DeploySite[] = live.status === 'ready' ? live.data.sites.filter((s) => s.privacy === 'public') : []
  const [lead, ...rest] = sites

  return (
    <section className="wrap front">
      <div className="secthead">
        <span className="secthead__no">§ 01</span>
        <h2 className="secthead__t">Recently pressed</h2>
        <span className="secthead__line" />
        <span className="secthead__meta">public editions · newest first</span>
      </div>

      <p className="front__proof">
        This is one. <b>suize.io is published on Suize</b>, stored on Walrus, and checked byte for
        byte when served.{' '}
        <a href="https://github.com/Sceat/suize#readme" target="_blank" rel="noopener noreferrer">
          see how it works →
        </a>
      </p>

      {live.status === 'loading' && <p className="front__note">Reading the press feed from chain…</p>}
      {live.status === 'error' && <p className="front__note">The live feed is unreachable right now. Try again shortly.</p>}
      {live.status === 'ready' && sites.length === 0 && (
        <p className="front__note">No public editions pressed yet. Yours could be the first.</p>
      )}

      {lead && (
        <div className="front__grid">
          {lead.lead ? <LeadStory site={lead} /> : <StoryCard site={lead} />}
          {rest.map((site) => (
            <StoryCard key={site.siteId} site={site} />
          ))}
        </div>
      )}
    </section>
  )
}
