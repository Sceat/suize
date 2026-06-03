import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  SuiClientProvider,
  WalletProvider,
  createNetworkConfig,
} from '@mysten/dapp-kit'
import '@mysten/dapp-kit/dist/index.css'
import { App } from './App'
import './styles.css'
import { RPC_URL } from './config'
import { setup_enoki } from './enoki'

// dapp-kit builds the network client itself from { network, url }. No sui client
// class or URL helper imported here (avoids the @mysten/sui 2.x client reshuffle).
const { networkConfig } = createNetworkConfig({
  testnet: { network: 'testnet', url: RPC_URL },
})

const queryClient = new QueryClient()

// Register the Enoki zkLogin (Google) wallet BEFORE rendering so it shows up in
// dapp-kit's useWallets(). No-op (with a console hint) when env keys are absent,
// in which case the UI falls back to a standard ConnectButton.
setup_enoki()

// OAuth return path. Google redirects to `${origin}/enoki` after sign-in (the
// uri registered in the OAuth client). Enoki's wallet-standard provider parses
// the URL params internally on load; this single-page app has no router, so we
// just give Enoki a moment to flush, then drop the user back on the main screen.
// No router dependency — a 3-line redirect is all the callback needs.
if (
  typeof window !== 'undefined' &&
  window.location.pathname.startsWith('/enoki')
) {
  window.setTimeout(() => {
    window.history.replaceState({}, '', '/')
  }, 600)
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <SuiClientProvider networks={networkConfig} defaultNetwork="testnet">
        {/* autoConnect restores the previous session (incl. zkLogin) silently. */}
        <WalletProvider autoConnect>
          <App />
        </WalletProvider>
      </SuiClientProvider>
    </QueryClientProvider>
  </React.StrictMode>,
)
