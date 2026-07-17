import React from 'react'
import ReactDOM from 'react-dom/client'
import { createDAppKit } from '@mysten/dapp-kit-core'
import { DAppKitProvider } from '@mysten/dapp-kit-react'
import { App } from './App'
import { NETWORK, suiClient } from './config'
import './styles.css'

const dAppKit = createDAppKit({
  networks: [NETWORK],
  defaultNetwork: NETWORK,
  createClient: () => suiClient,
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <DAppKitProvider dAppKit={dAppKit}>
      <App />
    </DAppKitProvider>
  </React.StrictMode>,
)
