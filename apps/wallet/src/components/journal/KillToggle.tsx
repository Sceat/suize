/**
 * KillToggle — the journal's calm on/off pill for ONE AI account (§02 / §8.3).
 *
 * Ported 1:1 from /tmp/suize-designs/journal.html `.killer` + `.sw`:
 *   - a `role="switch"` pill (`.sw`) with `aria-pressed` driving the knob slide
 *   - a mono `.killer__lab` reading "On" / "Off"
 *   - the whole group carries `.on` when active (so the label goes accent)
 *
 * CALM COPY (LOCKED): the verb is on/off, NEVER "pause agent" / "kill". Off means
 * stopped — nothing runs until turned back on. MAIN never gets one of these (it is
 * untouchable); only Spending + Investing.
 *
 * WIRING: `onToggle` → `home.togglePause(role)` (REAL sponsored PTB: revoke cap /
 * re-issue cap). The flip is OPTIMISTIC in the hook (`controls.*Paused`), so `on`
 * reflects the new state instantly and reconciles on settle. `busy` (= `home.pending
 * === role`) disables the switch in flight. If the account isn't set up yet the hook
 * throws an honest "create it first" error — the parent drawer catches + surfaces it.
 *
 * NO emojis. NO green diodes. The CSS lives in src/system/tokens-journal.css (`.sw`).
 */
import type { KeyboardEvent, MouseEvent, PointerEvent } from 'react';

export interface KillToggleProps {
  /** true when the account is ON (running). The mockup's `state[which]` truthy. */
  on: boolean;
  /** the account's human label, for the aria-label ("AI Spending on/off"). */
  label: string;
  /** flip on/off — may be async (sponsored PTB). Errors bubble to the parent. */
  onToggle: () => void | Promise<void>;
  /** true while this account's toggle is in flight (disables the switch). */
  busy?: boolean;
}

export function KillToggle({ on, label, onToggle, busy = false }: KillToggleProps) {
  const fire = (e: MouseEvent<HTMLSpanElement>) => {
    // The toggle lives INSIDE a selectable/draggable account card; stop the event so
    // toggling on/off never also selects the card or starts a drag.
    e.stopPropagation();
    if (busy) return;
    void onToggle();
  };

  // The mockup uses a click on `.sw`; we keep it keyboard-operable (Space/Enter) too
  // since it is the real on-chain kill switch — accessibility is non-negotiable here.
  const onKeyDown = (e: KeyboardEvent<HTMLSpanElement>) => {
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      if (!busy) void onToggle();
    }
  };

  // Swallow the pointerdown too so the card's drag machine never engages from a tap
  // on the switch (the drag machine listens for pointerdown on `[data-drag]`).
  const onPointerDown = (e: PointerEvent<HTMLSpanElement>) => {
    e.stopPropagation();
  };

  return (
    <div className={`killer${on ? ' on' : ''}`}>
      <span
        className="sw"
        role="switch"
        tabIndex={busy ? -1 : 0}
        aria-checked={on}
        aria-pressed={on}
        aria-busy={busy || undefined}
        aria-disabled={busy || undefined}
        aria-label={`${label} on/off`}
        onClick={fire}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        style={busy ? { opacity: 0.55, cursor: 'progress' } : undefined}
      />
      <span className="killer__lab">{on ? 'On' : 'Off'}</span>
    </div>
  );
}

export default KillToggle;
