import { useRef, useEffect, useMemo } from 'react'

/**
 * Suize — pure pixel-art droplet mascot.
 *
 * Built with the same approach as clawd (the Claude mascot in my portfolio):
 * an integer grid of rectangles, no smoothed paths in the body, three stepped
 * blue tones for shading (no gradients on the body itself), expressive face,
 * and quiet idle animations driven by CSS keyframes.
 *
 * Behaviors:
 *   - Breathe: continuous gentle squash-stretch (3.6s loop)
 *   - Float:   slow vertical drift (6s loop)
 *   - Blink:   ~every 5s, both eyes
 *   - Sparkles: tiny pixels around the body, fading in and out
 *   - Smile:   the mouth occasionally pops into a small upturn
 *   - Eyes:    optionally track the cursor within a ±1 pixel radius
 *
 * Poses (varies what the arms do and what the hands hold):
 *   - 'hero'  — left hand holds a gold $ coin, right hand holds a {} brace.
 *               The "I do both jobs" pose, used on the hero canyon.
 *   - 'hello' — both arms raised, waving, no items. The "Meet Suize"
 *               friendly-greeting pose. Larger smile cadence.
 *   - 'rest'  — no arms rendered. For the tiny footer mascot.
 *
 * The legacy `showArms` boolean still works (true → 'hero', false → 'rest').
 */

// --- Body silhouette: list of horizontal rows [y, x, width, band] ---
// Grid is 22 cells wide, 22 tall. Pointed top, rounded bottom.
// Band picks color: 'hi' (highlight), 'mid' (main body), 'lo' (lower shadow).
const ROWS = [
  [2,  10, 2,  'hi'],
  [3,  9,  4,  'hi'],
  [4,  8,  6,  'hi'],
  [5,  7,  8,  'hi'],
  [6,  6,  10, 'mid'],
  [7,  5,  12, 'mid'],
  [8,  4,  14, 'mid'],
  [9,  3,  16, 'mid'],
  [10, 3,  16, 'mid'],
  [11, 3,  16, 'mid'],
  [12, 3,  16, 'mid'],
  [13, 3,  16, 'lo'],
  [14, 3,  16, 'lo'],
  [15, 3,  16, 'lo'],
  [16, 4,  14, 'lo'],
  [17, 5,  12, 'lo'],
  [18, 6,  10, 'lo'],
  [19, 7,  8,  'lo'],
]

const COLOR = {
  hi:  '#7AC4FF',
  mid: '#4DA2FF',
  lo:  '#2E7BD6',
}

