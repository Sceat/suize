/**
 * THE WALLET — production (the owner-picked Deck). Money first: the two pots,
 * the live subscriptions list, and the verifiable activity ledger own the page;
 * the assistant is a resizable right column (secondary by law).
 *
 * REAL (via the verified `useAccount` data layer, publish-gated honestly):
 *   · "Your money" = the wallet USDC balance; "Sub-account" = the shared
 *     Account<USDC> balance — both read straight from chain.
 *   · Subscriptions + the activity trace reconstructed from on-chain events,
 *     every row carrying its real explorer link.
 *   · Top up → `deposit` · Withdraw → `withdraw` · Cancel → `cancel_subscription`
 *     — all sponsored, owner-signed, throwing the CALM publish-gate message
 *     until `account.move` ships (the banner says exactly that).
 *   · Send → `sendWallet` (a plain sponsored P2P transfer of the user's OWN
 *     USDC — no fee, no publish gate); names resolve via SuiNS first.
 *
 * DEMO (DEV-only `?demo=1`): the sample books + the SF assistant choreography.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSuiClient } from '@mysten/dapp-kit';
import {
  Activity as ActivityIcon,
  ArrowDown,
  Landmark,
  Moon,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Send as SendIcon,
  Sun,
  ICON_STROKE,
} from '../system';
import { useTheme } from '../system/theme';
import { useAccount } from '../data/useAccount';
import { useAgent } from '../data/useAgent';
import { useSubscriptions } from '../data/useSubscriptions';
import { resolveRecipient } from '../data/suins';
import type { SuiClient } from '../data/suins';
import { SUIVISION_TX } from '../lib/env';
import { WALLET, money } from './copy';
import { AssistantPanel } from './Assistant';
import {
  ActivityList,
  CustodyNote,
  SubsList,
  exactWhen,
  fullWhen,
  renewsIn,
  useDemoMoney,
  type LedgerRow,
  type SubRow,
} from './money';
import {
  AddFundsSheet,
  CancelSubSheet,
  FundAgentSheet,
  WithdrawAgentSheet,
  SendSheet,
} from './sheets';
import { IdentityMenu } from './Identity';

type SheetKind =
  | 'addFunds'
  | 'send'
  | 'fundAgent'
  | 'withdrawAgent'
  | null;

const ASIDE_MIN = 320;
const ASIDE_MAX = 560;
const ASIDE_KEY = 'suize:assistant-width';
const USDC_SCALE = 1_000_000n;

/** ui dollars → USDC base units (6 decimals), safely via cents */
function toRaw(ui: number): bigint {
  return (BigInt(Math.round(ui * 100)) * USDC_SCALE) / 100n;
}

export interface WalletDeckProps {
  ownerAddress: string;
  handle: string;
  /** DEV-only populated demo (sample books + the SF assistant choreography) */
  demo?: boolean;
  /** opens the business face */
  onOpenBusiness?: () => void;
  /** disconnects the zkLogin session (the identity menu's Sign out) */
  onSignOut?: () => void;
}

