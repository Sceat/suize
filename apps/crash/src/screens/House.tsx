import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useGaslessSign } from '../useGaslessSign'
import { useHouse, type HouseVM } from '../useHouse'
import { fmt_usd_amount } from '../format'
import './house.css'

// ============================================================================
// House — the PLP "be the house" vault, its own full surface. Concept: ONE
// gradient "vault card" that reads top-to-bottom — TVL is the oversized hero
// (the pool you can join, the wow number), a row of supporting stats (value
// per share, the house's return, capital at risk), and the live share-price
// curve as the card's base (the spread earned over par). LPing is NOT a bet, so
// ZERO green/red here — the whole surface is one blue on navy ink. Every numeral
// is Martian Mono; all figures come from useHouse.ts — nothing invented.
// ============================================================================

const parse_price = (s: string): number => {
  const n = Number(s.replace(/[^0-9.]/g, ''))
  return Number.isFinite(n) ? n : NaN
}

export function HouseScreen() {
  const { address, signAndExecute, client } = useGaslessSign()
  const { vm, actions } = useHouse({
    address,
    client,
    signAndExecute,
    on_balance_change: () => {},
  })

  return (
    <main className="hs">
      <div className="hs-wrap">
        <Header />
        <VaultCard vm={vm} />
        <Projection vm={vm} />
        <Position vm={vm} />
        <Console vm={vm} actions={actions} signedIn={address != null} />
      </div>
    </main>
  )
}

function Header() {
  return (
    <header className="hs-head">
      <div className="hs-kick">The House</div>
      <h1 className="hs-title">Be the house.</h1>
      <p className="hs-lede">
        Every bet is taken by one shared pool. Supply it and you become the
        house — you earn the spread on every round players play. Gasless,
        non-custodial, redeemable any time.
      </p>
    </header>
  )
}

// ── the vault card: TVL hero + supporting stats + the share-price base ──────
function VaultCard({ vm }: { vm: HouseVM }) {
  const ready = vm.tvlStr !== '—' && vm.tvlStr !== '…'
  return (
    <section className="hs-vault">
      <div className="hs-vault-grid">
        <div className="hs-vault-lead">
          <div className="hs-vault-label">Total value locked</div>
          <div className={'hs-vault-tvl num' + (ready ? '' : ' is-load')}>
            {vm.tvlStr}
          </div>
          <div className="hs-vault-foot">
            The pool that backs every round. Its value per share ticks up as the
            house wins — that climb is the yield.
          </div>
        </div>
        <div className="hs-vault-stats">
          <VStat label="Value per share" value={vm.sharePriceStr} accent />
          <VStat label="House return" value={vm.yieldStr} unit={vm.yieldUnit} />
          <VStat label="Capital at risk" value={vm.utilizationStr} />
        </div>
      </div>
      <ShareBand vm={vm} />
    </section>
  )
}

function VStat({ label, value, unit, accent }: { label: string; value: string; unit?: string; accent?: boolean }) {
  return (
    <div className="hs-vstat">
      <div className="hs-vstat-label">{label}</div>
      <div className={'hs-vstat-val num' + (accent ? ' is-accent' : '')}>{value}</div>
      {unit && <div className="hs-vstat-unit">{unit}</div>}
    </div>
  )
}

// the live share-price curve, baselined at par — the card's base texture.
function ShareBand({ vm }: { vm: HouseVM }) {
  const [series, setSeries] = useState<number[]>([])
  const lastRef = useRef<number>(NaN)
  useEffect(() => {
    const p = parse_price(vm.sharePriceStr)
    if (!Number.isFinite(p) || p === lastRef.current) return
    lastRef.current = p
    setSeries(prev => {
      const next = [...prev, p]
      return next.length > 240 ? next.slice(next.length - 240) : next
    })
  }, [vm.sharePriceStr])

  return (
    <div className="hs-band">
      <div className="hs-band-head">
        <span className="hs-band-title">Value per share · since par</span>
        <span className="hs-band-now num">{vm.sharePriceStr}</span>
      </div>
      <AreaChart series={series} />
      <div className="hs-band-base">
        <span className="num">$1.0000</span>
        <span className="hs-band-base-lbl">par</span>
      </div>
    </div>
  )
}

