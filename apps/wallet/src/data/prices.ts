/**
 * THE single pinned TESTNET price stub — testnet has NO live price feed, so we
 * hard-code a snapshot. This is the ONLY price source in the wallet (one stub, one
 * seam); mainnet swaps the body of `priceUsd` for a Pyth read.
 *
 * Keyed by the fully-qualified Move coin type (the SAME key `getAllBalances`
 * returns and `SUPPORTED[].type` carries), so `useHome` does a single lookup:
 *   usd = ui * priceUsd(coin.type)
 *
 * SEAM: at mainnet, swap `priceUsd` for a Pyth read. The signature
 * (`(type: string) => number`) stays identical, so no screen changes. These are
 * NOT a market quote — the honesty brand forbids presenting them as one
 * (display-only on testnet). SUI/USDC/DEEP are pinned live (coins.ts), so their
 * reference price values real balances; the still-display-only coins (WAL/USDSUI)
 * carry a reference price purely so a future pinned balance renders sanely — their
 * balances read 0 until the type is pinned (see coins.ts `displayOnly`).
 *
 * Reference prices:
 *   SUI 1.40 · USDC 1.00 · DEEP 0.13 · WAL 0.28 · USDSUI 1.00
 */

import { SUI, USDC, DEEP, WAL, USDSUI } from './coins';

/**
 * Snapshot USD price per 1 UI unit of each supported coin, keyed by coin type.
 * Unknown types resolve to 0 (an unpriced balance contributes nothing to the total
 * rather than NaN-poisoning it).
 */
export const PRICES_USD: Record<string, number> = {
  [SUI.type]: 1.4,
  [USDC.type]: 1.0,
  [DEEP.type]: 0.13,
  [WAL.type]: 0.28,
  [USDSUI.type]: 1.0,
};

/**
 * USD price for 1 UI unit of `coinType`. Returns 0 for unpriced types so a balance
 * we can't value never corrupts the total. STUB — see file header for the mainnet seam.
 */
export function priceUsd(coinType: string): number {
  return PRICES_USD[coinType] ?? 0;
}
