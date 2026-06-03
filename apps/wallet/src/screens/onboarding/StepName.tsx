/**
 * Beat 2 — NAME. Pick a simple name -> <name>@suize (SPEC §1.5, §4).
 *
 * ONE field, debounced availability against the backend `GET /handle/available`.
 * NO advanced / multi-format toggle here (that lives only in SEND). Just the
 * prompt, the field, a one-line availability status, and the claim button. Content
 * floats on the AmbientField — no card.
 *
 * VISUAL: ported VERBATIM from the locked mockup (§03 PICK YOUR NAME,
 * 00-suize-system.html). The signature is the name typed BIG + inline: an
 * editorial underline-style field (NOT a boxy small input), the name itself
 * rendered in the white->blue->ice gradient at hero size (clamp 1.6–2.6rem mono)
 * with the `@suize` suffix at the SAME hero size in --ink-3, and a `.dotpulse` +
 * mono status line below. The field measures its own width in `ch` so the suffix
 * sits flush against the typed name, exactly like the mockup's `fit()`.
 *
 * Availability is REAL: a debounced `checkHandleAvailable(name)` hits the backend
 * (`GET /handle/available`), which checks charset/length/blocklist + on-chain +
 * the reservation store. `available:false` => the `taken` state. The actual
 * SuiNS leaf-subname mint happens later, in StepSettingUp's claim.
 *
 * Copy (SPEC §4, verbatim):
 *   prompt   : Pick your name
 *   note     : This is how people send you money.
 *   field    : placeholder "yourname", suffix "@suize"
 *   states   : checking "checking…" · free "<name>@suize · available" (Check, --good)
 *              · taken "<name>@suize · taken" (--warn) · invalid "min 3 characters"
 *   button   : ready "Claim <name>@suize" · idle "Pick a name"
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { checkHandleAvailable } from '../../data/suins';
import { SUINS_PARENT } from '../../lib/env';
import { Button, Check, Eyebrow, GradText, ICON_STROKE, X } from '../../system';

type Avail = 'idle' | 'checking' | 'free' | 'taken' | 'invalid';

/** Keep names URL/SuiNS-safe: lowercase, [a-z0-9-], max 20. */
const clean = (s: string) => s.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 20);

/** Hero size shared by the typed name AND its @suize suffix (mockup §03). */
const HERO_SIZE = 'clamp(1.6rem, 4.6vw, 2.6rem)';

