import { useEffect, useRef, useState } from 'react'
import { NOTIFICATIONS } from '../config'
import { gsap, prefersReducedMotion } from '../lib/motion'

// ============================================================================
// <ConfirmSequence> — the CONFIRM MOMENT as a UI moment, not a headline (owner).
// An AUTHENTIC iOS/macOS notification slides in → a Confirm tap → it morphs into
// a small receipt. It now CYCLES the intelligent NOTIFICATIONS deck so the moment
// reads as a SMART ASSISTANT, not a payment log: it finds a cheaper flight,
// cancels a duplicate sub, re-prices a booking, renews Netflix, orders the usual.
//
// VARIETY (owner: "show intelligence + variety"): each card is differentiated by
// `kind` (smart-find / subscription / cancel / order / save) — a per-kind app
// icon + a subtle accent family — while the iOS notification SHELL (radius,
// app-row, title/body, frosted material, soft shadow) stays constant. The
// `tone: 'save'` cards wear the green saver family; the rest wear brand blue.
//
// MOTION (on GSAP — the shared clock; no second rAF): slide+fade in → Confirm
// press → collapse into a compact RECEIPT (paid · logged), then it cross-fades
// to the NEXT notification in the deck. Under reduced motion the receipt shows
// immediately, fully readable, and it does not auto-cycle.
// ============================================================================

// per-kind glyphs — small, monochrome, currentColor (the icon tile sets colour
// via the accent class). They give each notification a distinct "what is this"
// read without breaking the single-family iOS look.
const Glyphs = {
  // smart-find — a magnifier (it searched + found)
  'smart-find': (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="7" cy="7" r="4" stroke="currentColor" strokeWidth="1.5" />
      <path d="M10.2 10.2 13.5 13.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  ),
  // subscription — a recurring loop
  subscription: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M3 8a5 5 0 0 1 8.5-3.5L13 6M13 8a5 5 0 0 1-8.5 3.5L3 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M13 3.5V6h-2.5M3 12.5V10h2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  // cancel — a slashed circle (it killed a duplicate)
  cancel: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="5.2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M4.6 4.6 11.4 11.4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  ),
  // save — a downward price tick (a saver / price drop)
  save: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M8 3v8M8 11 4.8 7.8M8 11l3.2-3.2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  // order — a bag (it placed your usual order)
  order: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M4 5.5h8l-.7 7a1 1 0 0 1-1 .9H5.7a1 1 0 0 1-1-.9L4 5.5Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M6 5.5V5a2 2 0 0 1 4 0v.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  ),
}

const FallbackGlyph = Glyphs['smart-find']

const CheckGlyph = () => (
  <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M3 8.4 6.4 12 13 4.6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

// build a short receipt line from a notification's `logged` row (what it did +
// the amount), so the paid state proves the action, not just a number.
function receiptOf(notif) {
  const l = notif.logged || {}
  const saved = l.kind === 'save'
  return {
    title: l.what || notif.title,
    meta: l.amount
      ? `${l.amount} · ${saved ? 'saved' : 'paid from your balance'} · logged on-chain`
      : 'From your balance · logged on-chain',
  }
}

export default function ConfirmSequence({ tag }) {
  const cardRef = useRef(null)
  const yesRef = useRef(null)
  const tlRef = useRef(null)
  // which notification in the deck is showing
  const [idx, setIdx] = useState(0)
  // 'notif' = asking · 'pressed' = confirm down · 'receipt' = paid
  const [stage, setStage] = useState('notif')

  const reduce = typeof window !== 'undefined' && prefersReducedMotion()
  const notif = NOTIFICATIONS[idx % NOTIFICATIONS.length] || NOTIFICATIONS[0]
  const receipt = receiptOf(notif)

  // play the slide-in once per notification (the parent only mounts it when
  // revealed; idx changes drive subsequent slide-ins via the loop below).
  useEffect(() => {
    if (reduce) return
    const el = cardRef.current
    if (!el) return
    const tl = gsap.timeline()
    tlRef.current = tl
    tl.fromTo(
      el,
      { y: -34, opacity: 0, scale: 0.96 },
      { y: 0, opacity: 1, scale: 1, duration: 0.7, ease: 'back.out(1.4)' },
    )
    return () => tl.kill()
  }, [reduce, idx])

  const runConfirm = () => {
    if (stage !== 'notif') return
    if (reduce) {
      setStage('receipt')
      return
    }
    setStage('pressed')
    const el = cardRef.current
    const tl = gsap.timeline({
      onComplete: () => setStage('receipt'),
    })
    tl.to(yesRef.current, { scale: 0.95, duration: 0.09, ease: 'power2.in' })
      .to(yesRef.current, { scale: 1, duration: 0.14, ease: 'power2.out' })
      .to(el, { scale: 0.985, duration: 0.18, ease: 'power2.inOut' }, '+=0.05')
      .to(el, { scale: 1, duration: 0.32, ease: 'back.out(1.6)' })
  }

  // when the receipt has shown for a beat, fade out and advance to the NEXT
  // notification in the deck (so the moment shows the assistant's range, not one
  // canned card). Disabled under reduced motion.
  useEffect(() => {
    if (stage !== 'receipt' || reduce) return
    const t = setTimeout(() => {
      const el = cardRef.current
      if (!el) return
      gsap.to(el, {
        opacity: 0,
        y: -18,
        duration: 0.4,
        ease: 'power2.in',
        onComplete: () => {
          setStage('notif')
          setIdx(i => (i + 1) % NOTIFICATIONS.length)
        },
      })
    }, 3600)
    return () => clearTimeout(t)
  }, [stage, reduce])

  const kind = notif.kind || 'smart-find'
  const accent = notif.tone === 'save' ? ' sx-ios--save' : ''

  return (
    <div className="sx-cs">
      {tag ? <span className="sx-cs__tag">{tag}</span> : null}

      <div className="sx-cs__stage">
        <div
          className={`sx-ios sx-ios--${kind}${accent}${stage === 'receipt' ? ' is-receipt' : ''}`}
          ref={cardRef}
          role="group"
          aria-label="Your agent asking permission to act"
        >
          <header className="sx-ios__top">
            <span className="sx-ios__icon" aria-hidden="true">
              {Glyphs[kind] || FallbackGlyph}
            </span>
            <span className="sx-ios__app">Suize</span>
            <span className="sx-ios__time">now</span>
          </header>

          {stage === 'receipt' ? (
            <div className="sx-ios__receipt">
              <span className="sx-ios__rcheck" aria-hidden="true">
                <CheckGlyph />
              </span>
              <span className="sx-ios__rbody">
                <span className="sx-ios__rtitle">{receipt.title}</span>
                <span className="sx-ios__rmeta">{receipt.meta}</span>
              </span>
            </div>
          ) : (
            <>
              <p className="sx-ios__title">{notif.title}</p>
              <p className="sx-ios__msg">{notif.body}</p>
              <div className="sx-ios__actions">
                <button type="button" className="sx-ios__no" onClick={() => {}}>
                  {notif.no || 'Not now'}
                </button>
                <button
                  type="button"
                  className={`sx-ios__yes${stage === 'pressed' ? ' is-pressed' : ''}`}
                  ref={yesRef}
                  onClick={runConfirm}
                >
                  {notif.yes || 'Confirm'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
