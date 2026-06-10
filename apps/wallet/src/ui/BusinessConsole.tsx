/**
 * REDESIGN LAB — BUSINESS · CONSOLE. The intuitive, sectioned merchant view:
 * a VERTICAL tab rail (Overview / Revenue / Subscriptions), each section with
 * its own accent; MRR/ARR shown plainly; and the full wallet verb set on the
 * settled balance — Add funds / Send / Transfer (the same sheets as the
 * consumer wallet). The analytics chat stays available behind the dock.
 */
import { useState } from 'react';
import {
  Activity as ActivityIcon,
  ArrowUpRight,
  Plus,
  RefreshCw,
  Send as SendIcon,
  Wallet as WalletIcon,
  X,
  ICON_STROKE,
} from '../system';
import { BUSINESS, CONSOLE, money } from './copy';
import { Spark } from './bits';
import { AssistantDock } from './Assistant';
import { BizChat } from './BizChat';
import { Ledger } from './BusinessView';
import { AddFundsSheet, MoveSheet, SendSheet } from './sheets';

type Tab = (typeof CONSOLE.tabs)[number]['id'];
type SheetKind = 'addFunds' | 'send' | 'transfer' | null;

const TAB_ICONS = {
  overview: WalletIcon,
  revenue: ActivityIcon,
  subscriptions: RefreshCw,
} as const;

