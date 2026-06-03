import Droplet from './Droplet'
import XIcon from './XIcon'
import { WALLET_URL, CRASH_URL, ACCESS_WALLET_LABEL } from '../links'

/**
 * Footer — reused layout, recontented for the two live products.
 * Keeps the recurring "Access wallet" CTA for easy access and links out to
 * both apps on their sub-domains.
 */
export default function Footer () {
  return (
    <footer
      id="footer"
      className="scroll-section relative pt-24 sm:pt-28 pb-12 px-5 sm:px-8 lg:px-12 overflow-hidden border-t border-[color:var(--color-line)]"
    >
      <div
        aria-hidden="true"
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            'radial-gradient(ellipse at center bottom, rgba(77,162,255,0.10) 0%, transparent 60%)',
        }}
      />

      <div className="relative max-w-5xl mx-auto">
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.1fr] gap-12 lg:gap-20 items-center">
          {/* Left — mascot + identity */}
          <div className="text-center lg:text-left">
            <div className="flex items-center justify-center lg:justify-start gap-4 mb-5">
              <div className="w-14 h-14 breathe">
                <Droplet size={56} eyesFollowCursor={false} />
              </div>
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-[color:var(--color-sui-bright)]">
                  Suize
                </p>
                <p className="font-mono text-[10px] text-[color:var(--color-ink-mute)]">
                  your money · on autopilot
                </p>
              </div>
            </div>

            <p className="text-[color:var(--color-ink-dim)] text-base max-w-md mx-auto lg:mx-0 leading-relaxed text-pretty">
              An agentic Sui wallet leashed by an on-chain mandate, and a live BTC betting game.
              Both on testnet — no real funds, calibrated honesty throughout.
            </p>

            <a
              href="https://x.com/suize_io"
              target="_blank"
              rel="noopener noreferrer"
              className="mt-6 inline-flex items-center gap-2.5 px-3.5 py-2 rounded-full border border-[color:var(--color-line-bright)] hover:border-[color:var(--color-sui-bright)] hover:text-[color:var(--color-sui-bright)] transition-colors font-mono text-xs tracking-wider text-[color:var(--color-ink-dim)] group"
            >
              <XIcon size={13} className="opacity-90 group-hover:opacity-100" />
              <span>follow us · @suize_io</span>
            </a>
          </div>

          {/* Right — the recurring CTA + app links */}
          <div className="flex flex-col gap-5">
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
            <p className="font-mono text-[10px] text-[color:var(--color-ink-mute)] tracking-wider leading-relaxed">
              Access wallet opens with Google sign-in — seedless, gasless onboarding.
            </p>
          </div>
        </div>

        <div className="mt-16 pt-6 border-t border-[color:var(--color-line)] flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between font-mono text-[10px] text-[color:var(--color-ink-mute)] uppercase tracking-widest">
          <span>© 2026 · Suize · built on Sui</span>
          <span className="flex flex-wrap gap-x-4 gap-y-1">
            <a href="#wallet" className="hover:text-[color:var(--color-sui-bright)] transition-colors">wallet</a>
            <a href="#crash" className="hover:text-[color:var(--color-sui-bright)] transition-colors">crash</a>
            <a
              href={WALLET_URL}
              className="hover:text-[color:var(--color-sui-bright)] transition-colors"
            >
              wallet.suize.io ↗
            </a>
            <a
              href={CRASH_URL}
              className="hover:text-[color:var(--color-sui-bright)] transition-colors"
            >
              crash.suize.io ↗
            </a>
            <a
              href="https://x.com/suize_io"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 hover:text-[color:var(--color-sui-bright)] transition-colors"
            >
              <XIcon size={11} />
              <span>@suize_io</span>
            </a>
          </span>
        </div>
      </div>
    </footer>
  )
}
