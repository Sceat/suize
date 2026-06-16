import { useEffect, useState } from 'react'
import { useSuiClient } from '@mysten/dapp-kit'
import { useNavigate } from 'react-router-dom'
import {
  fetch_oracles,
  pick_live_btc_oracle,
  fetch_latest_prices,
  fetch_vault_summary,
  strike_interval_of,
} from '../api'
import { read_trade_amounts, implied_pct_from_cost, snap_strike } from '../sui'
import { PREVIEW_QUANTITY, PRICE_SCALE, DUSDC_SCALE } from '../config'
import { fmt_countdown, fmt_usd_amount, fmt_usd_compact } from '../format'
import './markets.css'

// ============================================================================
// MARKETS — a trading-floor index, not a "coming soon" page. ONE hero: a
// featured BTC card whose instrument is a live implied-probability dial (REAL
// DeepBook read — our honest win over a decorative dial), with the live spot,
// the round window, and on-chain volume on a dotted-leader ledger. The other
// assets render as honest LOCKED cards — never fake odds, never a waiting room.
// Built on the premium surface tokens (veil elevation, ghost ₿, grain backdrop)
// so the dark theme reads as depth, not a flat box. Green/red is quarantined to
// the lone spot delta; everything else is one blue. All figures are real reads
// with honest fallbacks ("—") — nothing invented.
// ============================================================================

type MarketState = {
  spotUsd: number | null
  upPct: number | null // 0..100, implied UP probability
  expiryMs: number | null
  tvlUsd: number | null
  utilization: number | null // 0..1
  loaded: boolean
}

const EMPTY: MarketState = {
  spotUsd: null,
  upPct: null,
  expiryMs: null,
  tvlUsd: null,
  utilization: null,
  loaded: false,
}

// Live BTC market read: nearest active oracle → spot → ATM implied UP% (the same
// devInspect path the bet card prices) → vault TVL. Best-effort + polled; a slow
// or missing read never blanks the card, it just holds "—".
function useBtcMarket(): MarketState {
  const client = useSuiClient()
  const [s, setS] = useState<MarketState>(EMPTY)
  useEffect(() => {
    let alive = true
    const tick = async () => {
      try {
        const oracles = await fetch_oracles()
        const o = pick_live_btc_oracle(oracles)
        if (!o) {
          if (alive) setS(p => ({ ...p, loaded: true }))
          return
        }
        const prices = await fetch_latest_prices(o.oracle_id).catch(() => null)
        const spot1e9 = prices?.spot != null ? BigInt(Math.round(prices.spot)) : null
        const spotUsd = spot1e9 != null ? Number(spot1e9) / Number(PRICE_SCALE) : null

        let upPct: number | null = null
        if (spot1e9 != null) {
          try {
            const min = BigInt(Math.round(o.min_strike))
            const tick = BigInt(Math.round(strike_interval_of(o)))
            const strike = snap_strike(spot1e9, min, tick)
            const r = await read_trade_amounts(client, {
              oracle_id: o.oracle_id,
              expiry_ms: BigInt(o.expiry),
              strike_1e9: strike,
              is_up: true,
              quantity: PREVIEW_QUANTITY,
            })
            upPct = implied_pct_from_cost(r.ask_cost, PREVIEW_QUANTITY)
          } catch {
            /* momentarily unquoteable — hold last/"—" */
          }
        }
        const vault = await fetch_vault_summary().catch(() => null)
        if (alive)
          setS({
            spotUsd,
            upPct,
            expiryMs: o.expiry,
            tvlUsd: vault ? vault.vault_value / Number(DUSDC_SCALE) : null,
            utilization: vault ? vault.utilization : null,
            loaded: true,
          })
      } catch {
        if (alive) setS(p => ({ ...p, loaded: true }))
      }
    }
    tick()
    const id = setInterval(() => {
      if (!document.hidden) tick()
    }, 8_000)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [client])
  return s
}

function useNow(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])
  return now
}

const LOCKED = [
  { sym: 'ETH', name: 'Ethereum' },
  { sym: 'SOL', name: 'Solana' },
  { sym: 'SUI', name: 'Sui' },
]

