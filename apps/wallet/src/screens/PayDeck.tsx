/**
 * PayDeck — the signed-in v1 wallet face: the PAY deck + the verifiable monitoring deck.
 *
 * THE MENTAL MODEL (two cards):
 *   • "Your money"  — the user's OWN wallet USDC balance (read from chain).
 *   • "Agent money" — the shared `Account<USDC>` balance (read via balance_value).
 * Plus the primitives as clean actions (Deposit / Spend / Withdraw / Subscribe), a
 * stacked list of active subscriptions with a coverage line, and THE verifiable
 * activity timeline — the on-chain event trace, the centerpiece.
 *
 * Everything is rendered in the LOCKED broadsheet language (the `.journal` scope): the
 * SUIZE Hashgraph wordmark, Space Grotesk words, Martian-Mono BLUE money, Newsreader
 * editorial titles, fading hairlines, the breathing dot, the custom cursor (mounted by
 * App's Shell). Non-custodial framing in the footnote. Honest empty/zero states.
 *
 * Wiring: `useAccount` holds the reads + the sponsored writes; this composes the UI and
 * opens the right `PayActionSheet` per action.
 */

import { useState } from 'react';
import { useSuiClient } from '@mysten/dapp-kit';
import { ACCOUNT_PUBLISHED } from '@suize/shared';
import { useAccount } from '../data/useAccount';
import { SuizeWordmark } from '../system/Wordmark';
import { useTheme } from '../system/theme';
import { Plus, ArrowUpRight, ArrowUp, ICON_STROKE } from '../system';
import type { SuiClient } from '../data/suins';
import { ActivityTimeline } from '../components/pay/ActivityTimeline';
import { Subscriptions } from '../components/pay/Subscriptions';
import { PayActionSheet, type PayAction, type PaySubmit } from '../components/pay/PayActionSheet';
import type { Activity, Subscription } from '../data/payTypes';

// ── DEV-ONLY demo seed (tree-shaken from production via import.meta.env.DEV) ──
// Lets `?preview=home&demo=1` paint a populated deck (sample subs + timeline) so the
// founder can see the in-use state before testnet has real activity. NEVER ships: the
// whole branch is behind `import.meta.env.DEV` in the component below.
const DEMO_SUBS: Subscription[] = [
  {
    subKey: '1',
    payee: '0x9a3f7c2e8b1d4056a7c9e0f1b2d3a4c5e6f70819a2b3c4d5e6f7081920a3b4c5',
    periodCapRaw: '19990000',
    periodCapUi: 19.99,
    periodMs: 30 * 24 * 60 * 60 * 1000,
    lastChargedMs: Date.now() - 6 * 24 * 60 * 60 * 1000,
    label: 'Deploy by Suize',
  },
  {
    subKey: '0',
    payee: '0x4d2e6b8a0c1f3759e8a7b6c5d4e3f201a9b8c7d6e5f40312a1b2c3d4e5f60718',
    periodCapRaw: '9000000',
    periodCapUi: 9.0,
    periodMs: 30 * 24 * 60 * 60 * 1000,
    lastChargedMs: Date.now() - 20 * 24 * 60 * 60 * 1000,
    label: 'datafeed.xyz',
  },
];
const D = Date.now();
const DEMO_ACTIVITY: Activity[] = [
  { id: 'd1', ts: D - 2 * 60_000, kind: 'spend', title: 'Paid', detail: '0x9a3f…b4c5 · weather API', amountRaw: '20000', amountUi: 0.02, flow: 'out', txDigest: 'demo7c41a2b8c9d0e1f2a3b4c5d6e7f8091a2b3c4d5e6f7081920a3b4c5d6e788f' },
  { id: 'd2', ts: D - 38 * 60_000, kind: 'charge', title: 'Subscription charged', detail: 'Deploy by Suize', amountRaw: '19990000', amountUi: 19.99, flow: 'out', txDigest: 'demo3b9d1f2a3b4c5d6e7f8091a2b3c4d5e6f7081920a3b4c5d6e7f8091a2b3c4' },
  { id: 'd3', ts: D - 5 * 60 * 60_000, kind: 'deposit', title: 'Topped up', detail: 'Wallet → Agent money', amountRaw: '100000000', amountUi: 100, flow: 'in', txDigest: 'demo5e6f7081920a3b4c5d6e7f8091a2b3c4d5e6f7081920a3b4c5d6e7f8091a2' },
  { id: 'd4', ts: D - 26 * 60 * 60_000, kind: 'sub-created', title: 'New subscription', detail: 'Deploy by Suize', amountRaw: '19990000', amountUi: 19.99, flow: 'none', txDigest: 'demo1920a3b4c5d6e7f8091a2b3c4d5e6f7081920a3b4c5d6e7f8091a2b3c4d5e' },
  { id: 'd5', ts: D - 3 * 24 * 60 * 60_000, kind: 'created', title: 'Agent wallet created', detail: 'Non-custodial · your keys', amountRaw: null, amountUi: null, flow: 'none', txDigest: 'demo081920a3b4c5d6e7f8091a2b3c4d5e6f7081920a3b4c5d6e7f8091a2b3c4d' },
];

