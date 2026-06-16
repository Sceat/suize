import { useCallback, useEffect, useRef, useState } from 'react'
import { ConnectButton } from '@mysten/dapp-kit'
import { useAuth } from './auth'
import { useSuizeHandle } from './suins'
import { DEPLOY_PACKAGE_PUBLISHED } from './config'
import { ShowcaseGallery } from './screens/ShowcaseGallery'
import { Dashboard } from './screens/Dashboard'
import { SiteDossier } from './screens/SiteDossier'
import { AgentsView } from './screens/AgentsView'
import { AdminView } from './screens/AdminView'
import { CustomCursor } from './CustomCursor'
import {
  IconMoon,
  IconSun,
  IdentityMenu,
  Toasts,
  useToasts,
} from './ui'

// ============================================================================
// THE DEPLOY DASHBOARD — Suize Deploy in the IMPRINT editorial palette.
// The front door is a PUBLIC SHOWCASE GALLERY of agent-deployed sites (live
// Walrus previews) — anyone, signed in or not, sees the permanent agentic web.
// Signing in (Google zkLogin) unlocks the CONSOLE: a professional dashboard
// (overview · sites · analytics) scoped to your address (main ∪ agent
// sub-accounts). Every site opens a permanence DOSSIER (live preview + the
// Walrus/integrity anchors). A no-router SPA with a small View union + a
// light/dark theme. Agents deploy over plain HTTP (the API · agents view spells
// out the contract); humans browse + manage here.
// ============================================================================

type DashTab = 'overview' | 'sites' | 'analytics'

type View =
  | { kind: 'explore' }
  | { kind: 'dashboard'; tab: DashTab }
  | { kind: 'detail'; siteId: string }
  | { kind: 'agents' }
  | { kind: 'admin' }

const THEME_KEY = 'suize-deploy.theme'

// The owner handle that unlocks the read-only admin balances tab. A CONVENIENCE
// gate (hides the tab) — NOT security: the panel shows only public on-chain data.
const ADMIN_HANDLE = 'sceat@suize'

const apply_theme = (dark: boolean): void => {
  document.documentElement.dataset.theme = dark ? 'dark' : 'light'
}

