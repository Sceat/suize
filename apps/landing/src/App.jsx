import { useEffect, useRef } from 'react'
import { CustomCursor } from './CustomCursor'
import { useRoute, scrollTop } from './ui'
import { startMotion, ScrollTrigger, prefersReducedMotion } from './lib/motion'

// THE BACKDROP — now a CLEAN editorial surface. The global living-matter shader
// was pulled (owner: "way too intense, it should not steal the focus that much;
// it'd feel like we found a shader and just posted our timeline on top"). The
// fixed full-viewport background (apps/landing/src/components/Backdrop) is just
// the themed paper floor + a subtle film grain + a very faint vignette — pure
// CSS, ~0 main-thread, clean in both themes. The matter shader now lives ONLY,
// dialed-back + bounded, behind the hero (components/HeroScene).
import Backdrop from './components/Backdrop'
import './backdrop.css'
import { ROOM_ACCENTS } from './config'
import Landing from './pages/Landing'
import Pricing from './pages/Pricing'
import Businesses from './pages/Businesses'
import Deploy from './pages/Deploy'
import Docs from './pages/Docs'
import ProductStub from './pages/ProductStub'

// ============================================================================
// SUIZE — the landing. Dark, experiential, on-brand. A lean hash-router picks
// the page; the shared motion backbone (Lenis + GSAP + the OGL clock) boots
// once; entering a product room wipes in that room's accent.
// ============================================================================

// Product rooms that render the STUB room chassis (ProductStub). `deploy` has
// its own full featured page (pages/Deploy.jsx); only crash remains a light
// stub now that the Wallet + Checkout standalone pages are retired.
const ROOM_IDS = ['crash', 'agents']

// The route that gets the dark, corporate BUSINESS room palette (theme.css
// [data-room='business']) — the CHARGE page visibly shifts from the airy light
// wallet world to a serious deep-blue corporate one.
const BUSINESS_ROUTE = 'business'

// LEGACY redirects. Server-side path redirects (the old `/for-business` etc.)
// live in vercel.json; this map only handles OLD HASH links (`#/for-business`)
// — the hash never reaches the server, so the SPA converts it to the path once
// on load. Every old inbound link lands on its new home, no 404.
const LEGACY_HASH = {
  'for-business': '/business',
  businesses: '/business',
  agents: '/',
  wallet: '/',
  checkout: '/business',
}

// Per-route <title> (the visible tab name; the static per-path OG cards in
// index.html / business.html own the social previews for crawlers).
const TITLES = {
  business: 'Suize for business — get paid by AI agents',
  pricing: 'Pricing — Suize',
  docs: 'Docs — Suize',
  deploy: 'Deploy — ship a site to Walrus, paid by an agent',
}
const DEFAULT_TITLE = 'Suize — the AI wallet that makes life easier'

function routeId(route) {
  const seg = route.replace(/^\//, '').split('/')[0]
  return seg
}

// route-transition — a DIGITAL PIXEL-MELT. On a route change the screen fills
// with a grid of dithered pixel blocks tinted to the incoming room's accent;
// the blocks scatter/jitter in and then melt away (per-block staggered fade),
// revealing the new page underneath. Painted on a <canvas> with a single
// self-terminating rAF (~640ms) — it never adds a persistent loop next to
// Lenis. Under reduced motion the canvas is skipped and the CSS in sections.css
// runs a clean accent fade instead.
const MELT_MS = 640

function pixelMelt(canvas, accent) {
  const ctx = canvas.getContext('2d', { alpha: true })
  if (!ctx) return () => {}
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  const w = window.innerWidth
  const h = window.innerHeight
  canvas.width = Math.ceil(w * dpr)
  canvas.height = Math.ceil(h * dpr)
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

  // a chunky pixel grid — bigger blocks read as "digital", and keep it cheap.
  const cell = Math.max(18, Math.round(Math.min(w, h) / 26))
  const cols = Math.ceil(w / cell)
  const rows = Math.ceil(h / cell)

  // per-block phase: a random delay (the scatter) + a random melt drift. The
  // dither pattern is a Bayer-ish checker so the field reads as pixels, not a
  // flat wash.
  const blocks = []
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      blocks.push({
        x: x * cell,
        y: y * cell,
        // diagonal sweep + jitter so it melts in a direction, not all at once
        delay: ((x + y) / (cols + rows)) * 0.45 + Math.random() * 0.22,
        drift: (Math.random() - 0.2) * cell * 1.6, // downward "melt" bias
        on: (x + y) % 2 === 0 || Math.random() > 0.35,
      })
    }
  }

  let raf = 0
  const start = performance.now()
  const ease = t => 1 - Math.pow(1 - t, 3)

  const frame = now => {
    const p = Math.min(1, (now - start) / MELT_MS)
    ctx.clearRect(0, 0, w, h)
    for (const b of blocks) {
      if (!b.on) continue
      // each block: ramps to full opacity over the first half (its own delay),
      // then melts/drifts down + fades over the second half.
      const lp = Math.max(0, Math.min(1, (p - b.delay) / 0.32)) // local in
      const out = Math.max(0, Math.min(1, (p - 0.5 - b.delay * 0.4) / 0.4)) // melt out
      const alpha = ease(lp) * (1 - ease(out))
      if (alpha <= 0.01) continue
      const dy = ease(out) * b.drift
      const shrink = ease(out) * cell * 0.5
      ctx.globalAlpha = alpha
      ctx.fillStyle = accent
      ctx.fillRect(b.x, b.y + dy, cell - shrink, cell - shrink)
    }
    if (p < 1) {
      raf = requestAnimationFrame(frame)
    } else {
      ctx.clearRect(0, 0, w, h)
    }
  }
  raf = requestAnimationFrame(frame)
  return () => cancelAnimationFrame(raf)
}

