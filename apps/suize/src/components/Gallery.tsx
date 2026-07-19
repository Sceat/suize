import { useEffect, useState } from 'react'
import { epochsRemaining, shortDigest } from '../data'
import { explorerTx } from '../live'
import type { LiveState } from '../useLive'
import type { DeploySite } from '../types'

// The front page IS the news: an editorial INDEX of the REAL on-chain feed
// (live.ts → SiteCreated events). Each row is a real DeploySite; the epoch
// countdown is derived live from the Walrus epoch clock and each receipt links
// the real create tx on the explorer. Nothing here is fabricated (honesty law).
//
// The landing executes ZERO third-party content. A published site can be a
// byte-for-byte copy of this very page, so live-embedding the feed recursed
// (landing inside landing inside landing) and melted visitors' browsers. The
// feed is therefore a text index, never an iframe wall.

function EpochLabel({ site }: { site: DeploySite }) {
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
      <b>{rem}</b> left
    </span>
  )
}

// One ledger row per public edition, strictly single line: the serif headline
// (links to the live site) · the served host (mono, ellipsis-truncated) · a
// dotted leader · the dateline facts. Only the name and the receipt are links
// (never nested), so the row itself is a plain container.
function IndexRow({ site }: { site: DeploySite }) {
  return (
    <div className="index__row">
      {site.url ? (
        <a className="index__name" href={site.url} target="_blank" rel="noopener noreferrer">
          {site.name}
        </a>
      ) : (
        <span className="index__name">{site.name}</span>
      )}
      <span className="index__host mono">{site.host}</span>
      <span className="index__leader" aria-hidden />
      <span className="index__meta">
        <span className="index__ago mono">{site.pressedAgo}</span>
        <EpochLabel site={site} />
        {site.receiptDigest && (
          <a className="receipt" href={explorerTx(site.receiptDigest)} target="_blank" rel="noopener noreferrer">
            {shortDigest(site.receiptDigest)}
          </a>
        )}
      </span>
    </div>
  )
}

export function Gallery({ live }: { live: LiveState }) {
  // Re-render on a slow tick so the derived epoch countdowns stay current. The
  // tick only refreshes the epochs-left labels; 30s is ample (the chain doesn't
  // move fast and useLive refetches the feed on its own cadence).
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 30000)
    return () => window.clearInterval(id)
  }, [])

  // Show only PUBLIC editions on the front page (unlisted/private sites are not
  // advertised); the feed is newest-first from live.ts.
  const sites: DeploySite[] = live.status === 'ready' ? live.data.sites.filter((s) => s.privacy === 'public') : []

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

      {sites.length > 0 && (
        <div className="index">
          {sites.map((site) => (
            <IndexRow key={site.siteId} site={site} />
          ))}
        </div>
      )}
    </section>
  )
}