export function Markets() {
  const m = useBtcMarket()
  const now = useNow()
  const navigate = useNavigate()

  const remaining = m.expiryMs != null ? Math.max(0, m.expiryMs - now) : null
  const up = m.upPct != null ? Math.max(0, Math.min(100, m.upPct)) : null

  return (
    <main className="mk">
      <div className="mk-wrap">
        <header className="mk-head">
          <div className="mk-kickline">
            <span className="mk-kick">Markets</span>
            <span className="mk-gloss">· 04 assets · 01 live</span>
          </div>
          <h1 className="mk-title">One tide. Every market.</h1>
          <p className="mk-lede">
            Bitcoin runs live — rolling fifteen-minute rounds, settled on-chain
            the second the window closes. The rest open the moment DeepBook lists
            them. No fake odds, no waiting room.
          </p>
        </header>

        {/* ---- the featured BTC card ---- */}
        <button
          className="mk-feature surface-mesh"
          onClick={() => navigate('/')}
          aria-label="Trade the live Bitcoin market"
        >
          <div className="mk-feature-l">
            <div className="mk-asset">
              <span className="mk-asset-sym">BTC</span>
              <span className="mk-asset-name">Bitcoin</span>
              <span className="chip live">Live · 15-min</span>
            </div>

            <div className="mk-spot num">
              {m.spotUsd != null ? fmt_usd_amount(m.spotUsd) : '—'}
            </div>

            <div className="mk-ledger">
              <LedgerRow k="Round window" v="15 min" />
              <LedgerRow
                k="Round closes"
                v={remaining != null ? fmt_countdown(remaining) : '—'}
              />
              <LedgerRow
                k="House backing"
                v={m.tvlUsd != null ? fmt_usd_compact(m.tvlUsd) : '—'}
              />
              <LedgerRow k="Settles" v="on-chain" />
            </div>

            <span className="mk-cta">
              Take a side <span className="mk-cta-arr">→</span>
            </span>
          </div>

          <div className="mk-feature-r">
            <Dial pct={up} loaded={m.loaded} />
          </div>
        </button>

        {/* ---- the rest: honest locked cards ---- */}
        <div className="mk-sub">
          <span className="mk-gloss">Opening next</span>
          <span className="mk-sub-rule" />
        </div>
        <div className="mk-grid">
          {LOCKED.map(a => (
            <div key={a.sym} className="mk-card surface is-locked">
              <div className="mk-asset">
                <span className="mk-asset-sym">{a.sym}</span>
                <span className="mk-asset-name">{a.name}</span>
              </div>
              <DialOutline />
              <div className="mk-locked-note">Opens when DeepBook lists it</div>
            </div>
          ))}
        </div>
      </div>
    </main>
  )
}

function LedgerRow({ k, v }: { k: string; v: string }) {
  return (
    <div className="mk-row">
      <span className="mk-row-k">{k}</span>
      <span className="mk-row-dots" aria-hidden="true" />
      <span className="mk-row-v num">{v}</span>
    </div>
  )
}

// The hero instrument: a ring-stack dial. A hairline track + a blue arc swept to
// the implied UP%, with the % (mono) and a tracked caption centred over it.
function Dial({ pct, loaded }: { pct: number | null; loaded: boolean }) {
  return (
    <div className="mk-dialwrap">
      <svg viewBox="0 0 300 300" className="mk-dial" aria-hidden="true">
        <circle className="mk-dial-track" cx="150" cy="150" r="115" pathLength={100} />
        {pct != null && (
          <circle
            className="mk-dial-arc"
            cx="150"
            cy="150"
            r="115"
            pathLength={100}
            strokeDasharray={`${pct} 100`}
            transform="rotate(-90 150 150)"
          />
        )}
      </svg>
      <div className="mk-dial-c">
        <div className="mk-dial-pct num">
          {pct != null ? Math.round(pct) : loaded ? '—' : '··'}
          {pct != null && <i>%</i>}
        </div>
        <div className="mk-dial-lbl">Up probability</div>
      </div>
    </div>
  )
}

function DialOutline() {
  return (
    <div className="mk-dialwrap is-ghost">
      <svg viewBox="0 0 300 300" className="mk-dial" aria-hidden="true">
        <circle className="mk-dial-track" cx="150" cy="150" r="115" pathLength={100} />
      </svg>
      <div className="mk-dial-c">
        <div className="mk-dial-pct num">—</div>
      </div>
    </div>
  )
}
