import { useEffect, useRef, useState } from 'react'
import { HOME } from '../config'
import { Reveal } from '../ui'
import { prefersReducedMotion } from '../lib/motion'
import ActivityLog from './ActivityLog'
import ConfirmSequence from './ConfirmSequence'

// ============================================================================
// THE PAY HOME BEATS — an ASYMMETRIC, choreographed scroll (owner: "an
// experience, not a linear slide-deck"). The spine, post-pivot to a CONSUMER AI
// WALLET:
//
//   BEAT 1 · LeashBeat       — THE TWO POTS: two glassy balance cards (YOUR money
//            vs the capped AGENT pot) joined by a top-up → / ← pull-back arrow, the
//            owner-locked 3 trust points (No bank. / No setup headache. / Fully
//            decentralized.) below as a supporting line.
//   BEAT 2 · CapabilitiesBeat — the AI-wallet POWERS: it remembers you (learns
//            what you like), acts everywhere, pays safely, you're in control,
//            free to start. Editorial + VARIED (a featured memory card with a
//            conversational "it remembers your seat" touch, then an off-grid
//            stagger). NO tech/model names (owner: never name the tech).
//   BEAT 3 · ConfirmBeat     — the iOS notification → confirm → receipt UI moment.
//   BEAT 4 · LogBeat          — "Fully transparent." The alive ledger.
//   BEAT 5 · TrustCloser      — the honesty payload + the locked close. (No
//            trusted-by marquee here — that moved to the BUSINESS page.)
//
// MOTION LAW: reveals are SCROLL-SCRUBBED (owner: "the appearing animations are
// still not scroll-induced") via the shared <Reveal scrub> path, and the entrance
// direction / scale / rhythm VARIES section-to-section (owner: "more chaos … it
// feels too redundant"). Every motion respects prefers-reduced-motion (the scrub
// path falls straight to visible). CTAs: sharp frosted .sx-cta or underlined
// .sx-ghost; ZERO dots; copy from HOME (config.js).
// ============================================================================

function StationCta({ cta, ghost, scrub }) {
  return (
    <Reveal className="sx-station__cta" scrub={scrub}>
      <a className="sx-cta" href={cta.href}>
        {cta.label}
      </a>
      {ghost && (
        <a className="sx-ghost" href={ghost.href}>
          {ghost.label}
        </a>
      )}
    </Reveal>
  )
}

// the two-headed flow arrow drawn BETWEEN the pots — the relationship made
// visual: the top stroke flows YOUR → AGENT (top up), the bottom stroke flows
// AGENT → YOUR (pull back). Pure SVG, no motion, so it's reduced-motion safe by
// construction. It rotates to vertical on the stacked mobile layout via CSS.
const PotFlow = () => (
  <svg
    className="sx-balances__arrows"
    viewBox="0 0 64 44"
    fill="none"
    aria-hidden="true"
  >
    {/* top up — left to right */}
    <path
      d="M6 15 H52"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    />
    <path
      d="M46 9 L54 15 L46 21"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    {/* pull back — right to left */}
    <path
      d="M58 29 H12"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      opacity="0.55"
    />
    <path
      d="M18 23 L10 29 L18 35"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      opacity="0.55"
    />
  </svg>
)

