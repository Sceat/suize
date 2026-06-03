/**
 * App root — the authenticated wallet entry.
 *
 * `wallet.suize.io` IS the wallet: you arrive already meaning to sign in (from
 * suize.io's "Access wallet"). So there is NO "continue with Google" screen.
 *
 * FLOW (the ONLY production path — pure real gate, no mock):
 *   1. On load, auto-trigger Enoki Google zkLogin. While it resolves, show the
 *      centered Loader ("signing you in") — nothing else.
 *   2. Signed in + already has a handle  -> straight to the JournalHome (no onboarding).
 *   3. Signed in + first-time (no handle) -> the 4-beat onboarding
 *      (hello -> name -> strategy -> setup) -> JournalHome.
 *   4. Not signed in / login fails or is cancelled -> redirect to suize.io.
 *   5. Safety net: if we're still signing-in after ~15s (popup silently failed,
 *      third-party cookies blocked, etc.), give up and redirect to suize.io.
 *
 * DEV-ONLY PREVIEW (import.meta.env.DEV — fully stripped from production builds):
 *   `?preview=<state>` renders a screen WITHOUT real OAuth so design can iterate.
 *   states: hello | name | strategy | setup | home | advanced
 *   e.g. /?preview=hello   /?preview=strategy   /?preview=advanced
 *   `?preview=advanced` is the same JournalHome as `home` (the journal has no
 *   simple/advanced split — the demo ribbon drives the fresh/in-use states).
 *   This entire branch is behind `if (import.meta.env.DEV)` so the production
 *   bundle never ships it.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useAuth } from '../data/useAuth';
import { useIdentity } from '../data/useIdentity';
import { useHome } from '../data/useHome';
import { useWsLifecycle } from '../data/useWsLifecycle';
import { AmbientField, Loader, JournalHome } from '../system';
import type { OnboardingBeat } from '../screens/onboarding/OnboardingShell';
import { OnboardingShell } from '../screens/onboarding/OnboardingShell';

const LANDING_URL = 'https://suize.io';

/** If sign-in hasn't resolved within this window, redirect to the landing. */
const SIGN_IN_TIMEOUT_MS = 15_000;

type Phase = 'authenticating' | 'onboarding' | 'home' | 'redirecting';

// ── DEV-ONLY preview states (tree-shaken from production via import.meta.env.DEV) ──
type Preview = 'hello' | 'name' | 'strategy' | 'setup' | 'home' | 'advanced' | null;

const PREVIEW_STATES = ['hello', 'name', 'strategy', 'setup', 'home', 'advanced'] as const;

/** Read `?preview=<state>` — only ever called inside an `import.meta.env.DEV` guard. */
function readPreview(): Preview {
  if (typeof window === 'undefined') return null;
  const p = new URLSearchParams(window.location.search).get('preview');
  return (PREVIEW_STATES.includes(p as (typeof PREVIEW_STATES)[number]) ? p : null) as Preview;
}

/** The FULL-SCREEN EDITORIAL field the onboarding lives in (mockup `.sec`): full
 *  width, the mockup's `--pad` (clamp(24px,6vw,120px)) horizontal padding, content
 *  vertically centred and LEFT-anchored (each step caps its own content measure with
 *  `maxWidth`). NO narrow reading column — it reads as full-screen editorial on a
 *  wide screen and collapses to edge-to-edge single-column on a phone (where `--pad`
 *  is 24px). The WalletShell provides its own full-width editorial shell, so it is
 *  NOT wrapped here. */
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

