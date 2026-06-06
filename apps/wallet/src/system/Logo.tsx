/**
 * Logo — the Suize mark. Renders the REAL logo art (public/logo-mask.png) as a
 * CSS mask filled with the theme accent (var(--cyan): blue in light, gold in
 * dark), so it tints per theme with zero JS. The mask is the transparent
 * silhouette; the visible color is the accent painted behind it.
 *
 * ISOLATED ON PURPOSE: swap the mask art and every call-site (TopBar ~22px,
 * Loader ~40px, onboarding hello ~40-44px) updates at once. Aspect ratio is the
 * source art's 56:67 (height = size, width = size * 56/67), kept identical so
 * call-site layout is unchanged.
 */

export interface LogoProps {
  /** rendered height in px; width scales by the 56:67 aspect. Default 22. */
  size?: number;
  className?: string;
  'aria-hidden'?: boolean;
}

const ART_W = 56;
const ART_H = 67;

export function Logo({ size = 22, className, 'aria-hidden': ariaHidden = true }: LogoProps) {
  const width = (size * ART_W) / ART_H;

  return (
    <span
      role={ariaHidden ? undefined : 'img'}
      aria-label={ariaHidden ? undefined : 'Suize'}
      aria-hidden={ariaHidden || undefined}
      className={className}
      style={{
        display: 'inline-block',
        flex: '0 0 auto',
        width,
        height: size,
        background: 'var(--cyan)',
        WebkitMask: 'url(/logo-mask.png) center/contain no-repeat',
        mask: 'url(/logo-mask.png) center/contain no-repeat',
      }}
    />
  );
}
