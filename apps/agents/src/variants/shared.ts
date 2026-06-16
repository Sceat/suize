// The data contract for the Suize Agents directory app (agents.suize.io) — the live
// on-chain projections the page renders. (Formerly the multi-variant design-lab contract;
// the lab is gone and V3 is the shipped app, so this is just the app's data shape now.)
import type { AdSlot, FeedPayment, Ranking } from '../api'

export type { AdSlot, FeedPayment, Ranking, BusinessProfile } from '../api'

export type DirectoryData = {
  /** The on-chain ad-slot auction state (sponsored slots, shown ON TOP). */
  slots: AdSlot[]
  /** The cheapest slot's minNextBid (a "from $X" figure), if any. */
  cheapest?: string
  /** Merchants RANKED by gross USDC volume — the directory hero. */
  rankings: Ranking[]
  /** Recent on-chain x402 payments — the live ticker. */
  feed: FeedPayment[]
  /** Visitors today (vanity stat), or null while loading. */
  visitorsToday: number | null
  loading: { slots: boolean; rankings: boolean; feed: boolean }
}

export type DirectoryProps = {
  data: DirectoryData
  /** A shared 1s clock for relative times (no network) — pass to relativeTime. */
  now: number
}
