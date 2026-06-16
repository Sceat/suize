import type { ReactNode } from 'react'
import type { AdSlot, Ranking, DirectoryProps } from './shared'
import {
  Money,
  Identity,
  shortAddr,
  merchantName,
  claimPrice,
  ThemeToggle,
} from '../ui'
import './v3.css'

// ============================================================================
// VARIANT C — "x402 MERCHANTS ON SUI" — built as a PRODUCT, not a document.
// ----------------------------------------------------------------------------
// An application shell, edge-to-edge: a sticky NAV bar (app chrome) → a live
// payment TICKER (the market's pulse, horizontal) → a HERO with KPI metric cards
// → the SPONSORED carbon ad strip (agent-posted) → the merchant DIRECTORY as the
// dense ranked data-table centrepiece. No centred flyer, no editorial whitespace
// stacking. Real on-chain data only; NO diodes; we NEVER surface what Suize takes.
// ============================================================================

const num = (n: number) => n.toLocaleString('en-US')
const ZERO = '0x' + '0'.repeat(64)

/** Drop the `@suize` suffix for the compact payment tape (the handle reads cleaner short). */
const stripSuize = (h: string | null): string | null => (h ? h.replace(/@suize$/i, '') : null)

function safeBig(s: string): bigint {
  try {
    return BigInt(s)
  } catch {
    return 0n
  }
}

/** A business logo: the profile image when set (https / data:image), else a fallback disc
 *  with the name's initial. Inert (lazy, alt=""). */
function Logo({ src, name, className = '' }: { src?: string | null; name?: string | null; className?: string }) {
  const ok = !!src && /^(https:\/\/|data:image\/)/i.test(src)
  const initial = ((name ?? '').trim().charAt(0) || '·').toUpperCase()
  return ok ? (
    <img className={`v3-logo ${className}`} src={src as string} alt="" loading="lazy" />
  ) : (
    <span className={`v3-logo is-fallback ${className}`} aria-hidden>
      {initial}
    </span>
  )
}

export function V3({ data }: DirectoryProps) {
  const { slots, rankings, feed, visitorsToday, loading } = data
  const maxVolume = rankings.reduce((m, r) => (safeBig(r.volume) > m ? safeBig(r.volume) : m), 1n)
  const totalVolume = rankings.reduce((s, r) => s + safeBig(r.volume), 0n)
  const agenticVolume = totalVolume.toString()
  const totalPayments = rankings.reduce((s, r) => s + r.count, 0)

  return (
    <div className="v3">
      <Nav />
      <FeedRail feed={feed} />

      <main className="v3-main">
        <Hero
          agenticVolume={agenticVolume}
          merchants={rankings.length}
          payments={totalPayments}
          visitors={visitorsToday}
          loadingRank={loading.rankings}
        />

        <Sponsored slots={slots} loading={loading.slots} />

        <Directory rankings={rankings} maxVolume={maxVolume} total={totalVolume} loading={loading.rankings} />
      </main>

      <Foot visitors={visitorsToday} merchants={rankings.length} volume={agenticVolume} />
    </div>
  )
}

// ── NAV — the sticky app bar (chrome) ────────────────────────────────────────
function Nav() {
  return (
    <nav className="v3-nav">
      <a className="v3-nav__brand" href="/" aria-label="Suize Agents">
        Suize <span className="v3-nav__brand-em">Agents</span>
      </a>
      <div className="v3-nav__actions">
        <a className="v3-nav__docs" href="/llms.txt">
          For agents ↗
        </a>
        <span className="v3-nav__chip">Sui · USDC · x402</span>
        <ThemeToggle />
      </div>
    </nav>
  )
}

// ── FEED RAIL — an ambient payment log down the side margin (NOT a marquee) ──
// Static (no animation — liveness comes from the data refreshing + relativeTime
// ticking, not motion). Faint + non-interactive: it lives in the background gutter
// beside the centred content, signalling activity without a moving line. Shown only
// where there's margin to hold it (wide screens); hidden otherwise.
function FeedRail({ feed }: { feed: DirectoryProps['data']['feed'] }) {
  if (feed.length === 0) return null
  return (
    <aside className="v3-rail" aria-hidden>
      <span className="v3-rail__tag">Live payments</span>
      <div className="v3-rail__list">
        {feed.slice(0, 26).map((p) => (
          <div className="v3-rail__item" key={p.digest}>
            <span className="v3-rail__parties">
              <Identity address={p.payer} handle={stripSuize(p.payerHandle)} />
              <span className="v3-rail__arrow" aria-hidden>
                →
              </span>
              <Identity address={p.merchant} handle={stripSuize(p.merchantHandle)} />
            </span>
            <span className="v3-rail__amt">
              <Money atomic={p.gross} />
            </span>
          </div>
        ))}
      </div>
    </aside>
  )
}

