import { useEffect, useRef, useState } from 'react'
import { Renderer, Program, Mesh, Triangle, Vec2, Vec3 } from 'ogl'
import { onTick, prefersReducedMotion, isTouch } from '../lib/motion'
import { getTheme, onThemeChange } from '../lib/theme'

// ============================================================================
// <HeroScene> — the ONE deliberate, CONTAINED matter moment. LIGHT + CONTRASTED.
//
// Owner verdict on the prior field: "invisible on the white theme" and "all
// these falling pixels are quite bloated — better something light but
// contrasted." So this is a REWORK, not the old domain-warped haze:
//   · the heavy scrolling grain ("falling pixels") is GONE — no particulate;
//   · the dense multi-octave warp haze is replaced by a SPARSE set of ELEGANT
//     ink threads (ridged flow-noise, thresholded into thin filaments) — fewer,
//     cleaner lines that are clearly FELT on white, never busy;
//   · contrast is raised on the light theme (inkier strokes on light paper) so
//     it is actually perceptible, not washed out;
//   · it still BREATHES (slow drift) + responds to the cursor (hero-local), and
//     a master uAccent keeps it a quiet accent the headline + conversation win.
//
// Bounded to the hero: canvas absolutely positioned + overflow-clipped INSIDE
// the hero section (NOT fixed / full-viewport). Rides the ONE shared clock
// (lib/motion onTick). Pauses via IntersectionObserver when the hero scrolls
// off. Reduced-motion / touch / no-WebGL → a calm static CSS poster (set on the
// host in hero.css), never the GL loop. DPR capped + 0.6× internal res.
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

  // --- PALETTE (swapped per theme/room) ---
  uniform vec3  uPaper;     // the page floor colour the matter sits in
  uniform vec3  uMatterLo;  // the matter at its thinnest (near paper)
  uniform vec3  uMatterHi;  // the dense / lit cores of the substance
  uniform vec3  uTint;      // the cool accent that rims the filaments
  uniform float uInk;       // overall matter strength (light = strong dark ink)
  uniform float uContrast;  // filament contrast (form vs haze)
  uniform float uGrain;     // particulate grain amount
  uniform float uAccent;    // MASTER cap — keeps the whole field a quiet accent

  // ---------- hash / value-noise / fbm ----------
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
    mat2 m = mat2(1.6, 1.2, -1.2, 1.6); // rotate+scale each octave (no axis bias)
    for(int i = 0; i < 5; i++){
      v += a * vnoise(p);
      p = m * p;
      a *= 0.5;
    }
    return v;
  }

  // ridged fbm — sharpens the noise into filaments / striations (the "form")
  float ridged(vec2 p){
    float v = 0.0, a = 0.5;
    mat2 m = mat2(1.7, 1.0, -1.0, 1.7);
    for(int i = 0; i < 4; i++){
      float n = vnoise(p);
      n = 1.0 - abs(n * 2.0 - 1.0); // crease
      v += a * n * n;
      p = m * p;
      a *= 0.5;
    }
    return v;
  }

  // One layer of ELEGANT THREADS: ridged flow-noise warped slowly, then read as
  // thin filaments. Returns a 0..1 "thread density" — high only on the crests of
  // the ridges, so most of the field is empty paper (sparse, not haze).
  //  scale  — layer frequency (far = low/broad, near = high/fine)
  //  flow   — slow drift through the field (no scroll dive)
  //  warpA  — how much this layer is folded
  //  sharp  — crest sharpness; higher = thinner, cleaner lines
  float threads(vec2 uv, float scale, float flow, float warpA, float sharp, vec2 disp){
    vec2 p = uv * scale;
    p += disp;                 // the cursor pushes the threads here
    p.y += flow;               // a slow drift

    // a single gentle domain warp — enough to make the threads flow, not churn.
    // (owner: "make it move slightly more" → the warp drifts a touch faster.)
    vec2 q = vec2(
      fbm(p + vec2(0.0, uTime * 0.030)),
      fbm(p + vec2(4.3, -uTime * 0.024) + 1.7)
    );
    // ridged noise → creased crests; threshold sharpens crests into thin lines
    float r = ridged(p + warpA * q);
    // remap so a slightly WIDER band survives → MORE filaments fill the field
    // (owner: "more SEEN / more present"), still thresholded so they read as
    // clean lines, NOT a haze — coverage up, contrast unchanged.
    float line = smoothstep(0.46, 0.92, r);
    return pow(line, sharp);
  }

  void main(){
    vec2 frag = gl_FragCoord.xy / uRes.xy;
    float aspect = uRes.x / uRes.y;
    vec2 uv = frag;
    uv.x *= aspect;            // square the field so warps aren't stretched

    // ---- THE CURSOR DISPLACEMENT FIELD (hero-local, no drawn circle) ----
    // distance from the eased pointer, then a soft radial push + a perpendicular
    // swirl + a velocity wake. Owner (again): "STILL reacts WAY too much" → cut
    // near to nothing. The bubble is tighter still (falloff 30 → 46) and the
    // displacement amplitude is slashed to near-negligible, so the cursor only
    // BARELY nudges the field — almost ambient-only, a faint breath, never churn.
    vec2 m = uMouse; m.x *= aspect;
    vec2 toM = uv - m;
    float dM = length(toM);
    vec2  dir = toM / max(dM, 0.0001);
    float reach = exp(-dM * dM * 46.0) * uPointer;   // even tighter bubble
    vec2 swirl = vec2(-dir.y, dir.x);
    vec2 wake  = uVel * 0.45;                         // a near-vanished wake
    // amplitude slashed again (0.16/0.10 → 0.045/0.028) — threads barely twitch
    vec2 disp = (dir * 0.045 + swirl * 0.028) * reach + wake * (reach * 0.25 + 0.004);

    // two sparse depth layers — a broad far set + a finer near set. Scaled up a
    // touch (0.72→0.64, 1.18→1.04) so the matter reads BIGGER + fills more of the
    // hero (owner: "more present / more SEEN") — bigger features, same ink. Calm
    // parallax with a touch of ambient drift kept lively.
    float t0 = threads(uv * 0.64, 1.0, uTime * 0.010, 0.30, 1.15, disp * 0.4);  // far
    float t1 = threads(uv * 1.04, 1.7, uTime * 0.016, 0.50, 1.55, disp * 0.9);  // near

    // composite — the near threads sit a touch stronger; the field is mostly the
    // empty paper between the lines (that emptiness is the point: light + sparse)
    float matter = max(t0 * 0.62, t1 * 0.82);
    matter = pow(clamp(matter, 0.0, 1.0), uContrast);

    // the cursor faintly lifts the threads it disturbs (now all-but-imperceptible)
    matter += reach * 0.008 * uPointer;

    // ---- colour: paper → thread → the cool accent tints the brightest crests
    // so the lines read as inky filaments rimmed with one blue. uInk is high on
    // light so the strokes are clearly perceptible on the white paper. ----
    vec3 col = uPaper;
    col = mix(col, uMatterLo, smoothstep(0.04, 0.55, matter) * uInk);
    col = mix(col, uMatterHi, smoothstep(0.45, 1.0, matter) * uInk);
    // the cool accent rims the densest crests + the cursor's wake (now a whisper)
    float rim = smoothstep(0.55, 1.0, matter);
    col = mix(col, mix(col, uTint, 0.7), rim * 0.4 * uInk);
    col = mix(col, mix(col, uTint, 0.5), reach * 0.015 * uInk);

    // ---- the contained scene fades at its OWN top + bottom edges so it melts
    // into the page surface instead of reading as a panel. Owner: "more SEEN" →
    // the visible band is WIDER (fade pulled to 0.09/0.91), so more of the hero
    // carries the matter — more coverage, same ink. ----
    float edge = smoothstep(0.0, 0.09, frag.y) * smoothstep(1.0, 0.91, frag.y);

    // ---- MASTER ACCENT CAP — blend the whole field back toward the paper so it
    // stays a quiet accent behind the content, never the star. ----
    float a = uAccent * edge;
    col = mix(uPaper, col, a);

    gl_FragColor = vec4(col, 1.0);
  }
