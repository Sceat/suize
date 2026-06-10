/**
 * App root — the authenticated wallet entry (the v1 PAY face).
 *
 * `wallet.suize.io` IS the wallet: you arrive already meaning to sign in. Returning
 * users with a live session are restored silently (autoConnect → no click); first-time/
 * expired visitors see the PaySignIn hero with a single "Continue with Google" button.
 *
 * FLOW (the ONLY production path — pure real gate, no mock):
 *   1. On load, once the Enoki Google wallet has registered, show the SIGN-IN hero. The
 *      click is the user gesture that unblocks the OAuth popup — we never auto-fire it.
 *      Returning users skip the button (autoConnect → straight to home).
 *   2. Signed in + already has a handle  → the PayDeck (the 2-card deck + timeline).
 *   3. Signed in + first-time (no handle) → onboarding (reuses the real SuiNS handle
 *      claim) → PayDeck.
 *   4. Not signed in / login fails or is cancelled → redirect to suize.io.
 *   5. Safety net: stuck on the Loader past the timeout → redirect to suize.io.
 *
 * REUSED VERBATIM from the legacy app: useAuth (Enoki zkLogin), useIdentity + the SuiNS
 * handle flow, useWsLifecycle + the WS sponsor transport, the OnboardingShell, the
 * Loader/AmbientField/CustomCursor system, the providers stack. REBUILT: the home (now
 * PayDeck on the `account` module) + the sign-in hero (now PaySignIn).
 *
 * DEV-ONLY PREVIEW (import.meta.env.DEV — stripped from production):
 *   `?preview=<state>` renders a screen WITHOUT real OAuth so design can iterate.
 *   states: hello | name | strategy | setup | home | signin
 */

import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { useAuth } from '../data/useAuth';
import { useIdentity } from '../data/useIdentity';
import { useWsLifecycle } from '../data/useWsLifecycle';
import { AmbientField, Loader } from '../system';
import type { OnboardingBeat } from '../screens/onboarding/OnboardingShell';
import { OnboardingShell } from '../screens/onboarding/OnboardingShell';
import { CustomCursor } from '../system/CustomCursor';
import { PayDeck } from '../screens/PayDeck';
import { PaySignIn } from '../screens/PaySignIn';

const LANDING_URL = 'https://suize.io';

// The DEV-only redesign lab (`?preview=redesign`) — lazy so its module (and its
// scoped rd.css) never loads unless the preview is actually opened.
const RedesignLab = lazy(() => import('../redesign/Lab'));

/** App entry — the real authenticated PAY wallet. */
export function App() {
  return <RealApp />;
}

/** If sign-in hasn't resolved within this window, redirect to the landing. */
const SIGN_IN_TIMEOUT_MS = 15_000;
/** Signed in, but the WS (handle/sponsor transport) never connects — give the backoff a
 *  fair window, then bail to the landing rather than an infinite Loader. */
const WS_CONNECT_TIMEOUT_MS = 28_000;

type Phase = 'authenticating' | 'onboarding' | 'home' | 'redirecting';

// ── DEV-ONLY preview states (tree-shaken from production via import.meta.env.DEV) ──
type Preview = 'hello' | 'name' | 'strategy' | 'setup' | 'home' | 'signin' | 'redesign' | null;
const PREVIEW_STATES = ['hello', 'name', 'strategy', 'setup', 'home', 'signin', 'redesign'] as const;

/** Read `?preview=<state>` — only ever called inside an `import.meta.env.DEV` guard. */
function readPreview(): Preview {
  if (typeof window === 'undefined') return null;
  const p = new URLSearchParams(window.location.search).get('preview');
  return (PREVIEW_STATES.includes(p as (typeof PREVIEW_STATES)[number]) ? p : null) as Preview;
}

/** The full-screen editorial field the onboarding lives in (the mockup `.sec`). */
function Column({ children }: { children: ReactNode }) {
  return (
    <div
      className="relative flex min-h-[100dvh] w-full flex-col justify-center"
      style={{ padding: 'clamp(48px, 9vh, 120px) var(--pad)' }}
    >
      {children}
    </div>
  );
}

