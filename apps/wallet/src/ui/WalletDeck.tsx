/**
 * REDESIGN LAB — WALLET · DECK (the chosen direction, refined 2026-06-10 R2):
 *
 *   · BREATHING ROOM — looser grid, padded section cards.
 *   · DISTINCT SECTIONS — Subscriptions and Activity are separate tinted cards
 *     (violet vs blue accents, icon chips, monograms / direction glyphs) so the
 *     two never read as one list.
 *   · THE WALLET VERBS — Your money: Add funds (QR / zkSend / exact amount /
 *     coming-soon rails) + Send; Sub-account: Top up + Withdraw (moves against
 *     the main account, live-reconciled).
 *   · MORE COLOR — the sub-account number takes the gradient; amounts are blue
 *     mono; detected @names are accent-marked everywhere.
 *   · THE ASSISTANT — right column, manually RESIZABLE (drag the divider),
 *     top-down conversation history.
 */
import { useRef, useState } from 'react';
import { Activity as ActivityIcon, ArrowUpRight, Plus, RefreshCw, Send as SendIcon, ICON_STROKE } from '../system';
import { WALLET, money } from './copy';
import { AssistantPanel } from './Assistant';
import { ActivityList, CustodyNote, SubsList, useWalletMoney } from './money';
import { AddFundsSheet, MoveSheet, SendSheet } from './sheets';

type SheetKind = 'addFunds' | 'send' | 'topUp' | 'withdraw' | null;

const ASIDE_MIN = 320;
const ASIDE_MAX = 560;

export function WalletDeck() {
  const [agentOn, setAgentOn] = useState(true);
  const m = useWalletMoney();
  const [sheet, setSheet] = useState<SheetKind>(null);

  // the assistant column width — manually resizable via the divider
  const [asideW, setAsideW] = useState(384);
  const dragRef = useRef<{ x: number; w: number } | null>(null);

  function onDragStart(e: React.PointerEvent) {
    dragRef.current = { x: e.clientX, w: asideW };
    const move = (ev: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      setAsideW(Math.min(ASIDE_MAX, Math.max(ASIDE_MIN, d.w + (d.x - ev.clientX))));
    };
    const up = () => {
      dragRef.current = null;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  return (
    <div className="rd-deck">
      <header className="rd-mast">
        <div className="rd-mast__left">
          <span className="rd-wordmark" aria-label="Suize">
            SUIZE
          </span>
          <span className="rd-mast__sep" aria-hidden="true" />
          <span className="rd-mast__handle rd-handle">{WALLET.handle}</span>
        </div>
        <div className="rd-mast__right">
          <div className="rd-mast__bal">
            <span className="rd-mast__ballabel">{WALLET.balanceLabel}</span>
            <span className={`rd-mast__balnum${m.paidFlash ? ' is-paid' : ''}`}>{money(m.balance)}</span>
          </div>
        </div>
      </header>

      <div className="rd-deck__grid" style={{ gridTemplateColumns: `minmax(0, 1fr) 10px ${asideW}px` }}>
        {/* ── THE MONEY — first, always ── */}
        <div className="rd-deck__main">
          <div className="rd-deck__pots">
            {/* YOUR MONEY — calm ink + the classic wallet verbs */}
            <article className="rd-pot">
              <span className="rd-label">{WALLET.books.your.label}</span>
              <span className="rd-pot__num">{money(m.yourMoney)}</span>
              <span className="rd-pot__note">{WALLET.books.your.note}</span>
              <div className="rd-pot__acts">
                <button type="button" className="rd-btn rd-btn--accent" onClick={() => setSheet('addFunds')}>
                  <Plus size={13} strokeWidth={ICON_STROKE} aria-hidden />
                  {WALLET.books.your.actions[0]}
                </button>
                <button type="button" className="rd-btn" onClick={() => setSheet('send')}>
                  <SendIcon size={13} strokeWidth={ICON_STROKE} aria-hidden />
                  {WALLET.books.your.actions[1]}
                </button>
              </div>
            </article>
            {/* SUB-ACCOUNT — the hot money: gradient number + the pot moves */}
            <article className="rd-pot rd-pot--hot">
              <span className="rd-label">{WALLET.books.agent.label}</span>
              <span className={`rd-pot__num rd-pot__num--grad${m.paidFlash ? ' rd-debit-flash' : ''}`}>
                {money(m.balance)}
              </span>
              <span className="rd-pot__note">{WALLET.books.agent.note}</span>
              <div className="rd-pot__acts">
                <button type="button" className="rd-btn rd-btn--accent" onClick={() => setSheet('topUp')}>
                  <Plus size={13} strokeWidth={ICON_STROKE} aria-hidden />
                  {WALLET.books.agent.actions[0]}
                </button>
                <button type="button" className="rd-btn" onClick={() => setSheet('withdraw')}>
                  <ArrowUpRight size={13} strokeWidth={ICON_STROKE} aria-hidden />
                  {WALLET.books.agent.actions[1]}
                </button>
              </div>
            </article>
          </div>

          {/* SUBSCRIPTIONS — its own violet-tinted card */}
          <section className="rd-secard rd-secard--subs">
            <div className="rd-secard__head">
              <span className="rd-secard__icon" aria-hidden="true">
                <RefreshCw size={14} strokeWidth={ICON_STROKE} />
              </span>
              <h3 className="rd-secard__title">{WALLET.books.subsTitle}</h3>
              <span className="rd-sec__meta">{WALLET.books.subsMeta}</span>
            </div>
            <SubsList />
          </section>

          {/* ACTIVITY — the blue ledger card */}
          <section className="rd-secard rd-secard--act">
            <div className="rd-secard__head">
              <span className="rd-secard__icon" aria-hidden="true">
                <ActivityIcon size={14} strokeWidth={ICON_STROKE} />
              </span>
              <h3 className="rd-secard__title">{WALLET.books.activityTitle}</h3>
              <span className="rd-sec__meta">{WALLET.books.activityMeta}</span>
            </div>
            <ActivityList booked={m.booked} />
          </section>

          <CustodyNote />
        </div>

        {/* the drag divider — the assistant is manually resizable */}
        <div
          className="rd-deck__resizer"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize assistant"
          onPointerDown={onDragStart}
        />

        {/* ── THE ASSISTANT — beside the money, never above it ── */}
        <aside className="rd-deck__aside">
          <AssistantPanel agentOn={agentOn} onToggleAgent={() => setAgentOn((v) => !v)} onBooked={m.onBooked} />
        </aside>
      </div>

      {/* ── THE MONEY SHEETS ── */}
      {sheet === 'addFunds' ? <AddFundsSheet handle={WALLET.handle} onClose={() => setSheet(null)} /> : null}
      {sheet === 'send' ? (
        <SendSheet available={m.yourMoney} onSend={m.send} onClose={() => setSheet(null)} />
      ) : null}
      {sheet === 'topUp' ? (
        <MoveSheet kind="topUp" available={m.yourMoney} onMove={m.topUp} onClose={() => setSheet(null)} />
      ) : null}
      {sheet === 'withdraw' ? (
        <MoveSheet kind="withdraw" available={m.balance} onMove={m.withdraw} onClose={() => setSheet(null)} />
      ) : null}
    </div>
  );
}
