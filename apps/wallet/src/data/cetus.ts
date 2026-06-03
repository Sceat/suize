/**
 * Cetus aggregator quote helper — the ONLY job here is a LIVE swap QUOTE.
 *
 * The Convert sheet shows a real rate + expected-out by asking the Cetus aggregator
 * (`AggregatorClient.findRouters`) to route `amountIn` of `from` into `target`. That
 * call is a pure HTTP `GET …/find_routes` against Cetus's router service (no signer,
 * no on-chain read) — so we construct a quote-only client (the internal grpc client
 * it builds is never touched by `findRouters`). One concern per file: this module
 * QUOTES; the actual swap PTB + sponsor/sign/execute live in the sheet (reusing
 * `ptb.buildSwap` + the WS sponsor seam), exactly mirroring `useHome.convert`.
 *
 * HONESTY (the brand): testnet liquidity is thin/absent, so `findRouters` very often
 * returns `null` (or a router error / zero out). That is the REAL, honest "no route"
 * signal — NOT a stub. `quoteSwap` collapses every such case to `{ ok:false }` so the
 * sheet can say "No route on testnet" truthfully. We NEVER fabricate a fallback rate.
 *
 * The number wall: this returns a quote (`amountOutRaw`) the deterministic core can
 * turn into a slippage-guarded `minOut`. The LLM never touches these numbers.
 */

import { AggregatorClient, Env } from '@cetusprotocol/aggregator-sdk';

/** Inputs for a single quote — coin types + the raw input amount (smallest unit). */
export interface QuoteRequest {
  /** the Move coin type going IN (e.g. SUI.type). */
  fromType: string;
  /** the Move coin type coming OUT (e.g. USDC.type). */
  toType: string;
  /** amount of `fromType` to swap, in its smallest unit (Mist for SUI), as a string. */
  amountInRaw: string;
}

/** A successful live quote: the routed output + the implied unit rate. */
export interface QuoteOk {
  ok: true;
  /** expected output of `toType`, in its smallest unit, as a string (bigint-safe). */
  amountOutRaw: string;
  /** human-scaled output (amountOutRaw / 10**toDecimals) for display. */
  amountOutUi: number;
  /** implied unit rate: 1 `fromType` -> this many `toType` (UI units). */
  rate: number;
}

/** An honest "no route" — thin testnet liquidity, a router error, or a zero out. */
export interface QuoteNone {
  ok: false;
  /** machine reason for the empty quote (for logging; the UI shows one honest line). */
  reason: 'no-route' | 'zero-amount' | 'error';
}

export type QuoteResult = QuoteOk | QuoteNone;

/**
 * A lazily-built, reused quote-only AggregatorClient (Testnet env). `findRouters` is
 * a plain HTTP call, so a single client is fine to share across quotes. We never call
 * a method that touches its internal grpc client, so the quote-only construction is
 * safe + honest.
 */
let client: AggregatorClient | null = null;
function getClient(): AggregatorClient {
  if (!client) {
    client = new AggregatorClient({ env: Env.Testnet });
  }
  return client;
}

/**
 * Get a LIVE Cetus quote for swapping `amountInRaw` of `fromType` into `toType`.
 *
 * Returns `{ ok:true, amountOutRaw, amountOutUi, rate }` on a real route, else an
 * honest `{ ok:false }` (no route / zero amount / network or router error). Never
 * throws — a thrown SDK/network error collapses to `{ ok:false, reason:'error' }` so
 * the caller has ONE branch to handle and the sheet never crashes on a bad quote.
 *
 * @param req         the from/to coin types + the raw input amount.
 * @param toDecimals  decimals of `toType`, to scale the raw output for display.
 * @param fromUi      the human input amount of `fromType`, to derive the unit rate.
 */
export async function quoteSwap(
  req: QuoteRequest,
  toDecimals: number,
  fromUi: number,
): Promise<QuoteResult> {
  // Guard zero / non-positive input before hitting the network.
  let amountIn: bigint;
  try {
    amountIn = BigInt(req.amountInRaw);
  } catch {
    return { ok: false, reason: 'zero-amount' };
  }
  if (amountIn <= 0n) return { ok: false, reason: 'zero-amount' };

  try {
    const router = await getClient().findRouters({
      from: req.fromType,
      target: req.toType,
      amount: amountIn.toString(),
      byAmountIn: true,
    });

    // null => no route at all. A router-level error or no liquidity also = no route.
    if (!router || router.error || router.insufficientLiquidity) {
      return { ok: false, reason: 'no-route' };
    }

    const outRaw = router.amountOut.toString();
    if (outRaw === '0') return { ok: false, reason: 'no-route' };

    const amountOutUi = Number(outRaw) / 10 ** toDecimals;
    const rate = fromUi > 0 ? amountOutUi / fromUi : 0;
    return { ok: true, amountOutRaw: outRaw, amountOutUi, rate };
  } catch {
    // Network / SDK failure — honest "no route" rather than a fabricated number.
    return { ok: false, reason: 'error' };
  }
}
