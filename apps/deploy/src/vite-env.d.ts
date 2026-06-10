/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Sui network selection — 'mainnet' opts in; anything else/unset = testnet. */
  readonly VITE_SUI_NETWORK?: string
  /** Sui fullnode RPC override; unset = the public fullnode for VITE_SUI_NETWORK. */
  readonly VITE_SUI_RPC_URL?: string
  readonly VITE_DEPLOY_API_URL?: string
  readonly VITE_ENOKI_API_KEY?: string
  readonly VITE_GOOGLE_CLIENT_ID?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
