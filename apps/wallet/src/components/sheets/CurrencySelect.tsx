/**
 * CurrencySelect — the shared, searchable currency dropdown used by Send + Convert.
 *
 * A button shows the selected coin (colored disc with its 2-letter mark + symbol +
 * name); clicking opens a panel listing every currency, optionally filtered by a
 * search box. Selecting one fires `onChange(coinType)` and closes.
 *
 * Theme-reactive via CSS vars. Keyboard: the trigger is a real <button>; ESC and
 * outside-click close the panel; the search input autofocuses on open.
 */
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { Currency } from '../../data/types';
import { ChevronDown, Search } from '../../system';
import { ICON_STROKE } from '../../system';

export interface CurrencySelectProps {
  /** the selected coin's `type` (matches Currency.type). */
  value: string;
  /** fired with the chosen coin's `type`. */
  onChange: (type: string) => void;
  /** the full list to choose from. */
  currencies: Currency[];
  /** show the in-panel search box. Default true. */
  searchable?: boolean;
  /** optional label above the trigger. */
  label?: string;
}

/** The colored disc with the first two letters of a symbol. */
function CoinDisc({ color, sym, size = 26 }: { color: string; sym: string; size?: number }) {
  return (
    <span
      aria-hidden
      style={{
        flex: '0 0 auto',
        width: size,
        height: size,
        borderRadius: '50%',
        display: 'grid',
        placeItems: 'center',
        background: color,
        color: '#fff',
        fontFamily: 'var(--mono)',
        fontSize: size * 0.36,
        fontWeight: 600,
        letterSpacing: '-0.02em',
      }}
    >
      {sym.slice(0, 2)}
    </span>
  );
}

export function CurrencySelect({
  value,
  onChange,
  currencies,
  searchable = true,
  label,
}: CurrencySelectProps) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const selected = useMemo(
    () => currencies.find((c) => c.type === value) ?? currencies[0],
    [currencies, value],
  );

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return currencies;
    return currencies.filter(
      (c) =>
        c.sym.toLowerCase().includes(needle) || c.name.toLowerCase().includes(needle),
    );
  }, [currencies, q]);

  // close on outside-click + ESC; focus the search on open.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    if (searchable) requestAnimationFrame(() => searchRef.current?.focus());
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, searchable]);

  const pick = (type: string) => {
    onChange(type);
    setOpen(false);
    setQ('');
  };

  return (
    <div ref={rootRef} style={{ position: 'relative' }}>
      {label ? (
        <div
          style={{
            fontFamily: 'var(--mono)',
            fontSize: 10.5,
            letterSpacing: '0.2em',
            textTransform: 'uppercase',
            color: 'var(--ink-3)',
            marginBottom: 8,
          }}
        >
          {label}
        </div>
      ) : null}

      {/* trigger */}
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((o) => !o)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 11,
          padding: '12px 14px',
          borderRadius: 'var(--corner)',
          border: `1px solid ${open ? 'var(--cyan)' : 'var(--hair)'}`,
          background: 'var(--paper)',
          cursor: 'pointer',
          textAlign: 'left',
          transition: 'border-color .3s var(--e-quart)',
        }}
      >
        {selected ? <CoinDisc color={selected.color} sym={selected.sym} /> : null}
        <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: '1 1 auto' }}>
          <span style={{ fontFamily: 'var(--mono)', fontSize: 14, color: 'var(--ink)' }}>
            {selected?.sym}
          </span>
          <span
            style={{
              fontFamily: 'var(--sans)',
              fontSize: 12,
              color: 'var(--ink-3)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {selected?.name}
          </span>
        </span>
        <ChevronDown
          size={16}
          strokeWidth={ICON_STROKE}
          aria-hidden
          style={{
            flex: '0 0 auto',
            color: 'var(--ink-3)',
            transform: open ? 'rotate(180deg)' : 'none',
            transition: 'transform .3s var(--e-quart)',
          }}
        />
      </button>

      {/* panel */}
      {open ? (
        <div
          id={listId}
          role="listbox"
          className="suize-cs-panel"
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            left: 0,
            right: 0,
            zIndex: 5,
            background: 'var(--paper-2)',
            border: '1px solid var(--hair)',
            borderRadius: 'var(--corner)',
            boxShadow: '0 24px 50px -30px rgba(11,27,43,.5)',
            overflow: 'hidden',
            animation: 'suize-cs-in 0.2s var(--e-quart) both',
          }}
        >
          {searchable ? (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 9,
                padding: '11px 13px',
                borderBottom: '1px solid var(--hair-2)',
              }}
            >
              <Search size={15} strokeWidth={ICON_STROKE} aria-hidden style={{ color: 'var(--ink-3)' }} />
              <input
                ref={searchRef}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search currency"
                aria-label="Search currency"
                style={{
                  flex: '1 1 auto',
                  minWidth: 0,
                  background: 'transparent',
                  border: 'none',
                  outline: 'none',
                  fontFamily: 'var(--mono)',
                  fontSize: 13,
                  color: 'var(--ink)',
                }}
              />
            </div>
          ) : null}

          <div className="no-scrollbar" style={{ maxHeight: 248, overflowY: 'auto', padding: 4 }}>
            {filtered.length === 0 ? (
              <div
                style={{
                  padding: '16px 12px',
                  fontFamily: 'var(--mono)',
                  fontSize: 12,
                  color: 'var(--ink-3)',
                  textAlign: 'center',
                }}
              >
                No match
              </div>
            ) : (
              filtered.map((c) => {
                const active = c.type === value;
                return (
                  <button
                    key={c.type}
                    type="button"
                    role="option"
                    aria-selected={active}
                    onClick={() => pick(c.type)}
                    style={{
                      width: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 11,
                      padding: '9px 10px',
                      borderRadius: 'var(--corner)',
                      border: 'none',
                      background: active ? 'var(--cyan-wash)' : 'transparent',
                      cursor: 'pointer',
                      textAlign: 'left',
                      transition: 'background .2s var(--e-quart)',
                    }}
                  >
                    <CoinDisc color={c.color} sym={c.sym} />
                    <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: '1 1 auto' }}>
                      <span
                        style={{
                          fontFamily: 'var(--mono)',
                          fontSize: 13.5,
                          color: active ? 'var(--cyan)' : 'var(--ink)',
                        }}
                      >
                        {c.sym}
                      </span>
                      <span
                        style={{
                          fontFamily: 'var(--sans)',
                          fontSize: 11.5,
                          color: 'var(--ink-3)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {c.name}
                      </span>
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      ) : null}

      <style>{`
        @keyframes suize-cs-in { from { opacity: 0; transform: translateY(-4px) } to { opacity: 1; transform: translateY(0) } }
        @media (prefers-reduced-motion: reduce) { .suize-cs-panel { animation: none !important } }
      `}</style>
    </div>
  );
}

export default CurrencySelect;
