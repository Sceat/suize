/**
 * JournalBalanceHero — §01 "the balance" body for THE JOURNAL.
 *
 * Ported 1:1 from /tmp/suize-designs/journal.html `#s-balance > .hero`:
 *   <div class="hero">
 *     <div class="hero__lab">All your money, today</div>
 *     <div class="hero__num"><span class="cur">$</span><span class="grad mono">…</span></div>
 *     <div class="hero__sub">…</div>
 *   </div>
 *
 * JournalShell already renders the §01 eyebrow ("01 the balance"); this leaf renders
 * ONLY the `.hero` body. The CSS lives in src/system/tokens-journal.css (`.hero*`,
 * scoped under `.journal`), so the gradient `.grad` + `.mono` tnum resolve here.
 *
 * ── REAL WIRING ────────────────────────────────────────────────────────────────
 *   number  ← home.state.totalUsd (the real MAIN sum, count-up to the live total).
 *
 * ── HONESTY (no fake P&L) ───────────────────────────────────────────────────────
 * The mockup's "+$21 today · grown by your AI" delta is a literal demo string — NOT
 * real P&L. Per the port plan, we surface it ONLY under the demo "In use" (`used`)
 * mode; in the real-wired hero it is omitted (the brand forbids fabricated P&L). The
 * "Across three accounts" sub-line is always shown.
 *
 * Count-up matches the mockup's `countUp` (2.4s easeOutCubic, snap under reduced
 * motion). It re-runs when the live total changes so a balance push animates calmly.
 */
import { useEffect, useRef, useState } from 'react';

export interface JournalBalanceHeroProps {
  /** the real MAIN total in USD (home.state.totalUsd). */
  totalUsd: number;
  /**
   * The demo "In use" flourish: when true, render the mockup's "+$21 today" delta
   * line. Driven by the demo ribbon ('used') only — never shown in the honest
   * real-wired hero (no fabricated P&L). Default false.
   */
  showDemoDelta?: boolean;
}

const DURATION = 2400;
const easeOutCubic = (k: number) => 1 - Math.pow(1 - k, 3);

function fmt(n: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function JournalBalanceHero({ totalUsd, showDemoDelta = false }: JournalBalanceHeroProps) {
  const reduce =
    typeof window !== 'undefined' &&
    (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);

  const [value, setValue] = useState(() => (reduce ? totalUsd : 0));
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (reduce) {
      setValue(totalUsd);
      return;
    }
    const t0 = performance.now();
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / DURATION);
      setValue(totalUsd * easeOutCubic(k));
      if (k < 1) rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [totalUsd, reduce]);

  return (
    <div className="hero">
      <div className="hero__lab">All your money, today</div>
      <div className="hero__num">
        <span className="cur" aria-hidden="true">
          $
        </span>
        <span className="grad mono">{fmt(value)}</span>
      </div>
      <div className="hero__sub">
        <span>Across three accounts</span>
        {showDemoDelta ? (
          <span>
            <b>+$21 today</b> · grown by your AI
          </span>
        ) : null}
      </div>
    </div>
  );
}

export default JournalBalanceHero;
