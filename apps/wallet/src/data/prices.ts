/**
 * Coin USD prices — now LIVE via Pyth (Hermes REST), with a hard-coded FALLBACK.
 *
 * We fetch real market prices from Pyth's Hermes endpoint (the Sui-ecosystem
 * oracle) client-side — CORS is enabled, so no on-chain read and no backend hop.
 * This is a DISPLAY price only: the honesty brand forbids presenting it as a
 * tradable quote, and the balances it values are testnet (no-real-value) coins.
 * It's just accurate now instead of stale.
 *
 * Keyed by the fully-qualified Move coin type (the SAME key `getAllBalances`
 * returns and `SUPPORTED[].type` carries), so `useHome` does a single lookup:
 *   usd = ui * priceOf(coin.type, livePrices)
 *
 * The hard-coded `PRICES_USD` map stays as the FALLBACK: coins without a Pyth feed
 * (WAL/USDSUI — display-only/0 on testnet) keep their reference price, and if the
 * Hermes fetch fails the totals fall back to the snapshot rather than NaN/0-poison.
 * SUI/USDC/DEEP have live feeds and override their fallback entry.
 *
 * Reference (fallback) prices:
 *   SUI 1.40 · USDC 1.00 · DEEP 0.13 · WAL 0.28 · USDSUI 1.00
 *   (SUI's 1.40 is stale on purpose — it's only the offline floor; the live feed wins.)
 */

import { useQuery } from '@tanstack/react-query';
import { SUI, USDC, DEEP, WAL, USDSUI } from './coins';

/**
 * Snapshot USD price per 1 UI unit of each supported coin, keyed by coin type.
 * The FALLBACK under the live Pyth feed (see `usePrices`). Unknown types resolve to
 * 0 (an unpriced balance contributes nothing to the total rather than NaN-poisoning it).
 */
export const PRICES_USD: Record<string, number> = {
  [SUI.type]: 1.4,
  [USDC.type]: 1.0,
  [DEEP.type]: 0.13,
  [WAL.type]: 0.28,
  [USDSUI.type]: 1.0,
};

/**
 * Pyth Hermes feed ids (hex, NO `0x` prefix to match `parsed[].id`) keyed by coin
 * TYPE. Only coins with a real Pyth feed appear here; the rest stay on the hard-coded
 * fallback. WAL/USDSUI have no feed (display-only/0 on testnet) and are intentionally
 * absent.
 */
export const PYTH_FEED_IDS: Record<string, string> = {
  [SUI.type]: '23d7315113f5b1d3ba7a83604c44b94d79f4fd69af77f804fc7f920a6dc65744',
  [USDC.type]: 'eaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a',
  [DEEP.type]: '29bdd5248234e33bd93d3b81100b5fa32eaa5997843847e2c2cb16d7c6d9f7ff',
};

const HERMES_LATEST = 'https://hermes.pyth.network/v2/updates/price/latest';

/** Strip a leading `0x`/`0X` and lower-case, so feed ids match regardless of casing. */
function normalizeFeedId(id: string): string {
  return id.replace(/^0x/i, '').toLowerCase();
}

/** Shape of the bits of the Hermes response we consume. */
interface HermesParsedEntry {
  id: string;
  price: { price: string; expo: number };
}
interface HermesResponse {
  parsed?: HermesParsedEntry[];
}

/**
 * Fetch the live Pyth prices for every coin in `PYTH_FEED_IDS` and resolve to a
 * `Record<coinType, number>` (USD per 1 UI unit). Throws on a network/parse failure
 * so React-Query retries; `usePrices` catches the final failure and returns the
 * fallback (this never NaN/0-poisons a total).
 */
async function fetchPythPrices(): Promise<Record<string, number>> {
  // feedId (normalized) -> coinType, to map the response rows back onto our types.
  const feedToType = new Map<string, string>();
  const params = new URLSearchParams();
  for (const [coinType, feedId] of Object.entries(PYTH_FEED_IDS)) {
    const norm = normalizeFeedId(feedId);
    feedToType.set(norm, coinType);
    params.append('ids[]', norm);
  }

  const res = await fetch(`${HERMES_LATEST}?${params.toString()}`);
  if (!res.ok) throw new Error(`Hermes ${res.status}`);
  const json = (await res.json()) as HermesResponse;
  if (!json.parsed) throw new Error('Hermes: missing parsed[]');

  const out: Record<string, number> = {};
  for (const entry of json.parsed) {
    const coinType = feedToType.get(normalizeFeedId(entry.id));
    if (!coinType) continue;
    const usd = Number(entry.price.price) * 10 ** entry.price.expo;
    // Guard against a malformed row poisoning the map; only keep finite, sane values.
    if (Number.isFinite(usd) && usd > 0) out[coinType] = usd;
  }
  return out;
}

/**
 * usePrices — live Pyth prices MERGED OVER the hard-coded fallback, keyed by coin
 * type. The result ALWAYS contains the full fallback set (so every supported coin
 * values sanely) with the fetched live prices layered on top. On a fetch error it
 * returns the fallback verbatim — never NaN/0.
 *
 * Polls every 45s, treats data fresh for 30s, retries a couple times.
 */
export function usePrices(): Record<string, number> {
  const query = useQuery({
    queryKey: ['pyth-prices', Object.keys(PYTH_FEED_IDS).sort()],
    queryFn: fetchPythPrices,
    refetchInterval: 45_000,
    staleTime: 30_000,
    retry: 2,
  });

  // Live over fallback. `query.data` is undefined until the first success (and we
  // never persist an error), so we fall back to {} and the spread keeps PRICES_USD.
  return { ...PRICES_USD, ...(query.data ?? {}) };
}

/**
 * USD price for 1 UI unit of `coinType` against a (live-merged) price map. Defaults
 * to the hard-coded fallback when no map is passed (callers outside a React render),
 * and to 0 for an unpriced type so a balance we can't value never corrupts the total.
 */
export function priceOf(coinType: string, prices: Record<string, number> = PRICES_USD): number {
  return prices[coinType] ?? 0;
}