function useRouteWipe(route) {
  const wipeRef = useRef(null)
  const prev = useRef(route)
  const cancelRef = useRef(null)
  useEffect(() => {
    if (prev.current === route) return
    prev.current = route
    const id = routeId(route)
    const accent =
      (ROOM_ACCENTS[id] && ROOM_ACCENTS[id]['--room-accent']) || '#4da2ff'
    const el = wipeRef.current
    if (!el) return
    el.style.setProperty('--wipe-accent', accent)
    el.classList.remove('is-running')
    // reflow so the class toggle re-triggers (covers the reduced-motion fade)
    void el.offsetWidth
    el.classList.add('is-running')

    if (prefersReducedMotion()) {
      // CSS handles the clean fade; clear the running class after it settles.
      const t = setTimeout(() => el.classList.remove('is-running'), 420)
      return () => clearTimeout(t)
    }

    // cancel any in-flight melt, then paint the new one
    cancelRef.current?.()
    cancelRef.current = pixelMelt(el, accent)
    const t = setTimeout(() => el.classList.remove('is-running'), MELT_MS + 40)
    return () => {
      clearTimeout(t)
      cancelRef.current?.()
    }
  }, [route])
  return wipeRef
}

export default function App() {
  const route = useRoute()
  const wipeRef = useRouteWipe(route)

  // boot the shared scroll/motion backbone once
  useEffect(() => {
    startMotion()
  }, [])

  // ONE-TIME on load: convert an OLD hash link (`#/for-business`, `#/pricing`)
  // to its clean path. The hash never reaches the server, so only the SPA can
  // do this; path-level legacy redirects (`/for-business` → `/business`) are
  // server-side in vercel.json.
  useEffect(() => {
    const h = window.location.hash.replace(/^#/, '')
    if (!h.startsWith('/')) return
    const seg = h.replace(/^\//, '').split('/')[0]
    const dest = LEGACY_HASH[seg] ?? (seg ? `/${seg}` : '/')
    window.history.replaceState({}, '', dest)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }, [])

  // keep the visible tab <title> in sync with the route (crawler OG cards are
  // static per-path; this is just the live tab name on SPA navigation).
  useEffect(() => {
    document.title = TITLES[routeId(route)] ?? DEFAULT_TITLE
  }, [route])

  // refresh ScrollTrigger after a route change (pinned sections recalc)
  useEffect(() => {
    const t = setTimeout(() => ScrollTrigger.refresh(), 120)
    return () => clearTimeout(t)
  }, [route])

  // Force the NEW page to the top after a route swap. The click-time scroll runs
  // on the OLD page; once the new page mounts, Lenis + the pinned ScrollTrigger
  // sections recalc their scroll and can leave you mid-page (the "had to click
  // twice" bug). Re-assert top now, next frame, and just after the refresh above.
  useEffect(() => {
    scrollTop()
    const r = requestAnimationFrame(scrollTop)
    const t = setTimeout(scrollTop, 160)
    return () => {
      cancelAnimationFrame(r)
      clearTimeout(t)
    }
  }, [route])

  // set the room palette on <html>: the business (CHARGE) page gets the dark
  // corporate deep-blue room; every other route stays the airy light home.
  useEffect(() => {
    const root = document.documentElement
    if (routeId(route) === BUSINESS_ROUTE) root.setAttribute('data-room', 'business')
    else root.removeAttribute('data-room')
    return () => root.removeAttribute('data-room')
  }, [route])

  const id = routeId(route)
  let page
  if (id === 'pricing') page = <Pricing />
  // /docs — the demoable how-it-works + quickstart explainer (one page, merged).
  else if (id === 'docs') page = <Docs />
  // /business (CHARGE) — its own named merchant page (Phase C rebuild).
  else if (id === 'business') page = <Businesses />
  // /deploy — THE featured real merchant; its own full page, not a stub.
  else if (id === 'deploy') page = <Deploy />
  else if (ROOM_IDS.includes(id)) page = <ProductStub id={id} />
  // / — the PAY/agentic home (the emotional core; absorbs the old /agents).
  else page = <Landing />

  return (
    <div className="sx-app">
      {/* the fixed backdrop behind everything — a CLEAN editorial surface
          (paper + subtle grain + faint vignette, pure CSS). The global matter
          shader is retired; the one contained shader moment lives in the hero. */}
      <Backdrop />
      {page}
      <canvas ref={wipeRef} className="sx-wipe" aria-hidden="true" />
      <CustomCursor />
    </div>
  )
}
