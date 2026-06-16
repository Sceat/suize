import { Transaction } from '@mysten/sui/transactions'
import { PACKAGE_IDS, USDC_TYPES } from '@suize/shared'
import { API_BASE, NETWORK } from './config'

// ============================================================================
// Directory API client — the read endpoints on the unified backend (the chain
// is the database; these are thin on-chain projections) plus the ONE write: an
// ad-slot bid PTB, built HERE and signed LOCALLY via dapp-kit.
//
//   GET /feed?limit=50      → recent on-chain x402 payments (payer → merchant)
//   GET /rankings           → merchant volume leaderboard
//   GET /stats              → visitors today  ·  POST /stats/visit (once/session)
//   GET /ads/slots          → the ad-slot auction state (price/holder/creative)
//   GET /ads/slots/:key     → that slot + the bid params (target/objects/minNextBid)
//
// Amounts on this wire are BASE-UNIT strings (6-decimal USDC) — format with
// formatUsdc from @suize/x402 (re-exported below), same as apps/pay.
// ============================================================================

export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

/** "0.50" rendered from atomic base units (mirror of the backend's formatUsdc). */
export { formatUsdc } from '@suize/x402'

const AUCTION = PACKAGE_IDS.AUCTION
const USDC = USDC_TYPES[NETWORK]

// ── Wire shapes (the backend's response contracts) ───────────────────────────

export type FeedPayment = {
  digest: string
  payer: string
  payerHandle: string | null
  merchant: string
  merchantHandle: string | null
  /** Gross paid by the payer, base-unit USDC string. */
  gross: string
  /** Fee carved to the treasury, base-unit USDC string. */
  fee: string
  /** Fee rate in basis points (e.g. 200 = 2%). */
  feeBps: number
  timestampMs: number
}

/** A business's on-chain identity (the `BusinessProfile` NFT), resolved by the backend from
 *  the holder/merchant's owned profile object. The DIRECTORY shows only `name` + `image`
 *  (logo); the SPONSORED ad cards use the full set (banner + description + website too).
 *  All URLs are https-validated server-side; rendered inert (React-escaped, no markup). */
export type BusinessProfile = {
  name: string
  /** Logo / profile picture (https). */
  image: string
  /** Wide banner image (https) — sponsored cards only. */
  banner: string
  description: string
  website: string
}

export type Ranking = {
  merchant: string
  handle: string | null
  /** Total volume taken through the rail, base-unit USDC string. */
  volume: string
  count: number
  /** The merchant's resolved business profile, when it has minted one (else null). */
  profile?: BusinessProfile | null
}

export type AdSlot = {
  key: string
  label: string
  blurb: string
  slotId: string
  /** Current (winning) price, base-unit USDC string. */
  price: string
  holder: string
  holderHandle: string | null
  lastBidMs: number
  /** The smallest bid that wins the slot, base-unit USDC string (price + 1µ). */
  minNextBid: string
  /** The holder's resolved business profile — the ad's banner/logo/name/desc/site come
   *  from this (no per-slot creative blob). Null when the holder has no profile. */
  profile?: BusinessProfile | null
}

export type SlotsResponse = {
  slots: AdSlot[]
  /** The cheapest slot's minNextBid, base-unit USDC string (a marketing figure). */
  cheapest: string
}

/** The bid params the backend hands back for a single slot — the on-chain
 *  coordinates the PTB needs (kept server-sourced so the app never hardcodes an
 *  id; cross-checked against @suize/shared at build time). */
export type BidParams = {
  /** `${pkg}::auction::bid` */
  target: string
  configObject: string
  slotObject: string
  /** The USDC coin type the slot is pinned to. */
  coinType: string
  /** The smallest winning bid, base-unit USDC string. */
  minNextBid: string
}

// ── Fetch helpers ────────────────────────────────────────────────────────────

