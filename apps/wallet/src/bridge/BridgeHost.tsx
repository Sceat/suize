/**
 * The bridge HOST — the headless component the /bridge iframe entry renders.
 * Protocol + security model: `@suize/shared/bridge` (the wire is defined there;
 * the POLICY — who may connect — is `origins.ts` here).
 *
 * Silent surface, ONE op:
 *   • getSession — the signed-in address (or null). Nothing else leaks, and
 *     NOTHING signs here. (The designed `signAuthNonce` op — a zero-click
 *     signer for sharing the session into another product's backend WS — is
 *     deliberately not shipped until a consumer needs it; see
 *     `@suize/shared/bridge`.)
 *
 * SETTLE GATE: the session restores ASYNCHRONOUSLY after this iframe mounts
 * (Enoki registers in an effect, then dapp-kit autoConnect decrypts the zkLogin
 * session out of IndexedDB) — answering `getSession` straight from
 * `useCurrentAccount()` would race it and report a logged-in user as null
 * (which is exactly how the suite-wide auto-login silently broke). So: when
 * dapp-kit's OWN persisted marker (`sui-dapp-kit:wallet-connection-info`, same
 * origin) says a wallet was connected, a session is EXPECTED — hold the answer
 * until the account materializes, with a hard deadline for the stale-marker
 * case (expired session). No marker → null immediately. We gate on the marker,
 * not `useAutoConnectWallet()`, because that hook reports 'attempted' when the
 * Enoki wallet simply hasn't REGISTERED yet — the same race wearing a hat.
 *
 * Money never moves here — that is the /confirm popup's job (visible UI).
 *
 * Handshake: the PARENT posts `suize-bridge-connect` to this window carrying a
 * MessagePort; we accept only allowlisted `event.origin`s, then answer `ready`
 * on the port and serve requests there (ports are pairwise — nothing else can
 * inject frames afterwards). A repeated connect simply replaces the port
 * (parent reloads / retries are idempotent).
 */

import { useEffect, useRef } from 'react';
import { useCurrentAccount } from '@mysten/dapp-kit';
import {
  BRIDGE_V,
  type BridgeReady,
  type BridgeRequest,
  type BridgeResponse,
} from '@suize/shared/bridge';
import { isAllowedBridgeOrigin } from './origins';

/** How long getSession waits for autoConnect to restore an EXPECTED session
 *  before answering null (covers the stale-marker / expired-session case).
 *  Must stay under the client's 8s getSession timeout. */
const SETTLE_DEADLINE_MS = 6_000;

/** True when dapp-kit persisted a prior wallet connection on this origin —
 *  i.e. autoConnect is about to restore a session and `null` would be a lie. */
function expectsSession(): boolean {
  try {
    const raw = localStorage.getItem('sui-dapp-kit:wallet-connection-info');
    if (!raw) return false;
    const parsed = JSON.parse(raw) as { state?: { lastConnectedWalletName?: string | null } };
    return Boolean(parsed?.state?.lastConnectedWalletName);
  } catch {
    return false;
  }
}

export function BridgeHost() {
  const account = useCurrentAccount();
  const address = account?.address ?? null;

  // The live session, readable from the (stable) message handler.
  const sessionRef = useRef<{ address: string | null }>({ address: null });
  sessionRef.current.address = address;

  // getSession requests parked until the expected session restores (or the
  // deadline passes). Flushed by the address effect below.
  const pendingRef = useRef<Array<{ port: MessagePort; id: string; timer: number }>>([]);

  // Session restored → answer everything that was waiting on it.
  useEffect(() => {
    if (!address) return;
    for (const { port, id, timer } of pendingRef.current.splice(0)) {
      window.clearTimeout(timer);
      port.postMessage({ id, ok: true, data: { address } } satisfies BridgeResponse);
    }
  }, [address]);

  useEffect(() => {
    let port: MessagePort | null = null;

    const answer = (p: MessagePort, res: BridgeResponse) => p.postMessage(res);

    const serve = (p: MessagePort, req: BridgeRequest): void => {
      if (!req || typeof req.id !== 'string') return;
      if (req.op === 'getSession') {
        // No session YET, but one is expected — park the request instead of
        // racing autoConnect with a false null (see SETTLE GATE above).
        if (!sessionRef.current.address && expectsSession()) {
          const entry = { port: p, id: req.id, timer: 0 };
          entry.timer = window.setTimeout(() => {
            const i = pendingRef.current.indexOf(entry);
            if (i === -1) return; // already flushed by the address effect
            pendingRef.current.splice(i, 1);
            answer(p, { id: req.id, ok: true, data: { address: sessionRef.current.address } });
          }, SETTLE_DEADLINE_MS);
          pendingRef.current.push(entry);
          return;
        }
        answer(p, { id: req.id, ok: true, data: { address: sessionRef.current.address } });
        return;
      }
      answer(p, { id: (req as { id: string }).id, ok: false, error: 'unknown op' });
    };

    const onConnect = (event: MessageEvent) => {
      const msg = event.data as { type?: string; v?: number } | null;
      if (!msg || msg.type !== 'suize-bridge-connect' || msg.v !== BRIDGE_V) return;
      // THE security gate: only allowlisted parents get a channel.
      if (!isAllowedBridgeOrigin(event.origin)) return;
      const incoming = event.ports?.[0];
      if (!incoming) return;
      port?.close();
      port = incoming;
      port.onmessage = (e) => serve(incoming, e.data as BridgeRequest);
      const ready: BridgeReady = { type: 'suize-bridge-ready', v: BRIDGE_V };
      port.postMessage(ready);
    };

    window.addEventListener('message', onConnect);
    return () => {
      window.removeEventListener('message', onConnect);
      for (const { timer } of pendingRef.current.splice(0)) window.clearTimeout(timer);
      port?.close();
    };
  }, []);

  return null; // headless — the iframe renders nothing
}
