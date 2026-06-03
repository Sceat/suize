/**
 * Beat 3 — STRATEGY. Two big editorial choice CARDS side-by-side: Safe (default
 * selected) / Risky (SPEC §1.4, §1.5, §4). The user only ever picks Safe or Risky —
 * we NEVER explain what the AI does. Selected card gets a cyan inset ring + glow +
 * the radial cyan wash. One tap selects; Continue advances.
 *
 * Visual archetype ported faithfully from the approved mockup (00-suize-system.html
 * §09, `.strat__grid` / `.scard`): a serif card title, a top-right pill ("Chosen" /
 * "Pick"), a sans description, and a per-card colored footer line — Safe → --good
 * "Steady and calm." with a Check; Risky → --warn "More reward, more ups and downs."
 *
 * Copy (SPEC §4 + the founder's words, verbatim):
 *   title : "What strategy should your AI use?"
 *   Safe  : title "Safe"  · "Grow slowly. Very safe."   · footer "Steady and calm."
 *   Risky : title "Risky" · "Aim higher. Can go up or down." · footer caveat
 *   note  : "You can change this anytime."
 *   button: "Continue"
 *
 * `Strategy` is the locked data-layer type ('safe' | 'risky'); the choice maps to
 * which mandate is minted later (SAFE=navi, RISKY=swap) behind the data seam.
 * Labels stay "Safe"/"Risky" (the founder's words) — the mockup's "Bold" is NOT used.
 */

import type { CSSProperties } from 'react';
import { Check, ICON_STROKE, Button, Eyebrow } from '../../system';
import type { Strategy } from '../../data/types';

interface CardSpec {
  value: Strategy;
  title: string;
  /** description; bold fragment mirrors the mockup's `.scard__desc b` emphasis */
  desc: { lead: string; em: string };
  /** the colored footer line — `tone` drives --good vs --warn + Check presence */
  footer: { tone: 'good' | 'warn'; text: string };
}

const CARDS: CardSpec[] = [
  {
    value: 'safe',
    title: 'Safe',
    desc: { lead: 'Grow slowly. ', em: 'Very safe.' },
    footer: { tone: 'good', text: 'Steady and calm.' },
  },
  {
    value: 'risky',
    title: 'Risky',
    desc: { lead: 'Aim higher. ', em: 'Can go up or down.' },
    footer: { tone: 'warn', text: 'More reward, more ups and downs.' },
  },
];

export function StepStrategy({
  value,
  onSelect,
  onNext,
}: {
  value: Strategy;
  onSelect: (s: Strategy) => void;
  onNext: () => void;
}) {
  return (
    <div
      // left-anchored editorial block (mockup `.strat`, the two choice cards breathe
      // at a wider measure). Column provides `--pad` + vertical centring.
      className="flex flex-col"
      style={{ maxWidth: 760, width: '100%' }}
    >
      <Eyebrow>Your strategy</Eyebrow>
      <h2
        style={{
          margin: '12px 0 0',
          fontFamily: 'var(--serif)',
          fontWeight: 400,
          fontSize: 'clamp(2rem, 8vw, 2.8rem)',
          lineHeight: 1.06,
          letterSpacing: '-0.022em',
          color: 'var(--ink)',
        }}
      >
        What strategy should your AI use?
      </h2>

      {/* the two big editorial cards — the mockup `.strat__grid`: TWO-UP at desktop,
          collapsing to a single full-width column under 860px (the mockup's media
          rule). Scoped class below drives the responsive columns. */}
      <div
        role="radiogroup"
        aria-label="What strategy should your AI use?"
        className="suize-strat__grid"
        style={{ marginTop: 36 }}
      >
        {CARDS.map((card) => {
          const selected = value === card.value;
          return (
            <button
              key={card.value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onSelect(card.value)}
              style={cardStyle(selected)}
            >
              {/* `.scard__glow` — radial cyan wash, only visible when selected */}
              <span aria-hidden style={glowStyle(selected)} />

              {/* `.scard__top` — serif name + the Chosen/Pick pill */}
              <span style={topStyle}>
                <span style={nameStyle}>{card.title}</span>
                <span style={pillStyle(selected)}>{selected ? 'Chosen' : 'Pick'}</span>
              </span>

              {/* `.scard__desc` */}
              <span style={descStyle}>
                {card.desc.lead}
                <b style={{ color: 'var(--ink)', fontWeight: 600 }}>{card.desc.em}</b>
              </span>

              {/* per-card colored footer: `.scard__safe` (--good + Check) / `.scard__caveat` (--warn) */}
              <span style={footerStyle(card.footer.tone)}>
                {card.footer.tone === 'good' && (
                  <Check size={14} strokeWidth={ICON_STROKE} aria-hidden />
                )}
                {card.footer.text}
              </span>
            </button>
          );
        })}
      </div>

      {/* the single honest note (mockup `.strat__note`) — flows under the cards. */}
      <p
        style={{
          margin: 0,
          paddingTop: 28,
          fontFamily: 'var(--mono)',
          fontSize: 11.5,
          letterSpacing: '0.01em',
          color: 'var(--ink-3)',
        }}
      >
        You can change this anytime.
      </p>

      <div style={{ paddingTop: 24, maxWidth: 360 }}>
        <Button variant="primary" size="lg" onClick={onNext} style={{ width: '100%' }}>
          Continue
        </Button>
      </div>

      {/* the mockup `.strat__grid` responsive columns. */}
      <style>{`
        .suize-strat__grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 16px;
        }
        @media (max-width: 860px) {
          .suize-strat__grid { grid-template-columns: 1fr; }
        }
      `}</style>
    </div>
  );
}

