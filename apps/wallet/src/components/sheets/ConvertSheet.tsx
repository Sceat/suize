/**
 * ConvertSheet — swap one currency for another (SPEC §3 Group E · §4 CONVERT · §5.5).
 *
 * QUOTE-ONLY (coming soon). The rate + expected-out come from a LIVE Cetus aggregator
 * quote (`cetus.quoteSwap` -> `AggregatorClient.findRouters`, a real HTTP route
 * lookup), debounced as the user types — so the preview is honest. But the on-chain
 * swap (`swap::agent_swap_*`) requires the AgentCap, which lives on the AGENT address
 * (transferred at account creation), NOT the owner. The owner CANNOT satisfy the cage
 * gate, so an owner-signed convert ALWAYS aborts. Rather than let it appear to work,
 * Convert is DISABLED and labelled "coming soon — needs the agent" until the agent
 * loop signs swaps. We never fabricate a success.
 *
 * Props: { currencies, onClose }.
 *
 * HONESTY (§5.5 / the brand — every reassurance must be TRUE):
 *   • The live quote is real (Cetus findRouters); the rate preview is not faked.
 *   • Convert is agent-gated and the agent isn't wired yet, so the action is disabled
 *     with a plain "coming soon — needs the agent" line. No owner-signed swap is sent.
 *   • Only SUI <-> USDC is the wired pair (the swap vault's two sides). Others quote-only.
 *
 * The sheet is self-contained: the debounced Cetus quote is a pure HTTP lookup, so no
 * dapp-kit client/signer is needed — and no new prop is threaded through WalletShell.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Sheet } from './Sheet';
import { CurrencySelect } from './CurrencySelect';
import { Button, ArrowLeftRight, ICON_STROKE } from '../../system';
import type { Currency } from '../../data/types';
import { SUI, USDC } from '../../data/coins';
import type { SwapDirection } from '../../data/ptb';
import { quoteSwap, type QuoteResult } from '../../data/cetus';
import { NETWORK } from '../../lib/env';

export interface ConvertSheetProps {
  currencies: Currency[];
  onClose: () => void;
}

/** Debounce (ms) before firing a live quote as the user types — matches SendSheet. */
const QUOTE_DEBOUNCE_MS = 500;

/**
 * Parse a human decimal string into the coin's smallest unit (bigint) WITHOUT float
 * math (float drops precision on large balances). Returns null for junk / zero. Excess
 * fractional digits beyond `decimals` are truncated (never rounded up past intent).
 * (Same parser SendSheet uses — kept local so each sheet stays self-contained.)
 */
function toBaseUnits(amount: string, decimals: number): bigint | null {
  const trimmed = amount.trim();
  if (!/^\d*\.?\d*$/.test(trimmed) || trimmed === '' || trimmed === '.') return null;
  const [whole = '', frac = ''] = trimmed.split('.');
  const fracPadded = frac.slice(0, decimals).padEnd(decimals, '0');
  const digits = `${whole}${fracPadded}`.replace(/^0+/, '') || '0';
  let raw: bigint;
  try {
    raw = BigInt(digits);
  } catch {
    return null;
  }
  return raw > 0n ? raw : null;
}

/** The swap direction for a SUI<->USDC pair, or null if the pair isn't the vault's sides. */
function directionFor(fromType: string, toType: string): SwapDirection | null {
  if (fromType === SUI.type && toType === USDC.type) return 'base_to_quote';
  if (fromType === USDC.type && toType === SUI.type) return 'quote_to_base';
  return null;
}

