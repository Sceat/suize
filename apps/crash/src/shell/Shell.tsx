import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useSuiClient } from '@mysten/dapp-kit'
import { useAuth } from '../auth'
import { resolveSuizeHandle } from '../suins'
import './shell.css'

// PolySui multi-tab shell. The fixed top nav owns the wordmark + tab routing.
// The ACCOUNT (the @suize handle + sign-in/out + theme) renders in the nav on
// the dashboard routes; on Play the immersive e05 screen keeps its own richer
// account cluster (live balance + handle), so the nav stays brand+tabs there.

const TABS = [
  { to: '/', label: 'Play', end: true },
  { to: '/markets', label: 'Markets' },
  { to: '/house', label: 'House' },
  { to: '/portfolio', label: 'Portfolio' },
  { to: '/leaderboard', label: 'Leaderboard' },
  { to: '/agent', label: 'Agent' },
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
  const [dark, toggleTheme] = useTheme()
  const loc = useLocation()
  const navigate = useNavigate()
  const onPlay = loc.pathname === '/' || loc.pathname.startsWith('/enoki')

  // Google/Enoki returns to /enoki?<params>. The Enoki provider parses those on
  // boot (main.tsx, before the router mounts), so by here the session is already
  // captured — we just clean the URL back to Play. The brief delay lets Enoki
  // flush before the route swap.
  useEffect(() => {
    if (!loc.pathname.startsWith('/enoki')) return
    const t = setTimeout(() => navigate('/', { replace: true }), 650)
    return () => clearTimeout(t)
  }, [loc.pathname, navigate])

  const short = address ? `${address.slice(0, 6)}…${address.slice(-4)}` : ''

  return (
    <div className="ps">
      <nav className="ps-nav">
        <Link to="/" className="ps-brand" aria-label="PolySui home">
          <span className="ps-mark" />
          Poly<b>Sui</b>
        </Link>
        <div className="ps-tabs">
          {TABS.map(t => (
            <NavLink
              key={t.to}
              to={t.to}
              end={t.end}
              className={({ isActive }) => 'ps-tab' + (isActive ? ' on' : '')}
            >
              {t.label}
            </NavLink>
          ))}
        </div>

        {/* On Play, the e05 screen renders its own account; only show the nav
            account on the dashboard routes so identity is never duplicated. */}
        {!onPlay && (
          <div className="ps-acct">
            {address ? (
              <>
                <span className="ps-handle tnum">{handle ?? short}</span>
                <button className="ps-link" onClick={sign_out}>
                  Sign out
                </button>
              </>
            ) : (
              <button
                className="ps-signin"
                onClick={sign_in_google}
                disabled={connecting}
              >
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
        )}
      </nav>

      <Outlet />
    </div>
  )
}
