import React, { useEffect } from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { SuiClientProvider, WalletProvider, createNetworkConfig } from '@mysten/dapp-kit'
import { SuiJsonRpcClient } from '@mysten/sui/jsonRpc'
import { registerEnokiWallets, isEnokiNetwork } from '@mysten/enoki'
import '@mysten/dapp-kit/dist/index.css'
import './styles.css'
import { ENOKI_API_KEY, GOOGLE_CLIENT_ID, NETWORK, RPC_URL } from './config'
import { Shell } from './ui'
import { PayPage } from './routes/PayPage'

// ============================================================================
// Suize Pay — STANDALONE at pay.suize.io (owner 2026-06-11; base '/'):
//   /          the pay page (terms in the query string) — the ONLY route
// AUTH IS SELF-CONTAINED (owner 2026-06-14): this origin runs its OWN Enoki
// Google zkLogin (RegisterEnoki below) — no SSO bridge, no /confirm money
// popup. Signing in mints a session ON THIS ORIGIN; the inline pay() signs the
// gasless bytes locally and settles via the facilitator. Standard wallets still
// connect locally via dapp-kit — local signing, not identity.
// No router at all — every path (incl. the retired /connect and /start, and
// legacy /pay-prefixed links) renders the pay page; the terms live in the
// query string, which survives any path.
// ============================================================================

const { networkConfig } = createNetworkConfig({
  [NETWORK]: { network: NETWORK, url: RPC_URL },
} as Record<typeof NETWORK, { network: typeof NETWORK; url: string }>)

const queryClient = new QueryClient()

/**
 * Registers Enoki's seedless Google zkLogin wallet into dapp-kit (mirrors the
 * wallet app's providers.tsx). Production keys are present, so this fires; the
 * credential check only guards the (unexpected) missing-key case, where
 * registration is a no-op and `sign_in_with_google` no-ops (Connect-a-wallet
 * still works). Enoki only supports a subset of networks (mainnet/testnet/devnet).
 */
function RegisterEnoki() {
  useEffect(() => {
    if (!ENOKI_API_KEY || !GOOGLE_CLIENT_ID) return
    if (!isEnokiNetwork(NETWORK)) return

    const client = new SuiJsonRpcClient({ url: RPC_URL, network: NETWORK })
    const { unregister } = registerEnokiWallets({
      apiKey: ENOKI_API_KEY,
      providers: {
        google: {
          clientId: GOOGLE_CLIENT_ID,
          // Google returns the user to this EXACT uri after auth; it must be in
          // the OAuth client's "Authorized redirect URIs". `${origin}/enoki` is
          // the path the shared OAuth client whitelists; the flush below tidies
          // it back to / on return.
          redirectUrl:
            typeof window !== 'undefined' ? `${window.location.origin}/enoki` : undefined,
        },
      },
      client,
      network: NETWORK,
    })
    return unregister
  }, [])

  return null
}

// OAuth return path. Enoki's `registerEnokiWallets` login is a POPUP whose
// redirect_uri is `${origin}/enoki`; the opener reads the token and closes that
// popup. If a popup ever lingers on `/enoki`, tidy its URL back to `/` — the
// session is already restored by then.
if (typeof window !== 'undefined' && window.location.pathname.startsWith('/enoki')) {
  window.setTimeout(() => {
    window.history.replaceState({}, '', '/')
  }, 600)
}

const enokiConfigured = Boolean(ENOKI_API_KEY && GOOGLE_CLIENT_ID)

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <SuiClientProvider networks={networkConfig} defaultNetwork={NETWORK}>
        {/* autoConnect silently restores the previous session — Enoki zkLogin
            OR a standard wallet — so return visits open ready to pay. */}
        <WalletProvider autoConnect>
          {enokiConfigured && <RegisterEnoki />}
          <Shell>
            <PayPage />
          </Shell>
        </WalletProvider>
      </SuiClientProvider>
    </QueryClientProvider>
  </React.StrictMode>,
)
