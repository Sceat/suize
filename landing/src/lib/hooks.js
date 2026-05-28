import { useEffect, useRef, useState } from 'react'

/**
 * useMousePosition — normalized [0..1] mouse coordinates relative to viewport.
 * Throttled via requestAnimationFrame to keep it cheap.
 */
export function useMousePosition() {
  const [pos, setPos] = useState({ x: 0.5, y: 0.5 })
  const raf = useRef(0)
  const next = useRef({ x: 0.5, y: 0.5 })

  useEffect(() => {
    const onMove = (e) => {
      next.current = {
        x: e.clientX / window.innerWidth,
        y: e.clientY / window.innerHeight,
      }
      if (!raf.current) {
        raf.current = requestAnimationFrame(() => {
          raf.current = 0
          setPos(next.current)
        })
      }
    }
    window.addEventListener('mousemove', onMove, { passive: true })
    return () => {
      window.removeEventListener('mousemove', onMove)
      if (raf.current) cancelAnimationFrame(raf.current)
    }
  }, [])

  return pos
}

/**
 * useReveal — toggles a class once the element scrolls into view.
 * Use with: <div ref={ref} className={`reveal ${visible ? 'is-visible' : ''}`}>
 *
 * Behavior:
 *  - IntersectionObserver triggers ~10% before the element enters the viewport
 *  - If IO hasn't fired within 1.5s, reveal anyway (defends against missed
 *    callbacks during programmatic scroll / screenshot / SSR hydration)
 *  - Respects prefers-reduced-motion by revealing immediately
 */
export function useReveal(threshold = 0.05) {
  const ref = useRef(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduced) {
      setVisible(true)
      return
    }

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setVisible(true)
            io.disconnect()
            break
          }
        }
      },
      { threshold, rootMargin: '0px 0px -8% 0px' }
    )
    io.observe(el)

    // Defensive fallback — if IO never fires (offscreen on tall pages,
    // print, headless tools), reveal after 1.5s so content is never lost.
    const safety = setTimeout(() => setVisible(true), 1500)

    return () => {
      io.disconnect()
      clearTimeout(safety)
    }
  }, [threshold])

  return [ref, visible]
}

/**
 * useScrollProgress — returns 0..1 progress of the page scroll.
 */
export function useScrollProgress() {
  const [progress, setProgress] = useState(0)
  useEffect(() => {
    const onScroll = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight
      if (max <= 0) return setProgress(0)
      setProgress(Math.min(1, Math.max(0, window.scrollY / max)))
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])
  return progress
}

/**
 * useSectionProgress — scoped scroll-progress for a section.
 *
 * Returns [ref, progress] where progress goes from 0 to 1 as the user scrolls
 * the section through the viewport. 0 = section just entered top of viewport,
 * 1 = section has just left top of viewport. Useful for sticky-pinned
 * sections that change state based on scroll within them.
 *
 * Uses rAF-throttled scroll listener for smoothness without overhead.
 */
export function useSectionProgress() {
  const ref = useRef(null)
  const [progress, setProgress] = useState(0)
  const raf = useRef(0)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const compute = () => {
      raf.current = 0
      const rect = el.getBoundingClientRect()
      const vh = window.innerHeight
      const total = rect.height - vh
      if (total <= 0) {
        // Section shorter than viewport — smooth progress based on the
        // section's center vs viewport center. 0 when section is fully
        // below the fold, 0.5 when centered, 1 when fully above.
        const sectionCenter = rect.top + rect.height / 2
        const viewportCenter = vh / 2
        // Distance the section center travels from (vh + h/2) at bottom
        // entry to (-h/2) at top exit = vh + h. Normalize to 0..1.
        const travel = vh + rect.height
        const traversed = (vh + rect.height / 2) - sectionCenter
        const p = Math.max(0, Math.min(1, traversed / travel))
        setProgress(p)
        return
      }
      // 0 when section top is at viewport top (top === 0)
      // 1 when section bottom is at viewport bottom (top === -total)
      const p = Math.max(0, Math.min(1, -rect.top / total))
      setProgress(p)
    }

    const schedule = () => {
      if (!raf.current) raf.current = requestAnimationFrame(compute)
    }

    compute()
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule, { passive: true })
    return () => {
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      if (raf.current) cancelAnimationFrame(raf.current)
    }
  }, [])

  return [ref, progress]
}
