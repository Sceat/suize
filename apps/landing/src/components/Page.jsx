import Nav from './Nav'
import Footer from './Footer'
import { navigate } from '../ui'
import { LINKS } from '../config'

// ============================================================================
// Page — the shared flat-page chassis for the single-audience pages (/agents,
// /businesses) and any non-room subpage. Nav + main + Footer, one rhythm. The
// PRODUCT detail pages use the richer Room/RoomHero chassis instead (per-room
// accent + shader motif); this is the lean, light-house variant.
//
// Reuse from here, page agents: <Page> wraps; <PageHero> is the top fold;
// then compose `.sx-section` / `.sx-marker` / `.sx-sectionhead` blocks (the
// existing theme.css primitives) for the body.
// ============================================================================
export function Page({ children }) {
  return (
    <>
      <Nav />
      <main className="sx-main sx-page">{children}</main>
      <Footer />
    </>
  )
}

// PageHero — the flat-page top fold: a back-link, a one-line eyebrow (static dot,
// no heartbeat — that beat is reserved for the ONE live moment), a serif title,
// a grotesk lede, and up to two CTAs. No shader; the home + rooms own the canvas.
export function PageHero({
  eyebrow,
  title,
  sub,
  ctaHref = LINKS.start,
  ctaLabel = 'Get started →',
  secondaryHref,
  secondaryLabel,
  back = true,
}) {
  return (
    <section className="sx-pagehero">
      <div className="sx-wrap">
        {back && (
          <a
            className="sx-back"
            href="#/"
            onClick={e => {
              e.preventDefault()
              navigate('/')
            }}
          >
            ← Suize
          </a>
        )}
        <div className="ed-eyebrow sx-pagehero__eyebrow">
          {eyebrow}
        </div>
        <h1 className="sx-pagehero__title">{title}</h1>
        {sub && <p className="sx-pagehero__sub">{sub}</p>}
        <div className="sx-pagehero__actions">
          <a className="dx-btn is-accent is-lg" href={ctaHref}>
            {ctaLabel}
          </a>
          {secondaryHref && secondaryLabel && (
            <a
              className="dx-btn is-lg"
              href={secondaryHref}
              target={secondaryHref.startsWith('#') ? undefined : '_blank'}
              rel={secondaryHref.startsWith('#') ? undefined : 'noreferrer'}
            >
              {secondaryLabel}
            </a>
          )}
        </div>
      </div>
    </section>
  )
}