async function getJson<T>(path: string): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${API_BASE}${path}`)
  } catch {
    throw new ApiError('Could not reach the Suize directory service.', 0)
  }
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { error?: string } | null
    throw new ApiError(data?.error || `${path} failed (${res.status})`, res.status)
  }
  const body = (await res.json().catch(() => null)) as T | null
  if (body == null) throw new ApiError(`empty response from ${path}`, 502)
  return body
}

export const fetchFeed = (limit = 50) =>
  getJson<{ payments: FeedPayment[] }>(`/feed?limit=${limit}`)

export const fetchRankings = () => getJson<{ merchants: Ranking[] }>(`/rankings`)

export const fetchStats = () => getJson<{ visitorsToday: number }>(`/stats`)

export const fetchSlots = () => getJson<SlotsResponse>(`/ads/slots`)

export const fetchSlotBid = (key: string) =>
  getJson<{ slot: AdSlot; bid: BidParams }>(`/ads/slots/${encodeURIComponent(key)}`)

/** POST /stats/visit — fire once per browser session (dedupe via the localStorage
 *  flag in the caller). Best-effort: a failure is swallowed (the counter is
 *  decorative, never blocks the page). */
export async function recordVisit(): Promise<void> {
  try {
    await fetch(`${API_BASE}/stats/visit`, { method: 'POST' })
  } catch {
    /* swallow — the visit counter is decorative */
  }
}

// ── The bid PTB (the only write) ─────────────────────────────────────────────

/**
 * Build the `auction::bid<USDC>` transaction. NON-SPONSORED v1 — the bidder pays
 * their own gas; the caller signs+executes with dapp-kit's
 * useSignAndExecuteTransaction.
 *
 * `bid<T>(slot: &mut AdSlot, config: &AuctionConfig, payment: Balance<T>,
 *         creative: String, clock: &Clock, ctx)` — the on-chain assert is
 * `bid_amount > slot.price`, so `bidBaseUnits` MUST strictly exceed the current
 * price (use the slot's `minNextBid`, which is `price + 1`). The fee is carved
 * on-chain (the 2% with a $0.01 floor) to the treasury; the net goes to the
 * directory — so a winning bid is itself a payment on the rail and shows in the
 * live feed within a poll (the dogfood loop).
 *
 * The `payment` Balance<USDC> is materialized directly via the SDK
 * `CoinWithBalance` intent (`tx.balance({ type, balance })`) — the same proven
 * recipe apps/wallet uses for a subscription `create`/`renew`; it picks/merges
 * the sender's USDC coins and splits exactly `bidBaseUnits`, no separate
 * `into_balance` moveCall needed.
 *
 * `slotObject`/`configObject`/`target` come from the backend's /ads/slots/:key
 * (so the app never hardcodes an id); they are the same values as
 * PACKAGE_IDS.AUCTION — assert that here as a build-time safety net.
 */
export function buildBidTx(opts: {
  bid: BidParams
  /** The winning amount in base units (must be > the slot's current price). */
  bidBaseUnits: bigint
  /** The new creative (URL or text) shown while this account holds the slot. */
  creative: string
}): Transaction {
  const { bid, bidBaseUnits, creative } = opts

  // Defence-in-depth: the slot's coin pin must match this network's USDC, and the
  // bid target must be the auction package we know — never sign a foreign target.
  if (bid.coinType !== USDC) {
    throw new ApiError('This ad slot is priced in a different coin.', 409)
  }
  if (bid.target !== AUCTION.TARGETS.BID) {
    throw new ApiError('Unexpected bid target — refusing to sign.', 409)
  }

  const tx = new Transaction()
  // Materialize Balance<USDC> of exactly bidBaseUnits from the sender's coins.
  const payment = tx.balance({ type: USDC, balance: bidBaseUnits })
  tx.moveCall({
    target: bid.target,
    typeArguments: [USDC],
    arguments: [
      tx.object(bid.slotObject),
      tx.object(bid.configObject),
      payment,
      tx.pure.string(creative),
      tx.object.clock(),
    ],
  })
  return tx
}
