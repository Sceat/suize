/**
 * MascotMini — small droplet cameos for landing sections.
 *
 * Five variants (Sleepy, Cool, Thinking, Reading, Stargazing) that sit
 * beside narrative beats on the landing. Same 22×22 pixel body as the
 * canonical Droplet, scoped under `mm-*` and `v-<variant>` classes so
 * they never collide with the hero Droplet's animation system.
 *
 * All variants accept:
 *   - size      (number, default 56) — pixel size of the rendered SVG
 *   - className (string)              — extra classes on the outer <svg>
 */

const SHARED_CSS = `
  .mm-body     { transform-origin: 11px 18px; animation: mmFloat 6s ease-in-out infinite, mmBreathe 3.6s ease-in-out infinite; }
  .mm-eyelid   { transform-origin: 50% 50%; animation: mmBlink 5.6s ease-in-out infinite; }
  .mm-eyelid-r { animation-delay: 0.06s; }
  .mm-blush    { animation: mmBlush 5s ease-in-out infinite; }
  .mm-sparkle  { animation: mmSparkle 4s ease-in-out infinite; opacity: 0; }

  @keyframes mmFloat {
    0%, 100% { transform: translateY(0); }
    33%      { transform: translateY(-0.5px) rotate(-0.5deg); }
    66%      { transform: translateY(0.4px) rotate(0.5deg); }
  }
  @keyframes mmBreathe {
    0%, 100% { transform: scale(1, 1); }
    50%      { transform: scale(1.025, 0.975); }
  }
  @keyframes mmBlink {
    0%, 92%, 100% { transform: scaleY(1); }
    94%, 96.5%    { transform: scaleY(0.08); }
  }
  @keyframes mmBlush {
    0%, 100% { opacity: 0.5; }
    50%      { opacity: 0.85; }
  }
  @keyframes mmSparkle {
    0%, 100% { opacity: 0; transform: scale(0.5); }
    45%, 55% { opacity: 1; transform: scale(1); }
  }
  @media (prefers-reduced-motion: reduce) {
    .mm-body, .mm-eyelid, .mm-blush, .mm-sparkle { animation: none; }
  }
`

/** 22×24 pixel body silhouette — shared by all variants. */
function BodyRows () {
  return (
    <>
      <rect x="10" y="2" width="2"  height="1" fill="#7AC4FF"/>
      <rect x="9"  y="3" width="4"  height="1" fill="#7AC4FF"/>
      <rect x="8"  y="4" width="6"  height="1" fill="#7AC4FF"/>
      <rect x="7"  y="5" width="8"  height="1" fill="#7AC4FF"/>
      <rect x="6"  y="6" width="10" height="1" fill="#4DA2FF"/>
      <rect x="5"  y="7" width="12" height="1" fill="#4DA2FF"/>
      <rect x="4"  y="8" width="14" height="1" fill="#4DA2FF"/>
      <rect x="3"  y="9" width="16" height="1" fill="#4DA2FF"/>
      <rect x="3"  y="10" width="16" height="1" fill="#4DA2FF"/>
      <rect x="3"  y="11" width="16" height="1" fill="#4DA2FF"/>
      <rect x="3"  y="12" width="16" height="1" fill="#4DA2FF"/>
      <rect x="3"  y="13" width="16" height="1" fill="#2E7BD6"/>
      <rect x="3"  y="14" width="16" height="1" fill="#2E7BD6"/>
      <rect x="3"  y="15" width="16" height="1" fill="#2E7BD6"/>
      <rect x="4"  y="16" width="14" height="1" fill="#2E7BD6"/>
      <rect x="5"  y="17" width="12" height="1" fill="#2E7BD6"/>
      <rect x="6"  y="18" width="10" height="1" fill="#2E7BD6"/>
      <rect x="7"  y="19" width="8"  height="1" fill="#2E7BD6"/>
      <rect x="7" y="6" width="1" height="1" fill="#E8F4FF"/>
      <rect x="6" y="7" width="1" height="1" fill="#B9DEFA"/>
    </>
  )
}

const SVG_BASE = {
  xmlns: 'http://www.w3.org/2000/svg',
  shapeRendering: 'crispEdges',
  style: { display: 'block', overflow: 'visible', imageRendering: 'pixelated' },
}

