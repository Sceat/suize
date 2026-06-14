/**
 * Identity seam — does this signed-in owner already have a Suize handle?
 *
 * Drives the post-login fork: a returning user (handle exists) goes straight to
 * Home; a first-time user (no handle) gets the minimal onboarding.
 *
 * ON-CHAIN ONLY (owner law, 2026-06-11 — "we only ask on chain, nothing else"):
 * the gate is the SuiNS REVERSE record, read client-side via
 * `resolveHandleOnChain(address, client)`. No localStorage cache (origin-scoped
 * caches told a fresh browser the owner was a new user) and no backend `/me`
 * (a disabled/erroring backend told an existing owner to pick a name again).
 * The chain answers identically on every device, every origin, every time.
 *
 * FAILURE DISCIPLINE: a flaky RPC read must NEVER dump an existing user into
 * the name-picker. Reads retry (3 attempts, backoff); only a *definitive*
 * "no `*.suize.sui` name for this address" routes to onboarding. After
 * exhausted retries we still fail to onboarding (the recoverable path — the
 * availability check + the claim both fail closed server/chain-side), but that
 * is the last resort, not the first response.
 *
 * The `{ loading, hasHandle, handle, suggestedName }` contract is unchanged.
 * `suggestedName` is now always '' — it came from the deleted backend `/me`.
 */

import { useEffect, useState } from 'react';
import { useSuiClient } from '@mysten/dapp-kit';
import { resolveHandleOnChain } from './suins';

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

const ATTEMPTS = 3;
const BACKOFF_MS = 800;

/**
 * @param ownerAddress the signed-in zkLogin address (null until signed in).
 * @param refetchKey   bump to force a fresh chain read — the post-claim caller
 *   (App.tsx) increments this so the reverse record set by the claim is read
 *   back from chain and confirms the optimistic handle it is already showing.
 */
export function useIdentity(ownerAddress: string | null, refetchKey = 0): Identity {
  const client = useSuiClient();
  const [loading, setLoading] = useState(true);
  const [hasHandle, setHasHandle] = useState(false);
  const [handle, setHandle] = useState('');

  useEffect(() => {
    if (!ownerAddress) {
      setLoading(true);
      setHasHandle(false);
      setHandle('');
      return;
    }

    let cancelled = false;
    setLoading(true);

    (async () => {
      for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
        try {
          const found = await resolveHandleOnChain(ownerAddress, client);
          if (cancelled) return;
          setHasHandle(found != null);
          setHandle(found ?? '');
          setLoading(false);
          return;
        } catch {
          // transient RPC failure — retry before concluding anything
          if (cancelled) return;
          if (attempt < ATTEMPTS) {
            await new Promise((r) => setTimeout(r, BACKOFF_MS * attempt));
          }
        }
      }
      // retries exhausted — fail to onboarding (recoverable; claim fails closed)
      if (!cancelled) {
        setHasHandle(false);
        setHandle('');
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [ownerAddress, client, refetchKey]);

  return { loading, hasHandle, handle, suggestedName: '' };
}
