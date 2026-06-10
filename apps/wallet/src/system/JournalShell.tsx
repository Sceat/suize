/**
 * JournalShell — the post-onboarding shell, THE JOURNAL (v3 dashboard).
 *
 * The SMOOTHED Suize language as realized in v3: a light blue-on-white editorial
 * broadsheet. Structure comes from SPACE + hairlines + editorial type. The CSS lives
 * in src/system/tokens-journal.css (scoped under `.journal`, this root's class).
 *
 * ── LAYOUT (the v3 dashboard model) ─────────────────────────────────────────────
 * A centered broadsheet that flows top-to-bottom:
 *   • TOP BAR — the SUIZE wordmark (Hashgraph ink→blue) + the handle (mono) on the
 *     left; an "EVERYTHING TOGETHER" eyebrow + the grand total (blue Martian Mono) +
 *     an "ALL GOOD" health pill on the right. Then a faded hairline divider.
 *   • ACCOUNT GRID — the three accounts as a responsive card grid
 *     (repeat(auto-fill, minmax(240px, 1fr))). Cards are SELECTABLE (click fills the
 *     detail panel below) AND DRAGGABLE (drag one onto another to move money). Your
 *     MAIN account + the two AI SUB ACCOUNTS. Selection indicator = a FULL hairline-
 *     blue border + faint blue-wash fill (NEVER a left-edge bar — the locked AI-slop
 *     tell). Balances are blue Martian Mono; the AI cards carry the breathing dot.
 *   • DETAIL PANEL — the SELECTED account's OWN detail, in a wide panel below:
 *       main   → the currencies held (MainAccountView, editorial serif title)
 *       spend  → the AI Spending chat (SpendingChat, USDC only)
 *       invest → the AI Investing split-bar + per-tier steppers (InvestingStrategies)
 *   • CORNER LOG — the activity log as a persistent compact widget pinned
 *     bottom-right (always visible; expands on click). Not a main section.
 *
 * SAME CONTRACT: props `{ home, slots, selected, presence }`. App.tsx swaps the
 * component; nothing else (auth, WS, Enoki, loader, onboarding) changes.
 */
import { useMemo, type ReactNode } from 'react';
import type { HomeApi } from '../data/types';
import type { DrawerKey } from '../components/journal/AccountDrawer';
import { useTheme } from './theme';
import { SuizeWordmark } from './Wordmark';

/** The leaf-rendered content slots. */
export interface JournalSlots {
  /** the balance hero (always present). */
  balanceHero: ReactNode;
  /** the three account cards (selectable + draggable ledger). */
  accountLedger: ReactNode;
  /** MAIN's detail — currencies held + Add/Send/Convert. */
  mainView: ReactNode;
  /** AI Spending's detail — the chat (USDC). */
  spendingChat: ReactNode;
  /** AI Investing's detail — strategy toggles + sliders. */
  investingStrats: ReactNode;
  /** the persistent corner log widget. */
  cornerLog: ReactNode;
  /** drag ghost + move-money popup (the drag leaf portals these). */
  overlays?: ReactNode;
}

export interface JournalShellProps {
  /** the data hook result (useHome). */
  home: HomeApi;
  /** the leaf-rendered detail views + ledger + overlays. */
  slots: JournalSlots;
  /**
   * Which account card is selected — its detail fills the detail panel. The ledger
   * slot is pre-wired by JournalHome with the matching `onSelect`, so the shell only
   * needs to READ the selection to choose which detail body to render.
   */
  selected: DrawerKey;
  /** real account state: which AI sub-accounts are on + whether there is activity. */
  presence: JournalPresence;
}

/** Which sub-account details currently EXIST (the AI accounts being on). */
export interface JournalPresence {
  /** AI Spending on. */
  spending: boolean;
  /** AI Investing on. */
  investing: boolean;
  /** there is activity (the log has rows). */
  activity: boolean;
}

