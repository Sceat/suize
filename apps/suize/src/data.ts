// =============================================================================
// The live lease countdown derivation for the front page. The gallery's rows +
// counters are REAL on-chain data (src/live.ts → live Site objects); this module
// holds only the pure, honest derivations the cards share.
// =============================================================================

import type { DeploySite } from './types'

const DAY_MS = 86400000

export interface TimeLeft {
  /** Human countdown, e.g. `18 days left`. */
  label: string
  /** True inside the last two weeks of the lease (the alarm threshold). */
  soon: boolean
}

/**
 * How long a site has left, in units a human reads. Walrus EPOCHS are useless
 * here: one mainnet epoch is 14 days, so "2 left" reads as two days and is off
 * by a month. Days stay days until they stop fitting on one line (60), then
 * months, then years.
 */
export const timeLeft = (site: DeploySite): TimeLeft | 'permanent' => {
  if (site.paidUntilMs == null) return 'permanent'
  const ms = site.paidUntilMs - Date.now()
  const soon = ms < 14 * DAY_MS
  if (ms <= 0) return { label: 'expired', soon }
  const days = Math.floor(ms / DAY_MS)
  if (days < 1) return { label: 'expires today', soon }
  if (days < 60) return { label: `${days} day${days === 1 ? '' : 's'} left`, soon }
  const months = Math.floor(days / 30)
  if (months < 24) return { label: `${months} months left`, soon }
  const years = Math.floor(days / 365)
  return { label: `${years} year${years === 1 ? '' : 's'} left`, soon }
}

/** Truncated digest for display — `abc12…9d` (works on 0x-hex or base58 digests). */
export const shortDigest = (d: string): string => `${d.slice(0, 6)}…${d.slice(-2)}`
