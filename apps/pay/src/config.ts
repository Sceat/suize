// ============================================================================
// Suize Pay — config. SINGLE SOURCE OF TRUTH for network + on-chain ids lives
// in @suize/shared (LOCKED #15); this file only resolves env and re-exports.
// ============================================================================

import {
  fullnodeUrl,
  resolveNetwork,
  USDC_TYPES,
  type SuiNetwork,
} from '@suize/shared'

// Wire-shape validators — re-exported from the single source of truth so this
// app's existing `import … from './config'` call sites are untouched.
export { MAX_MEMO_LEN, SUI_ADDRESS_RE, USDC_DECIMAL_RE } from '@suize/shared'

// The app's base path — '' (vite `base: '/'`, trailing slash trimmed): the app
// is STANDALONE at pay.suize.io (owner 2026-06-11, reversing the /pay base-path
// era — the SSO bridge made the same-origin trick unnecessary). Old
// wallet.suize.io/pay/* links 307 here via the wallet's vercel redirect.
export const BASE_PATH: string = import.meta.env.BASE_URL.replace(/\/+$/, '')

// Enoki seedless Google zkLogin — pay.suize.io runs its OWN sign-in (no SSO
// popup). Same shared OAuth client the wallet uses; the redirect uri
// `${origin}/enoki` is whitelisted on it. Empty -> Enoki registration is
// skipped and `sign_in_with_google` no-ops (the Connect-a-wallet path stays).
export const ENOKI_API_KEY: string = (import.meta.env.VITE_ENOKI_API_KEY ?? '').trim()
export const GOOGLE_CLIENT_ID: string = (import.meta.env.VITE_GOOGLE_CLIENT_ID ?? '').trim()

// Network — ENV-ONLY (VITE_SUI_NETWORK; only the exact string 'mainnet' opts
// in, anything else/unset = testnet). Never hardcoded.
export const NETWORK: SuiNetwork = resolveNetwork(import.meta.env.VITE_SUI_NETWORK)

// Sui fullnode RPC — env override (VITE_SUI_RPC_URL), else the public fullnode.
export const RPC_URL: string =
  import.meta.env.VITE_SUI_RPC_URL?.trim() || fullnodeUrl(NETWORK)


// The unified backend (x402 facilitator module: GET /terms · POST /build ·
// POST /verify · POST /settle). Env override first; dev falls back to the local
// backend (services/backend .env PORT=8099), prod builds to the live API.
export const API_BASE: string = (
  import.meta.env.VITE_SUIZE_API?.trim() ||
  (import.meta.env.DEV ? 'http://localhost:8099' : 'https://api.suize.io')
).replace(/\/+$/, '')

// The settlement coin (Circle USDC for the selected network), 6 decimals.
export const USDC_TYPE: string = USDC_TYPES[NETWORK]
export const USDC_DECIMALS = 6

// Explorer link for digests shown in receipts.
export const SUIVISION_TX = (digest: string) =>
  `https://${NETWORK === 'mainnet' ? '' : NETWORK + '.'}suivision.xyz/txblock/${digest}`
