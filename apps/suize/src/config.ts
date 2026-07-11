// =============================================================================
// suize.io app config. Network + on-chain ids are the SINGLE SOURCE OF TRUTH in
// @suize/shared (LOCKED #15) — resolved here, never hardcoded. Testnet is the
// default; only VITE_SUI_NETWORK='mainnet' opts in (the deferred mainnet flip).
// =============================================================================

import { grpcUrl, resolveNetwork, type SuiNetwork } from '@suize/shared'

export const NETWORK: SuiNetwork = resolveNetwork(import.meta.env.VITE_SUI_NETWORK)

/** gRPC base for the selected network — the read transport handed to dapp-kit v2. */
export const GRPC_URL: string = grpcUrl(NETWORK)
