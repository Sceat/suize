import { useEffect, useRef } from 'react'
import { splitHeadline } from '../lib/motion'
import { BUSINESS } from '../config'

// The business hero sits over the global fixed <Backdrop> (App.jsx) — the same
// clean editorial surface as the home. This is just the editorial layer on top.

// ============================================================================
// STATION 0 · CHARGE HERO (the surface, RISING) — GET PAID BY AGENTS. The
// owner-locked pivot: getting recommended is NOT the first value — we truly let
// a business TAKE an agent's money. So the masthead now LEADS with the get-paid
// promise (`AI agents are buying.` · `Get paid by them.`), the hot phrase
// `Get paid by them.` (line 2) taking the corporate --grad-hot clip. The
// marketplace-reach line (`get recommended to millions`) drops BENEATH the sub as
// a SECONDARY value (.sx-hero__rail), never the headline.
//
// A WIDE, confident corporate masthead: each sentence sits on ONE big line
// across the full editorial width — NOT a cramped multi-line stack. A single
// sharp-cornered frosted RECEIPT artifact RISES in the water to the right (the
// inverted current), NOT a phone (LAW #3), NOT inside any device.
//
// WRAPPING: each sentence is its OWN line block (.sx-hero__line) so CSS can size
// + balance them independently; on wide screens each holds ONE line, only small
// screens are allowed to wrap further.
//
// LAWS: no phone/notch/9:41 (the receipt floats free); no rounded pill (the CTA
// is a sharp frosted rectangle + an underlined text-link); NO dots anywhere (the
// eyebrow is the theme.css gradient hairline tick).
// HONESTY: eyebrow stays `Charge` (account.move unpublished — no LIVE claim).
// NO PRICING in the masthead — the receipt shows the paid moment (an agent's
// own payment landing), never a fee split / net / "2%". Pricing lives only on
// the /pricing page.
// ============================================================================
export default function BusinessHero() {
  const ref = useRef(null)
  const h1Ref = useRef(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const id = requestAnimationFrame(() => el.classList.add('is-revealed'))
    const cleanup = splitHeadline(h1Ref.current)
    return () => {
      cancelAnimationFrame(id)
      cleanup()
    }
  }, [])

  return (
    <section className="sx-station sx-station--hero sx-station--bzhero" id="top" ref={ref}>
      <div className="sx-station__inner sx-wrap">
        <div className="sx-hero__claim">
          {/* HONESTY PIN: the eyebrow reads `Charge` — no LIVE / mainnet claim. */}
          <div className="ed-eyebrow sx-hero__eyebrow">{BUSINESS.hero.eyebrow}</div>

          {/* WIDE masthead: each sentence is its own balanced line block so it
              fills the horizontal space on one confident line, never a cramped
              stack. Line 1 = the setup ("AI agents are buying."), line 2 = the
              LEAD value, the get-paid payoff ("Get paid by them.") — clipped. */}
          <h1 className="sx-hero__h1 sx-hero__h1--wide" ref={h1Ref}>
            <span className="sx-hero__line">{BUSINESS.hero.h1[0]}</span>
            <span className="sx-hero__line sx-hero__line--accent">
              {/* the hot phrase `Get paid by them.` takes the gradient clip */}
              <span className="sx-hero__accent">{BUSINESS.hero.h1[1]}</span>
            </span>
          </h1>

          <p className="sx-hero__sub">{BUSINESS.hero.sub}</p>

          {/* the SECONDARY value — the marketplace-reach promise, demoted from the
              headline. A quiet supporting line with an accent lead-in tick so it
              reads as "and also …", never competing with the get-paid lead. */}
          <p className="sx-hero__rail sx-hero__rail--secondary">
            <span className="sx-hero__rail-mark" aria-hidden="true" />
            {BUSINESS.hero.secondary}
          </p>

          <div className="sx-hero__actions">
            <a
              className="sx-cta"
              href={BUSINESS.hero.cta.href}
              target={BUSINESS.hero.cta.href.startsWith('#') ? undefined : '_blank'}
              rel={BUSINESS.hero.cta.href.startsWith('#') ? undefined : 'noreferrer'}
            >
              {BUSINESS.hero.cta.label}
            </a>
            <a className="sx-ghost" href={BUSINESS.hero.ghost.href}>
              {BUSINESS.hero.ghost.label}
            </a>
          </div>

          {/* no dot — a mono whisper-line; the eyebrow tick carries the mark */}
          <p className="sx-hero__chip">{BUSINESS.hero.chip}</p>
        </div>

        {/* THE MERCHANT-WALLET DASHBOARD — a real business wallet receiving an AI
            money flow, RISING in the water (the inverted current). Replaces the
            small "paid by agents" card: a settled BALANCE, a split bar showing the
            agent stream stacked ON TOP of card sales, and a LIVE FEED of incoming
            agent payments from the placeholder companies. NOT a phone, NOT a toy —
            a serious fintech merchant dashboard. Every $ is illustrative merchant
            money (a settled balance / sales), NEVER a Suize price or fee. */}
        <div
          className="sx-hero__float sx-hero__float--rise"
          role="img"
          aria-label="A merchant wallet receiving payments from AI agents: a settled balance of $42,180, with a new agent-payment stream stacked on top of card sales, and a live feed of incoming agent payments settling in seconds."
        >
          <div className="bz-lamina bz-merchant is-rising">
            <span className="bz-lamina__hair" aria-hidden="true" />

            {/* ---- THE BALANCE HEADER — a real business wallet's settled funds */}
            <header className="bz-merchant__head">
              <div className="bz-merchant__id">
                <span className="bz-merchant__avatar" aria-hidden="true">⬡</span>
                <span className="bz-merchant__name">
                  Merchant wallet
                  <span className="bz-merchant__handle">your-service</span>
                </span>
              </div>
              <span className="bz-merchant__live">
                <span className="bz-merchant__pulse" aria-hidden="true" />
                Live
              </span>
            </header>

            <div className="bz-merchant__balance">
              <span className="ed-eyebrow">Settled balance</span>
              <span className="bz-merchant__bal-v">$42,180</span>
              <span className="bz-merchant__bal-delta">
                +$6,240 from agents this month
              </span>
            </div>

            {/* ---- THE SPLIT BAR — card sales (baseline) with the NEW agent stream
                 HIGHLIGHTED on top, so the merchant sees income ADDED by agents. */}
            <div
              className="bz-merchant__split"
              aria-hidden="true"
              style={{ '--agentic-pct': '34%' }}
            >
              <span className="bz-merchant__split-seg bz-merchant__split-seg--card" />
              <span className="bz-merchant__split-seg bz-merchant__split-seg--ai" />
            </div>
            <div className="bz-merchant__legend" aria-hidden="true">
              <span className="bz-merchant__leg">
                <span className="bz-merchant__dot bz-merchant__dot--card" />
                Card customers
              </span>
              <span className="bz-merchant__leg bz-merchant__leg--ai">
                <span className="bz-merchant__dot bz-merchant__dot--ai" />
                AI agents
                <span className="bz-merchant__leg-up">+18%</span>
              </span>
            </div>

            {/* ---- THE LIVE FEED — incoming agent payments landing in the wallet.
                 A clean corporate ledger of recent agent charges from the
                 placeholder companies. Rows ride a soft staggered land-in. */}
            <div className="bz-merchant__feed">
              <div className="bz-merchant__feed-head">
                <span>Incoming · AI agents</span>
                <span>Settled in seconds</span>
              </div>
              <ul className="bz-merchant__rows">
                {MERCHANT_FEED.map((p, i) => (
                  <li
                    className="bz-merchant__row"
                    key={p.from}
                    style={{ '--row-i': i }}
                  >
                    <span className="bz-merchant__from">
                      <span className="bz-merchant__mono" aria-hidden="true">
                        {p.mono}
                      </span>
                      <span className="bz-merchant__who">
                        {p.from}
                        <span className="bz-merchant__kind">{p.kind}</span>
                      </span>
                    </span>
                    <span className="bz-merchant__cell">
                      <span className="bz-merchant__amt">+{p.amount}</span>
                      <span className="bz-merchant__state">paid</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

// The live feed — recent incoming AI-agent payments landing in the merchant's
// wallet. Illustrative merchant revenue (charges a business takes), NEVER a Suize
// price/fee. `mono` is a 2-letter wordmark badge for each placeholder company.
const MERCHANT_FEED = [
  { from: 'Globex agent', kind: 'API · usage', mono: 'GX', amount: '$420.00' },
  { from: 'Research agent', kind: 'one-off', mono: 'RA', amount: '$89.00' },
  { from: 'Initech agent', kind: 'subscription', mono: 'IN', amount: '$120.00' },
  { from: 'Hooli agent', kind: 'API · usage', mono: 'HO', amount: '$56.00' },
]
