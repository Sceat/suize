import Droplet from './Droplet'
import WaitlistForm from './WaitlistForm'

export default function Footer () {
  return (
    <footer
      id="join"
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
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.2fr] gap-12 lg:gap-20 items-center">
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
                  ask sui · in plain english
                </p>
              </div>
            </div>

            <p className="text-[color:var(--color-ink-dim)] text-base max-w-md mx-auto lg:mx-0 leading-relaxed text-pretty">
              We email once: when <span className="font-mono text-[color:var(--color-sui-bright)]">/ask</span> goes live. That's it. No newsletter, no spam, no upsells.
            </p>

          </div>

          {/* Right — waitlist */}
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.28em] text-[color:var(--color-sui-bright)] mb-4 text-center lg:text-left">
              &gt; Join the waitlist
            </p>
            <div className="flex justify-center lg:justify-start">
              <WaitlistForm placeholderEmail="builder@example.com" />
            </div>
          </div>
        </div>

        <div className="mt-16 pt-6 border-t border-[color:var(--color-line)] flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between font-mono text-[10px] text-[color:var(--color-ink-mute)] uppercase tracking-widest">
          <span>© 2026 · Suize · made by one solo founder</span>
          <span className="flex flex-wrap gap-x-4 gap-y-1">
            <a href="#flow"    className="hover:text-[color:var(--color-sui-bright)] transition-colors">how it works</a>
            <a href="#intents" className="hover:text-[color:var(--color-sui-bright)] transition-colors">intents</a>
            <a href="#why"     className="hover:text-[color:var(--color-sui-bright)] transition-colors">why</a>
            <a
              href="mailto:fetch@sceat.xyz"
              className="text-[color:var(--color-sui-bright)] hover:text-[color:var(--color-ink)] transition-colors"
            >
              reach the team · fetch@sceat.xyz ↗
            </a>
          </span>
        </div>
      </div>
    </footer>
  )
}