/* ─────────────────────── SLEEPY ─────────────────────── */
const SLEEPY_CSS = `
  .v-sleepy .mm-body { animation: mmFloat 6s ease-in-out infinite, mmBreathe 6s ease-in-out infinite; }
  .v-sleepy .mm-z    { animation: mmZRise 4s ease-in-out infinite; opacity: 0; transform-origin: 14px 6px; }
  .v-sleepy .mm-z-2  { animation-delay: 1.3s; }
  .v-sleepy .mm-z-3  { animation-delay: 2.6s; }
  @keyframes mmZRise {
    0%   { opacity: 0; transform: translate(0, 0) scale(0.7); }
    20%  { opacity: 1; }
    80%  { opacity: 0.5; }
    100% { opacity: 0; transform: translate(2px, -6px) scale(1.1); }
  }
`
export function SleepyMini ({ size = 56, className = '' }) {
  return (
    <svg {...SVG_BASE} width={size} height={size} viewBox="-1 -2 24 28"
         className={`mm v-sleepy ${className}`} aria-label="sleepy droplet">
      <style>{SHARED_CSS + SLEEPY_CSS}</style>
      <g fill="#7AC4FF" fontFamily="JetBrains Mono, monospace" fontSize="3" fontWeight="500">
        <text className="mm-z"          x="14"   y="6">z</text>
        <text className="mm-z mm-z-2"   x="15.5" y="5">z</text>
        <text className="mm-z mm-z-3"   x="17"   y="4">z</text>
      </g>
      <g className="mm-body">
        <BodyRows/>
        <rect className="mm-blush" x="5"  y="13" width="2" height="1" fill="#9BD6FF"/>
        <rect className="mm-blush" x="15" y="13" width="2" height="1" fill="#9BD6FF"/>
        {/* closed sleeping eyes */}
        <rect x="6"  y="11" width="2" height="1" fill="#0A1A2E"/>
        <rect x="14" y="11" width="2" height="1" fill="#0A1A2E"/>
        {/* tiny relaxed mouth */}
        <rect x="10" y="15" width="2" height="1" fill="#0A1A2E" opacity="0.5"/>
      </g>
    </svg>
  )
}

/* ─────────────────────── COOL ─────────────────────── */
const COOL_CSS = `
  .v-cool .mm-body         { animation: mmFloat 9s ease-in-out infinite, mmBreathe 5s ease-in-out infinite; }
  .v-cool .mm-shades-glint { animation: mmGlint 5s ease-in-out infinite; opacity: 0; }
  @keyframes mmGlint {
    0%, 90%, 100% { opacity: 0; transform: translateX(0); }
    45%, 55%      { opacity: 1; transform: translateX(2px); }
  }
`
export function CoolMini ({ size = 56, className = '' }) {
  return (
    <svg {...SVG_BASE} width={size} height={size} viewBox="-2 -3 26 30"
         className={`mm v-cool ${className}`} aria-label="cool droplet">
      <style>{SHARED_CSS + COOL_CSS}</style>
      <g className="mm-body">
        <BodyRows/>
        <rect className="mm-blush" x="5"  y="13" width="2" height="1" fill="#9BD6FF"/>
        <rect className="mm-blush" x="15" y="13" width="2" height="1" fill="#9BD6FF"/>
        {/* sunglasses */}
        <rect x="5"  y="10" width="5" height="3" fill="#03152C"/>
        <rect x="12" y="10" width="5" height="3" fill="#03152C"/>
        <rect x="10" y="11" width="2" height="1" fill="#03152C"/>
        <rect className="mm-shades-glint" x="6"  y="10" width="2" height="1" fill="#7AC4FF"/>
        <rect className="mm-shades-glint" x="13" y="10" width="2" height="1" fill="#7AC4FF"/>
        {/* chill smirk */}
        <rect x="9"  y="15" width="3" height="1" fill="#0A1A2E"/>
        <rect x="12" y="15" width="1" height="1" fill="#0A1A2E"/>
        {/* peace sign hand */}
        <rect x="3"  y="12" width="1" height="1" fill="#4DA2FF"/>
        <rect x="2"  y="13" width="1" height="2" fill="#4DA2FF"/>
        <rect x="1"  y="15" width="2" height="1" fill="#7AC4FF"/>
        <rect x="0"  y="14" width="1" height="2" fill="#7AC4FF"/>
        <rect x="-1" y="14" width="1" height="2" fill="#7AC4FF"/>
      </g>
    </svg>
  )
}