export const App = () => {
  const auth = useAuth()
  const handle = useSuizeHandle(auth.address)
  const { toasts, ok, err } = useToasts()

  const [view, setView] = useState<View>({ kind: 'explore' })
  // Where a detail / agents view returns to (the last list-like surface).
  const backRef = useRef<View>({ kind: 'explore' })

  const [dark, setDark] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false
    const saved = window.localStorage.getItem(THEME_KEY)
    if (saved) return saved === 'dark'
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false
  })

  useEffect(() => {
    apply_theme(dark)
    window.localStorage.setItem(THEME_KEY, dark ? 'dark' : 'light')
  }, [dark])

  // Remember the originating list view so detail/agents "back" returns there.
  const recordBack = useCallback((v: View) => {
    if (v.kind === 'explore' || v.kind === 'dashboard') backRef.current = v
  }, [])

  const open = useCallback(
    (siteId: string) => {
      setView(v => {
        recordBack(v)
        return { kind: 'detail', siteId }
      })
      window.scrollTo({ top: 0 })
    },
    [recordBack],
  )

  const goExplore = useCallback(() => setView({ kind: 'explore' }), [])
  const goDash = useCallback(
    (tab: DashTab = 'overview') => setView({ kind: 'dashboard', tab }),
    [],
  )
  const goAgents = useCallback(() => {
    setView(v => {
      recordBack(v)
      return { kind: 'agents' }
    })
    window.scrollTo({ top: 0 })
  }, [recordBack])
  const back = useCallback(() => setView(backRef.current), [])

  // Signed out while on a private surface (console / admin) → fall back to the
  // public gallery so we never strand the user on an empty owner-scoped page.
  useEffect(() => {
    if (!auth.address && (view.kind === 'dashboard' || view.kind === 'admin'))
      setView({ kind: 'explore' })
  }, [auth.address, view.kind])

  const onDash = view.kind === 'dashboard'
  const onExplore = view.kind === 'explore' || view.kind === 'detail'

  return (
    <div className="dx-app">
      <header className="dx-top">
        <div className="dx-masthead">
          <button
            type="button"
            className="dx-logo"
            onClick={goExplore}
            aria-label="Suize Deploy home"
          >
            <span className="dx-logo__mark">Deploy</span>
            <span className="dx-logo__sub">· by suize</span>
          </button>
          <span className="dx-masthead__tag">
            The permanent agentic web, on Walrus
          </span>
        </div>

        <nav className="dx-nav" aria-label="Primary">
          <button
            type="button"
            className={`dx-navlink${onExplore ? ' is-current' : ''}`}
            onClick={goExplore}
            title="Browse sites agents deployed to Walrus"
          >
            Explore
          </button>
          {auth.address && (
            <button
              type="button"
              className={`dx-navlink${onDash ? ' is-current' : ''}`}
              onClick={() => goDash('overview')}
              title="Your deployments, storage + subscription"
            >
              Dashboard
            </button>
          )}
          <button
            type="button"
            className={`dx-navlink${
              view.kind === 'agents' ? ' is-current' : ''
            }`}
            onClick={goAgents}
            title="Deploy from your agent (the HTTP contract)"
          >
            API · agents
          </button>
          {handle === ADMIN_HANDLE && (
            <button
              type="button"
              className={`dx-navlink${
                view.kind === 'admin' ? ' is-current' : ''
              }`}
              onClick={() => setView({ kind: 'admin' })}
              title="Service-wallet operational balances (read-only)"
            >
              Admin
            </button>
          )}
        </nav>

        <div className="dx-top__spacer" />

        <div className="dx-top__actions">
          {/* auth: Enoki Google sign-in if configured, else dapp-kit button */}
          {auth.address ? (
            <IdentityMenu
              handle={handle}
              address={auth.address}
              onSignOut={auth.sign_out}
            />
          ) : auth.enoki_enabled && auth.google_wallet ? (
            <button
              type="button"
              className="dx-btn is-sm dx-signin"
              disabled={auth.connecting}
              onClick={auth.sign_in_google}
            >
              {auth.connecting && <span className="spin" aria-hidden="true" />}
              {auth.connecting ? 'Signing in…' : 'Sign in'}
            </button>
          ) : (
            <span className="dx-connect">
              <ConnectButton connectText="Connect wallet" />
            </span>
          )}

          <button
            type="button"
            className="dx-theme"
            onClick={() => setDark(d => !d)}
            aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
            title={dark ? 'Light' : 'Dark'}
          >
            {dark ? <IconSun /> : <IconMoon />}
          </button>
        </div>
      </header>

      <main className="dx-main">
        {!DEPLOY_PACKAGE_PUBLISHED && (
          <div className="dx-banner" role="note">
            <span className="dx-banner__kicker">Heads up</span>
            <span className="dx-banner__body">
              <b>Chain pending.</b> The <code>deploy_sui</code> Move package isn't
              published to testnet yet, so on-chain Site registration is offline.
              The dashboard + backend wiring are ready; sites appear here once
              the backend's deploy module is configured + the package ships.
            </span>
          </div>
        )}

        {view.kind === 'explore' && (
          <ShowcaseGallery onOpen={open} onAgents={goAgents} />
        )}

        {/* Console is owner-scoped: render only when signed in (the signed-out
            effect above bounces here to explore, but guard defensively too). */}
        {view.kind === 'dashboard' &&
          (auth.address ? (
            <Dashboard
              owner={auth.address}
              tab={view.tab}
              onTab={t => setView({ kind: 'dashboard', tab: t })}
              onOpen={open}
              onAgents={goAgents}
              onOk={ok}
              onError={err}
            />
          ) : (
            <ShowcaseGallery onOpen={open} onAgents={goAgents} />
          ))}

        {view.kind === 'detail' && (
          <SiteDossier siteId={view.siteId} onBack={back} />
        )}

        {view.kind === 'agents' && <AgentsView onBack={back} />}

        {/* Admin is handle-gated: if the viewer is no longer the owner (signed
            out / switched account), fall back to the gallery instead of a blank. */}
        {view.kind === 'admin' &&
          (handle === ADMIN_HANDLE ? (
            <AdminView onBack={goExplore} />
          ) : (
            <ShowcaseGallery onOpen={open} onAgents={goAgents} />
          ))}
      </main>

      <Toasts toasts={toasts} />
      <CustomCursor />
    </div>
  )
}
