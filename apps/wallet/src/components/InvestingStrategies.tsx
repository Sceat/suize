/**
 * InvestingStrategies — the AI INVESTING account's detail pane.
 *
 * REDESIGNED (journal refinement — ONE SPLIT-BAR, founder rework): the three
 * strategy tiers — Passive / Trading / GameFi — share a SINGLE horizontal bar of
 * three proportional segments. You tune the split by DRAGGING the two dividers
 * between segments (or focusing a divider and nudging with Arrow keys). Dragging a
 * divider trades % ONLY between its two adjacent segments — the third is
 * mathematically untouched — so the three ALWAYS sum to exactly 100. A tier at 0%
 * is simply an empty segment (no separate on/off control). The strategy NAME +
 * live % print inside each segment; a "Current positions" detail list below carries
 * one description + one live-position line per tier.
 *
 * NAMING (founder): the middle tier is shown to the user as "Trading". The
 * persisted `data-seg` / AllocationWeights key stays `'degen'` (the CSS color ramp
 * and `strategyFromAllocations` both key off it) — only the VISIBLE name changed.
 *
 * Because the bar is constructed to always total 100, "All your money is working"
 * is the steady state; the <100 / >100 copy is kept only as a guard for a future
 * min-clamp that might leave slack.
 *
 * Light = blue / dark = gold; the CSS lives in src/system/tokens-journal.css
 * (`.split*`, `.strat-detail`/`.sd-*`, `.remainder`, `.invest__foot`,
 * `.crashlink`), scoped under `.journal`.
 *
 * ── WIRING (REAL + FLAGGED STUBS) ────────────────────────────────────────────
 *   • The WEIGHTS are the persisted journal intent (`home.investingAllocations`).
 *     We persist the TUNED PERCENTS as weights (any positive weight = a funded tier),
 *     so the chosen split re-displays on reload via `seedFromWeights`.
 *   • Confirm calls `home.setAllocations('investing', weights)` → persists the split
 *     THEN re-mints the mandate for the EFFECTIVE tier via the existing two-phase
 *     `setStrategy(role, strategyFromAllocations(w))` (REAL, sponsored). ONLY the
 *     input UX changed (sliders → split-bar) — the commit path is identical.
 *
 *   🚩 STUB (sanctioned, documented in types.ts / useHome.ts):
 *     - MULTI-STRATEGY MANDATE: the chain mints ONE scope-set per mandate. Any
 *       aggressive tier (Degen OR GameFi) collapses to 'risky'; Passive-only →
 *       'safe'. The granular per-tier FUNDING is intent only — not three coexisting
 *       on-chain mandates. The cage runs the single effective scope.
 *     - GAMEFI → CRASH: links out to the Crash app; no on-chain GameFi wiring this
 *       pass. The GameFi weight folds into 'risky' via strategyFromAllocations.
 */
import { useCallback, useMemo, useRef, useState } from 'react';
import type { AllocationWeights, HomeApi } from '../data/types';

/** The Crash sister-app URL (monorepo deploy target; CLAUDE.md). 🚩 GameFi→Crash. */
const CRASH_URL = 'https://crash.suize.io';

/** A strategy tier — the three segments, in render order (left → right). */
interface Tier {
  /**
   * the AllocationWeights key + the `data-seg` attribute value. STABLE: `'degen'`
   * is the persisted/CSS contract key — the user-facing name is `name` ("Trading").
   */
  key: 'passive' | 'degen' | 'gamefi';
  /** the user-facing tier name (printed inside the segment + the detail row). */
  name: string;
  /** one plain-words description line (no crypto jargon). */
  desc: string;
}

const TIERS: Tier[] = [
  { key: 'passive', name: 'Passive', desc: 'Steady lending and staking.' },
  { key: 'degen', name: 'Trading', desc: 'Trades SUI/USDC on DeepBook.' },
  {
    key: 'gamefi',
    name: 'GameFi',
    desc: 'Small bets on Crash — BTC up or down.',
  },
];

type TierKey = Tier['key'];
type Pcts = Record<TierKey, number>;

/** The smallest a segment may shrink to while dragging its neighbour's divider. */
const MIN_SEG = 0;

