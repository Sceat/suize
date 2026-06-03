import { useMemo } from 'react'

/**
 * PixelDust — ambient pixel particles that drift diagonally across the screen.
 * Pure CSS animation via the `drift` keyframes declared in index.css.
 *
 * Each span is positioned with a randomized start, duration, and delay so
 * the field reads as organic ephemeral motion, not a synced parade.
 */
export default function PixelDust({ count = 24 }) {
  const particles = useMemo(() => {
    return Array.from({ length: count }, (_, i) => {
      const top = Math.random() * 100
      const left = -10 - Math.random() * 30
      const duration = 18 + Math.random() * 22
      const delay = -Math.random() * duration
      const size = Math.random() > 0.7 ? 3 : 2
      const opacity = 0.25 + Math.random() * 0.5
      return { i, top, left, duration, delay, size, opacity }
    })
  }, [count])

  return (
    <div
      aria-hidden="true"
      className="pixel-dust pointer-events-none absolute inset-0 overflow-hidden"
    >
      {particles.map((p) => (
        <span
          key={p.i}
          style={{
            top: `${p.top}%`,
            left: `${p.left}%`,
            width: `${p.size}px`,
            height: `${p.size}px`,
            opacity: p.opacity,
            animationDuration: `${p.duration}s`,
            animationDelay: `${p.delay}s`,
          }}
        />
      ))}
    </div>
  )
}
