// ============================================================================
// THE PERFORMANCE BACKBONE — one shared clock for the whole page.
//
//   gsap.ticker  →  drives lenis.raf  →  drives ScrollTrigger.update
//   the SAME elapsed time feeds OGL's shader uTime (subscribers below).
//
// Never run separate requestAnimationFrame loops. Components that need the
// frame clock (the hero shader) subscribe via onTick(); they get the shared
// elapsed seconds, so scroll + reveals + shader share one heartbeat.
// ============================================================================
import Lenis from 'lenis'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { SplitText } from 'gsap/SplitText'

// Register the plugins ONCE for the whole app (GSAP 3.13+ ships SplitText free).
// SplitText drives the hero headline line-stagger; ScrollTrigger drives every
// scrubbed/pinned beat. Both ride the single shared ticker below.
gsap.registerPlugin(ScrollTrigger, SplitText)

let lenis = null
let started = false
const tickers = new Set() // (elapsedSeconds, deltaSeconds) => void

// THE DIVE PROGRESS — 0 (surface) .. 1 (the floor). Computed once per shared
// tick from lenis.scroll / maxScroll; the OceanScene reads it via getDepth()
// and eases it into uDepth. No second rAF, no extra scroll listener.
let _depth = 0
export const getDepth = () => _depth

// ---- capability detection ---------------------------------------------------
export const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true

export const isTouch = () =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(hover: none), (pointer: coarse)').matches === true

// low-power heuristic: small/coarse device OR very few logical cores. Used to
// swap the live shader for the static poster (the WPO score AAA sites hit).
export const isLowPower = () => {
  if (typeof window === 'undefined') return true
  if (prefersReducedMotion()) return true
  const cores = navigator.hardwareConcurrency || 8
  const smallCoarse = isTouch() && Math.min(window.innerWidth, window.innerHeight) < 700
  return cores <= 4 || smallCoarse
}

// the page should run the live canvas shader at all?
export const shadersEnabled = () => !prefersReducedMotion() && !isLowPower()

// ---- the shared clock -------------------------------------------------------
export function startMotion() {
  if (started || typeof window === 'undefined') return getLenis()
  started = true

  const reduce = prefersReducedMotion()

  // Lenis owns smooth scroll. On reduced-motion / touch we let native scroll
  // run (no smoothing) but still keep ScrollTrigger in sync via the ticker.
  lenis = new Lenis({
    duration: 1.1,
    easing: t => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
    smoothWheel: !reduce && !isTouch(),
    syncTouch: false,
    wheelMultiplier: 1,
    touchMultiplier: 1.4,
  })

  lenis.on('scroll', ScrollTrigger.update)

  // expose for tooling / deep-link scrolls (harmless; read-only handle)
  if (typeof window !== 'undefined') window.__lenis = lenis

  gsap.ticker.lagSmoothing(0)
  gsap.ticker.add(time => {
    // gsap time is in seconds; lenis.raf wants ms
    lenis.raf(time * 1000)
    // the dive progress — fed from the SAME clock (scene reads it via getDepth)
    const max = document.documentElement.scrollHeight - window.innerHeight
    _depth = max > 0 ? Math.min(1, Math.max(0, lenis.scroll / max)) : 0
    const now = time
    const dt = gsap.ticker.deltaRatio() / 60 // ~seconds since last frame
    for (const fn of tickers) {
      try {
        fn(now, dt)
      } catch (e) {
        /* a single bad subscriber never kills the loop */
      }
    }
  })

  return lenis
}

export function getLenis() {
  return lenis
}

export function onTick(fn) {
  tickers.add(fn)
  return () => tickers.delete(fn)
}

// ---- bento cursor-glow + tilt ----------------------------------------------
// Wire a bento grid: ONE pointermove (throttled to the shared frame, never a
// second rAF) writes --mx/--my on the hovered feature card for the cursor-glow,
// and rides a GSAP quickTo for a ±4° tilt. quickTo uses gsap.ticker — the SAME
// clock as the shared loop, so no extra animation frame is started. Returns a
// cleanup fn. No-op under reduced motion (the CSS already kills the glow/tilt).
export function mountBentoGlow(grid) {
  if (!grid || prefersReducedMotion()) return () => {}
  const cards = Array.from(grid.querySelectorAll('.sx-card--feature'))
  if (!cards.length) return () => {}

  // per-card tilt drivers (quickTo lazily creates a tween on first call)
  const tilts = cards.map(card => ({
    card,
    rx: gsap.quickTo(card, 'rotationX', { duration: 0.5, ease: 'power3' }),
    ry: gsap.quickTo(card, 'rotationY', { duration: 0.5, ease: 'power3' }),
  }))

  let pending = null // the latest event, applied once per frame
  const apply = () => {
    const e = pending
    pending = null
    if (!e) return
    for (const { card, rx, ry } of tilts) {
      const r = card.getBoundingClientRect()
      const px = (e.clientX - r.left) / r.width
      const py = (e.clientY - r.top) / r.height
      const inside = px >= 0 && px <= 1 && py >= 0 && py <= 1
      if (inside) {
        card.style.setProperty('--mx', `${px * 100}%`)
        card.style.setProperty('--my', `${py * 100}%`)
        ry(gsap.utils.clamp(-4, 4, (px - 0.5) * 8))
        rx(gsap.utils.clamp(-4, 4, (0.5 - py) * 8))
      } else {
        rx(0)
        ry(0)
      }
    }
  }

  // throttle to one apply per shared frame
  const off = onTick(apply)
  const onMove = e => {
    pending = e
  }
  const onLeave = () => {
    pending = null
    for (const { rx, ry } of tilts) {
      rx(0)
      ry(0)
    }
  }
  grid.addEventListener('pointermove', onMove, { passive: true })
  grid.addEventListener('pointerleave', onLeave)

  return () => {
    off()
    grid.removeEventListener('pointermove', onMove)
    grid.removeEventListener('pointerleave', onLeave)
    for (const { card } of tilts) {
      gsap.set(card, { clearProps: 'rotationX,rotationY' })
    }
  }
}

// ---- hero headline line-stagger --------------------------------------------
// SplitText the hero H1 into lines and stagger them up from a clipped parent
// (§6: yPercent 110→0, stagger .06, expo.out). Re-splits debounced on resize
// (SplitText reflows), then refreshes ScrollTrigger. No-op under reduced motion
// (the CSS poster reveal already shows the headline). Returns a cleanup fn.
export function splitHeadline(el) {
  if (!el || prefersReducedMotion()) return () => {}

  let split = null
  let tween = null
  let raf = 0

  const run = () => {
    split?.revert()
    split = new SplitText(el, { type: 'lines', linesClass: 'sx-splitline' })
    // each line rides up out of its own clip (the .sx-splitline overflow)
    tween = gsap.fromTo(
      split.lines,
      { yPercent: 110 },
      {
        yPercent: 0,
        duration: 0.95,
        stagger: 0.06,
        ease: 'expo.out',
        delay: 0.08,
      },
    )
  }

  // wait a frame so web fonts have a chance to settle before the first split
  raf = requestAnimationFrame(run)

  let t = 0
  const onResize = () => {
    clearTimeout(t)
    t = setTimeout(() => {
      run()
      ScrollTrigger.refresh()
    }, 180)
  }
  window.addEventListener('resize', onResize)

  return () => {
    cancelAnimationFrame(raf)
    clearTimeout(t)
    window.removeEventListener('resize', onResize)
    tween?.kill()
    split?.revert()
  }
}

export { gsap, ScrollTrigger, SplitText }
