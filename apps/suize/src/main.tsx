import React from 'react'
import ReactDOM from 'react-dom/client'
import { createDAppKit } from '@mysten/dapp-kit-core'
import { DAppKitProvider } from '@mysten/dapp-kit-react'
import { SuiGrpcClient } from '@mysten/sui/grpc'
import { App } from './App'
import { NETWORK, GRPC_URL } from './config'
import './styles.css'

// dapp-kit v2 (createDAppKit): one instance, reads served by a SuiGrpcClient over
// the network-pinned gRPC base from @suize/shared. Testnet today; the single
// `networks` entry flips with VITE_SUI_NETWORK for the deferred mainnet cutover.
// `createClient`'s network arg is the broad SuiClientTypes.Network union, so we
// pass NETWORK (a @suize/shared SuiNetwork) — the only network we ever register.
const dAppKit = createDAppKit({
  networks: [NETWORK],
  defaultNetwork: NETWORK,
  createClient: () => new SuiGrpcClient({ network: NETWORK, baseUrl: GRPC_URL }),
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <DAppKitProvider dAppKit={dAppKit}>
      <App />
    </DAppKitProvider>
  </React.StrictMode>,
)
