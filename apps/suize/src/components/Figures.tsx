import { useEffect, useState } from 'react'
import { FIGURES } from '../data'

// Circulation figures — the live-drifting counters strip. Payments + epochs
// funded tick up gently (as in the mockup) to sell the live-product feel; sites
// live holds. T-005b sources the seeds from the facilitator + chain counts.
export function Figures() {
  const [pays, setPays] = useState(FIGURES.paymentsSettled)
  const [epochs, setEpochs] = useState(FIGURES.epochsFunded)

  useEffect(() => {
    const id = window.setInterval(() => {
      if (Math.random() > 0.55) setPays((p) => p + 1)
      if (Math.random() > 0.7) setEpochs((e) => e + 1)
    }, 2600)
    return () => window.clearInterval(id)
  }, [])

  return (
    <section className="figures">
      <div className="wrap figures__in">
        <div className="fig">
          <div className="fig__lbl">Sites live</div>
          <div className="fig__val tnum">{FIGURES.sitesLive.toLocaleString()}</div>
          <div className="fig__sub">served from Walrus right now</div>
        </div>
        <div className="fig">
          <div className="fig__lbl">Payments settled</div>
          <div className="fig__val tnum">{pays.toLocaleString()}</div>
          <div className="fig__sub">gasless USDC over 402</div>
        </div>
        <div className="fig">
          <div className="fig__lbl">Epochs funded</div>
          <div className="fig__val tnum">{epochs.toLocaleString()}</div>
          <div className="fig__sub">storage paid forward</div>
        </div>
      </div>
    </section>
  )
}
