/**
 * THE ONBOARDING — production (the owner-picked Journey flow, One-pane titles).
 *
 *   HelloScreen — the sign-in: editorial welcome, ONE gesture ("Continue with
 *                 Google" — the click that legally opens the OAuth popup).
 *   ClaimFlow   — name + setting-up, REAL: debounced availability against the
 *                 backend, then the claim manifest runs the actual two-leg
 *                 issuance (leaf-subname mint → user-signed reverse record),
 *                 exactly the legs the old StepSettingUp ran — now rendered as
 *                 the calm build manifest instead of a lone loader. Any failure
 *                 surfaces a calm retry, never a silent success.
 *
 * DEV preview (`?preview=claim`) passes `preview` so no real claim fires.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSignTransaction } from '@mysten/dapp-kit';
import { Check, X, ICON_STROKE } from '../system';
import { useAuth } from '../data/useAuth';
import { checkHandleAvailable, claimHandle, setCachedHandle, setReverseRecord } from '../data/suins';
import { JOURNEY } from './copy';
import { GoogleMark } from './bits';

const clean = (s: string) => s.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 20);

// ── HELLO — the sign-in screen ─────────────────────────────────────────────────

export function HelloScreen({ onGoogle, busy = false }: { onGoogle: () => void; busy?: boolean }) {
  const d = (i: number) => ({ animationDelay: `${0.05 + i * 0.13}s` });
  const [before, after] = JOURNEY.hello.h1[1].split(JOURNEY.hello.hot);
  return (
    <div className="rd-jny">
      <div className="rd-jny__beat">
        <span className="rd-jny__eyebrow" style={d(0)}>
          {JOURNEY.hello.eyebrow}
        </span>
        <span className="rd-wordmark" style={{ fontSize: 30, ...d(1) }} aria-label="Suize">
          SUIZE
        </span>
        <h1 className="rd-jny__h1" style={d(2)}>
          {JOURNEY.hello.h1[0]}
          <br />
          {before}
          <span className="rd-jny__hot">{JOURNEY.hello.hot}</span>
          {after}
        </h1>
        <p className="rd-jny__lede" style={d(3)}>
          {JOURNEY.hello.lede}
        </p>
        <button type="button" className="rd-cta rd-jny__cta" style={d(4)} onClick={onGoogle} disabled={busy}>
          <GoogleMark />
          {JOURNEY.hello.cta}
        </button>
        <p className="rd-jny__custody" style={d(5)}>
          {JOURNEY.hello.custody}
        </p>
      </div>
    </div>
  );
}

// ── CLAIM — name pick + the real setting-up manifest ───────────────────────────

type Beat = 'name' | 'setup';
type Avail = 'idle' | 'invalid' | 'checking' | 'free' | 'taken';

export function ClaimFlow({
  suggestedName = '',
  preview = false,
  onDone,
}: {
  suggestedName?: string;
  /** DEV-only: never fire a real claim (no session in the preview). */
  preview?: boolean;
  onDone: () => void;
}) {
  const [beat, setBeat] = useState<Beat>('name');
  const [name, setName] = useState(clean(suggestedName));

  return (
    <div className="rd-jny">
      {beat === 'name' ? (
        <NameBeat value={name} onChange={(v) => setName(clean(v))} preview={preview} onNext={() => setBeat('setup')} />
      ) : (
        <SetupBeat name={name} preview={preview} onDone={onDone} />
      )}
    </div>
  );
}

