import { useSectionProgress } from '../lib/hooks'
import { SleepyMini } from './MascotMini'

/**
 * SeeItRun — sticky-pinned section, scale.com style.
 *
 * The section is 280vh tall. Inside, a sticky container (100vh, pinned at
 * top) hosts a terminal demo on the right and a narrative panel on the
 * left. Both contents are driven by the user's scroll progress within the
 * section — three discrete states cycle as you scroll:
 *
 *   STATE A (0 → 33%)    — Factual query, single pass, convergence 1.0
 *   STATE B (33% → 66%)  — Semantic query, consensus: 5 firing in parallel
 *   STATE C (66% → 100%) — Aggregated answer with convergence score
 *
 * The same physical screen real-estate carries three different mental
 * frames as you descend. No new sections, no scroll-jacking — just the
 * native browser scroll picking up momentum through staged content.
 */

const STATES = [
  {
    eyebrow: '· 01 — ask',
    title: 'Plain English. Single motion.',
    body:
      'The agent asks in plain English. A question arrives carrying everything it needs to be answered. No key to provision, no signup to clear, no handshake to negotiate — the agent decides and asks as a single motion.',
  },
  {
    eyebrow: '· 02 — escalate',
    title: 'Some answers need to be earned.',
    body:
      '"Best route for a 100k USDC → SUI swap right now" is an optimization over live market state, not a lookup. Liquidity drifts block to block; near-optimal routes diverge across parallel reads. The agent passes consensus: 5. We let the passes disagree.',
  },
  {
    eyebrow: '· 03 — answer',
    title: 'Convergence. The number that tells you what to trust.',
    body:
      'Five passes aggregate into one recommended route with convergence 0.84. The agent acts knowing exactly how much epistemic weight the answer carries.',
  },
]

function clamp01(v) { return Math.max(0, Math.min(1, v)) }

export default function SeeItRun () {
  const [ref, progress] = useSectionProgress()

  // Pick the active state (0, 1, or 2) with a small soft transition zone
  // around the boundaries.
  const stage =
    progress < 0.33 ? 0 :
    progress < 0.66 ? 1 :
    2

  // Smooth per-stage progress so we can lerp opacity/transform inside the
  // transition zones for buttery state changes.
  const localT = (() => {
    if (stage === 0) return clamp01(progress / 0.33)
    if (stage === 1) return clamp01((progress - 0.33) / 0.33)
    return clamp01((progress - 0.66) / 0.34)
  })()

  return (
    <section
      ref={ref}
      id="see-it-run"
      className="scroll-section relative"
      style={{ height: '280vh' }}
    >
      {/* The pinned viewport */}
      <div className="sticky top-0 h-screen w-full overflow-hidden flex items-center">
        {/* Ambient backdrop */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              'radial-gradient(circle at 70% 50%, rgba(122,196,255,0.08) 0%, transparent 55%)',
          }}
        />

        {/* Sleepy mascot — quietly idle while the agent does its thing */}
        <div
          aria-hidden="true"
          className="hidden lg:flex flex-col items-end gap-1.5 absolute top-12 right-12 z-10 pointer-events-none opacity-80"
        >
          <SleepyMini size={64} />
          <span className="font-mono text-[9px] uppercase tracking-[0.3em] text-[color:var(--color-ink-mute)]">
            // idle · 24/7
          </span>
        </div>

        {/* Progress rail on the far left — a thin Sui-blue tick that grows */}
        <div
          aria-hidden="true"
          className="hidden lg:flex absolute left-8 top-1/2 -translate-y-1/2 flex-col items-center gap-3 z-10"
        >
          {STATES.map((_, i) => (
            <span
              key={i}
              className="block w-1 rounded-full transition-all duration-500 ease-out"
              style={{
                height: stage === i ? 64 : 18,
                background:
                  stage === i ? 'var(--color-sui-bright)' : 'var(--color-line-bright)',
                boxShadow: stage === i ? '0 0 16px var(--color-sui-bright)' : 'none',
              }}
            />
          ))}
        </div>

        <div className="relative max-w-[88rem] mx-auto w-full px-6 sm:px-12 lg:px-20 grid grid-cols-1 lg:grid-cols-[5fr_7fr] gap-10 lg:gap-16 items-center">
          {/* LEFT — narrative, cross-fade per state */}
          <div className="flex flex-col">
            <div className="relative min-h-[340px] lg:min-h-[420px]">
              {STATES.map((s, i) => (
                <article
                  key={i}
                  className="absolute inset-0 flex flex-col justify-center transition-all duration-500 ease-out"
                  style={{
                    opacity: stage === i ? 1 : 0,
                    transform: stage === i
                      ? 'translateY(0)'
                      : i < stage ? 'translateY(-24px)' : 'translateY(24px)',
                    pointerEvents: stage === i ? 'auto' : 'none',
                  }}
                >
                  <p className="font-mono text-[11px] uppercase tracking-[0.32em] text-[color:var(--color-sui-bright)] mb-4">
                    {s.eyebrow}
                  </p>
                  <h2 className="font-sans text-[clamp(1.75rem,3.5vw,2.75rem)] leading-[1.1] tracking-tight font-medium text-balance mb-5">
                    {s.title}
                  </h2>
                  <p className="text-[color:var(--color-ink-dim)] text-base sm:text-lg leading-relaxed max-w-xl text-pretty">
                    {s.body}
                  </p>
                </article>
              ))}
            </div>

            {/* Stage indicator — sits below the narrative, never overlaps */}
            <div className="mt-6 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.25em] text-[color:var(--color-ink-mute)]">
              <span>{String(stage + 1).padStart(2, '0')}</span>
              <span className="w-8 h-px bg-[color:var(--color-line-bright)]" />
              <span>03</span>
            </div>
          </div>

          {/* RIGHT — scroll-driven terminal */}
          <div className="relative">
            <div aria-hidden="true" className="sui-halo absolute -inset-12 rounded-full pointer-events-none opacity-60" />
            <ScrollTerminal stage={stage} localT={localT} />
          </div>
        </div>

        {/* Bottom scroll cue */}
        <div
          aria-hidden="true"
          className="absolute bottom-5 left-1/2 -translate-x-1/2 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.3em] text-[color:var(--color-ink-mute)]"
        >
          <span>scroll</span>
          <span className="block w-8 h-px bg-gradient-to-r from-[color:var(--color-sui-bright)] to-transparent" />
        </div>
      </div>
    </section>
  )
}

