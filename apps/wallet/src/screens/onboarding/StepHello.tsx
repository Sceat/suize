/**
 * Beat 1 — HELLO. The editorial welcome (mockup §02, restored).
 *
 * Ported to the LOCKED mockup's editorial language (00-suize-system.html §02):
 *   • LEFT-aligned, generous whitespace (NOT centered) — the deck's editorial bones
 *   • a mono eyebrow with the leading cyan hairline rule ("welcome")
 *   • the brand lockup (Logo + serif "Suize" in the signature gradient, `--mark`)
 *   • a BIG serif display headline (clamp up to the mockup's ~3.6rem mobile cap),
 *     weight 400, -.022em, line ~1.0; "Your money" in the thin (300) ink-2 weight;
 *     the gradient signature lands on "without banks" WITH the animated underline
 *     draw (the mockup's `.ul::after` — a 2px --grad bar that wipes in left→right)
 *   • a serif 300 lede
 *
 * ONE block reveal (opacity + translateY) for the whole group; reduced-motion
 * collapses every reveal + the underline to their end state.
 *
 * Copy (live SPEC §4, verbatim — unchanged):
 *   wordmark : Suize · eyebrow "welcome"
 *   headline : "Welcome to Suize."  /  "Your money"  /  grad+ul "without banks."
 *   lede     : "An AI wallet that works for you."
 */

import { useCallback, useRef } from 'react';
import { ArrowRight, GradText, ICON_STROKE, Logo, Wordmark } from '../../system';

/** A deliberate downward scroll past this delta advances the beat. Tiny trackpad
 *  jitter / momentum tails below it are ignored so the hello can't skip on a twitch. */
const SCROLL_ADVANCE_DELTA = 24;

export function StepHello({ onNext }: { onNext?: () => void }) {
  // Fire onNext at most once per mount: a single wheel burst (momentum scroll emits
  // a stream of events) must not double-advance, and once we've handed off we ignore
  // any trailing deltas.
  const advanced = useRef(false);
  const advance = useCallback(() => {
    if (advanced.current || !onNext) return;
    advanced.current = true;
    onNext();
  }, [onNext]);

  // Advance only on a deliberate DOWNWARD wheel (positive deltaY past the floor).
  const onWheel = useCallback(
    (e: React.WheelEvent) => {
      if (e.deltaY > SCROLL_ADVANCE_DELTA) advance();
    },
    [advance],
  );

  return (
    <div
      // left-anchored editorial block (mockup §02). Column provides `--pad` + the
      // vertical centring; the block caps its own measure and owns the reveal stagger.
      className="suize-hello flex flex-col"
      style={{
        gap: 'clamp(20px, 4vh, 36px)',
        maxWidth: 760,
        width: '100%',
      }}
      onWheel={onNext ? onWheel : undefined}
    >
      <style>{HELLO_CSS}</style>

      {/* eyebrow — mono label + the leading cyan hairline rule (mockup .eyebrow) */}
      <div className="suize-hello__reveal suize-hello__eyebrow" style={{ animationDelay: '0.02s' }}>
        <span aria-hidden className="suize-hello__rule" />
        welcome
      </div>

      {/* wordmark — logo + the "Suize" mark, the signature gradient */}
      <div
        className="suize-hello__reveal"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 14,
          animationDelay: '0.12s',
        }}
      >
        <Logo size={44} />
        <Wordmark size="clamp(1.8rem, 6vw, 2.4rem)" />
      </div>

      {/* headline — BIG serif display, one block reveal (mockup .disp) */}
      <h1
        className="suize-hello__reveal"
        style={{
          margin: 0,
          fontFamily: 'var(--serif)',
          fontWeight: 400,
          fontSize: 'clamp(2.6rem, 11vw, 4rem)',
          lineHeight: 1.0,
          letterSpacing: '-0.022em',
          color: 'var(--ink)',
          animationDelay: '0.26s',
        }}
      >
        Welcome to Suize.
        <br />
        <span style={{ color: 'var(--ink-2)', fontWeight: 300 }}>Your money</span>
        <br />
        <span className="suize-hello__ul">
          <GradText as="span" variant="mark">
            without banks
          </GradText>
        </span>
        <span style={{ fontStyle: 'italic', fontWeight: 300 }}>.</span>
      </h1>

      {/* lede — serif 300 (mockup .lede) */}
      <p
        className="suize-hello__reveal"
        style={{
          margin: 0,
          fontFamily: 'var(--serif)',
          fontWeight: 300,
          fontSize: 'clamp(1.2rem, 4.5vw, 1.6rem)',
          lineHeight: 1.45,
          color: 'var(--ink-2)',
          maxWidth: '26ch',
          animationDelay: '0.42s',
        }}
      >
        An AI wallet that works for you.
      </p>

      {/* Next — user-driven advance (also fires on a deliberate scroll-down). An
          editorial affordance, NOT a chunky button: mono label + a lucide arrow,
          muted, with a soft hover-slide on the arrow. Reveals last in the stagger;
          reduced-motion collapses it (and every reveal) to the resting state. */}
      {onNext ? (
        <button
          type="button"
          onClick={advance}
          className="suize-hello__reveal suize-hello__next"
          style={{ animationDelay: '0.58s' }}
        >
          Next
          <ArrowRight size={16} strokeWidth={ICON_STROKE} aria-hidden className="suize-hello__next-arrow" />
        </button>
      ) : null}
    </div>
  );
}