export function WalletDeck({ ownerAddress, handle, demo = false, onOpenBusiness, onSignOut }: WalletDeckProps) {
  const client = useSuiClient() as unknown as SuiClient;
  const api = useAccount(ownerAddress, handle);
  const agent = useAgent(ownerAddress, api.sendWallet, api.spendFromSubaccount);
  const subsApi = useSubscriptions(ownerAddress, !demo);
  const { theme, toggle } = useTheme();
  const [agentOn, setAgentOn] = useState(true);
  const [sheet, setSheet] = useState<SheetKind>(null);
  // which subscription is being cancelled (by id), if any
  const [cancelSub, setCancelSub] = useState<SubRow | null>(null);

  // DEMO money (DEV-only choreography) vs the REAL on-chain state
  const dm = useDemoMoney();
  const yourMoney = demo ? dm.yourMoney : api.state.wallet.ui;
  const agentBalance = demo ? dm.balance : agent.balance.ui;
  const agentConnected = demo ? true : agent.armed;
  const paidFlash = demo ? dm.paidFlash : false;
  const busy = api.pending != null;
  const displayHandle = demo ? WALLET.handle : api.state.handle || handle || '…@suize';

  // ── map the real on-chain state into the list rows ─────────────────────────
  const subs = useMemo<SubRow[]>(() => {
    if (demo) {
      return WALLET.books.subs.map((s, i) => ({
        key: String(i),
        name: s.name,
        renews: s.renews,
        perMonth: s.perMonth,
      }));
    }
    // push-not-pull: each renewal is paid inline from the owner's wallet, so the
    // honest line is the paid-through clock — a LAPSED sub (past its paid-through,
    // no auto-renew covered it) must SAY so, never an optimistic guess.
    return subsApi.rows.map((s) => ({
      key: s.id,
      name: s.label,
      renews: s.lapsed
        ? 'lapsed — renew or cancel'
        : s.dueSoon
          ? 'renewing soon'
          : renewsIn(s.paidUntilMs - s.periodMs, s.periodMs),
      perMonth: s.amountUi,
      warn: s.lapsed,
    }));
  }, [demo, subsApi.rows]);

  const activity = useMemo<LedgerRow[]>(() => {
    if (demo) {
      const rows = dm.booked ? [WALLET.books.flightRow, ...WALLET.books.activity] : WALLET.books.activity;
      return rows.map((a, i) => ({ id: `d${i}`, what: a.what, who: a.who, when: a.when, whenTitle: a.whenTitle, amount: a.amount }));
    }
    // a transfer to/from the user's OWN agent sub-account isn't a "Sent"/"Received" —
    // it's funding (or sweeping) the agent, so it reads as its own action with no
    // counterparty token (the agent is "you", not a payee).
    const agentAddr = agent.agentAddress?.toLowerCase();
    return api.state.activity.map((a) => {
      const isAgent = agentAddr != null && a.counterparty?.toLowerCase() === agentAddr;
      return {
        id: a.id,
        // the action ("Sent"/"Paid"/…) + the resolved "to whom" (gradient-coloured by Party).
        what: isAgent ? (a.flow === 'in' ? 'Transfer from agent' : 'Transfer to agent') : a.title,
        who: isAgent ? undefined : a.detail,
        when: exactWhen(a.ts),
        whenTitle: fullWhen(a.ts),
        // flow 'none' rows (sub-cancelled) carry NO signed amount — nothing moved,
        // so nothing may read as money in or out
        amount: a.amountUi == null || a.flow === 'none' ? null : a.flow === 'out' ? -a.amountUi : a.amountUi,
        // a pending (optimistic) row has no real digest yet → no verify link
        verifyHref: a.pending ? undefined : SUIVISION_TX(a.txDigest),
        pending: a.pending,
      };
    });
  }, [demo, dm.booked, api.state.activity, agent.agentAddress]);

  // ── the sheet ops — demo mutates locally; production runs the real verbs ───
  async function onSend(amt: number, to: string) {
    if (demo) return dm.send(amt);
    const resolved = await resolveRecipient(to, client);
    if (!resolved.address) throw new Error(`Could not find ${to} — check the name and try again.`);
    // pass the typed recipient as the optimistic row's label (what the user knows).
    await api.sendWallet({ amountRaw: toRaw(amt), to: resolved.address, label: to.trim() });
  }
  async function onFundAgent(amt: number) {
    if (demo) return dm.topUp(amt);
    await agent.fund(toRaw(amt));
  }
  async function onWithdrawAgent(amt: number) {
    if (demo) return;
    await agent.withdraw(toRaw(amt)); // back to your wallet (MAIN member signs alone)
  }
  async function onConfirmCancel() {
    if (demo || !cancelSub) return;
    await api.cancelSubscription(cancelSub.key);
    subsApi.refresh();
  }

  // Connect the agent sub-account — a popup does the one-time agent Google sign-in,
  // persists the 1-of-2 members, and signals completion over a BroadcastChannel
  // (Google's OAuth COOP severs the opener link, so popup.closed is unreliable). On
  // the signal we re-read the now-persisted members and the card arms itself. No
  // intermediary explainer sheet — the card's CTA acts directly. Popup blocked →
  // full-page fallback.
  function connectSubaccount() {
    if (demo) return;
    const popup = window.open('/agent-connect?arm=1', 'suize-agent-arm', 'width=460,height=760');
    if (!popup) {
      window.location.href = '/agent-connect?arm=1';
      return;
    }
    let poll = 0;
    let ch: BroadcastChannel | null = null;
    const finish = () => {
      if (poll) window.clearInterval(poll);
      ch?.close();
      agent.reloadMembers();
      try {
        popup.close();
      } catch {
        /* COOP may block the parent closing it — harmless, the card already updated */
      }
    };
    try {
      ch = new BroadcastChannel('suize-agent-arm');
      ch.onmessage = (e: MessageEvent) => {
        if ((e.data as { type?: string })?.type === 'armed') finish();
      };
    } catch {
      ch = null;
    }
    // ONLY poll popup.closed when BroadcastChannel is unavailable — on modern browsers
    // the channel is the signal, and polling closed just spams the COOP warning.
    if (!ch) {
      poll = window.setInterval(() => {
        try {
          if (popup.closed) finish();
        } catch {
          /* COOP-blocked read */
        }
      }, 400);
    }
    window.setTimeout(() => {
      if (poll) window.clearInterval(poll);
      ch?.close();
    }, 300_000);
  }

  // ── the resizable assistant column (width persists across sessions) ────────
  const [asideW, setAsideW] = useState(() => {
    try {
      const saved = Number(localStorage.getItem(ASIDE_KEY));
      if (saved >= ASIDE_MIN && saved <= ASIDE_MAX) return saved;
    } catch {
      /* private mode */
    }
    return 384;
  });
  const dragRef = useRef<{ x: number; w: number } | null>(null);
  const dragCleanupRef = useRef<(() => void) | null>(null);
  function onDragStart(e: React.PointerEvent) {
    dragRef.current = { x: e.clientX, w: asideW };
    const move = (ev: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      setAsideW(Math.min(ASIDE_MAX, Math.max(ASIDE_MIN, d.w + (d.x - ev.clientX))));
    };
    const up = () => {
      dragRef.current = null;
      dragCleanupRef.current = null;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      setAsideW((w) => {
        try {
          localStorage.setItem(ASIDE_KEY, String(w));
        } catch {
          /* private mode */
        }
        return w;
      });
    };
    dragCleanupRef.current = up;
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }
  // a mid-drag unmount must not leak the window listeners
  useEffect(() => () => dragCleanupRef.current?.(), []);

  return (
    <div className="rd-deck">
      <header className="rd-mast">
        <div className="rd-mast__left">
          <span className="rd-wordmark" aria-label="Suize">
            SUIZE
          </span>
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
          {onOpenBusiness ? (
            <button type="button" className="rd-btn" onClick={onOpenBusiness}>
              <Landmark size={13} strokeWidth={ICON_STROKE} aria-hidden />
              Business
            </button>
          ) : null}
          <div className="rd-mast__bal">
            <span className="rd-mast__ballabel">{WALLET.totalLabel}</span>
            <span className={`rd-mast__balnum${paidFlash ? ' is-paid' : ''}`}>
              {money(yourMoney + agentBalance)}
            </span>
          </div>
          {/* the identity sits at the masthead's RIGHT edge on BOTH faces (owner) */}
          {onSignOut ? (
            <IdentityMenu handle={displayHandle} address={ownerAddress} onSignOut={onSignOut} />
          ) : (
            <span className="rd-mast__handle rd-handle">{displayHandle}</span>
          )}
        </div>
      </header>

      <div className="rd-deck__grid" style={{ gridTemplateColumns: `minmax(0, 1fr) 10px ${asideW}px` }}>
        {/* ── THE MONEY — first, always ── */}
        <div className="rd-deck__main">
          <div className="rd-deck__pots">
            {/* YOUR MONEY — calm ink + the classic wallet verbs */}
            <article className="rd-pot">
              <span className="rd-label">{WALLET.books.your.label}</span>
              <span className="rd-pot__num">{money(yourMoney)}</span>
              <span className="rd-pot__note">{WALLET.books.your.note}</span>
              <div className="rd-pot__acts">
                <button type="button" className="rd-btn rd-btn--accent" onClick={() => setSheet('addFunds')}>
                  <Plus size={13} strokeWidth={ICON_STROKE} aria-hidden />
                  {WALLET.books.your.actions[0]}
                </button>
                <button type="button" className="rd-btn" disabled={busy} onClick={() => setSheet('send')}>
                  <SendIcon size={13} strokeWidth={ICON_STROKE} aria-hidden />
                  {WALLET.books.your.actions[1]}
                </button>
              </div>
            </article>
            {/* AGENT — the hot money: the multisig sub-account balance is its cap.
                Fund grows it; the user withdraws it back in one tap (MAIN member). */}
            <article className="rd-pot rd-pot--hot">
              <span className="rd-label">{WALLET.books.agent.label}</span>
              {agentConnected ? (
                <>
                  <span className={`rd-pot__num rd-pot__num--grad${paidFlash ? ' rd-debit-flash' : ''}`}>
                    {money(agentBalance)}
                  </span>
                  <span className="rd-pot__note">
                    {agentOn ? WALLET.books.agent.note : WALLET.books.agent.pausedNote}
                  </span>
                  <div className="rd-pot__acts">
                    <button
                      type="button"
                      className="rd-btn rd-btn--accent"
                      disabled={busy}
                      onClick={() => setSheet('fundAgent')}
                    >
                      <Plus size={13} strokeWidth={ICON_STROKE} aria-hidden />
                      {WALLET.books.agent.fund}
                    </button>
                    <button
                      type="button"
                      className="rd-btn"
                      disabled={demo || busy}
                      onClick={() => setSheet('withdrawAgent')}
                    >
                      <ArrowDown size={13} strokeWidth={ICON_STROKE} aria-hidden />
                      {WALLET.books.agent.withdraw}
                    </button>
                    {/* the SINGLE agent on/off control (the old chat "Agent enabled"
                        toggle lives here now) — pause stops it spending; resume re-arms */}
                    <button
                      type="button"
                      className="rd-btn"
                      disabled={demo}
                      onClick={() => setAgentOn((v) => !v)}
                    >
                      {agentOn ? (
                        <Pause size={13} strokeWidth={ICON_STROKE} aria-hidden />
                      ) : (
                        <Play size={13} strokeWidth={ICON_STROKE} aria-hidden />
                      )}
                      {agentOn ? WALLET.books.agent.pause : WALLET.books.agent.resume}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <span className="rd-pot__num rd-pot__num--grad">{money(0)}</span>
                  <span className="rd-pot__note">{WALLET.books.agent.empty}</span>
                  <div className="rd-pot__acts">
                    <button
                      type="button"
                      className="rd-btn rd-btn--accent"
                      onClick={connectSubaccount}
                    >
                      <Plus size={13} strokeWidth={ICON_STROKE} aria-hidden />
                      {WALLET.books.agent.emptyCta}
                    </button>
                  </div>
                </>
              )}
            </article>
          </div>

          {/* SUBSCRIPTIONS — the violet card */}
          <section className="rd-secard rd-secard--subs">
            <div className="rd-secard__head">
              <span className="rd-secard__icon" aria-hidden="true">
                <RefreshCw size={14} strokeWidth={ICON_STROKE} />
              </span>
              <h3 className="rd-secard__title">{WALLET.books.subsTitle}</h3>
              <span className="rd-sec__meta">{WALLET.books.subsMeta}</span>
            </div>
            <SubsList
              subs={subs}
              busy={busy}
              empty={WALLET.books.emptySubs}
              onCancel={demo ? undefined : (key) => setCancelSub(subs.find((s) => s.key === key) ?? null)}
            />
            {/* the silent-renew toasts (push-not-pull: each period paid inline) */}
            {subsApi.toasts.map((t) => (
              <p key={t.id} className="rd-sheet__note" role="status">
                {t.message}
              </p>
            ))}
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
            <ActivityList rows={activity} empty={WALLET.books.emptyActivity} />
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
          <AssistantPanel
            demo={demo}
            agentOn={agentOn}
            onBooked={demo ? dm.onBooked : undefined}
          />
        </aside>
      </div>

      {/* ── THE MONEY SHEETS ── */}
      {sheet === 'addFunds' ? (
        <AddFundsSheet handle={displayHandle} requestEnabled={demo} onClose={() => setSheet(null)} />
      ) : null}
      {sheet === 'send' ? (
        <SendSheet available={yourMoney} onSend={onSend} claimEnabled={demo} onClose={() => setSheet(null)} />
      ) : null}
      {sheet === 'fundAgent' ? (
        <FundAgentSheet available={yourMoney} onFund={onFundAgent} onClose={() => setSheet(null)} />
      ) : null}
      {sheet === 'withdrawAgent' ? (
        <WithdrawAgentSheet
          balance={agentBalance}
          onWithdraw={onWithdrawAgent}
          onClose={() => setSheet(null)}
        />
      ) : null}
      {cancelSub ? (
        <CancelSubSheet
          label={cancelSub.name}
          perMonth={cancelSub.perMonth}
          onConfirm={onConfirmCancel}
          onClose={() => setCancelSub(null)}
        />
      ) : null}
    </div>
  );
}
