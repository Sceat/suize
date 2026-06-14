import { useCallback, useEffect, useRef, useState } from 'react'
import { gsap, ScrollTrigger } from './lib/motion'

// ============================================================================
// Tiny shared UI primitives for the landing — no component library. The copy
// affordance, a couple of inline icons, the scroll-reveal hook, and a hash
// router. Shared in spirit with apps/deploy/src/ui.tsx.
// ============================================================================

export const IconCopy = ({ size = 14 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.4"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
    <path d="M10.5 5.5V4a1.5 1.5 0 0 0-1.5-1.5H4A1.5 1.5 0 0 0 2.5 4v5A1.5 1.5 0 0 0 4 10.5h1.5" />
  </svg>
)

export const IconCheck = ({ size = 14 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M3 8.5 6.5 12 13 4.5" />
  </svg>
)

// ---- Copy button --------------------------------------------------------
export const CopyButton = ({ value, label = 'Copy' }) => {
  const [done, setDone] = useState(false)
  const onCopy = useCallback(() => {
    void navigator.clipboard?.writeText(value).then(
      () => {
        setDone(true)
        window.setTimeout(() => setDone(false), 1400)
      },
      () => {},
    )
  }, [value])
  return (
    <button
      type="button"
      className={`dx-copy${done ? ' is-done' : ''}`}
      onClick={onCopy}
      aria-label={done ? 'Copied' : label}
      title={done ? 'Copied' : label}
    >
      {done ? <IconCheck /> : <IconCopy />}
    </button>
  )
}

// ---- Scroll-reveal ------------------------------------------------------
// Adds `.is-in` once the element enters the viewport (one-shot). Reduced-motion
// / no-IO falls back to immediately visible. Visibility > animation.
//
// SCRUB MODE (opt-in via `scrub`): instead of a one-shot fire-on-enter, the
// element's opacity + translate are SCRUBBED to its own scroll progress through
// the viewport (GSAP ScrollTrigger scrub) — it animates AS you scroll over it,
// not all-at-once on entry (owner: "the appearing animations are still not
// scroll-induced"). Per-element VARIETY is driven by the scrub config:
//   { from: 'up'|'down'|'left'|'right', dist, scale }
// so different sections enter from different directions / scales / rhythms.
// Reduced-motion / no-GSAP falls straight to visible (no scrub), honouring the
// motion guard. Non-scrub callers keep the EXACT original IO one-shot path.
const reduceMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true

const SCRUB_FROM = {
  up: { y: 38, x: 0 },
  down: { y: -34, x: 0 },
  left: { x: 46, y: 0 },
  right: { x: -46, y: 0 },
}

export const useReveal = (options = {}, scrub = null) => {
  const ref = useRef(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return

    // SCRUB PATH — tie opacity/translate to the element's scroll position.
    if (scrub) {
      if (reduceMotion() || typeof ScrollTrigger === 'undefined') {
        gsap?.set?.(el, { clearProps: 'all' })
        el.style.opacity = '1'
        el.style.transform = 'none'
        return
      }
      const cfg = typeof scrub === 'object' ? scrub : {}
      const dir = SCRUB_FROM[cfg.from] || SCRUB_FROM.up
      const dist = cfg.dist ?? 1
      const start = {
        opacity: 0,
        x: dir.x * dist,
        y: dir.y * dist,
        ...(cfg.scale != null ? { scale: cfg.scale } : {}),
      }
      const end = {
        opacity: 1,
        x: 0,
        y: 0,
        ...(cfg.scale != null ? { scale: 1 } : {}),
        ease: 'none',
        scrollTrigger: {
          trigger: el,
          // animate across the band where the element rises through the lower
          // ~70% of the viewport — long enough to read as scrubbed, not a snap.
          start: cfg.start || 'top 92%',
          end: cfg.end || 'top 42%',
          scrub: cfg.amount ?? 0.6,
        },
      }
      const tween = gsap.fromTo(el, start, end)
      return () => {
        tween.scrollTrigger?.kill()
        tween.kill()
      }
    }

    // DEFAULT PATH — the original one-shot IO reveal (.is-in). Unchanged.
    if (reduceMotion() || !('IntersectionObserver' in window)) {
      el.classList.add('is-in')
      return
    }
    const io = new IntersectionObserver(
      entries => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-in')
            io.unobserve(entry.target)
          }
        }
      },
      { threshold: 0, rootMargin: '0px 0px -8% 0px', ...options },
    )
    io.observe(el)
    const t = window.setTimeout(() => {
      if (!el.classList.contains('is-in')) {
        const r = el.getBoundingClientRect()
        if (r.top < window.innerHeight + 200) el.classList.add('is-in')
      }
    }, 1400)
    return () => {
      io.disconnect()
      window.clearTimeout(t)
    }
  }, [])
  return ref
}

