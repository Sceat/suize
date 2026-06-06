import {
  useConnectWallet,
  useCurrentAccount,
  useDisconnectWallet,
  useWallets,
} from '@mysten/dapp-kit'
import type { WalletWithRequiredFeatures } from '@mysten/wallet-standard'
import { isEnokiWallet, type EnokiWallet } from '@mysten/enoki'
import { ENOKI_ENABLED } from './enoki'

// dapp-kit's useWallets() returns WalletWithRequiredFeatures (its own bundled
// @mysten/wallet-standard copy), structurally a superset of the `Wallet` that
// isEnokiWallet narrows. Cast the guard at this one boundary (runtime-identical).
export type EnokiAppWallet = WalletWithRequiredFeatures &
  Pick<EnokiWallet, 'provider'>

const is_enoki = isEnokiWallet as unknown as (
  w: WalletWithRequiredFeatures,
) => w is EnokiAppWallet

// ============================================================================
// Auth surface for the dashboard.
// ----------------------------------------------------------------------------
// Login is OPTIONAL and READ-ONLY here: the deploy route is open, so signing in
// only sets `owner = the connected address` to scope "your sites". No gas, no
// sponsorship — connecting an Enoki Google wallet (or any standard wallet) just
// gives us an address to filter GET /sites by. When Enoki keys are absent,
// `google_wallet` is undefined and the UI shows the standard ConnectButton.
// ============================================================================

export type AuthState = {
  address: string | null
  // The Enoki Google wallet, if registered. Undefined => show ConnectButton.
  google_wallet: EnokiAppWallet | undefined
  // True when Enoki env keys were provided at build/run time.
  enoki_enabled: boolean
  connecting: boolean
  sign_in_google: () => void
  sign_out: () => void
}

export const useAuth = (): AuthState => {
  const account = useCurrentAccount()
  const wallets = useWallets()
  const { mutate: connect, isPending: connecting } = useConnectWallet()
  const { mutate: disconnect } = useDisconnectWallet()

  const enoki_wallets = wallets.filter(is_enoki)
  const google_wallet = enoki_wallets.find(w => w.provider === 'google')

  return {
    address: account?.address ?? null,
    google_wallet,
    enoki_enabled: ENOKI_ENABLED,
    connecting,
    sign_in_google: () => {
      if (google_wallet) connect({ wallet: google_wallet })
    },
    sign_out: () => disconnect(),
  }
}
