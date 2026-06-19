import { useEffect, useState, type ReactNode } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useSuiClient } from '@mysten/dapp-kit'
import { useAuth } from '../auth'
import { resolveSuizeHandle } from '../suins'
import { DUSDC_TYPE } from '../config'
import { fmt_usd } from '../format'
import './shell.css'

// The PAY wallet — where the navbar "Open wallet" button sends you to manage
// funds. (Recovery of any game-account balance is automatic on load.)
const WALLET_URL = 'https://wallet.suize.io'

// PolySui multi-tab shell — "The Masthead Rule" (marketing/POLYSUI-UI-LAW.md +
// the navbar redesign). A broadsheet nameplate: the PolySui wordmark is built
// from TYPE (Newsreader 'Poly' + Space Grotesk 'Sui' + a 2px blue tide-rule),
// and the SAME 2px stroke is every active-tab underline. Six peer tabs — Play /
// Markets / House / Portfolio / Leaderboard / Agent — Agent is a real tab (the
// wedge), not a chip. Desktop = top nav; mobile = a 6-up bottom bar.

type Tab = { to: string; label: string; end?: boolean; wedge?: boolean; icon: ReactNode }

const I = (d: string, fill = false) => (
  <svg viewBox="0 0 24 24" fill={fill ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    {d.split('|').map((p, i) => (
      <path key={i} d={p} />
    ))}
  </svg>
)

const TABS: Tab[] = [
  { to: '/', label: 'Play', end: true, icon: I('M3 12h3.5l2.5-7 4 14 2.5-7H21') },
  { to: '/markets', label: 'Markets', icon: I('M4 5h7v6H4z|M13 5h7v4h-7z|M4 13h7v6H4z|M13 11h7v8h-7z') },
  { to: '/house', label: 'House', icon: I('M3 10.5 12 4l9 6.5|M5 9.5V20h14V9.5') },
  { to: '/portfolio', label: 'Portfolio', icon: I('M3 7.5h18v12H3z|M8 7.5V5.5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2') },
  { to: '/leaderboard', label: 'Leaderboard', icon: I('M6 20v-7|M12 20V4|M18 20v-10') },
  { to: '/agent', label: 'Agent', wedge: true, icon: I('M12 3l1.7 5.3L19 10l-5.3 1.7L12 17l-1.7-5.3L5 10l5.3-1.7z', true) },
]

const THEME_KEY = 'crash:theme' // shared with the e05 screen so both stay in sync

function useTheme(): [boolean, () => void] {
  const [dark, setDark] = useState<boolean>(() => {
    try {
      const v = localStorage.getItem(THEME_KEY)
      if (v === 'dark') return true
      if (v === 'light') return false
    } catch {
      /* ignore */
    }
    return Boolean(window.matchMedia?.('(prefers-color-scheme: dark)').matches)
  })
  useEffect(() => {
    if (dark) document.documentElement.dataset.theme = 'dark'
    else delete document.documentElement.dataset.theme
    try {
      localStorage.setItem(THEME_KEY, dark ? 'dark' : 'light')
    } catch {
      /* ignore */
    }
  }, [dark])
  return [dark, () => setDark(d => !d)]
}

function useHandle(address: string | null): string | null {
  const client = useSuiClient()
  const [handle, setHandle] = useState<string | null>(null)
  useEffect(() => {
    setHandle(null)
    if (!address) return
    let alive = true
    resolveSuizeHandle(address, client).then(h => {
      if (alive) setHandle(h)
    })
    return () => {
      alive = false
    }
  }, [address, client])
  return handle
}

// The connected wallet's dUSDC balance (the nav money figure). Polled gently;
// best-effort — a hiccup leaves the last good value rather than blanking.
function useBalance(address: string | null): bigint | null {
  const client = useSuiClient()
  const [bal, setBal] = useState<bigint | null>(null)
  useEffect(() => {
    if (!address) {
      setBal(null)
      return
    }
    let alive = true
    const read = () =>
      client
        .getBalance({ owner: address, coinType: DUSDC_TYPE })
        .then(r => {
          if (alive) setBal(BigInt(r.totalBalance))
        })
        .catch(() => {})
    read()
    const id = setInterval(read, 15_000)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [address, client])
  return bal
}

const SunIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </svg>
)
const MoonIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
  </svg>
)

export function Shell() {
  const { address, sign_in_google, sign_out, connecting } = useAuth()
  const handle = useHandle(address)
  const balance = useBalance(address)
  const [dark, toggleTheme] = useTheme()
  const loc = useLocation()
  const navigate = useNavigate()

  // Google/Enoki returns to /enoki?<params>; the Enoki provider parses those on
  // boot (main.tsx) before the router mounts, so by here the session is captured
  // — we just clean the URL back to Play once Enoki has flushed.
  useEffect(() => {
    if (!loc.pathname.startsWith('/enoki')) return
    const t = setTimeout(() => navigate('/', { replace: true }), 650)
    return () => clearTimeout(t)
  }, [loc.pathname, navigate])

  const short = address ? `${address.slice(0, 6)}…${address.slice(-4)}` : ''

  return (
    <div className="ps">
      {/* ambient layers — engineering-paper grid + floor-glow under, film grain over */}
      <div className="ps-backdrop" aria-hidden="true" />
      <div className="ps-grain" aria-hidden="true" />

      <nav className="ps-nav">
        <Link to="/" className="ps-brand" aria-label="PolySui home">
          <span className="ps-word">PolySui</span>
        </Link>

        <div className="ps-tabs">
          {TABS.map(t => (
            <NavLink
              key={t.to}
              to={t.to}
              end={t.end}
              className={({ isActive }) =>
                'ps-tab' + (isActive ? ' on' : '') + (t.wedge ? ' wedge' : '')
              }
            >
              {t.label}
            </NavLink>
          ))}
        </div>

        <div className="ps-right">
          {/* The shell owns identity on EVERY route (incl. Play) so login is
              always visible; the e05 screen's own account cluster is hidden. */}
          {address ? (
            <>
              {balance != null && (
                <span className="ps-bal tnum">
                  <i>{fmt_usd(balance)}</i>
                  <em>dUSDC</em>
                </span>
              )}
              <span className="ps-handle tnum">{handle ?? short}</span>
              <button
                className="ps-link"
                onClick={() => window.open(WALLET_URL, '_blank', 'noopener')}
              >
                Open wallet
              </button>
              <button className="ps-link" onClick={sign_out}>
                Sign out
              </button>
            </>
          ) : (
            <button className="ps-signin" onClick={sign_in_google} disabled={connecting}>
              {connecting ? 'Signing in…' : 'Sign in'}
            </button>
          )}

          <button
            className="ps-theme"
            onClick={toggleTheme}
            aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {dark ? SunIcon : MoonIcon}
          </button>
        </div>
      </nav>

      <Outlet />

      {/* mobile-first bottom tab bar — 6 tabs incl. Agent, Play default. CSS
          shows it ≤720px and hides the top tab index. */}
      <nav className="ps-bottom">
        {TABS.map(t => (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.end}
            className={({ isActive }) => 'ps-btab' + (isActive ? ' on' : '')}
          >
            <span className="ps-btab-ico">{t.icon}</span>
            {t.label}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
