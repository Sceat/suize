import { useEffect, useRef } from 'react'
import { HypedMini } from './MascotMini'

const OVERLAY_CSS = `
  @keyframes wlOverlayFade {
    from { opacity: 0; }
    to   { opacity: 1; }
  }
  @keyframes wlCardPop {
    0%   { opacity: 0; transform: scale(0.6) translateY(20px); }
    60%  { opacity: 1; transform: scale(1.05) translateY(-4px); }
    100% { opacity: 1; transform: scale(1) translateY(0); }
  }
  @keyframes wlBannerDrop {
    0%   { opacity: 0; transform: translateY(-40px) rotate(-2deg); }
    70%  { opacity: 1; transform: translateY(4px) rotate(0.5deg); }
    100% { opacity: 1; transform: translateY(0) rotate(0); }
  }
  @keyframes wlMascotPop {
    0%   { opacity: 0; transform: scale(0.2) rotate(-180deg); }
    70%  { opacity: 1; transform: scale(1.1) rotate(10deg); }
    100% { opacity: 1; transform: scale(1) rotate(0); }
  }
  @keyframes wlFadeUp {
    from { opacity: 0; transform: translateY(10px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  @keyframes wlBannerShimmer {
    0%, 100% { background-position: -200% 0; }
    50%      { background-position: 200% 0; }
  }
  @keyframes wlGlowPulse {
    0%, 100% { box-shadow: 0 0 0 1px rgba(122, 196, 255, 0.3), 0 20px 60px -20px rgba(77, 162, 255, 0.5), 0 0 80px -20px rgba(77, 162, 255, 0.3); }
    50%      { box-shadow: 0 0 0 1px rgba(122, 196, 255, 0.6), 0 20px 80px -10px rgba(77, 162, 255, 0.8), 0 0 120px -10px rgba(77, 162, 255, 0.5); }
  }
  @keyframes wlParticleFloat {
    0%   { opacity: 0; transform: translate(0, 0) scale(0.4); }
    20%  { opacity: 1; }
    100% { opacity: 0; transform: translate(var(--wl-dx), var(--wl-dy)) scale(1.2); }
  }

  .wl-overlay        { animation: wlOverlayFade 220ms ease-out both; }
  .wl-card           { animation: wlCardPop 460ms cubic-bezier(0.2, 1.2, 0.4, 1) 80ms both, wlGlowPulse 3.5s ease-in-out infinite 600ms; }
  .wl-banner         { animation: wlBannerDrop 380ms cubic-bezier(0.2, 1.2, 0.4, 1) 240ms both; }
  .wl-banner-text    {
    background: linear-gradient(90deg, #FACC15 0%, #FFE680 25%, #FFFFFF 50%, #FFE680 75%, #FACC15 100%);
    background-size: 200% 100%;
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
    animation: wlBannerShimmer 3s ease-in-out infinite 700ms;
  }
  .wl-mascot         { animation: wlMascotPop 520ms cubic-bezier(0.2, 1.5, 0.4, 1) 320ms both; }
  .wl-headline       { animation: wlFadeUp 320ms ease-out 560ms both; }
  .wl-sub            { animation: wlFadeUp 320ms ease-out 680ms both; }
  .wl-button         { animation: wlFadeUp 320ms ease-out 820ms both; }
  .wl-particle       { animation: wlParticleFloat 2.4s ease-out infinite; opacity: 0; }

  @media (prefers-reduced-motion: reduce) {
    .wl-overlay, .wl-card, .wl-banner, .wl-mascot, .wl-headline, .wl-sub, .wl-button, .wl-particle, .wl-banner-text {
      animation: none !important;
      opacity: 1 !important;
      transform: none !important;
    }
  }
`

const PARTICLES = [
  { dx:  140, dy: -120, delay: '0s',   color: '#FACC15', size: 4 },
  { dx: -160, dy:  -90, delay: '0.3s', color: '#7AC4FF', size: 3 },
  { dx:  180, dy:   80, delay: '0.6s', color: '#4DA2FF', size: 3 },
  { dx: -140, dy:  130, delay: '0.9s', color: '#FACC15', size: 4 },
  { dx:  100, dy: -160, delay: '1.2s', color: '#E8F4FF', size: 2 },
  { dx: -120, dy: -150, delay: '1.5s', color: '#FACC15', size: 3 },
  { dx:  170, dy:  -40, delay: '1.8s', color: '#7AC4FF', size: 3 },
  { dx: -180, dy:   40, delay: '2.1s', color: '#E8F4FF', size: 2 },
]

export default function WaitlistSuccessOverlay ({ alreadyOnList = false, onClose }) {
  const buttonRef = useRef(null)

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const t = setTimeout(() => buttonRef.current?.focus(), 900)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
      clearTimeout(t)
    }
  }, [onClose])

  const headline = alreadyOnList ? "Already on the list" : "You're in."
  const sub = alreadyOnList
    ? "The droplet remembers. We'll ping you once — when /ask goes live."
    : "Welcome to the waitlist. We'll email once — when /ask goes live."
  const banner = alreadyOnList ? 'WELCOME BACK' : 'ACHIEVEMENT UNLOCKED'

  return (
    <div
      className="wl-overlay fixed inset-0 z-[9999] flex items-center justify-center px-4"
      style={{ background: 'radial-gradient(ellipse at center, rgba(3, 16, 33, 0.85) 0%, rgba(3, 16, 33, 0.96) 100%)', backdropFilter: 'blur(4px)' }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="wl-overlay-headline"
    >
      <style>{OVERLAY_CSS}</style>

      <div
        className="wl-card relative max-w-md w-full rounded-2xl p-8 sm:p-10 text-center"
        style={{
          background: 'linear-gradient(180deg, #0A1A2E 0%, #050E1E 100%)',
          border: '1px solid rgba(122, 196, 255, 0.25)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {PARTICLES.map((p, i) => (
          <span
            key={i}
            className="wl-particle absolute rounded-sm"
            style={{
              left: '50%', top: '50%',
              width: `${p.size}px`, height: `${p.size}px`,
              background: p.color,
              boxShadow: `0 0 8px ${p.color}`,
              animationDelay: p.delay,
              '--wl-dx': `${p.dx}px`,
              '--wl-dy': `${p.dy}px`,
            }}
          />
        ))}

        <div className="wl-banner mb-2">
          <span className="wl-banner-text font-mono text-[11px] sm:text-xs font-bold uppercase tracking-[0.25em]">
            ▸ {banner} ◂
          </span>
        </div>

        <div className="wl-mascot flex justify-center mb-3">
          <HypedMini size={128} />
        </div>

        <h2 id="wl-overlay-headline" className="wl-headline font-mono text-2xl sm:text-3xl font-bold text-[color:var(--color-sui-bright)] mb-3">
          {headline}
        </h2>

        <p className="wl-sub text-sm text-[color:var(--color-ink-dim)] leading-relaxed mb-7">
          {sub}{' '}
          <code className="font-mono text-[color:var(--color-sui-bright)]">/ask</code>
        </p>

        <button
          ref={buttonRef}
          type="button"
          onClick={onClose}
          className="wl-button neu-btn px-6 py-3 font-mono text-xs font-bold uppercase tracking-wider"
        >
          continue
        </button>

        <p className="wl-sub mt-5 font-mono text-[10px] text-[color:var(--color-ink-mute)] uppercase tracking-widest">
          press esc or click anywhere to close
        </p>
      </div>
    </div>
  )
}
