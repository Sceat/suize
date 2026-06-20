/**
 * App root — the authenticated Suize wallet (the production face, owner-picked
 * 2026-06-10: Journey onboarding · the Deck wallet · the Business console).
 *
 * FLOW (pure real gate, no mock):
 *   1. On load, once the Enoki Google wallet has registered, show the HELLO
 *      screen — its "Continue with Google" click starts the full-page OAuth
 *      redirect. Returning users skip it (autoConnect → home).
 *   2. Signed in + handle        → the WalletDeck (the money-first face).
 *   3. Signed in + no handle     → ClaimFlow (real availability + the real
 *      two-leg claim inside the setting-up manifest) → the WalletDeck.
 *   4. Sign-in fails / times out → redirect to suize.io.
 *
 * The BUSINESS face (the console) is one masthead tap away; honest zeros until
 * the merchant feed exists. Everything renders inside the `.rd` chassis (the
 * ambient field + grain that give the glass its contrast).
 *
 * Auth is the ONLY way in — there is no preview/bypass route. Every screen is
 * gated behind the real Enoki zkLogin session.
 */

import { useEffect, useState, type ReactNode } from 'react';
import { useAuth } from '../data/useAuth';
import { useIdentity } from '../data/useIdentity';
import { useWsLifecycle } from '../data/useWsLifecycle';
import { Loader } from '../system';
import { HelloScreen, ClaimFlow } from '../ui/Onboarding';
import { WalletDeck } from '../ui/WalletDeck';
import { BusinessConsole } from '../ui/BusinessConsole';
import '../ui/rd.css';

const LANDING_URL = 'https://suize.io';

/** If sign-in hasn't resolved within this window, redirect to the landing. */
const SIGN_IN_TIMEOUT_MS = 15_000;
/** Signed in, but the WS (handle/sponsor transport) never connects — give the backoff a
 *  fair window, then bail to the landing rather than an infinite Loader. */
const WS_CONNECT_TIMEOUT_MS = 28_000;

type Phase = 'authenticating' | 'onboarding' | 'home' | 'redirecting';
type Face = 'wallet' | 'business';

export function App() {
  return <RealApp />;
}

function RealApp() {
  const auth = useAuth();
  // Open the single Enoki-verified WS once signed-in (drives the handle/sponsor RPCs).
  useWsLifecycle(auth.ownerAddress);
  // `identityKey` bumps after a claim → forces useIdentity to re-read the chain so
  // the just-set reverse record confirms the optimistic handle we already show.
  const [identityKey, setIdentityKey] = useState(0);
  const identity = useIdentity(auth.ownerAddress, identityKey);

  const [phase, setPhase] = useState<Phase>('authenticating');
  const [face, setFace] = useState<Face>('wallet');
  // The handle the claim just minted — shown OPTIMISTICALLY the instant Home
  // renders, because the chain reverse-record read lags the claim by a beat.
  // The chain read overrides it the moment it confirms (identity.handle wins).
  const [optimisticHandle, setOptimisticHandle] = useState('');
  const displayHandle = identity.handle || optimisticHandle;

  // ── safety timeout: never spin forever on the Loader ──────────────────────────
  const waitingForClick = auth.status === 'idle' && auth.canSignIn;
  useEffect(() => {
    if (phase !== 'authenticating') return;
    if (waitingForClick) return; // showing the Hello CTA — don't bounce the user
    const ms = auth.status === 'signed-in' ? WS_CONNECT_TIMEOUT_MS : SIGN_IN_TIMEOUT_MS;
    const t = setTimeout(() => setPhase('redirecting'), ms);
    return () => clearTimeout(t);
  }, [auth.status, phase, waitingForClick]);

  // ── route by auth + handle once signed in ─────────────────────────────────────
  useEffect(() => {
    if (auth.status === 'signed-in' && phase === 'authenticating') {
      if (identity.loading) return; // wait for handle resolution
      setPhase(identity.hasHandle ? 'home' : 'onboarding');
    }
  }, [auth.status, phase, identity.loading, identity.hasHandle]);

  // ── redirect to the landing on failure/cancel/timeout ─────────────────────────
  useEffect(() => {
    if (phase === 'redirecting' && typeof window !== 'undefined') {
      window.location.href = LANDING_URL;
    }
  }, [phase]);

  // ── REAL phases ───────────────────────────────────────────────────────────────
  if (phase === 'authenticating' || phase === 'redirecting') {
    // Registered + no live session → the Hello screen; its click starts the
    // full-page OAuth redirect. Returning users never reach here (autoConnect
    // routes straight home).
    if (phase === 'authenticating' && waitingForClick) {
      return (
        <Chassis>
          <HelloScreen
            onGoogle={() => void auth.signInWithGoogle().catch(() => setPhase('redirecting'))}
          />
        </Chassis>
      );
    }
    return (
      <Chassis>
        <Centered>
          <Loader
            eyebrow={phase === 'redirecting' ? 'Heading out' : 'Welcome back'}
            label={phase === 'redirecting' ? 'returning to suize.io' : 'signing you in'}
          />
        </Centered>
      </Chassis>
    );
  }

  if (phase === 'onboarding') {
    return (
      <Chassis>
        <ClaimFlow
          suggestedName={identity.suggestedName}
          onDone={(claimed) => {
            // Show the just-claimed handle immediately (the masthead + the
            // Add-Funds QR/copy) and kick a fresh chain read to confirm it.
            setOptimisticHandle(claimed);
            setIdentityKey((n) => n + 1);
            setPhase('home');
          }}
        />
      </Chassis>
    );
  }

  // home — the two faces of the one wallet
  const owner = auth.ownerAddress ?? '';
  // Sign out: drop the zkLogin session, reset to the Hello gate (autoConnect
  // will NOT restore a disconnected wallet — the next entry is a fresh Google tap).
  const signOut = () => {
    auth.signOut();
    setFace('wallet');
    setPhase('authenticating');
  };
  return (
    <Chassis business={face === 'business'}>
      {/* The wallet face stays MOUNTED across the switch (hidden via display, not
          unmounted), so its live AI chat — a pending confirm card, the in-flight brain
          turn, the transcript, scroll — survives a trip to the business console and back.
          `display: contents` keeps WalletDeck the direct flex child of .rd-stage for
          layout (no .rd-stage>child selectors exist, so this is safe). The business face
          mounts on demand on top. */}
      <div style={{ display: face === 'wallet' ? 'contents' : 'none' }}>
        <WalletDeck
          ownerAddress={owner}
          handle={displayHandle}
          onOpenBusiness={() => setFace('business')}
          onSignOut={signOut}
        />
      </div>
      {face === 'business' ? (
        <BusinessConsole
          ownerAddress={owner}
          handle={displayHandle}
          onBack={() => setFace('wallet')}
          onSignOut={signOut}
        />
      ) : null}
    </Chassis>
  );
}

/** The app chassis — the `.rd` token scope, the ambient field the glass needs,
 *  the grain, and the custom cursor. The business face flips the room. */
function Chassis({ children, business = false }: { children: ReactNode; business?: boolean }) {
  return (
    <div className="rd" data-rd-room={business ? 'business' : undefined}>
      <div className="rd-amb" aria-hidden="true">
        <i />
      </div>
      <div className="rd-stage">{children}</div>
    </div>
  );
}

/** A full-viewport centered stage (for the loader states). */
function Centered({ children }: { children: ReactNode }) {
  return <div style={{ display: 'grid', placeItems: 'center', flex: '1 1 auto' }}>{children}</div>;
}