export function ConvertSheet({ currencies, onClose }: ConvertSheetProps) {
  const [fromType, setFromType] = useState<string>(currencies[0]?.type ?? '');
  const [toType, setToType] = useState<string>(currencies[1]?.type ?? currencies[0]?.type ?? '');
  const [amount, setAmount] = useState('');

  // Live quote state (driven by the debounced Cetus lookup) — the rate preview only.
  const [quote, setQuote] = useState<QuoteResult | null>(null);
  const [quoting, setQuoting] = useState(false);

  const quoteReqId = useRef(0);

  const from = useMemo(() => currencies.find((c) => c.type === fromType), [currencies, fromType]);
  const to = useMemo(() => currencies.find((c) => c.type === toType), [currencies, toType]);

  const fromAmtRaw = useMemo(
    () => (from ? toBaseUnits(amount, from.decimals) : null),
    [amount, from],
  );
  const fromUi = Number(amount);

  // ── Live quote (debounced) — the REAL rate + expected-out via Cetus findRouters ──
  useEffect(() => {
    if (!from || !to || fromType === toType || fromAmtRaw == null) {
      setQuote(null);
      setQuoting(false);
      return;
    }

    setQuoting(true);
    const id = ++quoteReqId.current;
    const t = window.setTimeout(() => {
      void quoteSwap(
        { fromType, toType, amountInRaw: fromAmtRaw.toString() },
        to.decimals,
        fromUi,
      ).then(
        (res) => {
          if (id !== quoteReqId.current) return; // a newer keystroke superseded this
          setQuote(res);
          setQuoting(false);
        },
        () => {
          if (id !== quoteReqId.current) return;
          setQuote({ ok: false, reason: 'error' });
          setQuoting(false);
        },
      );
    }, QUOTE_DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [from, to, fromType, toType, fromAmtRaw, fromUi]);

  const swap = () => {
    setFromType(toType);
    setToType(fromType);
    setAmount('');
    setQuote(null);
  };

  const fmt = (n: number, d = 4) =>
    n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });

  const toAmtUi = quote?.ok ? quote.amountOutUi : 0;

  // ── Convert is AGENT-GATED and the agent isn't wired yet ────────────────────────
  // swap::agent_swap_* requires the AgentCap, which lives on the AGENT address (not
  // the owner). An owner-signed convert can NEVER satisfy the cage gate → it always
  // aborts. So Convert is DISABLED until the agent loop signs swaps; we keep the live
  // quote as an honest rate preview but never send an owner-signed swap that would lie.
  const direction = directionFor(fromType, toType);

  // ── The honest sub-line under the rate (one true status, never a fake number) ───
  const statusLine = (() => {
    if (fromType === toType) return 'Pick two different currencies.';
    if (!direction) return `Live swaps are SUI <-> USDC on ${NETWORK}. Other pairs are quote-only.`;
    if (quoting) return 'Fetching live route…';
    if (quote && !quote.ok) return 'No route on testnet';
    // The agent (cap holder) signs the swap; the owner can't. Until it's wired, the
    // action is disabled — coming soon, plainly stated (never a fake convert).
    return 'Coming soon — needs the agent to sign.';
  })();

  const buttonLabel = 'Convert — coming soon';

  return (
    <Sheet title="Convert" sub="Swap one currency for another." onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* From */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <CurrencySelect
            label="From"
            value={fromType}
            onChange={setFromType}
            currencies={currencies}
            searchable
          />
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '13px 15px',
              borderRadius: 'var(--corner)',
              border: '1px solid var(--hair)',
              background: 'var(--paper)',
            }}
          >
            <input
              value={amount}
              onChange={(e) => setAmount(e.currentTarget.value)}
              inputMode="decimal"
              placeholder="0.00"
              aria-label="Amount to convert"
              className="tnum"
              style={{
                flex: '1 1 auto',
                minWidth: 0,
                background: 'transparent',
                border: 'none',
                outline: 'none',
                fontFamily: 'var(--mono)',
                fontSize: 18,
                color: 'var(--ink)',
              }}
            />
            <span style={{ fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--ink-3)', flex: '0 0 auto' }}>
              {from?.sym}
            </span>
          </div>
        </div>

        {/* swap */}
        <div style={{ display: 'grid', placeItems: 'center', margin: '-4px 0' }}>
          <button
            type="button"
            onClick={swap}
            aria-label="Swap From and To"
            style={{
              width: 38,
              height: 38,
              borderRadius: 999,
              display: 'grid',
              placeItems: 'center',
              border: '1px solid var(--hair)',
              background: 'var(--paper-2)',
              color: 'var(--cyan)',
              cursor: 'pointer',
              transition: 'transform .4s var(--e-spring), border-color .3s var(--e-quart)',
            }}
          >
            <ArrowLeftRight
              size={16}
              strokeWidth={ICON_STROKE}
              aria-hidden
              style={{ transform: 'rotate(90deg)' }}
            />
          </button>
        </div>

        {/* To (computed from the live quote, read-only) */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <CurrencySelect
            label="To"
            value={toType}
            onChange={setToType}
            currencies={currencies}
            searchable
          />
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '13px 15px',
              borderRadius: 'var(--corner)',
              border: '1px solid var(--hair-2)',
              background: 'var(--paper-3)',
            }}
          >
            <span
              className="tnum"
              style={{
                flex: '1 1 auto',
                minWidth: 0,
                fontFamily: 'var(--mono)',
                fontSize: 18,
                // money figure → blue when there's a real quoted amount; muted at $0.
                color: toAmtUi > 0 ? 'var(--blue-deep)' : 'var(--ink-3)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {toAmtUi > 0 ? fmt(toAmtUi, 4) : '0.00'}
            </span>
            <span style={{ fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--ink-3)', flex: '0 0 auto' }}>
              {to?.sym}
            </span>
          </div>
        </div>

        {/* rate line + honest live/no-route status */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
            fontFamily: 'var(--mono)',
            fontSize: 12,
          }}
        >
          {quote?.ok ? (
            <span className="tnum" style={{ color: 'var(--ink-2)' }}>
              1 {from?.sym} ≈ {fmt(quote.rate, 4)} {to?.sym}
            </span>
          ) : (
            <span className="tnum" style={{ color: 'var(--ink-3)' }}>
              1 {from?.sym} ≈ — {to?.sym}
            </span>
          )}
          <span
            style={{
              color: quote && !quote.ok ? 'var(--warn)' : 'var(--ink-3)',
              fontSize: 11,
              letterSpacing: '0.02em',
            }}
          >
            {statusLine}
          </span>
        </div>

        {/* Convert is agent-gated and the agent isn't wired yet — disabled, plainly. */}
        <Button variant="primary" size="lg" disabled>
          {buttonLabel}
        </Button>
      </div>
    </Sheet>
  );
}

export default ConvertSheet;