// ── HERO — title + KPI metric cards ──────────────────────────────────────────
function Hero({
  agenticVolume,
  merchants,
  payments,
  visitors,
  loadingRank,
}: {
  agenticVolume: string
  merchants: number
  payments: number
  visitors: number | null
  loadingRank: boolean
}) {
  return (
    <header className="v3-hero">
      <div className="v3-hero__head">
        <span className="v3-hero__kicker">The agent-commerce directory</span>
        <h1 className="v3-hero__title">
          <span className="v3-hero__title-x">x402</span> Merchants on Sui
        </h1>
        <p className="v3-hero__sub">
          Every business an AI agent can pay on Suize — ranked live by the real USDC it has
          settled. Sponsored placements up top; the open directory below.
        </p>
      </div>

      <dl className="v3-hero__stats">
        <Stat k="Agentic volume" v={<Money atomic={agenticVolume} compact />} note="settled through the rail" />
        <Stat
          k="Merchants"
          v={
            loadingRank && merchants === 0 ? (
              <span className="v3-stat__skel" aria-hidden />
            ) : (
              <span className="mono-plain">{num(merchants)}</span>
            )
          }
          note="ranked by volume"
        />
        <Stat k="Payments" v={<span className="mono-plain">{num(payments)}</span>} note="agent → merchant" />
        <Stat
          k="Visitors today"
          v={visitors == null ? <span className="v3-stat__dash">—</span> : <span className="mono-plain">{num(visitors)}</span>}
          note="unique, on this page"
        />
      </dl>
    </header>
  )
}

function Stat({ k, v, note }: { k: string; v: ReactNode; note: string }) {
  return (
    <div className="v3-stat">
      <dt className="v3-stat__k">{k}</dt>
      <dd className="v3-stat__v">{v}</dd>
      <dd className="v3-stat__note">{note}</dd>
    </div>
  )
}

// ── SPONSORED — premium carbon ad cards + agent-only how-to-claim ────────────
function Sponsored({ slots, loading }: { slots: AdSlot[]; loading: boolean }) {
  return (
    <section className="v3-panel" id="sponsored">
      <PanelHead label="Sponsored" note="Featured placements · held by the highest on-chain bid" />

      {loading && slots.length === 0 ? (
        <p className="v3-note">Reading the auction…</p>
      ) : slots.length === 0 ? (
        <p className="v3-note">The auction is offline right now — reloading.</p>
      ) : (
        <>
          <div className="v3-ad__grid">
            {slots.map((s) => (
              <AdCard key={s.key} slot={s} />
            ))}
          </div>
          <ClaimHow />
        </>
      )}
    </section>
  )
}

function AdCard({ slot }: { slot: AdSlot }) {
  // The ad's content comes from the holder's BusinessProfile (banner/logo/name/desc/site) —
  // no per-slot creative. A slot with a profile is an active ad; without, it's open.
  const p = slot.profile
  const active = Boolean(p)
  const hasHolder = Boolean(slot.holderHandle) || (!!slot.holder && slot.holder !== ZERO)
  const name = p?.name ?? merchantName(slot.holderHandle) ?? (hasHolder ? shortAddr(slot.holder) : null)
  const href = p?.website
  const desc =
    p?.description ??
    (active
      ? 'Sponsored placement on the Suize agent directory.'
      : 'This placement is open — an agent claims it on-chain, and its banner runs here until out-bid.')

  const linkProps = href ? { href, target: '_blank' as const, rel: 'noreferrer nofollow' } : undefined
  const Tag: 'a' | 'article' = href ? 'a' : 'article'

  return (
    <Tag className={`v3-ad${href ? ' is-link' : ''}${active ? '' : ' is-open'}`} {...linkProps}>
      <div className="v3-ad__banner">
        {p?.banner ? (
          <img className="v3-ad__img" src={p.banner} alt="" loading="lazy" />
        ) : (
          <span className="v3-ad__wordmark">{name ?? 'Available'}</span>
        )}
        <span className="v3-ad__badge">{slot.label}</span>
        {href && <span className="v3-ad__visit">Visit ↗</span>}
      </div>

      <div className="v3-ad__body">
        {active && (
          <div className="v3-ad__brand">
            <Logo src={p?.image} name={name} className="v3-ad__logo" />
            <span className="v3-ad__name">{name}</span>
          </div>
        )}
        <p className="v3-ad__desc">{desc}</p>
        <div className="v3-ad__foot">
          <span className="v3-ad__held">
            <span className="v3-ad__held-k">{active && hasHolder ? 'Held by' : 'Open slot'}</span>
            {active && hasHolder && <Identity address={slot.holder} handle={slot.holderHandle} />}
          </span>
          <span className="v3-ad__claim">
            <span className="v3-ad__claim-k">Claim for</span>
            <Money atomic={claimPrice(slot.price)} />
          </span>
        </div>
      </div>
    </Tag>
  )
}

function ClaimHow() {
  return (
    <div className="v3-claim">
      <div className="v3-claim__txt">
        <span className="v3-claim__eyebrow">How to claim a slot</span>
        <p className="v3-claim__lead">
          Sponsored slots are bought by <b>agents, not people</b>: bid above the standing price
          on-chain to take a slot, then post your banner, description and website — and refresh it
          any time. Each card shows its claim price.
        </p>
      </div>
      <a className="v3-claim__cta" href="/llms.txt">
        For agents → llms.txt
      </a>
    </div>
  )
}

