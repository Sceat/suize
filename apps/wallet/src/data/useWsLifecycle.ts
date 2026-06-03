/**
 * The React bridge that wires the non-React WS store to the live dapp-kit/Enoki
 * session. Mount it ONCE near the app root (App.tsx).
 *
 * Two jobs, both effects:
 *   1. Register a personal-message signer thunk into the store, sourced from
 *      dapp-kit's `useSignPersonalMessage` (the live zkLogin session). The store's
 *      auth handshake calls this when the server sends `signatureRequest`.
 *   2. Drive the connection: `connect(address)` once an owner address exists and
 *      the signer is ready; `disconnect()` when the address goes away (sign-out).
 *
 * This mirrors how aresrpg's `ws/index.ts` pulls its signer + address out of the
 * zustand `use_auth` store (`use_auth.subscribe(... connect()/disconnect())`) — we
 * just source them from the dapp-kit React hooks instead and push them into the
 * store via `registerSigner` so the store itself stays React-free + testable.
 */

import { useEffect } from 'react';
import { useSignPersonalMessage } from '@mysten/dapp-kit';
import { registerSigner, use_ws } from './ws';

/**
 * Open the single WS once signed-in, close it on sign-out.
 *
 * @param ownerAddress the verified zkLogin owner address (from `useAuth`), or null.
 */
export function useWsLifecycle(ownerAddress: string | null): void {
  const { mutateAsync: signPersonalMessage } = useSignPersonalMessage();

  // Register / refresh the signer thunk. dapp-kit resolves account + chain from
  // the live session, so we only pass `message`; it returns base64 { bytes, signature }.
  useEffect(() => {
    registerSigner(async (message: Uint8Array) => {
      const { bytes, signature } = await signPersonalMessage({ message });
      return { bytes, signature };
    });
    return () => registerSigner(null);
  }, [signPersonalMessage]);

  // Connect when an owner address arrives; disconnect when it leaves.
  useEffect(() => {
    if (!ownerAddress) {
      // Only tear down if we actually had a connection (idempotent otherwise).
      if (use_ws.getState().status !== 'disconnected') use_ws.disconnect();
      return;
    }
    use_ws.connect(ownerAddress);
    // Intentionally NOT disconnecting on address-stable re-renders; connect() is a
    // no-op when already connecting/open. Sign-out (null address) is handled above.
  }, [ownerAddress]);
}
