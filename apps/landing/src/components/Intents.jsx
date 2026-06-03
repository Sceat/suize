import { useEffect, useRef, useState } from 'react'
import { CoolMini } from './MascotMini'

/**
 * Intents — six litmus-test cards, each with its own scroll trigger so the
 * grid fills in as a wave instead of one bulk reveal. Alternating columns
 * slide from opposite sides for a zigzag cascade feel.
 */

const INTENTS = [
  {
    q: 'Balance of 0xabc...',
    a: 'The English has one valid parse. Same chain read, same answer, every pass.',
    kind: 'chain.read',
    convergence: 1.00,
  },
  {
    q: 'All NFTs in kiosk 0xdef...',
    a: 'Object enumeration under the kiosk root. Typed, complete, no ranking required.',
    kind: 'kiosk.read',
    convergence: 1.00,
  },
  {
    q: 'Top 5 holders of $DEEP with balance > $100k.',
    a: 'Filter and rank over a typed balance set. Minor interpretation on "balance" sourcing.',
    kind: 'holders.rank',
    convergence: 0.95,
  },
  {
    q: 'Profitable USDC arb route across Cetus, DeepBook, Aftermath right now.',
    a: 'Live path-finding, net of fees and gas. Route shape is solved; "right now" carries small drift.',
    kind: 'defi.arbitrage',
    convergence: 0.85,
  },
  {
    q: 'Top 5 memecoins created in the last 24h, accumulated by wallets with $100k+ balances.',
    a: 'Composite filter over creation timestamps and accumulation flows. "Accumulating" is judgment.',
    kind: 'token.discovery',
    convergence: 0.75,
  },
  {
    q: 'Wallets accumulating $DEEP this week, ranked by net inflow.',
    a: 'Inflow math is exact; "accumulating" requires choosing a window and a threshold.',
    kind: 'wallet.behavior',
    convergence: 0.70,
  },
  {
    q: 'Is this protocol suspicious?',
    a: 'Heuristic synthesis across object lineage, deployer history, liquidity behavior. Use consensus: N to harden.',
    kind: 'protocol.judgment',
    convergence: 0.50,
  },
]

export default function Intents () {
  return (
    <section
      id="intents"
      className="scroll-section relative py-24 sm:py-28 px-5 sm:px-8 lg:px-12 overflow-hidden"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(circle at 80% 50%, rgba(122,196,255,0.05) 0%, transparent 55%)',
        }}
      />

      <div className="relative max-w-6xl mx-auto">
        {/* confidence cameo — "yeah, we handle every one of these" */}
        <CoolMini
          size={72}
          className="hidden md:block absolute -top-2 right-0 z-10 pointer-events-none"
        />

        <header className="mb-12">
          <p className="font-mono text-xs uppercase tracking-[0.3em] text-[color:var(--color-sui-bright)] mb-3">
            real questions, every one scored
          </p>
          <h2 className="font-sans text-3xl sm:text-4xl tracking-tight text-balance max-w-3xl font-medium">
            One pipeline. One shape of answer.{' '}
            <span className="shimmer-text">Convergence tells you how much to trust it.</span>
          </h2>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 sm:gap-6">
          {INTENTS.map((intent, i) => (
            <IntentCard key={intent.q} intent={intent} index={i} />
          ))}
        </div>

        <p className="mt-12 text-center text-[color:var(--color-ink-mute)] font-mono text-xs max-w-2xl mx-auto">
          Want a harder answer on the judgment calls? Pass consensus: N. N parallel passes, aggregated, linear pricing. The score moves with the work.
        </p>
      </div>
    </section>
  )
}

/**
 * IntentCard — each card observes its own viewport entry and reveals with
 * a slide-in from the left or right column origin.
 */
function IntentCard ({ intent, index }) {
  const ref = useRef(null)
  const [visible, setVisible] = useState(false)
  // Even-index cards live in the left column → slide from -X
  // Odd-index cards live in the right column → slide from +X
  const fromLeft = index % 2 === 0

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduced) {
      setVisible(true)
      return
    }

    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setVisible(true)
            io.disconnect()
            break
          }
        }
      },
      { threshold: 0.2, rootMargin: '0px 0px -12% 0px' }
    )
    io.observe(el)

    // Safety: reveal eventually even if IO never fires
    const safety = setTimeout(() => setVisible(true), 1800 + index * 80)

    return () => {
      io.disconnect()
      clearTimeout(safety)
    }
  }, [index])

  // Small per-row stagger so paired cards don't land in perfect unison
  const rowDelay = Math.floor(index / 2) * 60

  return (
    <article
      ref={ref}
      style={{
        opacity: visible ? 1 : 0,
        transform: visible
          ? 'translate3d(0, 0, 0)'
          : `translate3d(${fromLeft ? '-32px' : '32px'}, 16px, 0)`,
        transition: `opacity 800ms ease-out, transform 900ms cubic-bezier(0.16, 1, 0.3, 1)`,
        transitionDelay: visible ? `${rowDelay}ms` : '0ms',
        willChange: 'opacity, transform',
      }}
    >
      <div className="neu neu-hover h-full p-5 sm:p-6 flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <span className="font-mono text-[10px] uppercase tracking-widest text-[color:var(--color-sui-bright)]">
            {intent.kind}
          </span>
          <ConvergenceBadge value={intent.convergence} />
        </div>

        <p className="font-sans text-[color:var(--color-ink)] text-base sm:text-[17px] leading-snug text-pretty">
          <span className="text-[color:var(--color-sui-bright)] font-mono mr-1">&gt;</span>
          {intent.q}
        </p>

        <div className="mt-auto pt-3 border-t border-[color:var(--color-line)]">
          <p className="font-mono text-xs text-[color:var(--color-ink-dim)] leading-relaxed">
            → {intent.a}
          </p>
        </div>
      </div>
    </article>
  )
}

/**
 * ConvergenceBadge — small mono pill showing the score.
 *
 * Color tracks confidence:
 *   >= 0.90 — bright Sui blue (deterministic / near-deterministic)
 *   >= 0.70 — sui mid tone (composite filter, mild interpretation)
 *   <  0.70 — muted ink (heuristic synthesis, lean on consensus: N)
 */
function ConvergenceBadge ({ value }) {
  const tone =
    value >= 0.90
      ? { color: 'var(--color-sui-bright)', glow: '0 0 8px var(--color-sui-bright)', dot: 'var(--color-sui-bright)' }
      : value >= 0.70
      ? { color: 'var(--color-sui)',        glow: '0 0 6px var(--color-sui)',        dot: 'var(--color-sui)'        }
      : { color: 'var(--color-ink-dim)',    glow: 'none',                            dot: 'var(--color-ink-mute)'  }

  return (
    <span
      className="inline-flex items-center gap-1.5 font-mono text-[10px] tracking-[0.12em] shrink-0"
      style={{ color: tone.color }}
      title={`convergence ${value.toFixed(2)}`}
    >
      <span
        aria-hidden="true"
        className="inline-block w-1.5 h-1.5 rounded-full"
        style={{ background: tone.dot, boxShadow: tone.glow }}
      />
      convergence {value.toFixed(2)}
    </span>
  )
}
