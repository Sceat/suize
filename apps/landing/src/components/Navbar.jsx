import { useEffect, useRef, useState } from 'react'
import Droplet from './Droplet'
import { WALLET_URL, CRASH_URL, ACCESS_WALLET_LABEL } from '../links'

/**
 * Navbar — the product front-door header.
 *
 *  - Suize droplet + wordmark (left) → scrolls to top.
 *  - "Apps" dropdown (center-right) → Wallet · Crash, each opening the live
 *    product on its own sub-domain.
 *  - "Access wallet" CTA (right) → wallet.suize.io. The wallet's onboarding
 *    opens with Google login, so "Access wallet" == sign in.
 *
 * Reuses the existing aesthetic: carbon-blur surface, JetBrains-mono labels,
 * Sui-blue accents, the `.neu-btn` for the CTA, and the canonical `Droplet`.
 * The dropdown is keyboard-accessible (Enter/Space to open, Escape to close,
 * click-outside to dismiss) and the bar fades a backdrop in on scroll.
 */

const APPS = [
  {
    name: 'Wallet',
    href: WALLET_URL,
    blurb: 'The agentic Sui wallet',
    tag: 'agentic',
  },
  {
    name: 'Crash',
    href: CRASH_URL,
    blurb: 'BTC up/down, 15-min',
    tag: 'live game',
  },
]

export default function Navbar () {
  const [scrolled, setScrolled] = useState(false)
  const [open, setOpen] = useState(false)
  const menuWrapRef = useRef(null)
  const buttonRef = useRef(null)

  // Fade in the bar's backdrop once the user scrolls off the hero top.
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // Dropdown dismissal — click-outside + Escape.
  useEffect(() => {
    if (!open) return
    const onDown = (e) => {
      if (menuWrapRef.current && !menuWrapRef.current.contains(e.target)) {
        setOpen(false)
      }
    }
    const onKey = (e) => {
      if (e.key === 'Escape') {
        setOpen(false)
        buttonRef.current?.focus()
      }
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <header
      className="fixed top-0 left-0 right-0 z-40 transition-colors duration-300"
      style={{
        background: scrolled ? 'rgba(5, 13, 26, 0.72)' : 'transparent',
        backdropFilter: scrolled ? 'blur(12px)' : 'none',
        WebkitBackdropFilter: scrolled ? 'blur(12px)' : 'none',
        borderBottom: scrolled
          ? '1px solid var(--color-line)'
          : '1px solid transparent',
      }}
    >
      <nav
        aria-label="Primary"
        className="mx-auto max-w-[100rem] w-full px-5 sm:px-8 lg:px-12 h-16 flex items-center justify-between gap-4"
      >
        {/* Brand — droplet + wordmark */}
        <a
          href="#top"
          className="flex items-center gap-2.5 group shrink-0"
          aria-label="Suize — home"
        >
          <span className="w-8 h-8 sm:w-9 sm:h-9 breathe">
            <Droplet size={36} eyesFollowCursor={false} />
          </span>
          <span className="font-sans font-medium text-lg tracking-[-0.02em] text-[color:var(--color-ink)] group-hover:text-[color:var(--color-sui-bright)] transition-colors">
            Suize
          </span>
        </a>

        {/* Right cluster — Apps dropdown + CTA */}
        <div className="flex items-center gap-2 sm:gap-3">
          <div className="relative" ref={menuWrapRef}>
            <button
              ref={buttonRef}
              type="button"
              aria-haspopup="true"
              aria-expanded={open}
              onClick={() => setOpen((v) => !v)}
              className="flex items-center gap-1.5 px-3 sm:px-3.5 py-2 rounded-[6px] font-mono text-xs sm:text-sm tracking-wide text-[color:var(--color-ink-dim)] hover:text-[color:var(--color-ink)] border border-transparent hover:border-[color:var(--color-line-bright)] transition-colors"
            >
              <span>Apps</span>
              <Chevron open={open} />
            </button>

            {/* Dropdown panel */}
            <div
              role="menu"
              aria-label="Apps"
              className="absolute right-0 mt-2 w-[16.5rem] origin-top-right transition-all duration-200"
              style={{
                opacity: open ? 1 : 0,
                transform: open ? 'translateY(0) scale(1)' : 'translateY(-6px) scale(0.98)',
                pointerEvents: open ? 'auto' : 'none',
              }}
            >
              <div className="neu p-1.5 flex flex-col gap-0.5">
                {APPS.map((app) => (
                  <a
                    key={app.name}
                    role="menuitem"
                    href={app.href}
                    tabIndex={open ? 0 : -1}
                    className="group flex items-center justify-between gap-3 px-3 py-2.5 rounded-[5px] hover:bg-[color:var(--color-bg-elev)] focus:bg-[color:var(--color-bg-elev)] outline-none transition-colors"
                  >
                    <span className="flex flex-col gap-0.5 min-w-0">
                      <span className="font-sans text-sm font-medium text-[color:var(--color-ink)] group-hover:text-[color:var(--color-sui-bright)] transition-colors">
                        {app.name}
                      </span>
                      <span className="font-mono text-[10px] text-[color:var(--color-ink-mute)] truncate">
                        {app.blurb}
                      </span>
                    </span>
                    <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-[color:var(--color-sui-bright)]/80 shrink-0 inline-flex items-center gap-1.5">
                      <span className="inline-block w-1.5 h-1.5 rounded-full bg-[color:var(--color-sui-bright)] shadow-[0_0_6px_var(--color-sui-bright)]" />
                      {app.tag}
                    </span>
                  </a>
                ))}
              </div>
            </div>
          </div>

          {/* Primary CTA — Access wallet (== sign in via Google) */}
          <a
            href={WALLET_URL}
            className="neu-btn px-3.5 sm:px-5 py-2 sm:py-2.5 font-mono text-xs sm:text-sm font-bold uppercase tracking-wider whitespace-nowrap"
          >
            {ACCESS_WALLET_LABEL}
          </a>
        </div>
      </nav>
    </header>
  )
}

/** Small chevron that flips when the dropdown opens. */
function Chevron ({ open }) {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 12 12"
      fill="none"
      aria-hidden="true"
      className="transition-transform duration-200"
      style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)' }}
    >
      <path
        d="M2.5 4.5 6 8l3.5-3.5"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
