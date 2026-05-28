import { useEffect, useRef, useState } from 'react'

/**
 * LiveTerminal — the hero's centerpiece.
 *
 * Loops through a stack of real-feel agent intents. For each cycle:
 *   1. Header dot pulses, prompt types out the intent character-by-character
 *   2. A "thinking" line appears with a spinner (~600ms)
 *   3. Answer streams in token-by-token (markdown summary + sparse JSON tail)
 *   4. A settlement-confirmed footer line lands with the x402 + USDsui marks
 *   5. Pause, fade, advance to the next intent
 *
 * Pure CSS + ~120 LoC of JS. No deps. Loop pauses on hover so curious
 * visitors can read a full cycle.
 */

const CYCLES = [
  {
    intent: 'sui.ask("largest validator by stake this epoch?")',
    summary: 'Mysten Labs · 142.3M SUI · 4.1% network',
    json: { name: 'Mysten Labs', stake: '142_320_000 SUI', share: 0.041, convergence: 1.0 },
    latency_ms: 240,
    consensus: 1,
    convergence: 1.0,
  },
  {
    intent: 'sui.ask("PrimeMachin NFTs under 10 SUI right now")',
    summary: '6 listings · floor 7.4 SUI · Kiosk + Tradeport',
    json: { matches: 6, floor_sui: 7.4, sources: ['kiosk', 'tradeport'], convergence: 0.98 },
    latency_ms: 311,
    consensus: 1,
    convergence: 0.98,
  },
  {
    intent: 'sui.ask("top 5 memecoins worth caring about", consensus: 5)',
    summary: 'BLUB, PUPS, AXOL, GROK, MOON · 5/5 aggregated',
    json: { ranked: ['BLUB', 'PUPS', 'AXOL', 'GROK', 'MOON'], convergence: 0.78, consensus_n: 5 },
    latency_ms: 612,
    consensus: 5,
    convergence: 0.78,
  },
]

const TYPE_PER_CHAR = 22
const ANSWER_REVEAL_MS = 700
const HOLD_BEFORE_PAY = 600
const HOLD_AT_END = 2200

