/**
 * MainAccountView — the MAIN account's detail pane (the journal's right column
 * when the "your main account" card is selected).
 *
 * COIN LIST ONLY. The three money actions (Add money / Send / Convert) + their
 * sheets now live on the MAIN account CARD itself (AccountDrawer's `.acct__foot`),
 * so this pane is just the held-coins ledger, in three honest tiers:
 *   1. KNOWN coins — the curated SUPPORTED set, owned-first (the data layer already
 *      sorts them). Display-only testnet coins are marked, never faked. NOT pinnable.
 *   2. PINNED unknowns — coins the user holds that AREN'T in SUPPORTED but were
 *      promoted via the pin toggle; shown right below the known coins.
 *   3. COLLAPSED unknowns — the rest of the detected coins, hidden behind a quiet
 *      "Show N more tokens" expander (lucide chevron). Each unknown row carries a
 *      Pin / PinOff toggle (moves it between tier 2 and tier 3) and an honest
 *      "unverified" tag with NO price (we never fabricate a USD figure for it).
 *   • Empty state — "No coins yet. Add funds to get started."
 *
 * Pins are owner-scoped + persisted (localStorage `suize:pinned-coins:<owner>`, see
 * data/pinnedCoins.ts) so they survive reload and never collide across accounts.
 *
 * The CSS lives in src/system/tokens-journal.css (`.curr*`, `.pane__scroll`),
 * scoped under `.journal`.
 */
import { useMemo, useState } from 'react';
import { ChevronDown, ICON_STROKE, Pin, PinOff } from '../../system';
import type { Currency, HomeApi } from '../../data/types';
import { getPinnedCoins, togglePinnedCoin } from '../../data/pinnedCoins';

