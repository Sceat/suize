import { useEffect, useRef } from 'react'

// ============================================================================
// <CustomCursor> — a soft glowing dot + thin ring that trails the pointer over
// the deep-blue void, so the cursor feels ALIVE on the chart (the old build had
// parallax but nothing visible). The OS cursor is hidden on fine pointers
// (styles.css `cursor: none`); this draws the replacement.
// ----------------------------------------------------------------------------
// Touch/coarse-pointer devices have no hover cursor — we detect that and render
// nothing (the OS cursor stays `auto` there via the media query in CSS). Pure
// transform animation on two layers (a crisp dot + a lagging ring) via rAF; no
// React re-render per frame, no deps.
// ============================================================================
export function CustomCursor() {
  const dot_ref = useRef<HTMLDivElement | null>(null)
  const ring_ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    // Skip entirely on touch / coarse pointers (no real cursor to replace).
    if (window.matchMedia('(hover: none), (pointer: coarse)').matches) return
    const dot = dot_ref.current
    const ring = ring_ref.current
    if (!dot || !ring) return

    let x = window.innerWidth / 2
    let y = window.innerHeight / 2
    let rx = x
    let ry = y
    let down = false
    let visible = false
    let raf = 0

    const on_move = (e: PointerEvent) => {
      x = e.clientX
      y = e.clientY
      if (!visible) {
        visible = true
        dot.style.opacity = '1'
        ring.style.opacity = '1'
      }
    }
    const on_down = () => {
      down = true
    }
    const on_up = () => {
      down = false
    }
    const on_leave = () => {
      visible = false
      dot.style.opacity = '0'
      ring.style.opacity = '0'
    }

    window.addEventListener('pointermove', on_move)
    window.addEventListener('pointerdown', on_down)
    window.addEventListener('pointerup', on_up)
    window.addEventListener('pointerleave', on_leave)

    const tick = () => {
      raf = requestAnimationFrame(tick)
      // the ring lags the dot for a fluid trail.
      rx += (x - rx) * 0.18
      ry += (y - ry) * 0.18
      const s = down ? 0.7 : 1
      dot.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -50%) scale(${s})`
      ring.style.transform = `translate3d(${rx}px, ${ry}px, 0) translate(-50%, -50%) scale(${down ? 1.25 : 1})`
    }
    raf = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('pointermove', on_move)
      window.removeEventListener('pointerdown', on_down)
      window.removeEventListener('pointerup', on_up)
      window.removeEventListener('pointerleave', on_leave)
    }
  }, [])

  return (
    <>
      <div ref={ring_ref} className="cursor-ring" aria-hidden="true" />
      <div ref={dot_ref} className="cursor-dot" aria-hidden="true" />
    </>
  )
}
