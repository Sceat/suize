/**
 * Shared MONEY surfaces (visual-first, owner law): the live subscriptions list,
 * the verifiable activity ledger, the custody note. PROP-DRIVEN — production
 * feeds real `useAccount` data; the DEV demo seam feeds the sample books.
 * `useDemoMoney` is the demo-only balance choreography (the SF booking tick).
 */
import { useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUpRight } from '../system';
import { WALLET, money, signedMoney } from './copy';

export interface SubRow {
  key: string;
  name: string;
  renews: string;
  perMonth: number;
  /** the sub-account can't cover the next period (coverage must never silently lie) */
  warn?: boolean;
}

export interface LedgerRow {
  id: string;
  /** the action word ("Sent" / "Paid" / "Received" / "Subscribed" / …). */
  what: string;
  /** the counterparty token — a `name@suize` handle, a `.sui` name, or a short 0x…
   *  address — rendered with its identity gradient (handle = red-orange, address =
   *  blue). Absent for actions with no counterparty ("Topped up"). */
  who?: string;
  /** the compact-but-exact stamp shown inline ("14:32" today · "13 Jun 14:32" · "13 Jun 2025"). */
  when: string;
  /** the full to-the-second timestamp, surfaced on hover (the "when exactly" proof). */
  whenTitle?: string;
  amount: number | null;
  /** real explorer link when present; absent rows render no verify arrow */
  verifyHref?: string;
  /** an OPTIMISTIC row mid-confirmation — shows "confirming…", no verify link */
  pending?: boolean;
}

/** Classify a counterparty token for its identity gradient: a hex address is a
 *  `num` (blue), a `name@suize`/`.sui` handle is a `handle` (red-orange), anything
 *  else (a bare merchant label like "Netflix") is `plain` ink. */
function tokenKind(t: string): 'num' | 'handle' | 'plain' {
  if (/^0x/i.test(t)) return 'num';
  if (t.includes('@') || /\.sui$/i.test(t)) return 'handle';
  return 'plain';
}

/** Render a counterparty token in its identity gradient (handles red-orange, numbers
 *  blue) — the single place the owner's "handles vs numbers" colour law lives. */
export function Party({ token }: { token: string }) {
  const kind = tokenKind(token);
  if (kind === 'plain') return <>{token}</>;
  return <span className={kind === 'num' ? 'rd-grad-num' : 'rd-grad-handle'}>{token}</span>;
}

/** the live subscriptions — a LIST on the page, never something you ask for */
export function SubsList({
  subs,
  onCancel,
  busy = false,
  empty,
}: {
  subs: SubRow[];
  onCancel?: (key: string) => void;
  busy?: boolean;
  empty: string;
}) {
  if (subs.length === 0) return <p className="rd-empty-line">{empty}</p>;
  return (
    <div>
      {subs.map((s) => (
        <div className="rd-line rd-line--roomy" key={s.key}>
          <span className="rd-mono-chip" aria-hidden="true">
            {s.name[0]?.toUpperCase() ?? '·'}
          </span>
          <span className="rd-line__body">
            <Party token={s.name} />
          </span>
          <span className={`rd-line__when${s.warn ? ' is-warn' : ''}`}>{s.renews}</span>
          <span className="rd-line__dots" />
          <span className="rd-line__amt rd-line__amt--sub">{money(s.perMonth)}/mo</span>
          {onCancel ? (
            <button type="button" className="rd-line__cancel" disabled={busy} onClick={() => onCancel(s.key)}>
              {WALLET.books.cancel}
            </button>
          ) : null}
        </div>
      ))}
    </div>
  );
}

