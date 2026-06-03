/** Pure formatting helpers — shared by every screen. No state, no side effects. */

import { ScopeTag } from './types';
import type { ScopeTag as ScopeTagT } from './types';

/** "$4,210.00" — always two decimals, grouped, tabular. */
export function usd(n: number, opts?: { cents?: boolean }): string {
  const cents = opts?.cents ?? true;
  return n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: cents ? 2 : 0,
    maximumFractionDigits: cents ? 2 : 0,
  });
}

/** "+2.1%" / "-0.4%" with sign. */
export function pct(fraction: number, digits = 1): string {
  const sign = fraction > 0 ? '+' : fraction < 0 ? '' : '';
  return `${sign}${(fraction * 100).toFixed(digits)}%`;
}

/** "09:42" 24h clock from epoch ms. */
export function clock(ts: number): string {
  return new Date(ts).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** "14s ago" / "11m ago" / "2h ago" — compact relative time. */
export function relative(ts: number, from = Date.now()): string {
  const s = Math.max(0, Math.round((from - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

/** Shorten a hex digest: 0x7c41…788f */
export function shortHash(digest: string): string {
  if (digest.length <= 12) return digest;
  return `${digest.slice(0, 6)}…${digest.slice(-4)}`;
}

const SCOPE_LABELS: Record<ScopeTagT, string> = {
  [ScopeTag.NaviSupply]: 'NAVI supply',
  [ScopeTag.NaviWithdraw]: 'NAVI withdraw',
  [ScopeTag.DeepbookSwap]: 'DeepBook swap',
  [ScopeTag.Spend]: 'Pay / transfer',
};

export function scopeLabel(tag: ScopeTagT): string {
  return SCOPE_LABELS[tag] ?? `scope ${tag}`;
}
