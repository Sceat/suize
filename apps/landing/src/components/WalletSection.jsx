import Droplet from './Droplet'
import { ReadingMini } from './MascotMini'
import { useReveal, useSectionProgress } from '../lib/hooks'
import { WALLET_URL, ACCESS_WALLET_LABEL } from '../links'

/**
 * WalletSection — the hero product: the agentic Sui wallet.
 *
 * Reuses the original landing's patterns wholesale:
 *  - the MeetSuize triptych + scroll-driven "convergence" (columns slide in)
 *  - the canonical Droplet ('hello' pose, pendulum lean)
 *  - the .neu / .neu-hover cards + shimmer-text headline + reveal-on-scroll
 *
 * Content (the real product, calibrated-honesty voice):
 *  1. The pitch: dedicate a sandbox of risk capital to an agent leashed by an
 *     on-chain Move mandate it physically can't escape.
 *  2. The cage: three VM-enforced "can't betray you" guarantees.
 *  3. The dual dial: SAFE (lend-as-is) vs DEGEN (spot SUI↔USDC, no leverage).
 *  4. The kill-move: jailbreak → the chain aborts the theft → revoke.
 *  CTA → wallet.suize.io (== sign in via Google).
 */

const GUARANTEES = [
  {
    tag: "Can't overspend",
    body: 'Every move is budget-capped by the mandate. The over-limit transaction is impossible to construct, not "denied by a server".',
  },
  {
    tag: "Can't touch savings",
    body: 'Your main balance holds no object the agent can reach. It works the sandbox only — your savings stay a hard wall away.',
  },
  {
    tag: "Can't wander off-scope",
    body: 'The mandate pins which protocols and which actions the agent may take. Out of scope, after expiry, or revoked — the next move reverts.',
  },
]