function AreaChart({ series }: { series: number[] }) {
  const W = 1000
  const H = 150
  const PAD = 6
  const { path, area, dot } = useMemo(() => {
    const pts = series.length >= 1 ? series : [1, 1]
    const n = pts.length
    const par = 1
    const max = Math.max(par, ...pts)
    const top = max + (max - par) * 0.35 + 0.0002
    const span = Math.max(top - par, 0.0004)
    const x = (i: number): number => (n <= 1 ? W - PAD : PAD + (i / (n - 1)) * (W - PAD * 2))
    const y = (v: number): number => H - PAD - ((v - par) / span) * (H - PAD * 2)
    const line = pts.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
    const fill =
      `M${x(0).toFixed(1)},${(H - PAD).toFixed(1)} ` +
      pts.map((v, i) => `L${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ') +
      ` L${x(n - 1).toFixed(1)},${(H - PAD).toFixed(1)} Z`
    return { path: line, area: fill, dot: { x: x(n - 1), y: y(pts[n - 1]) } }
  }, [series])

  return (
    <svg className="hs-area" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Share price since par">
      <defs>
        <linearGradient id="hsArea" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--blue)" stopOpacity="0.18" />
          <stop offset="100%" stopColor="var(--blue)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <line className="hs-area-par" x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} />
      <path className="hs-area-fill" d={area} fill="url(#hsArea)" />
      <path className="hs-area-line" d={path} />
      <circle className="hs-area-dot" cx={dot.x} cy={dot.y} r="3.5" />
    </svg>
  )
}

// ── what you'd earn — the all-time return annualized into per-day/month/year ─
// All BLUE/ink (LPing is not a bet → no green/red), and honestly captioned: it
// is the REAL return scaled by the vault's age, never a fabricated APY.
function Projection({ vm }: { vm: HouseVM }) {
  // Base the projection on the user's CURRENT STAKE (their house position), or a
  // sample $1,000 when they don't hold one yet — NEVER the wallet balance (that
  // is navbar-only, never surfaced on this page).
  const has = vm.positionValueUsd != null && vm.positionValueUsd > 0
  const basis = has ? (vm.positionValueUsd as number) : 1000
  const ready = vm.apyPct != null
  const yearly = ready ? (basis * (vm.apyPct as number)) / 100 : 0
  // Projection money reads in consistent 2-decimal dollars so per-day/month/year
  // line up (never "$0.2" beside "$74"); the stake basis below stays whole-dollar.
  const sign = (v: number) =>
    (v >= 0 ? '+' : '−') +
    '$' +
    Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const ageLbl =
    vm.ageDays == null ? '' : vm.ageDays >= 1.5 ? `${Math.round(vm.ageDays)} days` : '1 day'

  return (
    <section className="hs-proj">
      <div className="hs-proj-top">
        <span className="hs-proj-kick">What you&rsquo;d earn</span>
        <span className="hs-proj-basis">
          on {has ? `your ${fmt_usd_amount(basis)} stake` : 'a sample $1,000 supplied'}
        </span>
      </div>
      {ready ? (
        <div className="hs-proj-grid">
          <ProjCell label="Per day" value={sign(yearly / 365)} />
          <ProjCell label="Per month" value={sign(yearly / 12)} />
          <ProjCell label="Per year" value={sign(yearly)} lead />
        </div>
      ) : (
        <div className="hs-proj-soon">
          A projection appears once the house has a few days of settled rounds to
          measure.
        </div>
      )}
      <p className="hs-proj-note">
        {ready && (
          <>
            Estimated by annualizing the house&rsquo;s{' '}
            <span className="num">{vm.yieldStr}</span> return over {ageLbl} of
            history.{' '}
          </>
        )}
        The house earns the spread players lose — LP returns aren&rsquo;t
        guaranteed, and past performance isn&rsquo;t a promise.
      </p>
    </section>
  )
}

function ProjCell({ label, value, lead }: { label: string; value: string; lead?: boolean }) {
  return (
    <div className={'hs-proj-cell' + (lead ? ' is-lead' : '')}>
      <div className="hs-proj-label">{label}</div>
      <div className="hs-proj-val num">{value}</div>
    </div>
  )
}

// ── your position — a clean band when held, a quiet prompt when not ─────────
function Position({ vm }: { vm: HouseVM }) {
  if (!vm.hasPosition) {
    return (
      <section className="hs-pos hs-pos-empty">
        <span className="hs-pos-empty-dot" aria-hidden="true" />
        You don&rsquo;t back the house yet. Supply below — your stake, its live
        value, and your share of the pool appear here.
      </section>
    )
  }
  const own = vm.yourStakeStr?.split('·')[1]?.trim() ?? null
  return (
    <section className="hs-pos">
      <div className="hs-pos-head">Your position</div>
      <div className="hs-pos-grid">
        <PCell label="Stake value" value={vm.positionValueStr ?? '—'} foot="live" lead />
        <PCell label="Your share" value={own ?? '—'} foot="of the house" />
        <PCell label="House return" value={`${vm.yieldStr}`} foot={`${vm.yieldUnit} on every share`} />
      </div>
    </section>
  )
}

function PCell({ label, value, foot, lead }: { label: string; value: string; foot: string; lead?: boolean }) {
  return (
    <div className={'hs-pcell' + (lead ? ' is-lead' : '')}>
      <div className="hs-pcell-label">{label}</div>
      <div className="hs-pcell-val num">{value}</div>
      <div className="hs-pcell-foot">{foot}</div>
    </div>
  )
}

// ── the console — equal Supply / Redeem ─────────────────────────────────────
function Console({
  vm,
  actions,
  signedIn,
}: {
  vm: HouseVM
  actions: { supply: (usd: number) => void; redeem: () => void }
  signedIn: boolean
}) {
  const [amt, setAmt] = useState('')
  const usd = Number(amt)
  const valid = Number.isFinite(usd) && usd > 0
  const canSupply = valid && vm.canSupply(usd)
  const doneRef = useRef(vm.supplyDoneAt)
  useEffect(() => {
    if (vm.supplyDoneAt !== doneRef.current) {
      doneRef.current = vm.supplyDoneAt
      setAmt('')
    }
  }, [vm.supplyDoneAt])

  const chips = [25, 100, 500]
  const wallet = vm.walletDusdcUsd

  return (
    <section className="hs-console">
      <div className="hs-console-head">
        <span className="hs-console-title">Back the house</span>
        {wallet != null && wallet > 0 && (
          <button type="button" className="hs-field-max" onClick={() => setAmt(String(Math.floor(wallet)))}>
            max
          </button>
        )}
      </div>
      <div className="hs-field">
        <span className="hs-field-sign">$</span>
        <input
          id="hs-amt"
          className="hs-field-input num"
          inputMode="decimal"
          placeholder="0"
          value={amt}
          onChange={e => setAmt(e.target.value.replace(/[^0-9.]/g, ''))}
        />
        <div className="hs-chips">
          {chips.map(c => (
            <button key={c} type="button" className="hs-chip" onClick={() => setAmt(String(c))}>
              <span className="num">${c}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="hs-actions">
        <button
          className="hs-btn hs-btn-supply"
          disabled={!signedIn || !canSupply || vm.supplyBusy}
          onClick={() => actions.supply(usd)}
        >
          {vm.supplyBusy ? <Spin /> : (
            <>
              {vm.ctaLabel}
              {valid && <span className="hs-btn-amt num"> · ${amt}</span>}
            </>
          )}
        </button>
        <button className="hs-btn hs-btn-redeem" disabled={!vm.hasPosition || vm.redeemBusy} onClick={actions.redeem}>
          {vm.redeemBusy ? <Spin dim /> : 'Redeem all'}
        </button>
      </div>

      <p className="hs-note">
        {!signedIn
          ? 'Sign in with Google to back the house — no seed phrase, no gas.'
          : 'Supply and redeem are gasless. Your stake stays yours — redeem the whole position to your wallet any time.'}
      </p>
      {vm.error && <div className="hs-error">{vm.error}</div>}
    </section>
  )
}

function Spin({ dim }: { dim?: boolean }): ReactNode {
  return <span className={'hs-spin' + (dim ? ' is-dim' : '')} aria-label="Working" />
}
