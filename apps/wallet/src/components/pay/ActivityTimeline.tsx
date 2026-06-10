/**
 * ActivityTimeline — the verifiable trace. A reverse-chronological feed of the
 * `suize::account` module's on-chain EVENTS (Spent / Charged / Deposited / Withdrawn /
 * SubscriptionCreated / Cancelled / AccountCreated), read straight from chain.
 *
 * Each row is human-readable: a glyph + a "what" headline + a memo/payee detail, the
 * amount in Martian-Mono BLUE (money is always blue; the +/− sign carries direction —
 * green/red are reserved for true status, never flow), and a tappable "verify ↗" link
 * to the explorer for the tx digest. THIS is the "receipt you can check," not a log you
 * trust. Honest empty state when there's no activity yet.
 */

import {
  ArrowUpRight,
  ArrowDown,
  ArrowUp,
  RefreshCw,
  CreditCard,
  BadgeCheck,
  ExternalLink,
  X,
  ICON_STROKE,
} from '../../system';
import { EXPLORER_TX } from '../../lib/env';
import { relShort } from '../../data/format';
import type { Activity, ActivityKind } from '../../data/payTypes';

/** The lucide glyph per activity kind. */
function Glyph({ kind }: { kind: ActivityKind }) {
  const props = { size: 14, strokeWidth: ICON_STROKE, 'aria-hidden': true } as const;
  switch (kind) {
    case 'spend':
      return <ArrowUpRight {...props} />;
    case 'charge':
      return <CreditCard {...props} />;
    case 'deposit':
      return <ArrowDown {...props} />;
    case 'withdraw':
      return <ArrowUp {...props} />;
    case 'sub-created':
      return <RefreshCw {...props} />;
    case 'sub-cancelled':
      return <X {...props} />;
    case 'created':
      return <BadgeCheck {...props} />;
    default:
      return <ArrowUpRight {...props} />;
  }
}

/** "$12.50" from a UI amount. */
function money(n: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function Row({ a }: { a: Activity }) {
  const sign = a.flow === 'out' ? '−' : a.flow === 'in' ? '+' : '';
  return (
    <div className="pay-row">
      <span className="pay-row__glyph">
        <Glyph kind={a.kind} />
      </span>
      <span className="pay-row__meta">
        <span className="pay-row__title">{a.title}</span>
        {a.detail ? <span className="pay-row__detail">{a.detail}</span> : null}
      </span>
      <span className="pay-row__right">
        {a.amountUi != null ? (
          <span className="pay-row__amt">
            {sign}${money(a.amountUi)}
          </span>
        ) : (
          <span className="pay-row__amt is-none">—</span>
        )}
        <a
          className="pay-row__verify"
          href={EXPLORER_TX(a.txDigest)}
          target="_blank"
          rel="noopener noreferrer"
          title="Check this on the block explorer"
        >
          verify
          <ExternalLink size={11} strokeWidth={ICON_STROKE} aria-hidden />
        </a>
        {a.ts > 0 ? <span className="pay-row__time">{relShort(a.ts)}</span> : null}
      </span>
    </div>
  );
}

export interface ActivityTimelineProps {
  activity: Activity[];
  /** true before the account package is live — explains why there's nothing yet. */
  published: boolean;
  /** true when the account exists (vs never created). */
  hasAccount: boolean;
}

export function ActivityTimeline({ activity, published, hasAccount }: ActivityTimelineProps) {
  if (activity.length === 0) {
    return (
      <div className="pay-empty">
        <span className="pay-empty__title">No activity yet.</span>
        <span className="pay-empty__sub">
          {!published
            ? 'Every payment, top-up, and subscription will appear here as a verifiable on-chain receipt the moment the contract goes live on testnet.'
            : !hasAccount
              ? 'Top up your agent money to make your first move — it lands here as a receipt you can check on the explorer.'
              : 'Your first payment will appear here with a tappable “verify ↗” link to the chain.'}
        </span>
      </div>
    );
  }

  return (
    <div className="pay-feed">
      {activity.map((a) => (
        <Row key={a.id} a={a} />
      ))}
    </div>
  );
}