/** the verifiable trace — direction glyphs + blue money + real verify links */
export function ActivityList({ rows, empty }: { rows: LedgerRow[]; empty: string }) {
  if (rows.length === 0) return <p className="rd-empty-line">{empty}</p>;
  return (
    <div>
      {rows.map((a) => {
        const dir = a.amount == null ? 'none' : a.amount > 0 ? 'in' : 'out';
        return (
          <div className={`rd-line rd-line--roomy${a.pending ? ' is-pending' : ''}`} key={a.id}>
            <span className={`rd-dir rd-dir--${dir}`} aria-hidden="true">
              {dir === 'in' ? (
                <ArrowDown size={12} strokeWidth={2} />
              ) : dir === 'out' ? (
                <ArrowUpRight size={12} strokeWidth={2} />
              ) : null}
            </span>
            <span className="rd-line__body">
              {a.what}
              {a.who ? (
                <>
                  {' · '}
                  <Party token={a.who} />
                </>
              ) : null}
            </span>
            <span className="rd-line__when" title={a.pending ? undefined : a.whenTitle}>
              {a.pending ? WALLET.books.confirming : a.when}
            </span>
            <span className="rd-line__dots" />
            {a.amount != null ? (
              <span className="rd-line__amt rd-line__amt--money">{signedMoney(a.amount)}</span>
            ) : null}
            {a.pending ? (
              <span className="rd-line__spin" aria-label={WALLET.books.confirming} />
            ) : a.verifyHref ? (
              <a
                className="rd-line__verify"
                href={a.verifyHref}
                target="_blank"
                rel="noreferrer"
                title={WALLET.books.verify}
                aria-label={WALLET.books.verify}
              >
                ↗
              </a>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

export function CustodyNote() {
  return (
    <p className="rd-custody">
      <b>{WALLET.books.custodyLead}</b>
      {WALLET.books.custodyTail}
    </p>
  );
}

/**
 * The inline stamp — exact, but as short as the recency allows so the single line
 * never starves: just the time today ("14:32"), day+time this year ("13 Jun 14:32"),
 * day+month+year before that ("13 Jun 2025"). 24h, locale-aware. The to-the-second
 * truth rides the hover title (`fullWhen`).
 */
export function exactWhen(ts: number): string {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
  if (d.toDateString() === now.toDateString()) return time;
  const day = d.getDate();
  const mon = d.toLocaleString(undefined, { month: 'short' });
  if (d.getFullYear() === now.getFullYear()) return `${day} ${mon} ${time}`;
  return `${day} ${mon} ${d.getFullYear()}`;
}

/** The full to-the-second timestamp for the hover title ("13 Jun 2026, 14:32:08"). */
export function fullWhen(ts: number): string {
  if (!ts) return '';
  return new Date(ts).toLocaleString(undefined, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

/** "renews in 9 days" from the last charge + the period */
export function renewsIn(lastChargedMs: number, periodMs: number): string {
  if (!periodMs) return '';
  const next = lastChargedMs + periodMs;
  const days = Math.max(0, Math.ceil((next - Date.now()) / 86400000));
  return days === 0 ? 'renews today' : `renews in ${days} day${days === 1 ? '' : 's'}`;
}

// ── DEMO-ONLY (the DEV seam) — the SF-booking balance choreography ────────────

export function useDemoMoney() {
  const reduce = useMemo(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    [],
  );
  const [balance, setBalance] = useState<number>(WALLET.balanceStart);
  const [yourMoney, setYourMoney] = useState<number>(WALLET.books.your.amount);
  const [paidFlash, setPaidFlash] = useState(false);
  const [booked, setBooked] = useState(false);
  const tickingRef = useRef(false);

  function onBooked() {
    if (tickingRef.current) return;
    tickingRef.current = true;
    setBooked(true);
    setPaidFlash(true);
    const start = WALLET.balanceStart;
    const end = WALLET.balanceStart - WALLET.flightAmount;
    if (reduce) {
      setBalance(end);
      return;
    }
    const t0 = performance.now();
    const DUR = 900;
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / DUR);
      const eased = 1 - Math.pow(1 - p, 3);
      setBalance(start + (end - start) * eased);
      if (p < 1) requestAnimationFrame(tick);
      else setBalance(end);
    };
    requestAnimationFrame(tick);
  }

  const topUp = (amt: number) => {
    const a = Math.min(amt, yourMoney);
    setYourMoney((v) => v - a);
    setBalance((v) => v + a);
  };
  const withdraw = (amt: number) => {
    const a = Math.min(amt, balance);
    setBalance((v) => v - a);
    setYourMoney((v) => v + a);
  };
  const send = (amt: number) => setYourMoney((v) => Math.max(0, v - amt));

  return { balance, yourMoney, paidFlash, booked, onBooked, topUp, withdraw, send };
}
