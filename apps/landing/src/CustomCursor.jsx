import { useEffect, useRef } from 'react'

// ============================================================================
// <CustomCursor> — a soft glowing dot + lagging ring that trails the pointer.
// Used lightly: the ring scales up over interactive elements. Disabled on
// touch / coarse pointers. Two transform-only layers via rAF — no React
// re-render per frame.
// ============================================================================
export function CustomCursor() {
  const dotRef = useRef(null)
  const ringRef = useRef(null)

  useEffect(() => {
    if (window.matchMedia('(hover: none), (pointer: coarse)').matches) return
    const dot = dotRef.current
    const ring = ringRef.current
    if (!dot || !ring) return

    let x = window.innerWidth / 2
    let y = window.innerHeight / 2
    let rx = x
    let ry = y
    let down = false
    let over = false
    let visible = false
    let raf = 0

    const onMove = e => {
      x = e.clientX
      y = e.clientY
      over = !!e.target.closest?.(
        'a, button, input, [role="button"], [tabindex]',
      )
      if (!visible) {
        visible = true
        dot.style.opacity = '1'
        ring.style.opacity = '1'
      }
    }
    const onDown = () => (down = true)
    const onUp = () => (down = false)
    const onLeave = () => {
      visible = false
      dot.style.opacity = '0'
      ring.style.opacity = '0'
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerdown', onDown)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointerleave', onLeave)

    const tick = () => {
      raf = requestAnimationFrame(tick)
      rx += (x - rx) * 0.18
      ry += (y - ry) * 0.18
      const ds = down ? 0.7 : 1
      const rs = down ? 1.25 : over ? 1.9 : 1
      dot.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -50%) scale(${ds})`
      ring.style.transform = `translate3d(${rx}px, ${ry}px, 0) translate(-50%, -50%) scale(${rs})`
      ring.style.borderColor = over
        ? 'var(--accent)'
        : 'var(--hair-blue)'
    }
    raf = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointerleave', onLeave)
    }
  }, [])

  return (
    <>
      <div ref={ringRef} className="cursor-ring" aria-hidden="true" />
      <div ref={dotRef} className="cursor-dot" aria-hidden="true" />
    </>
  )
}
