import Droplet from './Droplet'
import { StargazingMini } from './MascotMini'
import { useReveal, useSectionProgress } from '../lib/hooks'

/**
 * MeetSuize — the mascot's second appearance.
 *
 * Distinct from the hero:
 *  - smaller mascot (220px vs 360px in hero)
 *  - PENDULUM animation — pure horizontal lean with rotation, NO vertical
 *    motion. Genuinely distinct from the hero's float-y (purely vertical)
 *    so the second appearance reads as a different character beat.
 *  - scroll-driven "convergence": the two flanking columns enter the
 *    viewport pulled outward and slide inward toward the mascot as the
 *    section scrolls into place. After mid-scroll they settle naturally.
 *    Subtle layout shift on scroll — same energy as scale.com.
 */
export default function MeetSuize () {
  const [revealRef, visible] = useReveal(0.15)
  const [progressRef, progress] = useSectionProgress()

  // Map scroll progress 0 → 0.5 to a "convergence" factor 1 → 0.
  // Beyond 0.5 the columns stay settled.
  const t = Math.max(0, Math.min(1, 1 - progress * 2))
  // Eased: smoother arrival
  const eased = t * t * (3 - 2 * t) // smoothstep
  const offset = eased * 56 // px

  // Bind both refs to the same node — useReveal handles the section's
  // overall reveal, useSectionProgress drives the column parallax.
  const setRefs = (el) => {
    revealRef.current = el
    progressRef.current = el
  }

  return (
    <section
      id="meet-suize"
      ref={setRefs}
      className={`scroll-section relative py-24 sm:py-32 px-5 sm:px-8 lg:px-12 overflow-hidden reveal ${visible ? 'is-visible' : ''}`}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(circle at center, rgba(77,162,255,0.08) 0%, transparent 55%)',
        }}
      />

      <div className="relative max-w-5xl mx-auto">
        {/* tiny stargazing cameo — admiring the big mascot from afar */}
        <StargazingMini
          size={56}
          className="hidden lg:block absolute -top-2 left-0 z-10 pointer-events-none"
        />

        <header className="text-center mb-16">
          <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-[color:var(--color-sui-bright)] mb-3">
            · meet Suize
          </p>
          <h2 className="font-sans text-[clamp(2rem,4.5vw,3.5rem)] leading-[1.05] tracking-tight font-medium text-balance">
            Agentic RPC for Sui.{' '}
            <span className="shimmer-text">One pipeline. Every question.</span>
          </h2>
        </header>

        {/* Triptych — left text, mascot center (sway), right text */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto_1fr] gap-10 lg:gap-12 items-center">
          {/* LEFT — the pipeline, slides inward from -X as section enters */}
          <div
            className="text-center lg:text-right"
            style={{
              transform: `translate3d(${-offset}px, 0, 0)`,
              willChange: 'transform',
            }}
          >
            <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-[color:var(--color-sui-bright)] mb-3">
              one unified pipeline
            </p>
            <h3 className="font-sans text-xl sm:text-2xl mb-3 font-medium">
              No tiers. No routing. No SDK.
            </h3>
            <p className="text-[color:var(--color-ink-dim)] text-sm sm:text-base leading-relaxed text-pretty">
              Factual reads and judgment calls travel the same path. Ask a balance, ask which protocol smells suspicious. Same endpoint, same shape, same gasless USDsui settlement on every call.
            </p>
          </div>

          {/* CENTER — mascot, distinct animation from hero */}
          <div className="relative flex items-center justify-center min-h-[260px]">
            <div aria-hidden="true" className="sui-halo absolute -inset-16 rounded-full pointer-events-none" />
            <div className="pendulum relative z-10">
              <Droplet size={220} pose="hello" />
            </div>
          </div>

          {/* RIGHT — convergence as the correctness primitive */}
          <div
            className="text-center lg:text-left"
            style={{
              transform: `translate3d(${offset}px, 0, 0)`,
              willChange: 'transform',
            }}
          >
            <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-[color:var(--color-sui-bright)] mb-3">
              convergence is the answer
            </p>
            <h3 className="font-sans text-xl sm:text-2xl mb-3 font-medium">
              Every reply ships with a score.
            </h3>
            <p className="text-[color:var(--color-ink-dim)] text-sm sm:text-base leading-relaxed text-pretty">
              A convergence score from 0.0 to 1.0 reports how interpretive the answer turned out to be. A balance lookup lands at 1.0. "Is this protocol suspicious" lands near 0.5. Your agent decides what to trust.
            </p>
          </div>
        </div>

        <p className="mt-16 text-center font-mono text-[10px] uppercase tracking-[0.28em] text-[color:var(--color-ink-mute)]">
          discovered through the MCP registry · no docs to read · no SDK to install
        </p>
      </div>
    </section>
  )
}
