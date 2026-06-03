import { CoolMini } from './MascotMini'
import { useReveal } from '../lib/hooks'
import { CRASH_URL } from '../links'

/**
 * CrashSection — the second product: Crash, the live BTC up/down betting game.
 *
 * Reuses the original landing's surfaces: the .neu cards, a terminal/price
 * panel styled like SeeItRun's ScrollTerminal, shimmer-text headline, the
 * reveal-on-scroll hook, and a mascot cameo (CoolMini).
 *
 * Content (the real product): bet UP or DOWN on BTC at a 15-minute binary
 * expiry, wrapped by an on-chain router (3% rake), gasless via the shared
 * Enoki sponsor, cash out any time before expiry. Honest framing — the edge is
 * betting early + correct; testnet play money; you are NOT betting on SUI.
 * CTA → crash.suize.io.
 */

const FEATURES = [
  {
    title: 'Fully on-chain',
    body: 'Every bet, cash-out and claim is a single router call on Sui. The 3% rake is skimmed inside the Move router — non-bypassable, no treasury in the client.',
  },
  {
    title: 'Gasless & seedless',
    body: 'Sign in with Google (zkLogin) and writes are sponsored — no SUI, no popups, no extension. Or connect any wallet and self-pay.',
  },
  {
    title: 'Cash out any time',
    body: 'Hold a position and watch the live cash-out value tick. Bail before it crashes, or let it settle — winnings auto-claim into your balance.',
  },
]

export default function CrashSection () {
  const [ref, visible] = useReveal(0.1)

  return (
    <section
      id="crash"
      ref={ref}
      className="scroll-section relative py-24 sm:py-32 px-5 sm:px-8 lg:px-12 overflow-hidden border-t border-[color:var(--color-line)]"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(circle at 70% 30%, rgba(122,196,255,0.07) 0%, transparent 55%)',
        }}
      />

      <div className="relative max-w-6xl mx-auto">
        {/* confidence cameo */}
        <CoolMini
          size={72}
          className="hidden md:block absolute -top-2 right-0 z-10 pointer-events-none"
        />

        <header className="mb-16 max-w-3xl">
          <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-[color:var(--color-sui-bright)] mb-3">
            · 02 — crash
          </p>
          <h2 className="font-sans text-[clamp(2rem,4.5vw,3.5rem)] leading-[1.05] tracking-tight font-medium text-balance">
            BTC, up or down.{' '}
            <span className="shimmer-text">Fifteen minutes on the clock.</span>
          </h2>
          <p className="mt-5 text-[color:var(--color-ink-dim)] text-base sm:text-lg leading-relaxed text-pretty">
            A one-tap binary on a live BTC price chart: pick a side, watch the line ride above or
            below your entry, and cash out before it crashes. Fully on-chain, gasless, instant.
          </p>
        </header>

        {/* Two-column: live-chart panel + the edge */}
        <div className="grid grid-cols-1 lg:grid-cols-[7fr_5fr] gap-8 lg:gap-12 items-center mb-16">
          {/* The price panel */}
          <div className="relative">
            <div aria-hidden="true" className="sui-halo absolute -inset-10 rounded-full pointer-events-none opacity-60" />
            <PricePanel />
          </div>

          {/* The edge — honest framing */}
          <div className="flex flex-col gap-4">
            <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-[color:var(--color-sui-bright)]">
              the honest edge
            </p>
            <h3 className="font-sans text-xl sm:text-2xl font-medium leading-snug">
              The price you pay is your win probability.
            </h3>
            <p className="text-[color:var(--color-ink-dim)] text-sm sm:text-base leading-relaxed text-pretty">
              A contract that pays $1 if you're right costs roughly what the market thinks your
              odds are. A last-second “sure” bet costs ~$1 to win $1. The edge is betting{' '}
              <span className="text-[color:var(--color-ink)]">early and correct</span> — bigger payout,
              real risk. The UI shows the potential gain on every tap.
            </p>
            <p className="font-mono text-[10px] text-[color:var(--color-ink-mute)] leading-relaxed tracking-wide mt-1">
              A shared vault is the house; LPs fund it and earn the spread. Testnet play money —
              and the asset is BTC, not the SUI token.
            </p>
          </div>
        </div>

        {/* Feature triad */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 sm:gap-6 mb-14">
          {FEATURES.map((f, i) => (
            <article
              key={f.title}
              className={`reveal ${visible ? 'is-visible' : ''}`}
              style={{ transitionDelay: visible ? `${i * 100}ms` : '0ms' }}
            >
              <div className="neu neu-hover h-full p-6 sm:p-7">
                <h3 className="font-sans text-lg sm:text-xl leading-snug mb-2.5 text-[color:var(--color-ink)]">
                  {f.title}
                </h3>
                <p className="text-[color:var(--color-ink-dim)] text-sm leading-relaxed text-pretty">
                  {f.body}
                </p>
              </div>
            </article>
          ))}
        </div>

        {/* Section CTA */}
        <div className="flex flex-col items-center gap-3">
          <a
            href={CRASH_URL}
            className="neu-btn px-7 py-4 font-mono text-sm font-bold uppercase tracking-wider"
          >
            Play Crash →
          </a>
          <p className="font-mono text-[10px] text-[color:var(--color-ink-mute)] uppercase tracking-[0.22em]">
            crash.suize.io · gasless · testnet
          </p>
        </div>
      </div>
    </section>
  )
}