function NameBeat({
  value,
  onChange,
  preview,
  onNext,
}: {
  value: string;
  onChange: (v: string) => void;
  preview: boolean;
  onNext: () => void;
}) {
  const [avail, setAvail] = useState<Avail>('idle');

  // debounced REAL availability (the backend enforces the same rules)
  useEffect(() => {
    if (!value) {
      setAvail('idle');
      return;
    }
    if (value.length < 3) {
      setAvail('invalid');
      return;
    }
    if (preview) {
      setAvail('free');
      return;
    }
    setAvail('checking');
    let cancelled = false;
    const t = setTimeout(() => {
      checkHandleAvailable(value)
        .then((res) => {
          if (!cancelled) setAvail(res.available ? 'free' : 'taken');
        })
        .catch(() => {
          // transient backend error → don't dead-end; the claim is the real gate
          if (!cancelled) setAvail('free');
        });
    }, 450);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [value, preview]);

  const ready = avail === 'free';
  const handle = `${value}${JOURNEY.name.suffix}`;
  const inputWidth = value ? `${value.length}ch` : '9ch';
  const d = (i: number) => ({ animationDelay: `${0.05 + i * 0.12}s` });

  return (
    <div className="rd-jny__beat">
      <span className="rd-jny__eyebrow" style={d(0)}>
        {JOURNEY.name.eyebrow}
      </span>
      <h1 className="rd-jny__h1" style={d(1)}>
        {JOURNEY.name.h2[0]}
        <em style={{ fontWeight: 300 }}>{JOURNEY.name.h2[1]}</em>
        {JOURNEY.name.h2[2]}
      </h1>
      <p className="rd-jny__note" style={d(2)}>
        {JOURNEY.name.note}
      </p>

      <div className={`rd-jny__field${ready ? ' is-free' : ''}`} style={d(3)}>
        <input
          autoFocus
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && ready) onNext();
          }}
          placeholder={JOURNEY.name.placeholder}
          inputMode="text"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          maxLength={20}
          aria-label="Pick your name"
          style={{ width: inputWidth }}
        />
        <span className="rd-jny__suffix" aria-hidden>
          {JOURNEY.name.suffix}
        </span>
      </div>

      <div className={`rd-jny__status${ready ? ' is-free' : ''}`} aria-live="polite" style={d(4)}>
        {avail === 'free' ? (
          <>
            <Check size={13} strokeWidth={2.2} aria-hidden />
            {handle} · {JOURNEY.name.free}
          </>
        ) : avail === 'taken' ? (
          <>
            <X size={13} strokeWidth={ICON_STROKE} aria-hidden />
            {handle} · taken
          </>
        ) : avail === 'checking' ? (
          'checking…'
        ) : avail === 'invalid' ? (
          <>
            <X size={13} strokeWidth={ICON_STROKE} aria-hidden />
            {JOURNEY.name.invalid}
          </>
        ) : (
          ' '
        )}
      </div>

      <button type="button" className="rd-cta rd-jny__cta" disabled={!ready} onClick={onNext} style={d(5)}>
        {ready ? JOURNEY.name.cta(handle) : JOURNEY.name.ctaIdle}
      </button>
    </div>
  );
}

// ── SETUP — the manifest runs the REAL claim ───────────────────────────────────
//
// Row 1 ("Creating your wallet") completes on a short beat — the session/WS is
// already up by this screen. Row 2 ("Claiming <name>@suize") completes when the
// REAL two-leg claim lands (mint + user-signed reverse record). Row 3
// ("Securing your keys") follows. Errors → a calm retry; the retry re-runs the
// claim (idempotent: a re-claim re-issues the reverse-record bytes).

const STEP_MS = 850;

