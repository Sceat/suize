/**
 * InvestingStrategies — the AI INVESTING account's detail pane.
 *
 * REDESIGNED (journal refinement): the three strategy tiers — Passive / Degen /
 * GameFi — are now ENABLE/DISABLE TOGGLES (the refined `.sw` switch, not
 * checkboxes), each with an ADJUSTABLE PERCENT (a slider) so the user TUNES the
 * split. The allocation always sums sensibly: enabling/disabling re-normalizes to
 * 100% across the enabled tiers, and dragging one slider redistributes the rest
 * proportionally so the total stays 100. GameFi still "plays Crash by Suize" and
 * links to the Crash sister app.
 *
 * Light = blue / dark = gold; the CSS lives in src/system/tokens-journal.css
 * (`.strat*`, `.sw`, `.rng`, `.alloc*`), scoped under `.journal`.
 *
 * ── WIRING (REAL + FLAGGED STUBS) ────────────────────────────────────────────
 *   • The WEIGHTS are the persisted journal intent (`home.investingAllocations`).
 *     We persist the TUNED PERCENTS as weights (any positive weight = enabled), so
 *     the chosen split re-displays on reload.
 *   • Toggling/tuning calls `home.setAllocations('investing', weights)` → persists
 *     the split THEN re-mints the mandate for the EFFECTIVE tier via the existing
 *     two-phase `setStrategy(role, strategyFromAllocations(w))` (REAL, sponsored).
 *   • The per-tier DOLLAR amounts derive from the REAL Investing vault value
 *     (`home.state.investing.usd`, 0 when empty) — never a fabricated total.
 *
 *   🚩 STUB (sanctioned, documented in types.ts / useHome.ts):
 *     - MULTI-STRATEGY MANDATE: the chain mints ONE scope-set per mandate. Any
 *       aggressive tier (Degen OR GameFi) collapses to 'risky'; Passive-only →
 *       'safe'. The granular per-tier FUNDING is intent only — not three coexisting
 *       on-chain mandates. The cage runs the single effective scope.
 *     - GAMEFI → CRASH: links out to the Crash app; no on-chain GameFi wiring this
 *       pass. The GameFi weight folds into 'risky' via strategyFromAllocations.
 */
