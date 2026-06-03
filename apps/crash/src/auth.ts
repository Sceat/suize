import {
  useConnectWallet,
  useCurrentAccount,
  useCurrentWallet,
  useDisconnectWallet,
  useWallets,
} from '@mysten/dapp-kit'
import type { WalletWithRequiredFeatures } from '@mysten/wallet-standard'
import { isEnokiWallet, type EnokiWallet } from '@mysten/enoki'
import { ENOKI_ENABLED } from './enoki'

// dapp-kit's useWallets() returns WalletWithRequiredFeatures (from its own
// bundled @mysten/wallet-standard copy), which is structurally a superset of the
// `Wallet` that isEnokiWallet narrows. The two are runtime-identical; cast the
// guard at this one boundary so the filter narrows to EnokiWallet cleanly.
// The Enoki Google wallet as it appears in dapp-kit's wallet list: a
// WalletWithRequiredFeatures that also carries Enoki's `provider` tag.
export type EnokiAppWallet = WalletWithRequiredFeatures &
  Pick<EnokiWallet, 'provider'>

const is_enoki = isEnokiWallet as unknown as (
  w: WalletWithRequiredFeatures,
) => w is EnokiAppWallet

// ============================================================================
// Auth surface for the UI.
// ----------------------------------------------------------------------------
// - When Enoki is configured, `registerEnokiWallets` (see main.tsx) injects a
//   Google zkLogin wallet into dapp-kit's useWallets(). We surface it as
//   `sign_in_google`. Connecting it triggers the Google OAuth redirect; on
//   return the wallet is connected and the user has a Sui address with no seed
//   phrase and no extension.
// - `sponsored` is true when the connected wallet is an Enoki wallet, meaning
//   every write is gasless (the wallet sponsors gas internally).
// - When Enoki is NOT configured, `google_wallet` is undefined and the UI shows
//   the standard dapp-kit ConnectButton instead (graceful fallback).
// ============================================================================

export type AuthState = {
  address: string | null
  // The Enoki Google wallet, if registered. Undefined => show ConnectButton.
  google_wallet: EnokiAppWallet | undefined
  // True when the active connection sponsors gas (Enoki/zkLogin wallet).
  sponsored: boolean
  // True when Enoki env keys were provided at build/run time.
  enoki_enabled: boolean
  connecting: boolean
  sign_in_google: () => void
  sign_out: () => void
}

export const useAuth = (): AuthState => {
  const account = useCurrentAccount()
  const { currentWallet } = useCurrentWallet()
  const wallets = useWallets()
  const { mutate: connect, isPending: connecting } = useConnectWallet()
  const { mutate: disconnect } = useDisconnectWallet()

  const enoki_wallets = wallets.filter(is_enoki)
  const google_wallet = enoki_wallets.find(w => w.provider === 'google')

  const sponsored = Boolean(currentWallet && is_enoki(currentWallet))

  return {
    address: account?.address ?? null,
    google_wallet,
    sponsored,
    enoki_enabled: ENOKI_ENABLED,
    connecting,
    sign_in_google: () => {
      if (google_wallet) connect({ wallet: google_wallet })
    },
    sign_out: () => disconnect(),
  }
}
