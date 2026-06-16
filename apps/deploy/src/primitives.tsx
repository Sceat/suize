import { useEffect, useRef, useState } from 'react'
import './primitives.css'

// ============================================================================
// SHARED SHOWCASE PRIMITIVES — the new x10 building blocks, kept OUT of ui.tsx
// so screens compose them without fighting over one file. All are typeset in the
// IMPRINT editorial DNA (tokens from styles.css; Space Grotesk / Martian Mono /
// Newsreader). Namespaced `.px-*` (px = "press"). Nothing here fabricates data —
// SitePreview frames the REAL live Walrus site; charts render only what's passed.
// ============================================================================

// ---- Icons (16px grid, currentColor) — the new dossier/analytics glyphs -----

type IconProps = { size?: number }
const svg = (size: number, body: React.ReactNode, sw = 1.5): React.ReactElement => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth={sw}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {body}
  </svg>
)

export const IconLayers = ({ size = 14 }: IconProps) =>
  svg(size, <><path d="M8 2 14 5 8 8 2 5 8 2Z" /><path d="M2 8l6 3 6-3" /><path d="M2 11l6 3 6-3" /></>)
export const IconActivity = ({ size = 14 }: IconProps) =>
  svg(size, <path d="M1.5 8h3l2-5 3 10 2-5h3" />)
export const IconShield = ({ size = 14 }: IconProps) =>
  svg(size, <><path d="M8 1.8 13 3.5v4.2c0 3-2 5-5 6.4-3-1.4-5-3.4-5-6.4V3.5L8 1.8Z" /><path d="M5.8 8 7.4 9.6 10.4 6" /></>)
export const IconClock = ({ size = 14 }: IconProps) =>
  svg(size, <><circle cx="8" cy="8" r="6" /><path d="M8 4.5V8l2.4 1.6" /></>)
export const IconBox = ({ size = 14 }: IconProps) =>
  svg(size, <><path d="M8 1.7 13.5 4.6v6.8L8 14.3 2.5 11.4V4.6L8 1.7Z" /><path d="M2.5 4.6 8 7.5l5.5-2.9M8 7.5v6.8" /></>)
export const IconArrowUpRight = ({ size = 12 }: IconProps) =>
  svg(size, <path d="M5 11 11 5M6 5h5v5" />)
export const IconGrid = ({ size = 14 }: IconProps) =>
  svg(size, <><rect x="2.2" y="2.2" width="4.6" height="4.6" rx="1" /><rect x="9.2" y="2.2" width="4.6" height="4.6" rx="1" /><rect x="2.2" y="9.2" width="4.6" height="4.6" rx="1" /><rect x="9.2" y="9.2" width="4.6" height="4.6" rx="1" /></>)
export const IconSearch = ({ size = 14 }: IconProps) =>
  svg(size, <><circle cx="7" cy="7" r="4.3" /><path d="M10.2 10.2 14 14" /></>)
export const IconBolt = ({ size = 14 }: IconProps) =>
  svg(size, <path d="M9 1.5 3.5 9H7.5l-1 5.5L12.5 7H8.5l.5-5.5Z" />)

// ============================================================================
// SitePreview — a LIVE, sandboxed thumbnail of the real Walrus-served site. The
// site is rendered at a fixed desktop width and auto-scaled to the container with
// a ResizeObserver, so the card shows a faithful mini-render. Lazy-mounted via an
// IntersectionObserver (a gallery never spins up 30 cross-origin docs at once),
// pointer-events disabled (the parent card / page owns the click), and behind a
// shimmering skeleton until `onLoad`. Cold Walrus reads (multi-second) just keep
// the skeleton — never a fake "loaded". A hard frame error falls back to a calm
// poster. The sandbox blocks top-navigation/popups/forms; the framed origin is a
// different host (suize.site) so it cannot escape the sandbox.
// ============================================================================

const BASE_W = 1280
const BASE_H = 800 // 16:10 — a desktop-shaped thumbnail

