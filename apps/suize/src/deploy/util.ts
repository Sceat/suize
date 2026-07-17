// =============================================================================
// Shared deploy-side codecs for the browser (siteId → subdomain, epoch/expiry
// math). Byte-identical to the worker's util.ts + the MCP — one home for the
// facts the dashboard and the pay flow both need.
// =============================================================================

import { WALRUS_EPOCHS } from '@suize/shared'
import { NETWORK } from '../config'

/** base36 subdomain of a Site id — must match the worker's util.ts exactly, so a
 * card's "Visit" link resolves to the same host the worker serves. */
const BASE36_WIDTH = 50
export const subdomainOf = (siteId: string): string =>
  BigInt('0x' + siteId.replace(/^0x/, '')).toString(36).padStart(BASE36_WIDTH, '0')

/** The public host for a public site. Sealed sites have no public host. */
export const hostOf = (siteId: string): string => `${subdomainOf(siteId)}.suize.site`
export const urlOf = (siteId: string): string => `https://${hostOf(siteId)}`

/** wall-clock ms → the active network's Walrus epoch. */
export const epochOf = (ms: number): number => {
  const { genesisMs, durationMs } = WALRUS_EPOCHS[NETWORK]
  return Math.floor((ms - genesisMs) / durationMs)
}

/** A real explorer link for a settlement / create-tx digest. */
export const explorerTx = (digest: string): string => `https://suiscan.xyz/${NETWORK}/tx/${digest}`
export const explorerObject = (id: string): string => `https://suiscan.xyz/${NETWORK}/object/${id}`

/** "in 18 days" / "in 4 hours" / "expired" — a human countdown to a paid-through ms. */
export const untilLabel = (paidUntilMs: number): string => {
  if (!paidUntilMs) return 'unknown'
  const diff = paidUntilMs - Date.now()
  if (diff <= 0) return 'expired'
  const days = Math.floor(diff / 86_400_000)
  if (days >= 1) return `${days} day${days === 1 ? '' : 's'} left`
  const hours = Math.max(1, Math.floor(diff / 3_600_000))
  return `${hours} hour${hours === 1 ? '' : 's'} left`
}

/** "Jul 30, 2026" — the paid-through calendar date. */
export const dateLabel = (ms: number): string =>
  ms ? new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—'

/** A compact byte size, e.g. "1.2 MB" / "48 KB". */
export const sizeLabel = (bytes: number): string =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`
