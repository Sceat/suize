/**
 * KillToggle — the journal's calm STATUS ROW for ONE AI account (§02 / §8.3).
 *
 * Rebuilt again (founder feedback): the row is NO LONGER one big toggle. It splits
 * into TWO pieces so the live state and the verb never compete:
 *   - LEFT — a calm STATE LABEL (`.kill__state`): a 6px lucide dot (`.kill__dot`,
 *     FILLED accent Circle when Working, HOLLOW neutral when Paused) + one word
 *     (`.kill__word`): "Working" (accent) / "Paused" (--ink-3). This is plain text,
 *     NOT a control — it only reports state.
 *   - RIGHT — a SEPARATE small action `<button>` (`.kill__act`): reads "Pause" (with
 *     a PauseCircle icon) when ON, "Turn on" (with a Power icon) when OFF. ONLY this
 *     button flips the account; it owns the stopPropagation + honest try/catch.
 *
 * CALM COPY (LOCKED): the state reads Working / Paused — NEVER "pause agent" /
 * "kill". Paused means stopped — nothing runs until turned back on. MAIN never
 * gets one of these (it is untouchable); only Spending + Investing.
 *
 * WIRING: `onToggle` → `home.togglePause(role)` (REAL sponsored PTB: revoke cap /
 * re-issue cap). The flip is OPTIMISTIC in the hook (`controls.*Paused`), so `on`
 * reflects the new state instantly and reconciles on settle. `busy` (= `home.pending
 * === role`) disables the button in flight. If the account isn't set up yet the hook
 * throws an honest "create it first" error — caught here and surfaced inline.
 *
 * NO emojis. The CSS lives in src/system/tokens-journal.css (`.kill*`).
 */
import { useState, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react';
import { Circle, PauseCircle, Power, ICON_STROKE } from '../../system';
import { InvestingKillModal } from './InvestingKillModal';

export interface KillToggleProps {
  /** true when the account is ON (running / Working). */
  on: boolean;
  /** the account's human label, for the aria-label ("Pause AI Spending"). */
  label: string;
  /** flip on/off — may be async (sponsored PTB). Errors are caught + surfaced inline. */
  onToggle: () => void | Promise<void>;
  /** true while this account's toggle is in flight (disables the button). */
  busy?: boolean;
  /**
   * AI INVESTING only: gate the on→off flip behind the InvestingKillModal warning
   * (cash out / sell / withdraw before the mandate is revoked). Turning back ON
   * (off→on) never shows the modal. Default false = flip immediately (legacy).
   */
  confirmOnTurnOff?: boolean;
}

export function KillToggle({
  on,
  label,
  onToggle,
  busy = false,
  confirmOnTurnOff = false,
}: KillToggleProps) {
  // Honest inline error if the wired toggle throws (e.g. account not set up yet).
  const [err, setErr] = useState<string | null>(null);
  // AI INVESTING turn-off: the warning modal is open, awaiting confirm/cancel.
  const [confirming, setConfirming] = useState(false);

  const run = async () => {
    if (busy) return;
    setErr(null);
    try {
      await onToggle();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Something went wrong.');
    }
  };

  // The single intent: clicking the control. For AI INVESTING turning OFF (on→off),
  // don't flip yet — open the warning modal and let its confirm call `run()`. Every
  // other case (turning ON, or any account without the gate) flips immediately.
  const act = () => {
    if (busy) return;
    if (confirmOnTurnOff && on) {
      setErr(null);
      setConfirming(true);
      return;
    }
    void run();
  };

  // Confirm the turn-off → the REAL mandate revoke. Close the modal once it settles.
  const confirmTurnOff = async () => {
    await run();
    setConfirming(false);
  };

  // The button lives INSIDE a selectable/draggable account card; stop the event so
  // flipping Working/Paused never also selects the card or starts a drag.
  const fire = (e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    act();
  };

  // Keyboard parity (Space/Enter) — it is the real on-chain kill switch, so
  // accessibility is non-negotiable. Stop bubbling so the card never reacts.
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      act();
    }
  };

  // Swallow the pointerdown too so the card's drag machine never engages from a tap
  // on the button (the drag machine listens for pointerdown on `[data-drag]`).
  const onPointerDown = (e: PointerEvent<HTMLButtonElement>) => {
    e.stopPropagation();
  };

  const word = on ? 'Working' : 'Paused';
  const verb = on ? 'Pause' : 'Turn on';
  const Icon = on ? PauseCircle : Power;

  return (
    <>
      <div className={`kill${on ? ' on' : ''}`}>
        {/* LEFT — plain state label (dot + word). Reports state; not a control. */}
        <span className="kill__state">
          <Circle
            className="kill__dot"
            size={6}
            strokeWidth={ICON_STROKE}
            // FILLED accent dot when Working; HOLLOW neutral dot when Paused.
            fill={on ? 'currentColor' : 'none'}
            aria-hidden="true"
          />
          <span className="kill__word">{word}</span>
        </span>

        {/* RIGHT — the ONLY control. Pause when on / Turn on when off. */}
        <button
          type="button"
          className="kill__act"
          disabled={busy || confirming}
          aria-busy={busy || undefined}
          aria-haspopup={confirmOnTurnOff && on ? 'dialog' : undefined}
          aria-label={`${verb} ${label}`}
          onClick={fire}
          onKeyDown={onKeyDown}
          onPointerDown={onPointerDown}
        >
          <Icon size={14} strokeWidth={ICON_STROKE} aria-hidden="true" />
          {verb}
        </button>
      </div>

      {err ? (
        <div className="acct__cap" role="alert" style={{ color: 'var(--warn)', marginTop: 2 }}>
          {err}
        </div>
      ) : null}

      {/* AI INVESTING turn-off: the honest "cash out everything first" warning. Only
          its confirm calls the REAL revoke (run → home.togglePause('investing')). */}
      {confirming ? (
        <InvestingKillModal
          busy={busy}
          onConfirm={confirmTurnOff}
          onCancel={() => setConfirming(false)}
        />
      ) : null}
    </>
  );
}

export default KillToggle;
