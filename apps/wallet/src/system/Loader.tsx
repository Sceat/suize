/**
 * Loader — the calm "lock-drain" progress bar (ported from Crash to the v3 Suize
 * language). NOT a spinner and NOT a percentage: a thin BLUE indeterminate shimmer
 * sweeps a hairline track while a breathing blue marker dot anchors its start.
 * Because the sweep loops (never fills to 100%), it signals "alive, working" WITHOUT ever
 * claiming a completion that hasn't happened — calibrated honesty in motion.
 *
 * The rhythm is editorial: a Space-Grotesk eyebrow with a leading blue hairline
 * rule, then the caller's monkey-simple line as a Newsreader serif lede, then the
 * drain bar. The Logo seats the brand above it all.
 *
 * Used for: `signing you in`, `setting up your wallet`, `returning to suize.io`
 * (copy is passed in by the caller — see SPEC §4). These loaders render in the
 * UNSCOPED app shell (not under `.journal`), so they read the global tokens.css
 * ramp: `--cyan` is the blue accent, `--serif` Newsreader, `--mono` the caption
 * face. Respects reduced-motion (the shimmer + breathe settle to a calm state).
 */
import { Logo } from './Logo';

export interface LoaderProps {
  /** the monkey-simple line, rendered as the serif lede, e.g. "setting up your wallet". */
  label?: string;
  /** the small tracked eyebrow above the lede; defaults to a calm "ONE MOMENT". */
  eyebrow?: string;
  className?: string;
}

export function Loader({ label, eyebrow = 'One moment', className }: LoaderProps) {
  return (
    <div
      className={className}
      role="status"
      aria-live="polite"
      aria-busy="true"
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 'clamp(18px, 4vh, 30px)',
        width: '100%',
        maxWidth: 360,
      }}
    >
      <style>{LOADER_CSS}</style>

      {/* the brand seats the lockup */}
      <Logo size={40} />

      {/* editorial eyebrow — Space Grotesk, tracked, with a leading blue hairline */}
      <div className="suize-load__eyebrow">
        <span aria-hidden className="suize-load__rule" />
        {eyebrow}
      </div>

      {/* the human line — Newsreader serif lede (the caller's monkey-simple copy) */}
      {label ? <p className="suize-load__lede">{label}</p> : null}

      {/* the lock-drain bar — a hairline track with a blue shimmer that sweeps and
          loops (never fills to 100% → honest, no faked completion) + a breathing
          marker dot anchored at the start. aria-hidden: the role="status" + label
          carry the accessible state; the bar is decorative proof-of-work. */}
      <div className="suize-load__bar" aria-hidden>
        {/* the sweep lives in its own clipped track so it never spills the pill */}
        <span className="suize-load__track">
          <span className="suize-load__sweep" />
        </span>
        {/* the marker sits ABOVE the clip so its breathing halo isn't cut off */}
        <span className="suize-load__marker" />
      </div>
    </div>
  );
}

/* The drain bar + the editorial rhythm. The sweep is a clipped blue gradient
   segment that travels left→right on a loop; the marker is a breathing blue dot
   tracking it. Reduced-motion freezes both to a calm, honest resting state (a
   short static blue segment at the left — present, not pretending to progress). */
const LOADER_CSS = `
.suize-load__eyebrow {
  display: flex;
  align-items: center;
  gap: 12px;
  font-family: var(--sans);
  font-size: 10.5px;
  font-weight: 500;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--ink-3);
}
.suize-load__rule {
  width: 26px;
  height: 1px;
  flex: 0 0 auto;
  display: inline-block;
  background: var(--cyan);
}
.suize-load__lede {
  margin: 0;
  text-align: center;
  font-family: var(--serif);
  font-weight: 300;
  font-size: clamp(1.15rem, 4.5vw, 1.5rem);
  line-height: 1.4;
  letter-spacing: -0.01em;
  color: var(--ink-2);
  max-width: 24ch;
}
.suize-load__bar {
  position: relative;
  width: 100%;
  height: 3px;
  margin-top: 2px;
}
/* the clipped track — holds the pill background + the sweep, masking any overflow. */
.suize-load__track {
  position: absolute;
  inset: 0;
  border-radius: 99px;
  overflow: hidden;
  background: var(--paper-3);
  box-shadow: inset 0 0 0 1px var(--hair-2);
}
/* the sweeping segment — a blue gradient ~40% wide, clipped to the track, looping
   left→right. It never parks at the end, so it cannot read as "done". */
.suize-load__sweep {
  position: absolute;
  top: 0;
  left: 0;
  height: 100%;
  width: 42%;
  border-radius: 99px;
  background: linear-gradient(
    90deg,
    transparent,
    color-mix(in srgb, var(--cyan) 55%, transparent) 30%,
    var(--cyan) 60%,
    color-mix(in srgb, var(--cyan) 55%, transparent) 90%,
    transparent
  );
  animation: suize-drain 1.9s var(--e-inout) infinite;
}
/* the breathing marker dot — a still blue heartbeat anchored at the bar's start,
   pulsing a soft blue halo while the sweep drains past it. It does NOT travel, so
   it can never read as a creeping progress fill. */
.suize-load__marker {
  position: absolute;
  top: 50%;
  left: 0;
  width: 7px;
  height: 7px;
  margin: -3.5px 0 0 -3.5px;
  border-radius: 50%;
  background: var(--cyan);
  box-shadow: 0 0 0 0 color-mix(in srgb, var(--cyan) 45%, transparent);
  animation: suize-drain-breathe 2.6s ease-in-out infinite;
}
@keyframes suize-drain {
  0% { transform: translateX(-110%); }
  100% { transform: translateX(238%); }
}
@keyframes suize-drain-breathe {
  0%, 100% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--cyan) 45%, transparent); }
  50% { box-shadow: 0 0 0 5px color-mix(in srgb, var(--cyan) 0%, transparent); }
}
@media (prefers-reduced-motion: reduce) {
  /* honest resting state: a short, static blue segment at the left + a still marker.
     Present and calm — it does NOT animate toward a completion it can't promise. */
  .suize-load__sweep {
    animation: none;
    width: 30%;
    transform: none;
    opacity: 0.85;
  }
  .suize-load__marker {
    animation: none;
    box-shadow: none;
  }
}
`;
