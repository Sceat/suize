/**
 * Beat 4 — SETUP. The calm system Loader runs while the REAL handle issuance
 * happens (gasless leaf-subname mint via the backend), then hands off to Home
 * (SPEC §1.5, §4).
 *
 * NO checklist, NO percentages, NO vessel, NO letter apparition — just the single
 * breathing bloom + the label. Copy (SPEC §4, verbatim): "setting up your wallet".
 *
 * REAL: on mount we `claimHandle(name, ownerAddress)` -> POST /handle/claim
 * (gasless, sponsored leaf-subname mint) and, on success, `onComplete()`. On
 * failure we surface a CALM retry (never silently complete — the user would land
 * on Home with no handle and a broken gate). The owner address is sourced from the
 * live zkLogin session (`useAuth`) — by this beat the user is signed in.
 *
 * `hold` parks the loader indefinitely WITHOUT claiming (the dev-only `?preview=setup`
 * state has no real session / name, so it must not fire a claim).
 */

import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../../data/useAuth';
import { claimHandle } from '../../data/suins';
import { Button, Loader } from '../../system';

export function StepSettingUp({
  name,
  onComplete,
  hold = false,
}: {
  /** the bare label chosen in the NAME beat — claimed here as `<name>@suize`. */
  name: string;
  onComplete: () => void;
  hold?: boolean;
}) {
  const { ownerAddress } = useAuth();
  const [error, setError] = useState<string | null>(null);
  // Bumping `attempt` re-runs the claim effect — that's the ONLY thing the retry
  // button does (failures never auto-retry; they wait for an explicit tap).
  const [attempt, setAttempt] = useState(0);
  // De-dupe within a single attempt: StrictMode double-invokes effects in dev, and
  // we never want a double-mint. Tracks the last attempt# we actually fired a claim for.
  const firedAttempt = useRef(-1);

  useEffect(() => {
    // Dev-only preview parks the loader; no real session/name to claim against.
    if (hold) return;
    // Already fired the claim for this attempt (StrictMode re-invoke) — skip.
    if (firedAttempt.current === attempt) return;
    firedAttempt.current = attempt;

    // Missing pieces should never happen on the real path (signed-in + named), but
    // fail LOUD with a retry rather than silently completing onto a broken gate.
    if (!name || !ownerAddress) {
      setError('Something went wrong setting up your wallet.');
      return;
    }

    let cancelled = false;
    // The WS is the session — claim carries only the bare label; the backend targets
    // ws.data.address. ownerAddress is still checked above to gate WHEN we may claim.
    claimHandle(name)
      .then(() => {
        if (!cancelled) onComplete();
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : 'Could not claim your name.');
      });

    return () => {
      cancelled = true;
    };
  }, [hold, name, ownerAddress, onComplete, attempt]);

  if (error) {
    return (
      <div className="grid flex-1 place-items-center px-6">
        <div
          role="alert"
          className="flex w-full max-w-[360px] flex-col items-center gap-6 text-center"
        >
          <p
            style={{
              fontFamily: 'var(--mono)',
              fontSize: 12.5,
              lineHeight: 1.7,
              letterSpacing: '0.01em',
              color: 'var(--ink-2)',
            }}
          >
            {error}
          </p>
          <Button
            variant="primary"
            size="lg"
            onClick={() => {
              setError(null);
              setAttempt((n) => n + 1); // re-runs the claim effect once
            }}
            style={{ width: '100%' }}
          >
            Try again
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="grid flex-1 place-items-center px-6">
      <Loader label="setting up your wallet" />
    </div>
  );
}
