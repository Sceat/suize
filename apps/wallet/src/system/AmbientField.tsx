/**
 * AmbientField — the lightweight Canvas2D ambient background (replaces OGL).
 *
 * Ported from the design's `#current` canvas (DESIGN.md §5):
 *   light = 4 horizontal sine "water" bands drifting slowly
 *   dark  = upward-drifting ice particles + a soft pulsing radial glow
 *
 * Plus the `.amb-top` radial wash (top 46vh, mix-blend per theme) and the
 * dark-only `.vignette`. Rendered behind everything at z-index 0.
 *
 * Re-seeds on theme change via useTheme() (we own the toggle, so no
 * MutationObserver). Pauses on tab-hidden and prefers-reduced-motion. No ogl.
 */
import { useEffect, useRef, type CSSProperties } from 'react';
import { useTheme } from './theme';

interface Particle {
  x: number;
  y: number;
  r: number;
  vy: number;
  vx: number;
  a: number;
  ph: number;
}

export function AmbientField() {
  const { theme } = useTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // theme is read inside the RAF loop via a ref so we never restart the loop.
  const themeRef = useRef(theme);
  themeRef.current = theme;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const reduce =
      typeof matchMedia !== 'undefined' &&
      matchMedia('(prefers-reduced-motion: reduce)').matches;

    let w = 0;
    let h = 0;
    let t = 0;
    let raf = 0;
    let running = true;
    let parts: Particle[] = [];

    const seed = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const n = reduce ? 0 : Math.min(42, Math.floor(w / 34));
      parts = [];
      for (let i = 0; i < n; i++) {
        parts.push({
          x: Math.random() * w,
          y: Math.random() * h,
          r: Math.random() * 1.1 + 0.3,
          vy: -(Math.random() * 0.12 + 0.03),
          vx: (Math.random() - 0.5) * 0.04,
          a: Math.random() * 0.5 + 0.12,
          ph: Math.random() * Math.PI * 2,
        });
      }
    };

    const frame = () => {
      ctx.clearRect(0, 0, w, h);
      if (themeRef.current === 'dark') {
        // upward ice particles + a soft pulsing radial glow.
        t += 0.004;
        const cx = 0.42 * w;
        const cy = 0.3 * h;
        const R = Math.max(w, h) * 0.55;
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
        const puls = 0.05 + Math.sin(t) * 0.018;
        // dark accent = ORANGE-GOLD (warm amber current, not ice-blue).
        g.addColorStop(0, `rgba(240,198,116,${puls})`);
        g.addColorStop(0.5, `rgba(160,110,30,${puls * 0.4})`);
        g.addColorStop(1, 'rgba(4,7,14,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
        for (const p of parts) {
          p.x += p.vx;
          p.y += p.vy;
          p.ph += 0.008;
          if (p.y < -8) {
            p.y = h + 8;
            p.x = Math.random() * w;
          }
          if (p.x < -8) p.x = w + 8;
          if (p.x > w + 8) p.x = -8;
          const tw = 0.6 + Math.sin(p.ph) * 0.4;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
          // warm gold motes (was icy blue-white).
          ctx.fillStyle = `rgba(243,217,160,${p.a * tw * 0.5})`;
          ctx.fill();
        }
      } else {
        // horizontal sine "water" bands.
        const bands = 4;
        for (let b = 0; b < bands; b++) {
          ctx.beginPath();
          const baseY = h * (0.62 + b * 0.09);
          const amp = 6 + b * 3;
          const k = 0.012 + b * 0.002;
          const sp = 0.00038 + b * 0.00016;
          ctx.moveTo(0, baseY);
          for (let x = 0; x <= w; x += 8) {
            const y =
              baseY +
              Math.sin(x * k + t * sp + b) * amp +
              Math.sin(x * k * 0.5 - t * sp * 1.3) * amp * 0.5;
            ctx.lineTo(x, y);
          }
          ctx.strokeStyle = `rgba(122,196,255,${0.1 - b * 0.018})`;
          ctx.lineWidth = 1;
          ctx.stroke();
        }
        t += 16;
      }
      if (running && !reduce) raf = requestAnimationFrame(frame);
    };

    seed();
    if (reduce) {
      // draw a single static frame, then stop.
      running = false;
      ctx.clearRect(0, 0, w, h);
    } else {
      raf = requestAnimationFrame(frame);
    }

    const onResize = () => seed();
    const onVisibility = () => {
      running = !document.hidden && !reduce;
      if (running) {
        raf = requestAnimationFrame(frame);
      } else {
        cancelAnimationFrame(raf);
      }
    };
    window.addEventListener('resize', onResize);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', onVisibility);
    };
    // re-run (re-seed) whenever the theme flips so band/particle counts reset cleanly.
  }, [theme]);

  const layer: CSSProperties = {
    position: 'fixed',
    inset: 0,
    pointerEvents: 'none',
    zIndex: 0,
  };

  return (
    <>
      {/* top radial wash */}
      <div
        aria-hidden
        style={{
          ...layer,
          inset: '0 0 auto 0',
          height: '46vh',
          background:
            'radial-gradient(120% 90% at 78% -25%, var(--amb-a), transparent 60%), radial-gradient(90% 70% at 12% -30%, var(--amb-b), transparent 62%)',
          mixBlendMode: 'var(--amb-blend)' as CSSProperties['mixBlendMode'],
          opacity: 0.9,
          transition: 'opacity var(--d-swap) var(--e-quart)',
        }}
      />
      {/* dark-only vignette (top + bottom blue glows; opacity 0 in light) */}
      <div
        aria-hidden
        style={{
          ...layer,
          background:
            'radial-gradient(70% 50% at 50% -10%, rgba(240,198,116,.05), transparent 60%), radial-gradient(80% 60% at 50% 115%, rgba(160,110,30,.07), transparent 62%)',
          opacity: theme === 'dark' ? 1 : 0,
          transition: 'opacity var(--d-swap) var(--e-quart)',
        }}
      />
      {/* the animated current canvas */}
      <canvas
        ref={canvasRef}
        aria-hidden
        style={{
          ...layer,
          width: '100%',
          height: '100%',
          opacity: theme === 'dark' ? 0.55 : 0.5,
          transition: 'opacity var(--d-swap) var(--e-quart)',
        }}
      />
    </>
  );
}
