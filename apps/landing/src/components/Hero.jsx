import { useEffect, useRef, useState } from 'react'
import { splitHeadline, prefersReducedMotion, getLenis } from '../lib/motion'
import { HOME } from '../config'
import HeroScene from './HeroScene'

// ============================================================================
// HERO — CONVERSATION-FIRST (owner pivot). Suize is now a self-contained
// CONVERSATIONAL AI wallet: you talk to it, it acts + pays. So the hero
// CENTERPIECE is no longer a wallet/notification card — it is a clean, premium,
// glassy CONVERSATION surface that renders HOME.hero.convo:
//
//   you  →  "watch flight prices and book the cheapest direct one."
//   ai   →  the PLAN reply ("On it. I'll check every day…")
//   ai   →  the PAYMENT PAYOFF ("Booked — direct to SFO, $240, paid from your
//           balance.")
//
// It reads, at a glance, "I tell it what I want, it handles it and pays."
//
// THE SURFACE: chat message rows / bubbles (you = right, ink-filled; ai = left,
// glassy) with a tasteful TYPING → ARRIVAL rhythm (a typing dots indicator on
// the ai turn, then the bubble lands). The payoff line carries a small paid
// chip. NOT a phone, NOT a device mockup — a flat frosted conversation pane.
// Beside it sits the real iOS-style "Agent enabled" switch (HOME.hero.toggle).
//
// LAYOUT stays ASYMMETRIC + off-grid: the headline bleeds left + oversized; the
// conversation pane floats to the upper-right.
//
// THE SHADER: the ONE contained living-matter accent (<HeroScene>) sits BEHIND
// the hero only — now reworked LIGHT + CONTRASTED (sparse ink threads, clearly
// felt on white, not the bloated falling-pixel field).
//
// MOTION: everything rides the staged .is-revealed reveal + a self-contained
// typing/arrival timer. Reduced-motion → the full thread is shown immediately,
// fully readable, no typing animation, no shader loop.
// ============================================================================

// the badge mark — a refined four-point SPARK glyph (a tiny shimmer), filled
// with the brand gradient via a clip. Replaces the old square "diode" (AI slop)
// with something classier + on-brand. Decorative only.
const SparkMark = () => (
  <span className="sx-hero2__spark" aria-hidden="true">
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <path
        d="M6 0c.45 2.7 2.3 4.55 5 5-.0001.0001 0 0 0 0-2.7.45-4.55 2.3-5 5-.45-2.7-2.3-4.55-5-5 2.7-.45 4.55-2.3 5-5Z"
        fill="url(#sx-spark-grad)"
      />
      <defs>
        <linearGradient id="sx-spark-grad" x1="1" y1="1" x2="11" y2="11" gradientUnits="userSpaceOnUse">
          <stop className="sx-spark__a" />
          <stop offset="1" className="sx-spark__b" />
        </linearGradient>
      </defs>
    </svg>
  </span>
)

// a tiny check glyph for the "paid" chip on the payoff message (a record mark,
// not a status diode) — matches the ConfirmSequence iOS family.
const PaidGlyph = () => (
  <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path
      d="M3 8.4 6.4 12 13 4.6"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
)

// the three animated typing dots shown while an AI turn is "thinking".
const TypingDots = () => (
  <span className="sx-convo__dots" aria-hidden="true">
    <span />
    <span />
    <span />
  </span>
)

