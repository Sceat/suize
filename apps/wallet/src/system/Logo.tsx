/**
 * Logo — the Suize mark. NEW premium monogram (the old water-drop is killed).
 *
 * A clean, minimal geometric "S / water-current" monogram: two interlocking
 * sweeps that read as both an S and a flowing current, with a single horizontal
 * seam accent (the vault/safe metaphor) and a centered node. Gradient-filled via
 * an inline SVG <linearGradient> whose stops read the theme's --g1/--g2/--g3 CSS
 * vars, so it works in BOTH themes with no JS.
 *
 * ISOLATED ON PURPOSE: the final art is a one-file swap — only the <path> data
 * inside <symbol-equivalent> body below changes; the gradient plumbing, sizing,
 * and call-sites stay. Placed in: TopBar (~22px), Loader (~40px), onboarding
 * hello (~40px).
 *
 * viewBox is 40×46 (kept identical to the legacy mark so every call-site's
 * aspect ratio is unchanged).
 */
import { useId } from 'react';

export interface LogoProps {
  /** rendered height in px; width scales by the 40:46 aspect. Default 22. */
  size?: number;
  className?: string;
  'aria-hidden'?: boolean;
}

const VB_W = 40;
const VB_H = 46;

export function Logo({ size = 22, className, 'aria-hidden': ariaHidden = true }: LogoProps) {
  // unique gradient id per instance so multiple <Logo/>s never collide.
  const gid = useId().replace(/:/g, '');
  const fillId = `suizeGrad-${gid}`;
  const width = (size * VB_W) / VB_H;

  return (
    <svg
      width={width}
      height={size}
      viewBox={`0 0 ${VB_W} ${VB_H}`}
      fill="none"
      role="img"
      aria-label={ariaHidden ? undefined : 'Suize'}
      aria-hidden={ariaHidden || undefined}
      className={className}
      style={{ display: 'inline-block', flex: '0 0 auto' }}
    >
      <defs>
        <linearGradient id={fillId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--g1)" />
          <stop offset="0.5" stopColor="var(--g2)" />
          <stop offset="1" stopColor="var(--g3)" />
        </linearGradient>
      </defs>

      {/*
        The monogram body. Two stacked ribbon sweeps form an "S" that also reads
        as a current. Stroked (not filled) for a clean, premium, lightweight feel
        that holds at small sizes. round caps/joins keep it liquid.
      */}
      <g
        stroke={`url(#${fillId})`}
        strokeWidth={4}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      >
        {/* top sweep — opens to the right */}
        <path d="M30 11.5C30 6.8 25.6 4 20 4S10 6.8 10 11.5c0 5 4.4 7.4 10 9" />
        {/* bottom sweep — opens to the left (the S crossover) */}
        <path d="M10 34.5C10 39.2 14.4 42 20 42s10-2.8 10-7.5c0-5-4.4-7.4-10-9" />
      </g>

      {/* the seam — the single horizontal vault/safe accent, brighter than the body */}
      <line
        x1="11"
        y1="23"
        x2="29"
        y2="23"
        stroke="var(--g3)"
        strokeWidth={2}
        strokeLinecap="round"
        opacity={0.55}
      />
      {/* the centered node — a small bright bead on the seam */}
      <circle cx="20" cy="23" r="2.4" fill="var(--g3)" />
    </svg>
  );
}
