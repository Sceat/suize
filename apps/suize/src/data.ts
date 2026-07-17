// =============================================================================
// The live Walrus-epoch countdown derivation for the front page. The gallery's
// rows + counters are REAL on-chain data (src/live.ts → SiteCreated events);
// this module holds only the pure, honest derivations the cards share.
// =============================================================================

import { WALRUS_EPOCHS } from '@suize/shared'
import { NETWORK } from './config'
import type { DeploySite } from './types'

/** The current Walrus epoch for the active network, derived from wall-clock. */
export const currentEpoch = (): number => {
  const { genesisMs, durationMs } = WALRUS_EPOCHS[NETWORK]
  return Math.max(0, Math.floor((Date.now() - genesisMs) / durationMs))
}

/** Epochs of storage a site has left — `'permanent'` for funded-pool sites. */
export const epochsRemaining = (site: DeploySite): number | 'permanent' =>
  site.expiresAtEpoch == null ? 'permanent' : Math.max(0, site.expiresAtEpoch - currentEpoch())

/** Truncated digest for display — `abc12…9d` (works on 0x-hex or base58 digests). */
export const shortDigest = (d: string): string => `${d.slice(0, 6)}…${d.slice(-2)}`
