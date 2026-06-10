import { forwardRef, useImperativeHandle, useRef, useState } from 'react'
import { ACTIVITY_ROWS, LOCKED_RECORD_TIP } from '../config'
import { IconCheck } from '../ui'

// per-kind leading glyph — a small monochrome mark so each ledger row reads as
// what it WAS (a saver, a spend, a kill, a note), not a uniform list. Matches
// the ConfirmSequence kind language so the notification → log story is one
// family. currentColor lets the kind class tint it.
const KIND_GLYPH = {
  save: (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M8 3v8M8 11 4.8 7.8M8 11l3.2-3.2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  spend: (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M8 13V5M8 5 4.8 8.2M8 5l3.2 3.2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  kill: (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="5.2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M4.6 4.6 11.4 11.4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  ),
  note: (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="1.4" fill="currentColor" />
      <circle cx="8" cy="8" r="5.4" stroke="currentColor" strokeWidth="1.3" opacity="0.6" />
    </svg>
  ),
}

// ============================================================================
// <ActivityLog> — the alive ledger (consensus §3 / §4 STATION 3). The ledger
// lives IN the water: NO boxed card, NO outer border — each row is a thin,
// SHARP-cornered liquid-glass LAMINA at a slightly different Z, newest top,
// bobbing, fading into the fog (history receding). The two hero rows (green
// `+$9.99 saved`, red `You hit kill — agent stopped`) pulse once, brighter.
//
// The confirm moment (<ConfirmSequence>) holds a ref and calls `prepend(row)`
// when its confirm banner settles — so the approved notification springs into
// the top lamina, the notification→ledger continuity that IS the story.
// Newest-first.
//
// LAWS: no boxed card, no dots, no rounded chrome — the laminae are sharp glass
// panes adrift; the `Locked record` tag is the pill-less sharp gradient tag.
// HONESTY: the `Locked record` tooltip says "checkable, not editable" — never
// the mainnet-immutability overclaim. Amounts are illustrative sample figures,
// never a /pricing tier. (No "testnet" tag is rendered on the home.)
// ============================================================================

// a single small "locked record" affordance per row — icon-only (the words are
// NOT repeated on every row; the meaning lives in the tooltip + one header
// caption). It translates "saved on-chain" into a plain trust mark — no tech name.
function LockedRecord() {
  return (
    <span className="sx-lr" title={LOCKED_RECORD_TIP} aria-label="Locked record — checkable, not editable">
      <span className="sx-lr__check" aria-hidden="true">
        <IconCheck size={11} />
      </span>
    </span>
  )
}

// each row is a floating glass lamina; `depth` (its index from the top) eases
// it back into the fog — newer = forward + clearer, older = receding + dimmer.
function Row({ row, flash, depth = 0 }) {
  return (
    <div
      className={`sx-lamina sx-lamina--${row.kind}${flash ? ' is-fresh' : ''}${
        row.hero ? ' is-hero' : ''
      }`}
      style={{ '--lam-z': depth }}
    >
      <span className="sx-lamina__hair" aria-hidden="true" />
      <span className="sx-arow__what">
        <span className={`sx-arow__kind sx-arow__kind--${row.kind}`} aria-hidden="true">
          {KIND_GLYPH[row.kind] || KIND_GLYPH.note}
        </span>
        {row.what}
      </span>
      <span className="sx-arow__when">{row.when}</span>
      <span className="sx-arow__amt">{row.amount}</span>
      <LockedRecord />
    </div>
  )
}

// `seed` lets a caller (the WalletDemo) render a SHORTER static list than the
// full home log; default is the full design-consensus deck.
const ActivityLog = forwardRef(function ActivityLog(
  { seed = ACTIVITY_ROWS, compact = false },
  apiRef,
) {
  // rows live in state so the demo can prepend a confirmed one
  const [rows, setRows] = useState(() => seed)
  const freshId = useRef(null)

  useImperativeHandle(
    apiRef,
    () => ({
      // prepend a confirmed notification as a new ledger row (newest-first),
      // flagged fresh so it springs in + flashes once
      prepend(row) {
        const id = `live-${Date.now()}`
        freshId.current = id
        setRows(prev => [{ ...row, id, when: 'just now' }, ...prev])
      },
    }),
    [],
  )

  return (
    <div className={`sx-laminae${compact ? ' sx-laminae--compact' : ''}`}>
      <div className="sx-laminae__head">
        <span className="ed-eyebrow">Activity</span>
        {/* the "locked record" idea, surfaced ONCE here (the per-row check is the
            silent affordance — its meaning lives in this caption + the tooltip) */}
        <span className="sx-laminae__locked" title={LOCKED_RECORD_TIP}>
          <span className="sx-laminae__lockedcheck" aria-hidden="true">
            <IconCheck size={10} />
          </span>
          Every row is a locked record
        </span>
      </div>
      <div className="sx-laminae__rows">
        {rows.map((row, i) => (
          <Row
            key={row.id}
            row={row}
            depth={i}
            // hero rows flash on land; a live-prepended row flashes once too
            flash={row.hero || row.id === freshId.current}
          />
        ))}
      </div>
    </div>
  )
})

export default ActivityLog