/* ─────────────────────── THINKING ─────────────────────── */
const THINKING_CSS = `
  .v-thinking .mm-body {
    animation: mmFloat 6s ease-in-out infinite, mmBreathe 4.5s ease-in-out infinite, mmTilt 5s ease-in-out infinite;
  }
  .v-thinking .mm-question { animation: mmQBob 2.4s ease-in-out infinite; transform-origin: 16px 4px; }
  @keyframes mmTilt {
    0%, 100% { transform: rotate(-3deg); }
    50%      { transform: rotate(3deg); }
  }
  @keyframes mmQBob {
    0%, 100% { transform: translateY(0)     scale(1);   opacity: 0.85; }
    50%      { transform: translateY(-1.5px) scale(1.1); opacity: 1; }
  }
`
export function ThinkingMini ({ size = 56, className = '' }) {
  return (
    <svg {...SVG_BASE} width={size} height={size} viewBox="-2 -4 26 30"
         className={`mm v-thinking ${className}`} aria-label="thinking droplet">
      <style>{SHARED_CSS + THINKING_CSS}</style>
      <g className="mm-question" fontFamily="JetBrains Mono, monospace" fontSize="4" fontWeight="500" fill="#7AC4FF">
        <text x="14" y="3">?</text>
      </g>
      <g className="mm-body">
        <BodyRows/>
        <rect className="mm-blush" x="5"  y="13" width="2" height="1" fill="#9BD6FF"/>
        <rect className="mm-blush" x="15" y="13" width="2" height="1" fill="#9BD6FF"/>
        {/* hand on chin */}
        <rect x="13" y="14" width="1" height="1" fill="#4DA2FF"/>
        <rect x="13" y="15" width="2" height="1" fill="#7AC4FF"/>
        {/* one normal eye, one squinted */}
        <rect x="6"  y="10" width="2" height="3" fill="#0A1A2E"/>
        <rect x="6"  y="10" width="1" height="1" fill="#E8F4FF"/>
        <rect x="14" y="11" width="2" height="1" fill="#0A1A2E"/>
        {/* pondering crooked mouth */}
        <rect x="9"  y="15" width="2" height="1" fill="#0A1A2E"/>
        <rect x="11" y="16" width="1" height="1" fill="#0A1A2E"/>
      </g>
    </svg>
  )
}

/* ─────────────────────── READING ─────────────────────── */
const READING_CSS = `
  .v-reading .mm-body      { animation: mmFloat 7s ease-in-out infinite, mmBreathe 5s ease-in-out infinite; }
  .v-reading .mm-eye-track { animation: mmScan 4s ease-in-out infinite; transform-origin: center; transform-box: fill-box; }
  @keyframes mmScan {
    0%, 100% { transform: translateX(-0.5px); }
    25%      { transform: translateX(0.5px); }
    50%      { transform: translateX(-0.5px); }
    75%      { transform: translateX(0.5px); }
  }
`
export function ReadingMini ({ size = 56, className = '' }) {
  return (
    <svg {...SVG_BASE} width={size} height={size} viewBox="-3 -3 28 30"
         className={`mm v-reading ${className}`} aria-label="reading droplet">
      <style>{SHARED_CSS + READING_CSS}</style>
      <g className="mm-body">
        <BodyRows/>
        <rect className="mm-blush" x="4"  y="14" width="2" height="1" fill="#9BD6FF"/>
        <rect className="mm-blush" x="16" y="14" width="2" height="1" fill="#9BD6FF"/>
        {/* round glasses */}
        <rect x="4"  y="10" width="5" height="3" fill="none" stroke="#0A1A2E" strokeWidth="1"/>
        <rect x="13" y="10" width="5" height="3" fill="none" stroke="#0A1A2E" strokeWidth="1"/>
        <rect x="9"  y="11" width="4" height="1" fill="#0A1A2E"/>
        {/* scanning pupils */}
        <g className="mm-eye-track">
          <rect x="6"  y="11" width="1" height="1" fill="#0A1A2E"/>
          <rect x="15" y="11" width="1" height="1" fill="#0A1A2E"/>
        </g>
        {/* focused mouth */}
        <rect x="10" y="15" width="2" height="1" fill="#0A1A2E"/>
      </g>

      {/* paper held in front of body */}
      <rect x="2" y="14" width="18" height="9" fill="#E8F4FF"/>
      <rect x="2" y="14" width="18" height="1" fill="#93B4D8"/>
      {/* "Objectomics" pink heading on paper */}
      <rect x="4"  y="15" width="1" height="1" fill="#FF6B8A"/>
      <rect x="6"  y="15" width="3" height="1" fill="#FF6B8A"/>
      <rect x="10" y="15" width="1" height="1" fill="#FF6B8A"/>
      <rect x="12" y="15" width="2" height="1" fill="#FF6B8A"/>
      <rect x="15" y="15" width="1" height="1" fill="#FF6B8A"/>
      <rect x="17" y="15" width="2" height="1" fill="#FF6B8A"/>
      {/* body text lines */}
      <rect x="4"  y="17" width="6"  height="1" fill="#0A1A2E"/>
      <rect x="11" y="17" width="3"  height="1" fill="#0A1A2E"/>
      <rect x="4"  y="19" width="14" height="1" fill="#5A7A9C"/>
      <rect x="4"  y="20" width="11" height="1" fill="#5A7A9C"/>
      <rect x="4"  y="21" width="13" height="1" fill="#5A7A9C"/>
      {/* hands gripping bottom of paper */}
      <rect x="1"  y="22" width="3" height="1" fill="#7AC4FF"/>
      <rect x="18" y="22" width="3" height="1" fill="#7AC4FF"/>
    </svg>
  )
}

