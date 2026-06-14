/* ==========================================================================
   CrashBase — the SHARED LIGHT EDITORIAL background + chart, ported VERBATIM
   from design-lab-v3/base.js. The ONLY change vs the original is the DATA
   SOURCE: instead of subscribing to window.CrashStub for the live price +
   strike, it reads them from a host object handed in at mount:

       const base = mount(root, opts, host)
       // host.data.spot   — live spot price (plain USD)
       // host.data.strike — the round entry/strike line (plain USD)
       // host.data.chartSamples — rolling spot history (plain USD, live ref)
       // host.data.chartSide — 'UP' | 'DOWN' | null (held-bet tint + label)

   The canvas drawing technique (Catmull-Rom spline, dual-stroke, blue under-
   fill, the 3 live-price devices, ambient bubbles, the master rAF + easing)
   is transcribed UNCHANGED — that fidelity is exactly why the prototype looks
   right. `breathe/setSide/clearSide/updateHistory/teardown` are preserved.
   ========================================================================== */
import type { CrashHost } from './crash-host'
import { fetch_btc_history } from './api'
import { fmt_usd_amount } from './format'

type BaseOpts = {
  dprCap?: number
  maxBubbles?: number
  ambientSpawnMs?: number
  chartTopFrac?: number
  chartHeightFrac?: number
  rightFrac?: number
  showMarker?: boolean
  showStrike?: boolean
  side?: 'UP' | 'DOWN' | null
}

export type BaseHandle = {
  breathe: (dir: 'UP' | 'DOWN' | 1 | -1 | null) => void
  setSide: (s: 'UP' | 'DOWN' | null) => void
  clearSide: () => void
  updateHistory: (h: number[]) => void
  teardown: () => void
}

// ---- small helpers ----------------------------------------------------
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t
const clamp = (v: number, lo: number, hi: number): number =>
  v < lo ? lo : v > hi ? hi : v
// Chart price tag / strike label / hi-lo markers — under the ONE money rule
// (>= $10 -> whole + thousands separators "$66,252"; < $10 -> 1 decimal). BTC
// prices are always >= $10 so this reads "$66,252", never 2 decimals.
const fmtUsd = (n: number): string => fmt_usd_amount(n)

// parse "#rrggbb" -> [r,g,b] for rgba() interpolation.
function hexToRgb(hex: string): [number, number, number] {
  const h = String(hex).replace('#', '').trim()
  const n =
    h.length === 3
      ? h
          .split('')
          .map(c => c + c)
          .join('')
      : h
  const int = parseInt(n, 16)
  if (isNaN(int)) return [10, 27, 46]
  return [(int >> 16) & 255, (int >> 8) & 255, int & 255]
}
const mixRgb = (
  a: [number, number, number],
  b: [number, number, number],
  t: number,
): [number, number, number] => [
  Math.round(lerp(a[0], b[0], t)),
  Math.round(lerp(a[1], b[1], t)),
  Math.round(lerp(a[2], b[2], t)),
]

// =========================================================================
//  THEME-AWARE PALETTES — the chart owns its own colours (NOT styles.css) so
//  flipping the dark-theme toggle updates the canvas live. We define BOTH a
//  light and a dark set internally and pick one by reading
//  document.documentElement.dataset.theme ('dark' => dark, else light) on a
//  cheap interval, so a theme flip re-tints the line/fill/labels at runtime.
//  The light set mirrors the old styles.css tokens 1:1 (no visual change for
//  the default theme); the dark set uses darker paper + lighter ink lines.
// =========================================================================
type Palette = {
  ink: [number, number, number] // line @ neutral + strike + labels
  bull: [number, number, number] // winning tint target
  bear: [number, number, number] // losing tint target
  blue: [number, number, number] // under-area fill
  blueBright: [number, number, number] // marker ring + ice bubbles
  paperRgb: string // tag background base "r,g,b"
  hairRgb: string // tag border base "r,g,b"
  inkLabelRgb: string // explicit label colour "r,g,b" (independent of mix)
  markerCore: string // current-price dot fill
  fillTop: number // under-area fill top alpha
}

// LIGHT — 1:1 with the previous :root tokens.
const PALETTE_LIGHT: Palette = {
  ink: hexToRgb('#0a1b2e'),
  bull: hexToRgb('#149a64'),
  bear: hexToRgb('#d8463b'),
  blue: hexToRgb('#1e7fd6'),
  blueBright: hexToRgb('#4da2ff'),
  paperRgb: '251,252,254',
  hairRgb: '10,27,46',
  inkLabelRgb: '10,27,46',
  markerCore: '#ffffff',
  fillTop: 0.11,
}

// DARK — darker paper, lighter ink line, slightly punchier accents so the
// curve reads against a dark stage. Bull/bear lifted for contrast on dark.
const PALETTE_DARK: Palette = {
  ink: hexToRgb('#cfe0f2'), // light ink line on dark
  bull: hexToRgb('#3fd99a'),
  bear: hexToRgb('#ff6b5e'),
  blue: hexToRgb('#4da2ff'),
  blueBright: hexToRgb('#82c0ff'),
  paperRgb: '16,24,38', // dark tag fill
  hairRgb: '160,190,220', // light tag border
  inkLabelRgb: '207,224,242', // light labels
  markerCore: '#0a1320', // dark dot core on dark
  fillTop: 0.16,
}

// Read the active theme off the document root. 'dark' => dark palette,
// anything else (incl. unset/'light') => light. Cheap; safe to call often.
function currentPalette(): Palette {
  try {
    return document.documentElement.dataset.theme === 'dark'
      ? PALETTE_DARK
      : PALETTE_LIGHT
  } catch {
    return PALETTE_LIGHT
  }
}

