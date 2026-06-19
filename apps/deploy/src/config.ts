// ============================================================================
// Suize Deploy — dashboard config. SINGLE SOURCE OF TRUTH for network + on-chain
// ids lives in @suize/shared (LOCKED DECISION #5); we re-export the deploy ids
// here rather than duplicate the literals. The deploy package is NOT YET
// PUBLISHED, so PACKAGE_IDS.DEPLOY.* are still '0x0' PLACEHOLDERS (see
// apps/deploy/SPEC.md) — the dashboard never signs with them (the backend's
// own service wallet does), so they are informational only here.
// ============================================================================

import {
  PACKAGE_IDS,
  WALRUS_DEFAULTS,
  fullnodeUrl,
  resolveNetwork,
  type SuiNetwork,
} from '@suize/shared'

// Network — ENV-ONLY (VITE_SUI_NETWORK; only the exact string 'mainnet' opts in,
// anything else/unset = testnet). Never hardcoded.
export const SUI_NETWORK: SuiNetwork = resolveNetwork(import.meta.env.VITE_SUI_NETWORK)

// Sui fullnode RPC — env override (VITE_SUI_RPC_URL), defaulting to the public
// fullnode for the selected network. Only needed for the optional zkLogin Enoki client.
export const RPC_URL: string =
  import.meta.env.VITE_SUI_RPC_URL?.trim() || fullnodeUrl(SUI_NETWORK)

// The unified backend's `deploy` module base URL. `vite dev` → the local backend;
// `vite build` (prod) → https://api.suize.io. NEVER hardcode a localhost default that
// applies to prod — it bakes localhost into the deployed bundle (deploy.suize.io then
// can't reach its API + Chrome prompts about local-network access). Only VITE_DEPLOY_API_URL
// overrides, and it must be UNSET when building for prod.
export const DEPLOY_API_URL =
  import.meta.env.VITE_DEPLOY_API_URL?.trim().replace(/\/+$/, '') ||
  (import.meta.env.DEV ? 'http://localhost:8099' : 'https://api.suize.io')

// Re-export the deploy package id (PLACEHOLDER '0x0' until published). Surfaced
// in the UI footer so it's obvious when the chain side is still un-published.
export const DEPLOY_PACKAGE: string = PACKAGE_IDS.DEPLOY.PACKAGE

// The base zone sites are served under. MUST stay byte-identical to the worker's
// BASE_DOMAIN (services/deploy-worker/src/index.ts) so the on-chain reader builds
// the same `<base36(siteId)>.<DEPLOY_BASE_DOMAIN>` URL the worker resolves.
export const DEPLOY_BASE_DOMAIN = 'suize.site'

// The consumer Suize wallet — where a human funds + talks to their agent (the
// agent is what actually subscribes/acts through the Deploy API). The plan rail
// links here so "ask your agent to subscribe" has a destination.
export const SUIZE_WALLET_URL = 'https://wallet.suize.io'

// True once move-deploy is published and shared carries a real id. Drives a
// small "chain pending" banner so the dashboard never silently implies the
// on-chain Site registry is live when it isn't.
export const DEPLOY_PACKAGE_PUBLISHED = DEPLOY_PACKAGE !== '0x0'

// ============================================================================
// EXPLORER + WALRUS LINKS — the dossier surfaces a site's real on-chain + Walrus
// anchors as clickable references (the "permanence proof" is verifiable, not just
// asserted). All bases are network-aware + env-overridable. SINGLE SOURCE: the
// Walrus aggregator default lives in @suize/shared (WALRUS_DEFAULTS); we only add
// the convenience link builders here. Never fabricate a URL — every builder maps
// to a real, resolvable resource.
// ============================================================================

// The Walrus HTTP aggregator base (reads blobs). Env override → shared default.
export const WALRUS_AGGREGATOR: string =
  import.meta.env.VITE_WALRUS_AGGREGATOR?.trim().replace(/\/+$/, '') ||
  WALRUS_DEFAULTS[SUI_NETWORK].aggregator

// A Walrus blob CONTENT id → the aggregator read URL (the bytes themselves). For
// the manifest blob this returns the manifest JSON; guaranteed-resolvable.
export const walrusBlobUrl = (blobId: string): string =>
  `${WALRUS_AGGREGATOR}/v1/blobs/${encodeURIComponent(blobId)}`

// SuiVision — network-aware (mainnet host vs the `<net>.` subdomain). The
// canonical explorer for the on-chain Site object + the Walrus Blob OBJECTs.
export const SUIVISION_BASE: string =
  SUI_NETWORK === 'mainnet'
    ? 'https://suivision.xyz'
    : `https://${SUI_NETWORK}.suivision.xyz`

export const suivisionObject = (id: string): string =>
  `${SUIVISION_BASE}/object/${id}`
export const suivisionAccount = (addr: string): string =>
  `${SUIVISION_BASE}/account/${addr}`
export const suivisionTx = (digest: string): string =>
  `${SUIVISION_BASE}/txblock/${digest}`
