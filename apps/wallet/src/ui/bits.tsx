/**
 * Shared primitives for the production wallet UI: the spark glyph, typing
 * dots, the iOS switch, chat rows, the Google mark, the branded decorative QR,
 * and the @name highlighter. All visual; the views own choreography + state.
 */
import type { ReactNode } from 'react';
import type { Who } from './copy';

/** the landing's four-point spark glyph — the family badge mark */
export function Spark() {
  return (
    <span className="rd-spark" aria-hidden="true">
      <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
        <path
          d="M6 0c.45 2.7 2.3 4.55 5 5-2.7.45-4.55 2.3-5 5-.45-2.7-2.3-4.55-5-5 2.7-.45 4.55-2.3 5-5Z"
          fill="currentColor"
          style={{ color: 'var(--rd-blue)' }}
        />
      </svg>
    </span>
  );
}

/** three pulsing typing dots */
export function Dots() {
  return (
    <span className="rd-dots" aria-hidden="true">
      <span />
      <span />
      <span />
    </span>
  );
}

/** the iOS switch — the one sanctioned pill (it IS a switch) */
export function Switch({ on, onToggle, label }: { on: boolean; onToggle: () => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      className={`rd-switch${on ? ' is-on' : ''}`}
      onClick={onToggle}
    >
      <i />
    </button>
  );
}

/** one chat row — `you` right/gradient, `ai` left/quiet. `landed` drives the rise. */
export function Row({
  who,
  landed = true,
  children,
}: {
  who: Who;
  landed?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={`rd-row rd-row--${who}${landed ? ' is-in' : ''}`}>
      <span className="rd-bubble">{children}</span>
    </div>
  );
}

/** a transient typing row (ai side) */
export function TypingRow() {
  return (
    <div className="rd-row rd-row--ai is-in">
      <span className="rd-bubble" style={{ display: 'inline-flex', alignItems: 'center' }}>
        <Dots />
      </span>
    </div>
  );
}

/** a day divider */
export function Divider({ label }: { label: string }) {
  return (
    <div className="rd-divider" aria-hidden="true">
      <span>{label}</span>
    </div>
  );
}

/** the Google G — the one foreign mark, official four-color glyph */
export function GoogleMark() {
  return (
    <span className="rd-gmark" aria-hidden="true">
      <svg viewBox="0 0 18 18" width="16" height="16">
        <path
          fill="#4285F4"
          d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92a8.78 8.78 0 0 0 2.68-6.62Z"
        />
        <path
          fill="#34A853"
          d="M9 18a8.6 8.6 0 0 0 5.96-2.18l-2.92-2.26a5.44 5.44 0 0 1-8.09-2.85H.96v2.33A9 9 0 0 0 9 18Z"
        />
        <path
          fill="#FBBC05"
          d="M3.96 10.71a5.41 5.41 0 0 1 0-3.42V4.96H.96a9 9 0 0 0 0 8.08l3-2.33Z"
        />
        <path
          fill="#EA4335"
          d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.59A9 9 0 0 0 .96 4.96l3 2.33A5.36 5.36 0 0 1 9 3.58Z"
        />
      </svg>
    </span>
  );
}

/** wrap detected `@names` (e.g. alice@suize) in an accent span — "more colors
 *  for detected @names" (owner). Plain text in, decorated nodes out. */
export function rich(text: string): ReactNode {
  const parts = text.split(/([a-z0-9-]+@[a-z0-9-]+)/g);
  if (parts.length === 1) return text;
  return parts.map((p, i) =>
    /^[a-z0-9-]+@[a-z0-9-]+$/.test(p) ? (
      <span className="rd-handle" key={i}>
        {p}
      </span>
    ) : (
      p
    ),
  );
}

/**
 * SuizeQr — the lab's DECORATIVE QR (not scannable; the copy row is the truth).
 * Restyled per owner: rounded dot modules in ink, the three finder eyes in the
 * brand gradient, and the SUIZE logo on a white rounded tile in the center.
 * Deterministic from `value` (same address → same pattern).
 */
export function SuizeQr({ value, size = 148 }: { value: string; size?: number }) {
  const GRID = 25;
  const QUIET = 2;
  // xmur3 → mulberry32, tiny + deterministic
  let h = 1779033703 ^ value.length;
  for (let i = 0; i < value.length; i++) {
    h = Math.imul(h ^ value.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = (h ^= h >>> 16) >>> 0;
  const next = () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const inFinder = (r: number, c: number) =>
    (r >= QUIET && r < QUIET + 7 && c >= QUIET && c < QUIET + 7) ||
    (r >= QUIET && r < QUIET + 7 && c >= GRID - QUIET - 7 && c < GRID - QUIET) ||
    (r >= GRID - QUIET - 7 && r < GRID - QUIET && c >= QUIET && c < QUIET + 7);
  // the center tile (the logo well) — a 7x7 hole
  const mid = (GRID - 7) / 2;
  const inLogo = (r: number, c: number) => r >= mid && r < mid + 7 && c >= mid && c < mid + 7;

  const dots: { x: number; y: number }[] = [];
  for (let r = 0; r < GRID; r++) {
    for (let c = 0; c < GRID; c++) {
      const quiet = r < QUIET || r >= GRID - QUIET || c < QUIET || c >= GRID - QUIET;
      if (quiet || inFinder(r, c) || inLogo(r, c)) continue;
      if (next() > 0.5) dots.push({ x: c, y: r });
    }
  }
  const eye = (x: number, y: number) => (
    <g key={`${x}-${y}`}>
      <rect x={x} y={y} width={7} height={7} rx={2.1} fill="none" stroke="url(#rdqr-grad)" strokeWidth={1} />
      <rect x={x + 2} y={y + 2} width={3} height={3} rx={1} fill="url(#rdqr-grad)" />
    </g>
  );

  return (
    <svg width={size} height={size} viewBox={`0 0 ${GRID} ${GRID}`} aria-hidden="true">
      <defs>
        <linearGradient id="rdqr-grad" x1="0" y1="0" x2="25" y2="25" gradientUnits="userSpaceOnUse">
          <stop stopColor="var(--rd-blue-deep)" />
          <stop offset="1" stopColor="var(--rd-blue-bright)" />
        </linearGradient>
      </defs>
      {dots.map((d) => (
        <circle key={`${d.x}.${d.y}`} cx={d.x + 0.5} cy={d.y + 0.5} r={0.38} fill="currentColor" />
      ))}
      {eye(QUIET, QUIET)}
      {eye(GRID - QUIET - 7, QUIET)}
      {eye(QUIET, GRID - QUIET - 7)}
      {/* the SUIZE mark on a white rounded tile, centered */}
      <rect x={mid + 0.4} y={mid + 0.4} width={6.2} height={6.2} rx={1.6} fill="#fff" stroke="var(--rd-hair)" strokeWidth={0.15} />
      <image href="/logo.png" x={mid + 1.1} y={mid + 1.1} width={4.8} height={4.8} />
    </svg>
  );
}

