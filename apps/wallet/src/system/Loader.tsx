/**
 * Loader — ONE calm breathing bloom. No percentage, no vessel, no letter-by-
 * letter apparition. A single soft ice bloom that slowly breathes (two nested
 * blooms for soft depth) with the Logo centered, plus an optional mono label.
 *
 * Used for: `signing you in`, `setting up your wallet`, `returning to suize.io`
 * (copy is passed in by the caller — see SPEC §4). Respects reduced-motion
 * (the breathe class settles to a calm static state via tokens.css).
 */
import { Logo } from './Logo';

export interface LoaderProps {
  /** optional mono caption under the bloom, e.g. "setting up your wallet". */
  label?: string;
  className?: string;
}

export function Loader({ label, className }: LoaderProps) {
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
        gap: 28,
      }}
    >
      <div style={{ position: 'relative', width: 96, height: 96, display: 'grid', placeItems: 'center' }}>
        {/* outer + inner blooms — soft radial ice, breathing at offset rates */}
        <span
          aria-hidden
          className="suize-breathe-slow"
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: '50%',
            background: 'radial-gradient(circle, var(--cyan-wash), transparent 68%)',
            filter: 'blur(2px)',
          }}
        />
        <span
          aria-hidden
          className="suize-breathe"
          style={{
            position: 'absolute',
            inset: '18%',
            borderRadius: '50%',
            background: 'radial-gradient(circle, color-mix(in srgb, var(--cyan) 26%, transparent), transparent 70%)',
          }}
        />
        <Logo size={40} />
      </div>

      {label ? (
        <div
          style={{
            fontFamily: 'var(--mono)',
            fontSize: 12,
            letterSpacing: '0.06em',
            color: 'var(--ink-3)',
          }}
        >
          {label}
        </div>
      ) : null}
    </div>
  );
}