function RealApp() {
  const auth = useAuth();
  // Open the single Enoki-verified WS once signed-in (drives the handle/sponsor RPCs).
  useWsLifecycle(auth.ownerAddress);
  const identity = useIdentity(auth.ownerAddress);

  const [phase, setPhase] = useState<Phase>('authenticating');

  // DEV-ONLY: a `?preview=` state suppresses real auth so the design hatch renders
  // in isolation. `false` in production (folds away → tree-shaken).
  const previewActive = import.meta.env.DEV && readPreview() !== null;

  // ── safety timeout: never spin forever on the Loader ──────────────────────────
  const waitingForClick = auth.status === 'idle' && auth.canSignIn;
  useEffect(() => {
    if (previewActive) return;
    if (phase !== 'authenticating') return;
    if (waitingForClick) return; // showing the Continue button — don't bounce the user
    const ms = auth.status === 'signed-in' ? WS_CONNECT_TIMEOUT_MS : SIGN_IN_TIMEOUT_MS;
    const t = setTimeout(() => setPhase('redirecting'), ms);
    return () => clearTimeout(t);
  }, [previewActive, auth.status, phase, waitingForClick]);

  // ── route by auth + handle once signed in ─────────────────────────────────────
  useEffect(() => {
    if (previewActive) return;
    if (auth.status === 'signed-in') {
      if (identity.loading) return; // wait for handle resolution
      setPhase(identity.hasHandle ? 'home' : 'onboarding');
    }
  }, [previewActive, auth.status, identity.loading, identity.hasHandle]);

  // ── redirect to the landing on failure/cancel/timeout ─────────────────────────
  useEffect(() => {
    if (previewActive) return;
    if (phase === 'redirecting' && typeof window !== 'undefined') {
      window.location.href = LANDING_URL;
    }
  }, [previewActive, phase]);

  // ── DEV-ONLY preview (stripped from production) ───────────────────────────────
  if (import.meta.env.DEV) {
    const preview = readPreview();
    if (preview) {
      // the REDESIGN LAB — the proposed onboarding/wallet/business faces behind a
      // header switcher (src/redesign/). Renders standalone: it owns its backdrop
      // and mounts its own CustomCursor, so the Shell (AmbientField) stays out.
      if (preview === 'redesign') {
        return (
          <Suspense fallback={null}>
            <RedesignLab />
          </Suspense>
        );
      }
      if (preview === 'home') {
        const demo = new URLSearchParams(window.location.search).get('demo') === '1';
        return (
          <Shell>
            <PayDeck
              ownerAddress={auth.ownerAddress ?? PREVIEW_ADDRESS}
              handle={identity.handle || PREVIEW_HANDLE}
              demo={demo}
            />
          </Shell>
        );
      }
      if (preview === 'signin') {
        return (
          <Shell>
            <PaySignIn onContinue={() => {}} />
          </Shell>
        );
      }
      const beat: OnboardingBeat =
        preview === 'hello'
          ? 'hello'
          : preview === 'strategy'
            ? 'strategy'
            : preview === 'setup'
              ? 'setup'
              : 'name';
      return (
        <Shell>
          <Column>
            <OnboardingShell startBeat={beat} hold onDone={() => {}} />
          </Column>
        </Shell>
      );
    }
  }

  // ── REAL phases ───────────────────────────────────────────────────────────────
  if (phase === 'authenticating' || phase === 'redirecting') {
    // Registered + no live session → the click-to-start hero (the user gesture that
    // unblocks the OAuth popup). Returning users never reach here (autoConnect routes home).
    if (phase === 'authenticating' && waitingForClick) {
      return (
        <Shell>
          <PaySignIn
            onContinue={() => void auth.signInWithGoogle().catch(() => setPhase('redirecting'))}
          />
        </Shell>
      );
    }
    return (
      <Shell>
        <Centered>
          <Loader
            eyebrow={phase === 'redirecting' ? 'Heading out' : 'Welcome back'}
            label={phase === 'redirecting' ? 'returning to suize.io' : 'signing you in'}
          />
        </Centered>
      </Shell>
    );
  }

  if (phase === 'onboarding') {
    return (
      <Shell>
        <Column>
          <OnboardingShell name={identity.suggestedName} onDone={() => setPhase('home')} />
        </Column>
      </Shell>
    );
  }

  return (
    <Shell>
      <PayDeck ownerAddress={auth.ownerAddress ?? ''} handle={identity.handle} />
    </Shell>
  );
}

/** DEV preview-only placeholder identity (never reaches production). */
const PREVIEW_ADDRESS = '0x0000000000000000000000000000000000000000000000000000000000000000';
const PREVIEW_HANDLE = 'you@suize';

/** The app shell: the ambient field behind everything + the global custom cursor. */
function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="relative min-h-[100dvh] w-full">
      <AmbientField />
      {children}
      <CustomCursor />
    </div>
  );
}

/** A full-viewport centered stage (for the loader states). */
function Centered({ children }: { children: ReactNode }) {
  return <div className="grid min-h-[100dvh] w-full place-items-center px-6">{children}</div>;
}