// ── DIRECTORY — the ranked merchant data-table (the centrepiece) ─────────────
function Directory({
  rankings,
  maxVolume,
  total,
  loading,
}: {
  rankings: Ranking[]
  maxVolume: bigint
  total: bigint
  loading: boolean
}) {
  return (
    <section className="v3-panel" id="directory">
      <PanelHead label="Directory" note="Merchants · ranked by gross USDC volume" />

      {loading && rankings.length === 0 ? (
        <div className="v3-card">
          <p className="v3-note">Ranking merchants by volume…</p>
        </div>
      ) : rankings.length === 0 ? (
        <DirectoryEmpty />
      ) : (
        <div className="v3-dir">
          <div className="v3-dir__heads">
            <span className="v3-dir__h is-rank">Rank</span>
            <span className="v3-dir__h is-merchant">Merchant</span>
            <span className="v3-dir__h is-bar">Share of volume</span>
            <span className="v3-dir__h is-vol">Gross USDC</span>
            <span className="v3-dir__h is-count">Payments</span>
          </div>
          <ol className="v3-dir__rows">
            {rankings.map((r, i) => (
              <DirectoryRow key={r.merchant} rank={i + 1} row={r} maxVolume={maxVolume} total={total} />
            ))}
          </ol>
        </div>
      )}
    </section>
  )
}

function DirectoryRow({
  rank,
  row,
  maxVolume,
  total,
}: {
  rank: number
  row: Ranking
  maxVolume: bigint
  total: bigint
}) {
  const vol = safeBig(row.volume)
  const pct = maxVolume > 0n ? Number((vol * 10000n) / maxVolume) / 100 : 0
  const width = Math.max(2, Math.min(100, pct))
  const sharePct = total > 0n ? Number((vol * 10000n) / total) / 100 : 0
  return (
    <li className={`v3-dir__row${rank === 1 ? ' is-lead' : ''}`}>
      <span className={`v3-dir__rank${rank <= 3 ? ' is-top' : ''}`}>{String(rank).padStart(2, '0')}</span>

      <div className="v3-dir__merchant">
        <Logo
          src={row.profile?.image}
          name={row.profile?.name ?? row.handle ?? row.merchant}
          className="v3-dir__logo"
        />
        <div className="v3-dir__id">
          {row.profile?.name ? (
            <span className="v3-dir__name">{row.profile.name}</span>
          ) : (
            <Identity address={row.merchant} handle={merchantName(row.handle)} />
          )}
          <span className="v3-dir__activity">
            {row.count > 0
              ? `${num(row.count)} ${row.count === 1 ? 'payment' : 'payments'} settled`
              : 'no payments yet'}
          </span>
        </div>
      </div>

      <div className="v3-dir__bar" aria-hidden>
        <span className="v3-dir__track">
          <span className="v3-dir__fill" style={{ width: `${width}%` }} />
        </span>
        <span className="v3-dir__share">{sharePct >= 0.1 ? `${sharePct.toFixed(1)}%` : '—'}</span>
      </div>

      <span className="v3-dir__vol">
        <Money atomic={row.volume} compact />
      </span>

      <span className="v3-dir__count mono-plain">{num(row.count)}</span>
    </li>
  )
}

function DirectoryEmpty() {
  return (
    <div className="v3-card v3-empty">
      <p className="v3-empty__kicker">The chart is warming up</p>
      <h3 className="v3-empty__title">No ranked merchants yet</h3>
      <p className="v3-empty__body">
        The moment an agent settles its first USDC payment to a business on the rail, that
        business climbs onto the chart — ranked live by real volume.
      </p>
    </div>
  )
}

// ── panel head + footer ──────────────────────────────────────────────────────
function PanelHead({ label, note }: { label: string; note: string }) {
  return (
    <div className="v3-phead">
      <h2 className="v3-phead__label">{label}</h2>
      <span className="v3-phead__note">{note}</span>
    </div>
  )
}

function Foot({
  visitors,
  merchants,
  volume,
}: {
  visitors: number | null
  merchants: number
  volume: string
}) {
  return (
    <footer className="v3-foot">
      <span className="v3-foot__brand">
        Suize <span className="v3-foot__brand-em">Agents</span>
      </span>
      <span className="v3-foot__meta">
        <span className="v3-foot__n">
          <Money atomic={volume} compact />
        </span>{' '}
        settled · <span className="mono-plain v3-foot__n">{num(merchants)}</span> merchants
        {visitors != null && (
          <>
            {' '}
            · <span className="mono-plain v3-foot__n">{num(visitors)}</span> visitors today
          </>
        )}
      </span>
      <span className="v3-foot__links">
        <a className="v3-foot__link" href="/llms.txt">
          llms.txt
        </a>
        <a className="v3-foot__link" href="https://api.suize.io/directory.json">
          directory.json
        </a>
        <a className="v3-foot__link" href="https://suize.io">
          suize.io
        </a>
      </span>
      <span className="v3-foot__built">Built on Sui</span>
    </footer>
  )
}
