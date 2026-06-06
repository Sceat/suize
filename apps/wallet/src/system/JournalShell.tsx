/**
 * JournalShell — the post-onboarding shell, THE JOURNAL.
 *
 * "A journal with almost nothing." Structure comes from SPACE + hairlines +
 * editorial type. The CSS lives in src/system/tokens-journal.css (scoped under
 * `.journal`, this root's class).
 *
 * ── LAYOUT (the per-account detail model) ──────────────────────────────────────
 * A no-scroll two-column frame (desktop) / natural flow (mobile):
 *   • LEFT RAIL  — the grand-total hero ON TOP, then the three account cards below
 *     (whole-then-parts: four big numbers top-to-bottom). Cards are SELECTABLE
 *     (click fills the right pane) AND DRAGGABLE (drag one onto another to move
 *     money). Your MAIN account + the two AI SUB ACCOUNTS. The selected card carries
 *     a 2px accent left-edge bar.
 *   • RIGHT PANE — the SELECTED account's OWN detail:
 *       main   → the currencies held + Add money / Send / Convert
 *       spend  → the AI Spending chat (USDC only)
 *       invest → the AI Investing split-bar + per-tier steppers
 *   • CORNER LOG — the activity log as a persistent compact widget pinned
 *     bottom-right (always visible; expands on click). No longer a main section.
 *
 * SAME CONTRACT: props `{ home, slots, … }`. App.tsx swaps the component; nothing
 * else (auth, WS, Enoki, loader, onboarding) changes.
 *
 * ── WHAT THIS FILE OWNS ─────────────────────────────────────────────────────────
 *   • The `.journal` root + `.amb` wash.
 *   • The MASTHEAD (the real logo mark + wordmark + "the journal of @handle" + a quiet date + thememark).
 *   • The no-scroll two-column `.page` grid (rail-left / rail-right).
 *   • The SELECTION engine: which account card is selected → which detail renders.
 *   • The FOOTER + the pinned CORNER LOG slot.
 */
import { useMemo, type ReactNode } from 'react';
import type { HomeApi } from '../data/types';
import type { DrawerKey } from '../components/journal/AccountDrawer';
import { useTheme } from './theme';
import { Wordmark } from './Wordmark';

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
   * Which account card is selected — its detail fills the right pane. The ledger
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

// ────────────────────────────────────────────────────────────────────────────
// MASTHEAD — a quiet journal masthead (wordmark + handle + a quiet date + thememark).
// NO issue number (the fake "Issue 214" is gone). A quiet date is fine.
// ────────────────────────────────────────────────────────────────────────────

/** A quiet date line — today, journal-style ("Mon 3 Jun"). No issue number. */
function todayLine(): string {
  return new Date().toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

export function Masthead({ handle }: { handle: string }) {
  const { theme, toggle } = useTheme();
  const display = handle || '…@suize';
  return (
    <header className="masthead">
      <div className="mh__left">
        {/* the real Suize mark — flat logo masked to var(--accent): blue in
            light, gold in dark (accent spent once, per-theme signature). */}
        <span className="mh__mark" aria-hidden="true" />
        <Wordmark size="clamp(1.5rem, 3vw, 2.1rem)" />
        <span className="mh__handle">
          the journal of <b>{display}</b>
        </span>
      </div>
      <div className="mh__right">
        <span className="mh__issue">{todayLine()}</span>
        <button
          className="thememark"
          type="button"
          onClick={toggle}
          aria-label="Toggle theme"
        >
          <i />
          <span>{theme === 'dark' ? 'Light' : 'Dark'}</span>
        </button>
      </div>
    </header>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// The detail-pane header (eyebrow-tightened: no "01 ·"/"The", just the name).
// ────────────────────────────────────────────────────────────────────────────

/** Per-account pane copy — the tightened eyebrow + sub-line + capability. */
const PANE_META: Record<DrawerKey, { eyebrow: string; name: string; sub: string }> = {
  main: { eyebrow: 'Your currencies', name: 'Main', sub: 'Coins you hold' },
  spend: { eyebrow: 'Spending', name: 'AI Spending', sub: 'Ask for anything' },
  invest: { eyebrow: 'Investing', name: 'AI Investing', sub: 'Choose strategies' },
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
  const { state } = home;

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

      <Masthead handle={state.handle} />

      <main className="page">
        {/* ── LEFT RAIL — the grand total, THEN the three account cards ──
            Whole-then-parts: one big neutral-ink number on top, the triptych of
            cards below. A monkey scans four big numbers top-to-bottom. */}
        <div className="rail-left">
          {/* Grand total — "ALL YOUR MONEY, TODAY" (the hero leaf owns the label +
              the big neutral number; this eyebrow stays a quiet mono kicker). */}
          <section className="jsec in" id="s-balance">
            <div className="eyebrow">
              <b>All your money, today</b>
            </div>
            {slots.balanceHero}
          </section>

          {/* Your accounts — the triptych: Main + the two AI cards. */}
          <section className="jsec in" id="s-accounts">
            <div className="eyebrow">
              <b>Your accounts</b>
            </div>
            <p className="lede">
              Your money lives in three accounts. Drag one card onto another to move
              money; tap a card to open it.
            </p>
            <div className="rule" />
            {slots.accountLedger}
            <p className="note" style={{ marginTop: 20 }}>
              Each AI account has its own money and its own switch. Paused means
              stopped — nothing runs until you turn it back on.{' '}
              <span className="cy">Your main account is never touched.</span>
            </p>
          </section>
        </div>

        {/* ── RIGHT PANE — the SELECTED account's own detail ── */}
        <div className="rail-right">
          <section className="pane" id="s-detail" aria-live="polite">
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
          </section>
        </div>
      </main>

      {/* the persistent corner log widget (fixed bottom-right) */}
      {slots.cornerLog}

      <footer className="foot">
        <span>
          Su<span className="grad">i</span>ze
        </span>
      </footer>

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
