// ============================================================================
// Suize Deploy — dashboard config. SINGLE SOURCE OF TRUTH for network + on-chain
// ids lives in @suize/shared (LOCKED DECISION #5); we re-export the deploy ids
// here rather than duplicate the literals. The deploy package is NOT YET
// PUBLISHED, so PACKAGE_IDS.DEPLOY.* are still '0x0' PLACEHOLDERS (see
// docs/deploy/SPEC.md §13) — the dashboard never signs with them (the backend's
// own service wallet does), so they are informational only here.
// ============================================================================

import { PACKAGE_IDS } from '@suize/shared'

// Sui testnet fullnode — only needed for the optional zkLogin Enoki client.
export const RPC_URL = 'https://fullnode.testnet.sui.io:443'

// The unified backend's `deploy` module base URL. From Vite env, defaulting to
// the local backend. The route is OPEN (no auth) in the MVP.
export const DEPLOY_API_URL =
  import.meta.env.VITE_DEPLOY_API_URL?.trim().replace(/\/+$/, '') ||
  'http://localhost:8080'

// Re-export the deploy package id (PLACEHOLDER '0x0' until published). Surfaced
// in the UI footer so it's obvious when the chain side is still un-published.
export const DEPLOY_PACKAGE = PACKAGE_IDS.DEPLOY.PACKAGE

// True once move-deploy is published and shared carries a real id. Drives a
// small "chain pending" banner so the dashboard never silently implies the
// on-chain Site registry is live when it isn't.
export const DEPLOY_PACKAGE_PUBLISHED = DEPLOY_PACKAGE !== '0x0'