/** Money formatter — "$11,200.00". */
function usd(n: number): string {
  return `$${n.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Coin-unit formatter — up to 4 dp, trimmed (e.g. "12.5" / "0.0023"). */
function uiAmount(n: number): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: 4 });
}

export interface MainAccountViewProps {
  /** the data hook — supplies the currency list. */
  home: HomeApi;
}

export function MainAccountView({ home }: MainAccountViewProps) {
  const { state } = home;
  const owner = state.address;

  // Pin set is owner-scoped + persisted; seeded from storage, toggled in place.
  const [pinned, setPinned] = useState<Set<string>>(() => getPinnedCoins(owner));
  // Re-seed if the signed-in owner changes (different account => different pins).
  const [seededFor, setSeededFor] = useState(owner);
  if (seededFor !== owner) {
    setSeededFor(owner);
    setPinned(getPinnedCoins(owner));
  }

  // Collapsed-tier expander state (the "Show N more tokens" toggle).
  const [expanded, setExpanded] = useState(false);

  const togglePin = (coinType: string) => setPinned(togglePinnedCoin(owner, coinType));

  // Split the currency list into the three honest tiers.
  const { knownShown, pinnedUnknown, collapsedUnknown, isEmpty } = useMemo(() => {
    const coins = state.currencies;
    const known = coins.filter((c) => c.known);
    const unknown = coins.filter((c) => !c.known); // already owned-only (data layer)

    // KNOWN tier mirrors the prior behavior: held first, else a 2-coin teaser so the
    // pane is never blank when the user holds only unknowns / nothing yet.
    const heldKnown = known.filter((c) => c.ui > 0);
    const knownTier = heldKnown.length > 0 ? heldKnown : known.slice(0, 2);

    const pinnedTier = unknown.filter((c) => pinned.has(c.type));
    const collapsedTier = unknown.filter((c) => !pinned.has(c.type));

    return {
      knownShown: knownTier,
      pinnedUnknown: pinnedTier,
      collapsedUnknown: collapsedTier,
      isEmpty: knownTier.length === 0 && unknown.length === 0,
    };
  }, [state.currencies, pinned]);

  if (isEmpty) {
    return (
      <div className="pane__scroll">
        {/* editorial header even when empty, so the ledger reads as "your money" */}
        <div className="curr__head">
          <span className="pane__name">What you are holding</span>
          <span className="curr__count">No coins yet</span>
        </div>
        <p className="curr__empty">No coins yet. Add money to get started.</p>
      </div>
    );
  }

  // Honest count of the kinds of coin this ledger represents (all three tiers).
  const kinds = knownShown.length + pinnedUnknown.length + collapsedUnknown.length;

  return (
    <div className="pane__scroll">
      {/* ── editorial header — the one serif title + an honest count ───────── */}
      <div className="curr__head">
        <span className="pane__name">What you are holding</span>
        <span className="curr__count tnum">
          {kinds} kind{kinds === 1 ? '' : 's'} of coin
        </span>
      </div>

      <div className="curr">
        {/* 1 — KNOWN coins (not pinnable). */}
        {knownShown.map((c) => (
          <CurrencyRow key={c.type} c={c} />
        ))}

        {/* 2 — PINNED unknowns, directly below the known coins. */}
        {pinnedUnknown.map((c) => (
          <CurrencyRow key={c.type} c={c} pinned onTogglePin={() => togglePin(c.type)} />
        ))}

        {/* 3 — the REST of the unknowns, collapsed behind a quiet expander. */}
        {collapsedUnknown.length > 0 && (
          <>
            {expanded &&
              collapsedUnknown.map((c) => (
                <CurrencyRow key={c.type} c={c} onTogglePin={() => togglePin(c.type)} />
              ))}
            <button
              type="button"
              className="curr__more"
              aria-expanded={expanded}
              onClick={() => setExpanded((v) => !v)}
            >
              <ChevronDown
                size={13}
                strokeWidth={ICON_STROKE}
                className={`curr__more-chev${expanded ? ' is-open' : ''}`}
                aria-hidden="true"
              />
              {expanded ? 'Show less' : `Show ${collapsedUnknown.length} more token${collapsedUnknown.length === 1 ? '' : 's'}`}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * One coin row — v3 ledger line: brand/neutral disc → coin NAME (Space Grotesk) +
 * a sub-amount (Martian Mono) → a dotted leader → the USD value, right-aligned in
 * BLUE Martian Mono (money is always blue). Unknown coins (`!c.known`) carry an
 * "unverified" tag, render an honest "no price" line instead of a fabricated USD
 * figure, and show a Pin / PinOff toggle. Known coins keep the existing "soon"
 * markers and have NO pin control (they're always shown).
 */
function CurrencyRow({
  c,
  pinned = false,
  onTogglePin,
}: {
  c: Currency;
  pinned?: boolean;
  onTogglePin?: () => void;
}) {
  return (
    <div className="curr__row">
      <span className="curr__disc" style={{ background: c.color }} aria-hidden="true">
        {c.sym.slice(0, 3)}
      </span>
      <span className="curr__meta">
        <span className="curr__sym">
          {c.name}
          {c.known && c.displayOnly ? <span className="curr__soon">soon</span> : null}
          {!c.known ? <span className="curr__tag">unverified</span> : null}
        </span>
        <span className="curr__name tnum">
          {c.decimalsUnknown ? (
            <>
              {uiAmount(c.ui)} {c.sym}
              <span className="curr__raw">raw</span>
            </>
          ) : (
            `${uiAmount(c.ui)} ${c.sym}`
          )}
        </span>
      </span>
      <span className="curr__lead" aria-hidden="true" />
      <span className="curr__amt">
        {/* Money is BLUE. Unknown coins have no honest price — say so plainly,
            never a fabricated $0.00. */}
        {c.known ? (
          <span className="curr__usd tnum">{usd(c.usd)}</span>
        ) : (
          <span className="curr__noprice">No price yet</span>
        )}
      </span>
      {onTogglePin ? (
        <button
          type="button"
          className="curr__pin"
          aria-pressed={pinned}
          aria-label={pinned ? `Unpin ${c.sym}` : `Pin ${c.sym}`}
          onClick={onTogglePin}
        >
          {pinned ? (
            <PinOff size={14} strokeWidth={ICON_STROKE} aria-hidden="true" />
          ) : (
            <Pin size={14} strokeWidth={ICON_STROKE} aria-hidden="true" />
          )}
        </button>
      ) : null}
    </div>
  );
}

export default MainAccountView;
