/**
 * Qr — a deterministic DECORATIVE QR-style svg (NOT a scannable code).
 *
 * It hashes `value` into a stable module grid + the three finder eyes, so the same
 * address always renders the same pattern. It paints with `currentColor` and a
 * `--paper-2` background, so it recolors with the theme for free (set color on the
 * parent — AddFundsSheet uses --ink).
 *
 * HONESTY: this is a visual placeholder. It does not encode the address and is not
 * scannable; the copyable @name / hex below it are the real share surface. Swap in
 * a real encoder (e.g. the `qrcode` lib) behind this same prop when we ship scan.
 */

const GRID = 25; // modules per side (odd, leaves room for 7x7 finders + quiet zone)
const QUIET = 2; // quiet-zone modules on each edge

/** xmur3 string hash -> seeded mulberry32 PRNG (deterministic, tiny). */
function rng(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = (h ^= h >>> 16) >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** True where a finder eye (7x7) sits — top-left, top-right, bottom-left. */
function inFinder(r: number, c: number): boolean {
  const tl = r >= QUIET && r < QUIET + 7 && c >= QUIET && c < QUIET + 7;
  const tr = r >= QUIET && r < QUIET + 7 && c >= GRID - QUIET - 7 && c < GRID - QUIET;
  const bl = r >= GRID - QUIET - 7 && r < GRID - QUIET && c >= QUIET && c < QUIET + 7;
  return tl || tr || bl;
}

export interface QrProps {
  /** the string this pattern is derived from (the address / handle). */
  value: string;
  /** rendered pixel size (square). Default 168. */
  size?: number;
  className?: string;
}

export function Qr({ value, size = 168, className }: QrProps) {
  const next = rng(value || 'suize');
  const cells: { x: number; y: number }[] = [];

  for (let r = 0; r < GRID; r++) {
    for (let c = 0; c < GRID; c++) {
      const isQuiet = r < QUIET || r >= GRID - QUIET || c < QUIET || c >= GRID - QUIET;
      if (isQuiet || inFinder(r, c)) continue;
      if (next() > 0.52) cells.push({ x: c, y: r });
    }
  }

  // A finder eye: outer 7x7 ring + 3x3 center, drawn at module (or, oc).
  const finder = (or: number, oc: number) => (
    <g key={`f-${or}-${oc}`}>
      <rect x={oc} y={or} width={7} height={7} rx={1.5} fill="currentColor" />
      <rect x={oc + 1} y={or + 1} width={5} height={5} rx={1} fill="var(--paper-2)" />
      <rect x={oc + 2} y={or + 2} width={3} height={3} rx={0.8} fill="currentColor" />
    </g>
  );

  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox={`0 0 ${GRID} ${GRID}`}
      role="img"
      aria-label="Wallet address code (decorative)"
      shapeRendering="crispEdges"
      style={{
        borderRadius: 10,
        background: 'var(--paper-2)',
        border: '1px solid var(--hair)',
        padding: 0,
        color: 'var(--ink)',
        display: 'block',
      }}
    >
      <rect x={0} y={0} width={GRID} height={GRID} fill="var(--paper-2)" />
      {cells.map((m) => (
        <rect key={`${m.x}-${m.y}`} x={m.x} y={m.y} width={1} height={1} rx={0.28} fill="currentColor" />
      ))}
      {finder(QUIET, QUIET)}
      {finder(QUIET, GRID - QUIET - 7)}
      {finder(GRID - QUIET - 7, QUIET)}
    </svg>
  );
}

export default Qr;