/**
 * ScrollTerminal — renders a SINGLE terminal frame, content determined by
 * the active stage and a 0..1 local progress within that stage. No internal
 * timers; pure function of scroll.
 */
function ScrollTerminal ({ stage, localT }) {
  const factualIntent = 'sui.ask("balance of 0xabc...")'
  const semanticIntent = 'sui.ask("best route for a 100k USDC → SUI swap right now", consensus: 5)'

  const intent = stage === 0 ? factualIntent : semanticIntent

  // Re-trigger the typing animation when the prompt switches between stages.
  const typedChars = stage === 0
    ? Math.floor(factualIntent.length * localT)
    : stage === 1
    ? Math.floor(semanticIntent.length * Math.min(1, localT * 1.6))
    : semanticIntent.length
  const typed = intent.slice(0, typedChars)
  const typing = typedChars < intent.length

  const headerRight = stage === 0
    ? 'POST /ask · convergence 1.0'
    : 'POST /ask · consensus: 5'

  return (
    <div className="neu overflow-hidden font-mono text-[12px] sm:text-[13px] text-[color:var(--color-ink)]">
      {/* Header bar */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-[color:var(--color-line)] bg-[color:var(--color-bg)]/40">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-[color:var(--color-sui-bright)] shadow-[0_0_8px_var(--color-sui-bright)]" />
            <span className="text-[10px] tracking-[0.2em] uppercase text-[color:var(--color-sui-bright)]">
              live · testnet
            </span>
          </span>
        </div>
        <span className="text-[10px] text-[color:var(--color-ink-mute)] tracking-[0.15em] uppercase">
          {headerRight}
        </span>
      </div>

      <div className="px-4 sm:px-5 py-5 sm:py-6 min-h-[280px] flex flex-col gap-3 leading-relaxed">
        {/* Prompt */}
        <div className="flex items-baseline gap-2">
          <span className="text-[color:var(--color-sui-bright)] shrink-0">agent&gt;</span>
          <span className="text-[color:var(--color-ink)] break-all">
            {typed}
            {typing && (
              <span className="inline-block w-[6px] h-[1em] align-middle -mb-0.5 ml-0.5 bg-[color:var(--color-sui-bright)] animate-pulse" />
            )}
          </span>
        </div>

        {/* STAGE 0 — factual query, single pass, convergence 1.0 */}
        {stage === 0 && !typing && (
          <>
            <div className="flex items-center gap-2 text-[color:var(--color-ink-mute)] text-[11px] sm:text-[12px]">
              <span className="text-[color:var(--color-sui-bright)]">✓</span>
              <span>single pass · unambiguous parse</span>
            </div>
            <div className="flex flex-col gap-2 mt-1">
              <div className="flex items-start gap-2">
                <span className="text-[color:var(--color-sui-bright)] shrink-0">→</span>
                <span className="text-[color:var(--color-ink)] break-words">
                  1,284.31 SUI · 2 coin objects
                </span>
              </div>
              <pre className="ml-5 text-[11px] sm:text-[12px] text-[color:var(--color-ink-dim)] whitespace-pre-wrap break-words">
{`{ balance_sui: 1284.31, coins: 2, convergence: 1.0 }`}
              </pre>
            </div>
          </>
        )}

        {/* STAGE 1 — semantic query, parallel passes running */}
        {stage === 1 && !typing && (
          <>
            <div className="flex items-center gap-2 text-[color:var(--color-ink-mute)] text-[11px] sm:text-[12px]">
              <span className="inline-block w-3 h-3 border-2 border-[color:var(--color-sui)] border-t-transparent rounded-full animate-spin shrink-0" />
              <span>5 interpretation passes in parallel</span>
            </div>
            <pre className="ml-5 text-[11px] sm:text-[12px] text-[color:var(--color-ink-dim)] whitespace-pre leading-relaxed">
{`pass 1 → Cetus → DeepBook · 60 / 40 split
pass 2 → Cetus → DeepBook · 55 / 45 split
pass 3 → Cetus → DeepBook → Aftermath · 50 / 30 / 20
pass 4 → running...
pass 5 → running...`}
            </pre>
          </>
        )}

        {/* STAGE 2 — aggregated answer with convergence */}
        {stage === 2 && (
          <>
            <div className="flex items-center gap-2 text-[color:var(--color-ink-mute)] text-[11px] sm:text-[12px]">
              <span className="text-[color:var(--color-sui-bright)] shrink-0">✓</span>
              <span>5/5 aggregated · convergence 0.84</span>
            </div>
            <div className="flex flex-col gap-2 mt-1">
              <div className="flex items-start gap-2">
                <span className="text-[color:var(--color-sui-bright)] shrink-0">→</span>
                <span className="text-[color:var(--color-ink)] break-words">
                  Cetus + DeepBook · 58 / 42 split · price impact 0.12%
                </span>
              </div>
              <pre className="ml-5 text-[11px] sm:text-[12px] text-[color:var(--color-ink-dim)] whitespace-pre-wrap break-words">
{`{ route: ["cetus","deepbook"], split: [0.58, 0.42], price_impact_bps: 12, convergence: 0.84, consensus_n: 5 }`}
              </pre>
            </div>
          </>
        )}

        <div className="flex-1" />

        {/* Footer — settlement state */}
        <div className="flex items-center justify-between pt-3 border-t border-[color:var(--color-line)]">
          <span className="text-[10px] tracking-[0.18em] uppercase text-[color:var(--color-ink-mute)]">
            x402 · usdsui
          </span>
          {stage === 0 && !typing ? (
            <span className="flex items-center gap-2 text-[color:var(--color-sui-bright)]">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-[color:var(--color-sui-bright)] shadow-[0_0_6px_var(--color-sui-bright)]" />
              settled · 240ms
            </span>
          ) : stage === 2 ? (
            <span className="flex items-center gap-2 text-[color:var(--color-sui-bright)]">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-[color:var(--color-sui-bright)] shadow-[0_0_6px_var(--color-sui-bright)]" />
              settled · 612ms
            </span>
          ) : (
            <span className="text-[color:var(--color-ink-mute)]">— · — · —</span>
          )}
        </div>
      </div>
    </div>
  )
}