/** Format a USD number with cents — "11,200.00" (no leading $; the markup adds it). */
function usd(n: number): string {
  return n.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

// ────────────────────────────────────────────────────────────────────────────
// MASTHEAD — the v3 top bar. SUIZE wordmark + handle (mono) left; the grand total
// ("EVERYTHING TOGETHER") + the "ALL GOOD" health pill right.
// ────────────────────────────────────────────────────────────────────────────

export function Masthead({ home }: { home: HomeApi }) {
  const { toggle } = useTheme();
  const { state } = home;
  const display = state.handle || '…@suize';

  // Grand total = the user's own money + both caged accounts (the dashboard sum).
  const grand = state.totalUsd + state.spending.usd + state.investing.usd;
  const healthy = state.healthy;

  return (
    <header className="masthead">
      <div className="mh__left">
        <SuizeWordmark />
        <span className="mh__sep" aria-hidden="true" />
        <span className="mh__handle2">{display}</span>
      </div>
      <div className="mh__right">
        <div className="mh__grand">
          <span className="mh__grand-lab">Everything together</span>
          <span className="mh__grand-num">
            <span className="mh__grand-cur">$</span>
            {usd(grand)}
          </span>
        </div>
        <span
          className={`mh__health ${healthy ? 'is-ok' : 'is-warn'}`}
          title={healthy ? 'All good' : 'Needs a look'}
        >
          <span className="mh__health-dot" aria-hidden="true" />
          {healthy ? 'All good' : 'Needs a look'}
        </span>
        <button
          className="thememark"
          type="button"
          onClick={toggle}
          aria-label="Toggle theme"
        >
          <i />
        </button>
      </div>
    </header>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// The detail-panel header copy (eyebrow + sub-line) per selected account.
// ────────────────────────────────────────────────────────────────────────────

/** Per-account panel copy — the eyebrow + sub-line. */
const PANE_META: Record<DrawerKey, { eyebrow: string; sub: string }> = {
  main: { eyebrow: 'Your money', sub: 'Coins you hold' },
  spend: { eyebrow: 'Auto-pay', sub: 'Ask for anything' },
  invest: { eyebrow: 'Auto-invest', sub: 'Choose strategies' },
};

// ────────────────────────────────────────────────────────────────────────────
// JournalShell — the root.
// ────────────────────────────────────────────────────────────────────────────

export function JournalShell({
  home,
  slots,
  selected,
  presence,
}: JournalShellProps) {
  // The body for the selected account. Spending/Investing show an honest "turned off"
  // line when that sub account is paused (presence false), rather than the live detail.
  const meta = PANE_META[selected];
  const detailBody = useMemo<ReactNode>(() => {
    if (selected === 'main') return slots.mainView;
    if (selected === 'spend') {
      return presence.spending ? slots.spendingChat : <PausedNote which="spending" />;
    }
    return presence.investing ? slots.investingStrats : <PausedNote which="investing" />;
  }, [selected, presence.spending, presence.investing, slots]);

  return (
    <div className="journal">
      {/* faint ambient wash */}
      <div className="amb" aria-hidden="true" />

      <Masthead home={home} />

      <main className="page">
        {/* ── ACCOUNT GRID — the triptych: Main + the two AI cards. Each card
            selects (fills the panel below) + drags (move money). */}
        <section id="s-accounts" aria-label="Your accounts">
          {slots.accountLedger}
        </section>

        {/* ── DETAIL PANEL — the SELECTED account's own detail, wide + below ── */}
        <section className="panel" id="s-detail" aria-live="polite">
          <div className="pane">
            <div className="pane__head">
              <div className="eyebrow" style={{ marginBottom: 0 }}>
                <b>{meta.eyebrow}</b>
              </div>
              <span className="pane__sub">{meta.sub}</span>
            </div>
            <div className="rule" />
            {/* key on `selected` so the body re-mounts + plays its calm fade-in */}
            <div className="pane__body" key={selected}>
              {detailBody}
            </div>
          </div>
        </section>
      </main>

      {/* the persistent corner log widget (fixed bottom-right) */}
      {slots.cornerLog}

      {/* drag ghost + move-money popup (the drag leaf portals these here) */}
      {slots.overlays}
    </div>
  );
}

/** A calm "paused" line for a paused sub account's detail. */
function PausedNote({ which }: { which: 'spending' | 'investing' }) {
  return (
    <p className="empty">
      AI {which === 'spending' ? 'Spending' : 'Investing'} is paused.
      <span className="small">
        Turn it back on from its card to{' '}
        {which === 'spending' ? 'start a chat' : 'choose strategies'}.
      </span>
    </p>
  );
}

export default JournalShell;
