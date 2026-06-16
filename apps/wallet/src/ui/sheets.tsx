/**
 * THE MONEY ACTION SHEETS, shared by both faces:
 *
 *   AddFundsSheet — receive: the Suize-branded QR + the copyable handle, and an
 *                   exact-amount REQUEST link (the wallet surface — person-to-
 *                   person requests ride the FREE rail verb, never the merchant
 *                   pay-link and its fee), plus the coming-soon rails
 *                   (bank / Apple Pay / card). Fits WITHOUT scrolling.
 *   SendSheet     — pay: detects name@suize and 0x addresses (direct send), AND
 *                   emails / phone numbers — those are flagged coming-soon and
 *                   routed to a CLAIM LINK instead (no jargon, no memo field).
 *   MoveSheet     — top-up / withdraw / transfer with quick chips + Max.
 *
 * The QR is decorative (NOT scannable) — the copy row is the real share surface.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowRight, Check, Copy, X, ICON_STROKE } from '../system';
import { ACTIONS, AGENT, money } from './copy';
import { normalizeSuiName } from '../data/suins';
import { SuizeQr, rich } from './bits';

// ── the base sheet ─────────────────────────────────────────────────────────────

const FOCUSABLE = 'button:not(:disabled), input:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])';

export function Sheet({
  title,
  sub,
  onClose,
  children,
}: {
  title: string;
  sub?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const paneRef = useRef<HTMLElement>(null);

  // Escape closes; Tab cycles INSIDE the sheet (a real modal focus trap);
  // focus moves in on open and returns to the opener on close.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const pane = paneRef.current;
    const focusables = () => [...(pane?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
    focusables()[0]?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const list = focusables();
      if (list.length === 0) return;
      const first = list[0];
      const last = list[list.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !pane?.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !pane?.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      opener?.focus?.();
    };
  }, [onClose]);

  return (
    <div className="rd-sheetwrap" role="dialog" aria-modal="true" aria-label={title}>
      <div className="rd-scrim is-open" onClick={onClose} />
      <article className="rd-sheet rd-glass" ref={paneRef}>
        <header className="rd-sheet__head">
          <div>
            <h3 className="rd-sheet__title">{title}</h3>
            {sub ? <p className="rd-sheet__sub">{sub}</p> : null}
          </div>
          <button type="button" className="rd-books__close" aria-label="Close" onClick={onClose}>
            <X size={16} strokeWidth={ICON_STROKE} aria-hidden />
          </button>
        </header>
        <div className="rd-sheet__body">{children}</div>
      </article>
    </div>
  );
}

/** amount input + quick chips + Max — every money sheet shares this */
function AmountField({
  value,
  onChange,
  max,
}: {
  value: string;
  onChange: (v: string) => void;
  max?: number;
}) {
  return (
    <div className="rd-sheet__amountwrap">
      <div className="rd-sheet__amount">
        <span>$</span>
        <input
          value={value}
          onChange={(e) => onChange(e.target.value.replace(/[^0-9.]/g, ''))}
          placeholder={ACTIONS.addFunds.requestPlaceholder}
          inputMode="decimal"
          aria-label="Amount"
        />
      </div>
      <div className="rd-sheet__quick">
        {ACTIONS.quick.map((q) => (
          <button key={q} type="button" className="rd-chip" onClick={() => onChange(String(q))}>
            ${q}
          </button>
        ))}
        {max != null ? (
          // FLOOR to cents — rounding a sub-cent dust balance UP builds a tx
          // for more than the user holds and aborts on-chain
          <button type="button" className="rd-chip" onClick={() => onChange((Math.floor(max * 100) / 100).toFixed(2))}>
            {ACTIONS.max}
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** a copyable artifact chip (link / handle) */
function CopyRow({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="rd-sheet__copyrow"
      onClick={() => {
        void navigator.clipboard?.writeText(text).catch(() => {});
        setDone(true);
        setTimeout(() => setDone(false), 1400);
      }}
    >
      <span className="rd-money" style={{ fontSize: 12 }}>
        {text}
      </span>
      {done ? (
        <span className="rd-sheet__copied">
          <Check size={12} strokeWidth={2.2} aria-hidden />
          {ACTIONS.addFunds.copied}
        </span>
      ) : (
        <Copy size={13} strokeWidth={ICON_STROKE} aria-hidden />
      )}
    </button>
  );
}

// ── ADD FUNDS (receive) — compact, never scrolls ───────────────────────────────

export function AddFundsSheet({
  handle,
  onClose,
  requestEnabled = false,
}: {
  handle: string;
  onClose: () => void;
  /** the request-link route doesn't exist yet — demo-only until it ships
   *  (production shows the Soon chip; never mint a link that leads nowhere) */
  requestEnabled?: boolean;
}) {
  const [amount, setAmount] = useState('');
  const [link, setLink] = useState<string | null>(null);
  const slug = useMemo(() => handle.split('@')[0], [handle]);
  const amt = parseFloat(amount) || 0;

  return (
    <Sheet title={ACTIONS.addFunds.title} sub={ACTIONS.addFunds.sub} onClose={onClose}>
      <div className="rd-sheet__qrzone">
        <div className="rd-sheet__qr">
          <SuizeQr value={handle} size={148} />
        </div>
        <div className="rd-sheet__qrside">
          <CopyRow text={handle} />
          {requestEnabled ? (
            <>
              <span className="rd-label">{ACTIONS.addFunds.request}</span>
              <AmountField value={amount} onChange={setAmount} />
            </>
          ) : null}
        </div>
      </div>
      <p className="rd-sheet__note">{ACTIONS.addFunds.network}</p>

      {requestEnabled ? (
        link ? (
          <CopyRow text={link} />
        ) : (
          <button
            type="button"
            className="rd-cta"
            disabled={!amt}
            onClick={() => setLink(`${ACTIONS.addFunds.linkBase}${slug}/${amt.toFixed(2)}`)}
          >
            {ACTIONS.addFunds.create}
          </button>
        )
      ) : (
        <span className="rd-chip rd-chip--soon" style={{ alignSelf: 'flex-start' }}>
          {ACTIONS.addFunds.request}
          <span className="rd-soon">{ACTIONS.addFunds.soonTag}</span>
        </span>
      )}

      <div className="rd-rule" />

      <div className="rd-sheet__soonrow">
        <span className="rd-label">{ACTIONS.addFunds.more}</span>
        <div className="rd-sheet__soonchips">
          {ACTIONS.addFunds.soon.map((s) => (
            <span className="rd-chip rd-chip--soon" key={s}>
              {s}
              <span className="rd-soon">{ACTIONS.addFunds.soonTag}</span>
            </span>
          ))}
        </div>
      </div>
    </Sheet>
  );
}

// ── SEND (pay) ─────────────────────────────────────────────────────────────────

type Recipient = 'none' | 'handle' | 'address' | 'email' | 'phone';

function detectRecipient(raw: string): Recipient {
  const v = raw.trim();
  if (!v) return 'none';
  // a FULL 64-hex address only — anything shorter would fall into SuiNS
  // resolution and fail post-submit with a misleading error
  if (/^0x[0-9a-fA-F]{64}$/.test(v)) return 'address';
  // any valid SuiNS name/subname — hello@suize · @name · name.sui · x.y.sui — is
  // a direct send (the ONE normalizer is the source of truth, shared with resolve).
  if (normalizeSuiName(v)) return 'handle';
  if (/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) return 'email'; // a@b.tld
  if (/^\+?[0-9][0-9\s().-]{6,}$/.test(v)) return 'phone';
  return 'none';
}

export function SendSheet({
  available,
  onSend,
  onClose,
  claimEnabled = false,
}: {
  available: number;
  /** resolves + executes the send; THROW to surface a calm error in the sheet */
  onSend: (amt: number, to: string) => Promise<void> | void;
  onClose: () => void;
  /** claim links need their backend — demo-only until it ships (Soon otherwise) */
  claimEnabled?: boolean;
}) {
  const [to, setTo] = useState('');
  const [amount, setAmount] = useState('');
  const [sent, setSent] = useState<null | 'sent' | 'link'>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const kind = detectRecipient(to);
  const amt = parseFloat(amount) || 0;
  const amountOk = amt > 0 && amt <= available;
  // direct send for handle/address; email/phone route to a claim link
  const direct = kind === 'handle' || kind === 'address';
  const viaLink = kind === 'email' || kind === 'phone';

  async function fire(asLink: boolean) {
    setBusy(true);
    setError(null);
    try {
      await onSend(amt, to.trim());
      setSent(asLink ? 'link' : 'sent');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not send — try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet title={ACTIONS.send.title} onClose={onClose}>
      {sent ? (
        <div className="rd-sheet__done">
          {sent === 'link' ? (
            <>
              <CopyRow text={`${ACTIONS.send.claimBase}${amt.toFixed(2).replace('.', '')}-k2d9`} />
              <p className="rd-sheet__note">{ACTIONS.send.claimNote}</p>
            </>
          ) : (
            <span className="rd-paid" style={{ marginTop: 0 }}>
              <i>
                <Check size={10} strokeWidth={2.4} aria-hidden />
              </i>
              {ACTIONS.send.sent}
            </span>
          )}
          <button type="button" className="rd-btn" onClick={onClose}>
            Done
          </button>
        </div>
      ) : (
        <>
          <span className="rd-label">{ACTIONS.send.to}</span>
          <div className="rd-sheet__field">
            <input
              autoFocus
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder={ACTIONS.send.toPlaceholder}
              aria-label={ACTIONS.send.to}
              spellCheck={false}
            />
          </div>
          <span
            className={`rd-jny__status${kind === 'handle' ? ' is-free' : ''}`}
            style={{ minHeight: 16 }}
            aria-live="polite"
          >
            {kind === 'handle' ? (
              <>
                <Check size={12} strokeWidth={2.2} aria-hidden />
                {rich(to.trim())} · {ACTIONS.send.found}
              </>
            ) : kind === 'address' ? (
              <>
                <Check size={12} strokeWidth={2.2} aria-hidden />
                {ACTIONS.send.addressReady}
              </>
            ) : kind === 'email' ? (
              ACTIONS.send.emailSoon
            ) : kind === 'phone' ? (
              ACTIONS.send.phoneSoon
            ) : (
              ' '
            )}
          </span>

          <span className="rd-label">{ACTIONS.send.amount}</span>
          <AmountField value={amount} onChange={setAmount} max={available} />

          {error ? (
            <p className="rd-sheet__error" role="alert">
              {error}
            </p>
          ) : null}

          <div className="rd-sheet__acts">
            {viaLink ? (
              claimEnabled ? (
                <button type="button" className="rd-cta" disabled={!amountOk || busy} onClick={() => fire(true)}>
                  {ACTIONS.send.claimCta}
                  <ArrowRight size={14} strokeWidth={ICON_STROKE} aria-hidden />
                </button>
              ) : (
                <span className="rd-chip rd-chip--soon" style={{ alignSelf: 'flex-start' }}>
                  {ACTIONS.send.claimCta}
                  <span className="rd-soon">{ACTIONS.addFunds.soonTag}</span>
                </span>
              )
            ) : (
              <>
                <button
                  type="button"
                  className="rd-cta"
                  disabled={!direct || !amountOk || busy}
                  onClick={() => fire(false)}
                >
                  {busy ? 'Sending…' : ACTIONS.send.cta}
                  <ArrowRight size={14} strokeWidth={ICON_STROKE} aria-hidden />
                </button>
                {claimEnabled ? (
                  <button type="button" className="rd-btn" disabled={!amountOk || busy} onClick={() => fire(true)}>
                    {ACTIONS.send.claimAlt}
                  </button>
                ) : null}
              </>
            )}
          </div>

          <div className="rd-rule" />

          <div className="rd-sheet__soonrow">
            <span className="rd-label">{ACTIONS.send.payoutsLabel}</span>
            <div className="rd-sheet__soonchips">
              {ACTIONS.send.payouts.map((s) => (
                <span className="rd-chip rd-chip--soon" key={s}>
                  {s}
                  <span className="rd-soon">{ACTIONS.addFunds.soonTag}</span>
                </span>
              ))}
            </div>
          </div>
        </>
      )}
    </Sheet>
  );
}

// ── MOVE (top up / withdraw / transfer) ────────────────────────────────────────

export function MoveSheet({
  kind,
  available,
  onMove,
  onClose,
}: {
  kind: 'topUp' | 'withdraw' | 'transfer';
  available: number;
  /** executes the move; THROW to surface a calm error in the sheet */
  onMove: (amt: number) => Promise<void> | void;
  onClose: () => void;
}) {
  const copy = ACTIONS[kind];
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const amt = parseFloat(amount) || 0;
  const ready = amt > 0 && amt <= available;

  return (
    <Sheet title={copy.title} sub={copy.sub} onClose={onClose}>
      <AmountField value={amount} onChange={setAmount} max={available} />
      <p className="rd-sheet__note">
        Available · <span className="rd-money">{money(available)}</span>
      </p>
      {error ? (
        <p className="rd-sheet__error" role="alert">
          {error}
        </p>
      ) : null}
      <button
        type="button"
        className="rd-cta"
        disabled={!ready || busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            await onMove(amt);
            onClose();
          } catch (e: unknown) {
            setError(e instanceof Error ? e.message : 'Could not move the money — try again.');
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? 'Working…' : copy.cta}
      </button>
    </Sheet>
  );
}

// ── FUND AGENT — a plain send to the agent's address (its cap grows) ────────────

export function FundAgentSheet({
  available,
  onFund,
  onClose,
}: {
  available: number;
  /** sends `amt` USDC to the agent address; THROW to surface a calm error. */
  onFund: (amt: number) => Promise<void> | void;
  onClose: () => void;
}) {
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const amt = parseFloat(amount) || 0;
  const ready = amt > 0 && amt <= available;

  return (
    <Sheet title={AGENT.fund.title} sub={AGENT.fund.sub} onClose={onClose}>
      <AmountField value={amount} onChange={setAmount} max={available} />
      <p className="rd-sheet__note">
        Available · <span className="rd-money">{money(available)}</span>
      </p>
      {error ? (
        <p className="rd-sheet__error" role="alert">
          {error}
        </p>
      ) : null}
      <button
        type="button"
        className="rd-cta"
        disabled={!ready || busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            await onFund(amt);
            onClose();
          } catch (e: unknown) {
            setError(e instanceof Error ? e.message : 'Could not fund your agent — try again.');
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? 'Funding…' : AGENT.fund.cta}
      </button>
    </Sheet>
  );
}

// ── WITHDRAW AGENT — pull the shared sub-account balance back to your wallet ──
// One tap, you sign alone (the 1-of-2 MAIN member). No revoke clutter — pausing
// the agent is a separate, direct control on the deck.

export function WithdrawAgentSheet({
  balance,
  onWithdraw,
  onClose,
}: {
  /** the sub-account's current balance (the Max). */
  balance: number;
  /** withdraw `amt` USDC back to the wallet (you sign alone); THROW to surface a calm error. */
  onWithdraw: (amt: number) => Promise<void> | void;
  onClose: () => void;
}) {
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const amt = parseFloat(amount) || 0;
  const ready = amt > 0 && amt <= balance;

  return (
    <Sheet title={AGENT.withdraw.title} sub={AGENT.withdraw.sub} onClose={onClose}>
      <AmountField value={amount} onChange={setAmount} max={balance} />
      <p className="rd-sheet__note">
        {AGENT.withdraw.label} · <span className="rd-money">{money(balance)}</span>
      </p>
      {error ? (
        <p className="rd-sheet__error" role="alert">
          {error}
        </p>
      ) : null}
      <button
        type="button"
        className="rd-cta"
        disabled={!ready || busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            await onWithdraw(amt);
            onClose();
          } catch (e: unknown) {
            setError(e instanceof Error ? e.message : 'Could not withdraw — try again.');
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? AGENT.withdraw.working : balance > 0 ? AGENT.withdraw.cta : AGENT.withdraw.empty}
      </button>
    </Sheet>
  );
}

// ── CANCEL SUBSCRIPTION — a small confirm (the on-chain destroy) ────────────────

export function CancelSubSheet({
  label,
  perMonth,
  onConfirm,
  onClose,
}: {
  label: string;
  perMonth: number;
  /** runs the on-chain cancel; THROW to surface a calm error in the sheet. */
  onConfirm: () => Promise<void> | void;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Sheet title="Cancel subscription" sub={`${label} · ${money(perMonth)}/mo`} onClose={onClose}>
      <p className="rd-sheet__note">
        This stops the subscription on-chain — no more renewals. Anything already paid stays paid.
      </p>
      {error ? (
        <p className="rd-sheet__error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="rd-sheet__acts">
        <button
          type="button"
          className="rd-cta"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              await onConfirm();
              onClose();
            } catch (e: unknown) {
              setError(e instanceof Error ? e.message : 'Could not cancel — try again.');
              setBusy(false);
            }
          }}
        >
          {busy ? 'Cancelling…' : 'Cancel subscription'}
        </button>
        <button type="button" className="rd-btn" onClick={onClose}>
          Keep it
        </button>
      </div>
    </Sheet>
  );
}
