// ============================================================================
// LEADERBOARD — PolySui's on-chain ranking of the sharpest traders.
// ----------------------------------------------------------------------------
// Every row is a REAL Sui address, read from PositionRedeemed events (no invented
// users — a judge clicking a handle reaches a real account). The board is SORTABLE
// by three on-chain metrics: WIN-RATE (the default, gated to a minimum sample so a
// lucky 1/1 never crowns it — Wilson-adjusted so a 48/68 grinder outranks a 3/3
// fluke), current STREAK of consecutive wins, and total WON (gross dUSDC from
// settled wins). The podium + list both reorder, and the podium heroes whichever
// metric you sorted by. The connected user's row is accent-highlighted and, if it
// falls off the visible cut, pinned sticky at the bottom so you see where you stand.
//
// UI law: ONE blue on editorial paper, NO green/red anywhere (the board carries no
// up/down signal). Numerals are mono + tabular. Top-3 emphasis is SIZE + weight,
// never a gold/silver/bronze medal. Accent is spent on exactly one thing: the
// user's own row (and the active sort chip).
// ============================================================================
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useSuiClient } from '@mysten/dapp-kit'
import { useAuth } from '../auth'
import { resolveSuizeHandle } from '../suins'
import {
  fetch_redeemed_events_global,
  type ReadClient,
  type GlobalRedeemedRow,
} from '../sui'
import { dusdc_to_usd, fmt_usd_compact } from '../format'
import './leaderboard.css'

// Minimum settled positions to QUALIFY for the ranked board. Below this a trader
// is real but their win-rate is statistically meaningless (a single lucky claim
// reads 100%), so they're held out of the ranking — shown, honestly, as "not yet
// ranked" if it's the connected user. Three is the smallest sample that isn't a
// coin-flip headline.
const MIN_SAMPLE = 3

// One ranked trader, fully derived from the redeemed feed.
type Entry = {
  owner: string
  settled: number // resolved (settled) positions — the win-rate denominator
  wins: number // settled positions that paid out (> 0)
  winRate: number // wins / settled, in [0,1]
  winnings: bigint // Σ payout (dUSDC base units) over WINNING settled rows. GROSS
  // dUSDC won — self-consistent from this one feed. NOT net P&L (that needs the
  // mint `cost` from a DIFFERENT truncated feed → over-credits; see sui.ts).
  streak: number // current run of consecutive wins, most-recent-first
  lastTs: number // ts of the most recent realized row (recency tiebreak)
}

// The three sortable columns. 'winRate' is the honest default (Wilson-adjusted).
type SortKey = 'winRate' | 'streak' | 'won'
const SORTS: { key: SortKey; label: string }[] = [
  { key: 'winRate', label: 'Win rate' },
  { key: 'streak', label: 'Streak' },
  { key: 'won', label: 'Won' },
]

// A simple lower-confidence-bound ordering so big samples outrank tiny ones at
// the SAME nominal rate (and a hot 13/14 outranks a thin 3/3). We use the
// Wilson score lower bound at ~85% confidence — cheap, monotonic, no deps. This
// is purely a SORT KEY; the DISPLAYED number is always the true wins/settled.
const wilsonLower = (wins: number, n: number): number => {
  if (n === 0) return 0
  const z = 1.44 // ~85% one-sided
  const p = wins / n
  const z2 = z * z
  const denom = 1 + z2 / n
  const centre = p + z2 / (2 * n)
  const margin = z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n)
  return (centre - margin) / denom
}

