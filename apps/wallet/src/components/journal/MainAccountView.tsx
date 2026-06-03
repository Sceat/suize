/**
 * MainAccountView — the MAIN account's detail pane (the journal's right column
 * when the "your main account" card is selected).
 *
 * Rebuilds the two pieces deleted in the journal port:
 *   • CurrencyList — the coins the user holds (their own money), each as a brand
 *     disc + symbol/name + balance/USD. Owned-first (the data layer already sorts
 *     `state.currencies`). Display-only testnet coins are marked, never faked.
 *   • ActionRow — Add funds / Send / Convert, opening the EXISTING self-contained
 *     sheets (AddFundsSheet / SendSheet / ConvertSheet), portaled to <body> so they
 *     escape the journal's `overflow:hidden` no-scroll frame.
 *
 * This is the journal's "Main is your own money" surface: nothing automatic happens
 * here. Send is REAL (wired to `home.send`); Add funds shows the receive QR + the
 * honest "coming soon" onramps; Convert is the agent-gated quote-only sheet.
 *
 * The CSS lives in src/system/tokens-journal.css (`.curr*`, `.actions`, `.action`,
 * `.pane__scroll`), scoped under `.journal`.
 */
import { useState } from 'react';
import { createPortal } from 'react-dom';
import type { Currency, HomeApi } from '../../data/types';
import { Plus, Send, ArrowLeftRight, ICON_STROKE } from '../../system';
import { AddFundsSheet } from '../sheets/AddFundsSheet';
import { SendSheet } from '../sheets/SendSheet';
import { ConvertSheet } from '../sheets/ConvertSheet';

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

/** Which sheet is open (null = none). */
type OpenSheet = 'add' | 'send' | 'convert' | null;

export interface MainAccountViewProps {
  /** the data hook — supplies the currency list, handle/address, and the real send. */
  home: HomeApi;
}

export function MainAccountView({ home }: MainAccountViewProps) {
  const { state } = home;
  const [sheet, setSheet] = useState<OpenSheet>(null);
  const close = () => setSheet(null);

  // Coins the user actually holds, owned-first; non-zero first then the rest so the
  // list reads "what you have" without hiding the supported set entirely.
  const coins = state.currencies;
  const held = coins.filter((c) => c.ui > 0);
  const shown = held.length > 0 ? held : coins.slice(0, 2);

  return (
    <>
      <div className="pane__scroll">
        {shown.length > 0 ? (
          <div className="curr">
            {shown.map((c) => (
              <CurrencyRow key={c.type} c={c} />
            ))}
          </div>
        ) : (
          <p className="curr__empty">No coins yet. Add funds to get started.</p>
        )}
      </div>

      <div className="actions">
        <button
          type="button"
          className="action"
          onClick={() => setSheet('add')}
          aria-label="Add funds"
        >
          <Plus size={15} strokeWidth={ICON_STROKE} aria-hidden />
          Add funds
        </button>
        <button
          type="button"
          className="action"
          onClick={() => setSheet('send')}
          aria-label="Send"
        >
          <Send size={15} strokeWidth={ICON_STROKE} aria-hidden />
          Send
        </button>
        <button
          type="button"
          className="action"
          onClick={() => setSheet('convert')}
          aria-label="Convert"
        >
          <ArrowLeftRight size={15} strokeWidth={ICON_STROKE} aria-hidden />
          Convert
        </button>
      </div>

      {/* sheets portal to <body> so they escape the journal's overflow:hidden frame */}
      {sheet === 'add'
        ? createPortal(
            <AddFundsSheet
              handle={state.handle}
              address={state.address}
              onClose={close}
            />,
            document.body,
          )
        : null}
      {sheet === 'send'
        ? createPortal(
            <SendSheet
              currencies={state.currencies}
              onClose={close}
              onSend={home.send}
            />,
            document.body,
          )
        : null}
      {sheet === 'convert'
        ? createPortal(
            <ConvertSheet currencies={state.currencies} onClose={close} />,
            document.body,
          )
        : null}
    </>
  );
}

/** One coin row — brand disc + symbol/name + balance/USD. */
function CurrencyRow({ c }: { c: Currency }) {
  return (
    <div className="curr__row">
      <span
        className="curr__disc"
        style={{ background: c.color }}
        aria-hidden="true"
      >
        {c.sym.slice(0, 3)}
      </span>
      <span className="curr__meta">
        <span className="curr__sym">
          {c.sym}
          {c.displayOnly ? <span className="curr__soon">soon</span> : null}
        </span>
        <span className="curr__name">{c.name}</span>
      </span>
      <span className="curr__amt">
        <span className="ui">{uiAmount(c.ui)}</span>
        <span className="usd">{usd(c.usd)}</span>
      </span>
    </div>
  );
}

export default MainAccountView;
