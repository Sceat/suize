import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useSuiClient } from '@mysten/dapp-kit'
import { useAuth } from './auth'
import { reverseResolve, type ReverseClient } from './suins'
import { formatUsdc } from './api'
import { BASE_PATH } from './config'

// ============================================================================
// Shared UI atoms for the Settlement Tape. Everything text-only renders via
// React's normal escaping — NO chain-supplied value (creative, handle, memo)
// ever lands in markup. House gradient laws (styles.css): money figures + hex
// addresses wear BLUE (.money / .num / .mono), @suize handles wear RED/ORANGE
// (.handle). Liveness is carried by typography + the data's own motion — there
// is NO status diode anywhere in this app.
// ============================================================================

// Session-lived reverse-name cache — feed/rankings/slot rows repeat the same
// addresses across re-renders + polls; ONE RPC per address. RPC failures are NOT
// cached (a later mount retries); a definitive "no name" is.
const name_cache = new Map<string, string | null>()

/** Reverse-resolve an address to its @suize handle (display form). Null while
 * pending or when no SuiNS name exists — callers fall back to the short hex,
 * never block on this. A pre-resolved handle (from the backend) short-circuits
 * the lookup entirely. */
export function useReverseName(address: string | null, preresolved?: string | null): string | null {
  const client = useSuiClient()
  const [name, setName] = useState<string | null>(() =>
    preresolved ?? (address ? (name_cache.get(address) ?? null) : null),
  )
  useEffect(() => {
    if (preresolved) {
      setName(preresolved)
      return
    }
    if (!address) {
      setName(null)
      return
    }
    if (name_cache.has(address)) {
      setName(name_cache.get(address) ?? null)
      return
    }
    let alive = true
    reverseResolve(client as unknown as ReverseClient, address)
      .then((resolved) => {
        name_cache.set(address, resolved)
        if (alive) setName(resolved)
      })
      .catch(() => {
        if (alive) setName(null) // chain unreadable — hex fallback, retry next mount
      })
    return () => {
      alive = false
    }
  }, [address, client, preresolved])
  return name
}

export const shortAddr = (a: string): string =>
  a.length > 14 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a

/** "12s" / "4m" / "2h" / "3d" — compact relative time from an epoch-ms stamp. */
export function relativeTime(ms: number, now: number = Date.now()): string {
  const s = Math.max(0, Math.floor((now - ms) / 1000))
  if (s < 5) return 'now'
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  const d = Math.floor(h / 24)
  return `${d}d`
}

/** Tick a clock so relative times + "last {age}" labels re-render without a
 *  network round-trip — a number that increments is unmistakably live and needs
 *  no lamp. (Lives here so the whole page can share one clock.) */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}

/** A merchant's DISPLAY name in the directory: the `@suize` handle stripped of its
 *  suffix and capitalised ("deploy@suize" → "Deploy"). Any other SuiNS name keeps its
 *  shape but capitalises. Null/empty → null (the caller falls back to the short hex). */
export function merchantName(handle: string | null | undefined): string | null {
  const h = (handle ?? '').trim()
  if (!h) return null
  const base = h.endsWith('@suize') ? h.slice(0, -'@suize'.length) : h
  if (!base) return null
  return base.charAt(0).toUpperCase() + base.slice(1)
}

/** The "claim price" of a slot: +10 % over the standing price, ceiled to a whole USDC
 *  dollar so it shows as a single clean number with NO decimals — and is always
 *  strictly greater than the standing price (the on-chain win condition). Returns a
 *  base-unit string for <Money> (e.g. price $50 → "55000000" → "$55"). Floor $1. */
export function claimPrice(priceAtomic: string): string {
  let p: bigint
  try {
    p = BigInt(priceAtomic)
  } catch {
    p = 0n
  }
  const tenPct = (p * 11n) / 10n // price × 1.1, atomic (integer-truncated)
  let dollars = (tenPct + 999_999n) / 1_000_000n // ceil to whole dollars
  if (dollars < 1n) dollars = 1n
  return (dollars * 1_000_000n).toString()
}

/** A parsed ad creative. An agent posts the slot's creative as a small JSON object —
 *  `{ "img": "<https banner>", "desc": "<≤160 chars>", "url": "<https website>" }` —
 *  and the card renders a banner image, a description, and links to the website. We
 *  validate every field (https only; data:image allowed for img; desc clamped to 160)
 *  so a chain-supplied string can never inject markup or a javascript: URL. A legacy
 *  bare-URL / bare-text creative still renders (url / text fallback). */
export type Creative = { img?: string; desc?: string; url?: string; text?: string }

const isHttps = (u: string): boolean => /^https:\/\//i.test(u)
const isImgSrc = (u: string): boolean => isHttps(u) || /^data:image\/[a-z+]+;/i.test(u)

export function parseCreative(raw: string): Creative {
  const s = (raw ?? '').trim()
  if (!s) return {}
  if (s.startsWith('{')) {
    try {
      const o = JSON.parse(s) as Record<string, unknown>
      const img = typeof o.img === 'string' && isImgSrc(o.img.trim()) ? o.img.trim() : undefined
      const url = typeof o.url === 'string' && isHttps(o.url.trim()) ? o.url.trim() : undefined
      const desc =
        typeof o.desc === 'string' && o.desc.trim() ? o.desc.trim().slice(0, 160) : undefined
      if (img || url || desc) return { img, url, desc }
    } catch {
      /* not JSON — fall through to the legacy plain-string handling */
    }
  }
  if (isHttps(s)) return { url: s }
  return { text: s.slice(0, 160) }
}

