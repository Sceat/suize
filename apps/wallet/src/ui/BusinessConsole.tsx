/**
 * THE BUSINESS CONSOLE — production (owner-locked design 2026-06-16: "Obsidian").
 * The merchant operator face: a money-observation dashboard that inherits the personal
 * Deck's bones (3-column rail · money cards · agentic chat) and pushes them CORPORATE +
 * dark-luxe — graphite/obsidian brushed-metal Net-Revenue + MRR cards lit by one electric
 * accent, a smooth 12-month revenue area chart, the on-chain charges ledger, and the
 * business's AI analyst (the real BizChat) as the permanent right column.
 *
 * HONEST BY CONSTRUCTION: production never fabricates revenue. REAL today via the verified
 * `useAccount` + `@suize/pay` data layer: the settled balance is your actual wallet USDC,
 * the CHARGES ledger is the on-chain truth (only inbound x402 charges — the fee-bearing
 * `charged` kind — each row checkable on-chain), the standing-orders feed is the dogfooded
 * `suizeSubs.watch`, and the Business Profile is your real on-chain BusinessProfile (mint /
 * edit on the Profile screen, $0.10). MRR/ARR + the revenue chart show calm honest empty
 * states until the data exists. The DEV `?demo=1` seam paints the full sample book.
 *
 * NUMBER WALL: every on-chain amount here is real wallet/chain data or a shared constant —
 * never an LLM/tool argument. The ONE place a fee appears is the single expandable receipt
 * artifact (demo) — the trust proof; no fees anywhere else.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSignTransaction, useSuiClient } from '@mysten/dapp-kit';
import { suizeSubs, type SubEvent } from '@suize/pay/subs';
import { NETWORK, SUIVISION_TX } from '../lib/env';
import {
  ICON_STROKE,
  Activity,
  Send,
  ArrowUpRight,
  ArrowUp,
  ArrowRight,
  RefreshCw,
  Coins,
  Plus,
  ChevronDown,
  ExternalLink,
  Moon,
  Sun,
  BadgeCheck,
  CreditCard,
  Landmark,
  CandlestickChart,
  ShieldCheck,
} from '../system';
import { useTheme } from '../system/theme';
import { useAccount } from '../data/useAccount';
import { resolveRecipient } from '../data/suins';
import type { SuiClient } from '../data/suins';
import { BUSINESS, CONSOLE, money } from './copy';
import { exactWhen, fullWhen, type LedgerRow } from './money';
import { BizChat } from './BizChat';
import { AddFundsSheet, MoveSheet, SendSheet } from './sheets';
import { ProfileTab } from './ProfileTab';
import { loadProfile, type BusinessProfileView } from '../data/profile';
import { type SignTransaction, type BuildClient } from '../data/sponsored';

type Screen = 'dashboard' | 'profile';
type SheetKind = 'addFunds' | 'send' | 'transfer' | null;

const USDC_SCALE = 1_000_000n;
const toRaw = (ui: number): bigint => (BigInt(Math.round(ui * 100)) * USDC_SCALE) / 100n;

/** compact USD — `$12.5k` (for tight chart/KPI labels). */
const usdK = (n: number): string =>
  Math.abs(n) >= 1000 ? `$${(n / 1000).toFixed(1)}k` : money(n);

const short = (a: string) => (a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);

const KIND_GLYPH = { subscription: RefreshCw, 'one-off': CreditCard, 'top-up': Coins } as const;
type ChargeKind = keyof typeof KIND_GLYPH;
/** Best-effort kind from a ledger row's memo (production has no explicit kind). */
const kindOf = (memo: string): ChargeKind =>
  /sub/i.test(memo) ? 'subscription' : /top|usage/i.test(memo) ? 'top-up' : 'one-off';

