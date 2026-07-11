// =============================================================================
// Placeholder front-page data + the live Walrus-epoch countdown derivation.
//
// The 8 rows below are TYPED PLACEHOLDERS shaped exactly like the real gallery
// feed. `epochsRemaining()` derives each card's countdown from the shared Walrus
// epoch clock (@suize/shared WALRUS_EPOCHS) against wall-clock time, so the
// numbers are genuinely live, not baked strings.
//
// T-005b: live chain data — replace SITES with a fetch of on-chain SiteCreated
// events (+ facilitator /supported for network/health). The DeploySite shape,
// the epoch derivation, and every component below stay unchanged.
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
  site.expiresAtEpoch == null
    ? 'permanent'
    : Math.max(0, site.expiresAtEpoch - currentEpoch())

// --- placeholder digests, crafted so the display truncation (0xHHHH…TT) matches
//     the approved mockup exactly. Real digests arrive with the chain feed. ---
const FILL = '4b7e9a2c1f8d6e3a0b5c7d9e2f4a6b8c1d3e5f70a2b4c6d8e'
const digest = (head: string, tail: string): string =>
  `0x${head}${FILL.repeat(2).slice(0, 64 - head.length - tail.length)}${tail}`

/** Truncated digest for display — `0x9f3a…c1`. */
export const shortDigest = (d: string): string => `${d.slice(0, 6)}…${d.slice(-2)}`

const now = currentEpoch()

export const SITES: DeploySite[] = [
  {
    siteId: digest('5100', '01'),
    name: 'Meridian — a studio, made permanent',
    host: 'meridian.suize.site',
    url: 'https://meridian.suize.site',
    sizeBytes: 3_250_585, // 3.1 MB
    expiresAtEpoch: null, // permanent · funded pool
    receiptDigest: digest('9f3a', 'c1'),
    privacy: 'public',
    category: 'Featured',
    pressedAgo: 'pressed 2h ago',
    viaAgent: true,
    preview: 'folio',
    lead: true,
    sub: "A design studio's full portfolio, pressed once and funded forever. 3.1 MB across 214 files, content-addressed so the URL can never rot.",
  },
  {
    siteId: digest('5100', '02'),
    name: 'Ambswap Docs',
    host: 'ambswap.suize.site',
    url: 'https://ambswap.suize.site',
    sizeBytes: 812_004,
    expiresAtEpoch: now + 8,
    receiptDigest: digest('41b8', '7e'),
    privacy: 'public',
    category: 'Docs',
    pressedAgo: '40m ago',
    viaAgent: false,
    preview: 'docs',
  },
  {
    siteId: digest('5100', '03'),
    name: 'Koi Terminal',
    host: 'koi.suize.site',
    url: 'https://koi.suize.site',
    sizeBytes: 156_720,
    expiresAtEpoch: now + 2, // soon
    receiptDigest: digest('0c72', '9d'),
    privacy: 'public',
    category: 'Terminal',
    pressedAgo: '1h ago',
    viaAgent: false,
    preview: 'status',
  },
  {
    siteId: digest('5100', '04'),
    name: 'x402 Facilitator',
    host: 'x402.suize.site',
    url: 'https://x402.suize.site',
    sizeBytes: 98_240,
    expiresAtEpoch: now + 26,
    receiptDigest: digest('77de', '10'),
    privacy: 'public',
    category: 'Status',
    pressedAgo: '2h ago',
    viaAgent: true,
    preview: 'status',
  },
  {
    siteId: digest('5100', '05'),
    name: 'Nocturne',
    host: 'nocturne.suize.site',
    url: 'https://nocturne.suize.site',
    sizeBytes: 2_104_900,
    expiresAtEpoch: null, // permanent
    receiptDigest: digest('b3a0', '44'),
    privacy: 'public',
    category: 'Portfolio',
    pressedAgo: '3h ago',
    viaAgent: false,
    preview: 'folio',
  },
  {
    siteId: digest('5100', '06'),
    name: 'Overflow Deck',
    host: 'overflow.suize.site',
    url: 'https://overflow.suize.site',
    sizeBytes: 5_680_112,
    expiresAtEpoch: now + 14,
    receiptDigest: digest('2e91', 'af'),
    privacy: 'public',
    category: 'Deck',
    pressedAgo: '5h ago',
    viaAgent: true,
    preview: 'deck',
  },
  {
    siteId: digest('5100', '07'),
    name: 'Loom',
    host: 'loom.suize.site',
    url: 'https://loom.suize.site',
    sizeBytes: 341_008,
    expiresAtEpoch: now + 41,
    receiptDigest: digest('5c18', 'd2'),
    privacy: 'unlisted',
    category: 'Agent home',
    pressedAgo: '6h ago',
    viaAgent: false,
    preview: 'landing',
  },
  {
    siteId: digest('5100', '08'),
    name: 'Seal Vault',
    host: 'private · wallet-gated',
    url: '',
    sizeBytes: 61_400,
    expiresAtEpoch: null, // permanent
    receiptDigest: null, // no public receipt for a private site
    privacy: 'private',
    category: 'Private',
    pressedAgo: '7h ago',
    viaAgent: false,
    preview: 'locked',
  },
]

// --- circulation figures (the live-drifting counters strip). Placeholder seeds;
//     T-005b sources these from the facilitator + chain event counts. ---
export const FIGURES = {
  sitesLive: 1284,
  paymentsSettled: 3910,
  epochsFunded: 48203,
}
