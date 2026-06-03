import { useEffect, useRef, useState } from 'react'
import { ThinkingMini } from './MascotMini'

/**
 * Flow — sequential scroll-revealed pipeline.
 *
 * Each step has its own IntersectionObserver tuned to fire when the step
 * is roughly centered in the viewport. The vertical thread between steps
 * draws downward as the section progresses — its height tracks the index
 * of the deepest revealed step.
 *
 * Result: scrolling the section feels like progressively building a
 * recipe, one beat at a time, instead of one big "section reveal."
 */

const STEPS = [
  {
    label: 'Agent asks',
    render: () => (
      <div className="flex flex-col gap-2 min-w-0">
        <span className="font-mono text-sm sm:text-base text-[color:var(--color-ink)] break-words">
          ask("which $DEEP staking venue is healthiest right now?", consensus: 3)
        </span>
        <span className="font-mono text-[10px] sm:text-xs text-[color:var(--color-ink-mute)] tracking-wider">
          consensus: 3 · pre-payment quote received
        </span>
      </div>
    ),
  },
  {
    label: 'Suize',
    highlight: true,
    render: () => (
      <div className="flex items-center justify-between gap-3 min-w-0">
        <div className="flex flex-col gap-2 min-w-0">
          <div className="flex items-center gap-3 min-w-0">
            <span className="inline-block w-2.5 h-2.5 rounded-full bg-[color:var(--color-sui-bright)] shadow-[0_0_12px_var(--color-sui-bright)] animate-pulse shrink-0" />
            <span className="font-mono text-sm sm:text-base text-[color:var(--color-sui-bright)]">
              3 parallel interpretation passes
            </span>
          </div>
          <pre className="font-mono text-[11px] sm:text-xs text-[color:var(--color-ink-dim)] whitespace-pre overflow-x-auto leading-relaxed">{`pass 1 → Scallop  (8.4% apy, $12M tvl, audited)
pass 2 → Scallop  (8.4% apy, $12M tvl, audited)
pass 3 → Suilend  (7.1% apy,  $8M tvl, audited)
aggregate → Scallop · convergence: 0.87`}</pre>
        </div>
        {/* the deliberation made literal */}
        <ThinkingMini size={48} className="shrink-0 hidden sm:block" />
      </div>
    ),
  },
  {
    label: 'Agent gets',
    render: () => (
      <div className="flex flex-col gap-3 min-w-0">
        <div className="flex items-baseline gap-2 min-w-0">
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:var(--color-sui-bright)] shrink-0">
            prose
          </span>
          <p className="text-[color:var(--color-ink)] text-sm sm:text-base leading-snug text-pretty min-w-0">
            Healthiest venue for $DEEP: <span className="text-[color:var(--color-sui-bright)]">Scallop (8.4%)</span>. 2 of 3 passes agreed. Audited, $12M TVL, no concentration flags.
          </p>
        </div>
        <div className="flex items-baseline gap-2 pt-2 border-t border-[color:var(--color-line)] min-w-0">
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:var(--color-sui-bright)] shrink-0 mt-1">
            json
          </span>
          <pre className="font-mono text-[11px] sm:text-xs text-[color:var(--color-ink-dim)] whitespace-pre overflow-x-auto leading-relaxed min-w-0 flex-1">{`{
  answer:           "Scallop",
  apy:              0.084,
  tvl_usd:          12_000_000,
  audited:          true,
  convergence:      0.87,
  consensus_n:      3,
  as_of_checkpoint: 47821934
}`}</pre>
        </div>
      </div>
    ),
  },
  {
    label: 'Agent pays',
    render: () => (
      <div className="flex flex-col gap-1.5">
        <span className="font-mono text-base sm:text-lg text-[color:var(--color-sui-bright)]">
          3 × $0.05 = $0.15 USDsui · <span className="text-[color:var(--color-ink-mute)] text-xs sm:text-sm tracking-wider">atomic with the request</span>
        </span>
        <span className="font-mono text-[10px] sm:text-xs text-[color:var(--color-ink-mute)] tracking-wider">
          x402 over gasless USDsui · receipt settles on-chain in the same round-trip
        </span>
      </div>
    ),
  },
]

