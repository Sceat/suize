/**
 * Subscriptions — the stacked list of active recurring authorizations, read from the
 * `suize::account` events (SubscriptionCreated minus SubscriptionCancelled), with a
 * per-row cancel and a "your balance covers ~N months" coverage line.
 *
 * Coverage is derived honestly from the agent balance ÷ the per-period cap (the cap is
 * the WORST case — the most it could ever charge), so "covers ~N months" is a floor,
 * never an optimistic guess. Low coverage (< 1 period) turns the line warn-colored — a
 * true status, not decoration. The per-period price is Martian-Mono BLUE money.
 */

import { Plus, X, ICON_STROKE } from '../../system';
import type { Subscription } from '../../data/payTypes';

/** "$19.99" from a UI amount. */
function money(n: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** A human cadence from a period in ms ("/mo", "/wk", "/yr", or "/Nd"). */
function cadence(periodMs: number): string {
  const days = Math.round(periodMs / (24 * 60 * 60 * 1000));
  if (days >= 28 && days <= 31) return '/mo';
  if (days === 7) return '/wk';
  if (days >= 364 && days <= 366) return '/yr';
  if (days === 1) return '/day';
  return `/${days}d`;
}

/** How many full periods the agent balance covers at this cap. */
function coverage(agentRawUi: number, capUi: number): number {
  if (capUi <= 0) return Infinity;
  return Math.floor(agentRawUi / capUi);
}

function SubRow({
  sub,
  agentUi,
  onCancel,
  busy,
}: {
  sub: Subscription;
  agentUi: number;
  onCancel: (subKey: string) => void;
  busy: boolean;
}) {
  const periods = coverage(agentUi, sub.periodCapUi);
  const unit = cadence(sub.periodMs).replace('/', '');
  const low = periods < 1;
  const coverText = low
    ? `Balance won’t cover the next ${unit}`
    : periods === Infinity
      ? 'No cap set'
      : `Balance covers ~${periods} ${unit}${periods === 1 ? '' : 's'}`;

  return (
    <div className="pay-sub">
      <span className="pay-sub__meta">
        <span className="pay-sub__name">{sub.label}</span>
        <span className={`pay-sub__cover${low ? ' is-low' : ''}`}>{coverText}</span>
      </span>
      <span className="pay-sub__price">
        ${money(sub.periodCapUi)}
        <span className="pay-sub__cadence"> {cadence(sub.periodMs)}</span>
      </span>
      <button
        type="button"
        className="pay-sub__cancel"
        onClick={() => onCancel(sub.subKey)}
        disabled={busy}
        title="Cancel this subscription"
      >
        <X size={13} strokeWidth={ICON_STROKE} aria-hidden />
        Cancel
      </button>
    </div>
  );
}

export interface SubscriptionsProps {
  subscriptions: Subscription[];
  /** the agent balance (UI USDC) — drives the coverage line. */
  agentUi: number;
  published: boolean;
  busy: boolean;
  onCancel: (subKey: string) => void;
  onAdd: () => void;
}

export function Subscriptions({
  subscriptions,
  agentUi,
  published,
  busy,
  onCancel,
  onAdd,
}: SubscriptionsProps) {
  return (
    <>
      {subscriptions.length === 0 ? (
        <div className="pay-empty">
          <span className="pay-empty__title">No subscriptions yet.</span>
          <span className="pay-empty__sub">
            Approve a recurring charge once — for example “Deploy by Suize — $19.99/mo”. It can only
            ever take the capped amount, to one fixed payee, once per period.
          </span>
          <button
            type="button"
            className="pay-btn pay-btn--primary"
            style={{ alignSelf: 'flex-start', marginTop: 6 }}
            onClick={onAdd}
            disabled={busy || !published}
          >
            <Plus size={14} strokeWidth={ICON_STROKE} aria-hidden />
            Add a subscription
          </button>
        </div>
      ) : (
        <>
          <div className="pay-subs">
            {subscriptions.map((s) => (
              <SubRow key={s.subKey} sub={s} agentUi={agentUi} onCancel={onCancel} busy={busy} />
            ))}
          </div>
          <button
            type="button"
            className="pay-btn"
            style={{ alignSelf: 'flex-start', marginTop: 14 }}
            onClick={onAdd}
            disabled={busy || !published}
          >
            <Plus size={14} strokeWidth={ICON_STROKE} aria-hidden />
            Add a subscription
          </button>
        </>
      )}
    </>
  );
}