// =========================================================================
//  CATMULL-ROM (low-tension) spline — ANGULAR price line, no lib.
//  Pushes cubic-sampled points into out[] as flat [x,y, x,y, ...].
//  "MOUNTAINS, NOT DUNES": at the canonical tension (0.5) the tangents
//  overshoot each real sample and ROUND the tick-to-tick breaks into soft
//  humps. We run a VERY LOW tension (0.06) so the curve stays glued to the
//  real samples — each break is preserved as a sharp peak/valley — while a
//  light cubic sampling keeps the head ease fluid (no stair-stepping). The
//  REAL Binance history plots through the SAME function as the live ticks, so
//  the whole curve is uniformly jagged (no smoother fake backdrop).
// =========================================================================
function catmullRom(
  xs: number[],
  ys: number[],
  out: number[],
  step: number,
): number[] {
  out.length = 0
  const n = xs.length
  if (n < 2) return out
  out.push(xs[0], ys[0])
  // LOW tension preserves the real up/down breaks (angular). 0.5 = rounded
  // canonical Catmull-Rom (the old "dunes"); 0.06 ≈ near-linear with the
  // corners intact — a real TradingView-style price line.
  const tension = 0.06
  for (let i = 0; i < n - 1; i++) {
    const p0x = xs[i === 0 ? 0 : i - 1]
    const p0y = ys[i === 0 ? 0 : i - 1]
    const p1x = xs[i]
    const p1y = ys[i]
    const p2x = xs[i + 1]
    const p2y = ys[i + 1]
    const p3x = xs[i + 2 < n ? i + 2 : n - 1]
    const p3y = ys[i + 2 < n ? i + 2 : n - 1]
    const t1x = (p2x - p0x) * tension
    const t1y = (p2y - p0y) * tension
    const t2x = (p3x - p1x) * tension
    const t2y = (p3y - p1y) * tension
    for (let s = step; s <= 1.0001; s += step) {
      const t = s > 1 ? 1 : s
      const t2 = t * t
      const t3 = t2 * t
      const h1 = 2 * t3 - 3 * t2 + 1
      const h2 = -2 * t3 + 3 * t2
      const h3 = t3 - 2 * t2 + t
      const h4 = t3 - t2
      out.push(
        h1 * p1x + h2 * p2x + h3 * t1x + h4 * t2x,
        h1 * p1y + h2 * p2y + h3 * t1y + h4 * t2y,
      )
    }
  }
  return out
}

