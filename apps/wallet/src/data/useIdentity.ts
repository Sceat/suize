/**
 * Identity seam — does this signed-in owner already have a Suize handle?
 *
 * Drives the post-login fork: a returning user (handle exists) goes straight to
 * Home; a first-time user (no handle) gets the minimal onboarding.
 *
 * REAL: asks the backend over the single WS (`handleMeRequest` → WsHandleMeResponse).
 * `hasHandle = (handle != null)` — a null handle is THE onboarding gate. The backend
 * (Redis) is the source of truth; it also does the SuiNS reverse-record backstop
 * server-side, so the frontend just trusts the response. `suggestedName` is seeded
 * from the response when present (e.g. the Google email local-part), else ''.
 *
 * The WS RPC requires the socket to be AUTHENTICATED (`connected`), so the fetch is
 * gated on the WS status — we don't ask until the Enoki handshake has bound the
 * address to `ws.data` (otherwise the request would reject "not ready" and wrongly
 * route a returning user into onboarding). While the socket is still connecting we
 * stay in `loading` (App.tsx holds on `identity.loading`).
 *
 * The `{ loading, hasHandle, suggestedName }` contract is final — no screen changes.
 * On a transient backend error (the socket is up but the RPC failed) we fail SAFE to
 * "no handle" (-> onboarding), the recoverable path (re-claim/skip) rather than a
 * forever-spinner.
 */

import { useEffect, useState } from 'react';
import { getCachedHandle, getHandleForAddress, setCachedHandle } from './suins';
import { use_ws } from './ws';

export interface Identity {
  /** true while we resolve whether a handle exists (brief). */
  loading: boolean;
  /** true if this owner already has a <name>@suize handle. */
  hasHandle: boolean;
  /** the resolved "<name>@suize" handle, or '' when none (drives the TopBar + get-paid sheet). */
  handle: string;
  /** an optional pre-fill suggestion for the handle field (first-time only). */
  suggestedName: string;
}

export function useIdentity(ownerAddress: string | null): Identity {
  const [loading, setLoading] = useState(true);
  const [hasHandle, setHasHandle] = useState(false);
  const [handle, setHandle] = useState('');
  const [suggestedName, setSuggestedName] = useState('');

  // The WS must be authenticated before we can ask "do I have a handle?" — track
  // its status so the effect re-fires the moment the handshake completes.
  const wsStatus = use_ws((s) => s.status);

  useEffect(() => {
    if (!ownerAddress) {
      setLoading(true);
      setHasHandle(false);
      setHandle('');
      setSuggestedName('');
      return;
    }

    // Wait for the Enoki handshake to bind the address to ws.data. Stay loading
    // (not failing to onboarding) until the socket is connected.
    if (wsStatus !== 'connected') {
      setLoading(true);
      return;
    }

    let cancelled = false;
    setLoading(true);

    // CACHE-FIRST: a handle confirmed by a prior successful claim (or a prior non-null
    // `/me`) on THIS device wins immediately — the masthead shows the real handle
    // without waiting on the reverse lookup, and a later empty `/me` can never blank it.
    const cached = getCachedHandle(ownerAddress);
    if (cached) {
      setHandle(cached);
      setHasHandle(true);
    }

    getHandleForAddress()
      .then((resp) => {
        if (cancelled) return;
        if (resp.handle != null) {
          // `/me` resolved (the reverse record indexed) — trust it + refresh the cache
          // so a later device sees it too.
          setHasHandle(true);
          setHandle(resp.handle);
          setCachedHandle(ownerAddress, resp.handle);
        } else if (!cached) {
          // No reverse record AND no cached claim → genuinely no handle (onboarding).
          // When `cached` is set we DON'T touch hasHandle/handle: the broken reverse
          // lookup must never override a known-good cached handle.
          setHasHandle(false);
          setHandle('');
        }
        setSuggestedName(resp.suggestedName ?? '');
      })
      .catch(() => {
        // Fail safe to onboarding (recoverable) rather than a forever-spinner — UNLESS
        // a cached handle proves this owner already claimed (then keep showing it).
        if (cancelled) return;
        if (!cached) {
          setHasHandle(false);
          setHandle('');
        }
        setSuggestedName('');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [ownerAddress, wsStatus]);

  return { loading, hasHandle, handle, suggestedName };
}