// BEAT 1 — THE TWO POTS. Makes the leash CONCRETE: two GLASSY balance cards side
// by side — YOUR balance (your money, Suize never touches it) and the AGENT
// balance (the capped pot your AI spends from, can't go past it) — joined by a
// two-headed flow arrow (top up → / ← pull back) so the relationship reads at a
// glance: I keep my money; the agent only gets a capped pot I control. The agent
// pot wears the accent + a "hard cap" marker. The three owner-locked trust points
// (No bank. / No setup headache. / Fully decentralized.) sit below as a quiet
// supporting line. The reveal SCRUBS up as you scroll into it; the cards carry NO
// motion of their own (reduced-motion safe). Dollar figures are the USER's OWN
// illustrative funds — NOT a Suize price.
export function LeashBeat() {
  const { balances } = HOME
  return (
    <section className="sx-station sx-balancebeat" id="leash">
      <div className="sx-wrap sx-balancebeat__inner">
        <Reveal className="sx-balancebeat__head" scrub={{ from: 'up', dist: 1 }}>
          <span className="ed-eyebrow">{balances.eyebrow}</span>
          <h2 className="sx-balancebeat__title">{balances.head}</h2>
          <p className="sx-balancebeat__sub">{balances.sub}</p>
        </Reveal>

        <Reveal className="sx-balances" scrub={{ from: 'up', dist: 1.2 }}>
          <article className="sx-pot sx-pot--you">
            <span className="sx-pot__label">{balances.your.label}</span>
            <span className="sx-pot__amount">{balances.your.amount}</span>
            <span className="sx-pot__note">{balances.your.note}</span>
          </article>

          {/* the relationship, made visual — top up → / ← pull back. The text
              label is kept beneath the arrow as the accessible caption. */}
          <span className="sx-balances__flow" role="presentation">
            <PotFlow />
            <span className="sx-balances__flowlabel">{balances.flow}</span>
          </span>

          <article className="sx-pot sx-pot--agent">
            <span className="sx-pot__cap" aria-hidden="true">
              Hard cap
            </span>
            <span className="sx-pot__label">{balances.agent.label}</span>
            <span className="sx-pot__amount">{balances.agent.amount}</span>
            <span className="sx-pot__note">{balances.agent.note}</span>
          </article>
        </Reveal>

        <Reveal className="sx-balances__points" scrub={{ from: 'up', dist: 1.3 }}>
          {balances.points.map((point, i) => (
            <span className="sx-balances__point" key={i}>
              {point}
            </span>
          ))}
        </Reveal>

        <Reveal className="sx-balancebeat__cta" scrub={{ from: 'up', dist: 0.7 }}>
          <a className="sx-cta sx-cta--lg" href={balances.cta.href}>
            {balances.cta.label}
          </a>
        </Reveal>
      </div>
    </section>
  )
}

// the tiny lock glyph the featured memory card wears (a record, not a dot)
const MemLock = () => (
  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <rect x="3.5" y="7" width="9" height="6.5" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
    <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" stroke="currentColor" strokeWidth="1.4" />
  </svg>
)

