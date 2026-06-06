/**
 * App root — the authenticated wallet entry.
 *
 * `wallet.suize.io` IS the wallet: you arrive already meaning to sign in (from
 * suize.io's "Access wallet"). Returning users with a live session are restored
 * silently (autoConnect → no click); first-time/expired visitors see a single
 * "Continue with Google" button.
 *
 * FLOW (the ONLY production path — pure real gate, no mock):
 *   1. On load, once the Enoki Google wallet has registered, show the SIGN-IN
 *      screen with a "Continue with Google" button. The click is the user gesture
 *      that unblocks the OAuth popup — we never auto-fire it (a popup not opened
 *      from a direct gesture is blocked by the browser). While the wallet is still
 *      registering, or after the click while OAuth resolves, show the centered
 *      Loader ("signing you in"). Returning users skip the button entirely.
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

import { useEffect, useState, type ReactNode } from 'react';
import { useAuth } from '../data/useAuth';
import { useIdentity } from '../data/useIdentity';
import { useHome } from '../data/useHome';
import { useWsLifecycle } from '../data/useWsLifecycle';
import type { HomeApi } from '../data/types';
import { AmbientField, ArrowRight, Button, ICON_STROKE, Loader, Logo, JournalHome, Wordmark } from '../system';
import type { OnboardingBeat } from '../screens/onboarding/OnboardingShell';
import { OnboardingShell } from '../screens/onboarding/OnboardingShell';

const LANDING_URL = 'https://suize.io';

/** If sign-in hasn't resolved within this window, redirect to the landing. */
const SIGN_IN_TIMEOUT_MS = 15_000;

/** Signed in, but the WS (our only transport) never connects — give the ws.ts
 *  backoff a fair window, then bail to the landing instead of an infinite Loader. */
const WS_CONNECT_TIMEOUT_MS = 28_000;

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

  // DEV-ONLY: when a `?preview=` state is active, suppress the real auth effects so
  // the design hatch renders in isolation (no OAuth, no suize.io redirect). This is
  // `false` in production (import.meta.env.DEV is statically false → the whole
  // expression folds to `false` and the guards below tree-shake away).
  const previewActive = import.meta.env.DEV && readPreview() !== null;

  // NOTE: sign-in is NEVER auto-fired. A popup not opened from a direct user
  // gesture is blocked by the browser, so `signInWithGoogle` is called ONLY from
  // the "Continue with Google" button's onClick below. Returning users with a live
  // session are restored by autoConnect (status → 'signed-in', no click needed).

  // ── safety timeout: never spin forever on the Loader ────────────────────────
  // Two stuck cases, one net: (a) a silently-failed sign-in popup (signed in but
  // the OAuth round-trip never resolved), and (b) signed-in but the WS never
  // connects (backend unreachable) so identity never resolves — the ws.ts backoff
  // caps out and would otherwise leave us pinned on "signing you in". Arm only when
  // we're genuinely IN-PROGRESS or STUCK on the Loader (phase 'authenticating' AND
  // status 'signing-in'/'signed-in', OR idle while the Enoki wallet is truly
  // unavailable). NEVER arm while the "Continue with Google" button is on screen
  // (idle && canSignIn = we're waiting for the user to click, not stuck) — bouncing
  // someone who's looking at the button to suize.io is the bug, not the fix.
  const waitingForClick = auth.status === 'idle' && auth.canSignIn;
  useEffect(() => {
    if (previewActive) return; // DEV preview: no timeout/redirect
    if (phase !== 'authenticating') return; // already routed home/onboarding/redirecting
    if (waitingForClick) return; // showing the Continue button — don't bounce the user
    const ms = auth.status === 'signed-in' ? WS_CONNECT_TIMEOUT_MS : SIGN_IN_TIMEOUT_MS;
    const t = setTimeout(() => setPhase('redirecting'), ms);
    return () => clearTimeout(t);
  }, [previewActive, auth.status, phase, waitingForClick]);

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
            {/* DEV preview: demo=true → the seed-bearing leaves show the populated
                design (sample activity / positions / chat). NEVER reaches production. */}
            <JournalHome home={home} demo />
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
    // The Enoki Google wallet has registered and there's no live session →
    // show the click-to-start screen. The button's onClick is the REQUIRED user
    // gesture that lets the OAuth popup open (an auto-fired popup is browser-
    // blocked). Returning users never reach here: autoConnect flips status to
    // 'signed-in' and the routing effect sends them straight to home/onboarding.
    if (phase === 'authenticating' && waitingForClick) {
      return (
        <Shell>
          <SignIn
            home={home}
            onContinue={() => void auth.signInWithGoogle().catch(() => setPhase('redirecting'))}
          />
        </Shell>
      );
    }
    // Still registering the wallet, mid-OAuth after the click, redirecting, or
    // Enoki genuinely unavailable → the calm Loader (the safety timeout backs it).
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
      {/* REAL home: demo=false → honest states only (no fabricated activity/
          positions/sent cards). The seed content lives behind the DEV ?preview hatch. */}
      <JournalHome home={home} demo={false} />
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

