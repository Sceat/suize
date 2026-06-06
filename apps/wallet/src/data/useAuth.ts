/**
 * Auth seam — zkLogin via Enoki. REAL ONLY — there is no mock/offline session.
 *
 * Flow (production keys ARE present on testnet):
 *   `registerEnokiWallets` (providers.tsx) injects a Google zkLogin wallet into
 *   dapp-kit's `useWallets()`. `signInWithGoogle` connects it, which triggers a
 *   FULL-PAGE Google OAuth redirect to `${origin}/enoki`; on return, `autoConnect`
 *   (providers.tsx) silently restores the session and `useCurrentAccount()` exposes
 *   a stable Sui owner address (the MAIN wallet). Because the page navigates away,
 *   the address arrives REACTIVELY via `ownerAddress` after the round-trip — not as
 *   the resolved value of the click handler. Enoki sponsors gas on every write.
 *
 * NO STUB: if Enoki/Google creds are missing OR the Google zkLogin wallet isn't
 * registered, `signInWithGoogle` THROWS. App.tsx's `.catch()` then redirects to
 * https://suize.io — we NEVER fabricate a fake address or a fake session. The
 * `phase` flag only covers the brief "signing-in" flash before the OAuth
 * navigation takes the page away.
 */

import { useCallback, useMemo, useState } from 'react';
import {
  useConnectWallet,
  useCurrentAccount,
  useCurrentWallet,
  useWallets,
} from '@mysten/dapp-kit';
import { isEnokiWallet, isGoogleWallet } from '@mysten/enoki';
import { ENOKI_API_KEY, GOOGLE_CLIENT_ID } from '../lib/env';

/** True only when BOTH Enoki creds are present. */
const ENOKI_ENABLED = Boolean(ENOKI_API_KEY && GOOGLE_CLIENT_ID);

// The element type of dapp-kit's wallet list, derived from the hook itself so we
// never import `@mysten/wallet-standard` directly (it's only a transitive dep).
type DappWallet = ReturnType<typeof useWallets>[number];

export interface AuthState {
  status: 'idle' | 'signing-in' | 'signed-in';
  /** stable Sui owner address (MAIN wallet) from zkLogin, or null pre-login. */
  ownerAddress: string | null;
  /** true once a real Enoki/zkLogin wallet is connected (gas is sponsored). */
  sponsored: boolean;
  /** whether real Enoki OAuth is wired. When false, signInWithGoogle throws. */
  enokiEnabled: boolean;
  /** true once Enoki is wired AND the Google zkLogin wallet has registered into the
   *  wallet-standard registry — i.e. signInWithGoogle can actually run without
   *  throwing. The Enoki wallet registers via a SEPARATE async effect that hasn't
   *  completed at first mount, so this flips from false→true a frame after load.
   *  Auto-sign-in MUST gate on this to avoid the mount-order race. */
  canSignIn: boolean;
  /** Trigger Google zkLogin. Resolves to the address if already connected; the
   *  real path navigates the page away (resolves to '' before navigation). THROWS
   *  if Enoki/the Google wallet is unavailable (App redirects to suize.io). */
  signInWithGoogle: () => Promise<string>;
}

export function useAuth(): AuthState {
  // dapp-kit live session state.
  const account = useCurrentAccount();
  const { currentWallet } = useCurrentWallet();
  const wallets = useWallets();
  const { mutate: connect } = useConnectWallet();

  // Local flag drives ONLY the brief "signing-in" flash before the OAuth redirect
  // navigates the page away. It never holds an address.
  const [phase, setPhase] = useState<'idle' | 'signing-in'>('idle');

  // The registered Enoki Google zkLogin wallet, if any. `isEnokiWallet` narrows to
  // an Enoki wallet; `isGoogleWallet` picks the Google provider among them.
  const googleWallet = useMemo<DappWallet | undefined>(
    () => wallets.find((w) => isEnokiWallet(w) && isGoogleWallet(w)),
    [wallets],
  );

  const realAddress = account?.address ?? null;
  const sponsored = Boolean(currentWallet && isEnokiWallet(currentWallet));

  // True only once Enoki is wired AND the Google zkLogin wallet has registered.
  // This is exactly the precondition signInWithGoogle's safety throw checks, so
  // gating auto-sign-in on it guarantees the call won't throw the "unavailable"
  // error during the mount-order race.
  const canSignIn = ENOKI_ENABLED && Boolean(googleWallet);

  const ownerAddress = realAddress;
  const status: AuthState['status'] = realAddress
    ? 'signed-in'
    : phase === 'signing-in'
      ? 'signing-in'
      : 'idle';

  const signInWithGoogle = useCallback(async (): Promise<string> => {
    // No mock path. If Enoki isn't wired (or the Google wallet didn't register),
    // throw so App.tsx redirects to suize.io — we never fake a session.
    if (!ENOKI_ENABLED || !googleWallet) {
      throw new Error('Enoki zkLogin unavailable — cannot sign in.');
    }
    // Already connected from a prior session (autoConnect restored it).
    if (realAddress) return realAddress;
    // REAL OAuth: this navigates the whole page to Google and back to /enoki. The
    // address is delivered reactively via `ownerAddress` after the redirect, so
    // this promise typically does not resolve in THIS page lifetime — the brief
    // "signing-in" flag covers the moment before navigation.
    setPhase('signing-in');
    connect({ wallet: googleWallet });
    return '';
  }, [googleWallet, realAddress, connect]);

  return {
    status,
    ownerAddress,
    sponsored,
    enokiEnabled: ENOKI_ENABLED,
    canSignIn,
    signInWithGoogle,
  };
}