// BEAT 2 — THE CAPABILITIES (the AI-wallet powers). NOT a boring equal grid: a
// big FEATURED memory card ("it remembers your seat") spans wide on the left with
// a small conversational receipt-style memory chip; the remaining four powers
// stagger off-grid down the right, each entering from a different direction so the
// scroll feels alive, not redundant. The first capability in config is the memory
// one — we feature it; the rest fill the stagger column. NO tech/model names.
export function CapabilitiesBeat() {
  const { capabilities } = HOME
  if (!capabilities?.length) return null
  const [feature, ...rest] = capabilities
  // alternate entrance direction per side-card so the column doesn't march in
  // lockstep (variety / "chaos").
  const dirs = ['right', 'left', 'right', 'left']
  return (
    <section className="sx-station sx-caps" id="capabilities">
      <div className="sx-wrap sx-caps__inner">
        <Reveal className="sx-caps__head" scrub={{ from: 'up', dist: 1 }}>
          <span className="ed-eyebrow">What it actually does</span>
          <h2 className="sx-caps__title">An AI that knows you, acts for you, and pays.</h2>
        </Reveal>

        <div className="sx-caps__layout">
          {/* the FEATURED memory power — your data, owned by you. A wide editorial
              card with a small conversational "memory chip" proving it remembers
              something concrete (your usual seat). */}
          <Reveal
            className="sx-caps__feature"
            scrub={{ from: 'left', dist: 1.1, scale: 0.985 }}
          >
            <span className="sx-caps__badge">
              <span className="sx-caps__badgeicon" aria-hidden="true">
                <MemLock />
              </span>
              Owned by you
            </span>
            <h3 className="sx-caps__ftitle">{feature.title}</h3>
            <p className="sx-caps__fbody">{feature.body}</p>

            {/* the conversational memory touch — a tiny "it remembers you"
                exchange, rendered as a quiet chat pair (proves memory, not a
                payment log). NO tech names. */}
            <div className="sx-caps__memo" aria-hidden="true">
              <span className="sx-caps__memline sx-caps__memline--you">
                Book my usual aisle seat.
              </span>
              <span className="sx-caps__memline sx-caps__memline--ai">
                Done — aisle seat, paid from your balance.
              </span>
            </div>
          </Reveal>

          {/* the remaining powers — an off-grid stagger, each from a different
              direction + a slight per-card depth offset for rhythm. */}
          <div className="sx-caps__col">
            {rest.map((cap, i) => (
              <Reveal
                className="sx-caps__card"
                key={cap.title}
                scrub={{ from: dirs[i % dirs.length], dist: 1, amount: 0.7 }}
                style={{ '--cap-i': i }}
              >
                <span className="sx-caps__cardidx" aria-hidden="true">
                  0{i + 2}
                </span>
                <h3 className="sx-caps__ctitle">{cap.title}</h3>
                <p className="sx-caps__cbody">{cap.body}</p>
              </Reveal>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}

// BEAT 3 — THE CONFIRM MOMENT. The iOS notification → confirm → receipt sequence
// is the hero of this beat (a UI moment, NOT a headline). Copy left, demo right
// (asymmetric). The sequence mounts only once its container scrolls into view.
export function ConfirmBeat() {
  const { confirm } = HOME
  const ref = useRef(null)
  const [armed, setArmed] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (prefersReducedMotion() || typeof IntersectionObserver === 'undefined') {
      setArmed(true)
      return
    }
    const io = new IntersectionObserver(
      entries => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setArmed(true)
            io.disconnect()
          }
        }
      },
      { rootMargin: '0px 0px -20% 0px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  return (
    <section className="sx-station sx-confirm2" id="confirm">
      <div className="sx-wrap sx-confirm2__inner" ref={ref}>
        <Reveal className="sx-confirm2__copy" scrub={{ from: 'left', dist: 1 }}>
          <span className="ed-eyebrow">{confirm.eyebrow}</span>
          <p className="sx-confirm2__sub">{confirm.sub}</p>
          <StationCta cta={confirm.cta} />
        </Reveal>
        <Reveal className="sx-confirm2__demo" scrub={{ from: 'right', dist: 0.9 }}>
          {armed && <ConfirmSequence tag={confirm.sampleTag} />}
        </Reveal>
      </div>
    </section>
  )
}

// BEAT 4 — THE ACTIVITY LOG (proof, alive). Asymmetric: the big serif head
// bleeds left; the ledger sits offset to the right. Head enters from the right
// edge, the log from below — different rhythm than the confirm beat above.
export function LogBeat() {
  const { log } = HOME
  return (
    <section className="sx-station sx-logbeat2" id="activity">
      <div className="sx-wrap sx-logbeat2__inner">
        <Reveal className="sx-logbeat2__head" scrub={{ from: 'right', dist: 1 }}>
          <span className="ed-eyebrow">{log.eyebrow}</span>
          <h2 className="sx-logbeat2__title">{log.head}</h2>
          <p className="sx-logbeat2__sub">{log.sub}</p>
          <StationCta cta={log.cta} />
        </Reveal>
        <Reveal className="sx-logbeat2__log" scrub={{ from: 'up', dist: 1.2, amount: 0.5 }}>
          <ActivityLog />
        </Reveal>
      </div>
    </section>
  )
}

// BEAT 5 — THE CLOSE (the floor). The honesty payload, the VERBATIM locked
// custody phrase, then the sit-back-and-relax 2-line closer ("Let your money
// drive itself. / You just say yes."). NO trusted-by marquee — that moved to the
// BUSINESS page (the rail is the merchant trust signal, off-pitch here).
export function TrustCloser() {
  const { trust } = HOME
  const closeLines = Array.isArray(trust.closer) ? trust.closer : [trust.closer]
  return (
    <section className="sx-station sx-station--close" id="trust">
      <div className="sx-wrap sx-close__inner">
        <Reveal scrub={{ from: 'up', dist: 1 }}>
          <p className="sx-close__benefit">{trust.benefit}</p>
          {/* VERBATIM locked phrase — must read exactly (CLAUDE.md) */}
          <p className="sx-close__custody">{trust.custody}</p>
        </Reveal>

        <Reveal className="sx-close__closerwrap" scrub={{ from: 'up', dist: 1.4 }}>
          <h2 className="sx-close__title">
            {closeLines.map((line, i) => (
              <span className="sx-close__line" key={i}>
                {line}
                {i < closeLines.length - 1 && <br />}
              </span>
            ))}
          </h2>
          <div className="sx-station__cta sx-close__cta">
            <a className="sx-cta sx-cta--lg" href={trust.cta.href}>
              {trust.cta.label}
            </a>
          </div>
          <a className="sx-ghost sx-close__bridge" href={trust.bridge.href}>
            {trust.bridge.label}
          </a>
        </Reveal>
      </div>
    </section>
  )
}

// THE SEAMLESS MARQUEE — kept (still imported by the BUSINESS beats via this
// module's export); two identical tracks translating -50% on a loop, no seam.
export function Marquee({ items }) {
  return (
    <div className="sx-marquee" aria-hidden="true">
      <div className="sx-marquee__track">
        {items.map((m, i) => (
          <span className="sx-marquee__item" key={i}>
            {m}
            <span className="sx-marquee__sep">·</span>
          </span>
        ))}
      </div>
    </div>
  )
}
