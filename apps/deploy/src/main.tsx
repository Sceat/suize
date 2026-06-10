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
import { fullnodeUrl } from '@suize/shared'
import { RPC_URL, SUI_NETWORK } from './config'
import { setup_enoki } from './enoki'

// dapp-kit builds the network client itself from { network, url }. Both networks
// are declared; the env-selected one (SUI_NETWORK) is the default and carries the
// env RPC override — the other keeps its public fullnode.
const { networkConfig } = createNetworkConfig({
  testnet: { network: 'testnet', url: SUI_NETWORK === 'testnet' ? RPC_URL : fullnodeUrl('testnet') },
  mainnet: { network: 'mainnet', url: SUI_NETWORK === 'mainnet' ? RPC_URL : fullnodeUrl('mainnet') },
})

const queryClient = new QueryClient()

// Register the optional Enoki Google (zkLogin) wallet BEFORE rendering so it
// appears in dapp-kit's useWallets(). No-op (with a console hint) when env keys
// are absent — the dashboard then shows a standard ConnectButton, and login is
// purely an owner filter for "your sites" (the deploy route stays open).
setup_enoki()

// OAuth return path — Google redirects to `${origin}/enoki`. Enoki parses the
// URL params on load; this single-page app has no router, so give Enoki a beat
// to flush then drop the user back on the main screen.
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
      <SuiClientProvider networks={networkConfig} defaultNetwork={SUI_NETWORK}>
        {/* autoConnect restores a previous session (incl. zkLogin) silently. */}
        <WalletProvider autoConnect>
          <App />
        </WalletProvider>
      </SuiClientProvider>
    </QueryClientProvider>
  </React.StrictMode>,
)