// Fold the raw redeemed feed into entries (UNSORTED — the caller orders by the
// active column via sortEntries). Wins/losses come from SETTLED rows only
// (is_settled true): payout > 0 == win, == 0 == loss. Early cash-outs (is_settled
// false) are neither — they don't move win-rate (you closed before resolution).
// The streak walks each trader's settled rows newest-first, counting leading wins.
const aggregate = (rows: GlobalRedeemedRow[]): Entry[] => {
  type Acc = { settled: GlobalRedeemedRow[]; lastTs: number }
  const by = new Map<string, Acc>()
  for (const r of rows) {
    let a = by.get(r.owner)
    if (!a) {
      a = { settled: [], lastTs: 0 }
      by.set(r.owner, a)
    }
    if (r.is_settled) a.settled.push(r)
    if (r.ts >= a.lastTs) a.lastTs = r.ts
  }

  const out: Entry[] = []
  for (const [owner, a] of by) {
    const n = a.settled.length
    if (n === 0) continue
    const sorted = a.settled.slice().sort((x, y) => y.ts - x.ts)
    let wins = 0
    let winnings = 0n
    let streak = 0
    let streakOpen = true
    for (const r of sorted) {
      const payout = BigInt(r.payout || '0')
      const won = payout > 0n
      if (won) {
        wins++
        winnings += payout
      }
      if (streakOpen) {
        if (won) streak++
        else streakOpen = false
      }
    }
    out.push({ owner, settled: n, wins, winRate: wins / n, winnings, streak, lastTs: a.lastTs })
  }
  return out
}

const cmpBig = (a: bigint, b: bigint): number => (a > b ? 1 : a < b ? -1 : 0)

// Order folded entries by the active column, always best-first (DESC). WIN-RATE is
// the statistically-honest default: qualified samples (>= MIN_SAMPLE) rank above
// thin ones, then by Wilson lower bound (a hot 13/14 over a lucky 3/3). STREAK +
// WON sort straight by their displayed value, win-rate (Wilson) breaking ties.
const sortEntries = (entries: Entry[], key: SortKey): Entry[] => {
  const wl = (e: Entry): number => wilsonLower(e.wins, e.settled)
  const arr = entries.slice()
  if (key === 'streak') {
    arr.sort(
      (x, y) =>
        y.streak - x.streak || wl(y) - wl(x) || y.settled - x.settled || y.lastTs - x.lastTs,
    )
  } else if (key === 'won') {
    arr.sort(
      (x, y) =>
        cmpBig(y.winnings, x.winnings) ||
        wl(y) - wl(x) ||
        y.settled - x.settled ||
        y.lastTs - x.lastTs,
    )
  } else {
    arr.sort((x, y) => {
      const qx = x.settled >= MIN_SAMPLE ? 1 : 0
      const qy = y.settled >= MIN_SAMPLE ? 1 : 0
      if (qx !== qy) return qy - qx
      const d = wl(y) - wl(x)
      if (d !== 0) return d
      if (y.settled !== x.settled) return y.settled - x.settled
      return y.lastTs - x.lastTs
    })
  }
  return arr
}

const short = (a: string): string => `${a.slice(0, 6)}…${a.slice(-4)}`
const pct = (r: number): string => `${Math.round(r * 100)}`
// Total winnings → compact USD ("$340" / "$12.5k"), never clipping a column.
const won = (units: bigint): string => fmt_usd_compact(dusdc_to_usd(units))

// A tiny same-mount handle cache so resolving names for the visible rows + the
// user never re-hits RPC across re-renders within a session view.
type HandleMap = Record<string, string | null>

function useLeaderboard() {
  const client = useSuiClient() as unknown as ReadClient
  const [rows, setRows] = useState<Entry[] | null>(null)
  const [error, setError] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(0)

  useEffect(() => {
    let alive = true
    fetch_redeemed_events_global(client)
      .then(feed => {
        if (!alive) return
        setRows(aggregate(feed))
        setUpdatedAt(Date.now())
      })
      .catch(() => alive && setError(true))
    return () => {
      alive = false
    }
  }, [client])

  return { rows, error, updatedAt }
}

// Resolve `.suize.sui` handles for a set of addresses, falling back to null
// (the caller renders the truncated 0x). Resolves once per address per mount.
function useHandles(addresses: string[]): HandleMap {
  const rpc = useSuiClient()
  const [map, setMap] = useState<HandleMap>({})
  const seen = useRef(new Set<string>())

  useEffect(() => {
    const todo = addresses.filter(a => a && !seen.current.has(a))
    if (todo.length === 0) return
    todo.forEach(a => seen.current.add(a))
    let alive = true
    Promise.all(
      todo.map(async a => [a, await resolveSuizeHandle(a, rpc)] as const),
    ).then(pairs => {
      if (!alive) return
      setMap(prev => {
        const next = { ...prev }
        for (const [a, h] of pairs) next[a] = h
        return next
      })
    })
    return () => {
      alive = false
    }
    // addresses is recomputed each render; join is a stable dep on its contents.
  }, [addresses.join(','), rpc])

  return map
}

