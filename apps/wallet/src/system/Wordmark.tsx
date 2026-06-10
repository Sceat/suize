/**
 * Wordmark — "Suize" rendered as "Sui" + a periodic-table ELEMENT TILE "Ze".
 *
 * The founder's lockup: serif "Sui" followed by a knockout "Ze" element tile
 * (blue in light, gold in dark) so the whole thing reads "SuiZe" = Suize.
 *
 * Self-contained + fully INLINE-STYLED on purpose: no external CSS classes, only
 * CSS vars, so it renders identically in BOTH scopes — the onboarding/system
 * scope (tokens.css) and the `.journal` scope (tokens-journal.css). The tile is
 * tinted with var(--cyan) (defined at :root in tokens.css, resolves everywhere),
 * which is BLUE in light themes and GOLD in dark — the accent spent once.
 */

export interface WordmarkProps {
  /** the type size of "Sui" — the tile scales relative to it. Default '1.9rem'. */
  size?: string;
  className?: string;
}

/**
 * SuizeWordmark — the v3 masthead lockup: "SUIZE" set in 'Hashgraph Title' with an
 * ink→blue gradient (Space Grotesk fallback). Pure CSS class (`.mh__suize`) so it
 * clips correctly inside the `.journal` scope. The accessible label says "Suize".
 */
export function SuizeWordmark({ className }: { className?: string }) {
  return (
    <span className={className ?? 'mh__suize'} aria-label="Suize">
      SUIZE
    </span>
  );
}

export function Wordmark({ size = '1.9rem', className }: WordmarkProps) {
  return (
    <span
      className={className}
      aria-label="Suize"
      style={{
        display: 'inline-flex',
        alignItems: 'baseline',
        gap: '0.06em',
        lineHeight: 1,
        fontSize: size,
        whiteSpace: 'nowrap',
      }}
    >
      {/* "Sui" — the serif word body */}
      <span
        aria-hidden="true"
        style={{
          fontFamily: 'var(--serif)',
          fontWeight: 400,
          color: 'var(--ink)',
          letterSpacing: '-0.02em',
        }}
      >
        Sui
      </span>

      {/* "Ze" — the periodic-table element tile (knockout letters on accent) */}
      <span
        aria-hidden="true"
        style={{
          display: 'inline-block',
          background: 'var(--cyan)',
          color: 'var(--paper)',
          borderRadius: '0.18em',
          padding: '0.02em 0.14em',
          fontFamily: 'var(--mono)',
          fontWeight: 600,
          fontSize: '0.82em',
          letterSpacing: 0,
          lineHeight: 1,
          transform: 'translateY(-0.04em)',
        }}
      >
        Ze
      </span>
    </span>
  );
}

export default Wordmark;