/* ─────────────────────── HYPED ─────────────────────── */
const HYPED_CSS = `
  .v-hyped .mm-body       { animation: mmFloat 1.4s ease-in-out infinite, mmBreathe 1.2s ease-in-out infinite; }
  .v-hyped .mm-arm-l-wave { transform-origin: 4px 12px;  animation: mmArmWaveL 0.45s ease-in-out infinite; }
  .v-hyped .mm-arm-r-wave { transform-origin: 18px 12px; animation: mmArmWaveR 0.45s ease-in-out infinite -0.2s; }
  .v-hyped .mm-burst      { animation: mmBurst 1.3s ease-out infinite; transform-origin: 11px 12px; opacity: 0; }
  .v-hyped .mm-star-eye   { animation: mmEyeSpark 1.2s ease-in-out infinite; transform-origin: center; transform-box: fill-box; }
  @keyframes mmArmWaveL { 0%, 100% { transform: rotate(-78deg); } 50% { transform: rotate(-102deg); } }
  @keyframes mmArmWaveR { 0%, 100% { transform: rotate(78deg);  } 50% { transform: rotate(102deg);  } }
  @keyframes mmBurst {
    0%   { opacity: 1; transform: scale(0.6); }
    80%  { opacity: 0; transform: scale(1.7); }
    100% { opacity: 0; transform: scale(1.7); }
  }
  @keyframes mmEyeSpark {
    0%, 100% { transform: scale(1);   }
    50%      { transform: scale(1.15); }
  }
`
export function HypedMini ({ size = 128, className = '' }) {
  return (
    <svg {...SVG_BASE} width={size} height={size} viewBox="-4 -4 30 30"
         className={`mm v-hyped ${className}`} aria-label="hyped droplet">
      <style>{SHARED_CSS + HYPED_CSS}</style>
      {/* celebration burst rays */}
      <g className="mm-burst" stroke="#7AC4FF" strokeWidth="0.6" fill="none">
        <line x1="11" y1="2"  x2="11" y2="-2"/>
        <line x1="20" y1="11" x2="24" y2="11"/>
        <line x1="2"  y1="11" x2="-2" y2="11"/>
        <line x1="4"  y1="4"  x2="1"  y2="1"/>
        <line x1="18" y1="4"  x2="21" y2="1"/>
        <line x1="4"  y1="20" x2="1"  y2="23"/>
        <line x1="18" y1="20" x2="21" y2="23"/>
      </g>
      <g className="mm-body">
        <BodyRows/>
        <rect className="mm-blush" x="5"  y="13" width="2" height="1" fill="#9BD6FF" opacity="0.85"/>
        <rect className="mm-blush" x="15" y="13" width="2" height="1" fill="#9BD6FF" opacity="0.85"/>
        {/* both arms up waving */}
        <g className="mm-arm-l-wave">
          <rect x="3"  y="12" width="1" height="1" fill="#4DA2FF"/>
          <rect x="2"  y="13" width="1" height="1" fill="#4DA2FF"/>
          <rect x="1"  y="14" width="1" height="1" fill="#2E7BD6"/>
          <rect x="0"  y="15" width="2" height="1" fill="#7AC4FF"/>
          <rect x="-1" y="15" width="1" height="1" fill="#7AC4FF"/>
        </g>
        <g className="mm-arm-r-wave">
          <rect x="18" y="12" width="1" height="1" fill="#4DA2FF"/>
          <rect x="19" y="13" width="1" height="1" fill="#4DA2FF"/>
          <rect x="20" y="14" width="1" height="1" fill="#2E7BD6"/>
          <rect x="20" y="15" width="2" height="1" fill="#7AC4FF"/>
          <rect x="22" y="15" width="1" height="1" fill="#7AC4FF"/>
        </g>
        {/* star eyes */}
        <g className="mm-star-eye" fill="#FACC15">
          <rect x="6"  y="11" width="1" height="1"/>
          <rect x="7"  y="10" width="1" height="3"/>
          <rect x="8"  y="11" width="1" height="1"/>
          <rect x="14" y="11" width="1" height="1"/>
          <rect x="15" y="10" width="1" height="3"/>
          <rect x="16" y="11" width="1" height="1"/>
        </g>
        {/* big open smile */}
        <rect x="9"  y="15" width="4" height="1" fill="#0A1A2E"/>
        <rect x="10" y="16" width="2" height="1" fill="#0A1A2E"/>
      </g>
    </svg>
  )
}

