import { useCallback, useEffect, useState } from 'react'
import { ConnectButton } from '@mysten/dapp-kit'
import { useAuth } from './auth'
import { useSuizeHandle } from './suins'
import { DEPLOY_PACKAGE_PUBLISHED } from './config'
import { SitesList } from './screens/SitesList'
import { SiteDetail } from './screens/SiteDetail'
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
// THE DEPLOY DASHBOARD — Suize Deploy in the Crash-by-Suize palette.
// AGENTS deploy sites (this is a B2A product); humans sign in to VIEW + manage
// their agent-deployed sites. A tiny no-router SPA with views (list / detail /
// agents / admin), an optional Suize-wallet (zkLogin) login that scopes "your
// sites" by owner (the EXACT Crash Google flow), and a light/dark theme toggle.
// The Agents view is the heart + the ONLY deploy path: copy-paste deploy-from-an-
// agent instructions (curl / TS) — there is intentionally no human upload UI.
// ============================================================================

type View =
  | { kind: 'list' }
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

  const [view, setView] = useState<View>({ kind: 'list' })
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

  const open = useCallback((siteId: string) => {
    setView({ kind: 'detail', siteId })
    window.scrollTo({ top: 0 })
  }, [])

  const goList = useCallback(() => setView({ kind: 'list' }), [])

  return (
    <div className="dx-app">
      <header className="dx-top">
        <div className="dx-masthead">
          <button
            type="button"
            className="dx-logo"
            onClick={goList}
            aria-label="Suize Deploy home"
          >
            <span className="dx-logo__mark">Deploy</span>
            <span className="dx-logo__sub">· by suize</span>
          </button>
          <span className="dx-masthead__tag">
            Static sites, permanent on Walrus
          </span>
        </div>

        <nav className="dx-nav" aria-label="Primary">
          <button
            type="button"
            className={`dx-navlink${
              view.kind === 'list' || view.kind === 'detail'
                ? ' is-current'
                : ''
            }`}
            onClick={goList}
          >
            Sites
          </button>
          <button
            type="button"
            className={`dx-navlink${
              view.kind === 'agents' ? ' is-current' : ''
            }`}
            onClick={() => setView({ kind: 'agents' })}
            title="Deploy from your agent (curl / TS / MCP)"
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

        {view.kind === 'list' && (
          <SitesList
            owner={auth.address}
            canSignIn={auth.enoki_enabled && !!auth.google_wallet}
            connecting={auth.connecting}
            onSignIn={auth.sign_in_google}
            onOpen={open}
            onAgents={() => setView({ kind: 'agents' })}
          />
        )}

        {view.kind === 'detail' && (
          <SiteDetail
            siteId={view.siteId}
            viewerAddress={auth.address}
            onBack={goList}
            onLinked={ok}
            onError={err}
          />
        )}

        {view.kind === 'agents' && <AgentsView onBack={goList} />}

        {/* Admin is handle-gated: if the viewer is no longer the owner (signed out
            / switched account), fall back to the agents view instead of a blank. */}
        {view.kind === 'admin' &&
          (handle === ADMIN_HANDLE ? (
            <AdminView onBack={goList} />
          ) : (
            <AgentsView onBack={goList} />
          ))}
      </main>

      <Toasts toasts={toasts} />
      <CustomCursor />
    </div>
  )
}
