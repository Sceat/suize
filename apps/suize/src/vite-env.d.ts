/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 'mainnet' opts in; anything else/unset = testnet (see @suize/shared resolveNetwork). */
  readonly VITE_SUI_NETWORK?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