export function StepName({
  value,
  onChange,
  onNext,
}: {
  value: string;
  onChange: (v: string) => void;
  onNext: (name: string) => void;
}) {
  const [avail, setAvail] = useState<Avail>('idle');

  // Debounced REAL availability check (GET /handle/available). 450ms debounce kept;
  // min 3 chars is a local fast-path (the backend enforces the same rule). The
  // `cancelled` guard makes the latest keystroke win so a slow earlier response
  // can't clobber a newer one. On a transient backend error we fall through to
  // `free` (don't dead-end the user on a misleading red) — the claim in
  // StepSettingUp is the real gate and surfaces a calm retry if the backend is down.
  useEffect(() => {
    if (!value) {
      setAvail('idle');
      return;
    }
    if (value.length < 3) {
      setAvail('invalid');
      return;
    }
    setAvail('checking');

    let cancelled = false;
    const t = setTimeout(() => {
      checkHandleAvailable(value)
        .then((res) => {
          if (cancelled) return;
          setAvail(res.available ? 'free' : 'taken');
        })
        .catch(() => {
          if (cancelled) return;
          setAvail('free');
        });
    }, 450);

    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [value]);

  const handle = `${value}@${SUINS_PARENT}`;
  const ready = avail === 'free';

  // The field border echoes the avail state: cyan on focus (idle), --good when
  // free, --warn when taken — same semantics the Field primitive had.
  const fieldBorder =
    avail === 'free' ? 'var(--good)' : avail === 'taken' ? 'var(--warn)' : undefined;

  // The dotpulse tone: a soft --good pulse only when the name is free.
  const dotColor =
    avail === 'free' ? 'var(--good)' : avail === 'taken' ? 'var(--warn)' : 'var(--ink-3)';

  // the one-line status under the field.
  const status = useMemo<{ node: ReactNode } | null>(() => {
    switch (avail) {
      case 'checking':
        return { node: <span style={{ color: 'var(--ink-3)' }}>checking…</span> };
      case 'free':
        return {
          node: (
            <span style={{ color: 'var(--good)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              {handle} · available
              <Check size={13} strokeWidth={ICON_STROKE} aria-hidden />
            </span>
          ),
        };
      case 'taken':
        return {
          node: (
            <span style={{ color: 'var(--warn)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <X size={13} strokeWidth={ICON_STROKE} aria-hidden />
              {handle} · taken
            </span>
          ),
        };
      case 'invalid':
        return { node: <span style={{ color: 'var(--ink-3)' }}>min 3 characters</span> };
      default:
        return null;
    }
  }, [avail, handle]);

  // The input auto-sizes to its content (mockup `fit()`): width in `ch` so the
  // suffix sits flush. Min 7ch keeps the underline substantial while empty.
  const inputWidth = `${Math.max(7, value.length || 1)}ch`;

  return (
    <div
      // left-anchored editorial block (mockup `.handle__wrap`, max 760). The Column
      // provides `--pad` + vertical centring; the block itself just caps its measure.
      className="flex flex-col"
      style={{ maxWidth: 760, width: '100%' }}
    >
      <style>{NAME_CSS}</style>

      {/* eyebrow — section label, hairline rule + index (mockup .eyebrow) */}
      <Eyebrow>Pick your name</Eyebrow>

      {/* heading — serif display, the word "name" in italic (mockup §03 .disp) */}
      <h2
        style={{
          marginTop: 18,
          fontFamily: 'var(--serif)',
          fontWeight: 400,
          letterSpacing: '-0.022em',
          lineHeight: 1.0,
          fontSize: 'clamp(2.2rem, 6vw, 4.4rem)',
          color: 'var(--ink)',
        }}
      >
        Pick your <span style={{ fontStyle: 'italic', fontWeight: 300 }}>name</span>.
      </h2>

      {/* note — this is how people send you money (mockup .note, mono) */}
      <p
        style={{
          marginTop: 18,
          fontFamily: 'var(--mono)',
          fontSize: 11.5,
          letterSpacing: '0.01em',
          lineHeight: 1.7,
          color: 'var(--ink-2)',
        }}
      >
        This is how people send you money.
      </p>

      {/* THE SIGNATURE — name typed BIG + inline, editorial underline field.
          The typed name paints in the gradient; the @suize suffix sits flush at
          the SAME hero size. Border = hairline, cyan on focus, good/warn on state. */}
      <div
        className="suize-handle__field"
        style={{
          marginTop: 'clamp(28px, 5vh, 44px)',
          display: 'flex',
          alignItems: 'center',
          gap: 0,
          borderBottom: `1px solid ${fieldBorder ?? 'var(--hair)'}`,
          paddingBottom: 14,
          maxWidth: 600,
          // when state-colored, lock the border (the focus rule only fires on idle)
          ...(fieldBorder ? { ['--handle-focus-border' as string]: fieldBorder } : null),
        }}
      >
        {/* the input itself — gradient-clipped hero mono text */}
        <input
          className="suize-handle__input grad"
          autoFocus
          value={value}
          onChange={(e) => onChange(clean(e.target.value))}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && ready) onNext(value);
          }}
          placeholder="yourname"
          inputMode="text"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          maxLength={20}
          aria-label="Pick your name"
          style={{
            fontFamily: 'var(--mono)',
            fontSize: HERO_SIZE,
            letterSpacing: '-0.02em',
            background: 'transparent',
            border: 'none',
            outline: 'none',
            width: inputWidth,
            minWidth: '2ch',
            caretColor: 'var(--cyan)',
          }}
        />
        {/* suffix — @suize at the SAME hero size, muted */}
        <span
          aria-hidden
          style={{
            fontFamily: 'var(--mono)',
            fontSize: HERO_SIZE,
            letterSpacing: '-0.02em',
            color: 'var(--ink-3)',
            flex: '0 0 auto',
          }}
        >
          @{SUINS_PARENT}
        </span>
      </div>

      {/* status — dotpulse + one-line availability (mockup .handle__status).
          Fixed min-height so the field never jumps between states. */}
      <div
        aria-live="polite"
        style={{
          marginTop: 18,
          minHeight: 20,
          display: 'flex',
          alignItems: 'center',
          gap: 9,
          fontFamily: 'var(--mono)',
          fontSize: 12.5,
          letterSpacing: '0.01em',
        }}
      >
        <span
          aria-hidden
          className={avail === 'free' ? 'suize-dotpulse suize-dotpulse--ok' : 'suize-dotpulse'}
          style={{ background: dotColor }}
        />
        {status?.node}
      </div>

      {/* CTA — flows below the field in the vertically-centred editorial block. */}
      <div style={{ marginTop: 'clamp(28px, 5vh, 44px)', maxWidth: 600 }}>
        <Button
          variant="primary"
          size="lg"
          disabled={!ready}
          onClick={() => onNext(value)}
          style={{ width: '100%' }}
        >
          {ready ? (
            <>
              Claim&nbsp;<GradText variant="mark">{handle}</GradText>
            </>
          ) : (
            'Pick a name'
          )}
        </Button>
      </div>
    </div>
  );
}

/* The handle field's focus-within color + the dotpulse halo — ported from the
   mockup's .handle__field:focus-within / .dotpulse rules. The focus border falls
   back to cyan on idle; a state color (good/warn), when set, overrides via the
   inline border above so this rule only matters in the idle/checking states. */
const NAME_CSS = `
.suize-handle__field:focus-within {
  border-color: var(--handle-focus-border, var(--cyan));
}
.suize-handle__input::placeholder {
  -webkit-text-fill-color: var(--ink-3);
  opacity: 0.55;
}
.suize-dotpulse {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex: 0 0 auto;
}
.suize-dotpulse--ok {
  box-shadow: 0 0 0 0 color-mix(in srgb, var(--good) 50%, transparent);
  animation: suize-dp 3s var(--e-quart) infinite;
}
@media (prefers-reduced-motion: reduce) {
  .suize-dotpulse--ok { animation: none; }
}
`;
