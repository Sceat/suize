// ============================================================================
// Suize Deploy — dashboard config. SINGLE SOURCE OF TRUTH for network + on-chain
// ids lives in @suize/shared (LOCKED DECISION #5); we re-export the deploy ids
// here rather than duplicate the literals. The deploy package is NOT YET
// PUBLISHED, so PACKAGE_IDS.DEPLOY.* are still '0x0' PLACEHOLDERS (see
// docs/deploy/SPEC.md §13) — the dashboard never signs with them (the backend's
// own service wallet does), so they are informational only here.
// ============================================================================

import { PACKAGE_IDS, fullnodeUrl, resolveNetwork, type SuiNetwork } from '@suize/shared'

// Network — ENV-ONLY (VITE_SUI_NETWORK; only the exact string 'mainnet' opts in,
// anything else/unset = testnet). Never hardcoded.
export const SUI_NETWORK: SuiNetwork = resolveNetwork(import.meta.env.VITE_SUI_NETWORK)

// Sui fullnode RPC — env override (VITE_SUI_RPC_URL), defaulting to the public
// fullnode for the selected network. Only needed for the optional zkLogin Enoki client.
export const RPC_URL: string =
  import.meta.env.VITE_SUI_RPC_URL?.trim() || fullnodeUrl(SUI_NETWORK)

// The unified backend's `deploy` module base URL. From Vite env, defaulting to
// the local backend. The route is OPEN (no auth) in the MVP.
export const DEPLOY_API_URL =
  import.meta.env.VITE_DEPLOY_API_URL?.trim().replace(/\/+$/, '') ||
  'http://localhost:8080'

// Re-export the deploy package id (PLACEHOLDER '0x0' until published). Surfaced
// in the UI footer so it's obvious when the chain side is still un-published.
export const DEPLOY_PACKAGE: string = PACKAGE_IDS.DEPLOY.PACKAGE

// The base zone sites are served under. MUST stay byte-identical to the worker's
// BASE_DOMAIN (services/deploy-worker/src/index.ts) so the on-chain reader builds
// the same `<base36(siteId)>.<DEPLOY_BASE_DOMAIN>` URL the worker resolves.
export const DEPLOY_BASE_DOMAIN = 'suize.site'

// True once move-deploy is published and shared carries a real id. Drives a
// small "chain pending" banner so the dashboard never silently implies the
// on-chain Site registry is live when it isn't.
export const DEPLOY_PACKAGE_PUBLISHED = DEPLOY_PACKAGE !== '0x0'