// =========================================================================
//  PUBLIC: mount(root, opts, host) -> handle
// =========================================================================
export function mount(
  root: HTMLElement,
  opts: BaseOpts,
  host: CrashHost,
): BaseHandle {
  opts = opts || {}
  const reduceMotion =
    window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches

  // ---- tunables (perf budget) -----------------------------------------
  const dprCap = opts.dprCap != null ? opts.dprCap : 1.5
  // ambient blue-ice bubble drizzle — a flourish, not a system. Capped low.
  const MAX_BUBBLES = clamp(opts.maxBubbles != null ? opts.maxBubbles : 14, 0, 24)
  const ambientSpawnMs = opts.ambientSpawnMs != null ? opts.ambientSpawnMs : 1100
  // where the chart band sits (0..1 of stage height) and how tall it is.
  const bandTopFrac = opts.chartTopFrac != null ? opts.chartTopFrac : 0.34
  const bandHeightFrac =
    opts.chartHeightFrac != null ? opts.chartHeightFrac : 0.32
  // how far right the leading edge sits (room for the marker + tag).
  const rightFrac = opts.rightFrac != null ? opts.rightFrac : 0.9
  // show the live-price DOM marker + gliding price tag? (default on)
  const showMarker = opts.showMarker !== false
  // show the dashed STRIKE/ENTRY reference line + label? (default on)
  const showStrike = opts.showStrike !== false

  // THEME-AWARE palette — owned by the chart, re-read each frame so flipping
  // the dark-theme toggle re-tints the canvas live (see currentPalette + the
  // frame() refresh). `pal` is the active set; the C_* aliases below are
  // reassigned each frame from it, so the draw code reads the live colours.
  let pal = currentPalette()
  let C_INK = pal.ink
  let C_BULL = pal.bull
  let C_BEAR = pal.bear
  let C_BLUE = pal.blue
  let C_BLUE_BRIGHT = pal.blueBright

  // =====================================================================
  //  DOM: faint backdrop layer (z0) + chart canvas (z1) + marker (z2).
  // =====================================================================
  const backdrop = document.createElement('div')
  backdrop.className = 'crashbase-backdrop'
  backdrop.setAttribute('aria-hidden', 'true')
  backdrop.style.cssText =
    'position:absolute;inset:0;z-index:0;pointer-events:none;' +
    'background:' +
    'repeating-linear-gradient(135deg,' +
    'rgba(10,27,46,0.018) 0px,rgba(10,27,46,0.018) 1px,' +
    'transparent 1px,transparent 4px);'

  // (2) the chart canvas (the hero)
  const chart = document.createElement('canvas')
  chart.className = 'crashbase-chart'
  chart.setAttribute('aria-hidden', 'true')
  chart.style.cssText =
    'position:absolute;inset:0;display:block;z-index:1;pointer-events:none;'

  root.append(backdrop, chart)

  // (3) DOM current-price marker + gliding price tag — CSS-transform gliders.
  let marker: HTMLDivElement | null = null
  let priceTag: HTMLDivElement | null = null
  if (showMarker) {
    marker = document.createElement('div')
    marker.className = 'crashbase-marker'
    marker.setAttribute('aria-hidden', 'true')
    marker.style.cssText =
      'position:absolute;left:0;top:0;width:12px;height:12px;border-radius:50%;' +
      'z-index:2;pointer-events:none;will-change:transform;' +
      'background:' +
      pal.markerCore +
      ';' +
      'border:2px solid ' +
      ('rgb(' + C_BLUE_BRIGHT.join(',') + ')') +
      ';' +
      'box-shadow:0 0 0 3px rgba(30,127,214,0.16),0 1px 3px rgba(10,27,46,0.18);' +
      'transform:translate3d(-100px,-100px,0);' +
      (reduceMotion
        ? ''
        : 'transition:transform 350ms cubic-bezier(0.2,0.8,0.2,1),box-shadow 300ms ease;')
    priceTag = document.createElement('div')
    priceTag.className = 'crashbase-pricetag tnum'
    priceTag.setAttribute('aria-hidden', 'true')
    priceTag.style.cssText =
      'position:absolute;left:0;top:0;z-index:2;pointer-events:none;' +
      'font-family:var(--mono,monospace);font-size:12px;font-weight:600;' +
      'font-variant-numeric:tabular-nums;letter-spacing:-0.01em;white-space:nowrap;' +
      'padding:2px 6px;color:rgb(' +
      pal.inkLabelRgb +
      ');' +
      'background:rgba(' +
      pal.paperRgb +
      ',0.92);' +
      'border:1px solid rgba(' +
      pal.hairRgb +
      ',0.2);border-radius:2px;' +
      'box-shadow:0 1px 4px rgba(10,27,46,0.08);will-change:transform;' +
      'transform:translate3d(-200px,-100px,0);' +
      (reduceMotion
        ? ''
        : 'transition:transform 350ms cubic-bezier(0.2,0.8,0.2,1);')
    root.append(marker, priceTag)
  }

  // =====================================================================
  //  STATE BUS — the live price + strike, read from the host each frame.
  //  The chart RAF eases between samples (smoothing, not invention).
  // =====================================================================
  let livePrice = 0 // newest sampled price (the REAL spot target)
  let displayPrice = 0 // eased newest sample (tweens toward livePrice @60fps)
  let strike = 0 // the round strike (entry reference line)
  let side: 'UP' | 'DOWN' | null = opts.side || null // held-bet side (label + tint)
  // The AUTHORITATIVE win/lose verdict for the line tint, read from the host each
  // frame. It is the SAME source the cash-out card uses (live bid-vs-cost P&L, or
  // the settlement verdict once settled), so the line and the card ALWAYS agree
  // (Bug 2). null => no bet held / not yet quoteable => neutral 50/50 tint.
  let winning: boolean | null = null

  // ---------------------------------------------------------------------
  //  SAMPLE BUFFER — the REAL timestamped price history (the line's truth).
  // ---------------------------------------------------------------------
  //  We plot a Catmull-Rom spline DIRECTLY through real samples in screen space
  //  — the spline smooths between them. The buffer is filled with REAL Binance
  //  BTC/USDT 1-minute history on load (genuine mountainous past), then the live
  //  oracle spot is appended at the head. The rightmost live point is the EASED
  //  `displayPrice`, which tweens toward the latest real spot @60fps, so the head
  //  GLIDES across the poll gap (no stepping). NOTHING here is invented: if the
  //  Binance fetch fails we start sparse and accumulate live ticks only.
  //
  //  TIME BASE: the frame loop maps wall-clock to x using performance.now(). The
  //  Binance points carry EPOCH ms (Date.now()), so we shift them onto the
  //  performance timeline once (perfEpochOffset = performance.now() - Date.now())
  //  so history and live ticks share ONE axis and blend seamlessly.
  type Sample = { t: number; p: number } // performance-time ms + price (plain USD)
  const samples: Sample[] = [] // the real history (oldest -> newest)
  const SAMPLE_MAX = 400 // cap the buffer; we clip to the visible window anyway
  // WIDE visible window: ~60 min of real history so the user can read patterns
  // and the curve scrolls SLOWLY (was 90s ≈ a fast TradingView 1-min feel —
  // ~40x slower now). A Binance fetch of 180×1m klines (180 min) fills the whole
  // window on load with real past, with headroom as live ticks scroll it left.
  //
  // ZOOM: the window is now LIVE (not const). The wheel handler / +- buttons set
  // `windowTarget` within [WINDOW_MIN_MS, WINDOW_MAX_MS]; the frame loop EASES
  // `windowMs` toward it so the axis pans smoothly instead of snapping. The
  // sample buffer is always trimmed to WINDOW_MAX_MS (the widest possible view)
  // so zooming back out never reveals dropped history; drawChart clips to the
  // live `windowMs` for display + auto-scale.
  const WINDOW_MIN_MS = 5 * 60_000 // 300,000 ms (5 min) — most zoomed-in
  const WINDOW_MAX_MS = 60 * 60_000 // 3,600,000 ms (60 min) — most zoomed-out
  let windowMs = WINDOW_MAX_MS // live (eased) visible window
  let windowTarget = WINDOW_MAX_MS // wheel/button target the frame loop eases to

  // HIGH/LOW markers only show when the extreme is this far (fraction of price)
  // from the current price — keeps a tight range from cluttering near the tag.
  // 0.0008 ≈ 0.08% (≈ $55 at $68k BTC), within the asked ~0.05–0.1% band.
  const HILO_THRESHOLD = 0.0008
  const perfEpochOffset = performance.now() - Date.now() // epoch -> perf time

  // ---------------------------------------------------------------------
  //  VISIBLE CLOCK — the chart's time axis advances ONLY while the page is
  //  actually painting. requestAnimationFrame PAUSES while the tab is hidden
  //  (and is heavily throttled when backgrounded / the machine sleeps), so two
  //  consecutive rAF timestamps can be MINUTES apart. The old code fed that raw
  //  leap straight into the x-axis, which (a) scrolled the head minutes to the
  //  right of the last real sample — the line looked stranded / half-gone — and
  //  (b) tripped pushSample()'s `t < now - WINDOW_MAX_MS` trim, DELETING the
  //  whole history, so on return only the post-return ticks showed and a refresh
  //  was required. Fix: any inter-frame gap beyond FRAME_GAP_CAP is treated as
  //  paused time and folded into `hiddenMs`. `chartNow()` (= perf − hiddenMs)
  //  then advances at real time WHILE frames flow and freezes across any stall,
  //  so the full line survives and the head reconnects seamlessly on return.
  let hiddenMs = 0 // total paused (hidden/throttled/slept) ms, excluded from the axis
  let rawLast = performance.now() // last raw rAF timestamp (gap detector; owned by frame())
  const FRAME_GAP_CAP = 500 // ms; a gap beyond this is paused time, not real time
  const chartNow = (): number => performance.now() - hiddenMs

  let historyLoaded = false // real Binance history has been merged in
  let lastSampleP = 0 // de-dup: only append a sample when the real spot changes

  // Append a REAL sample when the host's spot actually changes (poll cadence is
  // host-owned; we never poll here). Drop points older than the window.
  function pushSample(p: number, now: number): void {
    if (p === lastSampleP) return
    lastSampleP = p
    samples.push({ t: now, p })
    // trim to the WIDEST window so zooming back out always has real history.
    const cutoff = now - WINDOW_MAX_MS
    while (samples.length > 2 && samples[0].t < cutoff) samples.shift()
    while (samples.length > SAMPLE_MAX) samples.shift()
  }

  // Merge REAL Binance history into the buffer (called once when the fetch
  // resolves). Points are shifted onto the performance timeline and any that are
  // older than the visible window are dropped. We splice history in FRONT of
  // whatever live ticks already accumulated during the fetch, so the live head
  // sits cleanly on the real-history tail. NEVER called with fake data — an
  // empty result (fetch failed) simply leaves the buffer to live ticks.
  function mergeHistory(points: { t: number; p: number }[], now: number): void {
    if (historyLoaded) return
    historyLoaded = true
    if (!points.length) return
    const cutoff = now - WINDOW_MAX_MS
    const hist: Sample[] = []
    for (const { t, p } of points) {
      const pt = t + perfEpochOffset // epoch ms -> performance ms
      if (pt < cutoff) continue
      hist.push({ t: pt, p })
    }
    if (!hist.length) return
    // keep only live ticks that are NEWER than the newest history point, then
    // prepend the real history so the timeline stays strictly increasing.
    const histEnd = hist[hist.length - 1].t
    const liveTail = samples.filter(s => s.t > histEnd)
    samples.length = 0
    samples.push(...hist, ...liveTail)
    while (samples.length > SAMPLE_MAX) samples.shift()
  }

  // The chart head FREEZES while the round is validating/frozen (App holds the
  // host spot at its round-end value during the settlement window). We mirror the
  // flag here so the head ALSO stops EASING toward it (the eased displayPrice +
  // the rolling sample buffer hold their last point) — nothing on the chart moves
  // until the next round goes active and App clears the flag. Read live each frame.
  let frozen = false

  function readHost(now: number): void {
    const d = host.data
    frozen = Boolean(d.frozen)
    const hostSamples = d.chartSamples
    if (d.spot != null) {
      livePrice = d.spot
      if (displayPrice === 0) displayPrice = d.spot
    } else if (hostSamples && hostSamples.length) {
      livePrice = hostSamples[hostSamples.length - 1]
      if (displayPrice === 0) displayPrice = livePrice
    }
    strike = d.strike != null ? d.strike : strike
    side = d.chartSide
    winning = d.chartWinning
    // accumulate REAL live ticks (no seeding — empty until history or a tick).
    // While frozen we STOP appending samples so the line head holds still (the
    // last point stays put rather than extending with held-flat ticks).
    if (livePrice > 0 && !frozen) pushSample(livePrice, now)
  }
  readHost(chartNow())

  // Kick off the REAL BTC history fetch immediately (no key, public Binance
  // klines). On success we merge genuine mountainous past into the buffer; on
  // failure (CORS/network) fetch_btc_history returns [] and we stay sparse,
  // accumulating live ticks — we NEVER fall back to fake/seeded data.
  fetch_btc_history(180)
    .then(points => mergeHistory(points, chartNow()))
    .catch(() => {
      historyLoaded = true // give up on history; live ticks carry the chart
    })

  // =====================================================================
  //  AMBIENT BLUE-ICE BUBBLES (capped, ~30% opacity) — the optional flourish.
  // =====================================================================
  type Bubble = {
    live: boolean
    x: number
    y: number
    r: number
    vy: number
    ph: number
  }
  const bubbles: Bubble[] = new Array(MAX_BUBBLES)
  for (let i = 0; i < MAX_BUBBLES; i++)
    bubbles[i] = { live: false, x: 0, y: 0, r: 0, vy: 0, ph: 0 }
  let bubbleCursor = 0
  function spawnBubble(): void {
    if (MAX_BUBBLES === 0) return
    const b = bubbles[bubbleCursor]
    bubbleCursor = (bubbleCursor + 1) % MAX_BUBBLES
    b.live = true
    b.x = 0.08 + Math.random() * 0.84
    b.y = 1.04 + Math.random() * 0.06 // start just below the floor (normalized)
    b.r = 1.6 + Math.random() * 2.2
    b.vy = 0.3 + Math.random() * 0.3
    b.ph = Math.random() * Math.PI * 2
  }

  // =====================================================================
  //  CANVAS sizing — cache W/H/dpr/band at the resize boundary.
  // =====================================================================
  let W = 0,
    H = 0,
    dpr = 1
  let bandTopY = 0,
    bandH = 0,
    rightX = 0
  function sizeCanvas(): void {
    chart.width = Math.max(1, (W * dpr) | 0)
    chart.height = Math.max(1, (H * dpr) | 0)
    chart.style.width = W + 'px'
    chart.style.height = H + 'px'
  }
  function resize(): void {
    dpr = Math.min(dprCap, window.devicePixelRatio || 1)
    W = root.clientWidth
    // On the desktop "fold" the stage is viewport-pinned so root.clientHeight ==
    // the viewport height. On a phone the stage flows into a TALL scrolling column
    // (see the ≤560px reflow), where the chart canvas is pinned `position:fixed`
    // as a viewport hero — so its drawing height must stay the VISIBLE viewport,
    // not the full scroll height (which would push the chart band far off screen
    // and squash the line). Clamp to innerHeight: a no-op on desktop (equal), the
    // correct viewport band on mobile. innerWidth guard keeps it desktop-exact.
    const viewportH = window.innerHeight || root.clientHeight
    H = root.clientHeight > viewportH ? viewportH : root.clientHeight
    bandTopY = H * bandTopFrac
    bandH = H * bandHeightFrac
    rightX = W * rightFrac
    sizeCanvas()
  }

  // =====================================================================
  //  CANVAS2D CHART — the ultra-fluid light line + 3 live-price devices.
  // =====================================================================
  const cx = chart.getContext('2d')!
  const splineXs: number[] = []
  const splineYs: number[] = []
  const splinePts: number[] = []
  let lineMix = 0.5 // eased 0(bear)..1(bull) tint cross; 0.5 = neutral steel

  // EASED AUTO-SCALE state — the visible price window. Each frame we compute the
  // TARGET min/max from the samples actually on screen (+ the strike + the eased
  // head + ~11% padding) and LERP the live scale toward it (factor ~0.06) so the
  // axis never pops/jumps when the range shifts. This is the key fix: small real
  // BTC moves (~$5-30/min) fill the chart height like TradingView's 1-min chart
  // instead of collapsing to a flat line against a fixed/wide scale.
  let scaleLo = 0
  let scaleHi = 0

  function drawChart(t: number, now: number): void {
    cx.setTransform(dpr, 0, 0, dpr, 0, 0)
    cx.clearRect(0, 0, W, H)
    // draw a spline DIRECTLY through the REAL timestamped samples (the truth),
    // with the rightmost point = the eased live head. The spline smooths between
    // the sparse poll samples; the eased head glides across the poll gap.
    const n = samples.length
    if (n < 2) return

    // The visible window is the last `windowMs` (live/zoomable), anchored so the
    // newest point sits at rightX. Map wall-clock time -> x; clip to [0, rightX].
    const tRight = now // the head is "now" (where the eased point lives)
    const tLeft = tRight - windowMs

    // ---- AUTO-SCALE: target range from the samples ON SCREEN (+ strike + head)
    // Also capture the (t,p) of the highest + lowest on-screen samples so the
    // HIGH/LOW markers can be drawn at their real vertices below.
    let loT = Infinity,
      hiT = -Infinity
    let hiSampT = 0,
      hiSampP = 0
    let loSampT = 0,
      loSampP = 0
    for (let i = 0; i < n; i++) {
      const s = samples[i]
      if (s.t < tLeft) continue // off the left edge — ignore for scaling
      if (s.p < loT) {
        loT = s.p
        loSampT = s.t
        loSampP = s.p
      }
      if (s.p > hiT) {
        hiT = s.p
        hiSampT = s.t
        hiSampP = s.p
      }
    }
    if (!Number.isFinite(loT)) {
      loT = samples[n - 1].p
      hiT = samples[n - 1].p
    }
    // include the eased head in the range ONLY once it's a real price (>0), so a
    // pre-tick placeholder never collapses the scale toward zero.
    if (displayPrice > 0) {
      if (displayPrice < loT) loT = displayPrice
      if (displayPrice > hiT) hiT = displayPrice
    }
    // ALWAYS include the strike so its reference line stays visible.
    if (strike) {
      if (strike < loT) loT = strike
      if (strike > hiT) hiT = strike
    }
    // ~11% vertical padding so the line never kisses the band edges. Floor the
    // span to a tiny fraction of price so a momentarily-flat tape still renders
    // a sane band (but FAR tighter than before — small moves now fill the band).
    const rawSpan = Math.max(hiT - loT, hiT * 0.00004, 0.01)
    const pad = rawSpan * 0.11
    const targetLo = loT - pad
    const targetHi = hiT + pad
    // EASE the scale toward target (lerp ~0.06) so it never pops. Snap on first
    // frame / reduced motion.
    if (scaleLo === 0 || reduceMotion) {
      scaleLo = targetLo
      scaleHi = targetHi
    } else {
      scaleLo = lerp(scaleLo, targetLo, 0.06)
      scaleHi = lerp(scaleHi, targetHi, 0.06)
    }
    const lo = scaleLo
    const hi = scaleHi
    const range = Math.max(hi - lo, 1e-6)

    const top = bandTopY
    const band = bandH
    const X = (tt: number): number =>
      clamp(((tt - tLeft) / windowMs) * rightX, 0, rightX)
    const Y = (p: number): number => top + (1 - (p - lo) / range) * band

    // ---- LINE TINT — driven by the AUTHORITATIVE host verdict ----------
    // Tint from host.data.chartWinning (the SAME live bid-vs-cost / settlement
    // P&L the cash-out card shows) so the line and the card can NEVER disagree
    // (Bug 2). We deliberately do NOT re-derive win from spot-vs-strike here: the
    // bid can lead/lag the spot crossing the strike (e.g. bet DOWN, price up but
    // the bid is still > cost => the card shows green), and the old derivation
    // would paint the line red against a green card. Neutral 50/50 when there's
    // no held bet, or while the verdict isn't quoteable yet (winning == null).
    let mixTarget = 0.5
    if (side && winning != null) mixTarget = winning ? 1 : 0
    lineMix = lerp(lineMix, mixTarget, reduceMotion ? 1 : 0.1)
    // neutral steel = ink; full = bull/bear. Build the lit colour.
    let lineRgb: [number, number, number]
    if (lineMix >= 0.5) lineRgb = mixRgb(C_INK, C_BULL, (lineMix - 0.5) * 2)
    else lineRgb = mixRgb(C_BEAR, C_INK, lineMix * 2)
    const lineCol = lineRgb.join(',')
    const tinted = side && strike // a held bet => the line carries a decision hue
    const winningNow = tinted && lineMix > 0.5

    // ---- build the screen-space vertices from the REAL samples; the LAST point
    // is the eased live head at rightX (glides toward the latest real spot). A
    // faint wobble keeps the line alive between sparse samples.
    splineXs.length = 0
    splineYs.length = 0
    for (let i = 0; i < n; i++) {
      const s = samples[i]
      splineXs.push(X(s.t))
      splineYs.push(
        Y(s.p) + (reduceMotion ? 0 : Math.sin(t * 0.0013 + i * 0.18) * 0.7),
      )
    }
    // Anchor the live head onto the real-history tail: ONLY override the
    // rightmost vertex with the eased head (pinned at rightX) once we actually
    // have a live oracle price. Before the first oracle tick lands, the buffer is
    // pure Binance history — leave its newest real point as the head so the curve
    // reads as genuine past instead of snapping to a 0/placeholder head.
    if (displayPrice > 0) {
      splineXs[n - 1] = rightX
      splineYs[n - 1] = Y(displayPrice)
    }
    // a fine spline step through the sparse real points = buttery between polls.
    catmullRom(splineXs, splineYs, splinePts, 0.08)
    const m = splinePts.length

    const leadX = splineXs[splineXs.length - 1]
    const leadY = splineYs[splineYs.length - 1]

    // ---- BLUE under-area fill (ALWAYS blue — the fill is chrome) ---------
    cx.beginPath()
    cx.moveTo(splinePts[0], H)
    cx.lineTo(splinePts[0], splinePts[1])
    for (let i = 2; i < m; i += 2) cx.lineTo(splinePts[i], splinePts[i + 1])
    cx.lineTo(leadX, H)
    cx.closePath()
    const g = cx.createLinearGradient(0, top, 0, top + band * 1.05)
    const bRgb = C_BLUE.join(',')
    // a touch softer than before so the chart reads as ambient everywhere (the
    // UI veils strengthen it further only where it crosses bet cards / text).
    // Top alpha is theme-driven (dark needs a touch more to read on dark paper).
    g.addColorStop(0, 'rgba(' + bRgb + ',' + pal.fillTop + ')')
    g.addColorStop(0.55, 'rgba(' + bRgb + ',' + pal.fillTop * 0.36 + ')')
    g.addColorStop(1, 'rgba(' + bRgb + ',0)')
    cx.fillStyle = g
    cx.fill()

    // ---- STRIKE / ENTRY reference line ---------------------------------
    if (showStrike && strike) {
      const ey = Y(strike)
      const strokeRgb = tinted ? lineCol : C_INK.join(',')
      const a = winningNow ? 0.7 : 0.42
      cx.save()
      cx.setLineDash([5, 6])
      cx.strokeStyle = 'rgba(' + strokeRgb + ',' + a + ')'
      cx.lineWidth = 1
      cx.beginPath()
      cx.moveTo(0, ey)
      cx.lineTo(W, ey)
      cx.stroke()
      cx.restore()
      // mono label tag, left-anchored: "ENTRY · UP · $XX,XXX"
      cx.font = '600 11px ' + 'var(--mono, monospace)'
      cx.fillStyle = 'rgba(' + strokeRgb + ',' + (winningNow ? 0.95 : 0.7) + ')'
      cx.textBaseline = 'bottom'
      const lbl = side
        ? 'ENTRY · ' + side + ' · ' + fmtUsd(strike)
        : 'STRIKE · ' + fmtUsd(strike)
      cx.fillText(lbl, 12, ey - 6)
    }

    // ---- the DUAL-STROKE line: a faint wide stroke under a crisp top -----
    cx.lineJoin = 'round'
    cx.lineCap = 'round'
    // wide faint under-stroke
    cx.beginPath()
    cx.moveTo(splinePts[0], splinePts[1])
    for (let i = 2; i < m; i += 2) cx.lineTo(splinePts[i], splinePts[i + 1])
    if (tinted && !reduceMotion) {
      cx.shadowColor = 'rgba(' + lineCol + ',' + (winningNow ? 0.35 : 0.28) + ')'
      cx.shadowBlur = winningNow ? 14 : 10
    } else {
      cx.shadowBlur = 0
    }
    cx.strokeStyle = 'rgba(' + lineCol + ',0.16)'
    cx.lineWidth = 4
    cx.stroke()
    cx.shadowBlur = 0
    // crisp top stroke — a touch translucent so the line stays ambient (lower
    // overall contrast) instead of competing with the UI everywhere.
    cx.beginPath()
    cx.moveTo(splinePts[0], splinePts[1])
    for (let i = 2; i < m; i += 2) cx.lineTo(splinePts[i], splinePts[i + 1])
    cx.strokeStyle = 'rgba(' + lineCol + ',0.82)'
    cx.lineWidth = 1.5
    cx.stroke()

    // ---- HIGH / LOW vertex markers --------------------------------------
    // A small tick + dot + price at the highest and lowest visible vertices,
    // but ONLY when each is "sufficiently far" from the current price so a
    // tight range doesn't clutter the chart with markers hugging the live tag.
    // "Current" is the eased head (displayPrice) once a real tick exists, else
    // the newest sample — the SAME value the live price tag shows. Threshold is
    // a fraction of price (HILO_THRESHOLD), so it scales with BTC's level.
    const curP =
      displayPrice > 0 ? displayPrice : n > 0 ? samples[n - 1].p : 0
    if (curP > 0 && Number.isFinite(hiT) && Number.isFinite(loT)) {
      const inkRgb = C_INK.join(',')
      // theme-aware subtle ink for the marker tick + label (kept BELOW the live
      // tag's weight: smaller, lighter, no background plate).
      const drawHiLo = (
        sampT: number,
        sampP: number,
        isHigh: boolean,
      ): void => {
        const mx = X(sampT)
        const my = Y(sampP)
        const dir = isHigh ? -1 : 1 // high label sits ABOVE its vertex, low BELOW
        // small tick: a short vertical stub off the vertex
        cx.strokeStyle = 'rgba(' + inkRgb + ',0.55)'
        cx.lineWidth = 1
        cx.beginPath()
        cx.moveTo(mx, my)
        cx.lineTo(mx, my + dir * 6)
        cx.stroke()
        // a tiny dot ON the actual vertex
        cx.beginPath()
        cx.arc(mx, my, 2, 0, Math.PI * 2)
        cx.fillStyle = 'rgba(' + inkRgb + ',0.7)'
        cx.fill()
        // compact USD label, nudged toward the chart edge it points to. Keep it
        // inside the canvas: clamp x so a vertex near the left/right doesn't clip.
        cx.font = '600 10px ' + 'var(--mono, monospace)'
        cx.fillStyle = 'rgba(' + inkRgb + ',0.78)'
        cx.textBaseline = isHigh ? 'bottom' : 'top'
        const lbl = fmtUsd(sampP)
        const tw = cx.measureText(lbl).width
        cx.textAlign = 'left'
        const lx = clamp(mx - tw / 2, 4, Math.max(4, W - tw - 4))
        cx.fillText(lbl, lx, my + dir * 9)
      }
      // far-enough gates: gap from current price beyond HILO_THRESHOLD. Gate on
      // the captured SAMPLE extreme (not the head-inclusive hiT/loT) so the gate
      // and the drawn vertex always agree — and so the head being the extreme
      // (gap ≈ 0) never spuriously triggers a marker on top of the live tag.
      if (hiSampP > 0 && (hiSampP - curP) / curP >= HILO_THRESHOLD)
        drawHiLo(hiSampT, hiSampP, true)
      if (loSampP > 0 && (curP - loSampP) / curP >= HILO_THRESHOLD)
        drawHiLo(loSampT, loSampP, false)
      cx.textAlign = 'left' // restore default (other text uses left-anchored)
    }

    // ---- ambient blue-ice bubbles (cheap flourish, ~30% opacity) --------
    if (MAX_BUBBLES) {
      const iceRgb = C_BLUE_BRIGHT.join(',')
      for (let i = 0; i < MAX_BUBBLES; i++) {
        const b = bubbles[i]
        if (!b.live) continue
        if (b.y < -0.1) {
          b.live = false
          continue
        }
        const px = b.x * W + Math.sin(t * 0.0008 + b.ph) * (4 + b.r)
        const py = b.y * H
        cx.beginPath()
        cx.arc(px, py, b.r, 0, Math.PI * 2)
        cx.fillStyle = 'rgba(' + iceRgb + ',0.18)'
        cx.fill()
      }
    }

    // ---- glide the DOM marker + price tag to the leading edge (GPU) ------
    // Hide both until a REAL live price exists (history-only frames have no
    // meaningful "current" point to label). Colours are refreshed from the live
    // palette each frame so a theme flip re-tints them without a remount.
    if (marker && priceTag) {
      const showHead = displayPrice > 0
      marker.style.opacity = showHead ? '1' : '0'
      priceTag.style.opacity = showHead ? '1' : '0'
      marker.style.background = pal.markerCore
      marker.style.transform =
        'translate3d(' + (leadX - 6) + 'px,' + (leadY - 6) + 'px,0)'
      marker.style.borderColor = tinted
        ? 'rgb(' + lineCol + ')'
        : 'rgb(' + C_BLUE_BRIGHT.join(',') + ')'
      marker.style.boxShadow =
        '0 0 0 3px rgba(' +
        (tinted ? lineCol : C_BLUE.join(',')) +
        ',' +
        (winningNow ? 0.22 : 0.16) +
        '),0 1px 3px rgba(10,27,46,0.18)'
      priceTag.style.color = 'rgb(' + pal.inkLabelRgb + ')'
      priceTag.style.background = 'rgba(' + pal.paperRgb + ',0.92)'
      priceTag.style.borderColor = 'rgba(' + pal.hairRgb + ',0.2)'
      priceTag.style.transform =
        'translate3d(' + (leadX + 12) + 'px,' + (leadY - 11) + 'px,0)'
      priceTag.textContent = fmtUsd(displayPrice)
    }
  }

  // =====================================================================
  //  PUBLIC API exposed to variants
  // =====================================================================
  let energyTarget = 0 // a small "inhale" surge on bet, eased back

  function breathe(dir: 'UP' | 'DOWN' | 1 | -1 | null): void {
    const d =
      dir === 'UP' || dir === 1
        ? 'UP'
        : dir === 'DOWN' || dir === -1
          ? 'DOWN'
          : null
    if (d) side = d
    energyTarget = 1
    if (MAX_BUBBLES) {
      spawnBubble()
      spawnBubble()
    }
  }
  function setSide(s: 'UP' | 'DOWN' | null): void {
    side = s === 'UP' || s === 'DOWN' ? s : side
  }
  function clearSide(): void {
    side = null
  }
  function updateHistory(_h: number[]): void {
    // host owns the history ring (read live in drawChart); nothing to do.
    void _h
  }

  // =====================================================================
  //  MASTER LOOP — ONE rAF drives chart + all state easing.
  // =====================================================================
  let raf = 0
  let energy = 0
  const timeScale = reduceMotion ? 0.4 : 1
  const t0 = chartNow()
  let lastT = t0

  // RAF ROBUSTNESS: a per-frame throw must NEVER permanently kill the chart loop
  // while React keeps feeding host data (the chart would silently freeze). Run the
  // body in a try, log ONCE, and ALWAYS reschedule from the finally.
  let frameErrored = false
  function frame(rawNow: number): void {
    // VISIBLE CLOCK: absorb any large inter-frame gap (tab hidden / throttled /
    // slept) into `hiddenMs` so the axis never leaps. See the visible-clock note
    // above pushSample(). frameBody/readHost/drawChart see the paused clock.
    const gap = rawNow - rawLast
    rawLast = rawNow
    if (gap > FRAME_GAP_CAP) hiddenMs += gap - FRAME_GAP_CAP
    try {
      frameBody(rawNow - hiddenMs)
    } catch (err) {
      if (!frameErrored) {
        frameErrored = true
        console.error('[crash-base] frame() error (loop kept alive):', err)
      }
    } finally {
      raf = requestAnimationFrame(frame)
    }
  }
  function frameBody(now: number): void {
    const t = (now - t0) * timeScale
    const dt = Math.min(40, now - lastT)
    lastT = now
    const riseFactor = (dt / 16.7) * (reduceMotion ? 0.5 : 1)

    // pull the freshest spot/strike/side from the host each frame (also appends
    // a REAL sample whenever the host's spot actually changes — no polling here).
    readHost(now)

    // ease energy back toward idle; (b) TWEEN displayPrice toward the newest REAL
    // sample every frame. A gentle factor spreads the move across the ~10s poll
    // gap so the rightmost point GLIDES (never steps) toward each real price.
    energyTarget *= 0.94
    if (energyTarget < 0.001) energyTarget = 0
    energy += (energyTarget - energy) * 0.08
    // While frozen, HOLD displayPrice at its last value (no ease toward livePrice)
    // so the chart head sits perfectly still through the validation window.
    const ease = reduceMotion ? 1 : 0.045 * riseFactor
    if (!frozen) displayPrice += (livePrice - displayPrice) * Math.min(1, ease)
    void energy

    // ease the visible window toward the wheel/button target so zoom pans
    // smoothly (snap when reduced motion). Frame-rate aware so a slow tab still
    // settles. Settle exactly onto the target once within ~0.5% to stop drift.
    if (reduceMotion) {
      windowMs = windowTarget
    } else {
      const wEase = Math.min(1, 0.14 * riseFactor)
      windowMs += (windowTarget - windowMs) * wEase
      if (Math.abs(windowTarget - windowMs) < windowTarget * 0.005)
        windowMs = windowTarget
    }

    // advance ambient bubbles (normalized; rise = decreasing y)
    if (MAX_BUBBLES) {
      for (let i = 0; i < MAX_BUBBLES; i++) {
        const b = bubbles[i]
        if (!b.live) continue
        b.y -= b.vy * 0.005 * riseFactor
        if (b.y < -0.1) b.live = false
      }
    }

    drawChart(t, now)
    // (the reschedule lives in frame()'s finally — keeps the loop alive on a throw)
  }

  // ---- THEME WATCH — re-read document.documentElement.dataset.theme on a small
  // interval and swap the active palette so flipping the dark-theme toggle
  // re-tints the canvas live (the C_* aliases the draw code reads point at it).
  function refreshPalette(): void {
    pal = currentPalette()
    C_INK = pal.ink
    C_BULL = pal.bull
    C_BEAR = pal.bear
    C_BLUE = pal.blue
    C_BLUE_BRIGHT = pal.blueBright
    // re-tint the injected zoom buttons too (created below; the interval that
    // calls this only fires after sync boot, so the buttons always exist by then).
    styleZoomButtons()
  }
  const themeWatch = window.setInterval(refreshPalette, 350)

  // ---- boot ----
  resize()
  const onResize = (): void => resize()
  window.addEventListener('resize', onResize)

  // ONE ambient drizzle interval (capped & cheap) so the page has faint life.
  let ambient = 0
  if (MAX_BUBBLES && !reduceMotion) {
    ambient = window.setInterval(() => {
      if (document.hidden) return
      spawnBubble()
    }, ambientSpawnMs)
  }

  raf = requestAnimationFrame(frame)

  // =====================================================================
  //  ZOOM — wheel + optional +/- buttons adjust the visible window a LITTLE.
  //  Bounds: [WINDOW_MIN_MS, WINDOW_MAX_MS] (5..60 min). We set windowTarget;
  //  the frame loop eases windowMs toward it. Wheel UP (deltaY < 0) = zoom IN
  //  (smaller window, less history); wheel DOWN = zoom OUT (more history).
  // =====================================================================
  // multiply the TARGET by a factor (not the eased value) so rapid wheel ticks
  // compound predictably toward a clamped bound instead of fighting the easing.
  function zoomBy(factor: number): void {
    windowTarget = clamp(windowTarget * factor, WINDOW_MIN_MS, WINDOW_MAX_MS)
  }

  // wheel: a gentle per-notch step. preventDefault so the page never scrolls.
  // Listen on the canvas (the chart) — non-passive so preventDefault sticks.
  const onWheel = (e: WheelEvent): void => {
    e.preventDefault()
    // normalize direction; ~9% per notch = a small, smooth zoom.
    zoomBy(e.deltaY < 0 ? 0.91 : 1 / 0.91)
  }
  // the chart canvas is pointer-events:none for clicks, but we still need wheel
  // events — temporarily allow pointer events for the wheel on the canvas itself.
  chart.style.pointerEvents = 'auto'
  chart.addEventListener('wheel', onWheel, { passive: false })

  // small +/- zoom buttons injected into ITS OWN container (root). Theme-aware,
  // pointer-events enabled (the canvas drizzle above does not block them since
  // they sit ABOVE it in z-order). No dependency on crash-e05.
  const zoomCtl = document.createElement('div')
  zoomCtl.className = 'crashbase-zoom'
  zoomCtl.setAttribute('aria-hidden', 'true')
  zoomCtl.style.cssText =
    'position:absolute;right:10px;bottom:10px;z-index:3;display:flex;gap:4px;' +
    'pointer-events:auto;'
  const mkBtn = (label: string, onClick: () => void): HTMLButtonElement => {
    const b = document.createElement('button')
    b.type = 'button'
    b.textContent = label
    b.tabIndex = -1
    b.style.cssText =
      'width:22px;height:22px;line-height:1;padding:0;cursor:pointer;' +
      'font-family:var(--mono,monospace);font-size:14px;font-weight:600;' +
      'border-radius:3px;display:flex;align-items:center;justify-content:center;'
    b.addEventListener('click', onClick)
    return b
  }
  const btnIn = mkBtn('+', () => zoomBy(0.8)) // bigger step for a click
  const btnOut = mkBtn('−', () => zoomBy(1 / 0.8)) // U+2212 minus sign
  // theme-aware styling, refreshed alongside the palette watch so a theme flip
  // re-tints the buttons without a remount.
  function styleZoomButtons(): void {
    for (const b of [btnIn, btnOut]) {
      b.style.color = 'rgb(' + pal.inkLabelRgb + ')'
      b.style.background = 'rgba(' + pal.paperRgb + ',0.92)'
      b.style.border = '1px solid rgba(' + pal.hairRgb + ',0.22)'
    }
  }
  styleZoomButtons()
  zoomCtl.append(btnIn, btnOut)
  root.append(zoomCtl)

  // =====================================================================
  //  TEARDOWN — stop everything, drop the DOM.
  // =====================================================================
  function teardown(): void {
    cancelAnimationFrame(raf)
    if (ambient) clearInterval(ambient)
    clearInterval(themeWatch)
    chart.removeEventListener('wheel', onWheel)
    window.removeEventListener('resize', onResize)
    ;[backdrop, chart, marker, priceTag, zoomCtl].forEach(el => {
      if (el && el.parentNode) el.parentNode.removeChild(el)
    })
  }

  return { breathe, setSide, clearSide, updateHistory, teardown }
}
