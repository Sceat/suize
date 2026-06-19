// ============================================================================
// PORTFOLIO — your positions, your proof. A routed dashboard screen (NOT the
// immersive Play surface). Two titled zones:
//   OPEN     — live positions, each with a ticking cash-out value + Cash Out
//   HISTORY  — settled rows (WIN / LOSS · stake · signed net · SuiVision ↗)
// Everything is reconstructed from CHAIN TRUTH (portfolio-data.ts) — it survives
// a refresh, a wiped cache, a new device. There is zero localStorage here.
//
// UI LAW: green/red is QUARANTINED to true signal — the win/loss verdict and the
// signed P&L ONLY. Every other figure (stake, accuracy, contracts, cash-out
// value, countdown) is ONE blue on editorial paper. Martian Mono on every
// numeral; Newsreader on titles; Space Grotesk on every word. Accent spent ~3×.
//
// Cash-out is HONEST single-source: the position + its live value are real
// (on-chain redeem quote), and the Cash Out button hands the user to Play — where
// the battle-tested gasless cash-out flow already runs. We never duplicate the
// sponsor/sign machinery here.
//
// CLAIM is the ONE write this screen makes: settled+won funds that were never
// redeemed (the on-chain payout sitting outside the wallet) get a "Non-redeemed
// funds" line + a Claim button that force-triggers the redeem. It reuses the
// SHARED gasless path (useGaslessSign — the same hook House uses), not a private
// copy, so there is still one signing machine; build_claim_tx is the same
// allowlisted redeem the Play auto-claim fires.
// ============================================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSuiClient } from '@mysten/dapp-kit'
import { useAuth } from '../auth'
import { useGaslessSign } from '../useGaslessSign'
import { build_claim_tx } from '../sui'
import {
  fmt_amount,
  fmt_countdown,
  fmt_pct,
  fmt_signed_cents,
  fmt_usd_amount,
  fmt_usd_compact,
} from '../format'
import {
  EMPTY_PORTFOLIO,
  loadPortfolio,
  refreshOpenQuotes,
  type HistoryRow,
  type OpenPosition,
  type PnlPoint,
  type PortfolioData,
} from './portfolio-data'
import './portfolio.css'

const SUIVISION_TX = 'https://testnet.suivision.xyz/txblock/'

// Chain-truth reload cadence (full re-reconcile) + the faster live cash-out
// quote tick. Declared together so the relationship is legible: the quote tick
// is read-only + cheap, the full reload re-pulls every feed.
const RELOAD_MS = 20_000
const QUOTE_MS = 4_000

// A live mm:ss countdown to a future expiry, ticking once a second (purely
// presentational — drives the "settling" flip the same way Play does).
function useCountdown(open: OpenPosition[]): number {
  const [, force] = useState(0)
  useEffect(() => {
    if (open.length === 0) return
    const id = setInterval(() => force(n => n + 1), 1000)
    return () => clearInterval(id)
  }, [open.length])
  return Date.now()
}

