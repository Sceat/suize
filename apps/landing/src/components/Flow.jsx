import { useEffect, useRef } from 'react'
import { gsap, ScrollTrigger, prefersReducedMotion } from '../lib/motion'

// 03 · THE FLOW — the signature scrubbed money-flow beat.
// A single luminous blue value-token travels a curved path that the user DRAWS
// BY SCROLLING: human funds → agent wallet → merchant. At the settle, a Martian
// Mono amount resolves and the fee-emitted note ticks off (no price — numbers
// live on /pricing). The ONE place blue money appears. Reduced-motion: the full
// path renders statically, already settled.
export default function Flow() {
  const root = useRef(null)

  useEffect(() => {
    const el = root.current
    if (!el) return
    const path = el.querySelector('.sx-flow__path')
    const token = el.querySelector('.sx-flow__token')
    const amt = el.querySelector('.sx-flow__amt')
    const split = el.querySelector('.sx-flow__split')
    const nodes = el.querySelectorAll('.sx-flow__node')

    const len = path.getTotalLength()
    path.style.strokeDasharray = `${len}`

    if (prefersReducedMotion()) {
      // statically rendered, already settled
      path.style.strokeDashoffset = '0'
      const end = path.getPointAtLength(len)
      token.setAttribute('cx', end.x)
      token.setAttribute('cy', end.y)
      token.style.opacity = '1'
      amt.style.opacity = '1'
      split.style.opacity = '1'
      nodes.forEach(n => (n.style.opacity = '1'))
      return
    }

    path.style.strokeDashoffset = `${len}`
    gsap.set([amt, split], { opacity: 0 })
    gsap.set(token, { opacity: 0 })

    const ctx = gsap.context(() => {
      const tl = gsap.timeline({
        scrollTrigger: {
          trigger: el,
          start: 'top top',
          end: '+=160%',
          scrub: 0.6,
          pin: el.querySelector('.sx-flow__pin'),
          anticipatePin: 1,
        },
      })

      // nodes light up in sequence
      tl.to(nodes[0], { opacity: 1, duration: 0.1 }, 0)
      tl.to(token, { opacity: 1, duration: 0.05 }, 0.02)

      // draw the path while the token rides it
      tl.to(
        path,
        { strokeDashoffset: 0, duration: 1, ease: 'none' },
        0,
      )
      tl.to(
        token,
        {
          duration: 1,
          ease: 'none',
          onUpdate: function () {
            const p = path.getPointAtLength(len * this.progress())
            token.setAttribute('cx', p.x)
            token.setAttribute('cy', p.y)
          },
        },
        0,
      )
      tl.to(nodes[1], { opacity: 1, duration: 0.08 }, 0.42)
      tl.to(nodes[2], { opacity: 1, duration: 0.08 }, 0.86)

      // the amount + 2% split resolve at the settle
      tl.to(amt, { opacity: 1, duration: 0.12 }, 0.9)
      tl.to(split, { opacity: 1, duration: 0.12 }, 0.95)
    }, el)

    return () => ctx.revert()
  }, [])

  return (
    <section className="sx-flow" id="flow" ref={root}>
      <div className="sx-flow__pin">
        <div className="sx-flow__inner sx-wrap">
          <div className="sx-marker">
            <span className="sx-marker__no">//03</span>
            <span className="sx-marker__label">The flow</span>
            <span className="sx-marker__line" />
          </div>
          <div className="sx-flow__lead">
            <span className="ed-eyebrow">Value moving</span>
            <h2 className="sx-flow__title">
              Watch money cross the agentic web — at the tempo you set.
            </h2>
          </div>

          <div className="sx-flow__stage">
            <svg
              className="sx-flow__svg"
              viewBox="0 0 1000 260"
              role="img"
              aria-label="A payment travels from a person to an agent wallet to a merchant."
            >
              {/* the path: human (left) -> agent wallet (center) -> merchant (right) */}
              <path
                className="sx-flow__path"
                d="M 120 180 C 260 60, 360 60, 500 130 S 760 220, 880 90"
                fill="none"
                stroke="var(--blue)"
                strokeWidth="2"
                strokeLinecap="round"
                opacity="0.9"
              />
              {/* a faint ghost of the full path so the route reads before scroll */}
              <path
                d="M 120 180 C 260 60, 360 60, 500 130 S 760 220, 880 90"
                fill="none"
                stroke="var(--hair-strong)"
                strokeWidth="1"
                strokeDasharray="2 6"
              />

              {/* the travelling value-token */}
              <circle
                className="sx-flow__token"
                cx="120"
                cy="180"
                r="6"
                fill="var(--blue)"
                style={{ filter: 'drop-shadow(0 0 8px var(--blue-glow))' }}
              />

              {/* nodes */}
              <g className="sx-flow__node" style={{ opacity: 0 }}>
                <circle cx="120" cy="180" r="4" fill="var(--fg-3)" />
                <text className="sx-flow__node-label" x="120" y="214" textAnchor="middle">
                  The person
                </text>
                <text className="sx-flow__node-sub" x="120" y="230" textAnchor="middle">
                  funds
                </text>
              </g>
              <g className="sx-flow__node" style={{ opacity: 0 }}>
                <circle cx="500" cy="130" r="5" fill="var(--blue)" />
                <text className="sx-flow__node-label" x="500" y="100" textAnchor="middle">
                  The agent
                </text>
                <text className="sx-flow__node-sub" x="500" y="116" textAnchor="middle">
                  wallet
                </text>
              </g>
              <g className="sx-flow__node" style={{ opacity: 0 }}>
                <circle cx="880" cy="90" r="4" fill="var(--fg-3)" />
                <text className="sx-flow__node-label" x="880" y="124" textAnchor="middle">
                  The merchant
                </text>
                <text className="sx-flow__amt" x="880" y="64" textAnchor="middle" opacity="0">
                  +$12.00 USDC
                </text>
              </g>

              <text className="sx-flow__split" x="880" y="142" textAnchor="middle" opacity="0">
                settles instantly · fee emitted on-chain
              </text>
            </svg>
          </div>

          <span className="sx-flow__hint">
            Scroll to send
          </span>
        </div>
      </div>
    </section>
  )
}