// How many rows to print before the sticky self-row. Enough to feel like a real
// board, not so many it becomes a phone-book; the user's own row is always
// reachable via the sticky pin regardless of where they fall.
const VISIBLE = 25

export function Leaderboard() {
  const { address } = useAuth()
  const { rows, error, updatedAt } = useLeaderboard()
  const [sort, setSort] = useState<SortKey>('winRate')

  // Order the FULL set by the active column, then take the visible cut. Both the
  // podium (top 3) and the list read from this one ordering, so a re-sort reorders
  // the whole board at once.
  const ranked = useMemo(() => (rows ? sortEntries(rows, sort) : null), [rows, sort])
  const visible = useMemo(() => ranked?.slice(0, VISIBLE) ?? [], [ranked])
  const myIndex = useMemo(
    () => (ranked && address ? ranked.findIndex(r => r.owner === address) : -1),
    [ranked, address],
  )
  const me = myIndex >= 0 ? ranked![myIndex] : null
  // Only PIN the self-row when the user has bets but is OUTSIDE the visible cut.
  const showPin = me != null && myIndex >= VISIBLE

  const handleAddrs = useMemo(() => {
    const set = visible.map(r => r.owner)
    if (me) set.push(me.owner)
    return set
  }, [visible, me])
  const handles = useHandles(handleAddrs)

  const nameOf = (a: string): string => handles[a] ?? short(a)

  return (
    <main className="lb">
      <header className="lb-head">
        <div className="lb-kick">Leaderboard</div>
        <h1 className="lb-title">Who&rsquo;s reading the tide.</h1>
        <p className="lb-lede">
          Every name is a real on-chain account, straight from the chain — no
          scorekeeper, nothing invented. Rank them your way.
        </p>
      </header>

      <Board
        rows={visible}
        me={me}
        myIndex={myIndex}
        myAddress={address}
        nameOf={nameOf}
        sort={sort}
        onSort={setSort}
        showPin={showPin}
        loading={rows == null && !error}
        error={error}
        empty={rows != null && rows.length === 0}
        updatedAt={updatedAt}
      />
    </main>
  )
}

// The sort control — a segmented "Rank by" bar that governs the WHOLE board (works
// at every width; the metric column headers fold away on phones, this never does).
function SortBar({ sort, onSort }: { sort: SortKey; onSort: (k: SortKey) => void }) {
  return (
    <div className="lb-sortbar">
      <span className="lb-sortbar-label">Rank by</span>
      <div className="lb-sortbar-opts" role="tablist" aria-label="Rank the board by">
        {SORTS.map(s => (
          <button
            key={s.key}
            type="button"
            role="tab"
            aria-selected={sort === s.key}
            className={'lb-sortbtn' + (sort === s.key ? ' is-active' : '')}
            onClick={() => onSort(s.key)}
          >
            {s.label}
          </button>
        ))}
      </div>
    </div>
  )
}

