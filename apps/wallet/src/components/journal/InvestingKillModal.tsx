/**
 * InvestingKillModal — the honest "are you sure?" before AI Investing is turned OFF.
 *
 * Turning AI Investing off isn't a soft pause: it REVOKES the on-chain mandate (the
 * real kill) so the AI can no longer trade with this account — its balance is yours
 * and stays put. We DON'T promise specific liquidations here: the autonomous unwind
 * (cash out Crash bets, sell the open DeepBook trade, withdraw Navi staking) is the
 * sanctioned agent loop's job and that loop is still a STUB this pass — so turning
 * off today does NOT execute those. This modal states only what the toggle actually
 * does today, in monkey-simple words, and never claims an unwind that won't run.
 *
 * Turning it back ON is harmless and gets NO modal — the caller only mounts this on
 * the on→off click.
 *
 * ── WIRING ───────────────────────────────────────────────────────────────────
 *   onConfirm → the REAL toggle (home.togglePause('investing') = mandate revoke).
 *               This stops the AI's access; it does NOT itself liquidate positions
 *               (that unwind is the agent loop, still stubbed).
 *   onCancel  → close, change nothing (the account stays Working).
 *   busy      → confirm in flight: disables both buttons + shows the busy verb.
 *
 * ── PLUMBING ─────────────────────────────────────────────────────────────────
 *   Portaled into the `.journal` root (so the `.warnpop*` rules + their scoped vars
 *   resolve) while `position:fixed` still escapes the overflow:hidden no-scroll
 *   frame, like the move-money `.pop`. The card underneath is a selectable/draggable
 *   role="button" div, so the backdrop + every button stopPropagation() so a click
 *   inside the modal never selects or drags the card behind it. Esc cancels.
 *
 * NO emojis — every glyph is a lucide icon. CSS lives in tokens-journal.css
 * (`.warnpop*`), owned by the CSS agent; this component only references the classes.
 */
import { useEffect, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertTriangle,
  Power,
  Lock,
  Wallet,
  ICON_STROKE,
  type IconType,
} from '../../system';

export interface InvestingKillModalProps {
  /** confirm the turn-off → the REAL mandate revoke (home.togglePause('investing')). */
  onConfirm: () => void | Promise<void>;
  /** dismiss without changing anything — the account stays Working. */
  onCancel: () => void;
  /** true while the confirm is in flight (disables both buttons). */
  busy?: boolean;
}

/**
 * The honest consequences, each a lucide icon + one plain line. These state ONLY
 * what the toggle does today: it revokes the on-chain mandate so the AI can't trade.
 * We do NOT promise to cash out bets / sell trades / withdraw staking — that unwind
 * is the agent loop, still stubbed, so it wouldn't actually run on turn-off.
 */
const CONSEQUENCES: ReadonlyArray<{ Icon: IconType; line: string }> = [
  { Icon: Power, line: 'Stops the AI — it can no longer trade this account.' },
  { Icon: Lock, line: 'Removes its key on-chain. You take back control.' },
  { Icon: Wallet, line: "This account's balance stays yours, right here." },
];

export function InvestingKillModal({ onConfirm, onCancel, busy = false }: InvestingKillModalProps) {
  // The `.warnpop*` CSS + its tokens (--paper-2/--hair/--warn/--scrim/--r-max) are
  // scoped under `.journal`, so we portal INTO the journal root (not bare <body>) —
  // there the scoped rules resolve AND `position:fixed` still escapes the no-scroll
  // overflow frame (same as the move-money .pop). Falls back to <body> if absent.
  const target =
    (typeof document !== 'undefined' && document.querySelector('.journal')) || document.body;

  // Mount → flip `.open` on the next frame so the fade/scale-in transition runs
  // (the base .warnpop/.warnpop__scrim are opacity:0 until `.open`).
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setOpen(true));
    return () => cancelAnimationFrame(id);
  }, []);

  // Esc cancels (parity with the X / Cancel button). Bound on the document so it
  // works no matter where focus sits inside the portaled modal.
  useEffect(() => {
    const onEsc = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onCancel();
    };
    document.addEventListener('keydown', onEsc);
    return () => document.removeEventListener('keydown', onEsc);
  }, [busy, onCancel]);

  // The modal lives over a selectable/draggable card; swallow every pointer/click so
  // interacting with it never selects or drags the card underneath.
  const stop = (e: MouseEvent) => e.stopPropagation();

  // Backdrop click = cancel (but not while busy). stopPropagation first so the card
  // behind never reacts; the inner panel stops its own clicks from reaching here.
  const onBackdrop = (e: MouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (!busy) onCancel();
  };

  const confirm = (e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    if (!busy) void onConfirm();
  };

  const cancel = (e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    if (!busy) onCancel();
  };

  // Keep keyboard activation from bubbling to the card's Enter/Space select handler.
  const swallowKey = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === ' ' || e.key === 'Enter') e.stopPropagation();
  };

  return createPortal(
    <div
      className={`warnpop__scrim${open ? ' open' : ''}`}
      role="presentation"
      onClick={onBackdrop}
      onPointerDown={stop}
    >
      <div
        className={`warnpop${open ? ' open' : ''}`}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="warnpop-title"
        aria-describedby="warnpop-body"
        onClick={stop}
        onPointerDown={stop}
        onKeyDown={swallowKey}
      >
        <h2 className="warnpop__title" id="warnpop-title">
          <AlertTriangle size={14} strokeWidth={ICON_STROKE} aria-hidden="true" />
          Turn off AI Investing?
        </h2>

        <ul className="warnpop__body" id="warnpop-body">
          {CONSEQUENCES.map(({ Icon, line }) => (
            <li className="warnpop__li" key={line}>
              <Icon size={16} strokeWidth={ICON_STROKE} aria-hidden="true" />
              <span>{line}</span>
            </li>
          ))}
        </ul>

        <div className="warnpop__foot">
          <button
            type="button"
            className="btn btn--ghost"
            onClick={cancel}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn btn--cy"
            onClick={confirm}
            disabled={busy}
            aria-busy={busy || undefined}
          >
            {busy ? 'Turning off…' : 'Turn off AI Investing'}
          </button>
        </div>
      </div>
    </div>,
    target,
  );
}

export default InvestingKillModal;
