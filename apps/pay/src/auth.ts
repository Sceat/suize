import { useCallback, useMemo } from 'react'
import {
  useConnectWallet,
  useCurrentAccount,
  useCurrentWallet,
  useDisconnectWallet,
  useWallets,
} from '@mysten/dapp-kit'
import type { WalletWithRequiredFeatures } from '@mysten/wallet-standard'
import { isEnokiWallet, isGoogleWallet, type EnokiWallet } from '@mysten/enoki'

// ============================================================================
// Auth surface. TWO ways to pay, ONE payer model (self-contained, 2026-06-14):
//   1. SIGN IN WITH SUIZE — pay.suize.io's OWN Enoki Google zkLogin. The
//      RegisterEnoki effect (main.tsx) injects the Google wallet into dapp-kit;
//      `sign_in_with_google` connects it (an Enoki popup, no /confirm money
//      window). It signs the sponsored bytes locally ON THIS ORIGIN.
//   2. "Connect a wallet" — any standard wallet via dapp-kit's ConnectModal
//      (Slush/Suiet/…). Also signs locally on this origin — gasless either way.
// Both end as a connected dapp-kit account with an `address`; there is no SSO
// bridge and no off-origin session anymore.
// ============================================================================

// dapp-kit's useWallets() returns WalletWithRequiredFeatures (its own bundled
// @mysten/wallet-standard copy) — structurally a superset of the `Wallet` that
// isEnokiWallet narrows. Cast the guard at this one boundary.
export type EnokiAppWallet = WalletWithRequiredFeatures & Pick<EnokiWallet, 'provider'>

const is_enoki = isEnokiWallet as unknown as (
  w: WalletWithRequiredFeatures,
) => w is EnokiAppWallet

/** ConnectModal filter — signing in with Suize has its own dedicated primary
 * button (the Enoki Google flow), so the standard-wallet modal hides any
 * registered Enoki wallet. */
export const is_standard_wallet = (w: WalletWithRequiredFeatures): boolean => !is_enoki(w)

export type AuthState = {
  /** The connected payer address (Enoki zkLogin OR a standard wallet), or null. */
  address: string | null
  /** true = an Enoki zkLogin session (signs locally with the Google account). */
  is_suize: boolean
  /** "Suize account" for zkLogin, else the wallet's own name; null signed out. */
  wallet_label: string | null
  /** true once Enoki is wired AND the Google zkLogin wallet has registered —
   *  i.e. `sign_in_with_google` can actually connect. The Enoki wallet registers
   *  via a SEPARATE async effect a frame after load, so this flips false→true. */
  can_sign_in: boolean
  /** Trigger Google zkLogin (opens the Enoki OAuth popup — call from a user
   *  gesture). The address arrives reactively via `address` once connected.
   *  No-ops if Enoki/the Google wallet is unavailable (Connect-a-wallet remains). */
  sign_in_with_google: () => void
  sign_out: () => void
}

export const useAuth = (): AuthState => {
  const account = useCurrentAccount()
  const { currentWallet } = useCurrentWallet()
  const { mutate: disconnect } = useDisconnectWallet()
  const { mutate: connect } = useConnectWallet()
  const wallets = useWallets()

  // The registered Enoki Google zkLogin wallet, if any.
  const google_wallet = useMemo(
    () => wallets.find((w) => isEnokiWallet(w) && isGoogleWallet(w)),
    [wallets],
  )

  // A connected wallet counts as signed in (dapp-kit autoConnect restores the
  // session silently — pay-links open one-tap on return visits).
  const address = account?.address ?? null
  const is_suize = Boolean(currentWallet && is_enoki(currentWallet))

  const sign_in_with_google = useCallback(() => {
    // No-op if Enoki isn't wired (or the Google wallet didn't register) — the
    // Connect-a-wallet path stays available. The address arrives reactively.
    if (!google_wallet || account) return
    connect({ wallet: google_wallet })
  }, [google_wallet, account, connect])

  return {
    address,
    is_suize,
    wallet_label:
      address && currentWallet ? (is_suize ? 'Suize account' : currentWallet.name) : null,
    can_sign_in: Boolean(google_wallet),
    sign_in_with_google,
    sign_out: () => disconnect(),
  }
}
