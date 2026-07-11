import React, { useEffect } from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { SuiClientProvider, WalletProvider, createNetworkConfig } from '@mysten/dapp-kit'
import { SuiGrpcClient } from '@mysten/sui/grpc'
import { registerEnokiWallets, isEnokiNetwork } from '@mysten/enoki'
import { Analytics } from '@vercel/analytics/react'
import '@mysten/dapp-kit/dist/index.css'
import './styles.css'
import { ENOKI_API_KEY, GOOGLE_CLIENT_ID, NETWORK, RPC_URL } from './config'
import { App } from './routes/App'

// ============================================================================
// Suize Agents — STANDALONE at agents.suize.io. ONE route: the directory page
// (no router — every path renders it). AUTH IS SELF-CONTAINED: this origin runs
// its OWN Enoki Google zkLogin (RegisterEnoki below) so a visitor can sign in
// and place an ad-slot BID without leaving the page. Reads (feed/rankings/stats/
// slots) need no session; the bid is the only write, signed LOCALLY via dapp-kit
// (non-sponsored v1 — the bidder pays their own gas). Standard wallets connect
// locally via dapp-kit too.
// ============================================================================

const { networkConfig } = createNetworkConfig({
  [NETWORK]: { network: NETWORK, url: RPC_URL },
} as Record<typeof NETWORK, { network: typeof NETWORK; url: string }>)

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
})

/**
 * Registers Enoki's seedless Google zkLogin wallet into dapp-kit (mirrors
 * apps/pay/src/main.tsx). Production keys are present, so this fires; the
 * credential check only guards the (unexpected) missing-key case, where
 * registration is a no-op and `sign_in_with_google` no-ops (Connect-a-wallet
 * still works). Enoki only supports a subset of networks (mainnet/testnet/devnet).
 */
function RegisterEnoki() {
  useEffect(() => {
    if (!ENOKI_API_KEY || !GOOGLE_CLIENT_ID) return
    if (!isEnokiNetwork(NETWORK)) return

    const client = new SuiGrpcClient({ baseUrl: RPC_URL, network: NETWORK })
    const { unregister } = registerEnokiWallets({
      apiKey: ENOKI_API_KEY,
      providers: {
        google: {
          clientId: GOOGLE_CLIENT_ID,
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
// redirect_uri is `${origin}/enoki`; the opener reads the token and closes the
// popup. If a popup ever lingers on `/enoki`, tidy its URL back to `/`.
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
        {/* autoConnect silently restores a previous session (Enoki zkLogin OR a
            standard wallet) so a return visitor can bid one-tap. */}
        <WalletProvider autoConnect>
          {enokiConfigured && <RegisterEnoki />}
          <App />
        </WalletProvider>
      </SuiClientProvider>
    </QueryClientProvider>
    <Analytics />
  </React.StrictMode>,
)
