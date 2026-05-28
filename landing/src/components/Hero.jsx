import { useEffect, useRef, useState } from 'react'
import Droplet from './Droplet'
import DropShader from './DropShader'
import WaitlistForm from './WaitlistForm'

/**
 * Hero — vertical canyon.
 *
 * The mascot sits between two halves of a giant headline:
 *   - "Sui,"        anchored top-left  · rotated -2deg
 *   - [ mascot ]    centered           · float-y + arm gestures
 *   - "answered."   anchored bottom-right · shimmer-text · rotated +2deg
 *
 * As the user scrolls, the two type-halves part vertically (parallax)
 * revealing more of the canyon below — a non-generic scroll motion.
 * Subtitle + email form anchor below the canyon, left-aligned with a
 * vertical mono ruler on the far left.
 *
 * Background is a domain-warped FBM shader (carbon-dark, Sui ink plume).
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
      // 0 when hero top is at viewport top; 1 when hero is fully scrolled past
      const t = Math.max(0, Math.min(1, -r.top / total))
      setScrollT(t)
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // Parallax offsets — type pulls apart vertically as user scrolls
  const suiOffset = scrollT * -120
  const ansOffset = scrollT * 140
  const mascotOffset = scrollT * 60

  return (
    <section
      ref={heroRef}
      className="relative isolate w-full overflow-hidden"
      style={{ minHeight: '110dvh' }}
    >
      {/* Background — custom ink-flow shader */}
      <DropShader />

      {/* Subtle scanlines + grain on top */}
      <div className="scanlines" />

      {/* Top marquee — slow horizontal intent stream */}
      <Marquee />

      {/* Left vertical mono ruler */}
      <Ruler />

      {/* Right vertical chip stack */}
      <ChipStack />

      {/* The canyon — typography wrapping the mascot */}
      <div className="relative z-10 mx-auto max-w-[100rem] w-full px-6 sm:px-12 lg:px-20 pt-32 sm:pt-40 pb-24">
        {/* "Agentic" — top-left, large, slightly rotated */}
        <h1
          className="font-sans font-medium tracking-[-0.045em] leading-[0.85] text-[color:var(--color-ink)] select-none"
          style={{
            fontSize: 'clamp(2.5rem, 13vw, 11rem)',
            transform: `translate3d(0, ${suiOffset}px, 0) rotate(-1.5deg)`,
            transition: 'transform 80ms linear',
            willChange: 'transform',
            marginLeft: '-0.04em',
          }}
        >
          Agentic RPC
        </h1>

        {/* Mascot — sandwiched, offset slightly right */}
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

        {/* "for Sui." — bottom-right, large, shimmer, rotated other way */}
        <h1
          className="font-sans font-medium tracking-[-0.045em] leading-[0.85] text-right select-none"
          style={{
            fontSize: 'clamp(3.5rem, 18vw, 16rem)',
            transform: `translate3d(0, ${ansOffset}px, 0) rotate(1.5deg)`,
            transition: 'transform 80ms linear',
            willChange: 'transform',
            marginRight: '-0.02em',
          }}
        >
          <span className="shimmer-text">for Sui.</span>
        </h1>
      </div>

      {/* Below the canyon — subtitle + CTA, left-anchored on a ruler line */}
      <div className="relative z-10 mx-auto max-w-[100rem] w-full px-6 sm:px-12 lg:px-20 pb-24">
        <div className="grid grid-cols-1 lg:grid-cols-[1.2fr_1fr] gap-10 items-end">
          <div className="flex flex-col gap-5 max-w-2xl">
            <p className="font-mono text-[10px] uppercase tracking-[0.32em] text-[color:var(--color-sui-bright)] flex items-center gap-2.5">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-[color:var(--color-sui-bright)] shadow-[0_0_8px_var(--color-sui-bright)]" />
              B2A infrastructure · live testnet
            </p>

            <p className="text-[color:var(--color-ink)] text-xl sm:text-2xl lg:text-3xl leading-[1.25] text-pretty font-medium">
              Your AI agent asks Sui anything in plain English.
              We return <span className="text-[color:var(--color-sui-bright)]">the structured answer</span> it needs to act.
            </p>

            <p className="text-[color:var(--color-ink-mute)] text-sm sm:text-base leading-relaxed text-pretty max-w-xl">
              One MCP endpoint. Atomic intent + payment. No keys, no SDK, no indexer.
              Speaks <span className="text-[color:var(--color-ink-dim)] font-mono">x402</span> and{' '}
              <span className="text-[color:var(--color-ink-dim)] font-mono">AP2</span>, settles in gasless USDsui.
            </p>

            <div className="flex flex-wrap gap-x-5 gap-y-2 mt-1 text-[10px] sm:text-xs font-mono text-[color:var(--color-ink-mute)] uppercase tracking-[0.18em]">
              <span>· MCP compatible</span>
              <span>· gasless USDsui</span>
            </div>
          </div>

          <div className="flex flex-col gap-3">
            <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-[color:var(--color-sui-bright)]">
              &gt; Get early access
            </p>
            <WaitlistForm compact />
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

/** Top horizontal marquee — slow intent ticker, dimensional/ambient */
function Marquee () {
  const items = [
    'agent.ask("best USDC pool")',
    '→ settled · 240ms',
    'agent.ask("largest validator this epoch")',
    '→ settled · 188ms',
    'agent.ask("primemachin under 10 SUI")',
    '→ settled · 311ms',
  ]
  return (
    <div
      aria-hidden="true"
      className="absolute top-0 left-0 right-0 z-[5] h-9 border-b border-[color:var(--color-line)] bg-[color:var(--color-bg)]/70 backdrop-blur-sm overflow-hidden"
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

/** Right edge floating chip stack */
function ChipStack () {
  return (
    <div
      aria-hidden="true"
      className="hidden lg:flex absolute right-6 top-1/4 bottom-1/4 z-[5] flex-col items-end justify-center gap-3"
    >
      <span className="chip px-2.5 py-1 font-mono text-[10px] text-[color:var(--color-sui-bright)] tracking-wider whitespace-nowrap float-y">
        POST /ask
      </span>
      <span className="chip px-2.5 py-1 font-mono text-[10px] text-[color:var(--color-sui-bright)] tracking-wider whitespace-nowrap float-y-2">
        x402 · USDsui
      </span>
      <span className="chip px-2.5 py-1 font-mono text-[10px] text-[color:var(--color-sui-bright)] tracking-wider whitespace-nowrap float-y-3">
        @suize.sui
      </span>
      <span className="chip px-2.5 py-1 font-mono text-[10px] text-[color:var(--color-sui-bright)] tracking-wider whitespace-nowrap float-y">
        { '{ ask }' }
      </span>
    </div>
  )
}
