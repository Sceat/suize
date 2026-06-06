/* ==========================================================================
   e05 — "V5 — Fold & Footer" — ported VERBATIM from design-lab-v3/e05.js.
   --------------------------------------------------------------------------
   The DOM structure, the SCOPED `.e05` CSS, and the count-up rAF are
   transcribed unchanged from the prototype that looks right at :5176. The
   ONLY changes:
     · data source: window.CrashStub -> host.data (same field names/shapes);
     · interactive controls wired to host.actions.* callbacks;
     · two states the prototype lacked, added in e05's SAME editorial language
       (scoped under .e05): the pre-login CONNECT state, and the HELD-BET
       cluster (entry tag + live cash-out + delta + CASH OUT / CLAIM).
   The shared backdrop + chart come from crash-base.mount (also ported).
   ========================================================================== */
import * as base from './crash-base'
import * as sfx from './sfx'
import { fmt_amount, fmt_compact, fmt_signed_cents } from './format'
import type { CrashHost, SideVM } from './crash-host'

export function mount(root: HTMLElement, host: CrashHost): () => void {
  const reduceMotion =
    window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches

  // ---------------------------------------------------------------- //
  //  helpers
  // ---------------------------------------------------------------- //
  const STAKES = host.data.stakes
  // Bare-number money rule (no "$"): < $10 -> 1 decimal, >= $10 -> whole +
  // thousands separators. Used by the bet tape (the "$" is added inline).
  const fmt = (n: number): string => fmt_amount(n)
  // Compact $ for any value chip / headline that could overflow its box
  // (big WIN payouts, stake chips). Follows the money rule below the k/M
  // collapse: 53 -> "$53", 5.3 -> "$5.3", 150000 -> "$150k".
  const fmtC = (n: number): string => '$' + fmt_compact(n)

  // ---------------------------------------------------------------- //
  //  inline Boxicons (MIT) — NO webfont / CDN. Each is a monochrome 24×24
  //  path emitted at 1em, colored via currentColor so it inherits the theme
  //  + the bull/bear/blue ink of its parent, and aria-hidden (the visible
  //  text label carries the meaning for assistive tech). These REPLACE every
  //  emoji / dingbat / geometric glyph the prototype used inline.
  // ---------------------------------------------------------------- //
  const ICON_PATHS = {
    up: 'M11 8.414V18h2V8.414l4.293 4.293 1.414-1.414L12 4.586l-6.707 6.707 1.414 1.414z',
    down: 'm18.707 12.707-1.414-1.414L13 15.586V6h-2v9.586l-4.293-4.293-1.414 1.414L12 19.414z',
    right:
      'm11.293 17.293 1.414 1.414L19.414 12l-6.707-6.707-1.414 1.414L15.586 11H6v2h9.586z',
    check: 'm10 15.586-3.293-3.293-1.414 1.414L10 18.414l9.707-9.707-1.414-1.414z',
    x: 'm16.192 6.344-4.243 4.242-4.242-4.242-1.414 1.414L10.535 12l-4.242 4.242 1.414 1.414 4.242-4.242 4.243 4.242 1.414-1.414L13.364 12l4.242-4.242z',
    // speaker WITH waves — "sound on" (tap to mute). Boxicons bxs-volume-full.
    volume:
      'M16 21c3.527-1.547 5.999-4.909 5.999-9S19.527 4.547 16 3v2c2.387 1.386 3.999 4.047 3.999 7S18.387 17.614 16 19v2z M16 7v10c1.225-1.1 2-3.229 2-5s-.775-3.9-2-5zM4 17h2.697L14 21.488V2.512L6.697 7H4c-1.103 0-2 .897-2 2v6c0 1.103.897 2 2 2z',
    // speaker with an X — "muted" (tap to unmute). Boxicons bxs-volume-mute.
    volumeMute:
      'M4 17h2.697L14 21.488V2.512L6.697 7H4c-1.103 0-2 .897-2 2v6c0 1.103.897 2 2 2zm12.71-9.293-1.42 1.42L17.59 12l-2.3 2.293 1.42 1.414L19 13.41l2.29 2.297 1.42-1.414L20.41 12l2.3-2.293-1.42-1.414L19 10.59z',
  } as const
  // Build an inline SVG string. `em` scales the icon to its line; currentColor
  // makes it inherit the surrounding ink. focusable=false keeps it out of tab
  // order in legacy IE/Edge; aria-hidden hides it from the a11y tree.
  const ico = (name: keyof typeof ICON_PATHS, em = 1): string =>
    `<svg viewBox="0 0 24 24" width="${em}em" height="${em}em" fill="currentColor" ` +
    `aria-hidden="true" focusable="false" style="display:inline-block;vertical-align:-0.125em;flex:0 0 auto">` +
    `<path d="${ICON_PATHS[name]}"></path></svg>`

  // ---------------------------------------------------------------- //
  //  1) SCOPED CSS  (everything under .e05)
  // ---------------------------------------------------------------- //
  const style = document.createElement('style')
  style.textContent = `
  .e05 {
    --e05-pad: clamp(14px, 2.6vw, 30px);
    --e05-col: min(640px, 88vw);
    --e05-footer-h: clamp(146px, 21vh, 188px);
    /* Boxicons bxs-trophy (MIT), URL-encoded for a CSS mask. Used by the WIN
       toast ::before so the icon paints in currentColor (the green bull ink). */
    --e05-trophy: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M21 4h-3V3a1 1 0 0 0-1-1H7a1 1 0 0 0-1 1v1H3a1 1 0 0 0-1 1v3c0 4.31 1.8 6.91 4.82 7A6 6 0 0 0 11 17.91V20H9v2h6v-2h-2v-2.09A6 6 0 0 0 17.18 15c3-.1 4.82-2.7 4.82-7V5a1 1 0 0 0-1-1zM4 8V6h2v6.83C4.22 12.08 4 9.3 4 8zm14 4.83V6h2v2c0 1.3-.22 4.08-2 4.83z'/%3E%3C/svg%3E");
    position: absolute;
    inset: 0;
    font-family: var(--sans);
    color: var(--ink);
  }

  /* foreground layer sits above the canvas (z1) + marker/tag (z2) */
  .e05 .e05-fg {
    position: absolute;
    inset: 0;
    z-index: 3;
    pointer-events: none; /* taps fall through to the real controls */
  }
  .e05 .e05-fg button,
  .e05 .e05-fg a,
  .e05 .e05-fg input,
  .e05 .e05-fg .e05-hit { pointer-events: auto; }

  .e05 .tnum { font-variant-numeric: tabular-nums lining-nums; letter-spacing: -0.01em; }

  /* ---------- top-left logo ---------- */
  .e05 .e05-logo { position: absolute; top: var(--e05-pad); left: var(--e05-pad); }

  /* ---------- TOP-RIGHT ACCOUNT CLUSTER — one cohesive header row ----------
     Designed as a SINGLE unit, not three bolted-on pieces. The row reads:
       [ Balance(gold) · hex-pill ]  |  [ Add funds · Sign out ]  ( ☼/☾ )
     · One vertical centering baseline for every item (align-items: center).
     · One muted-ink type system for the secondary controls — "Add funds" and
       "Sign out" are TRUE siblings (identical .e05-link style + hover).
     · The balance keeps the lone deliberate GOLD accent; the hex pill stays
       subtle; a hairline separates the identity half from the actions half so
       the whole thing reads as ONE designed unit.
     The cluster still wraps below the logo on narrow screens (no overlap). */
  .e05 .e05-acct {
    position: absolute;
    top: var(--e05-pad);
    right: var(--e05-pad);
    display: flex;
    align-items: center;
    /* the logo mark sits at 22px tall on its baseline; pin the cluster's optical
       height to the same line so logo + account read on one clean row. */
    min-height: 22px;
    gap: clamp(14px, 1.8vw, 22px);
    /* allow the cluster to wrap below the logo on very narrow screens instead
       of running off-canvas / under the logo. */
    max-width: min(78vw, 640px);
    flex-wrap: wrap;
    justify-content: flex-end;
  }
  /* the rebuildable identity + actions region (the theme toggle is parked here
     too, at the far right). */
  .e05 .e05-acct-main {
    display: flex;
    align-items: center;
    gap: clamp(14px, 1.8vw, 22px);
  }
  .e05 .e05-acct-main:empty { display: none; }

  /* ---------- SOUND MUTE TOGGLE — borderless speaker icon ----------
     Same unobtrusive treatment as the theme toggle: borderless, ink-3, a small
     ink icon that swaps speaker ↔ muted-speaker on click. Sits left of the theme
     toggle in the header cluster. */
  .e05 .e05-mute {
    appearance: none;
    display: inline-flex; align-items: center; justify-content: center;
    width: 22px; height: 22px;
    border: 0; border-radius: 50%;
    background: transparent;
    color: var(--ink-3); cursor: pointer;
    padding: 0; line-height: 0; flex: 0 0 auto;
    transition: color 0.12s ease;
  }
  .e05 .e05-mute:hover { color: var(--ink); }
  .e05 .e05-mute:focus-visible { outline: 1px solid var(--blue); outline-offset: 3px; border-radius: 4px; }
  .e05 .e05-mute svg { display: block; }
  /* muted state reads quieter (decorative ink) so the "off" is legible at a glance */
  .e05 .e05-mute.is-muted { color: var(--ink-4); }

  /* ---------- DARK / LIGHT THEME TOGGLE — borderless morphing icon ----------
     No border, no box, no background — just an ink-coloured icon that morphs
     sun ↔ moon (rotate + crossfade). The SVG layers a sun group and a moon path
     in the same 18px box; .is-dark (set by JS = current theme) decides which is
     visible. The far-right anchor of the header row. */
  .e05 .e05-theme {
    appearance: none;
    display: inline-flex; align-items: center; justify-content: center;
    width: 22px; height: 22px;
    border: 0; border-radius: 50%;
    background: transparent;
    color: var(--ink-3); cursor: pointer;
    padding: 0; line-height: 0; flex: 0 0 auto;
    transition: color 0.18s ease;
  }
  .e05 .e05-theme:hover { color: var(--ink); }
  .e05 .e05-theme:focus-visible { outline: 1px solid var(--blue); outline-offset: 3px; border-radius: 4px; }
  .e05 .e05-theme .e05-theme-svg { display: block; overflow: visible; }
  /* both icons stack in the same box; we crossfade + rotate between them. The
     transform-origin is the icon centre so the spin reads as a single morph. */
  .e05 .e05-theme .e05-ico-sun,
  .e05 .e05-theme .e05-ico-moon {
    transform-origin: 12px 12px;
    transition: opacity 0.26s ease, transform 0.3s cubic-bezier(0.16, 1, 0.3, 1);
  }
  /* LIGHT (default, .is-dark absent): show the MOON (tap to go dark). */
  .e05 .e05-theme .e05-ico-sun { opacity: 0; transform: rotate(-90deg) scale(0.4); }
  .e05 .e05-theme .e05-ico-moon { opacity: 1; transform: rotate(0deg) scale(1); }
  /* DARK (.is-dark): show the SUN (tap to go light). */
  .e05 .e05-theme.is-dark .e05-ico-sun { opacity: 1; transform: rotate(0deg) scale(1); }
  .e05 .e05-theme.is-dark .e05-ico-moon { opacity: 0; transform: rotate(90deg) scale(0.4); }
  /* the sun's rays bloom in a touch after the disc lands (subtle life). */
  .e05 .e05-theme .e05-sun-rays {
    transform-origin: 12px 12px;
    transition: opacity 0.24s ease 0.04s, transform 0.34s cubic-bezier(0.16, 1, 0.3, 1) 0.04s;
    opacity: 0; transform: scale(0.5);
  }
  .e05 .e05-theme.is-dark .e05-sun-rays { opacity: 1; transform: scale(1); }
  @media (prefers-reduced-motion: reduce) {
    .e05 .e05-theme .e05-ico-sun,
    .e05 .e05-theme .e05-ico-moon,
    .e05 .e05-theme .e05-sun-rays { transition: opacity 0.12s linear; transform: none; }
  }

  /* SHARED secondary-control style — every text link in the header (Add funds,
     Sign out, and the signed-out "Sign in") uses THIS one muted-ink treatment so
     the row never mixes one-blue / one-grey / one-different. */
  .e05 .e05-link {
    appearance: none; background: transparent; border: 0; padding: 0;
    font-family: var(--sans);
    font-size: 10px; font-weight: 600;
    letter-spacing: 0.16em; text-transform: uppercase;
    color: var(--ink-3); cursor: pointer; text-decoration: none;
    line-height: 1;
    transition: color 0.15s ease;
  }
  .e05 .e05-link:hover { color: var(--ink); }
  .e05 .e05-link.is-accent { color: var(--blue-deep); }
  .e05 .e05-link.is-accent:hover { color: var(--blue); }
  .e05 .e05-link:disabled { opacity: 0.5; cursor: default; }

  /* IDENTITY half: [Balance(gold)] · [hex-pill] inline on one baseline. */
  .e05 .e05-acct-id {
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: clamp(12px, 1.5vw, 18px);
    white-space: nowrap;
  }
  .e05 .e05-acct-bal {
    display: flex;
    align-items: baseline;
    gap: 7px;
  }
  .e05 .e05-acct-bal .e05-bal-lbl {
    font-family: var(--sans);
    font-size: 9px;
    font-weight: 600;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--ink-3);
  }
  /* The balance is the ONE deliberate highlight: a tasteful GOLD accent (legible
     on both themes — a deep amber on paper, a warmer glow on dark). Scoped to
     .e05; styles.css is untouched. */
  .e05 .e05-acct-bal .e05-bal-val {
    font-family: var(--mono);
    font-size: 18px;
    font-weight: 700;
    line-height: 1;
    color: #b8860b;
  }
  :root[data-theme='dark'] .e05 .e05-acct-bal .e05-bal-val {
    color: #f0c040;
  }
  /* the subtle copyable hex identity pill — quiet chip styling so it reads as
     part of the unit, not a loud control. */
  .e05 .e05-acct-addr {
    appearance: none; background: transparent; border: 0;
    display: inline-flex; align-items: center; gap: 5px;
    font-family: var(--mono);
    font-size: 11px; font-weight: 500;
    letter-spacing: 0.02em;
    color: var(--ink-3); cursor: pointer;
    line-height: 1;
    transition: color 0.15s ease;
  }
  .e05 .e05-acct-addr:hover { color: var(--ink); }
  .e05 .e05-acct-addr .e05-acct-copied {
    font-family: var(--sans);
    font-size: 8.5px; font-weight: 600;
    letter-spacing: 0.1em; text-transform: uppercase;
    color: var(--blue);
  }

  /* ACTIONS half: Add funds + Sign out, true siblings, with a hairline SEPARATOR
     dividing them from the identity half so the whole row reads as one unit. */
  .e05 .e05-acct-actions {
    display: flex;
    align-items: center;
    gap: clamp(12px, 1.5vw, 18px);
    position: relative;
    padding-left: clamp(14px, 1.8vw, 22px);
  }
  .e05 .e05-acct-actions::before {
    content: '';
    position: absolute;
    left: 0;
    top: 50%;
    transform: translateY(-50%);
    width: 1px;
    height: 14px;
    background: var(--hair-strong);
  }

  /* ---------- TOP-RIGHT RESULTS LOG — recent settled outcomes (UX item V) ----------
     A small, subtle "results" ledger pinned UNDER the account cluster / sign-out.
     Lists the most recent settled outcomes (newest first), each "+$2.00  UP ✓"
     (green win) / "−$1.00  DOWN ✗" (red loss). Quiet, compact, theme-aware. It
     mirrors the bottom-left bet-tape's restrained styling. Right-aligned so it
     hangs cleanly off the same edge as the account cluster; capped row count is
     enforced in App. Collapses gracefully on narrow screens (see responsive). */
  .e05 .e05-results {
    position: absolute;
    top: calc(var(--e05-pad) + 40px);
    right: var(--e05-pad);
    z-index: 3;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 3px;
    max-width: min(220px, 40vw);
    pointer-events: none;
    /* subtle bottom fade so older rows recede without half-greying them */
    -webkit-mask-image: linear-gradient(180deg, #000 0%, #000 70%, rgba(0,0,0,0.4) 100%);
    mask-image: linear-gradient(180deg, #000 0%, #000 70%, rgba(0,0,0,0.4) 100%);
  }
  .e05 .e05-results:empty { display: none; }
  .e05 .e05-results-head {
    font-family: var(--sans);
    font-size: 8.5px; font-weight: 600;
    letter-spacing: 0.22em; text-transform: uppercase;
    color: var(--ink-4);
    margin-bottom: 1px;
  }
  .e05 .e05-res-row {
    display: inline-flex; align-items: baseline; gap: 7px;
    font-size: 11.5px; line-height: 1.35; white-space: nowrap;
  }
  .e05 .e05-res-row .e05-res-amt {
    font-family: var(--mono); font-weight: 600;
    font-variant-numeric: tabular-nums;
  }
  .e05 .e05-res-row .e05-res-side {
    font-family: var(--sans); font-weight: 600;
    letter-spacing: 0.06em; color: var(--ink-3);
    display: inline-flex; align-items: baseline; gap: 3px;
  }
  .e05 .e05-res-row.win .e05-res-amt,
  .e05 .e05-res-row.win .e05-res-mark { color: var(--bull-ink); }
  .e05 .e05-res-row.loss .e05-res-amt,
  .e05 .e05-res-row.loss .e05-res-mark { color: var(--bear-ink); }
  .e05 .e05-res-row .e05-res-mark { font-weight: 700; display: inline-flex; align-items: center; }
  .e05 .e05-res-row .e05-res-mark svg { width: 1em; height: 1em; }

  /* ================================================================= */
  /*  THE CENTERED RITUAL COLUMN — countdown → chart → instr → bets     */
  /* ================================================================= */
  /* AMBIENT BET-ZONE BACKDROP — a STATIC, FEATHERED paper veil behind the bet
     cards so the chart line clearly RECEDES (fades/blurs) under the UI rather
     than crossing it with hard contrast. PERF: this used to apply a live
     backdrop-filter blur(7px) OVER the whole 60fps chart canvas — the page's
     main source of jank. We keep the big region as a pure (free) paper gradient
     and DENSER opacity than before, then add only SMALL, confined blur backings
     on the actual card/text rectangles (see .e05-veil below). Sits below the bet
     content (z-index) and above the canvas; never intercepts taps. Scoped .e05. */
  .e05 .e05-betzone-bg {
    position: absolute;
    left: -6%;
    right: -6%;
    bottom: 0;
    height: clamp(260px, 46%, 420px);
    z-index: 0;
    pointer-events: none;
    border-radius: 10px;
    background: linear-gradient(
      180deg,
      rgba(var(--frost-rgb), 0) 0%,
      rgba(var(--frost-rgb), 0.5) 22%,
      rgba(var(--frost-rgb), 0.82) 52%,
      rgba(var(--frost-rgb), 0.94) 100%
    );
    /* feathered soft edges all round (longer top fade = no hard veil edge over
       the moving line). */
    -webkit-mask-image: linear-gradient(180deg, transparent 0%, #000 30%, #000 100%);
    mask-image: linear-gradient(180deg, transparent 0%, #000 30%, #000 100%);
  }
  /* lift the bet content above the ambient backdrop within .e05-center */
  .e05 .e05-center [data-prebet],
  .e05 .e05-center .e05-held { position: relative; z-index: 1; }

  /* CONFINED FROST BACKING — small, FIXED rectangles that sit directly behind a
     bet card / text block (NOT a full-width band over the moving canvas). Each
     is a soft-radius paper rectangle with a TINY backdrop blur so the chart is
     clearly blurred/faded exactly where it would otherwise cross text/buttons.
     These regions are static-sized (they don't track the line), so the
     compositor blurs a few small fixed quads — native FPS preserved. Feathered
     via a soft box-shadow halo so there's no hard rectangle edge. Scoped .e05. */
  .e05 .e05-veil { position: relative; z-index: 1; }
  .e05 .e05-veil::before {
    content: '';
    position: absolute;
    inset: -10px -16px;
    z-index: -1;
    pointer-events: none;
    border-radius: 12px;
    background: rgba(var(--frost-rgb), 0.72);
    -webkit-backdrop-filter: blur(3px);
    backdrop-filter: blur(3px);
    box-shadow: 0 0 18px 14px rgba(var(--frost-rgb), 0.72);
  }
  /* the bet cards get a slightly stronger, tighter frost so the line never
     crosses the buttons with hard contrast. */
  .e05 .e05-bets.e05-veil::before {
    inset: -8px -10px;
    background: rgba(var(--frost-rgb), 0.6);
    box-shadow: 0 0 16px 12px rgba(var(--frost-rgb), 0.6);
  }
  @media (prefers-reduced-motion: reduce) {
    .e05 .e05-veil::before { -webkit-backdrop-filter: none; backdrop-filter: none; }
  }
  .e05 .e05-center {
    position: absolute;
    left: 50%;
    top: 0;
    bottom: var(--e05-footer-h);
    width: var(--e05-col);
    transform: translateX(-50%);
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    align-items: stretch;
    padding-bottom: clamp(18px, 3.4vh, 34px);
  }

  /* ===== COUNTDOWN MASTHEAD — the nameplate + the big urgency clock ===== */
  .e05 .e05-masthead {
    position: absolute;
    left: 50%;
    transform: translateX(-50%);
    top: clamp(54px, 8.4vh, 96px);
    width: var(--e05-col);
    text-align: center;
    pointer-events: none;
  }
  /* small confined frost behind the countdown masthead so the chart fades under
     the clock too (fixed-size quad, not a full-width band — native FPS). */
  .e05 .e05-masthead::before {
    content: '';
    position: absolute;
    left: 50%;
    top: -8px;
    transform: translateX(-50%);
    width: clamp(220px, 44vw, 360px);
    height: calc(100% + 22px);
    z-index: -1;
    pointer-events: none;
    border-radius: 14px;
    background: rgba(var(--frost-rgb), 0.66);
    -webkit-backdrop-filter: blur(3px);
    backdrop-filter: blur(3px);
    box-shadow: 0 0 26px 18px rgba(var(--frost-rgb), 0.66);
  }
  @media (prefers-reduced-motion: reduce) {
    .e05 .e05-masthead::before { -webkit-backdrop-filter: none; backdrop-filter: none; }
  }
  .e05 .e05-kicker {
    font-family: var(--serif);
    font-weight: 600;
    font-size: 12px;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--ink-2);
    margin-bottom: 9px;
  }
  .e05 .e05-kicker-rule {
    width: clamp(180px, 36vw, 300px);
    height: 1px;
    margin: 0 auto 12px;
    background: var(--rule-fade);
  }
  .e05 .e05-cd-eyebrow {
    font-family: var(--sans);
    font-size: 10px;
    font-weight: 500;
    letter-spacing: 0.3em;
    text-transform: uppercase;
    color: var(--ink-3);
    margin-bottom: 7px;
    transition: color 0.2s ease;
  }
  .e05 .e05-cd-eyebrow.is-warn { color: var(--ink-2); }
  .e05 .e05-cd-time {
    font-family: var(--mono);
    font-weight: 600;
    font-size: clamp(40px, 7vw, 84px);
    line-height: 0.92;
    color: var(--ink);
  }
  .e05 .e05-cd-time.urgent { color: var(--bear-ink); }
  .e05 .e05-cd-time .e05-cd-secs { transition: opacity 0.2s ease; }
  /* lock-drain underline — BLUE, never red (the timer is chrome) */
  .e05 .e05-lockbar {
    margin: 13px auto 0;
    width: clamp(170px, 34vw, 280px);
    height: 2px;
    background: var(--hair);
    overflow: hidden;
  }
  .e05 .e05-lockbar i {
    display: block;
    height: 100%;
    width: 0%;
    background: linear-gradient(90deg, var(--blue-bright), var(--blue-deep));
    transition: width 0.25s linear;
  }
  /* VALIDATING ROUND — the giant mono clock shrinks to fit the words "VALIDATING
     ROUND" (with the small "Ns" window counter). NOT red (this is chrome, not an
     urgent timer); muted ink with a touch of letter-spacing for the editorial
     register. The seconds counter keeps the mono numerals. */
  .e05 .e05-cd-time.validating {
    font-family: var(--sans);
    font-size: clamp(20px, 3.2vw, 34px);
    font-weight: 600;
    letter-spacing: 0.14em;
    line-height: 1;
    color: var(--ink-2);
    white-space: nowrap;
  }
  .e05 .e05-cd-time.validating .e05-cd-secs {
    font-family: var(--mono);
    font-size: 0.6em;
    letter-spacing: 0;
    color: var(--ink-3);
  }
  /* VALIDATING motion cue — the lock-drain hairline sweeps indeterminately (a
     left-to-right shimmer) instead of showing a fixed fill, so the user reads a
     live "working" pulse during the settlement window. Reduced-motion users get a
     calm static half-fill instead of the sweep. */
  .e05 .e05-lockbar.is-loading {
    position: relative;
  }
  .e05 .e05-lockbar.is-loading i {
    width: 38%;
    transition: none;
    animation: e05-validate-sweep 1.15s ease-in-out infinite;
  }
  @keyframes e05-validate-sweep {
    0% { transform: translateX(-110%); }
    100% { transform: translateX(290%); }
  }
  @media (prefers-reduced-motion: reduce) {
    .e05 .e05-lockbar.is-loading i {
      animation: none;
      transform: none;
      width: 50%;
    }
  }

  /* ===== INSTRUCTION hairline — first-timer clarity, above the bets ===== */
  .e05 .e05-instruct { margin-bottom: 13px; text-align: center; }
  .e05 .e05-instruct-line {
    font-family: var(--serif);
    font-size: clamp(14px, 1.9vw, 17px);
    font-weight: 500;
    line-height: 1.3;
    color: var(--ink-2);
    margin-bottom: 4px;
  }
  .e05 .e05-instruct-sub {
    font-family: var(--sans);
    font-size: 11px;
    letter-spacing: 0.02em;
    color: var(--ink-3);
    margin-bottom: 11px;
  }
  .e05 .e05-steps {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    flex-wrap: wrap;
    padding-top: 10px;
    border-top: 1px solid var(--hair);
  }
  .e05 .e05-step {
    display: inline-flex;
    align-items: baseline;
    gap: 6px;
    font-family: var(--sans);
    font-size: 10.5px;
    letter-spacing: 0.02em;
    color: var(--ink-3);
    white-space: nowrap;
  }
  .e05 .e05-step .e05-num {
    font-family: var(--serif);
    font-size: 13px;
    font-weight: 600;
    color: var(--blue-deep);
    line-height: 1;
  }
  .e05 .e05-step-dot { color: var(--ink-4); }

  /* ===== STAKE CHIPS — slim centered row ===== */
  .e05 .e05-stakes {
    display: flex;
    justify-content: center;
    align-items: center;
    gap: 6px;
    margin-bottom: 12px;
    flex-wrap: nowrap;
  }
  .e05 .e05-stake-lbl {
    font-family: var(--sans);
    font-size: 10px;
    font-weight: 500;
    letter-spacing: 0.2em;
    text-transform: uppercase;
    color: var(--ink-3);
    margin-right: 4px;
  }
  .e05 .e05-chip {
    appearance: none;
    background: var(--paper-3);
    border: 1px solid var(--hair);
    border-radius: 2px;
    color: var(--ink-2);
    font-family: var(--mono);
    font-size: clamp(11px, 2.4vw, 12px);
    font-weight: 500;
    /* padding scales down on narrow widths so the chip row never overruns the
       column before it wraps; numbers stay even with tabular-nums. */
    padding: 5px clamp(7px, 1.8vw, 11px);
    cursor: pointer;
    min-width: 0;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
    transition: color 0.15s ease, border-color 0.15s ease, background-color 0.15s ease;
  }
  .e05 .e05-chip:hover { color: var(--ink); border-color: var(--hair-strong); }
  .e05 .e05-chip[aria-pressed='true'] {
    color: var(--blue-deep);
    border-color: var(--hair-blue);
    background: var(--blue-wash);
  }
  .e05 .e05-chip:focus-visible { outline: 1px solid var(--blue); outline-offset: 2px; }
  .e05 .e05-chip:disabled { opacity: 0.4; cursor: not-allowed; }

  /* inline CUSTOM stake field — same chip language */
  .e05 .e05-chip-inline {
    display: inline-flex; align-items: center; gap: 4px;
    border: 1px solid var(--hair-blue); border-radius: 2px;
    background: var(--blue-wash); padding: 3px 8px;
  }
  .e05 .e05-chip-cur { font-family: var(--mono); font-size: 12px; color: var(--ink-3); }
  .e05 .e05-chip-input {
    appearance: none; background: transparent; border: 0; outline: none;
    width: 56px; color: var(--blue-deep);
    font-family: var(--mono); font-size: 12px; font-weight: 600;
    font-variant-numeric: tabular-nums;
  }
  .e05 .e05-chip-input::-webkit-outer-spin-button,
  .e05 .e05-chip-input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
  .e05 .e05-chip-max {
    appearance: none; background: transparent; border: 0;
    font-family: var(--sans); font-size: 9px; font-weight: 600;
    letter-spacing: 0.08em; text-transform: uppercase;
    color: var(--blue); cursor: pointer; white-space: nowrap;
  }

  /* ===== BET BUTTONS — the only saturated objects, centered side-by-side ===== */
  /* two equal cells; minmax(0,1fr) (not the implicit minmax(auto,1fr)) so a cell
     can shrink below its content's min-content width — the buttons scale their
     text down instead of forcing the grid (and the page) to overflow. */
  .e05 .e05-bets { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 12px; }
  .e05 .e05-bet {
    appearance: none;
    position: relative;
    border-radius: 3px;
    cursor: pointer;
    text-align: left;
    padding: 13px clamp(11px, 2.4vw, 16px) 12px;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    /* min-width:0 lets the flex children (win headline, wager line) shrink inside
       the 2-up grid cell instead of forcing the button to overflow its column. */
    min-width: 0;
    gap: 3px;
    overflow: hidden;
    transition: background-color 0.15s ease-in-out, border-color 0.15s ease-in-out,
      transform 0.15s ease-in-out, opacity 0.2s ease;
    will-change: transform;
  }
  .e05 .e05-bet:active { transform: translateY(1px); }
  .e05 .e05-bet:focus-visible { outline: 2px solid var(--blue); outline-offset: 2px; }
  .e05 .e05-bet--up { background: var(--bull-fill); border: 1px solid var(--bull-edge); }
  .e05 .e05-bet--up:hover, .e05 .e05-bet--up:focus-visible { background: var(--bull-fill-hot); }
  .e05 .e05-bet--down { background: var(--bear-fill); border: 1px solid var(--bear-edge); }
  .e05 .e05-bet--down:hover, .e05 .e05-bet--down:focus-visible { background: var(--bear-fill-hot); }
  .e05 .e05-bet:disabled { cursor: not-allowed; }

  .e05 .e05-bet-dir {
    display: flex;
    align-items: center;
    gap: 7px;
    min-width: 0;
    font-family: var(--sans);
    font-size: clamp(10px, 2.6vw, 11px);
    font-weight: 600;
    letter-spacing: 0.2em;
    text-transform: uppercase;
    white-space: nowrap;
  }
  .e05 .e05-bet--up .e05-bet-dir { color: var(--bull-ink); }
  .e05 .e05-bet--down .e05-bet-dir { color: var(--bear-ink); }
  /* inline boxicon arrow — sized in em so it tracks the dir label + currentColor
     so it inherits the bull/bear ink. */
  .e05 .e05-bet-dir .e05-arrow {
    display: inline-flex; flex: 0 0 auto;
    width: 1.1em; height: 1.1em; line-height: 1;
  }
  .e05 .e05-bet-dir .e05-arrow svg { width: 100%; height: 100%; display: block; }

  /* tiny qualifier above the big payout so the WIN reads unambiguously as
     "what you'll win if this side is right" (the wager is the constant sub-line
     below it). Muted ink so the saturated payout number stays the hero. */
  .e05 .e05-bet-winlbl {
    font-family: var(--sans);
    font-size: 9px;
    font-weight: 600;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--ink-3);
    margin-top: 1px;
  }
  .e05.e05-is-locked .e05-bet-winlbl { color: var(--ink-4); }

  /* THE WIN HEADLINE — must NEVER overflow/clip at any width or value, and the
     per-side multiple ("· Nx") must ALWAYS be FULLY visible (it is the dopamine
     number — short, never ellipsized). A flex baseline row: the WIN dollar number
     (shrinks/ellipsizes FIRST) + the "· Nx" multiple (PROTECTED — fixed compact
     font, never shrinks, never clips). Technique guaranteeing the mult shows:
       · the WIN number is flex 0 1 auto + min-width 0 with ellipsis, so flexbox
         takes ALL the shrink out of the big number before anything else;
       · the multiple is flex 0 0 auto AND sized in absolute px (NOT 0.36em of
         the giant win), so it stays small + readable independent of the win size,
         and can never be the thing that overflows;
       · the win clamp is conservative (lower vw + max) so the big number alone
         can't crowd the protected mult off the line.
     Verified to fit both "$1.54 · 1.9x" (small) and "$1,250 · 12x" (large) inside
     a ~150px button. */
  .e05 .e05-bet-win {
    display: flex;
    align-items: baseline;
    flex-wrap: nowrap;
    min-width: 0;
    max-width: 100%;
    font-family: var(--mono);
    font-weight: 600;
    font-size: clamp(24px, 5.2vw, 48px);
    line-height: 1;
    font-variant-numeric: tabular-nums lining-nums;
    white-space: nowrap;
    overflow: hidden;
  }
  .e05 .e05-bet-win > [data-win-up],
  .e05 .e05-bet-win > [data-win-down] {
    /* the WIN dollar number takes ALL the shrink: it ellipsizes before the
       protected multiple ever loses a character. */
    flex: 0 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .e05 .e05-bet--up .e05-bet-win { color: var(--bull-ink); }
  .e05 .e05-bet--down .e05-bet-win { color: var(--bear-ink); }
  /* D12: "Pricing…" placeholder before a real per-side quote loads — muted, smaller,
     no side tint, so it never reads as a fake headline payout. */
  .e05 .e05-bet-win > [data-win-up].is-pricing,
  .e05 .e05-bet-win > [data-win-down].is-pricing {
    color: var(--ink-4); font-size: 0.5em; font-weight: 500; letter-spacing: 0.04em;
  }
  /* THE PROTECTED MULTIPLE — short, compact, ALWAYS fully visible. Absolute font
     size (decoupled from the giant win clamp) + flex:0 0 auto + no shrink + a
     max-content min so flexbox can never squeeze a digit off ("· 12x" / "· 1.9x"
     always render whole). */
  .e05 .e05-bet-win .e05-mult {
    font-family: var(--mono);
    font-size: clamp(13px, 3.2vw, 18px);
    font-weight: 500;
    color: var(--ink-3);
    letter-spacing: 0;
    flex: 0 0 auto;
    min-width: max-content;
    white-space: nowrap;
    overflow: visible;
  }
  .e05 .e05-bet-cost {
    font-family: var(--mono);
    font-size: 11px;
    letter-spacing: 0.01em;
    color: var(--ink-3);
    font-variant-numeric: tabular-nums;
    min-width: 0;
    max-width: 100%;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .e05 .e05-bet-double {
    font-family: var(--sans);
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    margin-top: 2px;
    height: 12px;
    opacity: 0;
    transition: opacity 0.3s ease;
  }
  .e05 .e05-bet--up .e05-bet-double { color: var(--bull-ink); }
  .e05 .e05-bet--down .e05-bet-double { color: var(--bear-ink); }
  .e05 .e05-bet-double.is-on { opacity: 0.92; }

  /* ===== LOCKED state — buttons go calmly inert, NEVER green/red ===== */
  .e05.e05-is-locked .e05-bet {
    pointer-events: none;
    cursor: not-allowed;
    opacity: 0.45;
    background: transparent;
    border-color: var(--hair);
  }
  .e05.e05-is-locked .e05-bet-dir,
  .e05.e05-is-locked .e05-bet-win,
  .e05.e05-is-locked .e05-bet-cost { color: var(--ink-3); }
  .e05.e05-is-locked .e05-bet-win .e05-mult { color: var(--ink-4); }
  .e05.e05-is-locked .e05-bet-double { opacity: 0; }
  .e05.e05-is-locked .e05-chip {
    pointer-events: none;
    opacity: 0.5;
  }
  /* the locked status line under the bets (hidden while open) */
  .e05 .e05-betstatus {
    text-align: center;
    margin-top: 11px;
    height: 13px;
    font-family: var(--sans);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--ink-2);
    opacity: 0;
    transition: opacity 0.2s ease;
  }
  .e05.e05-is-locked .e05-betstatus { opacity: 1; }
  .e05 .e05-betstatus.is-shown { opacity: 1; }

  /* ===== GLOBAL ACTION LOCK — a sponsored write is in flight =====
     While ANY action (bet / cash out / claim / supply / withdraw / redeem) is
     mid-flight, the root carries .e05-is-pending. Every action control goes
     calmly inert — reduced opacity + not-allowed cursor + no pointer events — so
     a second click (e.g. Enoki slow to sign) can never start another action. The
     control that is ACTUALLY in flight keeps its own per-action spinner (driven
     by busyUp/held.busyCashout/etc.), so the user still sees WHAT is pending. We
     do NOT dim the in-flight control's spinner: only the OTHER, blockable
     controls fade. The :disabled state set by tick() is the source of truth; the
     pointer-events guard here is belt-and-suspenders. */
  .e05.e05-is-pending .e05-bet,
  .e05.e05-is-pending .e05-chip,
  .e05.e05-is-pending .e05-chip-max,
  .e05.e05-is-pending .e05-pos-cta,
  .e05.e05-is-pending .e05-cta,
  .e05.e05-is-pending .e05-house-withdraw,
  .e05.e05-is-pending .e05-sheet-cta,
  .e05.e05-is-pending .e05-cashout {
    pointer-events: none;
    cursor: not-allowed;
    opacity: 0.5;
  }

  /* HONOUR [hidden] inside .e05. The scoped rules below use compound selectors
     (specificity 0,2,0), which BEAT the native [hidden]{display:none} (0,1,0) —
     so a hidden .e05-held would otherwise still paint as display:flex. This puts
     the native hide semantics back for every .e05 element (the held cluster +
     its "Cash out" CTA must NOT render when there is no open bet). */
  .e05 [hidden] { display: none !important; }

  /* ===== HELD — TWO DISTINCT POSITIONS (per-side cards) ===== */
  /*  Shared header (entry + lock countdown) then up to two side cards, mirroring
      the pre-bet UP/DOWN cards: UP left/green, DOWN right/red. Each card is its OWN
      position with its OWN cash-out button — no merged number.                    */
  .e05 .e05-held {
    display: flex; flex-direction: column; align-items: stretch; gap: 10px;
    width: 100%;
  }
  .e05 .e05-held-head {
    display: flex; flex-direction: column; justify-content: center;
    align-items: center; gap: 1px;
  }
  /* the round's locked settlement LINE (was "ENTRY") + a subtle directional hint */
  .e05 .e05-held-head .e05-line {
    font-family: var(--mono); font-size: 12px; letter-spacing: 0.04em;
    font-weight: 600; color: var(--ink-2);
  }
  .e05 .e05-held-head .e05-line-hint {
    font-family: var(--sans); font-size: 9px; font-weight: 500;
    letter-spacing: 0.1em; text-transform: uppercase; color: var(--ink-4);
  }
  /* TWO-UP grid identical to .e05-bets so the held cards line up under the bet
     cards. FIXED POSITIONAL SLOTS: the UP card is PINNED to column 1 (LEFT, green)
     and the DOWN card to column 2 (RIGHT, red) via explicit grid-column — so a
     single held side stays in ITS slot and never auto-flows into the empty column
     (a DOWN-only position must render RIGHT, mirroring the top wager cards). A
     hidden card leaves its slot empty without collapsing the other side's half. */
  .e05 .e05-held-cards {
    display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 12px;
  }
  .e05 .e05-held-cards [data-pos-up] { grid-column: 1; }
  .e05 .e05-held-cards [data-pos-down] { grid-column: 2; }
  /* ===== POSITION CARD — "The Exit Ticket": an OUTLINED LEDGER/RECEIPT, distinct
     from the filled WAGER posters. Transparent paper, a hairline divider + math row,
     present-tense status language. Its whole chrome (state GRADIENT / border / glow)
     binds to the P&L SIGN via the .is-winning / .is-losing / .is-neutral / .is-lock
     state class — NOT the side. The at-a-glance signal is a soft state-tinted
     gradient that GLOWS from beneath the hero P&L number outward (no left rail).
     ONLY the small ghost button taps (the tile itself is inert). ===== */
  .e05 .e05-pos {
    position: relative; border-radius: 3px; min-width: 0; overflow: hidden;
    padding: 12px clamp(11px, 2.4vw, 15px) 12px;
    display: flex; flex-direction: column; align-items: flex-start; gap: 2px;
    transition: border-color 0.14s ease, box-shadow 0.14s ease, filter 0.14s ease;
  }
  /* STATE GRADIENT — a soft, low-alpha wash anchored at the upper-left (beneath the
     hero number) that fades into the card paper, so the card "glows" its verdict
     from the hero outward. Lives on ::before so it composites over the base paper
     and cross-fades on state change. Replaces the old left verdict rail entirely. */
  .e05 .e05-pos::before {
    content: ''; position: absolute; inset: 0; z-index: 0;
    pointer-events: none; opacity: 0; transition: opacity 0.16s ease;
    background:
      radial-gradient(120% 78% at 16% 30%,
        var(--pos-glow, transparent) 0%, transparent 62%);
  }
  /* keep the card's own content above the gradient wash */
  .e05 .e05-pos > * { position: relative; z-index: 1; }
  /* WINNING (live net >= +$0.02): green glow gradient + faint fill + lift glow */
  .e05 .e05-pos.is-winning {
    background: var(--bull-fill); border: 1px solid var(--bull-edge);
    box-shadow: 0 0 16px rgba(52, 211, 153, 0.12);
    --pos-glow: rgba(52, 211, 153, 0.20);
  }
  .e05 .e05-pos.is-winning::before { opacity: 1; }
  /* LOSING (live net <= -$0.02): red glow gradient + DASHED border + sunken inset
     (no outer glow) + slight desaturate — structurally unmissable as a loss, and
     NEVER green. The base fill stays neutral paper; the red lives in the gradient. */
  .e05 .e05-pos.is-losing {
    background: var(--paper-3); border: 1px dashed var(--bear-edge);
    box-shadow: inset 0 1px 3px rgba(10, 27, 46, 0.10);
    filter: saturate(0.82) brightness(0.96);
    --pos-glow: rgba(255, 111, 99, 0.18);
  }
  .e05 .e05-pos.is-losing::before { opacity: 1; }
  /* NEUTRAL (|net| < $0.02, or no live quote): no gradient, plain raised paper */
  .e05 .e05-pos.is-neutral {
    background: var(--paper-2); border: 1px solid var(--hair);
  }
  /* LOCKED / SETTLING (outcome unknown — NEVER fake-tint): no gradient, flat paper */
  .e05 .e05-pos.is-lock {
    background: var(--paper-2); border: 1px solid var(--hair);
  }
  /* top row: ● POSITION tag (left) + tiny mono side badge (right, NEVER tints) */
  .e05 .e05-pos-top {
    display: flex; align-items: center; justify-content: space-between;
    gap: 8px; width: 100%; min-width: 0; margin-bottom: 3px;
  }
  .e05 .e05-pos-tag {
    display: inline-flex; align-items: center; gap: 5px;
    font-family: var(--sans); font-size: 9px; font-weight: 700;
    letter-spacing: 0.2em; text-transform: uppercase; color: var(--ink-3);
  }
  .e05 .e05-pos-tag .e05-pos-dot {
    width: 5px; height: 5px; border-radius: 50%; background: var(--ink-4);
    flex: 0 0 auto;
  }
  /* side badge — tiny neutral mono, the ONLY place UP/DOWN appears; never tints */
  .e05 .e05-pos-badge {
    display: inline-flex; align-items: center; gap: 3px; min-width: 0;
    font-family: var(--mono); font-size: 10px; letter-spacing: 0.02em;
    color: var(--ink-4); font-variant-numeric: tabular-nums;
    white-space: nowrap; flex: 0 0 auto;
  }
  .e05 .e05-pos-badge .e05-arrow {
    display: inline-flex; flex: 0 0 auto; width: 1em; height: 1em; line-height: 1;
  }
  .e05 .e05-pos-badge .e05-arrow svg { width: 100%; height: 100%; display: block; }
  /* eyebrow — "NOW · if you exit" / "Settling round…" */
  .e05 .e05-pos-eyebrow {
    font-family: var(--sans); font-size: 9px; font-weight: 600;
    letter-spacing: 0.16em; text-transform: uppercase; color: var(--ink-3);
  }
  /* HERO — the ONLY large number: the signed live P&L, coloured by sign */
  .e05 .e05-pos-hero {
    font-family: var(--mono); font-weight: 700; line-height: 0.94;
    font-size: clamp(30px, 6.6vw, 44px);
    font-variant-numeric: tabular-nums; color: var(--ink-2);
  }
  .e05 .e05-pos-hero.is-winning { color: var(--bull-ink); }
  .e05 .e05-pos-hero.is-losing { color: var(--bear-ink); }
  .e05 .e05-pos-hero.is-neutral, .e05 .e05-pos-hero.is-lock { color: var(--ink-2); }
  /* plain-word status — "winning now" / "losing now" / "about even" */
  .e05 .e05-pos-sub {
    font-family: var(--sans); font-size: 11px; font-weight: 600;
    letter-spacing: 0.02em; color: var(--ink-3); margin-top: 1px;
  }
  .e05 .e05-pos-sub.is-winning { color: var(--bull-ink); }
  .e05 .e05-pos-sub.is-losing { color: var(--bear-ink); }
  .e05 .e05-pos-sub.is-neutral, .e05 .e05-pos-sub.is-lock { color: var(--ink-3); }
  /* MATH line — "value now $2.12 · paid $1.81" (proves the hero) */
  .e05 .e05-pos-math {
    font-family: var(--mono); font-size: 10.5px; letter-spacing: 0.01em;
    color: var(--ink-3); font-variant-numeric: tabular-nums; margin-top: 1px;
  }
  .e05 .e05-pos-pending {
    font-family: var(--mono); font-size: 10.5px; color: var(--ink-3); margin-top: 1px;
  }
  /* hairline divider between the NOW block and the conditional settle block */
  .e05 .e05-pos-rule {
    align-self: stretch; height: 1px; background: var(--hair); margin: 7px 0 6px;
  }
  /* conditional settle line — the "IF … WINS AT SETTLE" LABEL stays quiet grey;
     NEVER tinted green/red (it's the conditional prize, not live P&L). The
     settling-loss line shares the same quiet register. */
  .e05 .e05-pos-if, .e05 .e05-pos-iflose {
    font-family: var(--mono); font-size: 12.5px; letter-spacing: 0.01em;
    color: var(--ink-3); font-variant-numeric: tabular-nums; line-height: 1.3;
  }
  /* the PRIZE NUMBER — high-contrast bright NEUTRAL (--ink), heavier + larger so it
     POPS as the thing you're playing for, but unmistakably the conditional: it is
     labeled, neutral-coloured (never green/red), and sits below the hairline. */
  .e05 .e05-pos-if .e05-pos-if-num {
    color: var(--ink); font-weight: 700; font-size: 15px;
    margin-left: 2px;
  }
  /* gross total — "pays $3.90 total" (smallest, most muted) */
  .e05 .e05-pos-gross {
    font-family: var(--mono); font-size: 10.5px; letter-spacing: 0.01em;
    color: var(--ink-4); font-variant-numeric: tabular-nums; margin-top: 1px;
  }
  /* ===== CASH-OUT (EXIT) button — GHOST/OUTLINED secondary, subordinate to the
     filled WAGER primaries. Transparent fill, hairline border, lighter weight. The
     signed live net colours it green (.net-pos) / red (.net-neg); .is-inert renders
     the disabled "settling" look. ===== */
  .e05 .e05-pos-cta {
    appearance: none; align-self: stretch; margin-top: 8px;
    display: inline-flex; align-items: center; justify-content: center;
    border-radius: 3px; cursor: pointer; background: transparent;
    border: 1px solid var(--hair-strong); color: var(--ink-2);
    font-family: var(--sans); font-size: 11px; font-weight: 500;
    letter-spacing: 0.06em;
    padding: 8px clamp(9px, 2.6vw, 14px);
    text-align: center; line-height: 1.2;
    white-space: normal; overflow-wrap: anywhere;
    font-variant-numeric: tabular-nums;
    transition: background-color 0.15s ease, border-color 0.15s ease,
      color 0.15s ease, transform 0.15s ease, opacity 0.2s ease;
  }
  .e05 .e05-pos-cta.net-pos {
    border-color: var(--bull-edge); color: var(--bull-ink);
  }
  .e05 .e05-pos-cta.net-pos:hover { background: var(--bull-fill-hot); border-color: var(--bull-ink); }
  .e05 .e05-pos-cta.net-neg {
    border-color: var(--bear-edge); color: var(--bear-ink);
  }
  .e05 .e05-pos-cta.net-neg:hover { background: var(--bear-fill-hot); border-color: var(--bear-ink); }
  .e05 .e05-pos-cta.is-inert {
    color: var(--ink-4); border-color: var(--hair); cursor: not-allowed;
    text-transform: none; letter-spacing: 0.04em;
  }
  .e05 .e05-pos-cta:active { transform: translateY(1px); }
  .e05 .e05-pos-cta:disabled { opacity: 0.55; cursor: not-allowed; }
  /* shared settling / trading-frozen note under both cards */
  .e05 .e05-held-note {
    font-family: var(--serif); font-size: 12px; line-height: 1.35;
    color: var(--ink-3); max-width: min(440px, 92%);
    margin: 2px auto 0; text-align: center;
  }

  /* ===== BET TAPE — floats bottom-LEFT in the seam above the footer ===== */
  .e05 .e05-tape {
    position: absolute;
    left: var(--e05-pad);
    bottom: calc(var(--e05-footer-h) + 12px);
    width: min(290px, 40vw);
    display: flex;
    flex-direction: column;
    gap: 4px;
    /* subtle top fade only — keeps every row clearly legible (no half-grey). */
    -webkit-mask-image: linear-gradient(180deg, rgba(0,0,0,0.55) 0%, #000 14%, #000 100%);
    mask-image: linear-gradient(180deg, rgba(0,0,0,0.55) 0%, #000 14%, #000 100%);
  }
  .e05 .e05-tape-head { display: flex; align-items: center; gap: 7px; margin-bottom: 2px; }
  .e05 .e05-tape-head .e05-dot {
    width: 6px; height: 6px; border-radius: 50%;
    background: var(--blue); flex: 0 0 auto;
  }
  .e05 .e05-tape-head .e05-lbl {
    font-family: var(--sans);
    font-size: 9px;
    font-weight: 500;
    letter-spacing: 0.24em;
    text-transform: uppercase;
    color: var(--ink-3);
  }
  .e05 .e05-row {
    display: flex;
    align-items: baseline;
    gap: 7px;
    font-size: 12px;
    line-height: 1.4;
    white-space: nowrap;
    color: var(--ink-3);
  }
  .e05 .e05-row .e05-name {
    font-family: var(--sans);
    font-weight: 500;
    color: var(--ink-2);
    flex: 0 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .e05 .e05-row .e05-verb {
    font-family: var(--sans);
    color: var(--ink-3);
    flex: 0 0 auto;
  }
  .e05 .e05-row .e05-amt {
    font-family: var(--mono);
    color: var(--ink-2);
    flex: 0 0 auto;
  }
  .e05 .e05-row .e05-side {
    font-family: var(--sans);
    font-weight: 600;
    letter-spacing: 0.08em;
    flex: 0 0 auto;
    display: inline-flex;
    align-items: baseline;
    gap: 3px;
  }
  .e05 .e05-row .e05-side--up { color: var(--bull-ink); }
  .e05 .e05-row .e05-side--down { color: var(--bear-ink); }
  .e05 .e05-row .e05-tape-arrow { display: inline-flex; align-items: center; }
  .e05 .e05-row .e05-tape-arrow svg { width: 1em; height: 1em; }
  /* every row stays in normal ink — the .e05-tape top fade-mask is the ONLY
     ageing cue, so older rows are never half-greyed and stay fully legible. */

  /* ================================================================= */
  /*  THE HOUSE FOOTER BAND — full-width, paper-2, top hairline.        */
  /* ================================================================= */
  .e05 .e05-footer {
    position: absolute;
    left: 0; right: 0; bottom: 0;
    height: var(--e05-footer-h);
    background: var(--paper-2);
    border-top: 1px solid var(--hair);
    padding: 0 clamp(20px, 3.4vw, 48px);
    display: grid;
    grid-template-columns:
      minmax(248px, 1.05fr)
      minmax(190px, 0.78fr)
      minmax(150px, 0.62fr)
      auto;
    align-items: center;
    gap: clamp(22px, 3.6vw, 52px);
  }
  .e05 .e05-house-yield,
  .e05 .e05-house-mid {
    position: relative;
  }
  .e05 .e05-house-yield::before,
  .e05 .e05-house-mid::before {
    content: '';
    position: absolute;
    left: calc(-1 * clamp(11px, 1.8vw, 26px));
    top: 50%;
    transform: translateY(-50%);
    width: 1px;
    height: 64%;
    background: linear-gradient(180deg, transparent, var(--hair) 22%, var(--hair) 78%, transparent);
  }
  .e05 .e05-footer::before {
    content: '';
    position: absolute;
    left: 0; right: 0; top: -1px;
    height: 1px;
    background: var(--rule-fade);
  }

  /* -- column 1: the TVL hero (the dominant number on the page) -- */
  .e05 .e05-house-hero { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
  .e05 .e05-house-eyebrow {
    display: flex;
    align-items: baseline;
    gap: 9px;
  }
  .e05 .e05-house-eyebrow .e05-house-tag {
    font-family: var(--serif);
    font-weight: 600;
    font-size: 11px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--ink-2);
  }
  .e05 .e05-house-eyebrow .e05-house-lbl {
    font-family: var(--sans);
    font-size: 9px;
    font-weight: 500;
    letter-spacing: 0.2em;
    text-transform: uppercase;
    color: var(--ink-3);
  }
  .e05 .e05-tvl {
    font-family: var(--mono);
    font-weight: 700;
    font-size: clamp(42px, 6vw, 72px);
    /* line-height 1.02 reserves the full glyph box so the share-price line below
       can never ride up into the big number (the old 0.9 cropped the box and let
       the spark overlap). */
    line-height: 1.02;
    color: var(--blue-deep);
    white-space: nowrap;
    margin-top: 1px;
  }
  /* TVL band: just the big number + label + a live share-price line (no chart).
     Sits clearly BELOW the TVL with its own breathing room at any width. */
  .e05 .e05-house-spark {
    display: flex;
    align-items: center;
    margin-top: 6px;
  }
  .e05 .e05-house-chg {
    font-family: var(--mono);
    font-size: 11px;
    font-weight: 600;
    line-height: 1.3;
    color: var(--blue-bright);
    white-space: nowrap;
  }

  /* -- column 2: the YIELD register — "what would I earn?" (BLUE ink) -- */
  .e05 .e05-house-yield {
    display: flex;
    flex-direction: column;
    gap: 5px;
    min-width: 0;
  }
  .e05 .e05-yield-eyebrow {
    font-family: var(--sans);
    font-size: 9px;
    font-weight: 500;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: var(--ink-3);
  }
  .e05 .e05-yield-apy {
    display: flex;
    align-items: baseline;
    gap: 7px;
    white-space: nowrap;
  }
  .e05 .e05-yield-apy .e05-yield-num {
    font-family: var(--mono);
    font-weight: 700;
    /* MORE PROMINENT yield (UX item #6) — a touch larger so the real all-time
       return reads as a hero figure of the house panel. */
    font-size: clamp(30px, 3.8vw, 46px);
    line-height: 0.92;
    color: var(--blue-deep);
  }
  /* HOLDER: the user's REAL stake, prominent + labeled "Your stake" (UX item #6).
     This REPLACES the deposit projection while a position is held — the prominent
     house number for a holder is their stake value, never the betting wallet. */
  .e05 .e05-yield-stake {
    display: flex;
    align-items: baseline;
    gap: 8px;
    margin-top: 2px;
  }
  .e05 .e05-yield-stake:empty { display: none; }
  .e05 .e05-yield-stake .e05-yield-stake-lbl {
    font-family: var(--sans);
    font-size: 9.5px;
    font-weight: 600;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--ink-3);
  }
  .e05 .e05-yield-stake .e05-yield-stake-val {
    font-family: var(--mono);
    font-weight: 700;
    font-size: clamp(18px, 2.2vw, 24px);
    line-height: 1;
    color: var(--blue-deep);
  }
  .e05 .e05-yield-apy .e05-yield-unit {
    font-family: var(--sans);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--blue);
  }
  .e05 .e05-yield-proj {
    display: flex;
    flex-direction: column;
    gap: 3px;
    margin-top: 1px;
  }
  .e05 .e05-proj {
    display: flex;
    align-items: baseline;
    gap: 6px;
    font-size: 12px;
    line-height: 1.25;
    white-space: nowrap;
    color: var(--ink-2);
  }
  .e05 .e05-proj .e05-proj-from {
    font-family: var(--mono);
    font-weight: 500;
    color: var(--ink-2);
    flex: 0 0 auto;
  }
  .e05 .e05-proj .e05-proj-arrow {
    display: inline-flex; align-items: center;
    color: var(--ink-4);
    flex: 0 0 auto;
  }
  .e05 .e05-proj .e05-proj-earn {
    font-family: var(--mono);
    font-weight: 700;
    color: var(--blue-deep);
    flex: 0 0 auto;
  }
  .e05 .e05-proj .e05-proj-per {
    font-family: var(--sans);
    font-size: 10px;
    letter-spacing: 0.04em;
    color: var(--ink-3);
    flex: 0 0 auto;
  }
  .e05 .e05-proj--tier { color: var(--ink-3); }
  .e05 .e05-proj--tier .e05-proj-from { color: var(--ink-3); }
  .e05 .e05-proj--tier .e05-proj-earn { color: var(--blue); }

  /* -- column 3: the reframe + dotted-leader stats -- */
  .e05 .e05-house-mid { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
  .e05 .e05-reframe {
    font-family: var(--serif);
    font-size: clamp(14px, 1.7vw, 17px);
    font-weight: 500;
    line-height: 1.2;
    color: var(--ink);
  }
  .e05 .e05-stats { display: flex; flex-direction: column; gap: 5px; }
  .e05 .e05-stat {
    display: flex;
    align-items: baseline;
    gap: 8px;
    font-size: 11px;
    color: var(--ink-2);
  }
  .e05 .e05-stat .e05-stat-k {
    font-family: var(--sans);
    font-size: 9.5px;
    font-weight: 500;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--ink-3);
    flex: 0 0 auto;
  }
  .e05 .e05-stat .e05-leader {
    flex: 1 1 auto;
    height: 0;
    border-bottom: 1px dotted var(--hair-strong);
    transform: translateY(-3px);
  }
  .e05 .e05-stat .e05-stat-v {
    font-family: var(--mono);
    flex: 0 0 auto;
    color: var(--ink);
  }
  .e05 .e05-stat .e05-stat-v.is-blue { color: var(--blue-deep); }

  /* -- column 4: the deposit CTA (BLUE — never green/red) -- */
  .e05 .e05-house-cta-wrap { display: flex; flex-direction: column; align-items: stretch; gap: 7px; }
  .e05 .e05-cta {
    appearance: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 9px;
    max-width: 100%;
    min-width: 0;
    background: var(--blue-wash);
    border: 1px solid var(--hair-blue);
    border-radius: 3px;
    color: var(--blue-deep);
    font-family: var(--sans);
    font-size: 13px;
    font-weight: 600;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    padding: 13px clamp(14px, 3vw, 22px);
    cursor: pointer;
    white-space: nowrap;
    transition: background-color 0.15s ease, border-color 0.15s ease, transform 0.15s ease;
  }
  /* the CTA label ellipsizes instead of widening the button past its column */
  .e05 .e05-cta > [data-cta-label] {
    min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .e05 .e05-cta .e05-cta-caret { flex: 0 0 auto; }
  .e05 .e05-cta:hover { background: rgba(30, 127, 214, 0.12); border-color: var(--blue); }
  .e05 .e05-cta:active { transform: translateY(1px); }
  .e05 .e05-cta:focus-visible { outline: 2px solid var(--blue); outline-offset: 2px; }
  .e05 .e05-cta:disabled { opacity: 0.5; cursor: not-allowed; }
  .e05 .e05-cta .e05-cta-caret { display: inline-flex; align-items: center; color: var(--blue-bright); transition: transform 0.2s ease; }
  .e05 .e05-cta:hover .e05-cta-caret { transform: translateY(-2px); }
  .e05 .e05-disclaimer {
    font-family: var(--sans);
    font-size: 9px;
    line-height: 1.4;
    letter-spacing: 0.02em;
    color: var(--ink-3);
    max-width: 220px;
    text-align: center;
  }
  /* WITHDRAW FROM HOUSE — lives in the house section (UX item I). A secondary,
     subordinate action under the primary "Add to the house" CTA. BLUE chrome to
     match the house language (never green/red). */
  .e05 .e05-house-withdraw {
    appearance: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    max-width: 100%;
    min-width: 0;
    background: transparent;
    border: 1px solid var(--hair-blue);
    border-radius: 3px;
    color: var(--blue-deep);
    font-family: var(--sans);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    padding: 9px clamp(12px, 2.6vw, 18px);
    cursor: pointer;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    transition: background-color 0.15s ease, border-color 0.15s ease, transform 0.15s ease;
  }
  .e05 .e05-house-withdraw:hover { background: rgba(30, 127, 214, 0.08); border-color: var(--blue); }
  .e05 .e05-house-withdraw:active { transform: translateY(1px); }
  .e05 .e05-house-withdraw:focus-visible { outline: 2px solid var(--blue); outline-offset: 2px; }
  .e05 .e05-house-withdraw:disabled { opacity: 0.5; cursor: not-allowed; }

  /* ===== OUTCOME FLASH on settle — single eased opacity wash ===== */
  .e05 .e05-flash { position: absolute; inset: 0; z-index: 4; pointer-events: none; opacity: 0; }
  .e05 .e05-flash.is-up {
    background: radial-gradient(120% 60% at 50% 42%, rgba(17, 136, 90, 0.14), transparent 70%);
    animation: e05-flash 1.05s ease-out;
  }
  .e05 .e05-flash.is-down {
    background: radial-gradient(120% 60% at 50% 42%, rgba(207, 58, 48, 0.14), transparent 70%);
    animation: e05-flash 1.05s ease-out;
  }
  @keyframes e05-flash { 0% { opacity: 0; } 18% { opacity: 1; } 100% { opacity: 0; } }

  /* ===== DEPOSIT SHEET — slides UP over a --scrim-dimmed live surface ===== */
  .e05 .e05-scrim {
    position: absolute; inset: 0; z-index: 6;
    background: var(--scrim);
    opacity: 0; pointer-events: none;
    transition: opacity 0.28s ease;
  }
  .e05 .e05-scrim.is-open { opacity: 1; pointer-events: auto; }
  .e05 .e05-sheet {
    position: absolute;
    left: 50%; bottom: 0;
    z-index: 7;
    width: min(560px, 94vw);
    transform: translate(-50%, 100%);
    background: var(--card);
    border: 1px solid var(--hair);
    border-bottom: 0;
    border-radius: 3px 3px 0 0;
    padding: 18px var(--e05-pad) calc(var(--e05-pad) + 4px);
    pointer-events: none;
    transition: transform 0.32s cubic-bezier(0.16, 1, 0.3, 1);
    box-shadow: 0 -24px 60px -34px rgba(10, 27, 46, 0.4);
  }
  .e05 .e05-sheet.is-open { transform: translate(-50%, 0); pointer-events: auto; }
  .e05 .e05-sheet-top {
    display: flex; align-items: baseline; justify-content: space-between;
    gap: 12px; margin-bottom: 6px;
  }
  .e05 .e05-sheet-kicker {
    font-family: var(--serif);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--blue-deep);
  }
  .e05 .e05-back {
    appearance: none; background: transparent; border: 0;
    display: inline-flex; align-items: center; gap: 4px;
    color: var(--ink-3);
    font-family: var(--sans);
    font-size: 10px; font-weight: 500;
    letter-spacing: 0.18em; text-transform: uppercase;
    cursor: pointer; transition: color 0.15s ease;
  }
  .e05 .e05-back:hover { color: var(--ink); }
  .e05 .e05-back:focus-visible { outline: 1px solid var(--blue); outline-offset: 2px; }
  .e05 .e05-sheet-reframe {
    font-family: var(--serif);
    font-size: clamp(18px, 2.6vw, 22px);
    font-weight: 500;
    line-height: 1.16;
    color: var(--ink);
    margin: 2px 0 12px;
  }
  .e05 .e05-share {
    font-family: var(--mono);
    font-size: 12px;
    font-weight: 600;
    color: var(--blue-deep);
    margin-bottom: 12px;
  }
  .e05 .e05-share .e05-share-tail { font-family: var(--sans); color: var(--ink-2); font-weight: 400; }
  .e05 .e05-sheet-stats { display: flex; flex-direction: column; gap: 7px; margin-bottom: 14px; }
  .e05 .e05-sheet-stat {
    display: flex; align-items: baseline; gap: 8px;
    font-size: 11px; color: var(--ink-2);
  }
  .e05 .e05-sheet-stat .e05-ss-k {
    font-family: var(--sans);
    font-size: 9.5px; font-weight: 500;
    letter-spacing: 0.16em; text-transform: uppercase;
    color: var(--ink-3); flex: 0 0 auto;
  }
  .e05 .e05-sheet-stat .e05-ss-lead {
    flex: 1 1 auto; height: 0;
    border-bottom: 1px dotted var(--hair-strong);
    transform: translateY(-3px);
  }
  .e05 .e05-sheet-stat .e05-ss-v { font-family: var(--mono); flex: 0 0 auto; color: var(--ink); }
  .e05 .e05-sheet-stat .e05-ss-v.is-blue { color: var(--blue-deep); }
  .e05 .e05-sheet-stat .e05-ss-hint { font-family: var(--sans); color: var(--ink-3); }
  .e05 .e05-field {
    display: flex; align-items: center; gap: 9px;
    border-bottom: 1px solid var(--hair-strong);
    padding: 6px 2px 8px; margin-bottom: 14px;
  }
  .e05 .e05-field .e05-field-cur {
    font-family: var(--mono); font-size: 22px; font-weight: 600; color: var(--ink-3);
  }
  .e05 .e05-field input {
    flex: 1 1 auto; appearance: none; background: transparent; border: 0; outline: none;
    color: var(--ink);
    font-family: var(--mono); font-size: 22px; font-weight: 600;
    font-variant-numeric: tabular-nums; min-width: 0; padding: 0;
  }
  .e05 .e05-field input::-webkit-outer-spin-button,
  .e05 .e05-field input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
  .e05 .e05-field input::placeholder { color: var(--ink-4); }
  .e05 .e05-field-presets { display: flex; gap: 5px; flex: 0 0 auto; }
  .e05 .e05-fp {
    appearance: none; background: var(--paper-3);
    border: 1px solid var(--hair); border-radius: 2px;
    color: var(--ink-2);
    font-family: var(--mono); font-size: 11px;
    padding: 3px 8px; cursor: pointer;
    transition: color 0.15s ease, border-color 0.15s ease;
  }
  .e05 .e05-fp:hover { color: var(--ink); border-color: var(--hair-strong); }
  .e05 .e05-fp:disabled { opacity: 0.5; cursor: not-allowed; }
  .e05 .e05-sheet-cta {
    appearance: none; width: 100%;
    display: flex; align-items: center; justify-content: center; gap: 9px;
    background: var(--blue);
    border: 1px solid var(--blue-deep); border-radius: 3px;
    color: #fff;
    font-family: var(--sans); font-size: 13px; font-weight: 600;
    letter-spacing: 0.14em; text-transform: uppercase;
    padding: 13px; cursor: pointer;
    transition: background-color 0.15s ease, transform 0.15s ease;
  }
  .e05 .e05-sheet-cta:hover { background: var(--blue-deep); }
  .e05 .e05-sheet-cta:active { transform: translateY(1px); }
  .e05 .e05-sheet-cta:focus-visible { outline: 2px solid var(--blue); outline-offset: 2px; }
  .e05 .e05-sheet-cta:disabled { opacity: 0.5; cursor: not-allowed; }
  .e05 .e05-sheet-foot {
    display: flex; align-items: center; justify-content: space-between;
    gap: 12px; margin-top: 11px;
  }
  .e05 .e05-variance {
    font-family: var(--sans);
    font-size: 10px; line-height: 1.4;
    color: var(--ink-3); letter-spacing: 0.01em;
    max-width: 60%;
    text-decoration: none;
  }
  .e05 .e05-cashout {
    appearance: none; background: transparent; border: 0;
    display: inline-flex; align-items: center; gap: 4px;
    font-family: var(--sans);
    font-size: 10px; letter-spacing: 0.12em; text-transform: uppercase;
    color: var(--ink-2); text-decoration: none;
    border-bottom: 1px solid var(--hair);
    white-space: nowrap; cursor: pointer;
    transition: color 0.15s ease, border-color 0.15s ease;
  }
  .e05 .e05-cashout:hover { color: var(--blue-deep); border-color: var(--hair-blue); }
  .e05 .e05-cashout:disabled { opacity: 0.5; cursor: not-allowed; }

  /* ===== TOASTS — thin frameless lines =====
     Anchored to the bottom-RIGHT seam above the footer (mirroring the bet-tape
     on the left). It used to sit centered at bottom:footer-h+18, which dropped
     the "Watch it move" notice DIRECTLY on top of the centered held Cash-out
     CTA. Pinning it right of centre keeps the centred held cluster + its CTA
     clear of any toast at every width; on phones it goes full-width above the
     held cluster (see responsive block) so it still never overlaps the CTA. */
  .e05 .e05-toast {
    position: absolute; right: var(--e05-pad); left: auto;
    bottom: calc(var(--e05-footer-h) + 18px);
    transform: none; z-index: 8;
    font-family: var(--sans); font-size: 12px; font-weight: 500;
    letter-spacing: 0.02em;
    padding: 8px 16px; border-radius: 2px;
    background: var(--card); border: 1px solid var(--hair);
    box-shadow: 0 6px 20px -10px rgba(10, 27, 46, 0.25);
    /* U: wrap properly so NO toast text is ever clipped. The old
       nowrap + overflow:hidden + ellipsis cropped the verbose settle string;
       normal wrapping + a roomier max-width lets any message read in full. */
    white-space: normal;
    overflow-wrap: anywhere;
    max-width: min(420px, 60vw);
  }
  .e05 .e05-toast.err { color: var(--bear-ink); border-color: var(--bear-edge); }
  .e05 .e05-toast.ok { color: var(--blue-deep); }
  .e05 .e05-toast.muted { color: var(--ink-3); }
  /* T: the concise win/loss settle toast — green WIN / red LOSS, with a matching
     tinted edge so the outcome reads at a glance (tasteful, not loud). */
  .e05 .e05-toast.win {
    color: var(--bull-ink);
    border-color: var(--bull-edge);
    font-weight: 600;
  }
  /* WIN toast trophy — the old "🎉" emoji is gone from the message string; this
     renders a Boxicons bxs-trophy (MIT) as a currentColor mask so it inherits the
     green bull ink. The toast text is set via textContent (no inline SVG there),
     so the icon lives here as a ::before; aria-hidden by virtue of being CSS. */
  .e05 .e05-toast.win::before {
    content: '';
    flex: 0 0 auto;
    width: 1.05em; height: 1.05em;
    margin-right: 6px;
    background-color: currentColor;
    -webkit-mask: var(--e05-trophy) center / contain no-repeat;
    mask: var(--e05-trophy) center / contain no-repeat;
  }
  .e05 .e05-toast.win {
    display: inline-flex; align-items: center;
  }
  .e05 .e05-toast.loss {
    color: var(--bear-ink);
    border-color: var(--bear-edge);
    font-weight: 600;
  }

  /* ---------------------------------------------------------------------- *
   *  EDITORIAL BUSY LOADER — one indeterminate hairline that sweeps L→R.    *
   *  Uses currentColor, so it inherits the host control's ink: white on the *
   *  solid-blue CTAs, blue on links, bull/bear on the bet buttons — and it  *
   *  follows the light/dark tokens automatically. Replaces the old bouncing *
   *  ellipsis "…" and the spinning ring on every busy/pending control.      *
   * ---------------------------------------------------------------------- */
  .e05 .e05-load {
    display: inline-block; position: relative; vertical-align: middle;
    width: 34px; height: 2px; overflow: hidden;
    /* faint full-width track of the inherited ink */
    background: color-mix(in srgb, currentColor 18%, transparent);
  }
  .e05 .e05-load > i {
    position: absolute; top: 0; bottom: 0; left: 0;
    width: 42%; background: currentColor;
    animation: e05-sweep 1.05s cubic-bezier(0.65, 0, 0.35, 1) infinite;
  }
  /* when the loader trails a label (e.g. "WORKING ▸"), give it breathing room */
  .e05 .e05-load.is-trailing { margin-left: 9px; }
  @keyframes e05-sweep {
    0%   { left: -42%; }
    100% { left: 100%; }
  }

  /* ---------- reduced motion ---------- */
  @media (prefers-reduced-motion: reduce) {
    .e05 .e05-bet, .e05 .e05-cta, .e05 .e05-sheet, .e05 .e05-scrim,
    .e05 .e05-lockbar i, .e05 .e05-bet-double, .e05 .e05-cta .e05-cta-caret { transition: none; }
    .e05 .e05-flash.is-up, .e05 .e05-flash.is-down { animation: none; }
    .e05 .e05-sheet { transition: transform 0.001s linear; }
    /* loader degrades to a centered segment doing a gentle opacity pulse */
    .e05 .e05-load > i {
      animation: e05-load-pulse 1.4s ease-in-out infinite;
      left: 29%; width: 42%;
    }
    @keyframes e05-load-pulse {
      0%, 100% { opacity: 1; }
      50%      { opacity: 0.3; }
    }
  }

  /* ==================================================================== */
  /*  RESPONSIVE — fully reflow with NO overlap from phone to desktop.     */
  /*  Audited regions: masthead/acct cluster, countdown, chart area,       */
  /*  instructions, stake chips, UP/DOWN, held cluster, bottom-left tape,  */
  /*  house footer band, toast. Tested at ~375 / ~768 / ~1440.            */
  /* ==================================================================== */

  /* ---- DESKTOP-DOWN: collapse the footer's 4th editorial column ---- */
  @media (max-width: 980px) {
    .e05 .e05-footer {
      grid-template-columns:
        minmax(220px, 1fr)
        minmax(180px, 0.8fr)
        auto;
      gap: clamp(18px, 3vw, 36px);
    }
    .e05 .e05-house-mid { display: none; }
    .e05 .e05-house-mid::before { display: none; }
  }

  /* ---- TABLET (~768px): two-column footer, trim the acct cluster ---- */
  @media (max-width: 720px) {
    .e05 { --e05-footer-h: clamp(168px, 28vh, 216px); }
    .e05 .e05-footer {
      grid-template-columns: 1fr auto;
      gap: 14px;
      row-gap: 8px;
    }
    .e05 .e05-house-yield::before { display: none; }
    .e05 .e05-yield-proj .e05-proj--tier { display: none; }
    /* trim the cluster: drop "Add funds" (it lives in the deposit sheet too) so
       the header stays one tidy line. The separator goes with it (only Sign out
       remains in the actions half, so the hairline would be redundant). */
    .e05 .e05-acct-actions { padding-left: 0; }
    .e05 .e05-acct-actions::before { display: none; }
    .e05 .e05-acct-actions .e05-link:first-child { display: none; }
    .e05 .e05-tape { width: min(220px, 52vw); }
    .e05 .e05-disclaimer { display: none; }
    /* the acct cluster narrows so it can't collide with the centred masthead */
    .e05 .e05-acct { max-width: 62vw; gap: 12px; }
    .e05 .e05-acct-bal .e05-bal-val { font-size: 17px; }
    /* the cluster can wrap to two lines here — push the results log down a touch
       so it never rides up under the wrapped sign-out row. */
    .e05 .e05-results { top: calc(var(--e05-pad) + 56px); max-width: 44vw; }
  }

  /* ---- PHONE (≤560px): SCROLLING STACKED COLUMN ----
     The desktop layout is a single full-viewport "Fold & Footer": every region
     (logo, acct, masthead, chart+bet ritual, tape, house footer) is absolutely
     positioned inside the viewport-pinned .e05 stage. That cannot fit on a phone
     and the stage does not scroll, so content was clipped. Here we DISSOLVE the
     fold into normal document flow: .e05 / .e05-fg become a flex COLUMN, each
     region drops back to static flow and STACKS top-to-bottom (masthead → chart
     hero → bet ritual → house panel), and the whole thing SCROLLS with the page
     (the scroll lock is released in styles.css). The chart canvas stays a FIXED
     hero backdrop behind the scrolling foreground so the live line is always
     visible without ballooning the scroll height (crash-base clamps its height
     to the viewport). Safe-area insets keep content clear of notches / home bars. */
  @media (max-width: 560px) {
    .e05 {
      --e05-pad: clamp(12px, 4vw, 18px);
      --e05-col: 100%;
      /* BLOCK flow — the document grows to fit all stacked regions and scrolls
         with the page. (Not flex: a flex column here was getting height-trapped
         by the ancestor chain and overflowing instead of extending the scroll
         height. Plain block flow grows the page naturally.) */
      position: relative;
      inset: auto;
      display: block;
      min-height: 100dvh;
    }

    /* CHART BACKDROP — pin the canvas + paper backdrop to the VIEWPORT as a
       fixed hero so the live line stays put behind the scrolling foreground
       (instead of stretching down the full scroll height). crash-base clamps
       the canvas height to window.innerHeight so the chart band stays anchored.
       !important overrides the inline cssText (position:absolute) crash-base
       sets on these nodes — inline styles otherwise beat a class rule. */
    .e05 .crashbase-backdrop,
    .e05 .crashbase-chart,
    .e05 .crashbase-marker,
    .e05 .crashbase-pricetag {
      position: fixed !important;
    }

    /* FOREGROUND becomes the scrolling stacked column. position:relative (not
       static) so its z-index:3 actually applies — it must sit ABOVE the fixed
       chart canvas (z1) so opaque sections (the house panel) cover the line
       rather than letting it bleed through. Height is its NATURAL content height
       (no forced 100dvh — that would push the footer below the fold and make it
       unreachable); .e05's min-height:100dvh still fills the screen on short
       content. The side padding frames the whole column; the footer reclaims the
       horizontal padding so it can read as a full-bleed band. */
    .e05 .e05-fg {
      position: relative;
      z-index: 3;
      display: block;
      padding:
        calc(env(safe-area-inset-top, 0px) + var(--e05-pad))
        calc(env(safe-area-inset-right, 0px) + var(--e05-pad))
        0
        calc(env(safe-area-inset-left, 0px) + var(--e05-pad));
      pointer-events: auto;
    }

    /* HEADER ROW — logo left, account cluster right, on one flow row. */
    .e05 .e05-logo {
      position: static;
      top: auto; left: auto;
      display: inline-flex;
    }
    .e05 .e05-acct {
      position: static;
      top: auto; right: auto;
      width: fit-content;
      max-width: 100%;
      gap: 8px;
      margin-top: -26px;          /* sit the cluster on the logo's baseline row */
      margin-left: auto;          /* push the cluster to the right edge */
      justify-content: flex-end;
    }
    /* results log stays hidden on phones (session still records settles) */
    .e05 .e05-results { display: none; }

    /* MASTHEAD — countdown clock, in flow under the header. */
    .e05 .e05-masthead {
      position: static;
      top: auto; left: auto;
      transform: none;
      width: 100%;
      margin-top: clamp(18px, 5vh, 40px);
    }
    /* the masthead frost quad assumed an absolute parent; neutralise it. */
    .e05 .e05-masthead::before { display: none; }

    /* CHART HERO + BET RITUAL — the centre column in flow. We give it a real,
       bounded height so the live chart shows through above the bet cards, then
       the cards sit at the bottom of that band (the original look). */
    .e05 .e05-center {
      position: static;
      left: auto; top: auto; bottom: auto;
      transform: none;
      width: 100%;
      min-height: clamp(360px, 56vh, 540px);
      margin-top: clamp(14px, 3vh, 28px);
      padding-bottom: clamp(14px, 3vh, 26px);
      justify-content: flex-end;
    }
    /* the ambient bet-zone veil tracked the absolute parent's bottom — keep it
       confined to the lower half of the (now in-flow) centre. */
    .e05 .e05-betzone-bg { height: 62%; }

    /* stake chips wrap instead of overflowing the column edge */
    .e05 .e05-stakes { flex-wrap: wrap; row-gap: 7px; }

    /* TAPE — illustrative ticker; in the stacked flow it has no clear home and
       is already hidden ≤480px. Hide it here too so the column stays clean. */
    .e05 .e05-tape { display: none; }

    /* TOAST — pin to the bottom of the VIEWPORT (fixed) so it's always visible
       above whatever is scrolled, never riding on the Cash-out CTA. */
    .e05 .e05-toast {
      position: fixed;
      left: 50%; right: auto;
      transform: translateX(-50%);
      bottom: calc(env(safe-area-inset-bottom, 0px) + 14px);
      top: auto;
      max-width: calc(100vw - var(--e05-pad) * 2);
      white-space: normal; text-align: center;
      z-index: 12;
    }
    /* settle flash covers the visible viewport, not the tall scroll page. */
    .e05 .e05-flash { position: fixed; }

    /* HOUSE FOOTER — now a normal stacked, OPAQUE band at the BOTTOM of the
       column (reachable by scrolling), single-column rows, no fixed height. The
       opaque --paper-2 background (set on the base rule) covers the fixed chart
       behind it. Negative side margins reclaim .e05-fg's horizontal padding so
       the band runs full-bleed to the screen edges, with its own top hairline. */
    .e05 .e05-footer {
      position: static;
      left: auto; right: auto; bottom: auto;
      height: auto;
      grid-template-columns: 1fr;
      align-content: center;
      gap: 10px;
      margin: clamp(20px, 5vh, 40px)
              calc(-1 * (env(safe-area-inset-right, 0px) + var(--e05-pad)))
              0
              calc(-1 * (env(safe-area-inset-left, 0px) + var(--e05-pad)));
      padding: 22px clamp(16px, 4vw, 24px)
               calc(env(safe-area-inset-bottom, 0px) + 28px);
    }
    .e05 .e05-house-yield { display: none; }
    .e05 .e05-house-yield::before { display: none; }
    .e05 .e05-house-cta-wrap { align-items: stretch; }
  }

  /* ---- SMALL PHONE (≤480px): drop the densest chrome ---- */
  @media (max-width: 480px) {
    .e05 .e05-stake-lbl { display: none; }
    .e05 .e05-steps { display: none; }
    .e05 .e05-cd-time { font-size: clamp(34px, 13vw, 64px); }
    /* the tape can crowd the bottom-left of the column on tiny screens; hide it
       so the bet ritual + footer stay uncluttered and overlap-free. */
    .e05 .e05-tape { display: none; }
  }

  /* ---- VERY SMALL (≤360px): keep the bet cards from clipping ---- */
  @media (max-width: 360px) {
    .e05 .e05-bets { gap: 8px; }
    .e05 .e05-bet { padding: 11px 10px 10px; }
    /* drop the win headline's floor further so a big value ("$1.25k · 12x")
       still fits a ~150px cell rather than clipping. The conservative vw factor
       keeps the WIN number from re-ballooning and crowding the protected "· Nx"
       multiple off the line. */
    .e05 .e05-bet-win { font-size: clamp(20px, 6vw, 34px); }
    .e05 .e05-bet-cost { font-size: 10px; }
  }
  `
  root.appendChild(style)

  // ---------------------------------------------------------------- //
  //  2) SHARED BACKDROP + CHART
  // ---------------------------------------------------------------- //
  const baseHandle = base.mount(
    root,
    {
      dprCap: 1.5,
      maxBubbles: 12,
      chartTopFrac: 0.3,
      chartHeightFrac: 0.26,
      rightFrac: 0.9,
      showMarker: true,
      showStrike: true,
    },
    host,
  )

  // ---------------------------------------------------------------- //
  //  3) FOREGROUND DOM
  // ---------------------------------------------------------------- //
  // ONE position card = "The Exit Ticket": an outlined LEDGER (vs the filled WAGER
  // posters). All live tinting (rail/border/fill/glow/hero) is applied at render
  // time from the P&L sign — the markup is chrome-neutral. `k` is 'up'|'down', used
  // only for the data-attr keys + the tiny side glyph (NEVER for chrome).
  const posCard = (k: 'up' | 'down', glyph: string, word: string): string => `
    <div class="e05-pos" data-pos-${k} hidden>
      <div class="e05-pos-top">
        <span class="e05-pos-tag"><i class="e05-pos-dot"></i> Position</span>
        <span class="e05-pos-badge tnum" data-pos-${k}-badge><span class="e05-arrow">${glyph}</span> ${word} · <span data-pos-${k}-ctr></span></span>
      </div>
      <span class="e05-pos-eyebrow" data-pos-${k}-eyebrow>Now · if you exit</span>
      <span class="e05-pos-hero tnum" data-pos-${k}-hero>—</span>
      <span class="e05-pos-sub" data-pos-${k}-sub></span>
      <span class="e05-pos-math tnum" data-pos-${k}-math></span>
      <span class="e05-pos-pending" data-pos-${k}-pending hidden>payout pending</span>
      <div class="e05-pos-rule"></div>
      <span class="e05-pos-if tnum" data-pos-${k}-if></span>
      <span class="e05-pos-gross tnum" data-pos-${k}-gross></span>
      <span class="e05-pos-iflose tnum" data-pos-${k}-iflose hidden></span>
      <button type="button" class="e05-pos-cta" data-pos-${k}-cta>Cash out</button>
    </div>`
  const fg = document.createElement('div')
  fg.className = 'e05-fg'
  fg.innerHTML = `
    <a class="e05-logo crash-logo" href="#bet-top" data-logo>
      <span class="crash-logo__mark">CRASH</span>
      <span class="crash-logo__sub">· by suize</span>
    </a>

    <div class="e05-acct">
      <!-- IDENTITY + ACTIONS — the ONLY rebuilt region (renderAcct wipes its
           innerHTML). It sits on the LEFT of the cluster; the theme toggle below
           is a PERMANENT sibling on its right that renderAcct never touches. -->
      <div class="e05-acct-main" data-acct></div>
      <!-- DARK/LIGHT THEME TOGGLE — a STABLE, PERMANENT sibling OUTSIDE the
           rebuilt [data-acct] region (far right of the header cluster). It is
           created once here and never re-parented, so acctEl.innerHTML='' can't
           destroy it and there is no insertBefore cycle. -->
      <!-- SOUND MUTE TOGGLE — a small speaker icon (sound-on / muted). Like the
           theme toggle it's a STABLE PERMANENT header sibling; its glyph swaps on
           toggle and persists via sfx.set_muted -> localStorage. -->
      <button type="button" class="e05-mute" data-mute aria-label="Toggle sound" aria-pressed="false" title="Toggle sound"></button>
      <button type="button" class="e05-theme" data-theme-toggle aria-label="Toggle dark mode" aria-pressed="false" title="Toggle dark mode">
        <svg class="e05-theme-svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
          <!-- SUN: a core disc + 8 rays. Shown in DARK mode (tap to go light). -->
          <g class="e05-ico-sun">
            <circle cx="12" cy="12" r="4.2"></circle>
            <g class="e05-sun-rays">
              <line x1="12" y1="1.6" x2="12" y2="4.2"></line>
              <line x1="12" y1="19.8" x2="12" y2="22.4"></line>
              <line x1="1.6" y1="12" x2="4.2" y2="12"></line>
              <line x1="19.8" y1="12" x2="22.4" y2="12"></line>
              <line x1="4.4" y1="4.4" x2="6.2" y2="6.2"></line>
              <line x1="17.8" y1="17.8" x2="19.6" y2="19.6"></line>
              <line x1="4.4" y1="19.6" x2="6.2" y2="17.8"></line>
              <line x1="17.8" y1="6.2" x2="19.6" y2="4.4"></line>
            </g>
          </g>
          <!-- MOON: a single crescent. Shown in LIGHT mode (tap to go dark). -->
          <path class="e05-ico-moon" d="M20.5 14.2A8.2 8.2 0 1 1 10.2 3.6a6.4 6.4 0 0 0 10.3 10.6Z"></path>
        </svg>
      </button>
    </div>

    <!-- GAINS/LOSS results log (V): recent settled outcomes, below the acct
         cluster / sign-out. Rows rendered live from host.data.results. -->
    <div class="e05-results" data-results aria-live="polite"></div>

    <div class="e05-masthead" aria-live="polite">
      <div class="e05-kicker">Today's Round</div>
      <div class="e05-kicker-rule"></div>
      <div class="e05-cd-eyebrow" data-cd-eyebrow>Round locks in</div>
      <div class="e05-cd-time tnum"><span data-cd-mm>0</span><span class="e05-cd-secs" data-cd-ss>:00</span></div>
      <div class="e05-lockbar"><i data-lockbar></i></div>
    </div>

    <div class="e05-center">
      <div class="e05-betzone-bg" aria-hidden="true"></div>
      <div data-prebet>
        <div class="e05-instruct e05-veil">
          <div class="e05-instruct-line">Will BTC be higher when the round locks? Tap UP or DOWN.</div>
          <div class="e05-instruct-sub">You're betting on BTC's price — not a token. Set ONE wager; each side shows what you win if right.</div>
          <div class="e05-steps">
            <span class="e05-step"><span class="e05-num">1</span> Set your wager</span>
            <span class="e05-step-dot">·</span>
            <span class="e05-step"><span class="e05-num">2</span> Tap UP or DOWN</span>
            <span class="e05-step-dot">·</span>
            <span class="e05-step"><span class="e05-num">3</span> Win when higher / lower</span>
          </div>
        </div>

        <div class="e05-stakes" role="group" aria-label="Wager">
          <span class="e05-stake-lbl">Wager</span>
          ${STAKES.map(
            s =>
              `<button type="button" class="e05-chip tnum" data-stake="${s}" aria-pressed="${
                s === host.data.stake ? 'true' : 'false'
              }">${fmtC(s)}</button>`,
          ).join('')}
          <button type="button" class="e05-chip" data-custom aria-pressed="false">Custom</button>
          <span class="e05-chip-inline" data-custom-field hidden>
            <span class="e05-chip-cur">$</span>
            <input class="e05-chip-input tnum" type="number" inputmode="numeric" min="1" step="1" placeholder="0" data-custom-input aria-label="Custom bet size in dollars" />
            <button type="button" class="e05-chip-max" data-custom-max hidden></button>
          </span>
        </div>

        <div class="e05-bets e05-veil">
          <button type="button" class="e05-bet e05-bet--up" data-bet="UP" aria-label="Bet UP — win if BTC is higher">
            <span class="e05-bet-dir"><span class="e05-arrow">${ico('up')}</span> UP</span>
            <span class="e05-bet-winlbl">Win if right</span>
            <span class="e05-bet-win"><span class="tnum" data-win-up>$0</span><span class="e05-mult tnum" data-mult-up></span></span>
            <span class="e05-bet-cost tnum" data-cost-up></span>
            <span class="e05-bet-double" data-double-up>Double your money</span>
          </button>
          <button type="button" class="e05-bet e05-bet--down" data-bet="DOWN" aria-label="Bet DOWN — win if BTC is lower">
            <span class="e05-bet-dir"><span class="e05-arrow">${ico('down')}</span> DOWN</span>
            <span class="e05-bet-winlbl">Win if right</span>
            <span class="e05-bet-win"><span class="tnum" data-win-down>$0</span><span class="e05-mult tnum" data-mult-down></span></span>
            <span class="e05-bet-cost tnum" data-cost-down></span>
            <span class="e05-bet-double" data-double-down>Double your money</span>
          </button>
        </div>

        <div class="e05-betstatus" data-betstatus>Locked — reopens next round</div>
      </div>

      <!-- HELD — TWO DISTINCT POSITIONS. A shared header (entry + lock countdown)
           then up to two per-side cards (UP left/green, DOWN right/red), each its
           OWN position with its OWN cash-out button. A side with 0 contracts is
           absent (its column shows the pre-bet wager selector for opening/growing).
           The settling note appears once, under both cards. -->
      <div class="e05-held e05-veil" data-held hidden>
        <div class="e05-held-head">
          <span class="e05-line" data-held-entry>LINE $0</span>
          <span class="e05-line-hint">up wins above · down wins below</span>
        </div>
        <div class="e05-held-cards">
          ${posCard('up', ico('up'), 'UP')}
          ${posCard('down', ico('down'), 'DOWN')}
        </div>
        <div class="e05-held-note" data-held-note hidden></div>
      </div>
    </div>

    <!-- ILLUSTRATIVE ticker — NOT real-time on-chain activity. No global per-bet
         feed exists in the indexer yet, so these rows are simulated sample bets.
         Labeled "Sample bets" (no live pulse) so it never implies real on-chain
         data. Swap the emitter for a real global-feed poller to make it live. -->
    <div class="e05-tape">
      <div class="e05-tape-head">
        <span class="e05-dot"></span>
        <span class="e05-lbl">Sample bets · illustrative</span>
      </div>
      <div class="e05-tape-rows" data-tape></div>
    </div>

    <div class="e05-flash" data-flash></div>

    <footer class="e05-footer">
      <div class="e05-house-hero">
        <div class="e05-house-eyebrow">
          <span class="e05-house-tag">The House</span>
          <span class="e05-house-lbl">Total Pool · TVL</span>
        </div>
        <div class="e05-tvl tnum" data-tvl>…</div>
        <div class="e05-house-spark">
          <span class="e05-house-chg tnum" data-chg></span>
        </div>
      </div>

      <div class="e05-house-yield">
        <span class="e05-yield-eyebrow">Yield · paid by the bets</span>
        <span class="e05-yield-apy">
          <span class="e05-yield-num tnum" data-yield-num>—</span>
          <span class="e05-yield-unit" data-yield-unit>all-time</span>
        </span>
        <!-- HOLDER: the user's REAL stake, prominent + labeled "Your stake". -->
        <div class="e05-yield-stake" data-stake-block hidden>
          <span class="e05-yield-stake-lbl">Your stake</span>
          <span class="e05-yield-stake-val tnum" data-stake-val>$0</span>
        </div>
        <!-- NON-HOLDER: a clearly-labeled projection of DEPOSITABLE funds. -->
        <div class="e05-yield-proj" data-proj-block>
          <span class="e05-proj">
            <span class="e05-proj-from tnum" data-proj-from>Deposit $0</span>
            <span class="e05-proj-arrow">${ico('right', 0.9)}</span>
            <span class="e05-proj-earn tnum" data-proj-earn>+$0</span>
            <span class="e05-proj-per">projected · at current rate</span>
          </span>
          <span class="e05-proj e05-proj--tier">
            <span class="e05-proj-from tnum">Deposit $1,000</span>
            <span class="e05-proj-arrow">${ico('right', 0.9)}</span>
            <span class="e05-proj-earn tnum" data-proj-tier>+$0</span>
            <span class="e05-proj-per">projected · at current rate</span>
          </span>
        </div>
      </div>

      <div class="e05-house-mid">
        <div class="e05-reframe">Every bet pays the house. Own a slice of it.</div>
        <div class="e05-stats">
          <div class="e05-stat">
            <span class="e05-stat-k">Utilization</span>
            <span class="e05-leader"></span>
            <span class="e05-stat-v tnum" data-util>—</span>
          </div>
          <div class="e05-stat">
            <span class="e05-stat-k">Share price</span>
            <span class="e05-leader"></span>
            <span class="e05-stat-v is-blue tnum" data-shareprice>—</span>
          </div>
          <div class="e05-stat" data-yourstake-row hidden>
            <span class="e05-stat-k">Your stake</span>
            <span class="e05-leader"></span>
            <span class="e05-stat-v is-blue tnum" data-yourstake></span>
          </div>
        </div>
      </div>

      <div class="e05-house-cta-wrap">
        <button type="button" class="e05-cta e05-hit" data-house aria-label="Become the house">
          <span data-cta-label>Become the house</span>
          <span class="e05-cta-caret">${ico('up', 0.9)}</span>
        </button>
        <!-- UX item I: the WITHDRAW control lives IN the house section (not just
             in the deposit sheet), visible whenever a position is held. -->
        <button type="button" class="e05-house-withdraw e05-hit" data-house-withdraw aria-label="Withdraw from house" hidden>
          Withdraw from house
        </button>
        <span class="e05-disclaimer">You take the other side of every bet: you earn when players lose, but lose when they win. The house edge is statistical, not guaranteed. Withdraw anytime.</span>
      </div>
    </footer>

    <div class="e05-scrim" data-scrim></div>
    <div class="e05-sheet" data-sheet role="dialog" aria-modal="false" aria-label="Become the house">
      <div class="e05-sheet-top">
        <span class="e05-sheet-kicker">Be the house</span>
        <button type="button" class="e05-back" data-back>${ico('down', 0.9)} back to the bet</button>
      </div>
      <div class="e05-sheet-reframe">Every bet pays the house.<br>Own a slice of it.</div>
      <div class="e05-share">
        <span data-sheet-share>$1.0000</span> <span class="e05-share-tail">per PLP share · live</span>
      </div>
      <div class="e05-sheet-stats">
        <div class="e05-sheet-stat">
          <span class="e05-ss-k">Pool · TVL</span>
          <span class="e05-ss-lead"></span>
          <span class="e05-ss-v is-blue tnum" data-sheet-tvl>…</span>
        </div>
        <div class="e05-sheet-stat">
          <span class="e05-ss-k">Your stake</span>
          <span class="e05-ss-lead"></span>
          <span class="e05-ss-v tnum" data-sheet-stake>—</span>
        </div>
        <div class="e05-sheet-stat">
          <span class="e05-ss-k">All-time yield</span>
          <span class="e05-ss-lead"></span>
          <span class="e05-ss-v is-blue tnum" data-sheet-yield>—</span>
        </div>
      </div>
      <div class="e05-field">
        <span class="e05-field-cur">$</span>
        <input type="number" inputmode="decimal" min="0" step="any" placeholder="0" data-dep-input aria-label="Deposit amount" />
        <span class="e05-field-presets">
          <button type="button" class="e05-fp tnum" data-dep-preset="100">100</button>
          <button type="button" class="e05-fp tnum" data-dep-preset="500">500</button>
          <button type="button" class="e05-fp tnum" data-dep-preset="1000">1k</button>
          <button type="button" class="e05-fp tnum" data-dep-max hidden>MAX</button>
        </span>
      </div>
      <button type="button" class="e05-sheet-cta" data-dep-cta>
        <span data-dep-cta-label>Become the house</span>
      </button>
      <div class="e05-sheet-foot">
        <span class="e05-variance" data-variance>
          Win USDC every time a player loses a bet. Withdraw anytime.
        </span>
        <button type="button" class="e05-cashout" data-addfunds hidden>Add funds ${ico('right', 0.9)}</button>
        <button type="button" class="e05-cashout" data-redeem hidden>Cash out of the house</button>
      </div>
    </div>

    <div class="e05-toast" data-toast hidden></div>
  `
  root.appendChild(fg)

  // ---------------------------------------------------------------- //
  //  4) refs
  // ---------------------------------------------------------------- //
  const $ = <T extends Element = HTMLElement>(sel: string): T =>
    fg.querySelector(sel) as T
  const acctEl = $('[data-acct]') as HTMLElement
  const cdEyebrowEl = $('[data-cd-eyebrow]')
  const cdMmEl = $('[data-cd-mm]')
  const cdSsEl = $('[data-cd-ss]')
  const cdTimeEl = $('.e05-cd-time') as HTMLElement
  const lockbarEl = $('[data-lockbar]') as HTMLElement
  const betStatusEl = $('[data-betstatus]')
  const tapeEl = $('[data-tape]') as HTMLElement
  const resultsEl = $('[data-results]') as HTMLElement
  const flashEl = $('[data-flash]') as HTMLElement

  const prebetEl = $('[data-prebet]') as HTMLElement
  const heldEl = $('[data-held]') as HTMLElement
  const heldEntryEl = $('[data-held-entry]')
  const heldNoteEl = $('[data-held-note]') as HTMLElement
  // Per-side position cards ("Exit Tickets"). One bundle of refs per side.
  type PosRefs = {
    card: HTMLElement
    ctr: HTMLElement
    eyebrow: HTMLElement
    hero: HTMLElement
    sub: HTMLElement
    math: HTMLElement
    pending: HTMLElement
    ifWin: HTMLElement
    gross: HTMLElement
    ifLose: HTMLElement
    cta: HTMLButtonElement
  }
  const posRefs = (k: 'up' | 'down'): PosRefs => ({
    card: $(`[data-pos-${k}]`) as HTMLElement,
    ctr: $(`[data-pos-${k}-ctr]`) as HTMLElement,
    eyebrow: $(`[data-pos-${k}-eyebrow]`) as HTMLElement,
    hero: $(`[data-pos-${k}-hero]`) as HTMLElement,
    sub: $(`[data-pos-${k}-sub]`) as HTMLElement,
    math: $(`[data-pos-${k}-math]`) as HTMLElement,
    pending: $(`[data-pos-${k}-pending]`) as HTMLElement,
    ifWin: $(`[data-pos-${k}-if]`) as HTMLElement,
    gross: $(`[data-pos-${k}-gross]`) as HTMLElement,
    ifLose: $(`[data-pos-${k}-iflose]`) as HTMLElement,
    cta: $(`[data-pos-${k}-cta]`) as HTMLButtonElement,
  })
  const posUpRefs = posRefs('up')
  const posDownRefs = posRefs('down')

  const tvlEl = $('[data-tvl]')
  const chgEl = $('[data-chg]')
  const yieldNumEl = $('[data-yield-num]')
  const yieldUnitEl = $('[data-yield-unit]')
  const projBlockEl = $('[data-proj-block]') as HTMLElement
  const stakeBlockEl = $('[data-stake-block]') as HTMLElement
  const stakeValEl = $('[data-stake-val]')
  const projFromEl = $('[data-proj-from]')
  const projEarnEl = $('[data-proj-earn]')
  const projTierEl = $('[data-proj-tier]')
  const utilEl = $('[data-util]')
  const sharePriceEl = $('[data-shareprice]')
  const yourStakeRow = $('[data-yourstake-row]') as HTMLElement
  const yourStakeEl = $('[data-yourstake]')

  const houseBtn = $('[data-house]') as HTMLButtonElement
  const houseWithdrawBtn = $('[data-house-withdraw]') as HTMLButtonElement
  const ctaLabelEl = $('[data-cta-label]')
  const scrimEl = $('[data-scrim]') as HTMLElement
  const sheetEl = $('[data-sheet]') as HTMLElement
  const backBtn = $('[data-back]') as HTMLButtonElement
  const sheetShareEl = $('[data-sheet-share]')
  const sheetTvlEl = $('[data-sheet-tvl]')
  const sheetStakeEl = $('[data-sheet-stake]')
  const sheetYieldEl = $('[data-sheet-yield]')
  const depInput = $('[data-dep-input]') as HTMLInputElement
  const depMaxBtn = $('[data-dep-max]') as HTMLButtonElement
  const depCta = $('[data-dep-cta]') as HTMLButtonElement
  const depCtaLabel = $('[data-dep-cta-label]')
  const redeemBtn = $('[data-redeem]') as HTMLButtonElement
  const addFundsBtn = $('[data-addfunds]') as HTMLButtonElement
  const toastEl = $('[data-toast]') as HTMLElement

  const winUp = $('[data-win-up]')
  const winDown = $('[data-win-down]')
  const multUp = $('[data-mult-up]')
  const multDown = $('[data-mult-down]')
  const costUp = $('[data-cost-up]')
  const costDown = $('[data-cost-down]')
  const doubleUp = $('[data-double-up]')
  const doubleDown = $('[data-double-down]')
  const chips = Array.from(
    fg.querySelectorAll('[data-stake]'),
  ) as HTMLButtonElement[]
  const customChip = $('[data-custom]') as HTMLButtonElement
  const customField = $('[data-custom-field]') as HTMLElement
  const customInput = $('[data-custom-input]') as HTMLInputElement
  const customMax = $('[data-custom-max]') as HTMLButtonElement
  const logoEl = $('[data-logo]') as HTMLAnchorElement
  const themeToggleEl = $('[data-theme-toggle]') as HTMLButtonElement
  const muteToggleEl = $('[data-mute]') as HTMLButtonElement

  // ---------------------------------------------------------------- //
  //  5) interaction state
  // ---------------------------------------------------------------- //
  let sheetOpen = false
  let customOpen = false
  // Tracks the last supplyDoneAt epoch we acted on, so a SUCCESSFUL supply closes
  // the deposit sheet exactly once (UX item I) — no success toast; the house
  // section below reflects the new position + WITHDRAW button.
  let lastSupplyDone = 0

  // ---------------------------------------------------------------- //
  //  7) controls -> host.actions
  // ---------------------------------------------------------------- //
  // SIGN-IN GATE: when NOT signed in, ANY control routes to the Google sign-in
  // instead of running its real action (and instead of being a dead no-op). The
  // render loop keeps controls ENABLED while signed-out so the click can fire.
  // Returns true when it handled the gate (caller should bail).
  const gateSignIn = (): boolean => {
    if (host.data.signedIn) return false
    host.actions.signInGoogle()
    return true
  }
  chips.forEach(chip => {
    chip.addEventListener('click', () => {
      if (gateSignIn()) return
      if (host.data.txPending) return
      if (host.data.locked) return
      closeCustom()
      host.actions.selectStake(Number(chip.dataset.stake))
    })
  })
  customChip.addEventListener('click', () => {
    if (gateSignIn()) return
    if (host.data.txPending) return
    if (host.data.locked) return
    openCustom()
  })
  function openCustom(): void {
    customOpen = true
    customField.hidden = false
    customChip.setAttribute('aria-pressed', 'true')
    customInput.value = String(host.data.stake)
    setTimeout(() => {
      try {
        customInput.focus()
      } catch {
        /* noop */
      }
    }, 0)
  }
  function closeCustom(): void {
    customOpen = false
    customField.hidden = true
    customChip.setAttribute('aria-pressed', 'false')
  }
  customInput.addEventListener('input', () => {
    const n = Math.floor(Number(customInput.value))
    if (Number.isFinite(n) && n >= 1) host.actions.setCustomStake(n)
  })
  customMax.addEventListener('click', () => {
    const m = host.data.maxAffordableUsd
    if (m != null && m >= 1) {
      customInput.value = String(m)
      host.actions.setCustomStake(m)
    }
  })

  fg.querySelectorAll('[data-bet]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (gateSignIn()) return
      // DUAL-SIDE + SERIALIZED: a tap routes to App's placeBet, which opens or GROWS
      // the matching side's bucket. While a BET is in flight the tap is QUEUED (never
      // a second concurrent bet tx); a conflicting write (cash-out / claim / supply /
      // redeem / withdraw) blocks the tap in App's placeBet. The disabled state
      // already greys an unavailable side; gate on `locked` AND on a non-bet write
      // holding the lock (txPending) here as belt-and-suspenders against SF7
      // equivocation (a multi-touch tap mid-supply reusing the same wallet coins).
      if (host.data.locked) return
      if (host.data.txPending) return
      host.actions.placeBet(
        (btn as HTMLElement).dataset.bet === 'UP' ? 'UP' : 'DOWN',
      )
    })
  })

  // Per-side cash-out / claim. Each side's CTA exits ONLY that bucket (or, once the
  // round is settled, fires the shared auto-claim path). The two cards resolve
  // independently — cashing out UP leaves DOWN open.
  const onPosCta = (side: 'UP' | 'DOWN') => () => {
    if (host.data.txPending) return
    const h = host.data.held
    if (!h) return
    if (h.settled) host.actions.claimBet()
    else host.actions.cashOutSide(side)
  }
  posUpRefs.cta.addEventListener('click', onPosCta('UP'))
  posDownRefs.cta.addEventListener('click', onPosCta('DOWN'))

  logoEl.addEventListener('click', e => {
    e.preventDefault()
    host.actions.goToBet()
  })

  // ---------------------------------------------------------------- //
  //  7b) DARK / LIGHT THEME — toggle, persist, apply on load.
  // ---------------------------------------------------------------- //
  //  Sets document.documentElement.dataset.theme = 'dark' | '' (the chart canvas
  //  reads this attribute itself — handled elsewhere; styles.css supplies the
  //  :root[data-theme=dark] token overrides + the smooth transition). Choice is
  //  persisted in localStorage and re-applied on every load.
  const THEME_KEY = 'crash:theme'
  function readStoredTheme(): 'dark' | 'light' | null {
    try {
      const v = localStorage.getItem(THEME_KEY)
      return v === 'dark' || v === 'light' ? v : null
    } catch {
      return null
    }
  }
  function applyTheme(dark: boolean): void {
    if (dark) document.documentElement.dataset.theme = 'dark'
    else delete document.documentElement.dataset.theme
    themeToggleEl.setAttribute('aria-pressed', String(dark))
    themeToggleEl.setAttribute(
      'aria-label',
      dark ? 'Switch to light mode' : 'Switch to dark mode',
    )
    themeToggleEl.title = dark ? 'Switch to light mode' : 'Switch to dark mode'
    // Drive the SVG sun/moon morph via a single class. In dark the SUN shows
    // (tap to go light); in light the MOON shows (tap to go dark). The crossfade
    // + rotate is pure CSS (see .e05-theme.is-dark below) and respects
    // prefers-reduced-motion. The icon itself is set in the .e05-ico-* opacity.
    themeToggleEl.classList.toggle('is-dark', dark)
  }
  // initial: stored choice wins, else honour the OS preference.
  const stored = readStoredTheme()
  const prefersDark =
    window.matchMedia &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
  let isDark = stored ? stored === 'dark' : Boolean(prefersDark)
  applyTheme(isDark)
  themeToggleEl.addEventListener('click', () => {
    isDark = !isDark
    applyTheme(isDark)
    try {
      localStorage.setItem(THEME_KEY, isDark ? 'dark' : 'light')
    } catch {
      /* noop — private mode etc. */
    }
  })

  // SOUND MUTE — reflect sfx.is_muted() (persisted in localStorage by sfx) into the
  // header speaker icon; clicking toggles + persists via sfx.set_muted (which rides
  // the master gain to 0 AND every cue early-returns while muted, so this silences
  // EVERYTHING — taps, ticks, tension, heartbeat, win/loss). Independent of the
  // settling-bip gate: muted == always silent; settling == silent regardless.
  const renderMute = (): void => {
    const m = sfx.is_muted()
    muteToggleEl.innerHTML = ico(m ? 'volumeMute' : 'volume', 1.05)
    muteToggleEl.classList.toggle('is-muted', m)
    muteToggleEl.setAttribute('aria-pressed', m ? 'true' : 'false')
    muteToggleEl.setAttribute('aria-label', m ? 'Unmute sound' : 'Mute sound')
    muteToggleEl.title = m ? 'Sound off — tap to unmute' : 'Sound on — tap to mute'
  }
  renderMute()
  muteToggleEl.addEventListener('click', () => {
    sfx.toggle_mute()
    renderMute()
  })

  // ---------------------------------------------------------------- //
  //  8) DEPOSIT sheet — slide up over a --scrim-dimmed live surface
  // ---------------------------------------------------------------- //
  function openSheet(): void {
    sheetOpen = true
    scrimEl.classList.add('is-open')
    sheetEl.classList.add('is-open')
    host.actions.becomeHouse()
    setTimeout(() => {
      try {
        depInput.focus()
      } catch {
        /* noop */
      }
    }, 130)
  }
  function closeSheet(): void {
    sheetOpen = false
    scrimEl.classList.remove('is-open')
    sheetEl.classList.remove('is-open')
  }
  houseBtn.addEventListener('click', () => {
    if (gateSignIn()) return
    if (host.data.txPending) return
    if (houseBtn.disabled) return
    openSheet()
  })
  backBtn.addEventListener('click', closeSheet)
  scrimEl.addEventListener('click', closeSheet)
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' && sheetOpen) closeSheet()
  }
  window.addEventListener('keydown', onKey)

  fg.querySelectorAll('[data-dep-preset]').forEach(btn => {
    btn.addEventListener('click', () => {
      depInput.value = (btn as HTMLElement).dataset.depPreset || ''
    })
  })
  depMaxBtn.addEventListener('click', () => {
    const w = host.data.house.walletDusdcUsd
    if (w != null && w > 0) depInput.value = w.toFixed(2)
  })
  depCta.addEventListener('click', () => {
    if (host.data.txPending) return
    const v = Number(String(depInput.value).replace(/[^0-9.]/g, '')) || 0
    if (v > 0) host.actions.supply(v)
  })
  redeemBtn.addEventListener('click', () => {
    if (host.data.txPending) return
    host.actions.redeemHouse()
  })
  // WITHDRAW FROM HOUSE (in the house section, UX item I) — same redeem/withdraw
  // handler (router redeem_lp via useHouse) as the in-sheet cash-out control.
  houseWithdrawBtn.addEventListener('click', () => {
    if (gateSignIn()) return
    if (host.data.txPending) return
    if (houseWithdrawBtn.disabled) return
    host.actions.redeemHouse()
  })
  addFundsBtn.addEventListener('click', () => host.actions.addFunds())

  // ---------------------------------------------------------------- //
  //  9) LIVE TAPE — bottom-left ledger; render the host's tape array
  // ---------------------------------------------------------------- //
  let lastTapeId = -1
  function renderTape(): void {
    const rows = host.data.tape
    const newest = rows[0]
    if (!newest || newest.id === lastTapeId) return
    lastTapeId = newest.id
    // ALL rows stay in normal ink — no "is-old" half-grey muting. The subtle
    // top fade-mask on .e05-tape is the only ageing cue. UP green / DOWN red.
    tapeEl.innerHTML = rows
      .map(bet => {
        const sideCls = bet.side === 'UP' ? 'e05-side--up' : 'e05-side--down'
        const arrow = bet.side === 'UP' ? ico('up', 0.85) : ico('down', 0.85)
        return (
          `<div class="e05-row ed-stream">` +
          `<span class="e05-name">${escapeHtml(bet.name)}</span>` +
          `<span class="e05-verb">bet</span>` +
          `<span class="e05-amt tnum">$${fmt(bet.amountUsd)}</span>` +
          `<span class="e05-side ${sideCls}"><span class="e05-tape-arrow">${arrow}</span> ${bet.side}</span>` +
          `</div>`
        )
      })
      .join('')
  }
  function escapeHtml(s: string): string {
    return s.replace(
      /[&<>"]/g,
      c =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] || c,
    )
  }

  // ---------------------------------------------------------------- //
  //  9b) RESULTS LOG — top-right, recent settled outcomes (UX item V)
  // ---------------------------------------------------------------- //
  //  Rendered from host.data.results (already most-recent-first + capped). Each
  //  row reads "+$2.00  UP ✓" (green) / "−$1.00  DOWN ✗" (red). Re-rendered only
  //  when the newest entry's id changes (cheap; rows are otherwise immutable).
  let lastResultId = -1
  // A signed P&L in CENTS — "+$0.03" / "−$0.12" / "+$53" — matching the settle
  // TOAST (announce_outcome) to the cent so a +$0.43 win never reads "+$0.4" and a
  // +$0.03 win never reads "+$0.0" (ZERO). 2 decimals under $10, whole + separators
  // above. The history ledger row and the toast share fmt_signed_cents now.
  const fmtPnl = (usd: number): string => fmt_signed_cents(usd)
  function renderResults(): void {
    const rows = host.data.results
    const newest = rows[0]
    const headId = newest ? newest.id : -1
    if (headId === lastResultId) return
    lastResultId = headId
    if (!newest) {
      resultsEl.innerHTML = ''
      return
    }
    const body = rows
      .map(r => {
        const cls = r.won ? 'win' : 'loss'
        const side = r.isUp ? 'UP' : 'DOWN'
        const mark = r.won ? ico('check', 0.95) : ico('x', 0.95)
        return (
          `<div class="e05-res-row ${cls}">` +
          `<span class="e05-res-amt tnum">${fmtPnl(r.pnlUsd)}</span>` +
          `<span class="e05-res-side">${side} <span class="e05-res-mark">${mark}</span></span>` +
          `</div>`
        )
      })
      .join('')
    // D2: history now sources realized rows (wins INCLUDED) from the on-chain
    // PositionRedeemed events, so the old "Past wins may not show after a refresh"
    // apology no longer applies and was DELETED.
    resultsEl.innerHTML = `<div class="e05-results-head">Recent</div>${body}`
  }

  // ---------------------------------------------------------------- //
  //  10) FLASH — fire the settle wash when host.data.flash changes
  // ---------------------------------------------------------------- //
  let lastFlash: 'win' | 'lose' | null = null
  function syncFlash(): void {
    const f = host.data.flash
    if (f === lastFlash) return
    lastFlash = f
    if (!f) return
    if (reduceMotion) return
    flashEl.classList.remove('is-up', 'is-down')
    void flashEl.offsetWidth
    flashEl.classList.add(f === 'win' ? 'is-up' : 'is-down')
  }
  // a bet placement also breathes the chart (signature inhale)
  let lastBetSide: 'UP' | 'DOWN' | null = null

  // ---------------------------------------------------------------- //
  //  11) TOP-RIGHT ACCOUNT CLUSTER — balance + identity + sign out
  // ---------------------------------------------------------------- //
  //  Rebuilt only when the account STATE changes (signed-in / wallet / address);
  //  the live balance text + copy confirmation are updated each frame via the
  //  refs captured here. The balance now lives in this cluster (not lost mid-page).
  let acctState = ''
  let acctBalEl: HTMLElement | null = null
  let acctAddrLabelEl: HTMLElement | null = null
  let copiedTimer = 0
  function showCopied(): void {
    if (!acctAddrLabelEl) return
    acctAddrLabelEl.textContent = 'Copied'
    acctAddrLabelEl.classList.add('e05-acct-copied')
    window.clearTimeout(copiedTimer)
    copiedTimer = window.setTimeout(() => {
      if (acctAddrLabelEl) {
        acctAddrLabelEl.textContent = host.data.addressShort
        acctAddrLabelEl.classList.remove('e05-acct-copied')
      }
    }, 1200)
  }
  function copyAddr(): void {
    const full = host.data.addressFull
    if (!full) return
    try {
      navigator.clipboard?.writeText(full).then(showCopied, showCopied)
    } catch {
      showCopied()
    }
  }
  function renderAcct(): void {
    const d = host.data
    const key = `${d.signedIn}|${d.googleWallet}|${d.connecting}|${d.addressShort}|${d.managerHasBalance}`
    if (key === acctState) return
    acctState = key
    // The theme toggle is a PERMANENT sibling that lives OUTSIDE this rebuilt
    // region (a static last-child of .e05-acct, to the right of acctEl). We NEVER
    // move it here — so `acctEl.innerHTML = ''` can't destroy it and there is no
    // insertBefore cycle. renderAcct only owns acctEl's contents.
    acctEl.innerHTML = ''
    acctBalEl = null
    acctAddrLabelEl = null
    if (d.signedIn) {
      // ONE cohesive header row, read as a single unit via two grouped halves
      // separated by a hairline:
      //   [ IDENTITY: Balance(gold) · hex-pill ]  |  [ ACTIONS: Add funds · Sign out ]
      // plus the persistent theme toggle pinned at the far right. Balance keeps
      // the single deliberate gold accent; the hex pill stays subtle; Add funds +
      // Sign out are TRUE siblings sharing the SAME muted-ink .e05-link style.
      const idWrap = document.createElement('div')
      idWrap.className = 'e05-acct-id'

      const balRow = document.createElement('div')
      balRow.className = 'e05-acct-bal'
      const balLbl = document.createElement('span')
      balLbl.className = 'e05-bal-lbl'
      balLbl.textContent = 'Balance'
      acctBalEl = document.createElement('span')
      acctBalEl.className = 'e05-bal-val tnum'
      acctBalEl.textContent = d.balanceStr
      balRow.append(balLbl, acctBalEl)

      // Identity: truncated, click-to-copy hex address (no SuiNS resolver wired).
      const addrBtn = document.createElement('button')
      addrBtn.type = 'button'
      addrBtn.className = 'e05-acct-addr'
      addrBtn.title = 'Copy address'
      addrBtn.setAttribute('aria-label', 'Copy wallet address')
      acctAddrLabelEl = document.createElement('span')
      acctAddrLabelEl.textContent = d.addressShort
      addrBtn.appendChild(acctAddrLabelEl)
      addrBtn.addEventListener('click', copyAddr)

      idWrap.append(balRow, addrBtn)

      // ACTIONS group — Add funds + Sign out as identical muted-ink siblings.
      const actions = document.createElement('div')
      actions.className = 'e05-acct-actions'
      const funds = document.createElement('button')
      funds.type = 'button'
      funds.className = 'e05-link'
      funds.textContent = 'Add funds'
      funds.addEventListener('click', () => host.actions.addFunds())
      const out = document.createElement('button')
      out.type = 'button'
      out.className = 'e05-link'
      out.textContent = 'Sign out'
      out.addEventListener('click', () => host.actions.signOut())
      actions.append(funds, out)

      // acctEl gets ONLY its own rebuilt content: [identity] | [actions]. The
      // theme toggle is the permanent sibling to acctEl's right (in .e05-acct),
      // so the rendered header still reads [identity] | [actions] (☼/☾).
      acctEl.append(idWrap, actions)
    } else if (d.googleWallet) {
      const inBtn = document.createElement('button')
      inBtn.className = 'e05-link is-accent'
      if (d.connecting) inBtn.innerHTML = LOADING('Signing in')
      else inBtn.textContent = 'Sign in'
      inBtn.disabled = d.connecting
      inBtn.addEventListener('click', () => host.actions.signInGoogle())
      acctEl.appendChild(inBtn)
    }
    // else: no Enoki Google wallet — App renders a real dapp-kit <ConnectButton>
    // overlay (top-right, OUTSIDE the .e05 scope so the wallet modal keeps its
    // own dist/index.css). The e05 acct slot stays empty in that case.
  }

  // The ONE editorial busy indicator — a hairline sweep that inherits the
  // host control's ink (white on the blue CTAs, blue on links, bull/bear on
  // the bet buttons). aria-hidden: the disabled state already conveys "busy"
  // to assistive tech, and the verb label states WHAT is in flight.
  const LOADER = '<span class="e05-load" aria-hidden="true"><i></i></span>'
  // a verb + trailing sweep, e.g. "Withdrawing <bar>" — keeps the user
  // informed of WHICH action is pending while it runs.
  const LOADING = (label: string): string =>
    label + '<span class="e05-load is-trailing" aria-hidden="true"><i></i></span>'

  // ---------------------------------------------------------------- //
  //  12) ONE rAF — sync all foreground text from host.data
  // ---------------------------------------------------------------- //
  let raf = 0
  // RAF ROBUSTNESS: a per-frame throw must NEVER permanently kill this loop while
  // the React side keeps updating host.data (the screen would silently freeze). We
  // run the body in a try, log ONCE, and ALWAYS reschedule from the finally.
  let tickErrored = false
  function tick(): void {
    try {
      tickBody()
    } catch (err) {
      if (!tickErrored) {
        tickErrored = true
        console.error('[crash-e05] tick() frame error (loop kept alive):', err)
      }
    } finally {
      raf = requestAnimationFrame(tick)
    }
  }
  function tickBody(): void {
    const d = host.data

    // root locked class
    root.classList.toggle('e05-is-locked', d.locked && !d.held)
    // GLOBAL ACTION LOCK: while a sponsored write is in flight, the root carries
    // .e05-is-pending — every action control fades inert (CSS) AND gets disabled
    // below. A second click can never start another action.
    const pending = d.txPending
    root.classList.toggle('e05-is-pending', pending)

    // top-right account cluster: rebuild on state change, then keep the live
    // balance text fresh each frame (the cluster holds the balance now).
    renderAcct()
    if (acctBalEl) acctBalEl.textContent = d.balanceStr

    // countdown masthead
    const held = d.held
    // VALIDATING ROUND — the round is over / settling and no live bettable round
    // exists yet (App's `validating`). It is a PRE-BET state (no held position),
    // so it only applies when nothing is held. It REPLACES the old 3-dots flash:
    // the masthead reads "VALIDATING ROUND" with the hairline loader sweeping as a
    // motion cue, plus a small "Ns" settlement-window countdown when derivable.
    const validating = d.validating && !held
    // HELD-BET SETTLING — the held analogue of `validating`: the held round is
    // past expiry / settling, so the masthead must show the SAME editorial
    // SETTLING treatment (shrunk "SETTLING ROUND" clock + the hairline loader
    // sweep as the motion cue) instead of the old "…". The real mm:ss timer
    // keeps showing the true remaining time for the WHOLE live round; only once
    // the round is over does this settling treatment take over.
    const heldSettling = Boolean(held && held.countdownSpecial === 'settling')
    // The masthead reads the editorial settling state whenever EITHER the pre-bet
    // validation window OR a held-bet settles — both swap the giant clock for the
    // words + the sweeping hairline (no "…").
    const settlingMasthead = validating || heldSettling
    cdEyebrowEl.textContent = heldSettling
      ? 'Settling on-chain'
      : held
        ? 'Round locks at settle'
        : validating
          ? 'Settling on-chain'
          : d.cdWarn
            ? 'Waiting for next round'
            : 'Round locks in'
    cdEyebrowEl.classList.toggle(
      'is-warn',
      heldSettling || ((d.cdWarn || validating) && !held),
    )
    cdTimeEl.classList.toggle('urgent', d.cdClass === 'urgent' && !settlingMasthead)
    // .validating shrinks the giant mono clock to fit the "SETTLING ROUND" words
    // and the hairline loader animates an indeterminate sweep as the motion cue.
    cdTimeEl.classList.toggle('validating', settlingMasthead)
    lockbarEl.parentElement?.classList.toggle('is-loading', settlingMasthead)
    if (settlingMasthead) {
      // Held-settling and pre-bet validation share the editorial treatment. BOTH
      // show the live ~15s settlement-window "Ns" counter (item #5): held-settling
      // derives it from the position's expiry (held.settlingSecs), pre-bet from the
      // oracle's expiry (d.validatingSecs). Blank only once the window elapses (the
      // label + sweeping hairline then carry the state on their own).
      cdMmEl.textContent = heldSettling ? 'SETTLING ROUND' : 'VALIDATING ROUND'
      const secs = heldSettling
        ? (held ? held.settlingSecs : null)
        : d.validatingSecs
      cdSsEl.textContent = secs != null ? ' ' + secs + 's' : ''
    } else if (held) {
      // LIVE held round — show the REAL remaining mm:ss (never "…").
      cdMmEl.textContent = held.countdownText.split(':')[0]
      cdSsEl.textContent = ':' + (held.countdownText.split(':')[1] ?? '00')
    } else {
      cdMmEl.textContent = d.countdownMm
      cdSsEl.textContent = ':' + d.countdownSs
    }
    // While the settling treatment is on the hairline sweeps indeterminately (CSS
    // animation), so the inline width is irrelevant; otherwise it drives the
    // lock-drain fill.
    lockbarEl.style.width = settlingMasthead
      ? ''
      : (d.lockFrac * 100).toFixed(1) + '%'

    // pre-bet vs held. Belt-and-suspenders: the held cluster (and its cash-out /
    // claim CTA) ONLY renders when signed in AND a live bet is held. `held` is
    // already null when signed-out (App clears the bet on disconnect), but gate
    // on d.signedIn too so NO cash-out control can ever paint logged-out.
    const showHeld = Boolean(held) && d.signedIn
    // DUAL-SIDE MODEL: keep the UP/DOWN bet buttons LIVE alongside the held cluster
    // while the round is STILL BETTABLE (not locked / pending / settled), so the
    // user can keep GROWING the position on EITHER side (both are enabled via
    // d.up/down.enabled — a tap folds into that side's bucket). Once the round locks
    // or starts settling, hide the controls and show the held cluster only.
    const heldStillBettable =
      showHeld && !d.locked && !held!.pending && !held!.settled
    const showPrebet = !showHeld || heldStillBettable
    prebetEl.hidden = !showPrebet
    heldEl.hidden = !showHeld

    // A cleared bet (no held position at all) returns the chart to neutral +
    // re-arms the next breathe. Keyed on !showHeld (NOT showPrebet): while
    // accumulating, the pre-bet controls are shown WITH a held bet, and the chart
    // must keep its decision tint — so we only reset when nothing is held.
    if (!showHeld && lastBetSide != null) {
      baseHandle.clearSide()
      lastBetSide = null
    }

    // Render the pre-bet controls whenever they're shown (fresh OR accumulating).
    if (showPrebet) {
      // bet buttons — STANDARD FIXED-STAKE BINARY MODEL. The BIG number is the WIN
      // (the payout if this side is right); it DIFFERS per side because UP and DOWN
      // carry different implied odds (the less-likely side pays more). The sub-line
      // is the WAGER — the SAME constant on both buttons (the selected stake = what
      // you pay, silently incl. the on-chain 3% rake; the wager never varies by
      // side). The multiple (win / wager) is the secondary number next to the WIN.
      // NO GATING (owner): both sides ALWAYS render their REAL numbers — a near-1.0x
      // favorite shows ~1.0x, a 1.7x longshot shows 1.7x, both bettable. The WIN is
      // real once a per-side quote has loaded (costUsd != null == quoted); before
      // that the number would be the static stake×2 fallback, so render MUTED
      // "Pricing…" (the .is-pricing class greys the headline). "DOUBLE YOUR MONEY"
      // only when the REAL multiple is genuinely ~2x (d.up.double), never slapped on
      // a 1.0x/1.7x side.
      const upQuoted = d.up.costUsd != null
      const downQuoted = d.down.costUsd != null
      winUp.textContent = upQuoted ? fmtC(d.up.win) : 'Pricing…'
      winDown.textContent = downQuoted ? fmtC(d.down.win) : 'Pricing…'
      winUp.classList.toggle('is-pricing', !upQuoted)
      winDown.classList.toggle('is-pricing', !downQuoted)
      multUp.textContent =
        upQuoted && d.up.multiple != null ? ' · ' + fmtMult(d.up.multiple) : ''
      multDown.textContent =
        downQuoted && d.down.multiple != null ? ' · ' + fmtMult(d.down.multiple) : ''
      costUp.textContent =
        d.up.costUsd != null ? 'Wager ' + fmtC(d.up.costUsd) : ' '
      costDown.textContent =
        d.down.costUsd != null ? 'Wager ' + fmtC(d.down.costUsd) : ' '
      doubleUp.classList.toggle('is-on', d.up.double)
      doubleDown.classList.toggle('is-on', d.down.double)
      // When NOT signed in, keep controls ENABLED so a click can fire and route
      // to the Google sign-in (gateSignIn). The affordability/enabled gating only
      // applies once the user is in. STACKABLE: bet taps do NOT set `pending`, so
      // the buttons stay tappable while bets are mid-flight (the optimistic stack).
      // `pending` is the CONFLICTING-action lock (cash out / claim / house) — it
      // freezes betting only while the position is being settled, which is correct.
      ;(fg.querySelector('[data-bet="UP"]') as HTMLButtonElement).disabled =
        d.signedIn && (pending || !d.up.enabled || d.busyUp)
      ;(fg.querySelector('[data-bet="DOWN"]') as HTMLButtonElement).disabled =
        d.signedIn && (pending || !d.down.enabled || d.busyDown)
      if (d.busyUp) winUp.innerHTML = LOADER
      if (d.busyDown) winDown.innerHTML = LOADER

      // stake chips pressed state
      if (!customOpen) {
        chips.forEach(c =>
          c.setAttribute(
            'aria-pressed',
            String(Number(c.dataset.stake) === d.stake),
          ),
        )
      }
      chips.forEach(c => {
        c.disabled =
          d.signedIn &&
          (pending || d.locked || !d.canAfford(Number(c.dataset.stake)))
      })
      customChip.disabled = d.signedIn && (pending || d.locked)
      // custom max hint
      if (customOpen && d.maxAffordableUsd != null && d.maxAffordableUsd >= 1) {
        customMax.hidden = false
        customMax.textContent = 'MAX $' + d.maxAffordableUsd
      } else {
        customMax.hidden = true
      }

      // betstatus line: locked OR a sign-in prompt
      if (d.locked) {
        betStatusEl.textContent = d.betStatusText
        betStatusEl.classList.add('is-shown')
      } else if (!d.signedIn) {
        betStatusEl.textContent = d.googleWallet
          ? 'Sign in to play — no seed phrase, no gas'
          : 'Connect a wallet to play'
        betStatusEl.classList.add('is-shown')
      } else {
        betStatusEl.classList.remove('is-shown')
      }
    }

    // Held cluster renders whenever a live bet is held — independently of the
    // pre-bet controls, which may be shown SIMULTANEOUSLY while the round is still
    // bettable (accumulation). TWO DISTINCT POSITIONS: a shared header + up to two
    // per-side cards, each with its OWN cash-out button.
    if (showHeld && held) {
      heldEntryEl.textContent = held.entryStr

      // Chart breathe: when exactly ONE side is held, breathe that side (the chart
      // tint already follows chartWinning). When both are held, don't flap the
      // breathe — leave the last side cue in place.
      const onlyUp = held.sides.up && !held.sides.down
      const onlyDown = held.sides.down && !held.sides.up
      const s: 'UP' | 'DOWN' | null = onlyUp ? 'UP' : onlyDown ? 'DOWN' : null
      if (s != null && s !== lastBetSide) {
        baseHandle.breathe(s)
        lastBetSide = s
      }

      // Render ONE "Exit Ticket". The card CHROME (state gradient / border / glow /
      // hero colour) binds to the P&L SIGN via vm.state — NOT the side — re-skinning
      // ATOMICALLY here on the same tick that sets the hero digit. While SETTLING the
      // card is forced NEUTRAL grey (outcome unknown — never fake-tint) and the NOW
      // block is swapped for the two honest IF→get outcomes.
      const renderPos = (vm: SideVM | undefined, r: PosRefs) => {
        if (!vm) {
          r.card.hidden = true
          return
        }
        r.card.hidden = false
        r.ctr.textContent = vm.contractsStr.replace(' contracts', ' ctr')
        // CARD STATE class — drives ALL chrome (see .e05-pos.is-* rules). While
        // settling we force 'lock' (neutral, outcome unknown).
        const stateCls = vm.settling ? 'lock' : vm.state
        r.card.className = 'e05-pos is-' + stateCls

        if (vm.settling) {
          // LOCKED — outcome unknown. Swap the NOW block for "SETTLING ROUND…" +
          // payout pending, show BOTH honest outcomes, disable the cash-out. The
          // rail/chrome stay NEUTRAL grey (never fake-tint an unknown outcome).
          r.eyebrow.textContent = 'Settling round…'
          r.hero.textContent = '—'
          r.hero.className = 'e05-pos-hero tnum is-lock'
          r.sub.textContent = 'payout pending'
          r.sub.className = 'e05-pos-sub is-lock'
          r.math.hidden = true
          r.pending.hidden = true
          r.ifWin.textContent = vm.ifWinsStr
          r.gross.hidden = true
          r.ifLose.hidden = false
          r.ifLose.textContent = vm.ifLosesStr
          r.cta.className = 'e05-pos-cta is-inert'
          // While the oracle has SETTLED, the shared auto-claim is in flight — show
          // that motion; otherwise the round is still settling (no cash-out).
          r.cta.innerHTML = held.settled
            ? LOADING('Claiming')
            : 'Cash out closed · settling'
          r.cta.disabled = true
          return
        }

        // LIVE — NOW block reflects the live P&L.
        r.eyebrow.textContent = 'Now · if you exit'
        r.hero.textContent = vm.liveNetStr
        r.hero.className = 'e05-pos-hero tnum is-' + vm.state
        r.sub.textContent = vm.nowSublabel
        r.sub.className = 'e05-pos-sub is-' + vm.state
        r.math.hidden = false
        r.math.textContent = `${vm.exitValueStr} · ${vm.paidStr}`
        r.pending.hidden = true
        // The conditional settle line — label stays quiet/grey; the PRIZE NUMBER is
        // bright high-contrast NEUTRAL (never green/red — it is the conditional, not
        // live P&L). label + number are app-controlled strings (no user input).
        r.ifWin.innerHTML =
          `IF ${vm.side} WINS AT SETTLE ` +
          `<span class="e05-pos-if-num">${vm.profitIfRightStr}</span>`
        r.gross.hidden = false
        r.gross.textContent = vm.totalIfSettledStr
        r.ifLose.hidden = true

        // Cash-out button — signed live net, green/red, agreeing with the hero.
        r.cta.className =
          'e05-pos-cta ' + (vm.cashoutPositive ? 'net-pos' : 'net-neg')
        if (held.settled) {
          r.cta.innerHTML = LOADING('Claiming')
          r.cta.disabled = pending || held.busyClaim
        } else {
          r.cta.innerHTML = vm.busyCashout
            ? LOADING('Cashing out')
            : vm.cashoutCtaStr
          r.cta.disabled =
            pending || vm.busyCashout || held.pending || !vm.canCashout
        }
      }
      renderPos(held.sides.up, posUpRefs)
      renderPos(held.sides.down, posDownRefs)

      // Shared note: trading-frozen (pending) or the settling auto-claim line.
      if (held.pending) {
        heldNoteEl.hidden = false
        heldNoteEl.textContent =
          'Trading frozen until the oracle settles — your payout auto-claims if you’re right.'
      } else if (held.settling) {
        heldNoteEl.hidden = false
        heldNoteEl.textContent =
          'Round over — settling on-chain. Each side resolves on its own; winners auto-claim.'
      } else {
        heldNoteEl.hidden = true
      }
    }

    // tape + results log + flash
    renderTape()
    renderResults()
    syncFlash()

    // ---- HOUSE FOOTER ----
    const hs = d.house
    // UX item I: a SUCCESSFUL supply closes the deposit sheet exactly once. The
    // house section (below) now shows the user's position + the WITHDRAW button —
    // there is no success toast (item J).
    if (hs.supplyDoneAt > lastSupplyDone) {
      lastSupplyDone = hs.supplyDoneAt
      if (sheetOpen) closeSheet()
    }
    tvlEl.textContent = hs.tvlStr
    chgEl.textContent = hs.shareChgStr
    yieldNumEl.textContent = hs.yieldStr
    yieldUnitEl.textContent = hs.yieldUnit
    // UX item #6: while HOLDING, the prominent house figure is the user's REAL
    // stake (labeled "Your stake") — NOT the betting wallet. The depositable-funds
    // PROJECTION is shown to NON-holders only. Toggle the two blocks accordingly.
    if (hs.hasPosition && hs.positionValueStr != null) {
      stakeBlockEl.hidden = false
      projBlockEl.hidden = true
      stakeValEl.textContent = hs.positionValueStr
    } else {
      stakeBlockEl.hidden = true
      projBlockEl.hidden = false
      projFromEl.textContent = hs.projFromStr
      projEarnEl.textContent = hs.projEarnStr
      projTierEl.textContent = hs.projTierStr
    }
    utilEl.textContent = hs.utilizationStr
    sharePriceEl.textContent = hs.sharePriceStr
    yourStakeRow.hidden = hs.yourStakeStr == null
    if (hs.yourStakeStr != null) yourStakeEl.textContent = hs.yourStakeStr
    ctaLabelEl.textContent = hs.ctaLabel
    // stays clickable while signed-out so the click routes to Google sign-in;
    // once signed in, the GLOBAL lock disables it while a write is in flight.
    houseBtn.disabled = d.signedIn && pending

    // WITHDRAW FROM HOUSE (UX item I): shown in the house section whenever the
    // user holds a position. Label carries the position value so the stake +
    // withdraw are both visible right here, no toast/popup needed.
    houseWithdrawBtn.hidden = !(d.signedIn && hs.hasPosition)
    if (d.signedIn && hs.hasPosition) {
      houseWithdrawBtn.disabled = pending || hs.redeemBusy
      if (hs.redeemBusy) houseWithdrawBtn.innerHTML = LOADING('Withdrawing')
      else
        houseWithdrawBtn.textContent =
          'Withdraw from house' +
          (hs.positionValueStr ? ' · ' + hs.positionValueStr : '')
    }

    // sheet contents
    sheetShareEl.textContent = hs.sharePriceStr
    sheetTvlEl.textContent = hs.tvlStr
    sheetStakeEl.textContent = hs.positionValueStr ?? (d.signedIn ? '$0.00' : '—')
    sheetYieldEl.textContent = hs.yieldStr
    if (hs.supplyBusy) depCtaLabel.innerHTML = LOADING('Supplying')
    else depCtaLabel.textContent = hs.ctaLabel
    const depV = Number(String(depInput.value).replace(/[^0-9.]/g, '')) || 0
    // GLOBAL lock: the deposit-sheet confirm is blocked while any write is in
    // flight (canSupply already returns false while supply is busy via useHouse,
    // but the global lock also blocks it while a DIFFERENT action is pending).
    depCta.disabled = pending || !hs.canSupply(depV) || hs.supplyBusy
    depMaxBtn.hidden = !(hs.walletDusdcUsd != null && hs.walletDusdcUsd > 0)
    // Belt-and-suspenders: NEVER show any "cash out of the house" control while
    // signed-out (hasPosition can only be true when signed in, but gate anyway).
    redeemBtn.hidden = !(d.signedIn && hs.hasPosition)
    if (d.signedIn && hs.hasPosition) {
      redeemBtn.disabled = pending || hs.redeemBusy
      if (hs.redeemBusy) redeemBtn.innerHTML = LOADING('Cashing out')
      else
        redeemBtn.textContent =
          'cash out of the house' +
          (hs.positionValueStr ? ' · ' + hs.positionValueStr : '')
    }
    addFundsBtn.hidden = !(
      d.signedIn &&
      !hs.hasPosition &&
      (hs.walletDusdcUsd ?? 0) <= 0
    )

    // ---- TOAST ----
    const toastMsg = hs.error || d.error
    const okMsg = !toastMsg ? d.notice : null
    if (toastMsg) {
      toastEl.hidden = false
      toastEl.className = 'e05-toast err'
      toastEl.textContent = toastMsg
    } else if (okMsg) {
      // T + U: a notice carries a flavour — 'win' (green) / 'loss' (red) for the
      // concise settle toast, else the neutral blue 'ok' info line.
      const kindCls =
        d.noticeKind === 'win'
          ? 'win'
          : d.noticeKind === 'loss'
            ? 'loss'
            : 'ok'
      toastEl.hidden = false
      toastEl.className = 'e05-toast ' + kindCls
      toastEl.textContent = okMsg
    } else if (d.reconstructFailed && !d.held) {
      toastEl.hidden = false
      toastEl.className = 'e05-toast muted'
      toastEl.textContent = "Couldn't load your open position — retrying…"
    } else {
      toastEl.hidden = true
    }
    // (the reschedule lives in tick()'s finally — keeps the loop alive on a throw)
  }
  function fmtMult(m: number): string {
    return (m >= 10 ? m.toFixed(0) : m.toFixed(1)).replace(/\.0$/, '') + 'x'
  }
  raf = requestAnimationFrame(tick)

  // ---------------------------------------------------------------- //
  //  13) TEARDOWN
  // ---------------------------------------------------------------- //
  return function teardown(): void {
    baseHandle.teardown()
    cancelAnimationFrame(raf)
    window.clearTimeout(copiedTimer)
    window.removeEventListener('keydown', onKey)
    if (style.parentNode) style.parentNode.removeChild(style)
    if (fg.parentNode) fg.parentNode.removeChild(fg)
  }
}