`

// THEME / ROOM PALETTES — the sparse-thread field, graded per room. On LIGHT the
// ink/contrast are raised (inkier strokes on the white paper) so the filaments
// are clearly perceptible — the owner's "make it visible on white." A capped
// uAccent still keeps the whole thing a quiet accent behind the hero. `grain` is
// unused now (kept in the struct so the uniform wiring is untouched).
const PALETTE = {
  light: {
    paper: [0.969, 0.98, 0.996], // #f7fafe page floor
    matterLo: [0.58, 0.66, 0.77], // the threads' soft body
    matterHi: [0.08, 0.18, 0.34], // their inky crests — dark on white
    tint: [0.12, 0.5, 0.84],
    ink: 1.0, // STRONG ink on light → the strokes are clearly felt
    contrast: 1.35,
    grain: 0.0,
    accent: 0.82, // MORE present (owner: "more SEEN") — opacity up, contrast same
  },
  dark: {
    paper: [0.039, 0.047, 0.063], // #0a0c10 floor
    matterLo: [0.1, 0.16, 0.26],
    matterHi: [0.36, 0.58, 0.92], // bright-blue lit threads on the dark floor
    tint: [0.48, 0.7, 1.0],
    ink: 0.95,
    contrast: 1.5,
    grain: 0.0,
    accent: 0.84, // more present — opacity up, contrast unchanged
  },
  business: {
    paper: [0.039, 0.086, 0.149], // #0a1626 deep corporate floor
    matterLo: [0.07, 0.15, 0.26],
    matterHi: [0.24, 0.47, 0.78],
    tint: [0.37, 0.65, 0.96],
    ink: 0.95,
    contrast: 1.5,
    grain: 0.0,
    accent: 0.8, // more present — opacity up, contrast unchanged
  },
}

const readRoom = () =>
  typeof document !== 'undefined' &&
  document.documentElement.getAttribute('data-room') === 'business'
    ? 'business'
    : null

export default function HeroScene() {
  const hostRef = useRef(null)
  // remount the GL program when the theme flips (palette swap). The room is
  // polled cheaply on the shared tick (no room-change event exists).
  const [theme, setTheme] = useState(() => getTheme())
  useEffect(() => onThemeChange(setTheme), [])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const reduce = prefersReducedMotion() || isTouch()
    // reduced-motion / touch → the static CSS poster (set on the host in
    // hero.css); we never spin up the GL warp loop.
    if (reduce) {
      host.classList.add('sx-heroscene--poster')
      return
    }

    let renderer
    try {
      renderer = new Renderer({
        dpr: Math.min(window.devicePixelRatio || 1, 2) * 0.6, // light buffer
        alpha: false,
        antialias: false,
        powerPreference: 'high-performance',
      })
    } catch {
      host.classList.add('sx-heroscene--poster') // no WebGL — the poster shows
      return
    }

    const gl = renderer.gl
    host.appendChild(gl.canvas)
    gl.canvas.className = 'sx-heroscene__canvas'

    const pickPalette = () => PALETTE[readRoom() || theme] || PALETTE.light
    let pal = pickPalette()
    gl.clearColor(pal.paper[0], pal.paper[1], pal.paper[2], 1)

    const res = new Vec2(1, 1)
    const mouse = new Vec2(0.5, 0.5) // eased pointer (hero-local 0..1)
    const targetMouse = new Vec2(0.5, 0.5)
    const vel = new Vec2(0, 0) // eased velocity (the wake)

    const program = new Program(gl, {
      vertex: VERT,
      fragment: FRAG,
      uniforms: {
        uTime: { value: 0 },
        uRes: { value: res },
        uMouse: { value: mouse },
        uVel: { value: vel },
        uPointer: { value: 0 }, // ramps to 1 on first move over the hero
        uPaper: { value: new Vec3(...pal.paper) },
        uMatterLo: { value: new Vec3(...pal.matterLo) },
        uMatterHi: { value: new Vec3(...pal.matterHi) },
        uTint: { value: new Vec3(...pal.tint) },
        uInk: { value: pal.ink },
        uContrast: { value: pal.contrast },
        uGrain: { value: pal.grain },
        uAccent: { value: pal.accent },
      },
    })
    const mesh = new Mesh(gl, { geometry: new Triangle(gl), program })

    // apply a palette to the live uniforms (room flips, no remount)
    const applyPalette = p => {
      program.uniforms.uPaper.value.set(...p.paper)
      program.uniforms.uMatterLo.value.set(...p.matterLo)
      program.uniforms.uMatterHi.value.set(...p.matterHi)
      program.uniforms.uTint.value.set(...p.tint)
      program.uniforms.uInk.value = p.ink
      program.uniforms.uContrast.value = p.contrast
      program.uniforms.uGrain.value = p.grain
      program.uniforms.uAccent.value = p.accent
      gl.clearColor(p.paper[0], p.paper[1], p.paper[2], 1)
    }

    // the host's live rect — pointer math maps into THIS box (hero-local), and
    // the buffer sizes to the hero, never the window.
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
    const onMove = e => {
      // map the pointer into hero-local 0..1 (clamped) so the disturbance only
      // lives within the hero bounds — outside it the pointer just rests.
      const nx = (e.clientX - rect.left) / Math.max(rect.width, 1)
      const ny = 1 - (e.clientY - rect.top) / Math.max(rect.height, 1) // GL y-up
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

    // pause the loop when the hero scrolls off-screen (cheap-safe)
    let onscreen = true
    const io = new IntersectionObserver(
      entries => {
        for (const e of entries) onscreen = e.isIntersecting
        // keep the rect fresh after layout shifts re-cross the threshold
        rect = host.getBoundingClientRect()
      },
      { threshold: 0 },
    )
    io.observe(host)

    let pointer = 0
    let lastRoom = readRoom()
    let roomCheck = 0
    const off = onTick(elapsed => {
      if (!onscreen) return // skip rendering while the hero is scrolled away
      // cheap room poll (every ~12 frames) — swap palette live, no remount
      if (++roomCheck >= 12) {
        roomCheck = 0
        const r = readRoom()
        if (r !== lastRoom) {
          lastRoom = r
          pal = pickPalette()
          applyPalette(pal)
        }
      }
      // ease the pointer + decay the wake (no jitter, no screensaver)
      mouse.x += (targetMouse.x - mouse.x) * 0.07
      mouse.y += (targetMouse.y - mouse.y) * 0.07
      vel.x *= 0.86
      vel.y *= 0.86
      pointer += ((moved ? 1 : 0) - pointer) * 0.05
      program.uniforms.uPointer.value = pointer
      program.uniforms.uTime.value = elapsed
      renderer.render({ scene: mesh })
    })

    return () => {
      off()
      io.disconnect()
      window.removeEventListener('resize', resize)
      window.removeEventListener('pointermove', onMove)
      const ext = gl.getExtension('WEBGL_lose_context')
      if (ext) ext.loseContext()
      if (gl.canvas.parentNode === host) host.removeChild(gl.canvas)
    }
  }, [theme])

  return <div className="sx-heroscene" ref={hostRef} aria-hidden="true" />
}
