import { useEffect, useRef } from 'react'
import { Renderer, Program, Mesh, Triangle, Vec2, Vec3 } from 'ogl'

// ============================================================================
// <HeroShader> — the ONE contained matter moment behind the masthead, restored
// from the previous suize.io (the owner's "keep our background shader"). Ported
// 1:1 from apps/landing HeroScene: a SPARSE set of elegant ink threads (ridged
// flow-noise thresholded into thin filaments) that BREATHE and BARELY react to
// the cursor. Never full-page wallpaper, never focus-stealing — it sits at
// z-index:-1 behind the top of the page, fades to paper at its own edges, and
// pauses when scrolled off. Colours are the Dispatch light tokens (paper #fbfcfe,
// ink #0a1b2e, one blue #1e7fd6). Reduced-motion / touch / no-WebGL → the static
// paper (no GL loop). DPR capped + 0.6x internal res; one self-owned rAF (this is
// the app's only canvas, so one loop is correct).
// ============================================================================

const VERT = /* glsl */ `
  attribute vec2 position;
  void main() { gl_Position = vec4(position, 0.0, 1.0); }
`

const FRAG = /* glsl */ `
  precision highp float;

  uniform float uTime;
  uniform vec2  uRes;
  uniform vec2  uMouse;     // 0..1 hero-local, eased
  uniform vec2  uVel;       // eased pointer velocity (the wake)
  uniform float uPointer;   // 0 until the pointer has moved over the hero

  uniform vec3  uPaper;     // the page floor colour the matter sits in
  uniform vec3  uMatterLo;  // the matter at its thinnest (near paper)
  uniform vec3  uMatterHi;  // the dense / lit cores of the substance
  uniform vec3  uTint;      // the cool accent that rims the filaments
  uniform float uInk;       // overall matter strength
  uniform float uContrast;  // filament contrast (form vs haze)
  uniform float uAccent;    // MASTER cap — keeps the whole field a quiet accent

  float hash21(vec2 p){
    p = fract(p * vec2(123.34, 345.45));
    p += dot(p, p + 34.345);
    return fract(p.x * p.y);
  }
  float vnoise(vec2 p){
    vec2 i = floor(p); vec2 f = fract(p);
    f = f*f*(3.0 - 2.0*f);
    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }
  float fbm(vec2 p){
    float v = 0.0, a = 0.5;
    mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
    for(int i = 0; i < 5; i++){
      v += a * vnoise(p);
      p = m * p;
      a *= 0.5;
    }
    return v;
  }

  float ridged(vec2 p){
    float v = 0.0, a = 0.5;
    mat2 m = mat2(1.7, 1.0, -1.0, 1.7);
    for(int i = 0; i < 4; i++){
      float n = vnoise(p);
      n = 1.0 - abs(n * 2.0 - 1.0);
      v += a * n * n;
      p = m * p;
      a *= 0.5;
    }
    return v;
  }

  float threads(vec2 uv, float scale, float flow, float warpA, float sharp, vec2 disp){
    vec2 p = uv * scale;
    p += disp;
    p.y += flow;
    vec2 q = vec2(
      fbm(p + vec2(0.0, uTime * 0.030)),
      fbm(p + vec2(4.3, -uTime * 0.024) + 1.7)
    );
    float r = ridged(p + warpA * q);
    float line = smoothstep(0.46, 0.92, r);
    return pow(line, sharp);
  }

  void main(){
    vec2 frag = gl_FragCoord.xy / uRes.xy;
    float aspect = uRes.x / uRes.y;
    vec2 uv = frag;
    uv.x *= aspect;

    vec2 m = uMouse; m.x *= aspect;
    vec2 toM = uv - m;
    float dM = length(toM);
    vec2  dir = toM / max(dM, 0.0001);
    float reach = exp(-dM * dM * 46.0) * uPointer;
    vec2 swirl = vec2(-dir.y, dir.x);
    vec2 wake  = uVel * 0.45;
    vec2 disp = (dir * 0.045 + swirl * 0.028) * reach + wake * (reach * 0.25 + 0.004);

    float t0 = threads(uv * 0.64, 1.0, uTime * 0.010, 0.30, 1.15, disp * 0.4);
    float t1 = threads(uv * 1.04, 1.7, uTime * 0.016, 0.50, 1.55, disp * 0.9);

    float matter = max(t0 * 0.62, t1 * 0.82);
    matter = pow(clamp(matter, 0.0, 1.0), uContrast);
    matter += reach * 0.008 * uPointer;

    vec3 col = uPaper;
    col = mix(col, uMatterLo, smoothstep(0.04, 0.55, matter) * uInk);
    col = mix(col, uMatterHi, smoothstep(0.45, 1.0, matter) * uInk);
    float rim = smoothstep(0.55, 1.0, matter);
    col = mix(col, mix(col, uTint, 0.7), rim * 0.4 * uInk);
    col = mix(col, mix(col, uTint, 0.5), reach * 0.015 * uInk);

    float edge = smoothstep(0.0, 0.09, frag.y) * smoothstep(1.0, 0.91, frag.y);
    float a = uAccent * edge;
    col = mix(uPaper, col, a);

    gl_FragColor = vec4(col, 1.0);
  }
`

