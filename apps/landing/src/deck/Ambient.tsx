import { useEffect, useRef } from 'react';

/**
 * The light field — SMOOTH and slow. Soft drifting pools of light + one broad
 * diagonal raking sweep over a gentle perspective gradient (deeper low, paler
 * toward a high horizon). NOTHING high-frequency animates: the grain is a
 * STATIC overlay (CSS .grain / panel ::after) — only the light moves through
 * it. No per-pixel time noise → no TV-static flicker. Reduced-motion → static.
 */

// per-deck water: [_, intensity, depth/darkness]
const TINTS: Record<number, [number, number, number]> = {
  1: [0, 1.0, 0.16],
  2: [0, 1.1, 0.32],
  3: [0, 0.9, 0.2],
};

const VERT = `attribute vec2 a; void main(){ gl_Position = vec4(a, 0.0, 1.0); }`;

const FRAG = `
precision highp float;
uniform vec2  u_res;
uniform float u_time;
uniform vec2  u_mouse;
uniform float u_intensity;
uniform float u_depth;

const vec3 PAPER = vec3(0.967, 0.978, 0.994);
const vec3 FAR   = vec3(0.799, 0.867, 0.952);
const vec3 LIGHT = vec3(0.995, 0.998, 1.000);
const vec3 DEEP  = vec3(0.690, 0.792, 0.918);

float hash(vec2 p){ p = fract(p * vec2(123.34, 345.45)); p += dot(p, p + 34.345); return fract(p.x * p.y); }
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  float a = hash(i), b = hash(i + vec2(1.0, 0.0)), c = hash(i + vec2(0.0, 1.0)), d = hash(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fbm(vec2 p){ float v = 0.0, a = 0.5; for(int i = 0; i < 3; i++){ v += a * vnoise(p); p *= 2.0; a *= 0.5; } return v; }

// STATIC ordered dither — depends only on pixel position, never on time.
float Bayer2(vec2 a){ a = floor(a); return fract(a.x / 2.0 + a.y * a.y * 0.75); }
#define Bayer4(a) (Bayer2(0.5 * (a)) * 0.25 + Bayer2(a))
#define Bayer8(a) (Bayer4(0.5 * (a)) * 0.25 + Bayer2(a))

void main(){
  vec2 uv = gl_FragCoord.xy / u_res.xy;          // y up, 0 = bottom
  float aspect = u_res.x / u_res.y;
  vec2 p = vec2((uv.x - 0.5) * aspect, uv.y - 0.5);
  float t = u_time * 0.028;                        // slow

  // two slow organic fields (low freq) — light filtering, like water on a floor
  float a1 = fbm(p * 1.25 + vec2(t, -t * 0.55));
  float a2 = fbm(p * 2.1 - vec2(t * 0.7, t * 0.4) + 9.0);
  float organic = a1 * 0.62 + a2 * 0.38;

  // perspective base: deeper low, paler + bluer toward a high horizon
  vec3 base = mix(DEEP, PAPER, smoothstep(-0.05, 0.6, uv.y + (a1 - 0.5) * 0.16));
  base = mix(base, FAR, smoothstep(0.55, 1.0, uv.y) * 0.55);

  // two big soft drifting light pools
  vec2 c1 = vec2((0.30 - 0.5) * aspect + sin(t * 0.6) * 0.10, 0.36 + cos(t * 0.45) * 0.06);
  vec2 c2 = vec2((0.74 - 0.5) * aspect + cos(t * 0.5) * 0.10, -0.12 + sin(t * 0.55) * 0.07);
  float l1 = smoothstep(0.58, 0.0, distance(p, c1) + (a1 - 0.5) * 0.10);
  float l2 = smoothstep(0.64, 0.0, distance(p, c2) + (a2 - 0.5) * 0.08);

  // a broad diagonal raking sweep, drifting slowly
  float diag = uv.x * 0.7 + (1.0 - uv.y) * 0.55;
  float sweepPos = 0.46 + 0.34 * sin(t * 0.5) + (a1 - 0.5) * 0.28;
  float sweep = smoothstep(0.34, 0.0, abs(diag - sweepPos));

  // soft slow caustic-like shimmer (smooth — no flicker), the underwater light
  float shimmer = smoothstep(0.56, 0.96, organic);

  float light = clamp(l1 * 0.55 + l2 * 0.48 + sweep * 0.42 + shimmer * 0.5, 0.0, 1.0) * u_intensity;
  vec3 col = mix(base, LIGHT, light);
  // deepen the troughs for dimensional contrast
  col = mix(col, DEEP, smoothstep(0.4, 0.0, organic) * 0.13);

  // cursor lifts a soft local glow
  vec2 m = vec2((u_mouse.x - 0.5) * aspect, u_mouse.y - 0.5);
  col = mix(col, LIGHT, smoothstep(0.42, 0.0, distance(p, m)) * 0.06);

  // deepen the periphery + per-deck depth
  float vig = smoothstep(1.15, 0.22, length(p));
  col *= mix(0.92, 1.0, vig);
  col = mix(col, DEEP, u_depth * 0.32 * (1.0 - uv.y));

  // static dither only — anti-banding, no flicker
  col += (Bayer8(gl_FragCoord.xy) - 0.5) * (1.0 / 90.0);
  col = clamp(col, 0.0, 1.0);
  gl_FragColor = vec4(col, 1.0);
}
`;

