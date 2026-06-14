/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUI_NETWORK?: string
  readonly VITE_SUI_RPC_URL?: string
  readonly VITE_SUIZE_API?: string
  readonly VITE_ENOKI_API_KEY?: string
  readonly VITE_GOOGLE_CLIENT_ID?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