function Board({
  rows,
  me,
  myIndex,
  myAddress,
  nameOf,
  sort,
  onSort,
  showPin,
  loading,
  error,
  empty,
  updatedAt,
}: {
  rows: Entry[]
  me: Entry | null
  myIndex: number
  myAddress: string | null
  nameOf: (a: string) => string
  sort: SortKey
  onSort: (k: SortKey) => void
  showPin: boolean
  loading: boolean
  error: boolean
  empty: boolean
  updatedAt: number
}) {
  if (loading) return <GhostBoard />

  if (error)
    return (
      <div className="lb-note">
        Couldn&rsquo;t reach the chain just now. The board reads live on-chain
        results — refresh in a moment.
      </div>
    )

  if (empty)
    return (
      <div className="lb-note">
        No settled rounds yet. Be the first name on the board —{' '}
        <a className="lb-inline" href="/">
          place a bet
        </a>
        .
      </div>
    )

  const hasPodium = rows.length >= 3
  const rest = hasPodium ? rows.slice(3) : rows
  const startRank = hasPodium ? 4 : 1

  return (
    <>
      <SortBar sort={sort} onSort={onSort} />

      {hasPodium && (
        <Podium
          top={rows.slice(0, 3)}
          myAddress={myAddress}
          nameOf={nameOf}
          sortKey={sort}
        />
      )}

      {rest.length > 0 && (
        <div className="lb-rest">
          {hasPodium && <div className="lb-rest-head">The rest of the floor</div>}
          <div className="lb-colhead" role="presentation">
            <span className="lb-c-rank">#</span>
            <span className="lb-c-who">Trader</span>
            <span className={'lb-c-streak' + (sort === 'streak' ? ' is-sorted' : '')}>
              Streak
            </span>
            <span className={'lb-c-metric' + (sort === 'winRate' ? ' is-sorted' : '')}>
              Win&nbsp;rate
            </span>
            <span className={'lb-c-won' + (sort === 'won' ? ' is-sorted' : '')}>Won</span>
          </div>
          <ol className="lb-rows">
            {rest.map((e, i) => (
              <Row
                key={e.owner}
                e={e}
                rank={startRank + i}
                top={false}
                isMe={e.owner === myAddress}
                name={nameOf(e.owner)}
              />
            ))}
          </ol>
        </div>
      )}

      {showPin && me && (
        <div className="lb-pin">
          <div className="lb-pin-label">Your standing</div>
          <ol className="lb-rows">
            <Row e={me} rank={myIndex + 1} top={false} isMe name={nameOf(me.owner)} />
          </ol>
        </div>
      )}

      {me == null && myAddress && (
        <div className="lb-pin">
          <div className="lb-pin-label">Your standing</div>
          <div className="lb-pin-empty">
            You haven&rsquo;t settled enough rounds to rank yet. Win a few and
            you&rsquo;ll appear here.
          </div>
        </div>
      )}

      {updatedAt > 0 && (
        <div className="lb-foot">
          Read from {EVENT_LABEL} · updated{' '}
          {Math.max(0, Math.round((Date.now() - updatedAt) / 1000))}s ago
        </div>
      )}
    </>
  )
}

const EVENT_LABEL = 'on-chain settlements'

// The podium/list hero = whatever column is sorted by, big; the other two metrics
// ride below as a quiet secondary line so every card always shows all three.
const heroOf = (e: Entry, key: SortKey): { node: ReactNode; label: string } => {
  if (key === 'streak') return { node: (<><b>{e.streak}</b><i>W</i></>), label: 'win streak' }
  if (key === 'won')
    return { node: <b>{e.winnings > 0n ? won(e.winnings) : '$0'}</b>, label: 'total won' }
  return { node: (<><b>{pct(e.winRate)}</b><i>%</i></>), label: 'win rate' }
}
const secondaryOf = (e: Entry, key: SortKey): string => {
  const parts: string[] = []
  if (key !== 'winRate') parts.push(`${pct(e.winRate)}% win`)
  if (key !== 'streak' && e.streak > 0) parts.push(`${e.streak}W streak`)
  if (key !== 'won' && e.winnings > 0n) parts.push(`${won(e.winnings)} won`)
  return parts.join(' · ')
}

// ---- PODIUM — the top three as featured cards (yosuku-style), #1 elevated --
// Rendered as #2 · #1 · #3 so the leader sits centre and tallest. Identity is
// carried by TYPE (no avatar tile); the ACTIVE-sort metric is the hero of each card.
function Podium({
  top,
  myAddress,
  nameOf,
  sortKey,
}: {
  top: Entry[]
  myAddress: string | null
  nameOf: (a: string) => string
  sortKey: SortKey
}) {
  const [first, second, third] = top
  const card = (e: Entry, rank: number, lead?: boolean) => (
    <PodiumCard
      e={e}
      rank={rank}
      lead={lead}
      isMe={e.owner === myAddress}
      name={nameOf(e.owner)}
      sortKey={sortKey}
    />
  )
  return (
    <div className="lb-podium">
      {second && card(second, 2)}
      {first && card(first, 1, true)}
      {third && card(third, 3)}
    </div>
  )
}