export default function Droplet ({
  size = 240,
  eyesFollowCursor = true,
  showArms,                  // legacy boolean — true ⇒ 'hero', omitted ⇒ 'rest'
  pose: poseProp,            // 'hero' | 'hello' | 'rest'
  className = '',
}) {
  const pose = poseProp ?? (showArms ? 'hero' : 'rest')
  const renderArms = pose !== 'rest'
  const svgRef = useRef(null)
  const eyesRef = useRef(null)

  // Pre-compute sparkle positions so they don't dance around on every render.
  const sparkles = useMemo(
    () =>
      [
        { x: 1,  y: 7,  d: 0,   c: '#B9DEFA' },
        { x: 21, y: 10, d: 1.6, c: '#B9DEFA' },
        { x: 0,  y: 14, d: 0.8, c: '#FFFFFF' },
        { x: 21, y: 16, d: 2.4, c: '#7AC4FF' },
        { x: 1,  y: 19, d: 3.2, c: '#B9DEFA' },
      ],
    []
  )

  useEffect(() => {
    if (!eyesFollowCursor || !svgRef.current || !eyesRef.current) return
    if (typeof window === 'undefined') return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduced) return

    let raf = 0
    const target = { x: 0, y: 0 }
    const current = { x: 0, y: 0 }

    const onMove = (e) => {
      const rect = svgRef.current.getBoundingClientRect()
      const cx = rect.left + rect.width / 2
      const cy = rect.top + rect.height / 2
      const dx = e.clientX - cx
      const dy = e.clientY - cy
      const dist = Math.hypot(dx, dy) || 1
      const norm = Math.min(dist / 600, 1)
      // 1 pixel cell max — keeps the cute pixel pop intact
      target.x = (dx / dist) * norm * 1
      target.y = (dy / dist) * norm * 1
    }

    const tick = () => {
      current.x += (target.x - current.x) * 0.08
      current.y += (target.y - current.y) * 0.08
      if (eyesRef.current) {
        eyesRef.current.setAttribute(
          'transform',
          `translate(${current.x.toFixed(3)} ${current.y.toFixed(3)})`
        )
      }
      raf = requestAnimationFrame(tick)
    }

    window.addEventListener('mousemove', onMove, { passive: true })
    raf = requestAnimationFrame(tick)
    return () => {
      window.removeEventListener('mousemove', onMove)
      cancelAnimationFrame(raf)
    }
  }, [eyesFollowCursor])

  return (
    <svg
      ref={svgRef}
      width={size}
      height={size}
      viewBox="0 0 22 24"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="Suize droplet mascot"
      role="img"
      shapeRendering="crispEdges"
      style={{ display: 'block', overflow: 'visible', imageRendering: 'pixelated' }}
      className={className}
    >
      <defs>
        <style>{`
          .body { transform-origin: 11px 18px; animation: bodyFloat 6s ease-in-out infinite, breathe 3.6s ease-in-out infinite; }
          .eyelid { transform-origin: 50% 50%; animation: blink 5.6s ease-in-out infinite; }
          .eyelid-r { animation-delay: 0.06s; }
          .smile { animation: smile 7s ease-in-out infinite; opacity: 0; transform-origin: 11px 14px; }
          .sparkle { animation: sparkle 4s ease-in-out infinite; opacity: 0; }
          .ripple { transform-origin: 11px 22px; animation: ripple 4.4s ease-in-out infinite; opacity: 0; }
          .ripple-2 { animation-delay: 1.8s; }
          .blush { animation: blushPulse 5s ease-in-out infinite; }

          /* Arms — pixel-art, hold items, idle bob with occasional wave */
          .arm-l       { transform-origin: 4px 12px;  animation: armL 7.5s ease-in-out infinite; }
          .arm-r       { transform-origin: 18px 12px; animation: armR 9s   ease-in-out infinite; }
          .arm-l-item  { transform-origin: 1px 15px;  animation: itemBob 7.5s ease-in-out infinite; }
          .arm-r-item  { transform-origin: 21px 15px; animation: itemBob 9s ease-in-out infinite -2s; }
          .coin-shine  { animation: shine 3.4s ease-in-out infinite; }

          /* Wave pose — both arms raised, hands swinging side-to-side.
             Bigger rotation than the hero pose, asymmetric timing so the
             two hands never strike the same beat. */
          .arm-l-wave  { transform-origin: 4px 12px;  animation: armWaveL 2.2s ease-in-out infinite; }
          .arm-r-wave  { transform-origin: 18px 12px; animation: armWaveR 2.4s ease-in-out infinite -0.6s; }

          @keyframes armL {
            0%, 100% { transform: rotate(0deg); }
            48%      { transform: rotate(-10deg); }
            54%      { transform: rotate(-26deg); }
            60%      { transform: rotate(-10deg); }
            66%      { transform: rotate(-22deg); }
            72%      { transform: rotate(0deg); }
          }
          @keyframes armR {
            0%, 100% { transform: rotate(0deg); }
            30%      { transform: rotate(8deg); }
            38%      { transform: rotate(-2deg); }
            46%      { transform: rotate(10deg); }
            55%      { transform: rotate(0deg); }
          }
          @keyframes armWaveL {
            0%, 100% { transform: rotate(-72deg); }
            50%      { transform: rotate(-92deg); }
          }
          @keyframes armWaveR {
            0%, 100% { transform: rotate(72deg); }
            50%      { transform: rotate(92deg); }
          }
          @keyframes itemBob {
            0%, 100% { transform: translateY(0); }
            50%      { transform: translateY(-0.5px); }
          }
          @keyframes shine {
            0%, 100% { opacity: 0.3; }
            50%      { opacity: 1; }
          }

          @keyframes bodyFloat {
            0%, 100% { transform: translateY(0); }
            33%      { transform: translateY(-0.5px) rotate(-0.5deg); }
            66%      { transform: translateY(0.4px) rotate(0.5deg); }
          }
          @keyframes breathe {
            0%, 100% { transform: scale(1, 1); }
            50%      { transform: scale(1.025, 0.975); }
          }
          @keyframes blink {
            0%, 92%, 100% { transform: scaleY(1); }
            94%, 96.5%    { transform: scaleY(0.08); }
          }
          @keyframes smile {
            0%, 88%, 100% { opacity: 0; transform: scaleY(1); }
            91%, 96%      { opacity: 1; transform: scaleY(1); }
          }
          @keyframes sparkle {
            0%, 100% { opacity: 0; transform: scale(0.5); }
            45%, 55% { opacity: 1; transform: scale(1); }
          }
          @keyframes ripple {
            0%, 100% { transform: scaleX(0.55) scaleY(1); opacity: 0; }
            12%      { opacity: 0.5; }
            70%      { transform: scaleX(1.6) scaleY(0.6); opacity: 0; }
          }
          @keyframes blushPulse {
            0%, 100% { opacity: 0.5; }
            50%      { opacity: 0.85; }
          }

          @media (prefers-reduced-motion: reduce) {
            .body, .eyelid, .smile, .sparkle, .ripple, .blush,
            .arm-l, .arm-r, .arm-l-item, .arm-r-item, .coin-shine,
            .arm-l-wave, .arm-r-wave { animation: none; }
          }
        `}</style>
      </defs>

      {/* Ambient sparkles around the droplet */}
      {sparkles.map((s, i) => (
        <rect
          key={i}
          className="sparkle"
          x={s.x}
          y={s.y}
          width="1"
          height="1"
          fill={s.c}
          style={{ animationDelay: `${s.d}s` }}
        />
      ))}

      {/* Ripple shadows at base */}
      <rect className="ripple" x="4" y="22" width="14" height="1" fill="#4DA2FF" />
      <rect className="ripple ripple-2" x="4" y="22" width="14" height="1" fill="#7AC4FF" />

      <g className="body">
        {/* Body silhouette */}
        {ROWS.map(([y, x, w, band]) => (
          <rect key={y} x={x} y={y} width={w} height="1" fill={COLOR[band]} />
        ))}

        {/* Specular highlight pixels (top-left curve) */}
        <rect x="7"  y="6" width="1" height="1" fill="#E8F4FF" />
        <rect x="6"  y="7" width="1" height="1" fill="#B9DEFA" />
        <rect x="5"  y="8" width="1" height="1" fill="#B9DEFA" />
        <rect x="5"  y="9" width="1" height="1" fill="#B9DEFA" opacity="0.7" />

        {/* Bottom-right deep shadow accent (one extra dark pixel band) */}
        <rect x="14" y="14" width="3" height="1" fill="#1F5FB6" opacity="0.5" />
        <rect x="15" y="15" width="2" height="1" fill="#1F5FB6" opacity="0.5" />

        {/* Cheek blush — light cyan pixels for "cute" energy */}
        <rect className="blush" x="5"  y="13" width="2" height="1" fill="#9BD6FF" />
        <rect className="blush" x="15" y="13" width="2" height="1" fill="#9BD6FF" />

        {renderArms && pose === 'hero' && (
          <>
            {/* LEFT ARM — pixel-art segments, holds a tiny coin */}
            <g className="arm-l">
              {/* arm segments from body edge to hand */}
              <rect x="3"  y="12" width="1" height="1" fill="#4DA2FF" />
              <rect x="2"  y="13" width="1" height="1" fill="#4DA2FF" />
              <rect x="1"  y="14" width="1" height="1" fill="#2E7BD6" />
              {/* hand — slightly brighter */}
              <rect x="0"  y="15" width="2" height="1" fill="#7AC4FF" />
              {/* coin held in left hand */}
              <g className="arm-l-item">
                <rect x="-2" y="16" width="4" height="1" fill="#FACC15" />
                <rect x="-3" y="17" width="6" height="2" fill="#FACC15" />
                <rect x="-2" y="19" width="4" height="1" fill="#B07B0E" />
                {/* tiny "$" mark */}
                <rect x="0"  y="17" width="1" height="2" fill="#7A4F00" />
                {/* shimmer pixel */}
                <rect className="coin-shine" x="-1" y="17" width="1" height="1" fill="#FFFFFF" />
              </g>
            </g>

            {/* RIGHT ARM — holds a small brace token {} */}
            <g className="arm-r">
              <rect x="18" y="12" width="1" height="1" fill="#4DA2FF" />
              <rect x="19" y="13" width="1" height="1" fill="#4DA2FF" />
              <rect x="20" y="14" width="1" height="1" fill="#2E7BD6" />
              <rect x="20" y="15" width="2" height="1" fill="#7AC4FF" />
              <g className="arm-r-item">
                {/* left brace { */}
                <rect x="22" y="16" width="1" height="3" fill="#7AC4FF" />
                <rect x="23" y="16" width="1" height="1" fill="#7AC4FF" />
                <rect x="23" y="18" width="1" height="1" fill="#7AC4FF" />
                {/* dot */}
                <rect x="25" y="17" width="1" height="1" fill="#E8F4FF" />
                {/* right brace } */}
                <rect x="27" y="16" width="1" height="3" fill="#7AC4FF" />
                <rect x="26" y="16" width="1" height="1" fill="#7AC4FF" />
                <rect x="26" y="18" width="1" height="1" fill="#7AC4FF" />
              </g>
            </g>
          </>
        )}

        {renderArms && pose === 'hello' && (
          <>
            {/* LEFT ARM — raised, waving, no item. The arm rects sit at the
                same positions as the hero pose; the bigger rotation in
                .arm-l-wave swings them up above the head. */}
            <g className="arm-l-wave">
              <rect x="3"  y="12" width="1" height="1" fill="#4DA2FF" />
              <rect x="2"  y="13" width="1" height="1" fill="#4DA2FF" />
              <rect x="1"  y="14" width="1" height="1" fill="#2E7BD6" />
              {/* open hand — a 2-wide pixel cluster reads as a wave */}
              <rect x="0"  y="15" width="2" height="1" fill="#7AC4FF" />
              <rect x="-1" y="15" width="1" height="1" fill="#7AC4FF" />
            </g>

            {/* RIGHT ARM — same mirrored geometry, no item */}
            <g className="arm-r-wave">
              <rect x="18" y="12" width="1" height="1" fill="#4DA2FF" />
              <rect x="19" y="13" width="1" height="1" fill="#4DA2FF" />
              <rect x="20" y="14" width="1" height="1" fill="#2E7BD6" />
              <rect x="20" y="15" width="2" height="1" fill="#7AC4FF" />
              <rect x="22" y="15" width="1" height="1" fill="#7AC4FF" />
            </g>
          </>
        )}

        {/* Face — eyes + mouth */}
        <g ref={eyesRef}>
          {/* Left eye */}
          <g>
            <rect x="6" y="10" width="2" height="3" fill="#0A1A2E" />
            <rect x="6" y="10" width="2" height="3" fill="#0A1A2E" className="eyelid" />
            {/* Eye sparkle */}
            <rect x="6" y="10" width="1" height="1" fill="#E8F4FF" />
          </g>
          {/* Right eye */}
          <g>
            <rect x="14" y="10" width="2" height="3" fill="#0A1A2E" />
            <rect x="14" y="10" width="2" height="3" fill="#0A1A2E" className="eyelid eyelid-r" />
            <rect x="14" y="10" width="1" height="1" fill="#E8F4FF" />
          </g>
        </g>

        {/* Mouth — small "u" smile pixels (mostly hidden, peeks in occasionally) */}
        <g>
          {/* Default tiny line mouth */}
          <rect x="10" y="15" width="2" height="1" fill="#0A1A2E" opacity="0.7" />
          {/* Smile that occasionally appears */}
          <g className="smile">
            <rect x="9"  y="15" width="1" height="1" fill="#0A1A2E" />
            <rect x="10" y="16" width="2" height="1" fill="#0A1A2E" />
            <rect x="12" y="15" width="1" height="1" fill="#0A1A2E" />
          </g>
        </g>
      </g>
    </svg>
  )
}
