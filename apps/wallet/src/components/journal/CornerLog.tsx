/**
 * CornerLog — the persistent activity LOG as a compact widget pinned bottom-right.
 *
 * The log is no longer one of the main sections (it left the accordion). It now
 * lives as an always-visible corner widget: a small header (a quiet pulse dot +
 * "Log" + chevron) with the NEWEST one or two entries peeking under it, that
 * EXPANDS on click to reveal the full reverse-chronological feed (scrolls
 * internally, capped height). Compact, calm, journal-styled — no emojis.
 *
 * Fed by the EXISTING log data (`home.state.log: LogEntry[]`). When the real log is
 * empty it shows the journal's literal seed so the formed page reads identically to
 * the mockup — display rows only, never fabricated on-chain figures.
 *
 * The CSS lives in src/system/tokens-journal.css (`.clog*`), scoped under `.journal`.
 * It is fixed-positioned, so it sits above the no-scroll frame in the corner.
 */
import { useMemo, useState } from 'react';
import type { LogEntry, LogKind, LogOutcome } from '../../data/types';
import { clock, usd, pct } from '../../data/format';
import { ChevronDown, ICON_STROKE } from '../../system';

// ── the compact row shape (mono src · serif body · mono value) ──────────────────
interface LogRow {
  id: string;
  time: string;
  src: string;
  body: string;
  value: string;
  tone: 'good' | 'cy' | 'mute';
}

// ── the journal's literal seed (newest first) — used when the real log is empty ──
const SEED_ROWS: LogRow[] = [
  { id: 'seed-0', time: '09:41', src: 'Investing', body: 'Passive earned yield on USDC', value: '+$3.20', tone: 'good' },
  { id: 'seed-1', time: '09:18', src: 'Spending', body: 'Paid <b>alice@suize</b>', value: '−$50.00', tone: 'mute' },
  { id: 'seed-2', time: '08:52', src: 'Investing', body: 'GameFi placed a small bet on <b>Crash</b>', value: '$5.00', tone: 'cy' },
  { id: 'seed-3', time: '08:50', src: 'Investing', body: 'GameFi · Crash round won', value: '+$8.40', tone: 'good' },
  { id: 'seed-4', time: '08:30', src: 'Main', body: 'You moved money to AI Investing', value: '+$200.00', tone: 'mute' },
  { id: 'seed-5', time: '07:55', src: 'Investing', body: 'Degen took profit on a momentum trade', value: '+$12.10', tone: 'good' },
];

function sourceFor(kind: LogKind): string {
  switch (kind) {
    case 'spend':
      return 'Spending';
    case 'lend':
    case 'trim':
    case 'guardian':
      return 'Investing';
    default:
      return 'Suize';
  }
}

function valueFor(outcome: LogOutcome): { value: string; tone: LogRow['tone'] } {
  switch (outcome.type) {
    case 'locked':
      return { value: `+${usd(outcome.usd, { cents: false })}`, tone: 'good' };
    case 'up':
      return { value: outcome.pct != null ? pct(outcome.pct) : 'up', tone: 'good' };
    case 'down':
      return { value: outcome.pct != null ? pct(outcome.pct) : 'down', tone: 'mute' };
    case 'reverted':
      return { value: 'reverted', tone: 'mute' };
    default:
      return { value: '', tone: 'mute' };
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function adapt(entry: LogEntry): LogRow {
  const { value, tone } = valueFor(entry.outcome);
  return {
    id: entry.id,
    time: clock(entry.ts),
    src: sourceFor(entry.kind),
    body: escapeHtml(entry.title),
    value,
    tone,
  };
}

export interface CornerLogProps {
  /** the existing reverse-chronological activity feed (newest first). */
  entries: LogEntry[];
}

export function CornerLog({ entries }: CornerLogProps) {
  const [open, setOpen] = useState(false);
  const rows = useMemo<LogRow[]>(
    () => (entries.length > 0 ? entries.map(adapt) : SEED_ROWS),
    [entries],
  );

  // the always-visible peek = the newest 2 rows
  const peek = rows.slice(0, 2);

  return (
    <aside
      className={`clog${open ? ' open' : ''}`}
      aria-label="Activity log"
    >
      <button
        type="button"
        className="clog__head"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="clog__dot" aria-hidden="true" />
        <span className="clog__lab">Log</span>
        <ChevronDown
          className="clog__chev"
          size={11}
          strokeWidth={ICON_STROKE}
          aria-hidden
        />
      </button>

      {/* the compact peek (newest entries), always visible under the head */}
      {!open ? (
        <div className="clog__peek">
          {peek.map((r) => (
            <Row key={r.id} r={r} />
          ))}
        </div>
      ) : null}

      {/* the full feed, revealed on expand (scrolls internally) */}
      <div className="clog__body" role="region" aria-label="Full activity log">
        <div className="clog__full">
          {rows.map((r) => (
            <Row key={r.id} r={r} />
          ))}
        </div>
      </div>
    </aside>
  );
}

function Row({ r }: { r: LogRow }) {
  return (
    <div className="clog__row">
      <span className="clog__t">{r.time}</span>
      <span className="clog__b">
        <span className="src">{r.src}</span>
        <span dangerouslySetInnerHTML={{ __html: r.body }} />
      </span>
      {r.value ? (
        <span className={`clog__v ${r.tone}`}>{r.value}</span>
      ) : (
        <span className="clog__v mute" aria-hidden="true" />
      )}
    </div>
  );
}

export default CornerLog;
