import { useEffect, useRef, useState } from 'react'
import { PRODUCTS, NAV } from '../config'
import { navigate, scrollTop } from '../ui'
import { onTick, getLenis, prefersReducedMotion } from '../lib/motion'
import ThemeToggle from './ThemeToggle'

const Caret = () => (
  <span className="dx-navlink__caret" aria-hidden="true">
    ▾
  </span>
)

// The products mega-panel — the ADDITIONAL products only (Deploy + Crash). The
// two audiences (Wallet/PAY · Charge/CHARGE) are the For users / For business
// links, never repeated here. Order + membership come from NAV.products.routes.
const ProductsMenu = ({ onPick }) => {
  const rows = NAV.products.routes
    .map(r => PRODUCTS.find(p => p.id === r))
    .filter(Boolean)
  return (
    <div className="sx-mega" role="menu" aria-label="Products">
      <div className="sx-mega__group">
        <div className="ed-sep sx-mega__sep">
          <span className="ed-sep__label">Products</span>
          <span className="ed-sep__line" />
        </div>
        {rows.map(p => (
          <button
            key={p.id}
            className="sx-mega__row"
            role="menuitem"
            onClick={() => onPick(p.route)}
          >
            <span className="sx-mega__rowmain">
              <span className="sx-mega__name">{p.name}</span>
              <span className="sx-mega__desc">{p.desc}</span>
            </span>
            <span className="sx-mega__lead" />
            <span className="sx-mega__tag">{p.side}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

export default function Nav() {
  const [open, setOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  // RETRACT (ara.so-style): expanded at the top, condenses into a compact glass
  // ISLAND on scroll-down, re-expands on scroll-up. Direction-aware, hysteretic.
  const [retracted, setRetracted] = useState(false)
  const wrapRef = useRef(null)

  // Drive BOTH the frost (`scrolled`) and the retract (`retracted`) off the ONE
  // shared motion clock (Lenis via onTick) — never a second scroll listener /
  // rAF that fights it. Reduced motion → static: frost still fades in, but the
  // island never retracts. Direction-aware with hysteresis so it doesn't flap.
  useEffect(() => {
    const reduce = prefersReducedMotion()
    let lastY = getLenis()?.scroll ?? window.scrollY
    let downAccum = 0
    let upAccum = 0
    // local mirrors so we only setState on an actual flip (no per-frame churn)
    let frost = false
    let folded = false

    const off = onTick(() => {
      const y = getLenis()?.scroll ?? window.scrollY
      const dy = y - lastY
      lastY = y

      const nextFrost = y > 24
      if (nextFrost !== frost) {
        frost = nextFrost
        setScrolled(nextFrost)
      }

      if (reduce) return

      // accumulate intent in each direction; fire past a small threshold so a
      // jitter of a few px never toggles the island.
      if (dy > 0) {
        downAccum += dy
        upAccum = 0
      } else if (dy < 0) {
        upAccum -= dy
        downAccum = 0
      }

      // near the very top we are ALWAYS expanded (the full nav over the hero).
      const next = y < 80 ? false : folded ? upAccum < 64 : downAccum > 48
      if (next !== folded) {
        folded = next
        setRetracted(next)
      }
    })
    return off
  }, [])

  useEffect(() => {
    if (!open) return
    const onDoc = e => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false)
    }
    const onKey = e => e.key === 'Escape' && setOpen(false)
    document.addEventListener('pointerdown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const pick = route => {
    setOpen(false)
    navigate(route)
  }

  // when the nav FOLDS into the island, a left-open products panel would dangle —
  // close it so the compact bar is clean on the fold transition. Depend on
  // `retracted` ONLY (not `open`) so it fires on the fold, never on a later open:
  // Products STAYS clickable inside the retracted island (the island no longer
  // re-expands on hover — scroll is the only control — so the trigger must keep
  // working in place), and gating on `open` would stop that panel from staying up.
  useEffect(() => {
    if (retracted) setOpen(false)
  }, [retracted])

  return (
    <header
      className={`sx-nav${scrolled ? ' is-scrolled' : ''}${
        retracted ? ' is-retracted' : ''
      }`}
    >
      <a
        className="sx-logo"
        href="/"
        aria-label="Suize home"
        onClick={scrollTop}
      >
        <span className="sx-logo__mark">SUIZE</span>
      </a>

      <span className="sx-nav__spacer" />

      <nav className="sx-nav__links" aria-label="Primary">
        {/* audience links: For users (PAY home) · For business (CHARGE page).
            No index numbers — owner cut the 01/02/… superscripts entirely. */}
        {NAV.links.map(l => (
          <a
            key={l.href}
            className="dx-navlink"
            href={l.href}
            onClick={scrollTop}
          >
            {l.label}
          </a>
        ))}
        {/* Products dropdown — the additional products only (Deploy + Crash).
            Stays reachable in the retracted island (never folded away). */}
        <span className="sx-products-wrap" ref={wrapRef}>
          <button
            type="button"
            className={`dx-navlink sx-nav__products${open ? ' is-open' : ''}`}
            aria-haspopup="menu"
            aria-expanded={open}
            onClick={() => setOpen(o => !o)}
          >
            {NAV.products.label}
            <Caret />
          </button>
          {open && <ProductsMenu onPick={pick} />}
        </span>
        {/* Pricing — last top-level link; stays reachable when retracted.
            (Docs left the navbar — it stays reachable via the business CTAs +
            the footer Learn column.) */}
        <a
          className="dx-navlink sx-nav__pricing"
          href={NAV.pricing.href}
          onClick={scrollTop}
        >
          {NAV.pricing.label}
        </a>
      </nav>

      <ThemeToggle />

      {/* ONE CTA, every route — label + link from config (LOCKED #14). */}
      <a className="sx-nav__cta" href={NAV.cta.href}>
        {NAV.cta.label}
      </a>
    </header>
  )
}
