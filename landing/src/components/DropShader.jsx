import { useEffect, useRef } from 'react'
import { Program, Mesh, Renderer, Triangle } from 'ogl'

/**
 * DropShader — carbon-dark fluid experiment.
 *
 * Domain-warped FBM (Inigo Quilez pattern) creates slow ink-in-water flow.
 * Carbon-dark base, one bright Sui-blue plume that breathes through warped
 * coordinates. Mouse causes a small domain offset — cursor disturbs the ink
 * locally, doesn't lead it.
 *
 * Not curl-noise haze. Not cyan light. A real fluid feel: viscous, slow,
 * deeply layered with depth contrast.
 */

const VERT = /* glsl */ `
attribute vec2 position;
varying vec2 vUv;
void main() {
  vUv = position * 0.5 + 0.5;
  gl_Position = vec4(position, 0.0, 1.0);
}
`

const FRAG = /* glsl */ `
precision highp float;

uniform float uTime;
uniform vec2  uResolution;
uniform vec2  uMouse;
uniform vec3  uInk;        // bright plume color
uniform vec3  uDeep;       // deepest carbon
uniform vec3  uMid;        // mid carbon-blue
uniform float uIntensity;

varying vec2 vUv;

// Inigo Quilez — value noise + FBM + domain warp.
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float vnoise(in vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
}

float fbm(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) {
    s += a * vnoise(p);
    p = p * 2.02;
    a *= 0.5;
  }
  return s;
}

void main() {
  vec2 uv = vUv;
  float aspect = uResolution.x / uResolution.y;
  vec2 p = (uv - 0.5) * vec2(aspect, 1.0);

  float t = uTime * 0.07;

  // Mouse offset — local domain warp around cursor
  vec2 m = (uMouse - 0.5) * vec2(aspect, 1.0);
  vec2 toMouse = p - m;
  float mouseDist = length(toMouse);
  float mouseInfluence = 0.10 * exp(-mouseDist * 3.0);

  // Two-stage domain warp — IQ pattern
  vec2 q = vec2(
    fbm(p + vec2(0.0, t)),
    fbm(p + vec2(5.2, -t * 0.8) + 1.3)
  );

  vec2 r = vec2(
    fbm(p + 4.0 * q + vec2(1.7 + t * 0.5, 9.2)),
    fbm(p + 4.0 * q + vec2(8.3 - t * 0.3, 2.8))
  );

  // Apply mouse offset to the second warp
  r += toMouse * mouseInfluence;

  float f = fbm(p + 4.0 * r);

  // Compose the ink — bright plume against carbon depth
  vec3 col = mix(uDeep, uMid, smoothstep(0.0, 0.6, f));
  col = mix(col, uInk, smoothstep(0.55, 1.0, f * f));

  // Subtle highlight where the warp swirls intensely
  float swirl = length(r);
  col += uInk * 0.15 * smoothstep(0.7, 1.2, swirl);

  // Vignette
  float vig = smoothstep(1.3, 0.4, length(p));
  col *= 0.78 + 0.22 * vig;

  // Grain
  float g = vnoise(uv * uResolution.xy * 0.18 + uTime * 0.5);
  col += (g - 0.5) * 0.025;

  gl_FragColor = vec4(col * uIntensity, 1.0);
}
`

export default function DropShader () {
  const rootRef = useRef(null)
  const canvasRef = useRef(null)
  const target = useRef([0.5, 0.5])
  const current = useRef([0.5, 0.5])

  useEffect(() => {
    const onMove = (e) => {
      target.current = [
        e.clientX / window.innerWidth,
        1.0 - e.clientY / window.innerHeight,
      ]
    }
    window.addEventListener('mousemove', onMove, { passive: true })
    return () => window.removeEventListener('mousemove', onMove)
  }, [])

  useEffect(() => {
    const root = rootRef.current
    const canvas = canvasRef.current
    if (!root || !canvas) return

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5)

    let renderer
    try {
      renderer = new Renderer({
        canvas, dpr, alpha: false,
        powerPreference: 'low-power', antialias: false,
      })
    } catch {
      return
    }

    const { gl } = renderer
    const program = new Program(gl, {
      vertex: VERT,
      fragment: FRAG,
      uniforms: {
        uTime: { value: 0 },
        uResolution: { value: [1, 1] },
        uMouse: { value: [0.5, 0.5] },
        uInk:  { value: [0.478, 0.769, 1.0] },   // #7AC4FF
        uDeep: { value: [0.008, 0.039, 0.082] }, // #020a14
        uMid:  { value: [0.039, 0.094, 0.184] }, // #0a182f
        uIntensity: { value: 1.0 },
      },
      transparent: false,
    })

    const mesh = new Mesh(gl, { geometry: new Triangle(gl), program })

    const resize = () => {
      const r = root.getBoundingClientRect()
      if (r.width <= 0 || r.height <= 0) return
      renderer.setSize(r.width, r.height)
      program.uniforms.uResolution.value = [canvas.width, canvas.height]
    }
    resize()

    let raf = 0
    let inView = true
    let startTs = 0

    const tick = (ts) => {
      raf = 0
      if (gl.isContextLost && gl.isContextLost()) return
      if (!startTs) startTs = ts
      const elapsed = (ts - startTs) / 1000

      current.current[0] += (target.current[0] - current.current[0]) * 0.04
      current.current[1] += (target.current[1] - current.current[1]) * 0.04

      program.uniforms.uTime.value = elapsed
      program.uniforms.uMouse.value = current.current

      try {
        renderer.render({ scene: mesh })
      } catch {
        return
      }
      if (!reduced && inView && !document.hidden) raf = requestAnimationFrame(tick)
    }

    const kick = () => {
      if (!raf && !reduced && inView && !document.hidden) raf = requestAnimationFrame(tick)
    }

    const ro = new ResizeObserver(resize)
    ro.observe(root)

    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          inView = e.isIntersecting
          if (inView) kick()
        }
      },
      { threshold: 0.01 }
    )
    io.observe(root)

    const onVis = () => {
      if (document.hidden) {
        if (raf) cancelAnimationFrame(raf)
        raf = 0
      } else { kick() }
    }
    document.addEventListener('visibilitychange', onVis)
    if (!reduced) kick()

    return () => {
      if (raf) cancelAnimationFrame(raf)
      ro.disconnect()
      io.disconnect()
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [])

  return (
    <div
      ref={rootRef}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 -z-10 overflow-hidden"
    >
      <canvas ref={canvasRef} className="absolute inset-0 block w-full h-full" />
    </div>
  )
}