export default function LiveTerminal() {
  const [idx, setIdx] = useState(0)
  const [stage, setStage] = useState('typing') // typing | thinking | answering | paid | hold
  const [typed, setTyped] = useState('')
  const [revealed, setRevealed] = useState(0)
  const paused = useRef(false)
  const timers = useRef([])

  const c = CYCLES[idx]

  useEffect(() => {
    const clear = () => {
      timers.current.forEach((t) => clearTimeout(t))
      timers.current = []
    }

    let charIdx = 0
    const tick = () => {
      if (paused.current) {
        timers.current.push(setTimeout(tick, 200))
        return
      }
      if (charIdx <= c.intent.length) {
        setTyped(c.intent.slice(0, charIdx))
        charIdx++
        timers.current.push(setTimeout(tick, TYPE_PER_CHAR))
      } else {
        setStage('thinking')
        timers.current.push(
          setTimeout(() => {
            setStage('answering')
            timers.current.push(setTimeout(() => setRevealed(1), ANSWER_REVEAL_MS / 2))
            timers.current.push(setTimeout(() => setRevealed(2), ANSWER_REVEAL_MS))
            timers.current.push(
              setTimeout(() => setStage('paid'), ANSWER_REVEAL_MS + HOLD_BEFORE_PAY)
            )
            timers.current.push(
              setTimeout(() => setStage('hold'), ANSWER_REVEAL_MS + HOLD_BEFORE_PAY + 800)
            )
            timers.current.push(
              setTimeout(() => {
                setTyped('')
                setRevealed(0)
                setStage('typing')
                setIdx((i) => (i + 1) % CYCLES.length)
              }, ANSWER_REVEAL_MS + HOLD_BEFORE_PAY + 800 + HOLD_AT_END)
            )
          }, 600)
        )
      }
    }
    tick()
    return clear
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx])

  return (
    <div
      className="relative w-full"
      onMouseEnter={() => (paused.current = true)}
      onMouseLeave={() => (paused.current = false)}
    >
      <div className="neu overflow-hidden font-mono text-[12px] sm:text-[13px] text-[color:var(--color-ink)]">
        {/* Header bar */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-[color:var(--color-line)] bg-[color:var(--color-bg)]/40">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-[color:var(--color-sui-bright)] shadow-[0_0_8px_var(--color-sui-bright)] animate-pulse" />
              <span className="text-[10px] tracking-[0.2em] uppercase text-[color:var(--color-sui-bright)]">
                live · testnet
              </span>
            </span>
          </div>
          <span className="text-[10px] text-[color:var(--color-ink-mute)] tracking-[0.15em] uppercase">
            POST /ask{c.consensus > 1 ? ` · consensus: ${c.consensus}` : ''}
          </span>
        </div>

        {/* Body */}
        <div className="px-4 sm:px-5 py-5 sm:py-6 min-h-[280px] flex flex-col gap-3 leading-relaxed">
          {/* Prompt line — typing animation */}
          <div className="flex items-baseline gap-2">
            <span className="text-[color:var(--color-sui-bright)] shrink-0">agent&gt;</span>
            <span className="text-[color:var(--color-ink)] break-all">
              {typed}
              {stage === 'typing' && (
                <span className="inline-block w-[6px] h-[1em] align-middle -mb-0.5 ml-0.5 bg-[color:var(--color-sui-bright)] animate-pulse" />
              )}
            </span>
          </div>

          {/* Thinking line */}
          {(stage === 'thinking' || stage === 'answering' || stage === 'paid' || stage === 'hold') && (
            <div className="flex items-center gap-2 text-[color:var(--color-ink-mute)]">
              <Spinner active={stage === 'thinking'} done={stage !== 'thinking'} />
              <span>
                {stage === 'thinking'
                  ? (c.consensus > 1 ? `running ${c.consensus} parallel passes …` : 'single pass · unambiguous parse')
                  : (c.consensus > 1 ? `${c.consensus}/${c.consensus} aggregated · convergence ${c.convergence.toFixed(2)}` : `convergence ${c.convergence.toFixed(2)}`)}
              </span>
            </div>
          )}

          {/* Answer block — slides in two parts */}
          {(stage === 'answering' || stage === 'paid' || stage === 'hold') && (
            <div className="flex flex-col gap-2 mt-1">
              {revealed >= 1 && (
                <div className="flex items-start gap-2">
                  <span className="text-[color:var(--color-sui-bright)] shrink-0">→</span>
                  <span className="text-[color:var(--color-ink)] break-words">{c.summary}</span>
                </div>
              )}
              {revealed >= 2 && (
                <pre className="ml-5 text-[11px] sm:text-[12px] text-[color:var(--color-ink-dim)] whitespace-pre-wrap break-words">
{`{ ${Object.entries(c.json)
  .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
  .join(', ')} }`}
                </pre>
              )}
            </div>
          )}

          {/* Spacer to keep height stable */}
          <div className="flex-1" />

          {/* Footer — settlement confirmation */}
          <div className="flex items-center justify-between pt-3 border-t border-[color:var(--color-line)]">
            <span className="text-[10px] tracking-[0.18em] uppercase text-[color:var(--color-ink-mute)]">
              x402 · usdsui
            </span>
            {stage === 'paid' || stage === 'hold' ? (
              <span className="flex items-center gap-2 text-[color:var(--color-sui-bright)]">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-[color:var(--color-sui-bright)] shadow-[0_0_6px_var(--color-sui-bright)]" />
                settled · {c.latency_ms}ms
              </span>
            ) : (
              <span className="text-[color:var(--color-ink-mute)]">— · — · —</span>
            )}
          </div>
        </div>
      </div>

      {/* Hover hint */}
      <p className="mt-2 text-[10px] tracking-[0.2em] uppercase text-[color:var(--color-ink-mute)] text-right font-mono">
        hover to pause · single-pass + consensus loop
      </p>
    </div>
  )
}

function Spinner({ active, done }) {
  return (
    <span className="inline-flex shrink-0">
      {done ? (
        <span className="text-[color:var(--color-sui-bright)]">✓</span>
      ) : active ? (
        <span className="inline-block w-3 h-3 border-2 border-[color:var(--color-sui)] border-t-transparent rounded-full animate-spin" />
      ) : (
        <span className="inline-block w-3 h-3" />
      )}
    </span>
  )
}