/**
 * PricePanel — a static BTC up/down betting frame, styled like the live app:
 * a glowing price line over a deep-blue void, an entry marker, the countdown,
 * the UP/DOWN odds + cost, and a live cash-out readout.
 */
function PricePanel () {
  return (
    <div className="neu overflow-hidden">
      {/* Header — countdown + market */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-[color:var(--color-line)] bg-[color:var(--color-bg)]/40">
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-[color:var(--color-sui-bright)] shadow-[0_0_8px_var(--color-sui-bright)] animate-pulse" />
          <span className="font-mono text-[10px] tracking-[0.2em] uppercase text-[color:var(--color-sui-bright)]">
            BTC · live
          </span>
        </span>
        <span className="font-mono text-[10px] text-[color:var(--color-ink-mute)] tracking-[0.18em] uppercase">
          expiry 07:41
        </span>
      </div>

      {/* The chart */}
      <div className="relative h-[200px] sm:h-[230px]">
        <Chart />
      </div>

      {/* Footer — UP / DOWN controls + cash-out */}
      <div className="grid grid-cols-2 gap-3 p-4 border-t border-[color:var(--color-line)]">
        <div className="rounded-[4px] border border-[color:var(--color-sui)]/40 bg-[color:var(--color-sui)]/5 px-3.5 py-3 flex flex-col gap-0.5">
          <span className="font-mono text-xs font-bold tracking-widest text-[color:var(--color-sui-bright)]">
            UP ▲
          </span>
          <span className="font-mono text-[10px] text-[color:var(--color-ink-mute)]">
            58% · $0.58
          </span>
        </div>
        <div className="rounded-[4px] border border-[color:var(--color-line-bright)] px-3.5 py-3 flex flex-col gap-0.5">
          <span className="font-mono text-xs font-bold tracking-widest text-[color:var(--color-ink-dim)]">
            DOWN ▼
          </span>
          <span className="font-mono text-[10px] text-[color:var(--color-ink-mute)]">
            42% · $0.42
          </span>
        </div>
        <div className="col-span-2 flex items-center justify-between pt-1">
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:var(--color-ink-mute)]">
            cash out
          </span>
          <span className="font-mono text-sm text-[color:var(--color-sui-bright)] flex items-center gap-2">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-[color:var(--color-sui-bright)] shadow-[0_0_6px_var(--color-sui-bright)]" />
            $0.71 ↑
          </span>
        </div>
      </div>
    </div>
  )
}

/**
 * Chart — a static SVG echo of the live Canvas2D price line: a glowing path
 * climbing above a dashed entry line, with the entry marker. Pure SVG, no JS.
 */
function Chart () {
  // A hand-tuned BTC-ish path that ends above the entry line (winning UP).
  const linePath =
    'M0,120 L40,108 L80,128 L120,96 L160,112 L200,72 L240,88 L280,52 L320,64 L360,40 L400,30'
  const fillPath = `${linePath} L400,200 L0,200 Z`

  return (
    <svg
      viewBox="0 0 400 200"
      preserveAspectRatio="none"
      className="absolute inset-0 w-full h-full"
      aria-label="Live BTC price chart climbing above the entry line"
      role="img"
    >
      <defs>
        <linearGradient id="crash-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#4DA2FF" stopOpacity="0.28" />
          <stop offset="1" stopColor="#4DA2FF" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="crash-line" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#2E7BD6" />
          <stop offset="0.6" stopColor="#4DA2FF" />
          <stop offset="1" stopColor="#7AC4FF" />
        </linearGradient>
      </defs>

      {/* faint grid */}
      <g stroke="rgba(122,196,255,0.07)" strokeWidth="1">
        <line x1="0" y1="50" x2="400" y2="50" />
        <line x1="0" y1="100" x2="400" y2="100" />
        <line x1="0" y1="150" x2="400" y2="150" />
      </g>

      {/* entry line (dashed) + label */}
      <line x1="0" y1="120" x2="400" y2="120" stroke="#5A7A9C" strokeWidth="1" strokeDasharray="4 4" />

      {/* area fill under the line */}
      <path d={fillPath} fill="url(#crash-fill)" />

      {/* the price line */}
      <path
        d={linePath}
        fill="none"
        stroke="url(#crash-line)"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ filter: 'drop-shadow(0 0 6px rgba(122,196,255,0.6))' }}
      />

      {/* current price dot */}
      <circle cx="400" cy="30" r="3.5" fill="#7AC4FF" style={{ filter: 'drop-shadow(0 0 6px #7AC4FF)' }} />
      {/* entry marker */}
      <circle cx="0" cy="120" r="3" fill="#E8F4FF" />
    </svg>
  )
}