/* The editorial reveal + the mockup's eyebrow rule + the `.ul::after` underline
   draw (a 2px --grad bar that wipes in left→right after the headline reveals).
   Reduced-motion collapses every reveal AND the underline to their end state. */
const HELLO_CSS = `
.suize-hello__reveal {
  opacity: 0;
  transform: translateY(18px);
  animation: suize-hello-in 1.1s var(--e-expo) forwards;
}
@keyframes suize-hello-in {
  to { opacity: 1; transform: translateY(0); }
}
.suize-hello__eyebrow {
  display: flex;
  align-items: center;
  gap: 12px;
  font-family: var(--mono);
  font-size: 10.5px;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: var(--ink-3);
}
.suize-hello__rule {
  width: 26px;
  height: 1px;
  background: var(--cyan);
  flex: 0 0 auto;
  display: inline-block;
}
.suize-hello__next {
  align-self: flex-start;
  display: inline-flex;
  align-items: center;
  gap: 9px;
  margin-top: clamp(8px, 2vh, 20px);
  padding: 0;
  border: none;
  background: transparent;
  cursor: pointer;
  font-family: var(--mono);
  font-size: 11.5px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--ink-3);
  transition: color .32s var(--e-quart);
}
.suize-hello__next:hover {
  color: var(--cyan);
}
.suize-hello__next-arrow {
  transition: transform .32s var(--e-expo);
}
.suize-hello__next:hover .suize-hello__next-arrow {
  transform: translateX(4px);
}
.suize-hello__ul {
  position: relative;
  white-space: nowrap;
}
.suize-hello__ul::after {
  content: "";
  position: absolute;
  left: 0;
  right: 100%;
  bottom: -0.08em;
  height: 2px;
  background: var(--grad);
  background-size: 200% 100%;
  animation: suize-hello-ul 1.8s var(--e-expo) 0.9s forwards;
}
@keyframes suize-hello-ul {
  to { right: 0; }
}
@media (prefers-reduced-motion: reduce) {
  .suize-hello__reveal {
    opacity: 1;
    transform: none;
    animation: none;
  }
  .suize-hello__ul::after {
    right: 0;
    animation: none;
  }
  .suize-hello__next-arrow,
  .suize-hello__next:hover .suize-hello__next-arrow {
    transition: none;
    transform: none;
  }
}
`;
