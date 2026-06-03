/**
 * AccountDrawer + AccountLedger — the three accounts as SOFT-FRAME, SELECTABLE,
 * DRAGGABLE cards.
 *
 * Three floating paper cards — your MAIN account (your own money, untouchable), the
 * two AI SUB ACCOUNTS: AI SPENDING (sends/pays) and AI INVESTING (runs the
 * strategies you choose). Each is a soft frame + faint gradient wash + long shadow,
 * with a serif name + a tag pill, a capability line, a USDC balance, and on the two
 * sub accounts a refined ON/OFF toggle.
 *
 * ── TWO GESTURES ON ONE CARD ─────────────────────────────────────────────────
 *   • CLICK selects the account → its detail fills the right pane (handled by the
 *     shell via `onSelect`). The selected card carries `.selected`.
 *   • DRAG the whole card moves money: the card is the `[data-drag]` source AND the
 *     `[data-acct]` drop target. The drag machine (MoveMoney) engages only after a
 *     movement threshold, so a plain click still selects (no dot grip anymore).
 *
 * ── REAL WIRING ──────────────────────────────────────────────────────────────
 *   balance   ← MAIN: home.state.totalUsd · SUB: home.state.{spending,investing}.usd
 *   on/off    ← SUB:  !home.state.{spending,investing}.paused (optimistic in the hook)
 *   toggle    → home.togglePause(role)  (REAL sponsored PTB: revoke / re-issue cap)
 *
 * If toggling a sub account that isn't set up yet, the hook throws an honest "create
 * it first" error — caught here + rendered inline. No emojis. CSS lives in
 * src/system/tokens-journal.css (`.acct*`, `.killer`, `.sw`).
 */
import { useState, type ReactNode } from 'react';
import type { AiRole, HomeApi } from '../../data/types';
import { KillToggle } from './KillToggle';

/**
 * The journal-local card identity. These EXACT strings are the drag/drop target keys
 * (`data-acct` / `data-drag`) the drag machine resolves against. MAIN has no AiRole.
 */
export type DrawerKey = 'main' | 'spend' | 'invest';

/** Map a card key to its data-layer AiRole (null for MAIN — no mandate). */
export function roleOf(key: DrawerKey): AiRole | null {
  if (key === 'spend') return 'spending';
  if (key === 'invest') return 'investing';
  return null;
}

/** Human label per card key. MAIN reads "your main account". */
export const DRAWER_LABEL: Record<DrawerKey, string> = {
  main: 'Main',
  spend: 'AI Spending',
  invest: 'AI Investing',
};

/** Format a USD number — "$11,200.00". */
function usd(n: number): string {
  return `$${n.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export interface AccountDrawerProps {
  /** the card key ('main' | 'spend' | 'invest') — also the drag source + drop target. */
  drawer: DrawerKey;
  /** the card's balance in USD (already summed/read by the parent). */
  balanceUsd: number;
  /** the capability line — what this card DOES (not a reassurance). */
  capability: ReactNode;
  /** is this card the selected one (its detail fills the right pane). */
  selected: boolean;
  /** select this account (→ shell fills the detail pane). */
  onSelect: (key: DrawerKey) => void;
  /** SUB accounts only: true when ON (running). Undefined for MAIN (no toggle). */
  on?: boolean;
  /** SUB accounts only: flip on/off (→ home.togglePause(role)). */
  onToggle?: () => void | Promise<void>;
  /** SUB accounts only: true while this account's toggle is mid-flight. */
  busy?: boolean;
}

export function AccountDrawer({
  drawer,
  balanceUsd,
  capability,
  selected,
  onSelect,
  on,
  onToggle,
  busy = false,
}: AccountDrawerProps) {
  const label = DRAWER_LABEL[drawer];
  const isMain = drawer === 'main';
  // null `on` ⇒ MAIN (no toggle); otherwise the sub-account tag mirrors the switch.
  const showToggle = !isMain && on != null && onToggle != null;

  // Honest inline error if the wired toggle throws (e.g. account not set up yet).
  const [err, setErr] = useState<string | null>(null);
  const handleToggle = async () => {
    setErr(null);
    try {
      await onToggle?.();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Something went wrong.');
    }
  };

  return (
    <button
      type="button"
      className={`acct${selected ? ' selected' : ''}`}
      id={`acct-${drawer}`}
      data-acct={drawer}
      data-drag={drawer}
      aria-pressed={selected}
      aria-label={`${isMain ? 'Your main account' : label} — select to view, drag to move money`}
      onClick={() => onSelect(drawer)}
    >
      <div className="acct__main">
        <div className="acct__name">
          {label}
          {isMain ? (
            <span className="acct__tag lock">Your money · untouchable</span>
          ) : (
            <span className={`acct__tag${on ? ' on' : ''}`}>{on ? 'On' : 'Off'}</span>
          )}
        </div>
        <div className="acct__cap">{capability}</div>
        {err ? (
          <div
            className="acct__cap"
            role="alert"
            style={{ color: 'var(--warn)', marginTop: 2 }}
          >
            {err}
          </div>
        ) : null}
      </div>

      <div className="acct__right">
        <div className="acct__bal">
          <span className="v">{usd(balanceUsd)}</span>
          <span className="u">USDC</span>
        </div>
        {showToggle ? (
          <KillToggle on={!!on} label={label} onToggle={handleToggle} busy={busy} />
        ) : null}
      </div>
    </button>
  );
}

export interface AccountLedgerProps {
  /** the data hook — supplies balances, on/off state, and the toggle mutation. */
  home: HomeApi;
  /** the currently-selected card key (its detail fills the right pane). */
  selected: DrawerKey;
  /** select an account (→ shell fills the detail pane). */
  onSelect: (key: DrawerKey) => void;
}

export function AccountLedger({ home, selected, onSelect }: AccountLedgerProps) {
  const { state, pending } = home;

  return (
    <div className="ledger" id="ledger">
      {/* MAIN — your money, untouchable. No toggle; nothing automatic happens here. */}
      <AccountDrawer
        drawer="main"
        balanceUsd={state.totalUsd}
        capability="Where your money lives. Nothing automatic ever happens here."
        selected={selected === 'main'}
        onSelect={onSelect}
      />

      {/* AI SPENDING sub account — sends money and pays for you. */}
      <AccountDrawer
        drawer="spend"
        balanceUsd={state.spending.usd}
        capability="Sends money and pays for you."
        selected={selected === 'spend'}
        onSelect={onSelect}
        on={!state.spending.paused}
        busy={pending === 'spending'}
        onToggle={() => home.togglePause('spending')}
      />

      {/* AI INVESTING sub account — grows your money with the strategies you choose. */}
      <AccountDrawer
        drawer="invest"
        balanceUsd={state.investing.usd}
        capability="Grows your money with the strategies you choose."
        selected={selected === 'invest'}
        onSelect={onSelect}
        on={!state.investing.paused}
        busy={pending === 'investing'}
        onToggle={() => home.togglePause('investing')}
      />
    </div>
  );
}

export default AccountDrawer;
