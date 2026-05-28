import { useReveal } from '../lib/hooks'
import { ReadingMini } from './MascotMini'

const POINTS = [
  {
    title: 'Agents waste 80% of their time on tools built for humans.',
    body:
      'Block explorers, dashboards, REST endpoints that page through results, docs that assume you read them. An agent burns its loop turning all of that into a single decision. The interface is the bottleneck, not the chain.',
    tag: 'Problem',
  },
  {
    title: 'Agents need a query layer that reports its own confidence.',
    body:
      'Not one that pretends every answer is equally certain. A balance lookup and "is this protocol suspicious" cannot ship with the same epistemic weight. Treating them the same is how agents get tricked into bad trades.',
    tag: 'Insight',
  },
  {
    title: 'Convergence is the only correctness primitive.',
    body:
      'Every query produces an answer plus a score from 0.0 to 1.0 reporting how interpretive that answer turned out to be. Optional consensus: N runs N parallel interpretation passes and aggregates. The agent gets confidence, not theater.',
    tag: 'Architecture',
  },
  {
    title: 'Made by agents, for agents.',
    body:
      'No SDK. No API key. No human in the loop. Ever. MCP registry plus x402 micropayment means the agent discovers, decides, pays, and consumes in one round-trip. Metered in gasless USDsui, consensus multiplier surfaced pre-payment.',
    tag: 'GTM',
  },
]

export default function WhyItMatters () {
  const [ref, visible] = useReveal(0.1)

  return (
    <section
      id="why"
      ref={ref}
      className="scroll-section relative py-24 sm:py-28 px-5 sm:px-8 lg:px-12 overflow-hidden"
    >
      <div
        aria-hidden="true"
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            'radial-gradient(circle at 50% 30%, rgba(122,196,255,0.06) 0%, transparent 55%)',
        }}
      />

      <div className="relative max-w-5xl mx-auto">
        <header className="mb-14 text-center sm:text-left">
          <p className="font-mono text-xs uppercase tracking-[0.3em] text-[color:var(--color-sui-bright)] mb-3">
            Why this is the bet
          </p>
          <h2 className="font-sans text-3xl sm:text-4xl tracking-tight text-balance max-w-3xl font-medium">
            Old RPCs answer in bytes. <span className="shimmer-text">Agentic RPC answers in confidence.</span>
          </h2>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 sm:gap-6">
          {POINTS.map((p, i) => (
            <article
              key={p.title}
              className={`reveal ${visible ? 'is-visible' : ''} relative`}
              style={{ transitionDelay: visible ? `${i * 100}ms` : '0ms' }}
            >
              {/* Architecture card gets a reading droplet pinned to its corner */}
              {p.tag === 'Architecture' && (
                <ReadingMini
                  size={68}
                  className="hidden sm:block absolute -top-7 -right-3 z-10 pointer-events-none"
                />
              )}
              <div className="neu neu-hover h-full p-6 sm:p-7 relative">
                <span className="absolute top-3.5 right-4 font-mono text-[9px] uppercase tracking-widest text-[color:var(--color-sui-bright)]/80">
                  {p.tag}
                </span>

                <h3 className="font-sans text-xl sm:text-2xl leading-snug mb-3 text-[color:var(--color-ink)] text-pretty pr-14">
                  {p.title}
                </h3>
                <p className="text-[color:var(--color-ink-dim)] text-sm sm:text-[15px] leading-relaxed text-pretty">
                  {p.body}
                </p>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  )
}
