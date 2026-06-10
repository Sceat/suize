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
}

export interface LedgerRow {
  id: string;
  what: string;
  when: string;
  amount: number | null;
  /** real explorer link when present; absent rows render no verify arrow */
  verifyHref?: string;
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
          <span className="rd-line__body">{s.name}</span>
          <span className="rd-line__when">{s.renews}</span>
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
          <div className="rd-line rd-line--roomy" key={a.id}>
            <span className={`rd-dir rd-dir--${dir}`} aria-hidden="true">
              {dir === 'in' ? (
                <ArrowDown size={12} strokeWidth={2} />
              ) : dir === 'out' ? (
                <ArrowUpRight size={12} strokeWidth={2} />
              ) : null}
            </span>
            <span className="rd-line__body">{a.what}</span>
            <span className="rd-line__when">{a.when}</span>
            <span className="rd-line__dots" />
            {a.amount != null ? (
              <span className="rd-line__amt rd-line__amt--money">{signedMoney(a.amount)}</span>
            ) : null}
            {a.verifyHref ? (
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
      <b>Fully non-custodial</b> — your keys never leave your machine. Every payment is signed by your
      own login; Suize never signs for you.
    </p>
  );
}

/** "2d" / "3w" / "now" — the compact timestamp the single-line rows need */
export function compactWhen(ts: number): string {
  if (!ts) return '';
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 90) return 'now';
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  if (s < 86400 * 21) return `${Math.round(s / 86400)}d`;
  return `${Math.round(s / (86400 * 7))}w`;
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