/** Compact USD from a BASE-UNIT string: 30499.5 → "30.5k", 1_234_567 → "1.2M", under
 *  1000 stays exact ("462", "0.55"). For big headline figures (volume) where precision
 *  isn't the point. `k` is lower-case (house style); M/B stay upper. No `$`. */
export function compactUsd(atomic: string): string {
  let n: number
  try {
    n = Number(BigInt(atomic)) / 1e6
  } catch {
    n = 0
  }
  if (n < 1000) return n.toLocaleString('en-US', { maximumFractionDigits: 2 })
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 })
    .format(n)
    .replace('K', 'k')
}

/** A money figure with the blue gradient. Takes a BASE-UNIT string and renders
 *  "$X.XX" (USDC ≈ USD on this rail). `compact` shows the abbreviated form ("$30.5k").
 *  The unit `$` joins the gradient via .money. */
export function Money({
  atomic,
  compact = false,
  className = '',
}: {
  atomic: string
  compact?: boolean
  className?: string
}) {
  let display: string
  try {
    display = compact ? compactUsd(atomic) : formatUsdc(BigInt(atomic))
  } catch {
    display = '0'
  }
  return <span className={`money ${className}`}>${display}</span>
}

/** An identity cell: the @suize handle (red/orange gradient) when one resolves,
 *  else the short hex (blue mono — a hex address is a number). `preresolved`
 *  short-circuits the on-chain lookup. */
export function Identity({
  address,
  handle,
  className = '',
}: {
  address: string
  handle?: string | null
  className?: string
}) {
  const name = useReverseName(address, handle ?? undefined)
  return name ? (
    <span className={`handle ${className}`}>{name}</span>
  ) : (
    <span className={`mono ${className}`}>{shortAddr(address)}</span>
  )
}

export function Busy({ children }: { children: ReactNode }) {
  return (
    <div className="ag-busy">
      <span className="spin" aria-hidden />
      <span>{children}</span>
    </div>
  )
}

// ── Theme ────────────────────────────────────────────────────────────────────

const THEME_KEY = 'agents-theme'

const IconSun = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.4"
    strokeLinecap="round"
    aria-hidden="true"
  >
    <circle cx="8" cy="8" r="3" />
    <path d="M8 1v1.5M8 13.5V15M1 8h1.5M13.5 8H15M3 3l1 1M12 12l1 1M13 3l-1 1M4 12l-1 1" />
  </svg>
)

const IconMoon = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.4"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M13 9.5A5.5 5.5 0 0 1 6.5 3a5.5 5.5 0 1 0 6.5 6.5Z" />
  </svg>
)

/** The borderless theme toggle (owner law #4): a single icon glyph, hover-tint
 *  the ONLY affordance — never a bordered chip / pill / sliding track. Reads the
 *  initial theme from localStorage → falls back to prefers-color-scheme; LIGHT is
 *  the default when unset. Mirrors Deploy's App.tsx theme effect. */
export function ThemeToggle() {
  const [dark, setDark] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false
    const saved = window.localStorage.getItem(THEME_KEY)
    if (saved) return saved === 'dark'
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false
  })
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light'
    try {
      window.localStorage.setItem(THEME_KEY, dark ? 'dark' : 'light')
    } catch {
      /* private mode — the toggle still works for the session */
    }
  }, [dark])
  return (
    <button
      type="button"
      className="ag-theme"
      onClick={() => setDark((d) => !d)}
      aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
      title={dark ? 'Light' : 'Dark'}
    >
      {dark ? <IconSun /> : <IconMoon />}
    </button>
  )
}

/** A numeral that one-shot-flashes toward blue when its value changes (the
 *  tasteful index-strip tick; respects prefers-reduced-motion via the CSS). */
export function Ticking({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLSpanElement>(null)
  const prev = useRef<string>('')
  const key = String(children)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (prev.current !== '' && prev.current !== key) {
      el.classList.remove('ag-tick')
      // force reflow so the animation re-fires on each change
      void el.offsetWidth
      el.classList.add('ag-tick')
    }
    prev.current = key
  }, [key])
  return (
    <span ref={ref} className="ag-index__val">
      {children}
    </span>
  )
}

// ── Shell — the masthead + the editorial column ──────────────────────────────

export function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="ag-app">
      <header className="ag-top">
        <a className="ag-logo" href={BASE_PATH || '/'} aria-label="Suize Agents home">
          <span className="ag-logo__mark">Suize</span>
          <span className="ag-logo__sub">· agents</span>
        </a>
        <span className="ag-top__hair" aria-hidden />
        <span className="ag-eyebrow">Settlement Tape</span>
        <span className="ag-top__spacer" />
        <div className="ag-top__actions">
          <SessionBadge />
          <ThemeToggle />
        </div>
      </header>
      <main className="ag-main">{children}</main>
    </div>
  )
}

function SessionBadge() {
  const { address, wallet_label, sign_out } = useAuth()
  const name = useReverseName(address)
  if (!address) return null
  return (
    <div className="ag-session">
      <span className="ag-session__label">{wallet_label}</span>
      {name ? <span className="handle">{name}</span> : <span className="mono">{shortAddr(address)}</span>}
      <button className="ag-session__out" onClick={sign_out}>
        Switch
      </button>
    </div>
  )
}
