import { useEffect, useRef, useState } from 'react'
import Droplet from './Droplet'
import DropShader from './DropShader'
import XIcon from './XIcon'
import { WALLET_URL, CRASH_URL, ACCESS_WALLET_LABEL } from '../links'

/**
 * Hero — vertical canyon (aesthetic reused from the original landing).
 *
 * The mascot sits between two halves of a giant headline:
 *   - "Your money,"  anchored top-left  · rotated -1.5deg
 *   - [ mascot ]     centered           · float-y + arm gestures
 *   - "on autopilot." anchored bottom-right · shimmer-text · rotated +1.5deg
 *
 * As the user scrolls the two type-halves part vertically (parallax). The
 * subhead carries the honest one-liner ("on a leash only you control") and the
 * primary CTA is "Access wallet" (== sign in; the wallet opens with Google
 * login). Voice is calibrated honesty — no "get rich" / guaranteed-gains.
 *
 * Background is the domain-warped FBM ink shader (unchanged).
 */

export default function Hero () {
  const heroRef = useRef(null)
  const [scrollT, setScrollT] = useState(0) // 0..1 progress within hero

  useEffect(() => {
    const onScroll = () => {
      const el = heroRef.current
      if (!el) return
      const r = el.getBoundingClientRect()
      const total = r.height
      const t = Math.max(0, Math.min(1, -r.top / total))
      setScrollT(t)
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // Parallax offsets — type pulls apart vertically as user scrolls
  const topOffset = scrollT * -120
  const botOffset = scrollT * 140
  const mascotOffset = scrollT * 60

  return (
    <section
      id="top"
      ref={heroRef}
      className="relative isolate w-full overflow-hidden"
      style={{ minHeight: '110dvh' }}
    >
      {/* Background — custom ink-flow shader (reused) */}
      <DropShader />

      {/* Subtle scanlines + grain on top */}
      <div className="scanlines" />

      {/* Top marquee — slow stream of honest on-chain receipts */}
      <Marquee />

      {/* Left vertical mono ruler */}
      <Ruler />

      {/* Right vertical chip stack */}
      <ChipStack />

      {/* The canyon — typography wrapping the mascot */}
      <div className="relative z-10 mx-auto max-w-[100rem] w-full px-6 sm:px-12 lg:px-20 pt-32 sm:pt-40 pb-24">
        {/* "Your money," — top-left, large, slightly rotated */}
        <h1
          className="font-sans font-medium tracking-[-0.045em] leading-[0.85] text-[color:var(--color-ink)] select-none"
          style={{
            fontSize: 'clamp(2.5rem, 11vw, 9.5rem)',
            transform: `translate3d(0, ${topOffset}px, 0) rotate(-1.5deg)`,
            transition: 'transform 80ms linear',
            willChange: 'transform',
            marginLeft: '-0.04em',
          }}
        >
          Your money,
        </h1>

        {/* Mascot — sandwiched */}
        <div
          className="relative flex justify-center my-[-2vw] sm:my-[-4vw]"
          style={{
            transform: `translate3d(0, ${mascotOffset}px, 0)`,
            transition: 'transform 80ms linear',
            willChange: 'transform',
          }}
        >
          <div className="relative">
            <div aria-hidden="true" className="sui-halo absolute -inset-24 sm:-inset-32 rounded-full pointer-events-none" />
            <div className="float-y relative z-10 scale-[0.65] sm:scale-100 origin-center">
              <Droplet size={360} pose="hero" />
            </div>
          </div>
        </div>

        {/* "on autopilot." — bottom-right, large, shimmer, rotated other way */}
        <h1
          className="font-sans font-medium tracking-[-0.045em] leading-[0.85] text-right select-none"
          style={{
            fontSize: 'clamp(3rem, 15vw, 13rem)',
            transform: `translate3d(0, ${botOffset}px, 0) rotate(1.5deg)`,
            transition: 'transform 80ms linear',
            willChange: 'transform',
            marginRight: '-0.02em',
          }}
        >
          <span className="shimmer-text">on autopilot.</span>
        </h1>
      </div>

      {/* Below the canyon — subhead + CTAs, left-anchored */}
      <div className="relative z-10 mx-auto max-w-[100rem] w-full px-6 sm:px-12 lg:px-20 pb-24">
        <div className="grid grid-cols-1 lg:grid-cols-[1.2fr_1fr] gap-10 items-end">
          <div className="flex flex-col gap-5 max-w-2xl">
            <p className="font-mono text-[10px] uppercase tracking-[0.32em] text-[color:var(--color-sui-bright)] flex items-center gap-2.5">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-[color:var(--color-sui-bright)] shadow-[0_0_8px_var(--color-sui-bright)]" />
              The agentic Sui wallet · live on testnet
            </p>

            <p className="text-[color:var(--color-ink)] text-xl sm:text-2xl lg:text-3xl leading-[1.25] text-pretty font-medium">
              Dedicate a sandbox of play money to an AI agent that works it 24/7
              — <span className="text-[color:var(--color-sui-bright)]">on a leash only you control.</span>
            </p>

            <p className="text-[color:var(--color-ink-mute)] text-sm sm:text-base leading-relaxed text-pretty max-w-xl">
              An on-chain Move mandate the agent physically can't escape: it never
              touches your savings, never breaks scope, and one tap revokes it.
              The chain caps the loss at the sandbox wall — never to zero, never your main wallet.
            </p>

            <div className="flex flex-wrap gap-x-5 gap-y-2 mt-1 text-[10px] sm:text-xs font-mono text-[color:var(--color-ink-mute)] uppercase tracking-[0.18em]">
              <span>· VM-enforced mandate</span>
              <span>· seedless Google login</span>
              <span>· gasless</span>
            </div>
          </div>

          {/* CTA cluster */}
          <div className="flex flex-col gap-3">
            <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-[color:var(--color-sui-bright)]">
              &gt; Start here
            </p>
            <div className="flex flex-col sm:flex-row gap-3">
              <a
                href={WALLET_URL}
                className="neu-btn px-6 py-3.5 font-mono text-sm font-bold uppercase tracking-wider text-center whitespace-nowrap"
              >
                {ACCESS_WALLET_LABEL} →
              </a>
              <a
                href={CRASH_URL}
                className="px-6 py-3.5 rounded-[4px] border border-[color:var(--color-line-bright)] hover:border-[color:var(--color-sui-bright)] hover:text-[color:var(--color-sui-bright)] text-[color:var(--color-ink-dim)] font-mono text-sm font-bold uppercase tracking-wider text-center whitespace-nowrap transition-colors"
              >
                Play Crash
              </a>
            </div>
            <p className="font-mono text-[10px] text-[color:var(--color-ink-mute)] tracking-wider leading-relaxed mt-1">
              Access wallet opens with Google sign-in. Testnet — no real funds.
            </p>
          </div>
        </div>
      </div>

      {/* Scroll cue */}
      <div
        aria-hidden="true"
        className="absolute bottom-5 left-1/2 -translate-x-1/2 flex flex-col items-center gap-1.5 text-[color:var(--color-ink-mute)] font-mono text-[10px] uppercase tracking-[0.3em] z-10"
      >
        <span className="opacity-70">scroll</span>
        <span className="w-px h-7 bg-gradient-to-b from-[color:var(--color-sui-bright)] to-transparent animate-pulse" />
      </div>
    </section>
  )
}

/** Top horizontal marquee — honest on-chain receipts (no alpha claims). */
function Marquee () {
  const items = [
    'agent: lent 200 USDC as-is on NAVI',
    '→ AgentActed · within mandate',
    'agent: trimmed 0.4 SUI → USDC',
    '→ position-risk-throttle · logged',
    'jailbreak attempt → VM aborted on-chain',
    '→ revoke ready · one tap',
  ]
  return (
    <div
      aria-hidden="true"
      className="absolute top-0 left-0 right-0 z-[5] h-9 mt-16 border-y border-[color:var(--color-line)] bg-[color:var(--color-bg)]/70 backdrop-blur-sm overflow-hidden"
    >
      <div className="flex gap-12 items-center h-full whitespace-nowrap font-mono text-[10px] tracking-[0.18em] uppercase text-[color:var(--color-ink-mute)] animate-[marquee_50s_linear_infinite]">
        {[...items, ...items, ...items].map((t, i) => (
          <span key={i} className={i % 2 === 0 ? 'text-[color:var(--color-sui-bright)]' : ''}>
            {t}
          </span>
        ))}
      </div>
      <style>{`
        @keyframes marquee {
          0% { transform: translateX(0); }
          100% { transform: translateX(-33.333%); }
        }
        @media (prefers-reduced-motion: reduce) {
          .animate-\\[marquee_50s_linear_infinite\\] { animation: none; }
        }
      `}</style>
    </div>
  )
}

/** Left edge vertical ruler — section line numbers + ticks */
function Ruler () {
  return (
    <div
      aria-hidden="true"
      className="hidden lg:flex absolute left-4 top-0 bottom-0 z-[5] flex-col items-center justify-between py-12 font-mono text-[10px] tracking-[0.2em] uppercase text-[color:var(--color-ink-mute)]"
    >
      <span className="rotate-180" style={{ writingMode: 'vertical-rl' }}>
        // 01 → idle
      </span>
      <span className="w-px flex-1 bg-gradient-to-b from-transparent via-[color:var(--color-line-bright)] to-transparent my-4" />
      <span className="rotate-180" style={{ writingMode: 'vertical-rl' }}>
        suize.io / hero
      </span>
    </div>
  )
}

/** Right edge floating chip stack — the cage's vocabulary */
function ChipStack () {
  return (
    <div
      className="hidden lg:flex absolute right-6 top-1/4 bottom-1/4 z-[5] flex-col items-end justify-center gap-3 pointer-events-none"
    >
      <span className="chip px-2.5 py-1 font-mono text-[10px] text-[color:var(--color-sui-bright)] tracking-wider whitespace-nowrap float-y">
        budget cap
      </span>
      <span className="chip px-2.5 py-1 font-mono text-[10px] text-[color:var(--color-sui-bright)] tracking-wider whitespace-nowrap float-y-2">
        scope · expiry
      </span>
      <span className="chip px-2.5 py-1 font-mono text-[10px] text-[color:var(--color-sui-bright)] tracking-wider whitespace-nowrap float-y-3">
        revoke ↯
      </span>
      <span className="chip px-2.5 py-1 font-mono text-[10px] text-[color:var(--color-sui-bright)] tracking-wider whitespace-nowrap float-y">
        { '{ mandate }' }
      </span>
      <a
        href="https://x.com/suize_io"
        target="_blank"
        rel="noopener noreferrer"
        className="chip px-2.5 py-1 font-mono text-[10px] text-[color:var(--color-sui-bright)] tracking-wider whitespace-nowrap float-y-2 inline-flex items-center gap-1.5 hover:text-[color:var(--color-ink)] transition-colors pointer-events-auto"
      >
        <XIcon size={10} />
        <span>@suize_io</span>
      </a>
    </div>
  )
}