function SetupBeat({ name, preview, onDone }: { name: string; preview: boolean; onDone: () => void }) {
  const { ownerAddress } = useAuth();
  const { mutateAsync: signTransaction } = useSignTransaction();

  const reduce = useMemo(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    [],
  );
  const total = JOURNEY.setup.steps.length;
  const [shown, setShown] = useState(0);
  const [done, setDone] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  // StrictMode-safe: only fire one claim per attempt (a re-mount must not double-mint)
  const firedAttempt = useRef(-1);
  const claimedRef = useRef(false);

  // the visual cadence — rows appear; row 2 WAITS for the real claim
  useEffect(() => {
    if (error) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const at = (ms: number, fn: () => void) => timers.push(setTimeout(fn, reduce ? 0 : ms));
    at(200, () => setShown(1));
    at(200 + STEP_MS * 0.8, () => setDone(1));
    at(300 + STEP_MS, () => setShown(2));
    // row 2's DONE comes from the claim promise (or the preview timer below)
    return () => timers.forEach(clearTimeout);
  }, [reduce, error, attempt]);

  // the REAL claim (or the preview's timed stand-in)
  useEffect(() => {
    if (error) return;
    if (firedAttempt.current === attempt) return;
    firedAttempt.current = attempt;

    let cancelled = false;
    const finish = () => {
      if (cancelled) return;
      setDone(2);
      setShown(3);
      setTimeout(() => !cancelled && setDone(3), reduce ? 0 : STEP_MS * 0.8);
    };

    if (preview || claimedRef.current) {
      setTimeout(finish, reduce ? 0 : 300 + STEP_MS * 2);
      return;
    }
    if (!name || !ownerAddress) {
      setError('Something went wrong setting up your wallet.');
      return;
    }
    (async () => {
      try {
        const claimed = await claimHandle(name);
        if (cancelled) return;
        if (claimed.setDefault) {
          const { signature } = await signTransaction({ transaction: claimed.setDefault.bytes });
          if (cancelled) return;
          await setReverseRecord({ digest: claimed.setDefault.digest, signature });
          if (cancelled) return;
        }
        setCachedHandle(ownerAddress, claimed.handle);
        claimedRef.current = true;
        finish();
      } catch (e: unknown) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not finish setting up your name.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [preview, name, ownerAddress, signTransaction, error, attempt, reduce]);

  const finished = done >= total;

  if (error) {
    return (
      <div className="rd-jny__beat">
        <span className="rd-jny__eyebrow">{JOURNEY.setup.eyebrow}</span>
        <h1 className="rd-jny__h1" style={{ fontSize: 'clamp(1.9rem, 4.5vw, 3rem)' }}>
          {JOURNEY.setup.h2}
        </h1>
        <p className="rd-jny__note" role="alert">
          {error}
        </p>
        <button
          type="button"
          className="rd-cta rd-jny__cta"
          onClick={() => {
            setError(null);
            setShown(0);
            setDone(0);
            setAttempt((n) => n + 1);
          }}
        >
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className="rd-jny__beat">
      <span className="rd-jny__eyebrow">{JOURNEY.setup.eyebrow}</span>
      <h1 className="rd-jny__h1" style={{ fontSize: 'clamp(1.9rem, 4.5vw, 3rem)' }}>
        {JOURNEY.setup.h2}
      </h1>

      <div className="rd-manifest">
        <div className="rd-manifest__bar" aria-hidden="true">
          <i style={{ transform: `scaleX(${done / total})` }} />
        </div>
        {JOURNEY.setup.steps.map((s, i) => {
          const label = typeof s.label === 'function' ? s.label(name) : s.label;
          const isShown = i < shown;
          const isDone = i < done;
          return (
            <div key={i} className={`rd-manifest__row${isShown ? ' is-in' : ''}${isDone ? ' is-done' : ''}`}>
              <span className="rd-manifest__mark" aria-hidden="true">
                {isDone ? <Check size={12} strokeWidth={2.6} /> : <span className="rd-manifest__spin" />}
              </span>
              <span className="rd-manifest__label">{label}</span>
              <span className="rd-line__dots" />
              <span className="rd-manifest__note">{s.note}</span>
            </div>
          );
        })}
      </div>

      <div className={`rd-jny__done${finished ? ' is-in' : ''}`}>
        <p className="rd-jny__donetitle">{JOURNEY.setup.done(name)}</p>
        <button type="button" className="rd-cta rd-jny__cta" onClick={onDone} disabled={!finished}>
          {JOURNEY.setup.cta}
        </button>
      </div>
    </div>
  );
}