export function Portfolio() {
  const { address } = useAuth()
  const client = useSuiClient()
  const navigate = useNavigate()

  const [data, setData] = useState<PortfolioData>(EMPTY_PORTFOLIO)
  const [loading, setLoading] = useState(false)
  const [loadedOnce, setLoadedOnce] = useState(false)
  const openRef = useRef<OpenPosition[]>([])
  openRef.current = data.open

  // FULL reconcile from chain. Best-effort: a hiccup keeps the last good view.
  const reload = useCallback(async () => {
    if (!address) {
      setData(EMPTY_PORTFOLIO)
      setLoadedOnce(true)
      return
    }
    setLoading(true)
    try {
      const next = await loadPortfolio(client, address)
      // carry forward the last good live cash-out value so a freshly-reloaded
      // open ticket doesn't blink to "—" between the reload and the next quote.
      const prev = new Map(openRef.current.map(p => [p.key, p]))
      next.open = next.open.map(p => {
        const old = prev.get(p.key)
        return old && old.valueUsd != null
          ? { ...p, valueUsd: old.valueUsd, netUsd: old.valueUsd - p.paidUsd }
          : p
      })
      setData(next)
    } finally {
      setLoading(false)
      setLoadedOnce(true)
    }
  }, [address, client])

  // initial + slow full reload
  useEffect(() => {
    reload()
    const id = setInterval(reload, RELOAD_MS)
    return () => clearInterval(id)
  }, [reload])

  // fast live cash-out quotes for the OPEN tickets (read-only)
  useEffect(() => {
    if (!address || data.open.length === 0) return
    let alive = true
    const tick = async () => {
      const quoted = await refreshOpenQuotes(client, openRef.current, address)
      if (alive) setData(d => ({ ...d, open: quoted }))
    }
    tick()
    const id = setInterval(tick, QUOTE_MS)
    return () => {
      alive = false
      clearInterval(id)
    }
    // re-arm when the SET of open keys changes (not on every value tick)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, client, data.open.map(p => p.key).join(',')])

  const now = useCountdown(data.open)

  // ---- CLAIM non-redeemed funds (the ONE write on this screen) ----------------
  // Reuses the shared gasless path. De-atomized like Play's on-load sweep: one tx
  // per position so a single already-redeemed leg (e.g. the Play auto-claim raced
  // us) only skips itself instead of aborting the batch. Claimed keys are remembered
  // for the session so the line never flickers back while the redeemed feed catches
  // up; a full reload reconciles the wallet balance + drops them from chain truth.
  const { signAndExecute } = useGaslessSign()
  const [claiming, setClaiming] = useState(false)
  const [claimError, setClaimError] = useState<string | null>(null)
  const claimedKeys = useRef<Set<string>>(new Set())

  const claimAll = useCallback(async () => {
    const positions = data.claimable.filter(c => !claimedKeys.current.has(c.key))
    if (positions.length === 0 || claiming) return
    setClaiming(true)
    setClaimError(null)
    let ok = 0
    let lastErr = ''
    for (const p of positions) {
      try {
        const tx = build_claim_tx({
          manager_id: p.managerId,
          oracle_id: p.oracleId,
          expiry_ms: p.expiryMs,
          strike_1e9: p.strike1e9,
          is_up: p.isUp,
          quantity: p.quantity,
        })
        const res = await signAndExecute({ transaction: tx })
        await client.waitForTransaction({
          digest: res.digest,
          options: { showEffects: true },
        })
        claimedKeys.current.add(p.key)
        ok++
      } catch (e) {
        const msg = (e as Error).message ?? ''
        // Already redeemed elsewhere (the Play auto-claim got it first) is terminal,
        // not a failure — hide it too. Anything else is a real, retryable error.
        if (/already|redeem|moveabort|aborted/i.test(msg)) {
          claimedKeys.current.add(p.key)
          ok++
        } else {
          lastErr = msg
        }
      }
    }
    if (ok === 0 && lastErr)
      setClaimError('Couldn’t claim those funds — try again in a moment.')
    setClaiming(false)
    reload() // re-reconcile: claimed payout lands in the wallet, feed drops the row
  }, [data.claimable, claiming, signAndExecute, client, reload])

  if (!address) return <SignedOut />

  const hero = data.netUsd
  const heroSign = hero > 0 ? 'pos' : hero < 0 ? 'neg' : 'flat'
  // session-claimed rows stay hidden so the line never flickers back pre-reindex
  const claimable = data.claimable.filter(c => !claimedKeys.current.has(c.key))
  const claimableUsd = claimable.reduce((s, c) => s + c.grossUsd, 0)

  return (
    <main className="pf">
      {/* ---- HERO: aggregate realized Net P&L (one oversized number leads) ---- */}
      <header className="pf-hero ed-stream">
        <div className="pf-hero-l">
          <div className="pf-kick">Portfolio</div>
          <div className={'pf-net tnum ' + heroSign}>
            {data.history.length === 0 && !loadedOnce
              ? '—'
              : fmt_signed_cents(hero)}
          </div>
          <div className="pf-net-cap">Net profit · realized, all-time</div>
        </div>
        <dl className="pf-stats">
          <div className="pf-stat">
            <dt>Accuracy</dt>
            <dd className="tnum">
              {data.accuracy == null ? '—' : fmt_pct(data.accuracy)}
            </dd>
          </div>
          <div className="pf-stat">
            <dt>Won</dt>
            <dd className="tnum">{data.wins}</dd>
          </div>
          <div className="pf-stat">
            <dt>Settled</dt>
            <dd className="tnum">{data.wins + data.losses}</dd>
          </div>
        </dl>
      </header>

      {/* ---- NON-REDEEMED FUNDS: settled wins not yet pulled to the wallet ---- */}
      {claimable.length > 0 && (
        <section className="pf-claim">
          <div className="pf-claim-row">
            <div className="pf-claim-l">
              <span className="pf-claim-lbl">Non-redeemed funds</span>
              <span className="pf-claim-sub">
                {claimable.length === 1
                  ? 'A settled win is waiting — claim it to your wallet.'
                  : `${claimable.length} settled wins waiting — claim them to your wallet.`}
              </span>
            </div>
            <span className="pf-claim-amt tnum">{fmt_usd_amount(claimableUsd)}</span>
            <button
              type="button"
              className="pf-claim-btn"
              onClick={claimAll}
              disabled={claiming}
            >
              {claiming ? 'Claiming…' : 'Claim'}
            </button>
          </div>
          {claimError && <p className="pf-claim-err">{claimError}</p>}
        </section>
      )}

      {/* ---- SKILL: the cumulative-profit curve + a stat strip ---- */}
      {data.history.length > 0 && <Skills data={data} />}

      {/* ---- OPEN ---- */}
      <section className="pf-zone">
        <div className="ed-sep pf-sep">
          <span className="ed-sep__label">Open positions</span>
          <span className="ed-sep__line" />
          {data.open.length > 0 && (
            <span className="pf-count tnum">{data.open.length}</span>
          )}
        </div>

        {data.open.length === 0 ? (
          <Empty
            loading={loading && !loadedOnce}
            line="No live positions."
            cta="Place a bet"
            onCta={() => navigate('/')}
          />
        ) : (
          <div className="pf-open-grid">
            {data.open.map(p => (
              <OpenCard
                key={p.key}
                p={p}
                now={now}
                onCashOut={() => navigate('/')}
              />
            ))}
          </div>
        )}
      </section>

      {/* ---- HISTORY ---- */}
      <section className="pf-zone">
        <div className="ed-sep pf-sep">
          <span className="ed-sep__label">History</span>
          <span className="ed-sep__line" />
          {data.history.length > 0 && (
            <span className="pf-count tnum">{data.history.length}</span>
          )}
        </div>

        {data.history.length === 0 ? (
          <Empty
            loading={loading && !loadedOnce}
            line="No settled positions yet. Your record writes itself, on-chain."
          />
        ) : (
          <ul className="pf-hist">
            <li className="pf-hist-head" aria-hidden="true">
              <span>Outcome</span>
              <span>Side</span>
              <span className="r">Stake</span>
              <span className="r">Net P&amp;L</span>
              <span className="r">Proof</span>
            </li>
            {data.history.map(h => (
              <HistoryRowEl key={h.key} h={h} />
            ))}
          </ul>
        )}
      </section>
    </main>
  )
}

// ---- SKILL: the cumulative-profit curve + a stat strip ----------------------
function Skills({ data }: { data: PortfolioData }) {
  const rate = (w: number, t: number) => (t > 0 ? Math.round((w / t) * 100) + '%' : '—')
  return (
    <section className="pf-skills">
      <div className="ed-sep pf-sep">
        <span className="ed-sep__label">Your skill</span>
        <span className="ed-sep__line" />
        <span className="pf-count tnum">{data.roundsPlayed} rounds</span>
      </div>
      <div className="pf-skills-grid">
        <div className="pf-curve surface">
          <div className="pf-curve-head">
            <span className="pf-curve-lbl">Cumulative profit</span>
            <span
              className={
                'pf-curve-now tnum ' +
                (data.netUsd > 0 ? 'pos' : data.netUsd < 0 ? 'neg' : '')
              }
            >
              {fmt_signed_cents(data.netUsd)}
            </span>
          </div>
          <SkillCurve pnl={data.pnl} />
        </div>
        <dl className="pf-skillstats">
          <SkillStat k="Win rate" v={data.accuracy == null ? '—' : fmt_pct(data.accuracy)} />
          <SkillStat k="Win streak" v={data.streak > 0 ? `${data.streak}W` : '—'} />
          <SkillStat
            k="Best round"
            v={fmt_signed_cents(data.bestUsd)}
            tone={data.bestUsd > 0 ? 'pos' : undefined}
          />
          <SkillStat k="Volume" v={fmt_usd_compact(data.volumeUsd)} />
          <SkillStat k="Up calls" v={rate(data.upWins, data.upTotal)} sub={`${data.upWins}/${data.upTotal}`} />
          <SkillStat k="Down calls" v={rate(data.downWins, data.downTotal)} sub={`${data.downWins}/${data.downTotal}`} />
        </dl>
      </div>
    </section>
  )
}

function SkillStat({ k, v, sub, tone }: { k: string; v: string; sub?: string; tone?: 'pos' | 'neg' }) {
  return (
    <div className="pf-skillstat">
      <dt>{k}</dt>
      <dd className={'tnum' + (tone ? ' ' + tone : '')}>{v}</dd>
      {sub && <span className="pf-skillstat-sub tnum">{sub}</span>}
    </div>
  )
}

// The skill curve — cumulative realized net over time, baselined at $0 (it can
// dip below). A blue analytic line + soft area; NEVER green/red (the hero figure
// carries the verdict). A single settled round honestly reads flat at its value.
function SkillCurve({ pnl }: { pnl: PnlPoint[] }) {
  const W = 1000
  const H = 150
  const PAD = 8
  const { line, area, dot, zeroY } = useMemo(() => {
    const pts = pnl.length ? pnl.map(p => p.cum) : [0, 0]
    const n = pts.length
    const max = Math.max(0, ...pts)
    const min = Math.min(0, ...pts)
    const span = Math.max(max - min, 0.02)
    const x = (i: number) => (n <= 1 ? W - PAD : PAD + (i / (n - 1)) * (W - PAD * 2))
    const y = (v: number) => PAD + (1 - (v - min) / span) * (H - PAD * 2)
    const l = pts.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
    const a =
      `M${x(0).toFixed(1)},${y(0).toFixed(1)} ` +
      pts.map((v, i) => `L${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ') +
      ` L${x(n - 1).toFixed(1)},${y(0).toFixed(1)} Z`
    return { line: l, area: a, dot: { x: x(n - 1), y: y(pts[n - 1]) }, zeroY: y(0) }
  }, [pnl])
  return (
    <svg className="pf-curve-svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Cumulative profit over time">
      <defs>
        <linearGradient id="pfCurve" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--blue)" stopOpacity="0.18" />
          <stop offset="100%" stopColor="var(--blue)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <line className="pf-curve-zero" x1={PAD} y1={zeroY} x2={W - PAD} y2={zeroY} />
      <path className="pf-curve-fill" d={area} fill="url(#pfCurve)" />
      <path className="pf-curve-stroke" d={line} />
      <circle className="pf-curve-dot" cx={dot.x} cy={dot.y} r="3.5" />
    </svg>
  )
}

// ---- OPEN card --------------------------------------------------------------
// The ticket is an OUTLINED ledger (no fill, no side-colour chrome). The ONLY
// green/red is the signed live net — the true signal. Everything else is blue.
function OpenCard({
  p,
  now,
  onCashOut,
}: {
  p: OpenPosition
  now: number
  onCashOut: () => void
}) {
  const settling = p.status === 'settling' || p.expiryMs <= now
  const net = p.netUsd
  const sign = net == null ? 'flat' : net > 0 ? 'pos' : net < 0 ? 'neg' : 'flat'
  const remaining = p.expiryMs - now

  return (
    <article className={'pf-card' + (settling ? ' settling' : '')}>
      <div className="pf-card-top">
        <span className={'pf-side ' + (p.side === 'UP' ? 'up' : 'down')}>
          {p.side}
        </span>
        <span className="pf-contracts tnum">
          {fmt_amount(p.contracts)} contracts
        </span>
        <span className="pf-clock tnum">
          {settling ? 'Settling' : fmt_countdown(remaining)}
        </span>
      </div>

      <div className={'pf-card-net tnum ' + sign}>
        {settling
          ? 'Settling…'
          : net == null
            ? '—'
            : fmt_signed_cents(net)}
      </div>
      <div className="pf-card-sub">
        {settling
          ? 'Outcome pending'
          : net == null
            ? 'Pricing your exit…'
            : net >= 0
              ? 'up on your stake'
              : 'down on your stake'}
      </div>

      <dl className="pf-card-rows">
        <div>
          <dt>Cash-out value</dt>
          <dd className="tnum">
            {p.valueUsd == null ? '—' : fmt_usd_amount(p.valueUsd)}
          </dd>
        </div>
        <div>
          <dt>Paid</dt>
          <dd className="tnum">{fmt_usd_amount(p.paidUsd)}</dd>
        </div>
        <div>
          <dt>If it wins</dt>
          <dd className="tnum">{fmt_usd_amount(p.ifWinUsd)}</dd>
        </div>
      </dl>

      <button
        className="pf-cashout"
        onClick={onCashOut}
        disabled={settling}
      >
        {settling ? 'Settling…' : 'Cash out'}
        {!settling && <span className="pf-cashout-arr">→</span>}
      </button>
    </article>
  )
}

// ---- HISTORY row ------------------------------------------------------------
function HistoryRowEl({ h }: { h: HistoryRow }) {
  return (
    <li className={'pf-hist-row ' + (h.won ? 'win' : 'loss')}>
      <span className="pf-out">
        <span className="pf-out-dot" aria-hidden="true" />
        <span className="pf-out-main">
          <span className="pf-out-txt">{h.outcome}</span>
          <span className="pf-out-sub tnum">
            {fmt_amount(h.contracts)} @ {fmt_usd_compact(h.strikeUsd)}
          </span>
        </span>
      </span>
      <span className={'pf-row-side ' + (h.side === 'UP' ? 'up' : 'down')}>
        {h.side}
      </span>
      <span className="pf-row-stake tnum r">{fmt_usd_amount(h.stakeUsd)}</span>
      <span className={'pf-row-net tnum r ' + (h.netUsd >= 0 ? 'pos' : 'neg')}>
        {fmt_signed_cents(h.netUsd)}
      </span>
      <span className="pf-row-proof r">
        {h.digest ? (
          <a
            href={SUIVISION_TX + h.digest}
            target="_blank"
            rel="noreferrer noopener"
          >
            SuiVision <span aria-hidden="true">↗</span>
          </a>
        ) : (
          <span className="pf-row-noproof">settled</span>
        )}
      </span>
    </li>
  )
}

// ---- empty / signed-out states ----------------------------------------------
function Empty({
  loading,
  line,
  cta,
  onCta,
}: {
  loading: boolean
  line: string
  cta?: string
  onCta?: () => void
}) {
  return (
    <div className="pf-empty">
      {loading ? (
        <span className="pf-empty-line">Reading the chain…</span>
      ) : (
        <>
          <span className="pf-empty-line">{line}</span>
          {cta && onCta && (
            <button className="pf-empty-cta" onClick={onCta}>
              {cta} →
            </button>
          )}
        </>
      )}
    </div>
  )
}

function SignedOut() {
  const { sign_in_google, connecting } = useAuth()
  return (
    <main className="pf pf-signedout">
      <div className="pf-kick">Portfolio</div>
      <h1 className="pf-so-title">Your positions, your proof.</h1>
      <p className="pf-so-lede">
        Every open and settled position, your realized profit, and a verifiable
        on-chain record of everything you&rsquo;ve traded — read straight from
        the chain, no scorekeeper required.
      </p>
      <button
        className="pf-so-cta"
        onClick={sign_in_google}
        disabled={connecting}
      >
        {connecting ? 'Signing in…' : 'Sign in with Google'}
      </button>
    </main>
  )
}