function compile(gl: WebGLRenderingContext, type: number, src: string) {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    gl.deleteShader(sh);
    return null;
  }
  return sh;
}

export function Ambient({ variant = 1 }: { variant?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const tint = useRef<[number, number, number]>(TINTS[variant] ?? TINTS[1]);

  useEffect(() => {
    tint.current = TINTS[variant] ?? TINTS[1];
  }, [variant]);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const gl = (canvas.getContext('webgl', { antialias: false, alpha: false }) ||
      canvas.getContext('experimental-webgl', { antialias: false, alpha: false })) as WebGLRenderingContext | null;
    if (!gl) return;

    const vs = compile(gl, gl.VERTEX_SHADER, VERT);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
    if (!vs || !fs) return;
    const prog = gl.createProgram()!;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return;
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'a');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    const uRes = gl.getUniformLocation(prog, 'u_res');
    const uTime = gl.getUniformLocation(prog, 'u_time');
    const uMouse = gl.getUniformLocation(prog, 'u_mouse');
    const uInten = gl.getUniformLocation(prog, 'u_intensity');
    const uDepth = gl.getUniformLocation(prog, 'u_depth');

    const dpr = Math.min(window.devicePixelRatio || 1, 1.3);
    const resize = () => {
      const w = Math.floor(window.innerWidth * dpr);
      const h = Math.floor(window.innerHeight * dpr);
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      gl.viewport(0, 0, w, h);
      gl.uniform2f(uRes, w, h);
    };
    resize();
    window.addEventListener('resize', resize);

    const mouse = { x: 0.5, y: 0.6, tx: 0.5, ty: 0.6 };
    const onMove = (e: PointerEvent) => {
      mouse.tx = e.clientX / window.innerWidth;
      mouse.ty = 1 - e.clientY / window.innerHeight;
    };
    window.addEventListener('pointermove', onMove, { passive: true });

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const start = performance.now();
    let raf = 0;
    let running = true;
    const frame = (now: number) => {
      mouse.x += (mouse.tx - mouse.x) * 0.04;
      mouse.y += (mouse.ty - mouse.y) * 0.04;
      const [, inten, depth] = tint.current;
      gl.uniform1f(uTime, reduced ? 12 : (now - start) / 1000);
      gl.uniform2f(uMouse, mouse.x, mouse.y);
      gl.uniform1f(uInten, inten);
      gl.uniform1f(uDepth, depth);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      if (reduced) return;
      if (running) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    const onVis = () => {
      running = !document.hidden;
      if (running && !reduced) raf = requestAnimationFrame(frame);
    };
    document.addEventListener('visibilitychange', onVis);

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      window.removeEventListener('pointermove', onMove);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);

  return <canvas ref={ref} className="amb-canvas" aria-hidden="true" />;
}
