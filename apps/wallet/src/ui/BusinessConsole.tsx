/**
 * THE BUSINESS FACE — production console: a vertical tab rail (Overview /
 * Revenue / Subscriptions), the settled balance with the wallet verbs, MRR/ARR,
 * the charges ledger (the fee printed on the receipt = the trust proof), and
 * the analytics chat behind the dock.
 *
 * HONEST BY CONSTRUCTION: production never fabricates revenue. REAL today: the
 * settled balance is your actual wallet USDC, Add funds shares your real handle,
 * Send moves real money (`sendWallet`), and the CHARGES LEDGER is the on-chain
 * truth — every inbound payment to this address, a rail charge (`Payment`, the 2%
 * fee output present) split from a plain transfer (`Received`), newest first, each
 * row checkable on-chain. MRR/ARR + the revenue chart are still real zeros + calm
 * empty states. The DEV `demo` seam paints the full sample book.
 */
import { useEffect, useMemo, useState } from 'react';
import { useSuiClient } from '@mysten/dapp-kit';
import { suizeSubs, type SubEvent } from '@suize/pay/subs';
import { NETWORK, SUIVISION_TX } from '../lib/env';
import {
  Activity as ActivityIcon,
  ArrowLeftRight,
  Moon,
  Plus,
  RefreshCw,
  Send as SendIcon,
  Sun,
  Wallet as WalletIcon,
  ICON_STROKE,
} from '../system';
import { useTheme } from '../system/theme';
import { useAccount } from '../data/useAccount';
import { resolveRecipient } from '../data/suins';
import type { SuiClient } from '../data/suins';
import { BUSINESS, CONSOLE, money } from './copy';
import { ActivityList, exactWhen, fullWhen, type LedgerRow } from './money';
import { Spark } from './bits';
import { BizChat } from './BizChat';
import { AddFundsSheet, MoveSheet, SendSheet } from './sheets';
import { IdentityMenu } from './Identity';

type Tab = (typeof CONSOLE.tabs)[number]['id'];
type SheetKind = 'addFunds' | 'send' | 'transfer' | null;

const TAB_ICONS = {
  overview: WalletIcon,
  revenue: ActivityIcon,
  subscriptions: RefreshCw,
} as const;

const USDC_SCALE = 1_000_000n;
const toRaw = (ui: number): bigint => (BigInt(Math.round(ui * 100)) * USDC_SCALE) / 100n;

/**
 * DOGFOOD: the merchant-side subscription feed, read with the SAME `@suize/pay`
 * helper a real merchant would drop in (`suizeSubs(...).watch`). It polls the three
 * lifecycle events for THIS merchant address and keeps the most recent ones — so
 * the Business console subscriptions tab shows real on-chain renewals as they land,
 * with zero bespoke read code. Disabled in the DEV demo seam (sample data wins).
 */
function useMerchantSubs(merchantAddress: string, enabled: boolean): SubEvent[] {
  const [events, setEvents] = useState<SubEvent[]>([]);
  useEffect(() => {
    if (!enabled || !merchantAddress) return;
    const subs = suizeSubs({ merchant: merchantAddress, network: NETWORK });
    // Keep the newest 12, de-duped by tx digest, newest-first for the list.
    const watcher = subs.watch(
      (e) =>
        setEvents((prev) => {
          if (prev.some((x) => x.txDigest === e.txDigest && x.kind === e.kind)) return prev;
          return [e, ...prev].sort((a, b) => b.timestampMs - a.timestampMs).slice(0, 12);
        }),
      { pollMs: 30_000 },
    );
    return () => watcher.stop();
  }, [merchantAddress, enabled]);
  return events;
}

export interface BusinessConsoleProps {
  ownerAddress: string;
  handle: string;
  demo?: boolean;
  /** back to the personal wallet face */
  onBack: () => void;
  /** disconnects the zkLogin session (the identity menu's Sign out) */
  onSignOut?: () => void;
}