// parse a "$1,234.56" money string → a number (1234.56). Tolerant of the
// commas/$ in the config + the convo text; returns NaN on a miss so callers can
// fall back. Keeps the header math derived from config/copy (no hardcoded $$).
const parseMoney = s => {
  const n = parseFloat(String(s).replace(/[^0-9.]/g, ''))
  return Number.isFinite(n) ? n : NaN
}
// format a number back to the wallet's "$220.00" shape (always 2 decimals,
// thousands-grouped) so the ticked value matches the static balance styling.
const fmtMoney = n =>
  '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export default function Hero() {
  const ref = useRef(null)
  const h1Ref = useRef(null)
  const { hero } = HOME
  const { convo, toggle, wallet } = hero

  // how many messages are currently "landed" (visible). Under reduced motion we
  // show them all at once; otherwise they arrive one-by-one with a typing beat
  // before each AI turn.
  const reduce = typeof window !== 'undefined' && prefersReducedMotion()
  const [shown, setShown] = useState(reduce ? convo.length : 0)
  // which row (if any) is currently "typing" — only AI turns type.
  const [typing, setTyping] = useState(false)

  // ---- WALLET HEADER MATH (derived, never drifting) ----------------------
  // the header shows the user's OWN funded balance. When the payment-payoff
  // message lands, the balance TICKS DOWN by the amount named IN that message
  // ("…$240, paid from your balance") so the chat + the money are ONE surface.
  // Both numbers are read from config/copy: startBal = wallet.balance, the spend
  // = the first $-figure in the last AI turn's text → the two can never diverge.
  const lastIdx = convo.length - 1
  const startBal = parseMoney(wallet?.balance)
  const payoffText = convo[lastIdx]?.text || ''
  const payoffSpend = parseMoney((payoffText.match(/\$[\d,]+(?:\.\d+)?/) || [])[0])
  const endBal =
    Number.isFinite(startBal) && Number.isFinite(payoffSpend)
      ? startBal - payoffSpend
      : startBal
  // the LIVE displayed balance. Starts at the full amount; under reduced motion
  // we jump straight to the post-payment value (no count animation) once the
  // full thread is shown. Otherwise it count-animates down when the payoff lands.
  const [balance, setBalance] = useState(reduce ? endBal : startBal)
  // a brief highlight flag so the eye catches the change (CSS-driven flash).
  const [paid, setPaid] = useState(reduce)

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

  // the typing/arrival choreography. A small chain of timeouts: the user line
  // lands first (after the reveal settles), then each AI turn shows a typing
  // indicator for a beat before its bubble lands. Skipped entirely under
  // reduced motion (the thread is already fully shown). Cleaned up on unmount.
  useEffect(() => {
    if (reduce) return
    const timers = []
    const at = (ms, fn) => timers.push(setTimeout(fn, ms))

    // base offset so the thread starts after the headline reveal has begun
    let t = 900
    convo.forEach((m, i) => {
      if (m.who === 'ai') {
        // AI turns "think" first: show typing, then land the bubble
        at(t, () => setTyping(true))
        t += 1100
        at(t, () => {
          setTyping(false)
          setShown(i + 1)
        })
        t += 650
      } else {
        // the user turn just lands
        at(t, () => setShown(i + 1))
        t += 700
      }
    })

    return () => timers.forEach(clearTimeout)
  }, [reduce, convo])

  // THE MAGIC TOUCH — when the payment-payoff message has landed (the last AI
  // turn is now shown), count the header balance DOWN from startBal → endBal and
  // flash the highlight, so the pane reads instantly as a WALLET THAT PAID. A
  // short rAF-driven count (eased), self-cleaning. Skipped under reduced motion:
  // there the balance already sits at endBal and `paid` is true (no animation).
  useEffect(() => {
    if (reduce) return
    if (shown <= lastIdx) return // payoff hasn't landed yet
    if (!Number.isFinite(startBal) || !Number.isFinite(endBal) || endBal === startBal) {
      setPaid(true)
      return
    }
    let raf
    const DURATION = 900
    const start = performance.now()
    const tick = now => {
      const t = Math.min(1, (now - start) / DURATION)
      // easeOutCubic — fast then settle, like a real balance debit
      const eased = 1 - Math.pow(1 - t, 3)
      setBalance(startBal + (endBal - startBal) * eased)
      if (t < 1) raf = requestAnimationFrame(tick)
      else setBalance(endBal)
    }
    setPaid(true)
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [shown, lastIdx, reduce, startBal, endBal])

  // render a headline line, clipping the hot word (`easier`) into the gradient.
  const renderLine = line => {
    if (!hero.hot || !line.includes(hero.hot)) return line
    const [before, after] = line.split(hero.hot)
    return (
      <>
        {before}
        <span className="sx-hero2__accent">{hero.hot}</span>
        {after}
      </>
    )
  }

  // (the payoff message is the LAST ai turn — `lastIdx` is computed above with
  // the wallet-header math; it gets the "paid" chip treatment in the thread.)

  // "See how it works" — the ghost link points at an ON-PAGE section (e.g.
  // `#leash`, the explainer/capabilities beat further down the home). A bare
  // `#section` hash was being read by the hash-router as a route change: it fired
  // the pixel-melt page-switch wipe and force-scrolled to the top — so the first
  // click "did nothing" (owner bug). Fix: intercept the click, keep the page on
  // `/`, and SMOOTH-SCROLL to the target in-page. Lenis owns smooth scroll
  // (configured non-smooth under reduced motion in startMotion); we fall back to
  // native scrollIntoView if Lenis isn't ready or the id is missing. The href is
  // kept for right-click / accessibility, but the route never changes.
  const onGhostClick = e => {
    const id = (hero.ghost.href || '').replace(/^#\/?/, '')
    const target = id && document.getElementById(id)
    if (!target) return // no on-page target → let the link behave normally
    e.preventDefault()
    const lenis = getLenis()
    if (lenis) {
      // reduced motion → an instant jump (no animated scroll); otherwise smooth.
      lenis.scrollTo(target, { offset: -24, immediate: reduce })
    } else {
      target.scrollIntoView({
        behavior: reduce ? 'auto' : 'smooth',
        block: 'start',
      })
    }
  }

  // an accessible transcript of the whole conversation for the role=img label.
  const transcript = convo
    .map(m => `${m.who === 'you' ? 'You' : 'Suize'}: ${m.text}`)
    .join('  ')

  return (
    <section className="sx-hero2" id="top" ref={ref}>
      {/* the ONE contained matter moment — the reworked LIGHT + CONTRASTED
          living-matter shader, bounded + clipped to this hero, mounted BEHIND
          the content (z-index 0). A quiet accent, never the star. */}
      <HeroScene />

      {/* the asymmetric grid: a wide claim column on the left, the floating
          conversation pane anchored upper-right (off-center) */}
      <div className="sx-hero2__inner sx-wrap">
        <div className="sx-hero2__claim">
          {/* the trust badge — a true, plain "Built on Sui" mark (no testnet).
              The mark is a refined gradient SPARK glyph (a tiny four-point
              shimmer), NOT a status diode/square — classier, on-brand. */}
          <div className="sx-hero2__badge">
            <SparkMark />
            {hero.badge}
          </div>

          <h1 className="sx-hero2__h1" ref={h1Ref}>
            {hero.h1.map((line, i) => (
              <span className="sx-hero2__line" key={i}>
                {renderLine(line)}
                {i < hero.h1.length - 1 && <br />}
              </span>
            ))}
          </h1>

          <p className="sx-hero2__sub">{hero.sub}</p>

          <div className="sx-hero2__actions">
            {/* the primary CTA — a frosted-glass pane (no corner brackets). */}
            <a className="sx-cta sx-cta--lg" href={hero.cta.href}>
              {hero.cta.label}
            </a>
            <a className="sx-ghost" href={hero.ghost.href} onClick={onGhostClick}>
              {hero.ghost.label}
            </a>
          </div>

          {/* the quiet one-line proof (NO star rating — owner removed it) */}
          <div className="sx-hero2__proof">
            <span className="sx-hero2__proofdot" aria-hidden="true" />
            <span className="sx-hero2__prooftext">{hero.proof}</span>
          </div>
        </div>

        {/* THE CONVERSATION — the hero centerpiece. A clean, glassy chat surface:
            you ask in plain words → the AI plans → the AI pays. Beside it, the
            real iOS "Agent enabled" switch. NOT a phone, NOT a device — a flat
            frosted conversation pane. The role=img + label carry the full thread
            to assistive tech; the visual messages are aria-hidden so the typing
            choreography never spams a screen reader. */}
        <div
          className="sx-hero2__convowrap"
          role="img"
          aria-label={`The Suize AI wallet. ${wallet?.label || 'Your agent wallet'}, balance ${fmtMoney(endBal)} after the booking. ${transcript}`}
        >
          <article className="sx-convo" aria-hidden="true">
            {/* WALLET HEADER — the chrome that makes the pane read as a wallet,
                not a bare chat: a quiet label + the BALANCE as the hero number.
                It adds height ONCE, statically (the thread below is fixed-height)
                so the pane never grows during the message sequence. When the
                booking lands the number ticks 460→220 with a brief highlight. */}
            <header className="sx-convo__wallet">
              <span className="sx-convo__walletlabel">
                <SparkMark />
                {wallet?.label || 'Your agent wallet'}
              </span>
              <span
                className={`sx-convo__balance${paid ? ' is-paid' : ''}`}
                aria-hidden="true"
              >
                {fmtMoney(balance)}
              </span>
            </header>

            <ol className="sx-convo__thread">
              {convo.map((m, i) => {
                const landed = i < shown
                const isPayoff = m.who === 'ai' && i === lastIdx
                return (
                  <li
                    key={i}
                    className={[
                      'sx-convo__row',
                      `sx-convo__row--${m.who}`,
                      landed ? 'is-in' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                  >
                    <span className="sx-convo__bubble">
                      {m.text}
                      {isPayoff && (
                        <span className="sx-convo__paid">
                          <span className="sx-convo__paidicon">
                            <PaidGlyph />
                          </span>
                          Paid · logged
                        </span>
                      )}
                    </span>
                  </li>
                )
              })}

              {/* the typing indicator — a glassy AI bubble with three pulsing
                  dots, shown only while an AI turn is "thinking". */}
              {typing && (
                <li className="sx-convo__row sx-convo__row--ai is-in sx-convo__row--typing">
                  <span className="sx-convo__bubble sx-convo__bubble--typing">
                    <TypingDots />
                  </span>
                </li>
              )}
            </ol>

            {/* the "Agent enabled" control rail — a real iOS-style switch sits at
                the foot of the conversation (purely illustrative: aria-hidden +
                not focusable, so the static mockup never traps focus). */}
            <footer className="sx-convo__foot">
              <span className="sx-convo__toggletext">{toggle.label}</span>
              <span
                className={`sx-switch${toggle.on ? ' is-on' : ''}`}
                aria-hidden="true"
              >
                <span className="sx-switch__knob" />
              </span>
            </footer>
          </article>
        </div>
      </div>
    </section>
  )
}
