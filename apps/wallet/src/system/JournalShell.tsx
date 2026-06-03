/**
 * JournalShell — the post-onboarding shell, THE JOURNAL.
 *
 * "A journal with almost nothing." Structure comes from SPACE + hairlines +
 * editorial type. The CSS lives in src/system/tokens-journal.css (scoped under
 * `.journal`, this root's class).
 *
 * ── LAYOUT (the per-account detail model) ──────────────────────────────────────
 * A no-scroll two-column frame (desktop) / natural flow (mobile):
 *   • LEFT RAIL  — the balance hero + the three account cards (always visible).
 *     Cards are SELECTABLE (click fills the right pane) AND DRAGGABLE (drag one onto
 *     another to move money). Your MAIN account + the two AI SUB ACCOUNTS.
 *   • RIGHT PANE — the SELECTED account's OWN detail:
 *       main   → the currencies held + Add funds / Send / Convert
 *       spend  → the AI Spending chat (USDC only)
 *       invest → the AI Investing strategy toggles + percent sliders
 *   • CORNER LOG — the activity log as a persistent compact widget pinned
 *     bottom-right (always visible; expands on click). No longer a main section.
 *
 * SAME CONTRACT: props `{ home, slots, … }`. App.tsx swaps the component; nothing
 * else (auth, WS, Enoki, loader, onboarding) changes.
 *
 * ── WHAT THIS FILE OWNS ─────────────────────────────────────────────────────────
 *   • The `.journal` root + `.amb` wash + the inline `#mark` gradient symbol.
 *   • The MASTHEAD (wordmark + "the journal of @handle" + a quiet date + thememark).
 *   • The STATE RIBBON (Fresh / In-use demo switch — drives the demo mode).
 *   • The no-scroll two-column `.page` grid (rail-left / rail-right).
 *   • The SELECTION engine: which account card is selected → which detail renders.
 *   • The FOOTER + the pinned CORNER LOG slot.
 */
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import type { HomeApi } from '../data/types';
import type { DrawerKey } from '../components/journal/AccountDrawer';
import { useTheme } from './theme';

// ── demo mode (the ribbon's Fresh / In-use) ──
export type JournalDemoMode = 'fresh' | 'used';

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
  /** presence overrides for the Fresh/In-use ribbon (drives sub-account availability). */
  presence: JournalPresence;
  /** notified when the ribbon flips Fresh/In-use. */
  onDemoChange?: (mode: JournalDemoMode) => void;
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
        <svg width="18" height="21" aria-hidden="true">
          <use href="#mark" />
        </svg>
        <span className="mh__word">
          Su<span className="grad">i</span>ze
        </span>
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
// STATE RIBBON — the Fresh / In-use demonstration switch (a dev/demo harness).
// ────────────────────────────────────────────────────────────────────────────

const RIBBON_NOTE: Record<JournalDemoMode, string> = {
  fresh:
    'A fresh journal: only the balance + the three accounts. Everything else is simply not here yet.',
  used: 'In use: Spending opened a chat, Investing chose strategies, the log filled in. The page formed itself.',
};

export function StateRibbon({
  mode,
  onChange,
}: {
  mode: JournalDemoMode;
  onChange: (m: JournalDemoMode) => void;
}) {
  return (
    <div className="ribbon">
      <span className="ribbon__lab">The page forms as it fills</span>
      <div className="ribbon__seg" role="tablist" aria-label="Journal state">
        <button
          className="ribbon__opt"
          type="button"
          role="tab"
          aria-pressed={mode === 'fresh'}
          aria-selected={mode === 'fresh'}
          onClick={() => onChange('fresh')}
        >
          Fresh
        </button>
        <button
          className="ribbon__opt"
          type="button"
          role="tab"
          aria-pressed={mode === 'used'}
          aria-selected={mode === 'used'}
          onClick={() => onChange('used')}
        >
          In use
        </button>
      </div>
      <span className="ribbon__note">{RIBBON_NOTE[mode]}</span>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// The detail-pane header (eyebrow-tightened: no "01 ·"/"The", just the name).
// ────────────────────────────────────────────────────────────────────────────

/** Per-account pane copy — the tightened eyebrow + sub-line + capability. */
const PANE_META: Record<DrawerKey, { eyebrow: string; name: string; sub: string }> = {
  main: { eyebrow: 'Your money', name: 'Main', sub: 'Coins you hold' },
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
  onDemoChange,
}: JournalShellProps) {
  const [demoMode, setDemoMode] = useState<JournalDemoMode>('used');
  const { state } = home;

  const onRibbon = useCallback(
    (m: JournalDemoMode) => {
      setDemoMode(m);
      onDemoChange?.(m);
    },
    [onDemoChange],
  );

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

      {/* the gradient mark symbol the masthead references via <use href="#mark"> */}
      <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
        <defs>
          <linearGradient id="suizeGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="var(--g1)" />
            <stop offset=".5" stopColor="var(--g2)" />
            <stop offset="1" stopColor="var(--g3)" />
          </linearGradient>
          <symbol id="mark" viewBox="0 0 40 46">
            <path
              d="M20 2.5C20 2.5 5.5 19 5.5 30.5 5.5 38.8 12 44 20 44s14.5-5.2 14.5-13.5C34.5 19 20 2.5 20 2.5Z"
              fill="url(#suizeGrad)"
            />
            <path
              d="M8.5 29.5h23"
              stroke="var(--paper)"
              strokeOpacity=".85"
              strokeWidth="2"
              strokeLinecap="round"
              fill="none"
            />
            <circle cx="20" cy="29.5" r="2.6" fill="var(--paper)" fillOpacity=".95" />
          </symbol>
        </defs>
      </svg>

      <Masthead handle={state.handle} />
      <StateRibbon mode={demoMode} onChange={onRibbon} />

      <main className="page">
        {/* ── LEFT RAIL — balance + the three account cards (always visible) ── */}
        <div className="rail-left">
          {/* Balance (eyebrow tightened: "Balance", no "01 · The") */}
          <section className="jsec in" id="s-balance">
            <div className="eyebrow">
              <b>Balance</b>
            </div>
            {slots.balanceHero}
          </section>

          {/* Accounts (eyebrow tightened: "Accounts") */}
          <section className="jsec in" id="s-accounts">
            <div className="eyebrow">
              <b>Accounts</b>
            </div>
            <p className="lede">
              Your money, across three accounts. Drag one card onto another to move
              funds; click a card to open it.
            </p>
            <div className="rule" />
            {slots.accountLedger}
            <p className="note" style={{ marginTop: 20 }}>
              Each AI sub account has its own money and its own on/off. Off means
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

/** A calm "turned off" line for a paused sub account's detail. */
function PausedNote({ which }: { which: 'spending' | 'investing' }) {
  return (
    <p className="empty">
      AI {which === 'spending' ? 'Spending' : 'Investing'} is off.
      <span className="small">
        Turn it back on from its card to{' '}
        {which === 'spending' ? 'start a chat' : 'choose strategies'}.
      </span>
    </p>
  );
}

export default JournalShell;