/* ── card chrome — ported from `.scard` ──────────────────────────────────── */

/** `.scard` — a tall editorial surface; selected gets the cyan inset ring + glow. */
function cardStyle(selected: boolean): CSSProperties {
  return {
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    textAlign: 'left',
    padding: 'clamp(22px, 5vw, 28px)',
    borderRadius: 'var(--corner)',
    border: `1px solid ${selected ? 'var(--cyan)' : 'var(--hair)'}`,
    background: 'var(--paper-2)',
    cursor: 'pointer',
    overflow: 'hidden',
    boxShadow: selected
      ? 'inset 0 0 0 1px var(--cyan), 0 18px 44px -26px var(--btn-cy-glow)'
      : 'none',
    transition:
      'border-color .5s var(--e-quart), box-shadow .5s var(--e-quart), background .5s',
  };
}

/** `.scard__glow` — radial cyan wash, top-right, only when selected. */
function glowStyle(selected: boolean): CSSProperties {
  return {
    position: 'absolute',
    inset: 0,
    pointerEvents: 'none',
    opacity: selected ? 1 : 0,
    transition: 'opacity .5s var(--e-quart)',
    background:
      'radial-gradient(100% 120% at 100% 0%, var(--cyan-wash), transparent 55%)',
  };
}

/** `.scard__top` */
const topStyle: CSSProperties = {
  position: 'relative',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  marginBottom: 14,
};

/** `.scard__name` */
const nameStyle: CSSProperties = {
  fontFamily: 'var(--serif)',
  fontWeight: 400,
  fontSize: 'clamp(1.5rem, 3vw, 2.1rem)',
  letterSpacing: '-0.02em',
  color: 'var(--ink)',
  lineHeight: 1.05,
};

/** `.scard__pick` — the Chosen/Pick pill (turns cyan when selected). */
function pillStyle(selected: boolean): CSSProperties {
  return {
    flex: '0 0 auto',
    fontFamily: 'var(--mono)',
    fontSize: 9.5,
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    padding: '4px 9px',
    borderRadius: 999,
    color: selected ? 'var(--cyan)' : 'var(--ink-3)',
    border: `1px solid ${selected ? 'color-mix(in srgb, var(--cyan) 40%, transparent)' : 'var(--hair)'}`,
    transition: 'color .4s, border-color .4s',
  };
}

/** `.scard__desc` */
const descStyle: CSSProperties = {
  position: 'relative',
  fontFamily: 'var(--sans)',
  fontSize: 14.5,
  lineHeight: 1.55,
  color: 'var(--ink-2)',
};

/** `.scard__safe` (--good + Check) / `.scard__caveat` (--warn). */
function footerStyle(tone: 'good' | 'warn'): CSSProperties {
  return {
    position: 'relative',
    marginTop: 14,
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontFamily: 'var(--mono)',
    fontSize: 11,
    lineHeight: 1.6,
    letterSpacing: tone === 'good' ? '0.04em' : '0.01em',
    color: tone === 'good' ? 'var(--good)' : 'var(--warn)',
  };
}
