import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  SuiClientProvider,
  WalletProvider,
  createNetworkConfig,
} from '@mysten/dapp-kit'
import '@mysten/dapp-kit/dist/index.css'
import { Analytics } from '@vercel/analytics/react'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import { App } from './App'
import { Shell } from './shell/Shell'
import { Markets, House, Portfolio } from './shell/pages'
import { Leaderboard } from './screens/Leaderboard'
import { AgentScreen } from './screens/AgentScreen'
import './styles.css'
import { CRASH_NETWORK, RPC_URL } from './config'
import { setup_enoki } from './enoki'

// dapp-kit builds the network client itself from { network, url }. No sui client
// class or URL helper imported here (avoids the @mysten/sui 2.x client reshuffle).
// CRASH_NETWORK is the documented testnet pin (LOCKED #11) — never env-driven.
const { networkConfig } = createNetworkConfig({
  testnet: { network: CRASH_NETWORK, url: RPC_URL },
})

const queryClient = new QueryClient()

// Register the Enoki zkLogin (Google) wallet BEFORE rendering so it shows up in
// dapp-kit's useWallets(). No-op (with a console hint) when env keys are absent,
// in which case the UI falls back to a standard ConnectButton.
setup_enoki()

// PolySui routes. Play (`/`) is the immersive betting screen (App.tsx); the
// dashboard tabs render inside the shared <Shell> chrome. Google/Enoki redirects
// to `${origin}/enoki` after sign-in — the Enoki provider (setup_enoki above)
// parses those params on boot, so /enoki just renders Play and the Shell cleans
// the URL back to `/`. The Vercel SPA rewrite serves index.html for every path.
const router = createBrowserRouter([
  {
    element: <Shell />,
    children: [
      { path: '/', element: <App /> },
      { path: '/enoki', element: <App /> },
      { path: '/markets', element: <Markets /> },
      { path: '/house', element: <House /> },
      { path: '/portfolio', element: <Portfolio /> },
      { path: '/leaderboard', element: <Leaderboard /> },
      { path: '/agent', element: <AgentScreen /> },
      { path: '*', element: <App /> },
    ],
  },
])

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <SuiClientProvider networks={networkConfig} defaultNetwork={CRASH_NETWORK}>
        {/* autoConnect restores the previous session (incl. zkLogin) silently. */}
        <WalletProvider autoConnect>
          <RouterProvider router={router} />
          <Analytics />
        </WalletProvider>
      </SuiClientProvider>
    </QueryClientProvider>
  </React.StrictMode>,
)