// A reveal wrapper — streams up on scroll. `lines` switches to staggered
// line-level reveal (children animate one after another). `scrub` opts INTO the
// scroll-scrubbed mode above (pass `true` or a config object for per-section
// entrance variety); non-scrub callers are untouched (the .sx-reveal/.sx-lines
// classes + .is-in path still drive them).
export const Reveal = ({
  as: Tag = 'div',
  className = '',
  lines = false,
  scrub = null,
  children,
  ...rest
}) => {
  const ref = useReveal(undefined, scrub)
  // in scrub mode GSAP owns opacity/transform inline — skip the CSS reveal class
  // (otherwise the .sx-reveal opacity:0 would fight the tween's starting set).
  const base = scrub ? 'sx-scrub' : lines ? 'sx-lines' : 'sx-reveal'
  return (
    <Tag ref={ref} className={`${base} ${className}`} {...rest}>
      {children}
    </Tag>
  )
}

// ---- Hash router --------------------------------------------------------
// Lean, dependency-free. Routes: '/', '/pricing', '/wallet', '/checkout',
// '/deploy', '/crash'. Uses the hash so static hosting needs no rewrites.
// Scroll to the very top. Lenis (smooth scroll) keeps its own scroll position,
// so a bare window.scrollTo lands you mid-page — drive Lenis directly when
// present (immediate = no animation, reduced-motion safe), else native fallback.
export const scrollTop = () => {
  if (typeof window === 'undefined') return
  const l = window.lenis || window.__lenis
  if (l && typeof l.scrollTo === 'function') l.scrollTo(0, { immediate: true })
  else window.scrollTo(0, 0)
}

// THE ROUTER — real PATH routing (History API), no hash. URLs are clean
// (`suize.io/business`, `/pricing`) so social/crawler scrapers see the path and
// can serve a per-route OG card (a hash fragment is never sent to the server, so
// it could never have a distinct card). Deep links work because vercel.json
// serves index.html (or business.html) for every path.
export const useRoute = () => {
  const get = () => window.location.pathname || '/'
  const [route, setRoute] = useState(get)
  useEffect(() => {
    const sync = () => {
      setRoute(get())
      scrollTop()
    }
    // Intercept in-app link clicks → pushState (SPA nav, no full reload). Only
    // plain left-clicks on same-origin path links; everything else (new-tab,
    // modified click, external, download, an explicit handler that already
    // preventDefault'd via navigate()) falls through to the browser.
    const onClick = e => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)
        return
      const a = e.target.closest && e.target.closest('a[href^="/"]')
      if (!a) return
      const href = a.getAttribute('href')
      if (!href || href.startsWith('//') || a.target === '_blank' || a.hasAttribute('download')) return
      // A real file (a trailing .ext like /llms.txt, /og.png) is NOT a route —
      // let the browser fetch it instead of SPA-swallowing it.
      if (/\.[a-z0-9]+$/i.test(href.split(/[?#]/)[0])) return
      e.preventDefault()
      if (href !== window.location.pathname) window.history.pushState({}, '', href)
      sync()
    }
    window.addEventListener('popstate', sync)
    document.addEventListener('click', onClick)
    return () => {
      window.removeEventListener('popstate', sync)
      document.removeEventListener('click', onClick)
    }
  }, [])
  return route
}

// navigate() pushes a real path + notifies the router; scrolls to top so clicking
// a link to the CURRENT page (e.g. the logo while already home) still lands up top.
export const navigate = path => {
  if (path !== window.location.pathname) window.history.pushState({}, '', path)
  window.dispatchEvent(new PopStateEvent('popstate'))
  scrollTop()
}