import {
  useCallback,
  useMemo,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import type { AllocationWeights, HomeApi } from '../data/types';

/** The Crash sister-app URL (monorepo deploy target; CLAUDE.md). 🚩 GameFi→Crash. */
const CRASH_URL = 'https://crash.suize.io';

/** A strategy tier — the three toggle rows, in render order. */
interface Tier {
  /** the AllocationWeights key. */
  key: 'passive' | 'degen' | 'gamefi';
  /** the default percent when first enabled (the mockup's 50/33/17 baseline). */
  baseline: number;
  /** the serif row title. */
  name: string;
  /** GameFi's "plays Crash by Suize" mono by-line (only GameFi). */
  by?: string;
  /** the mono description — rendered with the mockup's exact <b> emphases. */
  desc: ReactNode;
}

const TIERS: Tier[] = [
  {
    key: 'passive',
    baseline: 50,
    name: 'Passive',
    desc: (
      <>
        Steady lending and staking. <b>Calm, slow growth</b> — the quiet workhorse.
      </>
    ),
  },
  {
    key: 'degen',
    baseline: 33,
    name: 'Degen',
    desc: (
      <>
        Hunts new tokens and momentum. <b>Higher reward, bigger swings.</b>
      </>
    ),
  },
  {
    key: 'gamefi',
    baseline: 17,
    name: 'GameFi',
    by: 'plays Crash by Suize',
    desc: (
      <>
        Stakes small bets on <b>Crash</b>, our sister game — calling BTC up or down.{' '}
        <b>The wild slice.</b>
      </>
    ),
  },
];

type Pcts = Record<Tier['key'], number>;

/** Mono dollar formatter — en-US, fixed digits. */
function fmt(n: number, d = 2): string {
  return n.toLocaleString('en-US', {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  });
}

/** Round a percent map so the enabled tiers sum to exactly 100 (largest-remainder). */
function normalizeTo100(raw: Pcts, enabled: Record<Tier['key'], boolean>): Pcts {
  const onKeys = TIERS.map((t) => t.key).filter((k) => enabled[k]);
  const out: Pcts = { passive: 0, degen: 0, gamefi: 0 };
  if (onKeys.length === 0) return out;
  const sum = onKeys.reduce((a, k) => a + Math.max(0, raw[k]), 0) || 1;
  // scale to 100, then largest-remainder round to integers summing to 100
  const scaled = onKeys.map((k) => ({ k, v: (Math.max(0, raw[k]) / sum) * 100 }));
  const floored = scaled.map((s) => ({ ...s, f: Math.floor(s.v), r: s.v - Math.floor(s.v) }));
  let used = floored.reduce((a, s) => a + s.f, 0);
  floored.sort((a, b) => b.r - a.r);
  let i = 0;
  while (used < 100 && floored.length > 0) {
    floored[i % floored.length].f += 1;
    used += 1;
    i += 1;
  }
  for (const s of floored) out[s.k] = s.f;
  return out;
}

/** Seed enabled + percents from the persisted weights (positive weight = enabled). */
function seedFromWeights(w: AllocationWeights | undefined): { enabled: Record<Tier['key'], boolean>; pcts: Pcts } {
  if (!w) {
    const enabled = { passive: true, degen: true, gamefi: true };
    const pcts = { passive: 50, degen: 33, gamefi: 17 } as Pcts;
    return { enabled, pcts: normalizeTo100(pcts, enabled) };
  }
  const enabled = {
    passive: (w.passive ?? 0) > 0,
    degen: (w.degen ?? 0) > 0,
    gamefi: (w.gamefi ?? 0) > 0,
  };
  const rawPcts = {
    passive: w.passive ?? 0,
    degen: w.degen ?? 0,
    gamefi: w.gamefi ?? 0,
  } as Pcts;
  return { enabled, pcts: normalizeTo100(rawPcts, enabled) };
}

/** Build the AllocationWeights payload — the tuned percent as the weight (0 = off). */
function weightsFrom(pcts: Pcts, enabled: Record<Tier['key'], boolean>): AllocationWeights {
  const w: AllocationWeights = {};
  for (const t of TIERS) {
    if (enabled[t.key] && pcts[t.key] > 0) w[t.key] = pcts[t.key];
  }
  return w;
}

export interface InvestingStrategiesProps {
  /** the data hook (useHome) — for the persisted split, the real vault total, the re-mint. */
  home: HomeApi;
}

export function InvestingStrategies({ home }: InvestingStrategiesProps) {
  const { state } = home;
  const role = 'investing' as const;

  const seed = useMemo(() => seedFromWeights(home.investingAllocations), [home.investingAllocations]);
  const [enabled, setEnabled] = useState<Record<Tier['key'], boolean>>(seed.enabled);
  const [pcts, setPcts] = useState<Pcts>(seed.pcts);
  const [error, setError] = useState<string | null>(null);

  // The dollar base = the REAL Investing vault value (0 when empty/unfunded).
  const investTotal = state.investing.usd;
  const onCount = TIERS.filter((t) => enabled[t.key]).length;
  const total = TIERS.reduce((a, t) => a + (enabled[t.key] ? pcts[t.key] : 0), 0);
  const summary = `${onCount} ${onCount === 1 ? 'strategy' : 'strategies'} enabled`;

  // Persist + re-mint (fire-and-forget; roll back on failure handled by caller of toggle).
  const persist = useCallback(
    (nextPcts: Pcts, nextEnabled: Record<Tier['key'], boolean>) => {
      setError(null);
      const weights = weightsFrom(nextPcts, nextEnabled);
      void home.setAllocations(role, weights).catch((e: unknown) => {
        setError(e instanceof Error ? e.message : 'Could not update strategies.');
      });
    },
    [home],
  );

  // Toggle a tier on/off → re-normalize the split to 100 across what remains on.
  const toggle = useCallback(
    (key: Tier['key']) => {
      setEnabled((prevEn) => {
        const nextEn = { ...prevEn, [key]: !prevEn[key] };
        // when enabling, give the tier its baseline before normalizing
        setPcts((prevP) => {
          const seedP: Pcts = { ...prevP };
          if (nextEn[key] && seedP[key] <= 0) {
            seedP[key] = TIERS.find((t) => t.key === key)!.baseline;
          }
          const normalized = normalizeTo100(seedP, nextEn);
          persist(normalized, nextEn);
          return normalized;
        });
        return nextEn;
      });
    },
    [persist],
  );

  // Drag a tier's slider → set its percent, redistribute the rest proportionally to
  // keep the enabled total at 100. Persist the tuned split (debounced via commit).
  const onSlide = useCallback(
    (key: Tier['key'], value: number) => {
      setPcts((prevP) => {
        const others = TIERS.map((t) => t.key).filter((k) => k !== key && enabled[k]);
        const v = Math.max(0, Math.min(100, value));
        const next: Pcts = { ...prevP, [key]: v };
        const remaining = 100 - v;
        const otherSum = others.reduce((a, k) => a + prevP[k], 0);
        if (others.length === 0) {
          next[key] = 100; // the only enabled tier always owns 100
        } else if (otherSum <= 0) {
          // split the remainder evenly
          const each = remaining / others.length;
          others.forEach((k) => (next[k] = each));
        } else {
          others.forEach((k) => (next[k] = (prevP[k] / otherSum) * remaining));
        }
        return normalizeTo100(next, enabled);
      });
    },
    [enabled],
  );

  // Commit (persist + re-mint) when the user releases the slider — avoids a re-mint
  // storm while dragging.
  const commit = useCallback(() => {
    persist(pcts, enabled);
  }, [persist, pcts, enabled]);

  const onRowKey = useCallback(
    (e: KeyboardEvent<HTMLSpanElement>, key: Tier['key']) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggle(key);
      }
    },
    [toggle],
  );

  return (
    <div className="pane__scroll">
      <div className="detail" id="stratDetail">
        <div className="strats" id="strats">
          {TIERS.map((t) => {
            const on = enabled[t.key];
            const pct = on ? pcts[t.key] : 0;
            const amt = (investTotal * pct) / 100;
            return (
              <div
                key={t.key}
                className={`strat ${on ? 'on' : 'off'}`}
                data-strat={t.key}
              >
                {/* the refined ON/OFF toggle (not a checkbox) */}
                <div className="strat__toggle">
                  <span
                    className="sw"
                    role="switch"
                    tabIndex={0}
                    aria-checked={on}
                    aria-pressed={on}
                    aria-label={`${t.name} strategy on/off`}
                    onClick={() => toggle(t.key)}
                    onKeyDown={(e) => onRowKey(e, t.key)}
                  />
                </div>
                <div className="strat__main">
                  <div className="strat__name">
                    {t.name}
                    {t.by ? <span className="by">{t.by}</span> : null}
                  </div>
                  <div className="strat__desc">{t.desc}</div>
                </div>
                <div className="strat__share">
                  <span className="pct">{pct}%</span>
                  <span className="amt">${fmt(amt, 0)}</span>
                </div>

                {/* the adjustable PERCENT slider (only meaningful when enabled) */}
                <div className="strat__slider">
                  <input
                    className="rng"
                    type="range"
                    min={0}
                    max={100}
                    step={1}
                    value={pct}
                    disabled={!on}
                    aria-label={`${t.name} allocation percent`}
                    onChange={(e) => onSlide(t.key, Number(e.target.value))}
                    onPointerUp={commit}
                    onKeyUp={commit}
                  />
                  <span className="strat__rngval">{pct}%</span>
                </div>
              </div>
            );
          })}
        </div>

        <div className="alloc">
          <div className="alloc__lab">
            <span className="k">How the ${fmt(investTotal, 0)} is split</span>
            <span className={`v ${total === 100 ? 'ok' : onCount > 0 ? 'warn' : ''}`} id="allocSum">
              {onCount > 0 ? `${total}% · ${summary}` : summary}
            </span>
          </div>
          <div className="alloc__bar" id="allocBar">
            {TIERS.map((t) => {
              const on = enabled[t.key];
              const pct = on ? pcts[t.key] : 0;
              return (
                <div
                  key={t.key}
                  className={`alloc__seg ${t.key}${on ? ' on' : ''}`}
                  data-seg={t.key}
                  style={{ flexBasis: `${pct}%` }}
                />
              );
            })}
          </div>
          <div className="alloc__keys">
            {TIERS.map((t) => {
              const on = enabled[t.key];
              const pct = on ? pcts[t.key] : 0;
              return (
                <span
                  key={t.key}
                  className={`alloc__key ${t.key}${on ? '' : ' off'}`}
                  data-key={t.key}
                >
                  <i />
                  <b>{t.name}</b> · <span data-keypct>{pct}%</span>
                </span>
              );
            })}
          </div>
        </div>

        {/* 🚩 GameFi → Crash: links out to the sister app (no on-chain GameFi this pass). */}
        <a
          className="crashlink"
          href={CRASH_URL}
          target="_blank"
          rel="noreferrer noopener"
        >
          <b>Crash</b>
          <span>by Suize · BTC up or down, every round</span>
          <span className="arr" aria-hidden="true">
            →
          </span>
        </a>

        {error ? (
          <p className="note" role="alert" style={{ marginTop: 14 }}>
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}

export default InvestingStrategies;
