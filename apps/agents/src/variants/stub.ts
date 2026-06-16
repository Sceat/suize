import type { DirectoryData, Ranking, FeedPayment, AdSlot, BusinessProfile } from './shared'

// PREVIEW-ONLY stub data — rendered ONLY when the page is opened with `?stub=1` (see
// routes/App.tsx). The live site always shows real on-chain data with honest empty states;
// this exists so the populated layout (incl. business profiles: logos, names, banners) can be
// eyeballed while testnet has no merchants yet. Never shown without the explicit query param.

const usd = (n: number): string => String(Math.round(n * 1_000_000))
const addr = (seed: number): string =>
  '0x' + ((seed * 2654435761) >>> 0).toString(16).padStart(8, '0').repeat(8).slice(0, 64)

/** A rounded-square logo avatar (base64 SVG, offline) — a coloured tile with the initial. */
const logo = (color: string, label: string): string => {
  const initial = (label.trim().charAt(0) || '?').toUpperCase()
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='64' height='64'>` +
    `<rect width='64' height='64' rx='15' fill='${color}'/>` +
    `<text x='32' y='45' font-family='Helvetica,Arial,sans-serif' font-size='34' font-weight='700' ` +
    `text-anchor='middle' fill='rgba(255,255,255,0.95)'>${initial}</text></svg>`
  return `data:image/svg+xml;base64,${btoa(svg)}`
}

/** A wide banner (base64 SVG, offline) for the sponsored cards. */
const banner = (c1: string, c2: string, label: string): string => {
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='640' height='180'>` +
    `<defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'>` +
    `<stop offset='0' stop-color='${c1}'/><stop offset='1' stop-color='${c2}'/>` +
    `</linearGradient></defs><rect width='640' height='180' fill='url(#g)'/>` +
    `<text x='40' y='108' font-family='Georgia,serif' font-size='38' ` +
    `fill='rgba(255,255,255,0.94)'>${label}</text></svg>`
  return `data:image/svg+xml;base64,${btoa(svg)}`
}

// handle, display name, volume, count, brand colour
const MERCHANTS: Array<[string, string, number, number, string]> = [
  ['deploy@suize', 'Deploy', 8420.5, 412, 'rgb(30,127,214)'],
  ['mealmate@suize', 'MealMate', 5180.0, 1290, 'rgb(228,106,46)'],
  ['flightbot@suize', 'FlightBot', 4762.25, 318, 'rgb(38,166,154)'],
  ['acme-ai@suize', 'Acme AI', 3210.75, 904, 'rgb(124,92,236)'],
  ['renderfarm@suize', 'RenderFarm', 2890.0, 156, 'rgb(216,68,108)'],
  ['datapipe@suize', 'DataPipe', 2110.4, 2310, 'rgb(52,152,219)'],
  ['voicegen@suize', 'VoiceGen', 1640.0, 740, 'rgb(155,89,182)'],
  ['pixelcraft@suize', 'PixelCraft', 980.5, 220, 'rgb(241,160,40)'],
  ['scrapehub@suize', 'ScrapeHub', 612.25, 1450, 'rgb(46,134,193)'],
  ['translate-io@suize', 'Translate.io', 430.0, 880, 'rgb(26,188,156)'],
  ['cronjobs@suize', 'CronJobs', 188.75, 96, 'rgb(127,140,141)'],
  ['notify@suize', 'Notify', 74.1, 512, 'rgb(231,76,60)'],
]

const PAYERS: Array<string | null> = [
  'shopper-7@suize',
  null,
  'agent-42@suize',
  null,
  'wanderbot@suize',
  'opus-agent@suize',
  null,
  'errand@suize',
]

/** Build the stub dataset (timestamps relative to call time so the feed reads live). */
export function stubData(): DirectoryData {
  const t = Date.now()

  const rankings: Ranking[] = MERCHANTS.map(([handle, name, vol, count, color], i) => ({
    merchant: addr(i + 11),
    handle,
    volume: usd(vol),
    count,
    // Most merchants have a profile (logo + name); some don't (fallback avatar + @handle),
    // to show both states in the directory.
    profile:
      i % 6 === 5
        ? null
        : { name, image: logo(color, name), banner: '', description: '', website: '' },
  }))

  const feed: FeedPayment[] = Array.from({ length: 18 }, (_, i) => {
    const m = MERCHANTS[i % MERCHANTS.length]
    const grossUsd = [0.5, 0.1, 2.0, 0.25, 1.5, 0.05, 3.0, 0.75][i % 8]
    const feeUsd = Math.max(0.01, grossUsd * 0.02)
    return {
      digest: `Stub${(i * 7919).toString(36).padStart(8, '0')}DigestXXXXXXXXXXXXXXXX`.slice(0, 44),
      payer: addr(i + 100),
      payerHandle: PAYERS[i % PAYERS.length],
      merchant: addr((i % MERCHANTS.length) + 11),
      merchantHandle: m[0],
      gross: usd(grossUsd),
      fee: usd(feeUsd),
      feeBps: 200,
      timestampMs: t - (12_000 + i * 47_000),
    }
  })

  const acme: BusinessProfile = {
    name: 'Acme AI',
    image: logo('rgb(124,92,236)', 'Acme AI'),
    banner: banner('rgb(54,86,156)', 'rgb(13,17,23)', 'Acme AI'),
    description: 'Production-grade agents for any workflow — pay-as-you-go in USDC, no contract, no key.',
    website: 'https://example.com',
  }
  const flight: BusinessProfile = {
    name: 'FlightBot',
    image: logo('rgb(38,166,154)', 'FlightBot'),
    banner: banner('rgb(20,80,86)', 'rgb(13,17,23)', 'FlightBot'),
    description: 'Book flights from your agent. FlightBot finds the fare, holds the seat, settles in USDC.',
    website: 'https://example.com',
  }

  const slots: AdSlot[] = [
    {
      key: 'hero',
      label: 'Hero banner',
      blurb: 'Top of every page',
      slotId: addr(1),
      price: usd(420),
      holder: addr(14),
      holderHandle: 'acme-ai@suize',
      lastBidMs: t - 3 * 3_600_000,
      minNextBid: usd(420.000001),
      profile: acme,
    },
    {
      key: 'feed-banner',
      label: 'Feed banner',
      blurb: 'Inside the live purchase feed',
      slotId: addr(2),
      price: usd(180),
      holder: addr(13),
      holderHandle: 'flightbot@suize',
      lastBidMs: t - 9 * 3_600_000,
      minNextBid: usd(180.000001),
      profile: flight,
    },
    {
      key: 'rankings-sidebar',
      label: 'Rankings sidebar',
      blurb: 'Beside the volume leaderboard',
      slotId: addr(3),
      price: usd(50),
      holder: '0x' + '0'.repeat(64),
      holderHandle: null,
      lastBidMs: 0,
      minNextBid: usd(50.000001),
      profile: null,
    },
  ]

  return {
    slots,
    cheapest: usd(50.000001),
    rankings,
    feed,
    visitorsToday: 1240,
    loading: { slots: false, rankings: false, feed: false },
  }
}
