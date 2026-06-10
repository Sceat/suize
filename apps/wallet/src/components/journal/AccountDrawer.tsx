/**
 * AccountDrawer + AccountLedger — the three accounts as FLAT, SELECTABLE,
 * DRAGGABLE cards (the editorial redesign).
 *
 * Three v3 dashboard cards — your MAIN account (your own money, untouchable) and the
 * two AI SUB ACCOUNTS: AI SPENDING (sends/pays, chat-only) and AI INVESTING (runs the
 * strategies you choose). Each card is a white `--paper-2` face on ONE hairline (3px
 * corners, a soft 1px shadow, a -3px hover lift) — laid out as a VERTICAL editorial
 * stack in the smoothed Suize language:
 *
 *     ┌──────────────────────────────┐
 *     │ YOUR MONEY                   │  ← .acct__label (Space Grotesk eyebrow, tracked)
 *     │ Main                         │  ← .acct__title (Space Grotesk name)
 *     │ $11,200.00                   │  ← .acct__hero  (muted $ + BLUE Martian Mono)
 *     │ Where your money lives.      │  ← .acct__cap   (one plain line)
 *     │ ● Working          [Pause]   │  ← .kill row (AI Investing only)
 *     └──────────────────────────────┘
 *
 * The eyebrow → title → hero → cap live in `.acct__body`, which dims to ~50% when an AI
 * account is paused; the status foot / `.kill` row stay full opacity so it can be turned
 * back on. The balance is ALWAYS blue Martian Mono — NEVER serif on a number (the v3
 * lock). MAIN carries the three REAL money actions (Add / Send / Convert) in its
 * `.acct__foot` with ONE solid-accent primary; the AI accounts carry their status row.
 *
 * ── THE CARD IS A role="button" DIV (not a <button>) ─────────────────────────
 *   So the MAIN card can hold real nested `<button>`s (Add money / Send / Convert),
 *   which is invalid inside a native `<button>`, the card is a `div role="button"`
 *   with `tabIndex` + an Enter/Space key handler. The nested action buttons each
 *   `stopPropagation()` so they don't also select/drag the card.
 *
 * ── TWO GESTURES ON ONE CARD ─────────────────────────────────────────────────
 *   • CLICK selects the account → its detail fills the detail panel (via `onSelect`).
 *     The selected card carries `.selected` = a FULL hairline-blue border + faint
 *     blue-wash fill + a soft blue lift. NEVER a left-edge accent bar (the locked
 *     AI-slop tell) — the 1px border only changes color, so selecting never shifts a px.
 *   • DRAG the whole card moves money: the card is the `[data-drag]` source AND the
 *     `[data-acct]` drop target. The drag machine (MoveMoney) engages only after a
 *     movement threshold, so a plain click still selects.
 *
 * ── REAL WIRING (unchanged) ──────────────────────────────────────────────────
 *   balance   ← MAIN: home.state.totalUsd · SUB: home.state.{spending,investing}.usd
 *   on/off    ← SUB:  !home.state.{spending,investing}.paused (optimistic in the hook)
 *   toggle    → home.togglePause(role)  (REAL sponsored PTB: revoke / re-issue cap)
 *
 * Selecting Main opens its detail pane (MainAccountView) — now just the held-coins
 * list. The real Add money / Send / Convert sheets are mounted from the MAIN card
 * here (it threads `home` for `home.send`), portaled to <body>.
 *
 * If toggling a sub account that isn't set up yet, the hook throws an honest "create
 * it first" error — caught in KillToggle + rendered inline. No emojis. CSS lives in
 * src/system/tokens-journal.css (`.acct*`, `.kill*`, `.action*`).
 */
import { useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { AiRole, HomeApi } from '../../data/types';
import { Plus, ArrowUpRight, RefreshCw, ICON_STROKE } from '../../system';
import { AddFundsSheet } from '../sheets/AddFundsSheet';
import { SendSheet } from '../sheets/SendSheet';
import { ConvertSheet } from '../sheets/ConvertSheet';
import { KillToggle } from './KillToggle';

/** Which MAIN-card sheet is open (null = none). */
type OpenSheet = 'add' | 'send' | 'convert' | null;

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

/** The v3 editorial EYEBROW on top of each card — what kind of account it is. */
const DRAWER_EYEBROW: Record<DrawerKey, string> = {
  main: 'Your money',
  spend: 'Auto-pay',
  invest: 'Auto-invest',
};

/** The card TITLE — the account's short name. */
const DRAWER_TITLE: Record<DrawerKey, string> = {
  main: 'Main',
  spend: 'Spending',
  invest: 'Investing',
};

/** Format a USD number WITHOUT the sign — "11,200.00" (the $ is its own muted span). */
function usd(n: number): string {
  return n.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** Shorten a 0x address — "0x1234… abcd". */
function shortAddr(addr: string): string {
  if (!addr) return '';
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

/** The breathing "Working" pill (the v3 status — dot pulses). */
function WorkingPill() {
  return (
    <span className="jstatus jstatus-ok">
      <span className="jstatus__dot j-breathe" aria-hidden="true" />
      Working
    </span>
  );
}

/** The quiet "Turned off" pill. */
function TurnedOffPill() {
  return (
    <span className="jstatus jstatus-off">
      <span className="jstatus__dot" aria-hidden="true" />
      Turned off
    </span>
  );
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
  /**
   * AI cards: true when ON (running / available). Drives the subtle `.live` active
   * effect on BOTH AI cards, and the Working/Paused row on INVESTING. Undefined for
   * MAIN (no AI state). SPENDING passes it for `.live` only — it has no kill switch.
   */
  on?: boolean;
  /** AI INVESTING only: flip on/off (→ home.togglePause('investing')). */
  onToggle?: () => void | Promise<void>;
  /** AI INVESTING only: true while its toggle is mid-flight. */
  busy?: boolean;
  /** MAIN only: the data hook, used to mount the Add money / Send / Convert sheets. */
  home?: HomeApi;
  /** MAIN only: how many coins the user holds (shown in the card's status foot). */
  coinCount?: number;
  /** MAIN only: the user's 0x address (shortened in the card's status foot). */
  address?: string;
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
  home,
  coinCount,
  address,
}: AccountDrawerProps) {
  const label = DRAWER_LABEL[drawer];
  const isMain = drawer === 'main';
  const isAi = !isMain;
  // ONLY AI INVESTING carries the kill switch. AI SPENDING is on-demand — it acts
  // only when you confirm in chat, so it has nothing to pause and renders NO status
  // row (label + balance + capability, full stop). MAIN never had a toggle.
  const showToggle = drawer === 'invest' && on != null && onToggle != null;
  // A paused AI account dims its body; the .kill row stays lit so it can be re-armed.
  const paused = showToggle && !on;
  // `.live` marks an AI card that's currently ON (the CSS owner paints the subtle
  // active effect). Spending (no toggle) reads `on` directly; Investing uses its
  // toggle state. Never on MAIN.
  const live = isAi && on === true;

  // MAIN-only: which money sheet is open (the real Add money / Send / Convert).
  const [sheet, setSheet] = useState<OpenSheet>(null);
  const closeSheet = () => setSheet(null);
  // A nested action button must not also select/drag the card it lives on.
  const openSheet =
    (which: Exclude<OpenSheet, null>) => (e: MouseEvent<HTMLButtonElement>) => {
      e.stopPropagation();
      setSheet(which);
    };

  // The card is a `div role="button"` (so it can nest real <button>s), so we wire
  // keyboard selection by hand: Enter/Space select (preventDefault on Space to stop
  // the page from scrolling). The drag machine still owns pointer gestures.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      if (e.key === ' ') e.preventDefault();
      onSelect(drawer);
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      className={`acct${isMain ? ' acct--main' : ' acct--ai'}${
        live ? ' live' : ''
      }${selected ? ' selected' : ''}${paused ? ' paused' : ''}`}
      id={`acct-${drawer}`}
      data-acct={drawer}
      data-drag={drawer}
      aria-pressed={selected}
      aria-label={`${isMain ? 'Your main account' : label} — select to view, drag to move money`}
      onClick={() => onSelect(drawer)}
      onKeyDown={onKeyDown}
    >
      {/* the body dims to ~50% when paused; the status row + footer below stay lit.
          v3 card stack: editorial EYEBROW → account TITLE → the BLUE Martian-Mono
          balance → one plain capability line. */}
      <div className="acct__body">
        <div className="acct__label">{DRAWER_EYEBROW[drawer]}</div>
        <div className="acct__title">{DRAWER_TITLE[drawer]}</div>
        {/* USD total across whatever the account holds (SUI/USDC/…) — no coin unit, a
            fixed "USDC" suffix would mislabel a mixed-asset balance. The v3 card hero:
            a muted `$` (.acct__cur, --ink-4) + the blue Martian-Mono figure (.acct__num
            on .acct__hero, solid --blue-deep). NEVER serif on a number, NO .ng gradient
            (the v3 card uses solid blue money). */}
        <div className="acct__hero tnum">
          <span className="acct__cur">$</span>
          <span className="acct__num">{usd(balanceUsd)}</span>
        </div>
        <div className="acct__cap">{capability}</div>
      </div>

      {/* the v3 STATUS FOOT — pinned to the card bottom, stays lit when paused.
            MAIN     → "N coins · 0xaddr…" (honest holdings + address)
            SPENDING → the breathing Working pill (on-demand; no kill switch)
          AI INVESTING keeps its real KillToggle below (its Working/Turned-off +
          the only toggle), so it gets NO duplicate pill here. */}
      {isMain ? (
        <div className="acct__foot-status">
          <span className="acct__foot-words">
            {coinCount ?? 0} coin{coinCount === 1 ? '' : 's'}
            {address ? (
              <>
                {' · '}
                <span className="tnum">{shortAddr(address)}</span>
              </>
            ) : null}
          </span>
        </div>
      ) : null}
      {drawer === 'spend' ? (
        <div className="acct__foot-status">
          {on ? <WorkingPill /> : <TurnedOffPill />}
        </div>
      ) : null}

      {/* AI INVESTING only: the calm Working/Paused status row (+ its own inline
          error). Turning it OFF routes through the InvestingKillModal first. AI
          SPENDING is on-demand and renders no status row at all. */}
      {showToggle ? (
        <KillToggle
          on={!!on}
          label={label}
          onToggle={onToggle!}
          busy={busy}
          confirmOnTurnOff
        />
      ) : null}

      {/* MAIN: the three REAL money actions live here (nested <button>s). Each
          stops propagation so it opens its sheet without selecting/dragging the card.
          "Add / Receive" is the ONE solid-accent primary; Send + Convert are ghosts. */}
      {isMain && home ? (
        <div className="acct__foot">
          <button
            type="button"
            className="action action--primary"
            onClick={openSheet('add')}
            aria-label="Add / Receive"
          >
            <Plus size={15} strokeWidth={ICON_STROKE} aria-hidden />
            Add / Receive
          </button>
          <button
            type="button"
            className="action"
            onClick={openSheet('send')}
            aria-label="Send"
          >
            <ArrowUpRight size={15} strokeWidth={ICON_STROKE} aria-hidden />
            Send
          </button>
          <button
            type="button"
            className="action"
            onClick={openSheet('convert')}
            aria-label="Convert"
          >
            <RefreshCw size={15} strokeWidth={ICON_STROKE} aria-hidden />
            Convert
          </button>
        </div>
      ) : null}

      {/* MAIN sheets portal to <body> so they escape the journal's overflow:hidden
          frame. Wiring is unchanged from the old MainAccountView (onSend=home.send). */}
      {isMain && home && sheet === 'add'
        ? createPortal(
            <AddFundsSheet
              handle={home.state.handle}
              address={home.state.address}
              onClose={closeSheet}
            />,
            document.body,
          )
        : null}
      {isMain && home && sheet === 'send'
        ? createPortal(
            <SendSheet
              currencies={home.state.currencies}
              onClose={closeSheet}
              onSend={home.send}
            />,
            document.body,
          )
        : null}
      {isMain && home && sheet === 'convert'
        ? createPortal(
            <ConvertSheet currencies={home.state.currencies} onClose={closeSheet} />,
            document.body,
          )
        : null}
    </div>
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
        capability="Where your currencies live. Nothing automatic."
        selected={selected === 'main'}
        onSelect={onSelect}
        home={home}
        coinCount={state.currencies.filter((c) => c.ui > 0).length}
        address={state.address}
      />

      {/* AI SPENDING sub account — sends money and pays for you (chat-only). It's
          ON-DEMAND: it only acts when you confirm in chat, so there's nothing to
          pause — NO kill switch, NO status row. We pass `on` purely so the card can
          carry the subtle active-AI `.live` effect; no onToggle/busy wiring. */}
      <AccountDrawer
        drawer="spend"
        balanceUsd={state.spending.usd}
        capability="Sends money and pays for you."
        selected={selected === 'spend'}
        onSelect={onSelect}
        on={!state.spending.paused}
      />

      {/* AI INVESTING sub account — grows your money with the strategies you choose. */}
      <AccountDrawer
        drawer="invest"
        balanceUsd={state.investing.usd}
        capability="Grows your money with strategies you choose."
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
