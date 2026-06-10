import { useCallback, useEffect, useState } from 'react'
import { ConnectButton } from '@mysten/dapp-kit'
import { useAuth } from './auth'
import { useSuizeHandle } from './suins'
import { fmt_id } from './format'
import { DEPLOY_PACKAGE_PUBLISHED } from './config'
import { SitesList } from './screens/SitesList'
import { SiteDetail } from './screens/SiteDetail'
import { DeployView } from './screens/DeployView'
import { AgentsView } from './screens/AgentsView'
import { CustomCursor } from './CustomCursor'
import {
  IconMoon,
  IconSun,
  Toasts,
  useToasts,
} from './ui'

// ============================================================================
// THE DEPLOY DASHBOARD — Suize Deploy in the Crash-by-Suize palette.
// A tiny no-router SPA with four views (list / detail / deploy / agents), an
// optional Suize-wallet (zkLogin) login that scopes "your sites" by owner (the
// EXACT Crash Google flow), and a light/dark theme toggle (token-driven, shared
// with Crash). The Agents view is the B2A heart: copy-paste deploy-from-an-agent
// instructions (curl / TS / MCP) — a first-class surface, not a footnote.
// ============================================================================

type View =
  | { kind: 'list' }
  | { kind: 'detail'; siteId: string }
  | { kind: 'deploy' }
  | { kind: 'agents' }

const THEME_KEY = 'suize-deploy.theme'

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
        </nav>

        <div className="dx-top__spacer" />

        <div className="dx-top__actions">
          {/* auth: Enoki Google sign-in if configured, else dapp-kit button */}
          {auth.address ? (
            <button
              type="button"
              className="dx-btn is-sm"
              onClick={auth.sign_out}
              title="Disconnect"
            >
              <span className="dx-acct">{handle ?? fmt_id(auth.address)}</span>
            </button>
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
            onDeploy={() => setView({ kind: 'deploy' })}
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

        {view.kind === 'deploy' && (
          <DeployView
            owner={auth.address}
            canSignIn={auth.enoki_enabled && !!auth.google_wallet}
            connecting={auth.connecting}
            onSignIn={auth.sign_in_google}
            onBack={goList}
            onOpen={open}
            onDeployed={ok}
            onError={err}
          />
        )}

        {view.kind === 'agents' && <AgentsView onBack={goList} />}
      </main>

      <Toasts toasts={toasts} />
      <CustomCursor />
    </div>
  )
}
