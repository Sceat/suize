/**
 * Beat 4 — SETUP. The calm system Loader runs while the REAL handle issuance
 * happens (gasless leaf-subname mint via the backend), then hands off to Home
 * (SPEC §1.5, §4).
 *
 * NO checklist, NO percentages, NO vessel, NO letter apparition — just the single
 * breathing bloom + the label. Copy (SPEC §4, verbatim): "setting up your wallet".
 *
 * REAL: on mount we `claimHandle(name)` over the WS (gasless, sponsored leaf-subname
 * mint). The claim now returns a SECOND, user-signed sponsored tx (`set_reverse_lookup`
 * / setDefault) — a leaf subname does NOT auto-set the reverse record, so we must sign
 * those bytes with the user's zkLogin signer (dapp-kit `useSignTransaction`, the SAME
 * path a sponsored send uses) and execute them via `setReverseRecord` BEFORE calling
 * `onComplete()`. Only after that does `resolveNameServiceNames(address)` (the `/me`
 * gate) return the handle on any device. On ANY failure — claim OR the setDefault
 * sign/execute — we surface a CALM retry (never silently complete: a handle minted
 * without its reverse record would land the user on Home with a broken gate). The owner
 * address is sourced from the live zkLogin session (`useAuth`) — by this beat the user
 * is signed in (and inside the dapp-kit WalletProvider, so the signer is available).
 *
 * `hold` parks the loader indefinitely WITHOUT claiming (the dev-only `?preview=setup`
 * state has no real session / name, so it must not fire a claim).
 */

import { useEffect, useRef, useState } from 'react';
import { useSignTransaction } from '@mysten/dapp-kit';
import { useAuth } from '../../data/useAuth';
import { claimHandle, setCachedHandle, setReverseRecord } from '../../data/suins';
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
  // The zkLogin signer (dapp-kit). Signs the sponsored setDefault bytes VERBATIM — the
  // EXACT path useHome.runSponsored uses for a sponsored send. StepSettingUp is inside
  // the WalletProvider (app/providers.tsx), so the hook resolves here.
  const { mutateAsync: signTransaction } = useSignTransaction();
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
    //
    // TWO legs, both required for a working gate:
    //   1. claimHandle  — mint the leaf (issuer-signed, sponsored) + get the sponsored
    //                     setDefault tx back.
    //   2. setDefault   — sign the sponsored bytes with the user's zkLogin signer (so
    //                     set_reverse_lookup binds the reverse record to THE USER) and
    //                     execute. A leaf alone does NOT set the reverse record, so we
    //                     must land this before completing or `/me` resolves nothing.
    // We only `onComplete()` after BOTH land — a failure at either leg surfaces the calm
    // retry (the handle may be minted; re-running the claim re-issues the setDefault bytes,
    // so the retry is idempotent and still finishes the reverse record).
    (async () => {
      try {
        const claimed = await claimHandle(name);
        if (cancelled) return;

        // Set the reverse record (the second leg). `setDefault` is null only on a
        // forward-compat backend that omits it — then the leaf is the whole claim.
        if (claimed.setDefault) {
          const { signature } = await signTransaction({
            transaction: claimed.setDefault.bytes,
          });
          if (cancelled) return;
          await setReverseRecord({ digest: claimed.setDefault.digest, signature });
          if (cancelled) return;
        }

        // Both legs landed — persist the backend-CONFIRMED handle keyed by the owner
        // address so the masthead shows it instantly and a lagging `/me` reverse lookup
        // can never blank it out. Honest: `claimed.handle` is the real on-chain mint.
        setCachedHandle(ownerAddress, claimed.handle);

        onComplete();
      } catch (e: unknown) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : 'Could not finish setting up your name.');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [hold, name, ownerAddress, onComplete, attempt, signTransaction]);

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
      <Loader eyebrow="Almost there" label="setting up your wallet" />
    </div>
  );
}