/* ─────────────────────── STARGAZING ─────────────────────── */
const STARGAZING_CSS = `
  .v-stargazing .mm-body { animation: mmFloat 10s ease-in-out infinite, mmBreathe 5.5s ease-in-out infinite; }
  .v-stargazing .mm-star { animation: mmTwinkle 2.4s ease-in-out infinite; transform-origin: center; transform-box: fill-box; }
  .v-stargazing .mm-star-2 { animation-delay: 0.8s; }
  .v-stargazing .mm-star-3 { animation-delay: 1.6s; }
  .v-stargazing .mm-star-4 { animation-delay: 2.0s; }
  @keyframes mmTwinkle {
    0%, 100% { opacity: 0.3; transform: scale(0.7); }
    50%      { opacity: 1;   transform: scale(1.2); }
  }
`
export function StargazingMini ({ size = 56, className = '' }) {
  return (
    <svg {...SVG_BASE} width={size} height={size} viewBox="-3 -5 28 30"
         className={`mm v-stargazing ${className}`} aria-label="stargazing droplet">
      <style>{SHARED_CSS + STARGAZING_CSS}</style>
      {/* stars (gold + white) */}
      <g fill="#FACC15">
        <rect className="mm-star"           x="2"  y="-3" width="1" height="1"/>
        <rect className="mm-star mm-star-2" x="6"  y="-2" width="1" height="1"/>
        <rect className="mm-star mm-star-3" x="14" y="-4" width="1" height="1"/>
        <rect className="mm-star mm-star-4" x="18" y="-3" width="1" height="1"/>
        <rect className="mm-star mm-star-2" x="22" y="-1" width="1" height="1"/>
        <rect className="mm-star mm-star-3" x="0"  y="0"  width="1" height="1"/>
      </g>
      <g fill="#E8F4FF">
        <rect className="mm-star"           x="4"  y="-4" width="1" height="1"/>
        <rect className="mm-star mm-star-3" x="20" y="-4" width="1" height="1"/>
        <rect className="mm-star mm-star-4" x="11" y="-5" width="1" height="1"/>
      </g>

      <g className="mm-body">
        <BodyRows/>
        <rect className="mm-blush" x="4"  y="14" width="2" height="1" fill="#9BD6FF"/>
        <rect className="mm-blush" x="16" y="14" width="2" height="1" fill="#9BD6FF"/>
        {/* star-filled wonder eyes */}
        <rect x="5"  y="10" width="3" height="3" fill="#0A1A2E"/>
        <rect x="6"  y="10" width="1" height="1" fill="#FACC15"/>
        <rect x="5"  y="11" width="3" height="1" fill="#FACC15"/>
        <rect x="6"  y="12" width="1" height="1" fill="#FACC15"/>
        <rect x="14" y="10" width="3" height="3" fill="#0A1A2E"/>
        <rect x="15" y="10" width="1" height="1" fill="#FACC15"/>
        <rect x="14" y="11" width="3" height="1" fill="#FACC15"/>
        <rect x="15" y="12" width="1" height="1" fill="#FACC15"/>
        {/* tiny 'o' wonder mouth */}
        <rect x="10" y="15" width="2" height="2" fill="#0A1A2E"/>
        {/* hand pointing up */}
        <rect x="3" y="11" width="1" height="1" fill="#4DA2FF"/>
        <rect x="2" y="9"  width="1" height="2" fill="#4DA2FF"/>
        <rect x="2" y="7"  width="1" height="2" fill="#7AC4FF"/>
      </g>

      {/* telescope angled up to the right */}
      <rect x="18" y="9"  width="1" height="2" fill="#5A7A9C"/>
      <rect x="19" y="7"  width="1" height="2" fill="#5A7A9C"/>
      <rect x="20" y="5"  width="2" height="2" fill="#93B4D8"/>
      <rect x="22" y="3"  width="1" height="2" fill="#FACC15"/>
      <rect x="17" y="11" width="3" height="1" fill="#5A7A9C"/>
      <rect x="18" y="12" width="1" height="3" fill="#5A7A9C"/>
    </svg>
  )
}