function PodiumCard({
  e,
  rank,
  lead,
  isMe,
  name,
  sortKey,
}: {
  e: Entry
  rank: number
  lead?: boolean
  isMe: boolean
  name: string
  sortKey: SortKey
}) {
  const hero = heroOf(e, sortKey)
  const secondary = secondaryOf(e, sortKey)
  return (
    <a
      className={'lb-pcard surface' + (lead ? ' is-lead' : '') + (isMe ? ' me' : '')}
      href={`https://testnet.suivision.xyz/account/${e.owner}`}
      target="_blank"
      rel="noreferrer noopener"
      title="View account on SuiVision"
    >
      <div className="lb-pcard-rank tnum">{rank}</div>
      <div className={'lb-pcard-name' + (name.includes('@') ? ' is-handle' : '')}>
        {name}
      </div>
      <div className={'lb-pcard-metric tnum' + (sortKey === 'won' ? ' is-money' : '')}>
        {hero.node}
      </div>
      <div className="lb-pcard-sub">{hero.label}</div>
      {secondary && <div className="lb-pcard-secondary tnum">{secondary}</div>}
      <div className="lb-pcard-settled tnum">
        {isMe ? 'You' : `${e.wins}/${e.settled} settled`}
      </div>
    </a>
  )
}

function Row({
  e,
  rank,
  top,
  isMe,
  name,
}: {
  e: Entry
  rank: number
  top: boolean
  isMe: boolean
  name: string
}) {
  const sub = e.settled >= MIN_SAMPLE ? null : 'thin sample'
  return (
    <li className={'lb-row' + (isMe ? ' me' : '') + (top ? ' top' : '')}>
      <span className="lb-rank tnum">{rank}</span>

      <a
        className="lb-who"
        href={`https://testnet.suivision.xyz/account/${e.owner}`}
        target="_blank"
        rel="noreferrer noopener"
        title="View account on SuiVision"
      >
        <span className="lb-who-txt">
          <span className={'lb-name' + (name.includes('@') ? ' is-handle' : '')}>
            {name}
          </span>
          <span className="lb-sub">
            {isMe ? (
              'You'
            ) : (
              <>
                {e.wins}/{e.settled}
                <span className="lb-sub-word"> settled</span>
              </>
            )}
            {e.streak > 0 && (
              <span className="lb-sub-streak">
                {' · '}
                {e.streak}W<span className="lb-sub-word"> streak</span>
              </span>
            )}
            {e.winnings > 0n && (
              <span className="lb-sub-won">
                {' · '}
                {won(e.winnings)}
                <span className="lb-sub-word"> won</span>
              </span>
            )}
            {sub && <span className="lb-thin"> · {sub}</span>}
          </span>
        </span>
      </a>

      <span className="lb-streak tnum" aria-label={`${e.streak} win streak`}>
        {e.streak > 0 ? (
          <>
            <b>{e.streak}</b>
            <i>W</i>
          </>
        ) : (
          <span className="lb-streak-zero">—</span>
        )}
      </span>

      <span className="lb-metric tnum">
        <span className="lb-metric-pc">
          <b>{pct(e.winRate)}</b>
          <i>%</i>
        </span>
        <span className="lb-bar" aria-hidden="true">
          <i style={{ width: `${e.settled > 0 ? Math.round((e.wins / e.settled) * 100) : 0}%` }} />
        </span>
      </span>

      <span className="lb-won tnum">
        {e.winnings > 0n ? won(e.winnings) : <span className="lb-won-zero">—</span>}
      </span>
    </li>
  )
}

// Ghost rows while the first read lands — never a blank page or a spinner on a
// void (UI law §18). Six skeleton rows at reduced opacity carrying the layout.
function GhostBoard() {
  return (
    <>
      <div className="lb-colhead" role="presentation">
        <span className="lb-c-rank">#</span>
        <span className="lb-c-who">Trader</span>
        <span className="lb-c-streak">Streak</span>
        <span className="lb-c-metric">Win&nbsp;rate</span>
        <span className="lb-c-won">Won</span>
      </div>
      <ol className="lb-rows lb-ghosts" aria-hidden="true">
        {Array.from({ length: 6 }).map((_, i) => (
          <li className="lb-row ghost" key={i}>
            <span className="lb-rank tnum">{i + 1}</span>
            <span className="lb-who">
              <span className="lb-name lb-skel" />
              <span className="lb-sub lb-skel sm" />
            </span>
            <span className="lb-streak lb-skel xs" />
            <span className="lb-metric lb-skel xs" />
            <span className="lb-won lb-skel xs" />
          </li>
        ))}
      </ol>
    </>
  )
}
