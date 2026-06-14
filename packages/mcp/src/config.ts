// ============================================================================
// @suize/mcp — config. Env-only knobs for the LOCAL stdio MCP; network +
// on-chain ids resolve from the PERSISTED SESSION's network at call time (the
// /agent-connect payload carries it), never from a hardcoded value here. The few
// load-bearing on-chain consts we need (the USDC type, the subs package, CAIP-2)
// are INLINED below with a sync-comment so this package publishes to npm with NO
// workspace runtime dep on @suize/shared (one-line install, fewest deps).
//
//   SUIZE_DEV=1            → dev defaults (local wallet app + local backend)
//   WALLET_APP_URL         → the Suize WALLET origin the connect handshake opens
//                            at `/agent-connect`; default https://wallet.suize.io,
//                            dev http://localhost:5180 (the wallet's vite port).
//                            Sign in with Google there — the address you get back
//                            is your AGENT's own address.
//   SUIZE_API              → the unified backend (the x402 facilitator: /verify ·
//                            /settle · /build · /terms);
//                            default https://api.suize.io, dev http://localhost:8099
//   SUI_RPC_URL            → optional fullnode override for the read tools
//   SUIZE_SESSION_PATH     → where the session persists (default ~/.suize/session.json)
//   SUIZE_CONFIRM          → the client-side confirm dial: "each" (default) |
//                            "auto_under_<x>" (e.g. auto_under_1, auto_under_0.50) |
//                            "auto"
// ============================================================================

import { homedir } from 'node:os'
import { join } from 'node:path'
import { unb64json as unb64orThrow, usdcAtomic } from '@suize/x402'

// Wire + amount primitives are the SINGLE SOURCE of truth in @suize/x402 (bundled
// in by tsup, zero extra published dep). `formatUsdc` is re-exported here so the
// read tools (which otherwise import no x402) keep one USDC implementation, not a
// local fork; the rest of the package imports the engine straight from @suize/x402.
export { formatUsdc } from '@suize/x402'

const env = (k: string): string => (process.env[k] ?? '').trim()

export const DEV = env('SUIZE_DEV') === '1' || env('SUIZE_DEV').toLowerCase() === 'true'

export const WALLET_APP_URL: string = (
  env('WALLET_APP_URL') || (DEV ? 'http://localhost:5180' : 'https://wallet.suize.io')
).replace(/\/+$/, '')

export const SUIZE_API: string = (
  env('SUIZE_API') || (DEV ? 'http://localhost:8099' : 'https://api.suize.io')
).replace(/\/+$/, '')

export const RPC_URL_OVERRIDE: string | null = env('SUI_RPC_URL') || null

export const SESSION_PATH: string =
  env('SUIZE_SESSION_PATH') || join(homedir(), '.suize', 'session.json')

// ── Inlined on-chain consts (zero-dep mirror of @suize/shared) ──────────────
// @suize/mcp publishes to npm with NO workspace runtime dep on @suize/shared, so
// the handful of load-bearing on-chain ids it reads are mirrored HERE with a sync
// comment. Each value MUST stay byte-identical to its source.
//   ⚠️ SYNC: @suize/shared SuiNetwork (testnet | mainnet)
export type SuiNetwork = 'testnet' | 'mainnet'

/** ⚠️ SYNC: @suize/shared fullnodeUrl — the public per-network JSON-RPC node. */
export const fullnodeUrl = (network: SuiNetwork): string =>
  `https://fullnode.${network}.sui.io:443`

/** ⚠️ SYNC: @suize/shared caip2 — the CAIP-2 chain id x402 requirements carry. */
export const CAIP2: Record<SuiNetwork, `sui:${SuiNetwork}`> = {
  testnet: 'sui:testnet',
  mainnet: 'sui:mainnet',
}

/** ⚠️ SYNC: @suize/shared USDC_TYPES — Circle USDC (6 dp) per network; the
 * settlement asset the rail charges in and the coin suize_balance/_receipts read. */
export const USDC_TYPES: Record<SuiNetwork, string> = {
  testnet: '0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC',
  mainnet: '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
}

/** ⚠️ SYNC: @suize/shared PACKAGE_IDS.SUBS.PACKAGE (per network). `0x0` until the
 * `subs` module publishes on that network → suize_subscriptions fails closed
 * (no object can match a `0x0::…::Subscription` type). */
export const SUBS_PACKAGES: Record<SuiNetwork, string> = {
  testnet: '0xb6bca1cfbcff846c2e575190c70a78fc777f858deae9d4d5a6e797cb005d1c69',
  mainnet: '0x0',
}

export const SUI_ADDRESS_RE = /^0x[0-9a-fA-F]{64}$/

/** base64(JSON) → T, or null on malformed base64 / JSON. A bad header is a DENY
 * (fall through), so this null-wraps @suize/x402's throwing `unb64json`. */
export const unb64json = <T>(s: string): T | null => {
  try {
    return unb64orThrow<T>(s)
  } catch {
    return null
  }
}

/** "0.50" → 500000n, or null on anything that isn't a positive ≤6-dp decimal —
 * the null-returning gate over @suize/x402's throwing `usdcAtomic`, for the
 * places user input is validated rather than asserted. */
export const parseUsdcDecimal = (s: string): bigint | null => {
  try {
    return usdcAtomic(s)
  } catch {
    return null
  }
}

// ── The confirm dial ─────────────────────────────────────────────────────────

export type ConfirmPolicy =
  | { kind: 'each' }
  | { kind: 'auto' }
  | { kind: 'auto_under'; thresholdUnits: bigint; thresholdText: string }

/** Parse SUIZE_CONFIRM. Unknown/garbage values FAIL CLOSED to "each". */
export const confirmPolicy = (): ConfirmPolicy => {
  const raw = env('SUIZE_CONFIRM').toLowerCase()
  if (raw === 'auto') return { kind: 'auto' }
  const m = /^auto_under_(\d+(?:\.\d{1,6})?)$/.exec(raw)
  if (m) {
    const units = parseUsdcDecimal(m[1])
    if (units !== null) return { kind: 'auto_under', thresholdUnits: units, thresholdText: m[1] }
  }
  return { kind: 'each' }
}
