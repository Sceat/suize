import { SuiGrpcClient } from '@mysten/sui/grpc'
import { registerEnokiWallets } from '@mysten/enoki'
import { CRASH_NETWORK, RPC_URL } from './config'

// ============================================================================
// Enoki (zkLogin + sponsored gas) registration.
// ----------------------------------------------------------------------------
// API confirmed against the installed types (@mysten/enoki 1.0.8 /
// @mysten/sui 2.17.0), the proven React/bun/Enoki pattern:
//
//   import { SuiGrpcClient } from '@mysten/sui/grpc'
//   registerEnokiWallets({ apiKey, client, network, providers:{ google:{...} } })
//
// Transport = gRPC-web (Mysten retired the public JSON-RPC endpoints). Enoki's
// `client` param is typed `ClientWithCoreApi`, so any v2 client satisfies it;
// SuiGrpcClient is a browser-native GrpcWebFetchTransport client. We build it
// from RPC_URL (a gRPC base URL — `grpcUrl(net)` with the VITE_SUI_RPC_URL override).
//
// The registered Enoki wallet SPONSORS GAS automatically: its internal
// signTransaction / signAndExecuteTransaction goes through Enoki's
// create/execute-SponsoredTransaction flow. So once connected through this
// wallet, every write via dapp-kit's useSignAndExecuteTransaction is gasless +
// (typically) popupless. allowedMoveCallTargets are enforced server-side in the
// Enoki portal app config (see .env.example for the exact list to enable).
// ============================================================================

export const ENOKI_API_KEY = import.meta.env.VITE_ENOKI_API_KEY?.trim() || ''
export const GOOGLE_CLIENT_ID =
  import.meta.env.VITE_GOOGLE_CLIENT_ID?.trim() || ''

// True only when BOTH secrets are present. Drives the graceful fallback: without
// keys we never register Enoki wallets and the UI shows a standard ConnectButton.
export const ENOKI_ENABLED = Boolean(ENOKI_API_KEY && GOOGLE_CLIENT_ID)

let unregister: (() => void) | null = null

// Register the Enoki zkLogin (Google) wallet so it appears in dapp-kit's
// useWallets(). Safe to call once at startup; a no-op when keys are missing.
export const setup_enoki = (): void => {
  if (!ENOKI_ENABLED) {
    // Not an error — this is the documented keyless fallback path.
    console.info(
      '[crash-sui] Enoki keys absent — using standard wallet connect. ' +
        'Set VITE_ENOKI_API_KEY + VITE_GOOGLE_CLIENT_ID for Google sign-in.',
    )
    return
  }
  try {
    const client = new SuiGrpcClient({ baseUrl: RPC_URL, network: CRASH_NETWORK })
    const result = registerEnokiWallets({
      client,
      network: CRASH_NETWORK,
      apiKey: ENOKI_API_KEY,
      providers: {
        google: {
          clientId: GOOGLE_CLIENT_ID,
          // Google returns the user to this EXACT uri after auth; it must be
          // registered in the OAuth client's "Authorized redirect URIs" or
          // Google rejects with redirect_uri_mismatch. We use `${origin}/enoki`
          // — the same path the shared AresRPG/movable OAuth client already
          // whitelists. main.tsx detects this path on return and flushes back to /.
          redirectUrl:
            typeof window !== 'undefined'
              ? `${window.location.origin}/enoki`
              : undefined,
        },
      },
    })
    unregister = result.unregister
  } catch (e) {
    // Never crash the app on a bad key — degrade to standard wallets.
    console.error('[crash-sui] registerEnokiWallets failed:', e)
  }
}

export const teardown_enoki = (): void => {
  unregister?.()
  unregister = null
}
