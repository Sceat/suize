import { ROOM_ACCENTS, LINKS } from '../config'
import { navigate } from '../ui'
import Nav from './Nav'

// The shared room chassis — same house, re-tinted per product. Wraps a detail
// page, applies its accent token overrides, and provides the hero scaffold; the
// global <Backdrop> (App.jsx) provides the clean editorial background surface.
export function Room({ id, children }) {
  const style = ROOM_ACCENTS[id] || ROOM_ACCENTS.wallet
  return (
    <div className="sx-room" style={style}>
      <Nav />
      <main className="sx-main">{children}</main>
    </div>
  )
}

export function RoomHero({ eyebrow, title, sub, ctaHref, ctaLabel, motif = true }) {
  return (
    <section className="sx-room__hero">
      {/* the global <Backdrop> (App.jsx) is the background; the room poster
          stays as a tinted veil seat. `motif` kept for API compatibility. */}
      {!motif && <div className="sx-room__poster" />}
      <div className="sx-room__veil" />
      <div className="sx-room__hero-inner sx-wrap">
        <a
          className="sx-back sx-room__back"
          href="/"
          onClick={e => {
            e.preventDefault()
            navigate('/')
          }}
        >
          ← All products
        </a>
        <div className="sx-room__eyebrow">
          {eyebrow}
        </div>
        <h1 className="sx-room__title">{title}</h1>
        <p className="sx-room__sub">{sub}</p>
        <div className="sx-room__actions">
          <a className="dx-btn is-accent is-lg" href={ctaHref || LINKS.start}>
            {ctaLabel || 'Get started →'}
          </a>
          <a
            className="sx-link"
            href="/pricing"
            onClick={e => {
              e.preventDefault()
              navigate('/pricing')
            }}
          >
            See pricing →
          </a>
        </div>
      </div>
    </section>
  )
}