/* ── smooth-curve helpers — a "nice +chart", not bars ──────────────────────── */
function smoothLine(pts: readonly (readonly [number, number])[]): string {
  if (pts.length < 2) return pts.length ? `M${pts[0][0]} ${pts[0][1]}` : '';
  let d = `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C${c1x.toFixed(1)} ${c1y.toFixed(1)} ${c2x.toFixed(1)} ${c2y.toFixed(1)} ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  return d;
}
function areaPaths(values: number[], w: number, h: number, padTop = 6) {
  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = max - min || 1;
  const pts = values.map((v, i) => {
    const x = values.length > 1 ? (i / (values.length - 1)) * w : w / 2;
    const y = padTop + (h - padTop) * (1 - (v - min) / range);
    return [x, y] as const;
  });
  const line = smoothLine(pts);
  const area = `${line} L${w.toFixed(1)} ${h} L0 ${h} Z`;
  return { pts, line, area };
}

/**
 * DOGFOOD: the merchant-side subscription feed via `@suize/pay`'s `suizeSubs.watch` — the
 * same helper a real merchant drops in. Newest 12, de-duped by digest. Off in the demo seam.
 */
function useMerchantSubs(merchantAddress: string, enabled: boolean): SubEvent[] {
  const [events, setEvents] = useState<SubEvent[]>([]);
  useEffect(() => {
    if (!enabled || !merchantAddress) return;
    const subs = suizeSubs({ merchant: merchantAddress, network: NETWORK });
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
  /** disconnects the zkLogin session */
  onSignOut?: () => void;
}

export function BusinessConsole({ ownerAddress, handle, demo = false, onBack, onSignOut }: BusinessConsoleProps) {
  const client = useSuiClient() as unknown as SuiClient;
  const { mutateAsync: signTransactionRaw } = useSignTransaction();
  const signTransaction = signTransactionRaw as unknown as SignTransaction;
  const api = useAccount(ownerAddress, handle);
  const { theme, toggle } = useTheme();
  const isDark = theme === 'dark';

  const [screen, setScreen] = useState<Screen>('dashboard');
  const [sheet, setSheet] = useState<SheetKind>(null);
  const [idOpen, setIdOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [openReceipt, setOpenReceipt] = useState<string | null>(null);

  // The business's public BusinessProfile (logo/name/site) — drives the rail card + Profile.
  const [profile, setProfile] = useState<BusinessProfileView | null>(null);
  const reloadProfile = useCallback(() => {
    if (demo || !ownerAddress) return;
    loadProfile(client as unknown as Parameters<typeof loadProfile>[0], ownerAddress).then(setProfile);
  }, [demo, ownerAddress, client]);
  useEffect(() => {
    reloadProfile();
  }, [reloadProfile]);

  const [demoAvailable, setDemoAvailable] = useState<number>(CONSOLE.balance.amount);
  const available = demo ? demoAvailable : api.state.wallet.ui;
  const merchant = demo ? BUSINESS.merchant : handle || '…@suize';

  // the REAL charges ledger — ONLY actual x402 pay actions (kind 'charged').
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

  // this month's settled revenue = the sum of REAL charges this month.
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

  const merchantSubs = useMerchantSubs(ownerAddress, !demo);

  const stats = useMemo(
    () => (demo ? { mrr: CONSOLE.mrr.v, arr: CONSOLE.arr.v, subs: BUSINESS.stats[0].v } : { mrr: '$0.00', arr: '$0.00', subs: '0' }),
    [demo],
  );

  const busy = api.pending != null;

  // chart + sparkline geometry (demo only — production has no series yet) ----------
  const months: number[] = [...CONSOLE.months.bars];
  const monthMax = Math.max(...months);
  const peakIdx = months.indexOf(monthMax);
  const AR_W = 720;
  const AR_H = 150;
  const areaC = areaPaths(months, AR_W, AR_H, 16);
  const peakPt = areaC.pts[peakIdx];

  const copyAddr = () => {
    void navigator.clipboard?.writeText(ownerAddress).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  async function onSend(amt: number, to: string) {
    if (demo) {
      setDemoAvailable((v) => Math.max(0, v - amt));
      return;
    }
    const resolved = await resolveRecipient(to, client);
    if (!resolved.address) throw new Error(`Could not find ${to} — check the name and try again.`);
    await api.sendWallet({ amountRaw: toRaw(amt), to: resolved.address });
  }

  const profileName = profile?.name || (demo ? BUSINESS.merchant : '');
  const profileSite = profile?.website || (demo ? 'https://acme.dev' : '');
  const profileLogo = profile?.imageUrl || (demo ? 'https://suize.io/logo.png' : '');

  return (
    <div className={`bz${isDark ? ' is-dark' : ''}`}>
      <style>{CSS}</style>

      {/* ════════ MASTHEAD ════════ */}
      <header className="bz-mast">
        <div className="bz-mast-l">
          <span className="bz-wordmark">SUIZE</span>
          <span className="bz-mast-sep" />
          <span className="bz-mast-ctx"><Landmark size={13} strokeWidth={ICON_STROKE} />Business</span>
        </div>
        <div className="bz-mast-r">
          <div className="bz-switcher" role="tablist" aria-label="Personal or Business">
            <button type="button" className="bz-switch-tab" onClick={onBack}>Personal</button>
            <button type="button" className="bz-switch-tab is-active" aria-current="true">Business</button>
          </div>
          <button type="button" className="bz-thememark" onClick={toggle} aria-label={isDark ? 'Light theme' : 'Dark theme'}>
            {isDark ? <Sun size={16} strokeWidth={ICON_STROKE} /> : <Moon size={16} strokeWidth={ICON_STROKE} />}
          </button>
          <div className="bz-idwrap">
            <button type="button" className="bz-ident" onClick={() => setIdOpen((v) => !v)}>
              <span className="bz-ident-mark">{merchant.slice(0, 1).toUpperCase()}</span>
              <span className="bz-ident-text">
                <span className="bz-ident-handle">{merchant}</span>
                <span className="bz-ident-addr">{short(ownerAddress)}</span>
              </span>
              <ChevronDown size={12} strokeWidth={2} className="bz-ident-chev" style={{ transform: idOpen ? 'rotate(180deg)' : 'none' }} />
            </button>
            {idOpen ? (
              <div className="bz-idmenu">
                <button type="button" className="bz-idrow" onClick={() => { copyAddr(); setIdOpen(false); }}>
                  <span>{copied ? 'Copied' : 'Copy address'}</span>
                  <span className="bz-idrow-addr">{short(ownerAddress)}</span>
                </button>
                {onSignOut ? (
                  <button type="button" className="bz-idrow bz-idrow--out" onClick={() => { onSignOut(); setIdOpen(false); }}>Sign out</button>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </header>

      {/* ════════ BODY: 3 columns ════════ */}
      <div className="bz-body">
        {/* ── LEFT — business identity · this month · standing orders · balance ── */}
        <aside className="bz-left">
          <div className="bz-fade">
            <button type="button" className="bz-biz" onClick={() => setScreen('profile')} title="Manage your business profile">
              <span className="bz-biz-logo" style={profileLogo ? { backgroundImage: `url(${profileLogo})` } : undefined}>
                {!profileLogo ? merchant.slice(0, 1).toUpperCase() : null}
              </span>
              <span className="bz-biz-id">
                <span className="bz-biz-name">
                  {profileName || 'Your business'}
                  {profile ? <BadgeCheck size={14} strokeWidth={ICON_STROKE} className="bz-verified" /> : null}
                </span>
                <span className="bz-biz-site">
                  {profile || demo ? (profileSite.replace(/^https?:\/\//, '') || merchant) : 'Set up your profile'}
                  <ArrowUpRight size={11} strokeWidth={ICON_STROKE} />
                </span>
              </span>
            </button>
          </div>

          {/* this month — a compact KPI ladder */}
          <div className="bz-fade" style={{ animationDelay: '50ms' }}>
            <div className="bz-lefthead">
              <span className="bz-eyebrow">This month</span>
              {demo ? <span className="bz-delta-up"><ArrowUp size={11} strokeWidth={2.4} />{BUSINESS.delta.split(' ')[0]}</span> : null}
            </div>
            <div className="bz-kpis">
              <div className="bz-kpi"><span className="bz-kpi-k">Active subscriptions</span><span className="bz-kpi-v">{stats.subs}</span></div>
              {demo ? <div className="bz-kpi"><span className="bz-kpi-k">Agents that paid</span><span className="bz-kpi-v">{BUSINESS.stats[2].v}</span></div> : null}
              <div className="bz-kpi"><span className="bz-kpi-k">Run-rate (ARR)</span><span className="bz-kpi-v">{stats.arr}</span></div>
            </div>
          </div>

          {/* standing orders */}
          <div className="bz-fade" style={{ animationDelay: '100ms' }}>
            <div className="bz-lefthead">
              <span className="bz-eyebrow">Standing orders</span>
              <span className="bz-leftnote">renew on-chain</span>
            </div>
            <div className="bz-subs">
              {demo ? (
                CONSOLE.renewals.map((r) => (
                  <div key={r.payer} className="bz-sub">
                    <div style={{ minWidth: 0 }}>
                      <div className="bz-sub-who">{r.payer}</div>
                      <div className="bz-sub-meta">{r.plan} · {r.when}</div>
                    </div>
                    <span className="bz-sub-amt">{money(r.amount)}<span className="bz-per">/mo</span></span>
                  </div>
                ))
              ) : merchantSubs.length > 0 ? (
                merchantSubs.map((e) => (
                  <div key={`${e.txDigest}-${e.kind}`} className="bz-sub">
                    <div style={{ minWidth: 0 }}>
                      <div className="bz-sub-who">{e.owner ? short(e.owner) : 'subscriber'}</div>
                      <div className="bz-sub-meta">{e.kind === 'created' ? 'subscribed' : e.kind === 'renewed' ? 'renewed' : 'cancelled'}</div>
                    </div>
                    <a className="bz-sub-verify" href={`https://${NETWORK === 'mainnet' ? '' : NETWORK + '.'}suivision.xyz/txblock/${e.txDigest}`} target="_blank" rel="noreferrer">verify ↗</a>
                  </div>
                ))
              ) : (
                <p className="bz-empty">{CONSOLE.emptyRenewals}</p>
              )}
            </div>
          </div>

        </aside>

        {/* ── CENTRE — dashboard OR profile ── */}
        <main className="bz-mid">
          {screen === 'profile' ? (
            <div className="bz-fade">
              <button type="button" className="bz-backlink" onClick={() => setScreen('dashboard')}>
                <ArrowRight size={13} strokeWidth={ICON_STROKE} style={{ transform: 'rotate(180deg)' }} />Dashboard
              </button>
              <ProfileTab
                profile={profile}
                ownerAddress={ownerAddress}
                client={client as unknown as BuildClient}
                signTransaction={signTransaction}
                onSaved={() => reloadProfile()}
              />
            </div>
          ) : (
            <>
              {/* HERO — the settled wallet balance + the money verbs */}
              <section className="bz-hero bz-fade">
                <span className="bz-eyebrow">Settled balance</span>
                <div className="bz-hero-row">
                  <span className="bz-hero-num">{money(available)}</span>
                </div>
                <p className="bz-hero-sub">Your USDC — settled to your wallet, yours to move anytime.</p>
                <div className="bz-hero-acts">
                  <button type="button" className="bz-btn bz-btn--accent" onClick={() => setSheet('addFunds')} disabled={busy}>
                    <Plus size={14} strokeWidth={2.2} />Add funds
                  </button>
                  <button type="button" className="bz-btn bz-btn--ghost" onClick={() => setSheet('send')} disabled={busy}>
                    <Send size={13} strokeWidth={ICON_STROKE} />Send
                  </button>
                </div>
              </section>

              {/* THE TWO METRIC CARDS — compact, clearly labelled (Net revenue + MRR) */}
              <section className="bz-cards bz-fade" style={{ animationDelay: '60ms' }}>
                <div className="bz-card bz-card--rev">
                  <i className="bz-card-grain" aria-hidden />
                  <div className="bz-card-top">
                    <span className="bz-card-label"><Landmark size={13} strokeWidth={ICON_STROKE} />Net revenue<span className="bz-card-sub">this month</span></span>
                    {demo ? <span className="bz-card-pill"><ArrowUp size={10} strokeWidth={2.6} />{BUSINESS.delta.split(' ')[0]}</span> : null}
                  </div>
                  <div className="bz-card-num">{money(monthTotal)}</div>
                  <div className="bz-card-note">{demo ? `${BUSINESS.stats[2].v} paying agents` : 'Settled on-chain'}</div>
                </div>

                <div className="bz-card bz-card--mrr">
                  <i className="bz-card-grain" aria-hidden />
                  <div className="bz-card-top">
                    <span className="bz-card-label"><RefreshCw size={13} strokeWidth={ICON_STROKE} />Recurring<span className="bz-card-sub">MRR</span></span>
                    <span className="bz-card-tag">{stats.subs} subs</span>
                  </div>
                  <div className="bz-card-num">{stats.mrr}</div>
                  <div className="bz-card-note">{stats.arr} annualized run-rate</div>
                </div>
              </section>

              {/* REVENUE — a smooth 12-month area chart (demo); honest empty in production */}
              <section className="bz-panel bz-fade" style={{ animationDelay: '120ms' }}>
                <div className="bz-panel-head">
                  <span className="bz-panel-title"><CandlestickChart size={15} strokeWidth={ICON_STROKE} />Revenue · 12 months</span>
                  {demo ? <span className="bz-panel-meta">peak {usdK(monthMax * 1000)} · {CONSOLE.months.labels[peakIdx]}</span> : null}
                </div>
                {demo ? (
                  <div className="bz-areawrap">
                    <svg className="bz-area" viewBox={`0 0 ${AR_W} ${AR_H}`} preserveAspectRatio="none" aria-hidden>
                      <defs><linearGradient id="bzareafill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--bz-blue)" stopOpacity="0.20" /><stop offset="100%" stopColor="var(--bz-blue)" stopOpacity="0" /></linearGradient></defs>
                      <path d={areaC.area} fill="url(#bzareafill)" />
                      <path className="bz-area-line" d={areaC.line} fill="none" stroke="var(--bz-blue)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
                      <circle cx={peakPt[0]} cy={peakPt[1]} r="4" fill="var(--bz-blue)" />
                    </svg>
                    <span className="bz-area-peaktag" style={{ left: `${(peakPt[0] / AR_W) * 100}%`, top: `${(peakPt[1] / AR_H) * 100}%` }}>{usdK(monthMax * 1000)}</span>
                    <div className="bz-area-labels">{CONSOLE.months.labels.map((l, i) => <span key={i} className={`bz-area-lab${i === peakIdx ? ' is-peak' : ''}`}>{l}</span>)}</div>
                  </div>
                ) : (
                  <p className="bz-empty bz-empty--pad">{CONSOLE.emptyRevenue}</p>
                )}
              </section>

              {/* CHARGES — the on-chain settled-revenue ledger */}
              <section className="bz-panel bz-fade" style={{ animationDelay: '160ms' }}>
                <div className="bz-panel-head">
                  <span className="bz-panel-title"><Activity size={15} strokeWidth={ICON_STROKE} />Recent charges</span>
                  <span className="bz-panel-meta">every line checkable on-chain</span>
                </div>
                <div className="bz-table">
                  {demo ? (
                    BUSINESS.ledger.map((row) => {
                      const k = kindOf(row.memo);
                      const Glyph = KIND_GLYPH[k];
                      const id = `${row.payer}-${row.when}`;
                      const hasReceipt = 'open' in row && row.open;
                      const isOpen = hasReceipt && openReceipt === id;
                      return (
                        <div key={id} className={`bz-trow-wrap${isOpen ? ' is-open' : ''}`}>
                          <button type="button" className="bz-trow" onClick={hasReceipt ? () => setOpenReceipt(isOpen ? null : id) : undefined} style={hasReceipt ? undefined : { cursor: 'default' }}>
                            <span className={`bz-trow-glyph bz-k-${k}`}><Glyph size={16} strokeWidth={ICON_STROKE} /></span>
                            <span className="bz-trow-id"><span className="bz-trow-payer">{row.payer}</span><span className="bz-trow-memo">{row.memo}</span></span>
                            <span className="bz-trow-when">{row.when}</span>
                            <span className="bz-trow-amt">+{money(row.amount)}</span>
                            {hasReceipt ? <span className="bz-trow-receipt"><ShieldCheck size={12} strokeWidth={ICON_STROKE} />Receipt</span> : <span className="bz-trow-spacer" />}
                          </button>
                          {isOpen ? (
                            <div className="bz-receipt">
                              <div className="bz-receipt-head"><BadgeCheck size={12} strokeWidth={ICON_STROKE} />Settled on-chain · the balance change is the receipt</div>
                              <div className="bz-receipt-rows">
                                {BUSINESS.receipt.rows.map((r) => (
                                  <div key={r.k} className={`bz-receipt-r${'strong' in r && r.strong ? ' is-net' : ''}`}><span>{r.k}</span><b>{r.v}</b></div>
                                ))}
                              </div>
                              <div className="bz-receipt-foot">{BUSINESS.receipt.foot}</div>
                            </div>
                          ) : null}
                        </div>
                      );
                    })
                  ) : charges.length > 0 ? (
                    charges.map((c) => {
                      const k = kindOf(c.what);
                      const Glyph = KIND_GLYPH[k];
                      return (
                        <div key={c.id} className="bz-trow-wrap">
                          <div className="bz-trow" style={{ cursor: 'default' }}>
                            <span className={`bz-trow-glyph bz-k-${k}`}><Glyph size={16} strokeWidth={ICON_STROKE} /></span>
                            <span className="bz-trow-id"><span className="bz-trow-payer">{c.who}</span><span className="bz-trow-memo">{c.what}</span></span>
                            <span className="bz-trow-when" title={c.whenTitle}>{c.when}</span>
                            <span className="bz-trow-amt">+{money(c.amount ?? 0)}</span>
                            {c.verifyHref ? (
                              <a className="bz-trow-receipt" href={c.verifyHref} target="_blank" rel="noreferrer"><ExternalLink size={12} strokeWidth={ICON_STROKE} />Verify</a>
                            ) : <span className="bz-trow-spacer" />}
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <p className="bz-empty bz-empty--pad">{CONSOLE.emptyLedger}</p>
                  )}
                </div>
              </section>
            </>
          )}
        </main>

        {/* ── RIGHT — the business's AI analyst (the real BizChat) ── */}
        <aside className="bz-right bz-fade" style={{ animationDelay: '90ms' }}>
          <BizChat demo={demo} />
        </aside>
      </div>

      {/* ── THE MONEY SHEETS (the same verbs as the consumer wallet) ── */}
      {sheet === 'addFunds' ? <AddFundsSheet handle={merchant} requestEnabled={demo} onClose={() => setSheet(null)} /> : null}
      {sheet === 'send' ? <SendSheet available={available} onSend={onSend} claimEnabled={demo} onClose={() => setSheet(null)} /> : null}
      {sheet === 'transfer' && demo ? <MoveSheet kind="transfer" available={available} onMove={(amt) => setDemoAvailable((v) => Math.max(0, v - amt))} onClose={() => setSheet(null)} /> : null}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════════
 * OBSIDIAN — the Business console's scoped CSS (prefix `.bz-`). Tokens are the
 * shared `--rd-*` register (auto light/dark); `--bz-blue*` is the one electric
 * accent. The money cards retint local ink to light (the personal Deck's law).
 * ════════════════════════════════════════════════════════════════════════════ */
const CSS = `
.bz{ position:absolute; inset:0; overflow:hidden; display:flex; flex-direction:column;
  background:var(--rd-base); color:var(--rd-fg); font-family:var(--rd-sans);
  /* accent = the room's own --rd-blue (theme-adaptive) so Business reads as the same app as Personal */
  --bz-blue:var(--rd-blue); --bz-blue-bright:var(--rd-blue-bright); --bz-blue-deep:var(--rd-blue-deep);
  --bz-blue-wash:var(--rd-wash); --bz-blue-line:var(--rd-hair-blue); --bz-spark:var(--rd-blue-bright);
  --bz-pad:clamp(15px,1.9vw,26px); }
.bz *{ box-sizing:border-box; }
.bz ::selection{ background:color-mix(in srgb, var(--bz-blue) 24%, transparent); }
.bz-fade{ opacity:0; transform:translateY(10px); animation:bz-rise .7s var(--rd-ease) forwards; }
@keyframes bz-rise{ to{ opacity:1; transform:none; } }
.bz-eyebrow{ font-size:10px; font-weight:700; letter-spacing:0.16em; text-transform:uppercase; color:var(--rd-fg-3); }

/* MASTHEAD */
.bz-mast{ flex:0 0 auto; display:flex; align-items:center; justify-content:space-between; gap:16px; height:56px; padding:0 var(--bz-pad); border-bottom:1px solid var(--rd-hair); background:var(--rd-surface); }
.bz-mast-l{ display:flex; align-items:center; gap:13px; min-width:0; }
.bz-wordmark{ font-family:var(--rd-wordmark); font-weight:700; font-size:19px; letter-spacing:0.04em; background:linear-gradient(180deg, var(--rd-fg) 12%, var(--bz-blue) 150%); -webkit-background-clip:text; background-clip:text; -webkit-text-fill-color:transparent; }
.bz-mast-sep{ width:1px; height:18px; background:var(--rd-hair-strong); }
.bz-mast-ctx{ display:inline-flex; align-items:center; gap:6px; font-family:var(--rd-mono); font-size:10.5px; font-weight:600; letter-spacing:0.14em; text-transform:uppercase; color:var(--rd-fg-3); white-space:nowrap; }
.bz-mast-ctx svg{ color:var(--bz-blue); }
.bz-mast-r{ display:flex; align-items:center; gap:10px; min-width:0; }
.bz-switcher{ display:inline-flex; align-items:center; gap:2px; padding:3px; border-radius:var(--rd-r-12); background:var(--rd-quiet); }
.bz-switch-tab{ font-family:var(--rd-sans); font-size:12px; font-weight:600; padding:6px 13px; border-radius:var(--rd-r-8); color:var(--rd-fg-3); cursor:pointer; border:0; background:transparent; transition:color .18s var(--rd-ease), background .18s var(--rd-ease); white-space:nowrap; }
.bz-switch-tab:hover:not(.is-active){ color:var(--rd-fg); }
.bz-switch-tab.is-active{ color:#fff; background:var(--bz-blue); box-shadow:0 4px 12px -5px var(--bz-blue); }
.bz-thememark{ display:grid; place-items:center; width:32px; height:32px; border-radius:var(--rd-r-8); border:none; color:var(--rd-fg-3); background:transparent; cursor:pointer; transition:color .18s ease, background .18s ease; }
.bz-thememark:hover{ color:var(--rd-fg); background:var(--rd-quiet); }
.bz-idwrap{ position:relative; }
.bz-ident{ display:inline-flex; align-items:center; gap:9px; padding:5px 11px 5px 6px; border-radius:var(--rd-r-12); background:var(--rd-raised); box-shadow:inset 0 0 0 1px var(--rd-hair); cursor:pointer; transition:box-shadow .18s ease, transform .18s ease; }
.bz-ident:hover{ transform:translateY(-1px); box-shadow:inset 0 0 0 1px var(--bz-blue-line), 0 8px 22px -14px var(--bz-blue); }
.bz-ident-mark{ display:grid; place-items:center; width:30px; height:30px; border-radius:9px; flex:0 0 auto; font-size:14px; font-weight:700; color:#fff; background:linear-gradient(140deg, var(--bz-blue-bright), var(--bz-blue-deep)); }
.bz-ident-text{ display:flex; flex-direction:column; align-items:flex-start; line-height:1.2; min-width:0; }
.bz-ident-handle{ font-family:var(--rd-mono); font-size:12px; font-weight:600; color:var(--rd-fg); max-width:150px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.bz-ident-addr{ font-family:var(--rd-mono); font-size:10px; color:var(--rd-fg-4); font-variant-numeric:tabular-nums; }
.bz-ident-chev{ flex:0 0 auto; color:var(--rd-fg-4); transition:transform .2s var(--rd-ease); }
.bz-idmenu{ position:absolute; top:calc(100% + 8px); right:0; min-width:220px; z-index:40; background:var(--rd-raised); border:1px solid var(--rd-hair); border-radius:13px; padding:5px; box-shadow:0 22px 50px -22px var(--rd-glass-shadow); animation:bz-rise .2s var(--rd-ease) both; }
.bz-idrow{ display:flex; justify-content:space-between; gap:12px; width:100%; text-align:left; padding:10px 12px; border-radius:9px; font-size:12.5px; font-weight:600; color:var(--rd-fg-2); background:transparent; border:0; cursor:pointer; transition:background .15s ease, color .15s ease; }
.bz-idrow:hover{ background:var(--rd-quiet); color:var(--rd-fg); }
.bz-idrow--out:hover{ color:var(--rd-bear); }
.bz-idrow-addr{ font-family:var(--rd-mono); font-size:11px; color:var(--rd-fg-4); font-variant-numeric:tabular-nums; }

/* BODY 3-col */
.bz-body{ flex:1 1 auto; min-height:0; display:grid; grid-template-columns:minmax(258px,308px) minmax(0,1fr) minmax(372px,430px); }
.bz-left{ overflow-y:auto; padding:var(--bz-pad); display:flex; flex-direction:column; gap:22px; border-right:1px solid var(--rd-hair); }
.bz-mid{ overflow-y:auto; padding:clamp(18px,2vw,30px) clamp(20px,2.4vw,40px); display:flex; flex-direction:column; gap:clamp(18px,2.2vh,26px); }
.bz-right{ min-width:0; overflow:hidden; min-height:0; border-left:1px solid var(--rd-hair); display:flex; flex-direction:column; }
.bz-right .rd-asst{ border-radius:0; background:transparent; border:0; box-shadow:none; -webkit-backdrop-filter:none; backdrop-filter:none; }

/* LEFT column */
.bz-biz{ display:flex; align-items:center; gap:12px; width:100%; text-align:left; background:transparent; border:0; cursor:pointer; padding:0; border-radius:12px; transition:opacity .16s ease; }
.bz-biz:hover{ opacity:.85; }
.bz-biz-logo{ display:grid; place-items:center; width:42px; height:42px; border-radius:11px; flex:0 0 auto; background:var(--rd-raised-2) center/cover no-repeat; box-shadow:inset 0 0 0 1px var(--rd-hair); font-size:17px; font-weight:700; color:var(--rd-fg-3); }
.bz-biz-id{ min-width:0; display:flex; flex-direction:column; }
.bz-biz-name{ display:flex; align-items:center; gap:6px; font-size:16px; font-weight:700; letter-spacing:-0.01em; color:var(--rd-fg); }
.bz-verified{ color:var(--bz-blue); flex:0 0 auto; }
.bz-biz-site{ display:inline-flex; align-items:center; gap:3px; font-family:var(--rd-mono); font-size:11px; color:var(--rd-fg-3); margin-top:2px; }
.bz-biz:hover .bz-biz-site{ color:var(--bz-blue); }
.bz-lefthead{ display:flex; align-items:baseline; justify-content:space-between; gap:10px; padding-bottom:11px; border-bottom:1px solid var(--rd-hair); }
.bz-leftnote{ font-family:var(--rd-serif); font-style:italic; font-size:11.5px; color:var(--rd-fg-4); }
.bz-delta-up{ display:inline-flex; align-items:center; gap:2px; font-family:var(--rd-mono); font-size:11px; font-weight:700; color:var(--rd-bull); font-variant-numeric:tabular-nums; }
.bz-kpis{ display:flex; flex-direction:column; margin-top:6px; }
.bz-kpi{ display:flex; align-items:baseline; justify-content:space-between; gap:12px; padding:11px 0; border-top:1px solid var(--rd-hair-2); }
.bz-kpi:first-child{ border-top:0; }
.bz-kpi-k{ font-size:12.5px; font-weight:500; color:var(--rd-fg-2); }
.bz-kpi-v{ font-family:var(--rd-mono); font-size:14.5px; font-weight:600; color:var(--rd-fg); font-variant-numeric:tabular-nums; letter-spacing:-0.01em; }
.bz-subs{ display:flex; flex-direction:column; margin-top:4px; }
.bz-sub{ display:flex; align-items:center; justify-content:space-between; gap:12px; padding:12px 0; border-top:1px solid var(--rd-hair-2); }
.bz-sub:first-child{ border-top:0; }
.bz-sub-who{ font-family:var(--rd-mono); font-size:12.5px; font-weight:600; color:var(--rd-fg); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.bz-sub-meta{ font-size:10.5px; color:var(--rd-fg-4); margin-top:3px; }
.bz-sub-amt{ font-family:var(--rd-mono); font-size:13px; font-weight:600; color:var(--rd-fg); font-variant-numeric:tabular-nums; flex:0 0 auto; }
.bz-per{ color:var(--rd-fg-4); font-weight:400; font-size:9.5px; }
.bz-sub-verify{ font-family:var(--rd-mono); font-size:9.5px; letter-spacing:0.04em; color:var(--rd-fg-4); text-decoration:none; flex:0 0 auto; transition:color .16s ease; }
.bz-sub-verify:hover{ color:var(--bz-blue); }
.bz-empty{ font-family:var(--rd-serif); font-style:italic; font-size:13px; color:var(--rd-fg-4); margin:0; padding:12px 2px; }
.bz-empty--pad{ padding:22px 4px; }

/* CENTRE hero */
.bz-backlink{ display:inline-flex; align-items:center; gap:6px; margin-bottom:16px; padding:7px 13px; border-radius:var(--rd-r-pill); border:0; cursor:pointer; font-size:12.5px; font-weight:600; color:var(--rd-fg-2); background:var(--rd-quiet); transition:color .16s ease; }
.bz-backlink:hover{ color:var(--bz-blue); }
.bz-hero{ border-bottom:1px solid var(--rd-hair); padding-bottom:clamp(14px,1.8vh,22px); }
.bz-hero-row{ display:flex; align-items:flex-end; gap:14px; margin-top:11px; }
.bz-hero-num{ font-family:var(--rd-mono); font-variant-numeric:tabular-nums; font-weight:600; font-size:clamp(40px,4.6vw,62px); letter-spacing:-0.035em; line-height:1.12; padding-bottom:0.08em; background:var(--rd-grad-hot); -webkit-background-clip:text; background-clip:text; -webkit-text-fill-color:transparent; color:transparent; }
.bz-hero-delta{ display:inline-flex; align-items:center; gap:2px; margin-bottom:0.5em; padding:4px 10px; border-radius:var(--rd-r-pill); font-family:var(--rd-mono); font-size:13px; font-weight:700; color:var(--rd-bull); font-variant-numeric:tabular-nums; background:color-mix(in srgb, var(--rd-bull) 12%, transparent); }
.bz-hero-sub{ font-family:var(--rd-serif); font-size:14px; color:var(--rd-fg-3); margin:12px 0 0; line-height:1.5; max-width:520px; }
.bz-hero-sub b{ color:var(--rd-fg-2); font-weight:600; }
.bz-hero-acts{ display:flex; gap:10px; margin-top:18px; }
.bz-btn{ display:inline-flex; align-items:center; gap:7px; border:0; cursor:pointer; font-family:var(--rd-sans); font-weight:600; font-size:13px; padding:10px 17px; border-radius:var(--rd-r-12); transition:transform .18s var(--rd-ease), box-shadow .18s var(--rd-ease), color .18s var(--rd-ease); }
.bz-btn:hover:not(:disabled){ transform:translateY(-1px); }
.bz-btn:disabled{ opacity:.5; cursor:default; }
.bz-btn--accent{ background:var(--rd-grad-accent); color:#fff; box-shadow:0 6px 18px -8px var(--rd-glow); }
.bz-btn--ghost{ background:transparent; box-shadow:inset 0 0 0 1px var(--rd-hair-strong); color:var(--rd-fg-2); }
.bz-btn--ghost:hover:not(:disabled){ box-shadow:inset 0 0 0 1px var(--rd-fg-3); color:var(--rd-fg); }

/* THE OBSIDIAN MONEY CARDS */
.bz-cards{ display:grid; grid-template-columns:1fr 1fr; gap:14px; }
@media (max-width:680px){ .bz-cards{ grid-template-columns:1fr; } }
.bz-card{ position:relative; overflow:hidden; display:flex; flex-direction:column; padding:15px 17px 14px; border-radius:var(--rd-r-16);
  --rd-fg:#f3f6fb; --rd-fg-2:rgba(243,246,251,.82); --rd-fg-3:rgba(243,246,251,.62); --rd-fg-4:rgba(243,246,251,.44); color:var(--rd-fg);
  box-shadow:inset 0 0 0 1px rgba(255,255,255,.08), inset 0 1px 0 0 rgba(255,255,255,.14), 0 18px 40px -26px rgba(6,10,18,.9), 0 3px 12px -8px rgba(6,10,18,.55); }
/* sapphire jewel-metal — same family as the personal Deck's vault card */
.bz-card--rev{ background:linear-gradient(118deg, rgba(255,255,255,.14) 0%, rgba(255,255,255,0) 30%), radial-gradient(128% 150% at 14% 6%, rgba(77,162,255,.32) 0%, rgba(77,162,255,0) 47%), linear-gradient(150deg, #0c3a63 0%, #0a2c4d 46%, #06223c 74%, #041a2e 100%); }
.bz-card--mrr{ background:linear-gradient(118deg, rgba(255,255,255,.12) 0%, rgba(255,255,255,0) 30%), radial-gradient(128% 150% at 14% 6%, rgba(77,162,255,.18) 0%, rgba(77,162,255,0) 49%), linear-gradient(150deg, #0a2c4d 0%, #08233d 46%, #051a2f 74%, #03121f 100%); }
.bz.is-dark .bz-card--rev{ background:linear-gradient(118deg, rgba(255,255,255,.12) 0%, rgba(255,255,255,0) 30%), radial-gradient(132% 155% at 14% 5%, rgba(122,196,255,.40) 0%, rgba(122,196,255,0) 50%), linear-gradient(150deg, #0e4576 0%, #0a3056 44%, #06223c 76%, #03182b 100%); }
.bz.is-dark .bz-card--mrr{ background:linear-gradient(118deg, rgba(255,255,255,.10) 0%, rgba(255,255,255,0) 30%), radial-gradient(132% 155% at 14% 5%, rgba(122,196,255,.24) 0%, rgba(122,196,255,0) 52%), linear-gradient(150deg, #0b3358 0%, #0a2840 46%, #061f37 76%, #031526 100%); }
.bz-card-grain{ position:absolute; inset:0; pointer-events:none; border-radius:inherit; z-index:0; opacity:.5; mix-blend-mode:soft-light; background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='c'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='1.05' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix type='matrix' values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 .95 0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23c)'/%3E%3C/svg%3E"); background-size:128px 128px; }
.bz-card > *:not(.bz-card-grain){ position:relative; z-index:1; }
.bz-card-top{ display:flex; align-items:center; justify-content:space-between; gap:10px; }
.bz-card-label{ display:inline-flex; align-items:center; gap:6px; font-size:11px; font-weight:700; letter-spacing:0.04em; color:var(--rd-fg-2); }
.bz-card-label svg{ color:var(--bz-spark); }
.bz-card-sub{ font-family:var(--rd-mono); font-size:9px; font-weight:700; letter-spacing:0.1em; text-transform:uppercase; color:var(--rd-fg-4); padding-left:6px; margin-left:2px; border-left:1px solid var(--rd-hair); }
.bz-card-pill{ display:inline-flex; align-items:center; gap:2px; padding:3px 9px; border-radius:var(--rd-r-pill); font-family:var(--rd-mono); font-size:11px; font-weight:700; color:#bff0d8; font-variant-numeric:tabular-nums; background:rgba(52,211,153,.16); box-shadow:inset 0 0 0 1px rgba(52,211,153,.28); }
.bz-card-tag{ font-family:var(--rd-mono); font-size:10.5px; font-weight:600; color:var(--rd-fg-3); padding:3px 9px; border-radius:var(--rd-r-pill); background:rgba(255,255,255,.06); box-shadow:inset 0 0 0 1px rgba(255,255,255,.10); }
.bz-card-num{ font-family:var(--rd-mono); font-variant-numeric:tabular-nums; font-size:29px; font-weight:600; letter-spacing:-0.025em; color:var(--rd-fg); margin-top:11px; line-height:1.1; }
.bz-card-note{ font-family:var(--rd-serif); font-style:italic; font-size:12px; color:var(--rd-fg-3); margin-top:6px; line-height:1.4; }

/* PANELS */
.bz-panel{ display:flex; flex-direction:column; }
.bz-panel-head{ display:flex; align-items:flex-end; justify-content:space-between; gap:14px; padding-bottom:12px; border-bottom:1px solid var(--rd-hair); }
.bz-panel-title{ display:inline-flex; align-items:center; gap:8px; font-size:14px; font-weight:600; letter-spacing:-0.01em; color:var(--rd-fg); }
.bz-panel-title svg{ color:var(--bz-blue); }
.bz-panel-meta{ font-family:var(--rd-mono); font-size:10.5px; color:var(--rd-fg-4); font-variant-numeric:tabular-nums; letter-spacing:0.02em; white-space:nowrap; }
.bz-areawrap{ position:relative; margin-top:18px; }
.bz-area{ width:100%; height:150px; display:block; overflow:visible; }
.bz-area-line{ animation:bz-draw 1.1s var(--rd-ease) both; }
@keyframes bz-draw{ from{ stroke-dasharray:1400; stroke-dashoffset:1400; } to{ stroke-dasharray:1400; stroke-dashoffset:0; } }
.bz-area-peaktag{ position:absolute; transform:translate(-50%,-150%); font-family:var(--rd-mono); font-size:10.5px; font-weight:700; color:var(--bz-blue); font-variant-numeric:tabular-nums; pointer-events:none; white-space:nowrap; }
.bz-area-labels{ display:flex; justify-content:space-between; margin-top:9px; padding:0 1px; }
.bz-area-lab{ font-family:var(--rd-mono); font-size:9.5px; font-weight:600; color:var(--rd-fg-4); }
.bz-area-lab.is-peak{ color:var(--bz-blue); }

/* CHARGES table */
.bz-table{ display:flex; flex-direction:column; margin-top:6px; }
.bz-trow-wrap{ border-bottom:1px solid var(--rd-hair-2); }
.bz-trow-wrap:last-child{ border-bottom:0; }
.bz-trow{ display:grid; grid-template-columns:auto minmax(0,1fr) auto auto auto; align-items:center; gap:13px; width:100%; text-align:left; padding:13px 8px; border-radius:var(--rd-r-8); border:0; background:transparent; transition:background .18s var(--rd-ease); }
button.bz-trow{ cursor:pointer; }
.bz-trow:hover{ background:var(--bz-blue-wash); }
.bz-trow-glyph{ display:grid; place-items:center; width:36px; height:36px; border-radius:10px; flex:0 0 auto; }
.bz-k-subscription{ color:var(--bz-blue); background:var(--bz-blue-wash); }
.bz-k-one-off{ color:var(--rd-fg-2); background:var(--rd-quiet); }
.bz-k-top-up{ color:var(--rd-bull); background:color-mix(in srgb, var(--rd-bull) 12%, transparent); }
.bz-trow-id{ min-width:0; display:flex; flex-direction:column; gap:3px; }
.bz-trow-payer{ font-family:var(--rd-mono); font-size:13px; font-weight:600; color:var(--rd-fg); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.bz-trow-memo{ font-family:var(--rd-serif); font-style:italic; font-size:11.5px; color:var(--rd-fg-4); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.bz-trow-when{ font-family:var(--rd-mono); font-size:10.5px; color:var(--rd-fg-4); white-space:nowrap; font-variant-numeric:tabular-nums; flex:0 0 auto; }
.bz-trow-amt{ font-family:var(--rd-mono); font-size:14.5px; font-weight:600; color:var(--rd-bull); font-variant-numeric:tabular-nums; letter-spacing:-0.01em; text-align:right; flex:0 0 auto; }
.bz-trow-receipt{ display:inline-flex; align-items:center; gap:4px; font-family:var(--rd-sans); font-size:10px; font-weight:700; letter-spacing:0.04em; text-transform:uppercase; color:var(--rd-fg-3); padding:4px 9px; border-radius:var(--rd-r-pill); box-shadow:inset 0 0 0 1px var(--rd-hair); text-decoration:none; transition:color .18s ease, box-shadow .18s ease; flex:0 0 auto; }
.bz-trow:hover .bz-trow-receipt{ color:var(--bz-blue); box-shadow:inset 0 0 0 1px var(--bz-blue-line); }
.bz-trow-wrap.is-open .bz-trow-receipt{ color:var(--bz-blue); box-shadow:inset 0 0 0 1px var(--bz-blue-line); background:var(--bz-blue-wash); }
.bz-trow-spacer{ width:78px; flex:0 0 auto; }
.bz-receipt{ margin:0 8px 12px; border-radius:var(--rd-r-12); overflow:hidden; background:var(--rd-raised); box-shadow:inset 0 0 0 1px var(--rd-hair); animation:bz-rise .35s var(--rd-ease) both; }
.bz-receipt-head{ display:flex; align-items:center; gap:6px; padding:10px 14px; border-bottom:1px solid var(--rd-hair); font-size:9.5px; font-weight:700; letter-spacing:0.1em; text-transform:uppercase; color:var(--rd-fg-3); }
.bz-receipt-head svg{ color:var(--rd-bull); }
.bz-receipt-rows{ padding:6px 14px; }
.bz-receipt-r{ display:flex; align-items:center; justify-content:space-between; gap:12px; padding:7px 0; font-size:12.5px; color:var(--rd-fg-2); border-top:1px solid var(--rd-hair-2); }
.bz-receipt-r:first-child{ border-top:0; }
.bz-receipt-r b{ font-family:var(--rd-mono); font-weight:600; color:var(--rd-fg); font-variant-numeric:tabular-nums; }
.bz-receipt-r.is-net{ color:var(--rd-fg); font-weight:600; }
.bz-receipt-r.is-net b{ color:var(--rd-bull); font-size:13.5px; }
.bz-receipt-foot{ padding:9px 14px 11px; border-top:1px solid var(--rd-hair-2); font-family:var(--rd-mono); font-size:10px; letter-spacing:0.04em; color:var(--rd-fg-4); }

@media (prefers-reduced-motion:reduce){ .bz-fade, .bz-area-line, .bz-receipt{ animation:none; opacity:1; transform:none; stroke-dashoffset:0; } }
@media (max-width:1120px){
  .bz{ overflow:auto; }
  .bz-body{ grid-template-columns:1fr; }
  .bz-left, .bz-mid, .bz-right{ overflow:visible; border:0; }
  .bz-left{ border-bottom:1px solid var(--rd-hair); }
  .bz-right{ border-top:1px solid var(--rd-hair); min-height:560px; }
}
`;