/** "$1,200.00" — the broadsheet number, grouped, two decimals. */
function money(n: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export interface PayDeckProps {
  /** the signed-in zkLogin owner address. */
  ownerAddress: string;
  /** the resolved "<name>@suize" handle, or '' until resolved. */
  handle: string;
  /** DEV-only: overlay sample subs + activity (the populated design state). Never in prod. */
  demo?: boolean;
}

export function PayDeck({ ownerAddress, handle, demo = false }: PayDeckProps) {
  const client = useSuiClient() as unknown as SuiClient;
  const { toggle } = useTheme();
  const api = useAccount(ownerAddress, handle);
  const { state, pending } = api;

  // Which action sheet is open (null = none).
  const [sheet, setSheet] = useState<PayAction | null>(null);

  // DEV-only populated state for design capture (tree-shaken in production).
  const showDemo = import.meta.env.DEV && demo;
  const subscriptions = showDemo ? DEMO_SUBS : state.subscriptions;
  const activity = showDemo ? DEMO_ACTIVITY : state.activity;

  const display = state.handle || '…@suize';
  const hasAccount = showDemo ? true : state.accountId != null;
  const walletUi = showDemo ? 248.0 : state.wallet.ui;
  const agentUi = showDemo ? 80.42 : state.agent.ui;

  // The available balance the open sheet caps against (USDC base units).
  const available =
    sheet === 'deposit'
      ? BigInt(state.wallet.raw)
      : sheet === 'spend' || sheet === 'withdraw'
        ? BigInt(state.agent.raw)
        : BigInt(state.wallet.raw); // subscribe: no hard cap, but show the wallet as context

  const busy = pending != null;

  async function onSubmit(s: PaySubmit): Promise<void> {
    if (!sheet) return;
    if (sheet === 'deposit') await api.deposit(s.amountRaw);
    else if (sheet === 'withdraw') await api.withdraw(s.amountRaw);
    else if (sheet === 'spend')
      await api.spend({ amountRaw: s.amountRaw, payee: s.payee ?? '', memo: s.memo ?? '' });
    else if (sheet === 'subscribe')
      await api.createSubscription({
        payee: s.payee ?? '',
        periodCapRaw: s.amountRaw,
        periodMs: s.periodMs ?? 30 * 24 * 60 * 60 * 1000,
        label: s.label,
      });
  }

  return (
    <div className="journal">
      <div className="amb" aria-hidden="true" />

      {/* ── MASTHEAD — wordmark + handle (left); the grand total + theme mark (right). ── */}
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
              {money(walletUi + agentUi)}
            </span>
          </div>
          <button className="thememark" type="button" onClick={toggle} aria-label="Toggle theme">
            <i />
          </button>
        </div>
      </header>

      <main className="pay">
        {/* honest publish-gate banner — reads work; writes wait for the testnet publish. */}
        {!ACCOUNT_PUBLISHED ? (
          <div className="pay-gate" role="status">
            <span className="pay-gate__dot" aria-hidden="true" />
            <span className="pay-gate__txt">
              Live payments turn on the moment the Suize <b>account</b> contract is published to
              testnet. Until then your balances and the verifiable trace read straight from chain —
              the actions are ready and wired.
            </span>
          </div>
        ) : null}

        {/* ── THE TWO CARDS ── */}
        <section className="pay-deck" aria-label="Your balances">
          {/* Your money — the wallet USDC balance. */}
          <article className="pay-card">
            <span className="pay-card__label">Your money</span>
            <span className="pay-card__title">In your wallet</span>
            <span className="pay-card__num">
              <span className="pay-card__cur">$</span>
              {money(walletUi)}
              <span className="pay-card__unit">USDC</span>
            </span>
            <span className="pay-card__cap">
              The money only you can move. Top up your agent to let it pay.
            </span>
            <div className="pay-card__acts">
              <button
                type="button"
                className="pay-btn pay-btn--primary"
                onClick={() => setSheet('deposit')}
                disabled={busy}
              >
                <Plus size={14} strokeWidth={ICON_STROKE} aria-hidden />
                Top up agent
              </button>
            </div>
          </article>

          {/* Agent money — the Account<USDC> balance. */}
          <article className="pay-card">
            <span className="pay-card__label">Agent money</span>
            <span className="pay-card__title">Ready to spend</span>
            <span className="pay-card__num">
              <span className="pay-card__cur">$</span>
              {money(agentUi)}
              <span className="pay-card__unit">USDC</span>
            </span>
            <span className="pay-card__cap">
              {hasAccount
                ? 'Spend it freely — the full amount lands with the payee, no fee.'
                : 'Empty until you top up. The deposit is the only cap.'}
            </span>
            <div className="pay-card__acts">
              <button
                type="button"
                className="pay-btn"
                onClick={() => setSheet('spend')}
                disabled={busy || agentUi <= 0}
              >
                <ArrowUpRight size={14} strokeWidth={ICON_STROKE} aria-hidden />
                Pay
              </button>
              <button
                type="button"
                className="pay-btn"
                onClick={() => setSheet('withdraw')}
                disabled={busy || agentUi <= 0}
              >
                <ArrowUp size={14} strokeWidth={ICON_STROKE} aria-hidden />
                Take back
              </button>
            </div>
          </article>
        </section>

        {/* ── SUBSCRIPTIONS ── */}
        <section className="pay-sec" aria-label="Subscriptions">
          <div className="pay-sec__head">
            <h2 className="pay-sec__title">Subscriptions</h2>
            <span className="pay-sec__meta">
              {subscriptions.length > 0
                ? `${subscriptions.length} active`
                : 'Approve once, capped per month'}
            </span>
          </div>
          <div className="rule" />
          <Subscriptions
            subscriptions={subscriptions}
            agentUi={agentUi}
            published={ACCOUNT_PUBLISHED || showDemo}
            busy={busy}
            onAdd={() => setSheet('subscribe')}
            onCancel={(subKey) => void api.cancelSubscription(subKey)}
          />
        </section>

        {/* ── THE VERIFIABLE ACTIVITY TIMELINE — the centerpiece. ── */}
        <section className="pay-sec" aria-label="Activity">
          <div className="pay-sec__head">
            <h2 className="pay-sec__title">Activity</h2>
            <span className="pay-sec__meta">Read straight from chain · every row checkable</span>
          </div>
          <div className="rule" />
          <ActivityTimeline
            activity={activity}
            published={ACCOUNT_PUBLISHED || showDemo}
            hasAccount={hasAccount}
          />
        </section>

        {/* ── THE NON-CUSTODIAL FOOTNOTE ── */}
        <p className="pay-footnote">
          <b>Fully non-custodial.</b> Every payment is signed by your own login on your own machine —
          Suize never holds your keys or your funds, and never signs for you. Your money never leaves
          your wallet until you move it.
        </p>
      </main>

      {/* the action sheet, per action */}
      {sheet ? (
        <PayActionSheet
          action={sheet}
          availableRaw={available}
          client={client}
          busy={busy}
          onClose={() => setSheet(null)}
          onSubmit={onSubmit}
        />
      ) : null}
    </div>
  );
}

export default PayDeck;