/** The "Split evenly" reset — sums to exactly 100. */
const EVEN_SPLIT: Pcts = { passive: 34, degen: 33, gamefi: 33 };

/** Clamp a percent into [0, 100] and round to a whole number. */
function clampPct(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

/**
 * Seed the split from the persisted weights (positive weight = a funded tier).
 * Falls back to the even split when nothing is persisted. We do NOT force a sum of
 * 100 on read — a legacy blob is shown as-saved; the remainder readout will flag it.
 */
function seedFromWeights(w: AllocationWeights | undefined): Pcts {
  if (!w) return { ...EVEN_SPLIT };
  return {
    passive: clampPct(w.passive ?? 0),
    degen: clampPct(w.degen ?? 0),
    gamefi: clampPct(w.gamefi ?? 0),
  };
}

/** Build the AllocationWeights payload — the tuned percent as the weight (0 = unallocated). */
function weightsFrom(pcts: Pcts): AllocationWeights {
  const w: AllocationWeights = {};
  for (const t of TIERS) {
    if (pcts[t.key] > 0) w[t.key] = pcts[t.key];
  }
  return w;
}

/** Whole-dollar money string for a position line ("$240"). */
function usd0(n: number): string {
  return `$${Math.round(n).toLocaleString('en-US')}`;
}

/**
 * The "current position" line for a tier, derived from the investing balance × its
 * share of the split.
 *
 * HONESTY: the autonomous loop that actually OPENS positions is a documented stub, so
 * in production (`demo` false) we NEVER synthesize an open position, a bet count, or
 * P&L. We report the honest truth: the funds are ALLOCATED to the tier and waiting for
 * the AI ("$X allocated · waiting for your AI"). When a tier has no funds it reads
 * "Not active yet".
 *
 * `demo` true (DEV ?preview hatch) may show the EXAMPLE positions — "$X staked on
 * Navi", "$X open on DeepBook", "N recent Crash bets" — so the populated design stays
 * reviewable. That branch never reaches a real user.
 */
function positionText(
  key: TierKey,
  pct: number,
  investingUsd: number,
  demo: boolean,
): string {
  const dollars = investingUsd * (pct / 100);
  if (investingUsd <= 0 || pct <= 0 || dollars < 1) return 'Not active yet';

  // PRODUCTION — honest: allocated, but no position is open (the agent loop is stubbed).
  if (!demo) return `${usd0(dollars)} allocated · waiting for your AI`;

  // DEV ?preview — example positions for the populated design (never a real user).
  switch (key) {
    case 'passive':
      return `${usd0(dollars)} staked on Navi`;
    case 'degen':
      return `${usd0(dollars)} open on DeepBook`;
    case 'gamefi': {
      const bets = Math.max(1, Math.min(9, Math.round(dollars / 5)));
      return `${bets} recent Crash ${bets === 1 ? 'bet' : 'bets'}`;
    }
  }
}

export interface InvestingStrategiesProps {
  /** the data hook (useHome) — for the persisted split, the real vault total, the re-mint. */
  home: HomeApi;
  /**
   * DEV-ONLY design preview flag. `true` ONLY under `?preview` → positionText may show
   * the EXAMPLE open positions / bet count. `false` in production → positionText reports
   * the honest truth (allocated · waiting for your AI), never a synthesized position.
   */
  demo: boolean;
}

export function InvestingStrategies({ home, demo }: InvestingStrategiesProps) {
  const role = 'investing' as const;

  const seed = useMemo(
    () => seedFromWeights(home.investingAllocations),
    [home.investingAllocations],
  );
  const [pcts, setPcts] = useState<Pcts>(seed);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** the bar element — measured to convert a pointer dx into a % of its width. */
  const barRef = useRef<HTMLDivElement | null>(null);

  const total = TIERS.reduce((a, t) => a + pcts[t.key], 0);
  const exact = total === 100;
  const waiting = 100 - total; // >0 → still waiting · <0 → too much

  // ── the core trade: move `delta`% from one neighbour to the other ──────────
  // A divider sits between segment `left` (index i) and `right` (index i+1). We
  // shift `delta` percentage points from `right` into `left` (delta may be
  // negative). ONLY these two segments change; the third is untouched, so the sum
  // is invariant. Both neighbours are clamped to >= MIN_SEG, and we re-derive the
  // partner from the moved one to keep their pair-sum exact (no rounding drift).
  const tradeAt = useCallback((dividerIndex: 0 | 1, delta: number) => {
    setError(null);
    setPcts((p) => {
      const leftKey = TIERS[dividerIndex].key;
      const rightKey = TIERS[dividerIndex + 1].key;
      const pair = p[leftKey] + p[rightKey]; // invariant across the trade
      let left = Math.round(p[leftKey] + delta);
      left = Math.max(MIN_SEG, Math.min(pair - MIN_SEG, left));
      const right = pair - left;
      if (left === p[leftKey] && right === p[rightKey]) return p; // no-op
      return { ...p, [leftKey]: left, [rightKey]: right };
    });
  }, []);

  // ── pointer drag on a divider: convert dx (px) → % of the bar width ─────────
  const onDividerPointerDown = useCallback(
    (dividerIndex: 0 | 1) => (e: React.PointerEvent<HTMLDivElement>) => {
      // ignore secondary buttons; let keyboard handle the rest
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      const bar = barRef.current;
      if (!bar) return;
      const barWidth = bar.getBoundingClientRect().width;
      if (barWidth <= 0) return;

      const el = e.currentTarget;
      el.setPointerCapture(e.pointerId);
      const startX = e.clientX;
      const pxToPct = (px: number) => (px / barWidth) * 100;

      // We accumulate against a fresh read each move via tradeAt's functional
      // update, but tradeAt expects an *incremental* delta — so track the last
      // applied integer step and only feed the difference.
      let appliedSteps = 0;

      const onMove = (ev: PointerEvent) => {
        const wantSteps = Math.round(pxToPct(ev.clientX - startX));
        const step = wantSteps - appliedSteps;
        if (step !== 0) {
          tradeAt(dividerIndex, step);
          appliedSteps = wantSteps;
        }
      };
      const onUp = (ev: PointerEvent) => {
        el.releasePointerCapture(ev.pointerId);
        el.removeEventListener('pointermove', onMove);
        el.removeEventListener('pointerup', onUp);
        el.removeEventListener('pointercancel', onUp);
      };
      el.addEventListener('pointermove', onMove);
      el.addEventListener('pointerup', onUp);
      el.addEventListener('pointercancel', onUp);
    },
    [tradeAt],
  );

  // ── keyboard on a focused divider: Arrow keys nudge ±1% (Home/End jump) ────
  const onDividerKeyDown = useCallback(
    (dividerIndex: 0 | 1) => (e: React.KeyboardEvent<HTMLDivElement>) => {
      let delta = 0;
      let jump = false;
      switch (e.key) {
        case 'ArrowLeft':
        case 'ArrowDown':
          delta = -1;
          break;
        case 'ArrowRight':
        case 'ArrowUp':
          delta = 1;
          break;
        case 'Home':
          delta = -100;
          jump = true;
          break;
        case 'End':
          delta = 100;
          jump = true;
          break;
        default:
          return;
      }
      e.preventDefault();
      tradeAt(dividerIndex, jump ? delta : delta * (e.shiftKey ? 5 : 1));
    },
    [tradeAt],
  );

  /** "Split evenly" — reset to the 34/33/33 baseline. */
  const splitEvenly = useCallback(() => {
    setError(null);
    setPcts({ ...EVEN_SPLIT });
  }, []);

  // ── Confirm → persist + re-mint (EXISTING path; only the input UX changed) ──
  const confirm = useCallback(async () => {
    if (total !== 100 || busy) return; // block, never auto-correct
    setError(null);
    setBusy(true);
    try {
      await home.setAllocations(role, weightsFrom(pcts));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not update strategies.');
    } finally {
      setBusy(false);
    }
  }, [home, pcts, total, busy]);

  // The live remainder copy + tone. The bar is built to always total 100, so the
  // steady-state line is the rule; the slack copy is the future-min-clamp guard.
  const remainderText = exact
    ? 'All your money is working'
    : waiting > 0
      ? `${waiting}% still waiting`
      : `${-waiting}% too much`;

  // running cumulative % for the two dividers' aria-valuenow (position along bar)
  const div1Now = pcts.passive;
  const div2Now = pcts.passive + pcts.degen;

  // The funded sandbox total — drives the honest "current position" lines. 0 in
  // the fresh/preview state → every tier reads "Not active yet".
  const investingUsd = home.state.investing.usd;

  return (
    <div className="pane__scroll">
      {/* live remainder readout (>100% → .warn) */}
      <div
        className={`remainder${!exact && waiting < 0 ? ' warn' : ''}`}
        role="status"
        aria-live="polite"
      >
        {remainderText}
      </div>

      {/* ONE split-bar — three proportional segments + two draggable dividers. */}
      <div className="split" ref={barRef}>
        {/* Passive segment */}
        <div
          className="split__seg"
          data-seg="passive"
          style={{ flexBasis: `${pcts.passive}%`, flexGrow: 0, flexShrink: 0 }}
        >
          <span className="split__name">{TIERS[0].name}</span>
          <span className="split__pct">{pcts.passive}%</span>
        </div>

        {/* divider 1|2 — trades between Passive and Trading */}
        <div
          className="split__div"
          role="separator"
          aria-orientation="vertical"
          aria-label="Passive vs Trading split"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={div1Now}
          aria-valuetext={`Passive ${pcts.passive}%, Trading ${pcts.degen}%`}
          tabIndex={0}
          onPointerDown={onDividerPointerDown(0)}
          onKeyDown={onDividerKeyDown(0)}
        />

        {/* Trading segment (data-seg stays "degen" — the persisted/CSS key). */}
        <div
          className="split__seg"
          data-seg="degen"
          style={{ flexBasis: `${pcts.degen}%`, flexGrow: 0, flexShrink: 0 }}
        >
          <span className="split__name">{TIERS[1].name}</span>
          <span className="split__pct">{pcts.degen}%</span>
        </div>

        {/* divider 2|3 — trades between Trading and GameFi */}
        <div
          className="split__div"
          role="separator"
          aria-orientation="vertical"
          aria-label="Trading vs GameFi split"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={div2Now}
          aria-valuetext={`Trading ${pcts.degen}%, GameFi ${pcts.gamefi}%`}
          tabIndex={0}
          onPointerDown={onDividerPointerDown(1)}
          onKeyDown={onDividerKeyDown(1)}
        />

        {/* GameFi segment */}
        <div
          className="split__seg"
          data-seg="gamefi"
          style={{ flexBasis: `${pcts.gamefi}%`, flexGrow: 0, flexShrink: 0 }}
        >
          <span className="split__name">{TIERS[2].name}</span>
          <span className="split__pct">{pcts.gamefi}%</span>
        </div>
      </div>

      {/* Current positions — one detail row per tier: dot + what it does + the
          honest position line. In production the loop that opens positions is a
          documented stub, so we report "$X allocated · waiting for your AI" — never a
          synthesized open position / bet count / P&L (see positionText). */}
      <div className="strat-detail">
        <div className="sd-head">Current positions</div>
        {TIERS.map((t) => (
          <div className="sd-row" key={t.key}>
            <span className="sd-dot" data-seg={t.key} />
            <span className="sd-desc">{t.desc}</span>
            <span className="sd-pos">
              {positionText(t.key, pcts[t.key], investingUsd, demo)}
            </span>
            {t.key === 'gamefi' ? (
              /* 🚩 GameFi → Crash: links out to the sister app (no on-chain GameFi this pass). */
              <a
                className="crashlink"
                href={CRASH_URL}
                target="_blank"
                rel="noreferrer noopener"
              >
                <b>Crash</b>
                <span>by Suize · BTC up or down, every round</span>
              </a>
            ) : null}
          </div>
        ))}
      </div>

      {/* footer — "Split evenly" reset then "Confirm" (gated on exactly 100%),
          right-grouped with a small gap by .invest__foot. Order matters. */}
      <div className="invest__foot">
        <button className="btn btn--ghost" type="button" onClick={splitEvenly}>
          Split evenly
        </button>
        <button
          className="btn btn--cy"
          type="button"
          onClick={() => void confirm()}
          disabled={!exact || busy}
        >
          {busy ? 'Saving…' : 'Confirm'}
        </button>
      </div>

      {error ? (
        <p className="note" role="alert" style={{ marginTop: 14 }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}

export default InvestingStrategies;
