/**
 * CornerLog — the persistent ACTIVITY feed as a compact widget pinned bottom-right.
 *
 * The feed is no longer one of the main sections (it left the accordion). It now
 * lives as an always-visible corner widget: a small header (a quiet pulse dot +
 * "Activity" + chevron) with the NEWEST one or two entries peeking under it, that
 * EXPANDS on click to reveal the full reverse-chronological feed (scrolls
 * internally, capped height). Compact, calm, journal-styled — no emojis.
 *
 * Every row is a STRICT single line that never wraps:
 *   [status dot, flex-none] [body, flex:1 truncating ellipsis] [time ~3ch] [amount, flex-none mono right]
 * The source kicker ("Spending"/"Investing"/…) is no longer inline text inside the
 * truncating cell — it became the leading status dot's TONE. Bodies are plain text
 * (no innerHTML) with title={body} so the full text shows on hover.
 *
 * Fed by the EXISTING feed data (`home.state.log: LogEntry[]`). In production
 * (`demo` false) it renders the REAL rows, and an honest "No activity yet" empty
 * state when the feed is empty — NEVER fabricated activity. The journal's literal
 * SEED_ROWS render ONLY under the DEV `?preview` hatch (`demo` true), so the populated
 * design stays reviewable without leaking fake figures to a real user.
 *
 * The CSS lives in src/system/tokens-journal.css (`.clog*`), scoped under `.journal`.
 * It is fixed-positioned, so it sits above the no-scroll frame in the corner.
 */
import { useMemo, useState, type ReactNode } from 'react';
import type { LogEntry, LogKind, LogOutcome } from '../../data/types';
import { relShort, usd, pct } from '../../data/format';
import { ChevronDown, ICON_STROKE } from '../../system';

// ── handle/address detection — wrap any "<name>@suize" handle or "0x…" address in
// the shared .handle gradient (orange→red), keeping the rest of the body plain text.
// Single regex, single pass; if a row has no handle the body renders unchanged.
const HANDLE_RE = /([A-Za-z0-9._-]+@suize|0x[0-9a-fA-F]{4,})/g;

function renderBody(body: string): ReactNode {
  const parts = body.split(HANDLE_RE);
  // split with a capturing group yields [plain, match, plain, match, …]; odd
  // indices are the captured handle/address tokens.
  if (parts.length === 1) return body;
  return parts.map((part, i) =>
    i % 2 === 1 ? (
      <span key={i} className="handle">
        {part}
      </span>
    ) : (
      part
    ),
  );
}

// ── the compact row shape (dot tone · plain-text body · relative time · mono value) ──
interface LogRow {
  id: string;
  time: string;
  src: string;
  body: string;
  value: string;
  tone: 'good' | 'cy' | 'mute';
}

// ── the journal's literal seed (newest first) — DEV ?preview hatch ONLY (demo true) ──
// bodies are PLAIN TEXT (no <b>); the time is a short literal ('2m','1h','Mon'…).
const SEED_ROWS: LogRow[] = [
  { id: 'seed-0', time: '2m', src: 'Investing', body: 'Passive earned yield on USDC', value: '+$3.20', tone: 'good' },
  { id: 'seed-1', time: '25m', src: 'Spending', body: 'Paid alice@suize', value: '−$50.00', tone: 'mute' },
  { id: 'seed-2', time: '49m', src: 'Investing', body: 'GameFi placed a small bet on Crash', value: '$5.00', tone: 'cy' },
  { id: 'seed-3', time: '51m', src: 'Investing', body: 'GameFi · Crash round won', value: '+$8.40', tone: 'good' },
  { id: 'seed-4', time: '1h', src: 'Main', body: 'You moved money to AI Investing', value: '+$200.00', tone: 'mute' },
  { id: 'seed-5', time: '2h', src: 'Investing', body: 'Degen took profit on a momentum trade', value: '+$12.10', tone: 'good' },
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

function adapt(entry: LogEntry): LogRow {
  const { value, tone } = valueFor(entry.outcome);
  return {
    id: entry.id,
    time: relShort(entry.ts),
    src: sourceFor(entry.kind),
    body: entry.title, // plain text — rendered safely, no innerHTML
    value,
    tone,
  };
}

export interface CornerLogProps {
  /** the existing reverse-chronological activity feed (newest first). */
  entries: LogEntry[];
  /**
   * DEV-ONLY design preview flag. `true` ONLY under `?preview` → fall back to SEED_ROWS
   * when the real feed is empty so the populated design is reviewable. `false` in
   * production → render the REAL rows, and an honest "No activity yet" when empty.
   */
  demo: boolean;
}

export function CornerLog({ entries, demo }: CornerLogProps) {
  const [open, setOpen] = useState(false);
  // Real rows always; SEED_ROWS only as the DEV-preview fallback for an empty feed.
  const rows = useMemo<LogRow[]>(
    () =>
      entries.length > 0 ? entries.map(adapt) : demo ? SEED_ROWS : [],
    [entries, demo],
  );

  const isEmpty = rows.length === 0;

  // the always-visible peek = the newest 2 rows
  const peek = rows.slice(0, 2);

  return (
    <aside
      className={`clog${open ? ' open' : ''}`}
      aria-label="Activity"
    >
      <button
        type="button"
        className="clog__head"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="clog__dot" aria-hidden="true" />
        <span className="clog__lab">Activity</span>
        <ChevronDown
          className="clog__chev"
          size={11}
          strokeWidth={ICON_STROKE}
          aria-hidden
        />
      </button>

      {/* the compact peek (newest entries), always visible under the head.
          Honest empty state when there is no real activity (production, empty feed). */}
      {!open ? (
        <div className="clog__peek">
          {isEmpty ? (
            <div className="clog__empty">No activity yet</div>
          ) : (
            peek.map((r) => <Row key={r.id} r={r} />)
          )}
        </div>
      ) : null}

      {/* the full feed, revealed on expand (scrolls internally) */}
      <div className="clog__body" role="region" aria-label="Full activity">
        <div className="clog__full">
          {isEmpty ? (
            <div className="clog__empty">No activity yet</div>
          ) : (
            rows.map((r) => <Row key={r.id} r={r} />)
          )}
        </div>
      </div>
    </aside>
  );
}

function Row({ r }: { r: LogRow }) {
  return (
    <div className="clog__row">
      {/* the source kicker is now the leading dot's TONE (out of the truncating cell) */}
      <span className={`clog__dot ${r.tone}`} aria-hidden="true" />
      <span className="clog__b" title={r.body}>
        {renderBody(r.body)}
      </span>
      <span className="clog__t">{r.time}</span>
      {r.value ? (
        <span className={`clog__v ${r.tone}`}>{r.value}</span>
      ) : (
        <span className="clog__v mute" aria-hidden="true" />
      )}
    </div>
  );
}

export default CornerLog;
