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
import { useMemo, useState, type ReactNode } from 'react';
import { ArrowRight, Check, Copy, X, ICON_STROKE } from '../system';
import { ACTIONS, money } from './copy';
import { SuizeQr, rich } from './bits';

// ── the base sheet ─────────────────────────────────────────────────────────────

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
  return (
    <div className="rd-sheetwrap" role="dialog" aria-label={title}>
      <div className="rd-scrim is-open" onClick={onClose} />
      <article className="rd-sheet rd-glass">
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
          <button type="button" className="rd-chip" onClick={() => onChange(String(max))}>
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

export function AddFundsSheet({ handle, onClose }: { handle: string; onClose: () => void }) {
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
          <span className="rd-label">{ACTIONS.addFunds.request}</span>
          <AmountField value={amount} onChange={setAmount} />
        </div>
      </div>

      {link ? (
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
  if (/^0x[0-9a-fA-F]{4,}$/.test(v)) return 'address';
  if (/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) return 'email'; // has a dot TLD
  if (/^[a-z0-9-]{3,}@[a-z0-9-]+$/.test(v)) return 'handle'; // name@suize-shaped
  if (/^\+?[0-9][0-9\s().-]{6,}$/.test(v)) return 'phone';
  return 'none';
}

export function SendSheet({
  available,
  onSend,
  onClose,
}: {
  available: number;
  onSend: (amt: number) => void;
  onClose: () => void;
}) {
  const [to, setTo] = useState('');
  const [amount, setAmount] = useState('');
  const [sent, setSent] = useState<null | 'sent' | 'link'>(null);

  const kind = detectRecipient(to);
  const amt = parseFloat(amount) || 0;
  const amountOk = amt > 0 && amt <= available;
  // direct send for handle/address; email/phone route to a claim link
  const direct = kind === 'handle' || kind === 'address';
  const viaLink = kind === 'email' || kind === 'phone';

  function fire(asLink: boolean) {
    onSend(amt);
    setSent(asLink ? 'link' : 'sent');
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

          <div className="rd-sheet__acts">
            {viaLink ? (
              <button type="button" className="rd-cta" disabled={!amountOk} onClick={() => fire(true)}>
                {ACTIONS.send.claimCta}
                <ArrowRight size={14} strokeWidth={ICON_STROKE} aria-hidden />
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className="rd-cta"
                  disabled={!direct || !amountOk}
                  onClick={() => fire(false)}
                >
                  {ACTIONS.send.cta}
                  <ArrowRight size={14} strokeWidth={ICON_STROKE} aria-hidden />
                </button>
                <button type="button" className="rd-btn" disabled={!amountOk} onClick={() => fire(true)}>
                  {ACTIONS.send.claimAlt}
                </button>
              </>
            )}
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
  onMove: (amt: number) => void;
  onClose: () => void;
}) {
  const copy = ACTIONS[kind];
  const [amount, setAmount] = useState('');
  const amt = parseFloat(amount) || 0;
  const ready = amt > 0 && amt <= available;

  return (
    <Sheet title={copy.title} sub={copy.sub} onClose={onClose}>
      <AmountField value={amount} onChange={setAmount} max={available} />
      <p className="rd-sheet__note">
        Available · <span className="rd-money">{money(available)}</span>
      </p>
      <button
        type="button"
        className="rd-cta"
        disabled={!ready}
        onClick={() => {
          onMove(amt);
          onClose();
        }}
      >
        {copy.cta}
      </button>
    </Sheet>
  );
}