export function BusinessConsole() {
  const [tab, setTab] = useState<Tab>('overview');
  const [sheet, setSheet] = useState<SheetKind>(null);
  const [dockOpen, setDockOpen] = useState(false);
  const [available, setAvailable] = useState<number>(CONSOLE.balance.amount);

  const maxMonth = Math.max(...CONSOLE.months.bars);

  return (
    <div className="rd-biz rd-console">
      <header className="rd-mast">
        <div className="rd-mast__left">
          <span className="rd-wordmark" aria-label="Suize">
            SUIZE
          </span>
          <span className="rd-mast__sep" aria-hidden="true" />
          <span className="rd-label">{BUSINESS.eyebrow}</span>
        </div>
        <div className="rd-mast__right">
          <span className="rd-mast__handle rd-handle">{BUSINESS.merchant}</span>
        </div>
      </header>

      <div className="rd-console__grid">
        {/* ── the vertical tab rail ── */}
        <nav className="rd-console__rail" aria-label="Sections">
          {CONSOLE.tabs.map((t) => {
            const Icon = TAB_ICONS[t.id];
            return (
              <button
                key={t.id}
                type="button"
                className={`rd-console__tab rd-console__tab--${t.id}${tab === t.id ? ' is-active' : ''}`}
                onClick={() => setTab(t.id)}
              >
                <span className="rd-console__tabicon" aria-hidden="true">
                  <Icon size={14} strokeWidth={ICON_STROKE} />
                </span>
                {t.label}
              </button>
            );
          })}
        </nav>

        {/* ── the section content ── */}
        <div className="rd-console__main">
          {tab === 'overview' ? (
            <>
              {/* the settled balance + the wallet verbs */}
              <article className="rd-pot rd-pot--hot rd-console__balance">
                <span className="rd-label">{CONSOLE.balance.label}</span>
                <span className="rd-pot__num rd-pot__num--grad">{money(available)}</span>
                <span className="rd-pot__note">{CONSOLE.balance.note}</span>
                <div className="rd-pot__acts">
                  <button type="button" className="rd-btn rd-btn--accent" onClick={() => setSheet('addFunds')}>
                    <Plus size={13} strokeWidth={ICON_STROKE} aria-hidden />
                    {CONSOLE.balance.actions[0]}
                  </button>
                  <button type="button" className="rd-btn" onClick={() => setSheet('send')}>
                    <SendIcon size={13} strokeWidth={ICON_STROKE} aria-hidden />
                    {CONSOLE.balance.actions[1]}
                  </button>
                  <button type="button" className="rd-btn" onClick={() => setSheet('transfer')}>
                    <ArrowUpRight size={13} strokeWidth={ICON_STROKE} aria-hidden />
                    {CONSOLE.balance.actions[2]}
                  </button>
                </div>
              </article>

              {/* this month + MRR/ARR at a glance */}
              <div className="rd-console__statgrid">
                <div className="rd-console__stat">
                  <span className="rd-label">
                    <Spark /> {BUSINESS.monthLabel}
                  </span>
                  <b className="rd-console__statnum rd-pot__num--grad">{money(BUSINESS.monthTotal)}</b>
                  <span className="rd-biz__delta">{BUSINESS.delta}</span>
                </div>
                <div className="rd-console__stat">
                  <span className="rd-label">{CONSOLE.mrr.k}</span>
                  <b className="rd-console__statnum">{CONSOLE.mrr.v}</b>
                </div>
                <div className="rd-console__stat">
                  <span className="rd-label">{CONSOLE.arr.k}</span>
                  <b className="rd-console__statnum">{CONSOLE.arr.v}</b>
                </div>
              </div>

              <section className="rd-secard rd-secard--act">
                <div className="rd-secard__head">
                  <span className="rd-secard__icon" aria-hidden="true">
                    <ActivityIcon size={14} strokeWidth={ICON_STROKE} />
                  </span>
                  <h3 className="rd-secard__title">{BUSINESS.ledgerTitle}</h3>
                  <span className="rd-sec__meta">{BUSINESS.ledgerMeta}</span>
                </div>
                <Ledger />
              </section>
            </>
          ) : null}

          {tab === 'revenue' ? (
            <>
              <section className="rd-secard rd-secard--rev">
                <div className="rd-secard__head">
                  <span className="rd-secard__icon" aria-hidden="true">
                    <ActivityIcon size={14} strokeWidth={ICON_STROKE} />
                  </span>
                  <h3 className="rd-secard__title">{CONSOLE.months.label}</h3>
                  <span className="rd-sec__meta">{BUSINESS.delta}</span>
                </div>
                <div className="rd-months">
                  {CONSOLE.months.bars.map((b, i) => (
                    <div className="rd-months__col" key={i}>
                      <span className="rd-months__val">{b}k</span>
                      <span
                        className="rd-bars__bar"
                        style={{ height: Math.round((b / maxMonth) * 150), animationDelay: `${i * 40}ms` }}
                      />
                      <span className="rd-bars__day">{CONSOLE.months.labels[i]}</span>
                    </div>
                  ))}
                </div>
              </section>

              <div className="rd-console__statgrid">
                <div className="rd-console__stat">
                  <span className="rd-label">{BUSINESS.split[0].label}</span>
                  <b className="rd-console__statnum">{money(BUSINESS.split[0].amount)}</b>
                </div>
                <div className="rd-console__stat">
                  <span className="rd-label">{BUSINESS.split[1].label}</span>
                  <b className="rd-console__statnum rd-pot__num--grad">{money(BUSINESS.split[1].amount)}</b>
                </div>
              </div>
            </>
          ) : null}

          {tab === 'subscriptions' ? (
            <>
              <div className="rd-console__statgrid">
                <div className="rd-console__stat">
                  <span className="rd-label">{CONSOLE.mrr.k}</span>
                  <b className="rd-console__statnum rd-pot__num--grad">{CONSOLE.mrr.v}</b>
                </div>
                <div className="rd-console__stat">
                  <span className="rd-label">{CONSOLE.arr.k}</span>
                  <b className="rd-console__statnum">{CONSOLE.arr.v}</b>
                </div>
                <div className="rd-console__stat">
                  <span className="rd-label">{BUSINESS.stats[0].k}</span>
                  <b className="rd-console__statnum">{BUSINESS.stats[0].v}</b>
                </div>
              </div>

              <section className="rd-secard rd-secard--subs">
                <div className="rd-secard__head">
                  <span className="rd-secard__icon" aria-hidden="true">
                    <RefreshCw size={14} strokeWidth={ICON_STROKE} />
                  </span>
                  <h3 className="rd-secard__title">Renewing this week</h3>
                  <span className="rd-sec__meta">{CONSOLE.renewalsHead}</span>
                </div>
                <div>
                  {CONSOLE.renewals.map((r) => (
                    <div className="rd-line rd-line--roomy" key={r.payer}>
                      <span className="rd-mono-chip" aria-hidden="true">
                        {r.plan[0]}
                      </span>
                      <span className="rd-line__body">
                        <span className="rd-money" style={{ fontSize: 11.5 }}>
                          {r.payer}
                        </span>
                        {' · '}
                        {r.plan}
                      </span>
                      <span className="rd-line__when">{r.when}</span>
                      <span className="rd-line__dots" />
                      <span className="rd-line__amt rd-line__amt--sub">{money(r.amount)}/mo</span>
                    </div>
                  ))}
                </div>
              </section>
            </>
          ) : null}
        </div>
      </div>

      {/* the analytics chat — still one tap away */}
      <AssistantDock open={dockOpen} onToggle={() => setDockOpen(true)} label={BUSINESS.chatTitle}>
        <button
          type="button"
          className="rd-dockpanel__close"
          aria-label="Close assistant"
          onClick={() => setDockOpen(false)}
        >
          <X size={15} strokeWidth={ICON_STROKE} aria-hidden />
        </button>
        <BizChat className="rd-bizchat rd-glass rd-bizchat--dock" />
      </AssistantDock>

      {/* ── THE MONEY SHEETS (the same verbs as the consumer wallet) ── */}
      {sheet === 'addFunds' ? <AddFundsSheet handle={BUSINESS.merchant} onClose={() => setSheet(null)} /> : null}
      {sheet === 'send' ? (
        <SendSheet
          available={available}
          onSend={(amt) => setAvailable((v) => Math.max(0, v - amt))}
          onClose={() => setSheet(null)}
        />
      ) : null}
      {sheet === 'transfer' ? (
        <MoveSheet
          kind="transfer"
          available={available}
          onMove={(amt) => setAvailable((v) => Math.max(0, v - amt))}
          onClose={() => setSheet(null)}
        />
      ) : null}
    </div>
  );
}