export function App() {
  const auth = useAuth();
  // Open the single Enoki-verified WS once signed-in (registers the personal-message
  // signer + drives connect/disconnect off the owner address). All data — handle
  // availability/me/claim, sponsor, execute, balance pushes — rides this socket.
  useWsLifecycle(auth.ownerAddress);
  const identity = useIdentity(auth.ownerAddress);
  // The data hook is always called (stable hook order). With no address it renders
  // an honest-empty snapshot; once zkLogin resolves an owner it layers live balances.
  // Thread the resolved handle so the TopBar chip + get-paid sheet show the real @name.
  const home = useHome(auth.ownerAddress, identity.handle);

  const [phase, setPhase] = useState<Phase>('authenticating');
  // guard so the auto-login fires exactly once
  const triggered = useRef(false);

  // DEV-ONLY: when a `?preview=` state is active, suppress the real auth effects so
  // the design hatch renders in isolation (no OAuth, no suize.io redirect). This is
  // `false` in production (import.meta.env.DEV is statically false → the whole
  // expression folds to `false` and the guards below tree-shake away).
  const previewActive = import.meta.env.DEV && readPreview() !== null;

  // ── auto-trigger Google zkLogin on load ────────────────────────────────────
  useEffect(() => {
    if (previewActive) return; // DEV preview: never fire real OAuth
    if (triggered.current) return;
    if (auth.status === 'idle') {
      triggered.current = true;
      // Real Enoki: this navigates the page to Google and back to /enoki, then
      // autoConnect restores the session and `status` becomes 'signed-in'. If
      // Enoki isn't wired, signInWithGoogle throws -> redirect to suize.io.
      void auth.signInWithGoogle().catch(() => setPhase('redirecting'));
    }
  }, [previewActive, auth.status, auth.signInWithGoogle]);

  // ── safety timeout: a silently-failed popup must not spin forever ───────────
  useEffect(() => {
    if (previewActive) return; // DEV preview: no timeout/redirect
    // Once we're signed-in (or already redirecting) there's nothing to time out.
    if (auth.status === 'signed-in' || phase === 'redirecting') return;
    const t = setTimeout(() => {
      // Still not signed in after the window — bail to the landing.
      setPhase('redirecting');
    }, SIGN_IN_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [previewActive, auth.status, phase]);

  // ── route by auth + handle once signed in ───────────────────────────────────
  useEffect(() => {
    if (previewActive) return; // DEV preview: don't route on auth
    if (auth.status === 'signed-in') {
      if (identity.loading) return; // wait for handle resolution
      setPhase(identity.hasHandle ? 'home' : 'onboarding');
    }
  }, [auth.status, identity.loading, identity.hasHandle]);

  // ── redirect to the landing on failure/cancel/timeout ───────────────────────
  useEffect(() => {
    if (previewActive) return; // DEV preview: never redirect away
    if (phase === 'redirecting' && typeof window !== 'undefined') {
      window.location.href = LANDING_URL;
    }
  }, [previewActive, phase]);

  // ── DEV-ONLY preview (stripped from production — guarded by import.meta.env.DEV) ──
  if (import.meta.env.DEV) {
    const preview = readPreview();
    if (preview) {
      // The journal has no simple/advanced split — both `?preview=home` and the legacy
      // `?preview=advanced` render the same JournalHome (the demo ribbon drives the
      // fresh/in-use states the old advanced face used to). Kept so existing hatch
      // links keep working.
      if (preview === 'home' || preview === 'advanced') {
        return (
          <Shell>
            <JournalHome home={home} />
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
            {/* hold = freeze on this beat so each `?preview=` state renders in isolation */}
            <OnboardingShell startBeat={beat} hold onDone={() => {}} />
          </Column>
        </Shell>
      );
    }
  }

  // ── REAL phases ────────────────────────────────────────────────────────────
  if (phase === 'authenticating' || phase === 'redirecting') {
    return (
      <Shell>
        <Centered>
          <Loader label={phase === 'redirecting' ? 'returning to suize.io' : 'signing you in'} />
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
      <JournalHome home={home} />
    </Shell>
  );
}

/** The app shell: the full-bleed ambient field behind everything. The JournalShell
 *  owns its own overflow (no-scroll contract), so this wrapper does NOT clip. */
function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="relative min-h-[100dvh] w-full">
      <AmbientField />
      {children}
    </div>
  );
}

/** A full-viewport centered stage (for the loader states). */
function Centered({ children }: { children: ReactNode }) {
  return <div className="grid min-h-[100dvh] w-full place-items-center px-6">{children}</div>;
}