export default function Flow () {
  // Track the deepest step that's been revealed (monotonic increase)
  const [revealedUpTo, setRevealedUpTo] = useState(-1)

  return (
    <section
      id="flow"
      className="scroll-section relative py-24 sm:py-28 px-5 sm:px-8 lg:px-12 overflow-hidden"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(circle at 30% 50%, rgba(77,162,255,0.07) 0%, transparent 60%)',
        }}
      />

      <div className="relative max-w-5xl mx-auto">
        <header className="mb-14 text-center">
          <p className="font-mono text-xs uppercase tracking-[0.3em] text-[color:var(--color-sui-bright)] mb-3">
            The whole product in one diagram
          </p>
          <h2 className="font-sans text-3xl sm:text-4xl tracking-tight text-balance font-medium">
            Question in. <span className="shimmer-text">Answer plus convergence out.</span>
          </h2>
        </header>

        <div className="relative">
          {/* Vertical thread — height grows as user descends through steps */}
          <div
            aria-hidden="true"
            className="absolute left-[80px] sm:left-[150px] top-4 w-px bg-gradient-to-b from-transparent via-[color:var(--color-sui)] to-[color:var(--color-sui-bright)]"
            style={{
              height: `${Math.min(100, Math.max(0, (revealedUpTo + 1) * 25))}%`,
              transition: 'height 600ms cubic-bezier(0.65, 0, 0.35, 1)',
              boxShadow: '0 0 12px var(--color-sui-bright)',
              minHeight: revealedUpTo >= 0 ? 80 : 0,
            }}
          />
          {/* Idle background thread — barely visible base layer */}
          <div
            aria-hidden="true"
            className="absolute left-[80px] sm:left-[150px] top-4 bottom-4 w-px"
            style={{ background: 'var(--color-line)' }}
          />

          {STEPS.map((step, i) => (
            <FlowStep
              key={step.label}
              index={i}
              label={step.label}
              highlight={step.highlight}
              isLast={i === STEPS.length - 1}
              onReveal={() => setRevealedUpTo((x) => Math.max(x, i))}
            >
              {step.render()}
            </FlowStep>
          ))}
        </div>

        <p className="text-center mt-14 text-[color:var(--color-ink-dim)] text-base sm:text-lg max-w-2xl mx-auto text-pretty">
          That's it. <span className="text-[color:var(--color-ink)]">No SDK, no API key, no human in the loop.</span>{' '}
          Discoverable via <span className="font-mono text-[color:var(--color-sui-bright)]">llms.txt</span>{' '}
          and the MCP registry. Default consensus is 1. Crank it for judgment calls.
        </p>
      </div>
    </section>
  )
}

/**
 * FlowStep — single beat with its own intersection trigger.
 */
function FlowStep ({ index, label, children, highlight = false, isLast, onReveal }) {
  const ref = useRef(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduced) {
      setVisible(true)
      onReveal && onReveal()
      return
    }

    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setVisible(true)
            onReveal && onReveal()
            io.disconnect()
            break
          }
        }
      },
      { threshold: 0.4, rootMargin: '-10% 0px -20% 0px' }
    )
    io.observe(el)

    // Safety fallback so steps far below the fold still reveal eventually
    const safety = setTimeout(() => {
      setVisible(true)
      onReveal && onReveal()
    }, 2000 + index * 250)

    return () => {
      io.disconnect()
      clearTimeout(safety)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div
      ref={ref}
      className="relative grid grid-cols-[80px_1fr] sm:grid-cols-[150px_1fr] gap-3 sm:gap-6 my-3 items-stretch"
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? 'translateY(0)' : 'translateY(28px)',
        transition: 'opacity 700ms ease-out, transform 700ms cubic-bezier(0.16, 1, 0.3, 1)',
        transitionDelay: visible ? '0ms' : '0ms',
      }}
    >
      <div className="flex items-center justify-end pr-1 sm:pr-3">
        <span className="font-mono text-[10px] sm:text-xs uppercase tracking-[0.22em] text-[color:var(--color-sui-bright)]">
          {label}
        </span>
      </div>
      <div
        className={`neu neu-hover px-5 py-4 min-w-0 ${highlight ? 'ring-1 ring-[color:var(--color-sui)]/30' : ''}`}
        style={{ position: 'relative' }}
      >
        {/* Node dot on the thread */}
        <span
          aria-hidden="true"
          className="absolute -left-[10px] sm:-left-[12px] top-1/2 -translate-y-1/2 w-2 h-2 rounded-full"
          style={{
            background: visible ? 'var(--color-sui-bright)' : 'var(--color-line-bright)',
            boxShadow: visible ? '0 0 12px var(--color-sui-bright)' : 'none',
            transition: 'background 500ms ease, box-shadow 500ms ease',
          }}
        />
        {children}
      </div>
      {!isLast && (
        <div aria-hidden="true" className="hidden sm:flex justify-start col-start-2 my-1 ml-0">
          {/* Spacer to keep grid rhythm */}
        </div>
      )}
    </div>
  )
}