// The Dispatch light palette (tokens: paper #fbfcfe, ink #0a1b2e, blue #1e7fd6).
// A quieter uAccent than the landing (0.82) — here it sits behind dense editorial
// content, so it stays a background accent the masthead + doors always win.
const PAL = {
  paper: [0.984, 0.988, 0.996] as const,
  matterLo: [0.56, 0.65, 0.77] as const,
  matterHi: [0.039, 0.106, 0.18] as const,
  tint: [0.118, 0.498, 0.839] as const,
  ink: 1.0,
  contrast: 1.35,
  accent: 0.62,
}

const reduced = (): boolean =>
  typeof window !== 'undefined' &&
  (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true ||
    window.matchMedia?.('(hover: none), (pointer: coarse)').matches === true)

export function HeroShader() {
  const hostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host || reduced()) return

    let renderer: Renderer
    try {
      renderer = new Renderer({
        dpr: Math.min(window.devicePixelRatio || 1, 2) * 0.6,
        alpha: false,
        antialias: false,
        powerPreference: 'high-performance',
      })
    } catch {
      return // no WebGL — the paper shows through, nothing to do
    }

    const gl = renderer.gl
    host.appendChild(gl.canvas)
    gl.canvas.className = 'hero-shader__canvas'
    gl.clearColor(PAL.paper[0], PAL.paper[1], PAL.paper[2], 1)

    const res = new Vec2(1, 1)
    const mouse = new Vec2(0.5, 0.5)
    const targetMouse = new Vec2(0.5, 0.5)
    const vel = new Vec2(0, 0)

    const program = new Program(gl, {
      vertex: VERT,
      fragment: FRAG,
      uniforms: {
        uTime: { value: 0 },
        uRes: { value: res },
        uMouse: { value: mouse },
        uVel: { value: vel },
        uPointer: { value: 0 },
        uPaper: { value: new Vec3(...PAL.paper) },
        uMatterLo: { value: new Vec3(...PAL.matterLo) },
        uMatterHi: { value: new Vec3(...PAL.matterHi) },
        uTint: { value: new Vec3(...PAL.tint) },
        uInk: { value: PAL.ink },
        uContrast: { value: PAL.contrast },
        uAccent: { value: PAL.accent },
      },
    })
    const mesh = new Mesh(gl, { geometry: new Triangle(gl), program })

    let rect = host.getBoundingClientRect()
    const resize = () => {
      rect = host.getBoundingClientRect()
      const w = host.clientWidth || rect.width || 1
      const h = host.clientHeight || rect.height || 1
      renderer.setSize(w, h)
      res.set(gl.drawingBufferWidth, gl.drawingBufferHeight)
    }
    resize()
    window.addEventListener('resize', resize)

    let moved = false
    let lastX = 0.5
    let lastY = 0.5
    const onMove = (e: PointerEvent) => {
      const nx = (e.clientX - rect.left) / Math.max(rect.width, 1)
      const ny = 1 - (e.clientY - rect.top) / Math.max(rect.height, 1)
      const cx = Math.min(1, Math.max(0, nx))
      const cy = Math.min(1, Math.max(0, ny))
      vel.x += (cx - lastX - vel.x) * 0.5
      vel.y += (cy - lastY - vel.y) * 0.5
      lastX = cx
      lastY = cy
      targetMouse.set(cx, cy)
      if (!moved) {
        moved = true
        mouse.set(cx, cy)
      }
    }
    window.addEventListener('pointermove', onMove, { passive: true })

    let onscreen = true
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) onscreen = e.isIntersecting
        rect = host.getBoundingClientRect()
      },
      { threshold: 0 },
    )
    io.observe(host)

    let pointer = 0
    let raf = 0
    const start = performance.now()
    const frame = () => {
      raf = requestAnimationFrame(frame)
      if (!onscreen) return
      const elapsed = (performance.now() - start) / 1000
      mouse.x += (targetMouse.x - mouse.x) * 0.07
      mouse.y += (targetMouse.y - mouse.y) * 0.07
      vel.x *= 0.86
      vel.y *= 0.86
      pointer += ((moved ? 1 : 0) - pointer) * 0.05
      program.uniforms.uPointer.value = pointer
      program.uniforms.uTime.value = elapsed
      renderer.render({ scene: mesh })
    }
    raf = requestAnimationFrame(frame)

    return () => {
      cancelAnimationFrame(raf)
      io.disconnect()
      window.removeEventListener('resize', resize)
      window.removeEventListener('pointermove', onMove)
      const ext = gl.getExtension('WEBGL_lose_context')
      if (ext) ext.loseContext()
      if (gl.canvas.parentNode === host) host.removeChild(gl.canvas)
    }
  }, [])

  return <div className="hero-shader" ref={hostRef} aria-hidden="true" />
}