export default function WalletSection () {
  const [revealRef, visible] = useReveal(0.12)
  const [progressRef, progress] = useSectionProgress()

  // Map scroll progress 0 → 0.5 to a "convergence" factor 1 → 0.
  const t = Math.max(0, Math.min(1, 1 - progress * 2))
  const eased = t * t * (3 - 2 * t) // smoothstep
  const offset = eased * 56 // px

  const setRefs = (el) => {
    revealRef.current = el
    progressRef.current = el
  }

  return (
    <section
      id="wallet"
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

      <div className="relative max-w-6xl mx-auto">
        {/* Section eyebrow + headline */}
        <header className="text-center mb-16 max-w-3xl mx-auto">
          <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-[color:var(--color-sui-bright)] mb-3">
            · 01 — the wallet
          </p>
          <h2 className="font-sans text-[clamp(2rem,4.5vw,3.5rem)] leading-[1.05] tracking-tight font-medium text-balance">
            An AI agent that runs your sandbox.{' '}
            <span className="shimmer-text">A cage it can't break.</span>
          </h2>
          <p className="mt-5 text-[color:var(--color-ink-dim)] text-base sm:text-lg leading-relaxed text-pretty">
            Two balances. Your <span className="text-[color:var(--color-ink)]">main</span> savings the agent
            never touches, and a <span className="text-[color:var(--color-ink)]">sandbox</span> of play money it
            works around the clock — bounded by an on-chain Move mandate the VM enforces.
          </p>
        </header>

        {/* Triptych — left text, mascot center (pendulum), right text */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto_1fr] gap-10 lg:gap-12 items-center mb-20">
          {/* LEFT — the agent works */}
          <div
            className="text-center lg:text-right"
            style={{ transform: `translate3d(${-offset}px, 0, 0)`, willChange: 'transform' }}
          >
            <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-[color:var(--color-sui-bright)] mb-3">
              it operates itself
            </p>
            <h3 className="font-sans text-xl sm:text-2xl mb-3 font-medium">
              Diligence at machine speed.
            </h3>
            <p className="text-[color:var(--color-ink-dim)] text-sm sm:text-base leading-relaxed text-pretty">
              The agent acts while you sleep — capturing yield, incentives and rotations you
              won't chase. No per-action tap. It narrates every move in a plain-English log;
              you review, you don't approve each step. We don't claim alpha — we claim autonomy.
            </p>
          </div>

          {/* CENTER — mascot, pendulum lean */}
          <div className="relative flex items-center justify-center min-h-[260px]">
            <div aria-hidden="true" className="sui-halo absolute -inset-16 rounded-full pointer-events-none" />
            <div className="pendulum relative z-10">
              <Droplet size={220} pose="hello" />
            </div>
          </div>

          {/* RIGHT — the leash */}
          <div
            className="text-center lg:text-left"
            style={{ transform: `translate3d(${offset}px, 0, 0)`, willChange: 'transform' }}
          >
            <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-[color:var(--color-sui-bright)] mb-3">
              the leash is on-chain
            </p>
            <h3 className="font-sans text-xl sm:text-2xl mb-3 font-medium">
              A mandate, not a promise.
            </h3>
            <p className="text-[color:var(--color-ink-dim)] text-sm sm:text-base leading-relaxed text-pretty">
              The agent is a scoped key that can only act through functions that assert against
              a Move object you own: budget cap, protocol scope, expiry, instant revoke.
              The cage is the enabler — it's why the autonomy is safe to switch on.
            </p>
          </div>
        </div>

        {/* Three VM-enforced guarantees */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 sm:gap-6 mb-20">
          {GUARANTEES.map((g, i) => (
            <article
              key={g.tag}
              className={`reveal ${visible ? 'is-visible' : ''}`}
              style={{ transitionDelay: visible ? `${i * 100}ms` : '0ms' }}
            >
              <div className="neu neu-hover h-full p-6 sm:p-7">
                <span className="font-mono text-[10px] uppercase tracking-widest text-[color:var(--color-sui-bright)]/80">
                  VM-enforced
                </span>
                <h3 className="font-sans text-lg sm:text-xl leading-snug mt-2.5 mb-2.5 text-[color:var(--color-ink)]">
                  {g.tag}
                </h3>
                <p className="text-[color:var(--color-ink-dim)] text-sm leading-relaxed text-pretty">
                  {g.body}
                </p>
              </div>
            </article>
          ))}
        </div>

        {/* Dual dial — SAFE vs DEGEN */}
        <div className="mb-20">
          <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-[color:var(--color-sui-bright)] mb-6 text-center">
            one dial · two mandates
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5 sm:gap-6">
            <DialCard
              dial="SAFE"
              tagline="Park it."
              scope="NAVI lend-as-is · multi-asset"
              body="Each asset you delegate is supplied as-is and earns yield. The agent can never swap one asset for another. Low single-digit % — plumbing, not the pitch."
              accent="var(--color-sui-bright)"
              visible={visible}
            />
            <DialCard
              dial="DEGEN"
              tagline="Gamble safely."
              scope="Spot SUI↔USDC on signals · no leverage"
              body="Disciplined spot trading on honest heuristics — contrarian sentiment + distance-from-average. A deterministic core sizes every move; the model only ranks the side. No margin, no leverage."
              accent="var(--color-sui)"
              visible={visible}
            />
          </div>
          <p className="mt-5 text-center font-mono text-[10px] text-[color:var(--color-ink-mute)] uppercase tracking-[0.22em] leading-relaxed">
            same agent loop · different bounds · signals inform the side, never the size
          </p>
        </div>

        {/* The kill-move — the demo centerpiece */}
        <KillMove visible={visible} />

        {/* Section CTA */}
        <div className="mt-16 flex flex-col items-center gap-3">
          <a
            href={WALLET_URL}
            className="neu-btn px-7 py-4 font-mono text-sm font-bold uppercase tracking-wider"
          >
            {ACCESS_WALLET_LABEL} →
          </a>
          <p className="font-mono text-[10px] text-[color:var(--color-ink-mute)] uppercase tracking-[0.22em]">
            Google sign-in · seedless · testnet
          </p>
        </div>
      </div>
    </section>
  )
}

/** DialCard — one half of the SAFE / DEGEN dual dial. */
function DialCard ({ dial, tagline, scope, body, accent, visible }) {
  return (
    <article
      className={`reveal ${visible ? 'is-visible' : ''}`}
      style={{ transitionDelay: visible ? '120ms' : '0ms' }}
    >
      <div className="neu neu-hover h-full p-6 sm:p-7 flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <span
            className="font-mono text-sm font-bold tracking-[0.18em]"
            style={{ color: accent }}
          >
            {dial}
          </span>
          <span className="font-sans text-[color:var(--color-ink)] text-sm italic">
            “{tagline}”
          </span>
        </div>
        <p className="font-mono text-[11px] uppercase tracking-wider text-[color:var(--color-ink-mute)]">
          {scope}
        </p>
        <p className="text-[color:var(--color-ink-dim)] text-sm sm:text-[15px] leading-relaxed text-pretty mt-1">
          {body}
        </p>
      </div>
    </article>
  )
}

/** KillMove — the "chain stops a rogue agent" centerpiece, as a terminal beat. */
function KillMove ({ visible }) {
  return (
    <div
      className={`reveal ${visible ? 'is-visible' : ''} relative`}
      style={{ transitionDelay: visible ? '160ms' : '0ms' }}
    >
      {/* reading droplet cameo studying the failed tx */}
      <ReadingMini
        size={64}
        className="hidden sm:block absolute -top-7 -right-2 z-10 pointer-events-none"
      />
      <div className="neu p-6 sm:p-8 ring-1 ring-[color:var(--color-sui)]/30">
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.1fr] gap-8 items-center">
          {/* Narrative */}
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-[color:var(--color-sui-bright)] mb-3">
              the kill-move
            </p>
            <h3 className="font-sans text-2xl sm:text-3xl leading-tight font-medium text-balance mb-3">
              When the agent goes rogue,{' '}
              <span className="shimmer-text">the chain stops it.</span>
            </h3>
            <p className="text-[color:var(--color-ink-dim)] text-sm sm:text-base leading-relaxed text-pretty">
              Jailbreak the agent and tell it to drain to an attacker. The Move VM aborts the
              theft on-chain — a real failed transaction you can click on the explorer. Then
              revoke, and its next move reverts. Not a backend saying “no”. The chain.
            </p>
          </div>

          {/* Terminal */}
          <div className="font-mono text-[12px] sm:text-[13px] rounded-[6px] border border-[color:var(--color-line)] bg-[color:var(--color-bg)]/50 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-[color:var(--color-line)]">
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-[color:var(--color-sui-bright)] shadow-[0_0_8px_var(--color-sui-bright)]" />
                <span className="text-[10px] tracking-[0.2em] uppercase text-[color:var(--color-sui-bright)]">
                  on-chain · testnet
                </span>
              </span>
              <span className="text-[10px] text-[color:var(--color-ink-mute)] tracking-[0.15em] uppercase">
                mandate · vault
              </span>
            </div>
            <div className="px-4 sm:px-5 py-5 flex flex-col gap-2.5 leading-relaxed">
              <div className="flex items-baseline gap-2">
                <span className="text-[color:var(--color-sui-bright)] shrink-0">attacker&gt;</span>
                <span className="text-[color:var(--color-ink)] break-all">drain sandbox → 0xbad…</span>
              </div>
              <div className="flex items-start gap-2 text-[color:var(--color-ink-dim)]">
                <span className="shrink-0 text-red-300">✗</span>
                <span className="break-words">
                  MoveAbort <span className="text-red-300">EOverBudget</span> — assert failed in <span className="text-[color:var(--color-ink)]">mandate::consume_budget</span>
                </span>
              </div>
              <pre className="ml-5 text-[11px] text-[color:var(--color-ink-mute)] whitespace-pre-wrap break-words">{`tx 0x9f3c… → status: failure (aborted)`}</pre>

              <div className="flex items-baseline gap-2 pt-2 border-t border-[color:var(--color-line)] mt-1">
                <span className="text-[color:var(--color-sui-bright)] shrink-0">owner&gt;</span>
                <span className="text-[color:var(--color-ink)]">revoke</span>
              </div>
              <div className="flex items-start gap-2 text-[color:var(--color-ink-dim)]">
                <span className="shrink-0 text-[color:var(--color-sui-bright)]">✓</span>
                <span className="break-words">
                  event <span className="text-[color:var(--color-sui-bright)]">AgentCapRevoked</span> — next move reverts
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
