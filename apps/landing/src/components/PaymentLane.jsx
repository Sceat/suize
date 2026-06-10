import { Reveal } from '../ui'
import { BUSINESS } from '../config'

// ============================================================================
// BEAT 0.5 · THE REVENUE-STREAM PANEL (owner-locked centerpiece). The owner:
// "show that you DRAW FROM a revenue stream already flowing" — the panel must
// read "revenue went UP because of the new agent stream," not just "agents are
// paying." So it shows your NORMAL sales (human customers — the baseline you
// already have) PLUS the NEW agentic sales HIGHLIGHTED on top, summing to a
// higher total. The old playful conveyor is long gone; the old flat "incoming
// payments" ledger is replaced by this revenue SPLIT.
//
// THE READ (top → bottom):
//   1. A monthly REVENUE total (illustrative merchant revenue — a few thousand $,
//      NEVER a Suize tier/fee/price), with a quiet "+x% this month" delta that
//      attributes the lift to the agent stream.
//   2. A single stacked BAR — the human baseline (calm ink) with the agentic
//      portion stacked + HIGHLIGHTED (the corporate accent) on top, so the eye
//      literally sees revenue rise above the old line.
//   3. A two-row LEDGER split — "Customers" (humans, baseline) and "AI agents"
//      (the new stream, HIGHLIGHTED) — = a higher total. Professional + light:
//      it reads like a real revenue dashboard, not a game.
//
// MOTION: minimal + tasteful. The ledger rows + the bar ride the shared reveal
// (one staggered fade/slide on scroll, then at rest). NO conveyor, NO travelling
// coins, NO loop, NO timers, NO JS animation. Reduced-motion → fully static.
//
// HONESTY: NO pricing. Every figure is illustrative merchant revenue inside the
// artifact (sales a business takes), never a Suize tier; no "2%", no fee split —
// pricing lives only on /pricing.
// ============================================================================

// the revenue SPLIT — illustrative merchant monthly revenue. The human baseline
// is the sales you already had; the agentic figure is the NEW stream drawn from
// the rail. Total = baseline + agentic (a believable few-thousand-$, NOT a price).
const REVENUE = {
  baseline: 28940, // human customers — the sales you already had
  agentic: 9180, // AI agents — the new stream you plug into
  delta: '+31%', // the lift the agent stream adds this month
}
const TOTAL = REVENUE.baseline + REVENUE.agentic
// the agentic share of the new total — drives the highlighted bar segment width
const AGENTIC_PCT = Math.round((REVENUE.agentic / TOTAL) * 100)

const fmt = n =>
  '$' + n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })

export default function PaymentLane() {
  const { lane } = BUSINESS

  return (
    <section className="sx-station sx-station--lane" id="lane">
      <div className="sx-wrap">
        <Reveal className="sx-stationhead bz-pay__head">
          <span className="ed-eyebrow">{lane.eyebrow}</span>
          <h2 className="sx-stationhead__title">{lane.head}</h2>
          <p className="sx-stationhead__sub">{lane.sub}</p>
        </Reveal>

        <Reveal
          className="bz-rev"
          role="img"
          aria-label={`Monthly revenue ${fmt(TOTAL)}, up ${REVENUE.delta}: human customer sales plus a new highlighted stream of sales from AI agents.`}
        >
          <span className="bz-lamina__hair" aria-hidden="true" />

          {/* ---- THE TOTAL — revenue this month, with the agent-stream lift --- */}
          <header className="bz-rev__top">
            <div className="bz-rev__total">
              <span className="ed-eyebrow">Revenue this month</span>
              <span className="bz-rev__total-v">{fmt(TOTAL)}</span>
            </div>
            <div className="bz-rev__delta">
              <span className="bz-rev__delta-v">{REVENUE.delta}</span>
              <span className="bz-rev__delta-k">from the agent stream</span>
            </div>
          </header>

          {/* ---- THE STACKED BAR — the human baseline, with the agentic portion
               HIGHLIGHTED on top so revenue is literally seen rising above the
               old line. A faint dotted marker sits at the baseline edge. */}
          <div
            className="bz-rev__bar"
            aria-hidden="true"
            style={{ '--agentic-pct': `${AGENTIC_PCT}%` }}
          >
            <span className="bz-rev__seg bz-rev__seg--base">
              <span className="bz-rev__seg-label">Customers</span>
            </span>
            <span className="bz-rev__seg bz-rev__seg--agentic">
              <span className="bz-rev__seg-label">AI agents</span>
            </span>
            <span className="bz-rev__baseline" aria-label="your previous revenue line" />
          </div>

          {/* ---- THE SPLIT LEDGER — human baseline + the highlighted new stream
               = a higher total. Rides the shared staggered reveal, then at rest. */}
          <Reveal as="ul" className="bz-rev__rows" lines>
            <li className="bz-rev__rowhead" aria-hidden="true">
              <span>Source</span>
              <span>This month</span>
            </li>
            <li className="bz-rev__row">
              <span className="bz-rev__src">
                <span className="bz-rev__swatch bz-rev__swatch--base" aria-hidden="true" />
                Customers
                <span className="bz-rev__src-note">human, your baseline</span>
              </span>
              <span className="bz-rev__amt">{fmt(REVENUE.baseline)}</span>
            </li>
            <li className="bz-rev__row bz-rev__row--agentic">
              <span className="bz-rev__src">
                <span className="bz-rev__swatch bz-rev__swatch--agentic" aria-hidden="true" />
                AI agents
                <span className="bz-rev__tag">New stream</span>
              </span>
              <span className="bz-rev__amt bz-rev__amt--agentic">+{fmt(REVENUE.agentic)}</span>
            </li>
            <li className="bz-rev__row bz-rev__row--total">
              <span className="bz-rev__src bz-rev__src--total">Total revenue</span>
              <span className="bz-rev__amt bz-rev__amt--total">{fmt(TOTAL)}</span>
            </li>
          </Reveal>
        </Reveal>

        <Reveal className="sx-station__cta bz-pay__cta">
          <a
            className="sx-cta"
            href={lane.cta.href}
            target={lane.cta.href.startsWith('#') ? undefined : '_blank'}
            rel={lane.cta.href.startsWith('#') ? undefined : 'noreferrer'}
          >
            {lane.cta.label}
          </a>
        </Reveal>
      </div>
    </section>
  )
}