export function BusinessConsole({ ownerAddress, handle, demo = false, onBack, onSignOut }: BusinessConsoleProps) {
  const client = useSuiClient() as unknown as SuiClient;
  const api = useAccount(ownerAddress, handle);
  const { theme, toggle } = useTheme();
  const [tab, setTab] = useState<Tab>('overview');
  const [sheet, setSheet] = useState<SheetKind>(null);
  // demo: a local illustrative settled balance; production: the REAL wallet USDC
  const [demoAvailable, setDemoAvailable] = useState<number>(CONSOLE.balance.amount);
  const available = demo ? demoAvailable : api.state.wallet.ui;
  const merchant = demo ? BUSINESS.merchant : handle || '…@suize';

  const maxMonth = Math.max(...CONSOLE.months.bars);

  // the REAL charges ledger — ONLY actual x402 pay actions (kind 'charged': an inbound
  // payment that carried the Suize fee output, i.e. "every fee on the receipt"). Plain
  // transfers in — top-ups, agent withdrawals, random sends — are kind 'received' and are
  // NOT charges, so they're excluded. Newest first, each row checkable on-chain.
  const charges = useMemo<LedgerRow[]>(() => {
    if (demo) return [];
    return api.state.activity
      .filter((a) => a.kind === 'charged')
      .map((a) => ({
        id: a.id,
        what: a.title,
        who: a.detail,
        when: exactWhen(a.ts),
        whenTitle: fullWhen(a.ts),
        amount: a.amountUi,
        verifyHref: a.pending ? undefined : SUIVISION_TX(a.txDigest),
        pending: a.pending,
      }));
  }, [demo, api.state.activity]);

  // this month's settled revenue = the sum of REAL charges (not top-ups/transfers) this month.
  const monthTotal = useMemo(() => {
    if (demo) return BUSINESS.monthTotal;
    const now = new Date();
    return api.state.activity
      .filter((a) => a.kind === 'charged' && a.amountUi != null && a.ts)
      .filter((a) => {
        const d = new Date(a.ts);
        return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
      })
      .reduce((sum, a) => sum + (a.amountUi ?? 0), 0);
  }, [demo, api.state.activity]);

  // REAL merchant-side subscription feed (dogfooded via @suize/pay's suizeSubs.watch).
  const merchantSubs = useMerchantSubs(ownerAddress, !demo);

  async function onSend(amt: number, to: string) {
    if (demo) {
      setDemoAvailable((v) => Math.max(0, v - amt));
      return;
    }
    const resolved = await resolveRecipient(to, client);
    if (!resolved.address) throw new Error(`Could not find ${to} — check the name and try again.`);
    await api.sendWallet({ amountRaw: toRaw(amt), to: resolved.address });
  }

  const stats = useMemo(
    () =>
      demo
        ? { mrr: CONSOLE.mrr.v, arr: CONSOLE.arr.v, subs: BUSINESS.stats[0].v }
        : { mrr: '$0.00', arr: '$0.00', subs: '0' },
    [demo],
  );

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
          <button
            type="button"
            className="rd-thememark"
            onClick={toggle}
            aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          >
            {theme === 'dark' ? (
              <Sun size={15} strokeWidth={ICON_STROKE} aria-hidden />
            ) : (
              <Moon size={15} strokeWidth={ICON_STROKE} aria-hidden />
            )}
          </button>
          <button type="button" className="rd-btn" onClick={onBack}>
            <WalletIcon size={13} strokeWidth={ICON_STROKE} aria-hidden />
            Personal
          </button>
          {onSignOut ? (
            <IdentityMenu handle={merchant} address={ownerAddress} onSignOut={onSignOut} />
          ) : (
            <span className="rd-mast__handle rd-handle">{merchant}</span>
          )}
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
              {/* the settled balance + the wallet verbs (REAL: your wallet USDC) */}
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
                  {demo ? (
                    <button type="button" className="rd-btn" onClick={() => setSheet('transfer')}>
                      <ArrowLeftRight size={13} strokeWidth={ICON_STROKE} aria-hidden />
                      {CONSOLE.balance.actions[2]}
                    </button>
                  ) : null}
                </div>
              </article>

              {/* this month + MRR/ARR at a glance */}
              <div className="rd-console__statgrid">
                <div className="rd-console__stat">
                  <span className="rd-label">
                    <Spark /> {BUSINESS.monthLabel}
                  </span>
                  <b className={`rd-console__statnum${demo ? ' rd-pot__num--grad' : ''}`}>{money(monthTotal)}</b>
                  {demo ? <span className="rd-biz__delta">{BUSINESS.delta}</span> : null}
                </div>
                <div className="rd-console__stat">
                  <span className="rd-label">{CONSOLE.mrr.k}</span>
                  <b className="rd-console__statnum">{stats.mrr}</b>
                </div>
                <div className="rd-console__stat">
                  <span className="rd-label">{CONSOLE.arr.k}</span>
                  <b className="rd-console__statnum">{stats.arr}</b>
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
                {demo ? <Ledger /> : <ActivityList rows={charges} empty={CONSOLE.emptyLedger} />}
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
                  {demo ? <span className="rd-sec__meta">{BUSINESS.delta}</span> : null}
                </div>
                {demo ? (
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
                ) : (
                  <p className="rd-empty-line">{CONSOLE.emptyRevenue}</p>
                )}
              </section>

              {demo ? (
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
              ) : null}
            </>
          ) : null}

          {tab === 'subscriptions' ? (
            <>
              <div className="rd-console__statgrid">
                <div className="rd-console__stat">
                  <span className="rd-label">{CONSOLE.mrr.k}</span>
                  <b className={`rd-console__statnum${demo ? ' rd-pot__num--grad' : ''}`}>{stats.mrr}</b>
                </div>
                <div className="rd-console__stat">
                  <span className="rd-label">{CONSOLE.arr.k}</span>
                  <b className="rd-console__statnum">{stats.arr}</b>
                </div>
                <div className="rd-console__stat">
                  <span className="rd-label">{BUSINESS.stats[0].k}</span>
                  <b className="rd-console__statnum">{stats.subs}</b>
                </div>
              </div>

              <section className="rd-secard rd-secard--subs">
                <div className="rd-secard__head">
                  <span className="rd-secard__icon" aria-hidden="true">
                    <RefreshCw size={14} strokeWidth={ICON_STROKE} />
                  </span>
                  <h3 className="rd-secard__title">Renewing this week</h3>
                  {demo ? <span className="rd-sec__meta">{CONSOLE.renewalsHead}</span> : null}
                </div>
                {demo ? (
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
                ) : merchantSubs.length > 0 ? (
                  <div>
                    {merchantSubs.map((e) => (
                      <div className="rd-line rd-line--roomy" key={`${e.txDigest}-${e.kind}`}>
                        <span className="rd-mono-chip" aria-hidden="true">
                          {e.kind === 'created' ? '+' : e.kind === 'cancelled' ? '×' : '↻'}
                        </span>
                        <span className="rd-line__body">
                          <span className="rd-money" style={{ fontSize: 11.5 }}>
                            {e.owner ? `${e.owner.slice(0, 6)}…${e.owner.slice(-4)}` : 'subscriber'}
                          </span>
                          {' · '}
                          {e.kind === 'created'
                            ? 'subscribed'
                            : e.kind === 'renewed'
                              ? 'renewed'
                              : 'cancelled'}
                        </span>
                        <span className="rd-line__dots" />
                        <a
                          className="rd-line__verify"
                          href={`https://${NETWORK === 'mainnet' ? '' : NETWORK + '.'}suivision.xyz/txblock/${e.txDigest}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {BUSINESS.verify} ↗
                        </a>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="rd-empty-line">{CONSOLE.emptyRenewals}</p>
                )}
              </section>
            </>
          ) : null}
        </div>

        {/* ── THE ANALYTICS CHAT — always there, a permanent column ── */}
        <aside className="rd-console__chat">
          <BizChat demo={demo} />
        </aside>
      </div>

      {/* ── THE MONEY SHEETS (the same verbs as the consumer wallet) ── */}
      {sheet === 'addFunds' ? (
        <AddFundsSheet handle={merchant} requestEnabled={demo} onClose={() => setSheet(null)} />
      ) : null}
      {sheet === 'send' ? (
        <SendSheet available={available} onSend={onSend} claimEnabled={demo} onClose={() => setSheet(null)} />
      ) : null}
      {sheet === 'transfer' && demo ? (
        <MoveSheet
          kind="transfer"
          available={available}
          onMove={(amt) => setDemoAvailable((v) => Math.max(0, v - amt))}
          onClose={() => setSheet(null)}
        />
      ) : null}
    </div>
  );
}

/** the charges ledger + the ONE opened receipt — the fee printed is the trust
 *  proof (demo data; the real merchant feed is the backend's next milestone) */
export function Ledger() {
  return (
    <div>
      {BUSINESS.ledger.map((row) => (
        <div key={`${row.payer}-${row.when}`}>
          <div className="rd-line">
            <span className="rd-line__body">
              <span className="rd-money rd-grad-num" style={{ fontSize: 11.5 }}>
                {row.payer}
              </span>
              {' · '}
              {row.memo}
            </span>
            <span className="rd-line__when">{row.when}</span>
            <span className="rd-line__dots" />
            <span className="rd-line__amt rd-line__amt--money">+{money(row.amount)}</span>
            <a className="rd-line__verify" href="#verify" onClick={(e) => e.preventDefault()}>
              {BUSINESS.verify} ↗
            </a>
          </div>
          {'open' in row && row.open ? (
            <div className="rd-receipt">
              <div className="rd-receipt__head">{BUSINESS.receipt.title}</div>
              <div className="rd-receipt__rows">
                {BUSINESS.receipt.rows.map((r) => (
                  <div className="rd-line" key={r.k}>
                    <span
                      className="rd-line__body"
                      style={'strong' in r && r.strong ? undefined : { fontWeight: 400, color: 'var(--rd-fg-2)' }}
                    >
                      {r.k}
                    </span>
                    <span className="rd-line__dots" />
                    <span className="rd-line__amt">{r.v}</span>
                  </div>
                ))}
              </div>
              <div className="rd-receipt__foot">{BUSINESS.receipt.foot}</div>
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}