export const SitePreview = ({
  url,
  title,
  eager = false,
  aspect = '16 / 10',
}: {
  url: string
  title?: string
  /** Mount the iframe immediately (the hero / dossier), skipping the IO gate. */
  eager?: boolean
  aspect?: string
}) => {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [inView, setInView] = useState(eager)
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)
  const [scale, setScale] = useState(0.25)

  // Lazy mount: only create the iframe once the card is near the viewport.
  useEffect(() => {
    if (inView) return
    const el = wrapRef.current
    if (!el || typeof IntersectionObserver === 'undefined') {
      setInView(true)
      return
    }
    const io = new IntersectionObserver(
      entries => {
        for (const e of entries)
          if (e.isIntersecting) {
            setInView(true)
            io.disconnect()
          }
      },
      { rootMargin: '300px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [inView])

  // Keep the fixed-size iframe scaled exactly to the container width.
  useEffect(() => {
    const el = wrapRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const measure = () => {
      const w = el.clientWidth
      if (w > 0) setScale(w / BASE_W)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  return (
    <div
      className="px-prev"
      ref={wrapRef}
      style={{ aspectRatio: aspect }}
      aria-hidden="true"
    >
      {!loaded && !failed && <div className="px-prev__skel" />}

      {failed && (
        <div className="px-prev__fallback">
          <IconBox size={20} />
          <span>{shortHost(url)}</span>
        </div>
      )}

      {inView && !failed && (
        <iframe
          className={`px-prev__frame${loaded ? ' is-on' : ''}`}
          src={url}
          title={title || 'Site preview'}
          loading="lazy"
          tabIndex={-1}
          scrolling="no"
          sandbox="allow-scripts allow-same-origin"
          referrerPolicy="no-referrer"
          style={{
            width: BASE_W,
            height: BASE_H,
            transform: `scale(${scale})`,
          }}
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
        />
      )}
      <span className="px-prev__sheen" />
    </div>
  )
}

const shortHost = (url: string): string =>
  url.replace(/^https?:\/\//, '').replace(/\/$/, '').slice(0, 14) + '…'

// ============================================================================
// StatFigure — a broadsheet "circulation figure": a big tabular-mono number over
// an uppercase label, with an optional sub-line and an optional inline chart.
// ============================================================================

export const StatFigure = ({
  label,
  value,
  sub,
  chart,
  tone,
}: {
  label: string
  value: React.ReactNode
  sub?: React.ReactNode
  chart?: React.ReactNode
  tone?: 'blue' | 'bull' | 'plain'
}) => (
  <div className={`px-stat${tone ? ` is-${tone}` : ''}`}>
    <span className="px-stat__label">{label}</span>
    <span className="px-stat__val tnum">{value}</span>
    {sub && <span className="px-stat__sub">{sub}</span>}
    {chart && <div className="px-stat__chart">{chart}</div>}
  </div>
)

// ============================================================================
// MiniBars — a tiny editorial bar chart (ink columns). Renders ONLY the values
// passed; an all-zero series renders flat baselines, never invented bars.
// ============================================================================

export const MiniBars = ({
  data,
  height = 46,
  title,
}: {
  data: number[]
  height?: number
  title?: string
}) => {
  const max = Math.max(1, ...data)
  return (
    <div className="px-bars" style={{ height }} title={title} role="img" aria-label={title}>
      {data.map((v, i) => (
        <span
          key={i}
          className={`px-bars__col${v > 0 ? ' is-live' : ''}`}
          style={{ height: `${Math.max(v > 0 ? 6 : 1.5, (v / max) * 100)}%` }}
        />
      ))}
    </div>
  )
}

// ============================================================================
// Sparkline — a single-stroke SVG line over a series (cumulative growth, etc.).
// ============================================================================

export const Sparkline = ({
  data,
  width = 132,
  height = 36,
}: {
  data: number[]
  width?: number
  height?: number
}) => {
  if (data.length < 2) return <div className="px-spark is-empty" style={{ width, height }} />
  const max = Math.max(...data)
  const min = Math.min(...data)
  const span = max - min || 1
  const dx = width / (data.length - 1)
  const pts = data.map((v, i) => {
    const x = i * dx
    const y = height - 4 - ((v - min) / span) * (height - 8)
    return `${x.toFixed(1)},${y.toFixed(1)}`
  })
  const d = `M${pts.join(' L')}`
  const area = `${d} L${width},${height} L0,${height} Z`
  return (
    <svg className="px-spark" width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <path className="px-spark__area" d={area} />
      <path className="px-spark__line" d={d} />
      <circle
        className="px-spark__dot"
        cx={(data.length - 1) * dx}
        cy={height - 4 - ((data[data.length - 1] - min) / span) * (height - 8)}
        r="2.4"
      />
    </svg>
  )
}

// ============================================================================
// Tabs — a quiet segmented control (the dashboard's Overview / Sites / Analytics).
// ============================================================================

export const Tabs = <T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: { id: T; label: string; icon?: React.ReactNode }[]
  value: T
  onChange: (id: T) => void
}) => (
  <div className="px-tabs" role="tablist">
    {tabs.map(t => (
      <button
        key={t.id}
        type="button"
        role="tab"
        aria-selected={value === t.id}
        className={`px-tab${value === t.id ? ' is-on' : ''}`}
        onClick={() => onChange(t.id)}
      >
        {t.icon && <span className="px-tab__ic">{t.icon}</span>}
        {t.label}
      </button>
    ))}
  </div>
)
