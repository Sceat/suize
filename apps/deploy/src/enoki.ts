import { SuiGrpcClient } from '@mysten/sui/grpc'
import { registerEnokiWallets } from '@mysten/enoki'
import { RPC_URL, SUI_NETWORK } from './config'

// ============================================================================
// Enoki (zkLogin Google) registration — OPTIONAL login for the deploy dashboard.
// ----------------------------------------------------------------------------
// Mirrors apps/crash/src/enoki.ts. Here login is used ONLY to scope "your sites"
// by owner address: the deploy route stays OPEN (no auth) and the backend pays
// its own gas, so there is NO sponsorship to configure — connecting is a
// read-only attribution filter (and the seam future payments hang off; see
// docs/deploy/SPEC.md §8, §12).
//
// When the env keys are absent we never register Enoki and the UI falls back to
// a standard dapp-kit ConnectButton (any testnet wallet) — the dashboard never
// crashes on missing keys, and unauthenticated browsing always works.
// ============================================================================

export const ENOKI_API_KEY = import.meta.env.VITE_ENOKI_API_KEY?.trim() || ''
export const GOOGLE_CLIENT_ID =
  import.meta.env.VITE_GOOGLE_CLIENT_ID?.trim() || ''

// True only when BOTH secrets are present. Drives the graceful fallback.
export const ENOKI_ENABLED = Boolean(ENOKI_API_KEY && GOOGLE_CLIENT_ID)

let unregister: (() => void) | null = null

// Register the Enoki zkLogin (Google) wallet so it appears in dapp-kit's
// useWallets(). Safe to call once at startup; a no-op when keys are missing.
export const setup_enoki = (): void => {
  if (!ENOKI_ENABLED) {
    // Not an error — this is the documented keyless fallback path.
    console.info(
      '[suize-deploy] Enoki keys absent — using standard wallet connect. ' +
        'Set VITE_ENOKI_API_KEY + VITE_GOOGLE_CLIENT_ID for Google sign-in ' +
        '(used only to scope "your sites" by owner).',
    )
    return
  }
  try {
    const client = new SuiGrpcClient({ baseUrl: RPC_URL, network: SUI_NETWORK })
    const result = registerEnokiWallets({
      client,
      network: SUI_NETWORK,
      apiKey: ENOKI_API_KEY,
      providers: {
        google: {
          clientId: GOOGLE_CLIENT_ID,
          redirectUrl:
            typeof window !== 'undefined'
              ? `${window.location.origin}/enoki`
              : undefined,
        },
      },
    })
    unregister = result.unregister
  } catch (e) {
    // Never crash the dashboard on a bad key — degrade to standard wallets.
    console.error('[suize-deploy] registerEnokiWallets failed:', e)
  }
}

export const teardown_enoki = (): void => {
  unregister?.()
  unregister = null
}