/** Click-to-start sign-in — the ONE gesture that unblocks the OAuth popup.
 *
 *  Behind the glass: a frosted glimpse of the populated wallet (the SAME
 *  `<JournalHome home demo />` the DEV `?preview=home` hatch renders — the
 *  seed-bearing leaves paint sample chat / positions / activity), blurred + scaled
 *  so its edges bleed off-screen, scrimmed under a --paper frost, and inert
 *  (pointer-events:none, aria-hidden). The signature-gradient wordmark, the
 *  monkey-simple line, and the "Open your wallet" CTA sit CRISP on top — lucide
 *  arrow only, no Google/brand mark. The blur is decorative; only the button is
 *  interactive. */
function SignIn({ home, onContinue }: { home: HomeApi; onContinue: () => void }) {
  return (
    <div className="relative min-h-[100dvh] w-full overflow-hidden">
      {/* the wallet, just behind the glass — blurred, scaled-past-the-edges, inert */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          filter: 'blur(13px) saturate(1.05)',
          transform: 'scale(1.08)',
          transformOrigin: 'center',
        }}
      >
        <JournalHome home={home} demo />
      </div>

      {/* frost scrim — a semi-opaque --paper veil so it reads as "your wallet, behind
          glass": muted enough that the crisp content stays the focus, with a soft
          radial brighten toward center to seat the CTA. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(120% 90% at 50% 46%, color-mix(in srgb, var(--paper) 78%, transparent) 0%, color-mix(in srgb, var(--paper) 90%, transparent) 60%, var(--paper) 100%)',
        }}
      />

      {/* crisp foreground — the brand lockup, the line, and the CTA, centered */}
      <div className="absolute inset-0 grid place-items-center px-6">
        <div
          className="relative flex flex-col items-center text-center"
          style={{ gap: 'clamp(20px, 4vh, 32px)', maxWidth: 420, width: '100%' }}
        >
          {/* brand lockup — logo + the "Suize" mark in the signature gradient */}
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 14 }}>
            <Logo size={40} />
            <Wordmark size="clamp(1.7rem, 5.5vw, 2.2rem)" />
          </div>

          {/* monkey-simple welcome line */}
          <p
            style={{
              margin: 0,
              fontFamily: 'var(--serif)',
              fontWeight: 300,
              fontSize: 'clamp(1.15rem, 4.5vw, 1.5rem)',
              lineHeight: 1.45,
              color: 'var(--ink-2)',
              maxWidth: '24ch',
            }}
          >
            Your money, ready when you are.
          </p>

          {/* CTA — the click is what opens the sign-in popup */}
          <Button
            variant="primary"
            size="lg"
            onClick={onContinue}
            icon={<ArrowRight size={16} strokeWidth={ICON_STROKE} aria-hidden />}
            style={{ flexDirection: 'row-reverse', marginTop: 'clamp(4px, 1.5vh, 12px)' }}
          >
            Open your wallet
          </Button>
        </div>
      </div>
    </div>
  );
}
