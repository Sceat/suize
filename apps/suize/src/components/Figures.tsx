import type { LiveState } from '../useLive'

// Circulation figures — REAL counters derived from on-chain events (live.ts).
// No fabricated seeds and no random drift: a number here is a fact you can verify
// on-chain. While the feed loads (or if it can't be read) the strip shows a
// neutral placeholder dash, never an invented figure (honesty law).
const DASH = '—'

export function Figures({ live }: { live: LiveState }) {
  const f = live.status === 'ready' ? live.data.figures : null
  const val = (n: number | undefined) => (f && n !== undefined ? n.toLocaleString() : DASH)

  return (
    <section className="figures">
      <div className="wrap figures__in">
        <div className="fig">
          <div className="fig__lbl">Sites live</div>
          <div className="fig__val tnum">{val(f?.sitesLive)}</div>
          <div className="fig__sub">served from Walrus right now</div>
        </div>
        <div className="fig">
          <div className="fig__lbl">Payments settled</div>
          <div className="fig__val tnum">{val(f?.paymentsSettled)}</div>
          <div className="fig__sub">gasless USDC over 402</div>
        </div>
        <div className="fig">
          <div className="fig__lbl">Epochs funded</div>
          <div className="fig__val tnum">{val(f?.epochsFunded)}</div>
          <div className="fig__sub">storage paid forward</div>
        </div>
      </div>
    </section>
  )
}
