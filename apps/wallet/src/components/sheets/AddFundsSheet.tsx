/**
 * AddFundsSheet — the "Add / Receive" sheet (SPEC §3 Group E · §4 ADD).
 *
 * Two tabs share one sheet:
 *   - "Add money" — the deposit surface: a decorative QR of the wallet address,
 *     the @name + raw hex (both tap-to-copy), and the MUTED "Coming soon" onramps
 *     (Apple Pay · Bank transfer · Card) — non-interactive, never faked.
 *   - "Receive" — a payment-REQUEST builder: the @handle, an optional amount, and
 *     a shareable pay-link (buildPayLink) shown as a QR + tap-to-copy row, with
 *     Copy / Share / Email actions. Honest: no backend — people can also just send
 *     to your @handle, and the link only PREFILLS a normal Send.
 *
 * Props: { handle, address, onClose }. The "Secure" footer + chrome come from <Sheet/>.
 */
import { useCallback, useState } from 'react';
import { Sheet } from './Sheet';
import { Qr } from '../Qr';
import {
  Check,
  Copy,
  CreditCard,
  Landmark,
  Smartphone,
  QrCode,
  Share2,
  Mail,
  Link as LinkIcon,
  ICON_STROKE,
} from '../../system';
import { buildPayLink, payLinkMailto, payLinkShareText } from '../../data/paylink';

export interface AddFundsSheetProps {
  /** "<name>@suize". */
  handle: string;
  /** the raw 0x… wallet address. */
  address: string;
  onClose: () => void;
}

type Tab = 'add' | 'receive';

function shortHex(addr: string): string {
  if (addr.length <= 16) return addr;
  return `${addr.slice(0, 10)}…${addr.slice(-6)}`;
}

/** A tap-to-copy row used for the @name, the hex address, and the pay-link. */
function CopyRow({
  value,
  display,
  ariaLabel,
  copiedLabel,
  mono = true,
}: {
  value: string;
  display: string;
  ariaLabel: string;
  copiedLabel: string;
  mono?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const onCopy = useCallback(() => {
    void navigator.clipboard?.writeText(value).then(
      () => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1600);
      },
      () => {},
    );
  }, [value]);

  return (
    <button
      type="button"
      onClick={onCopy}
      aria-label={copied ? copiedLabel : ariaLabel}
      style={{
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        padding: '13px 15px',
        borderRadius: 'var(--corner)',
        border: '1px solid var(--hair)',
        background: 'var(--paper)',
        cursor: 'pointer',
        textAlign: 'left',
        transition: 'border-color .3s var(--e-quart)',
      }}
    >
      <span
        style={{
          fontFamily: mono ? 'var(--mono)' : 'var(--sans)',
          fontSize: mono ? 14 : 16,
          color: 'var(--ink)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {display}
      </span>
      <span
        style={{
          flex: '0 0 auto',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          fontFamily: 'var(--mono)',
          fontSize: 11,
          letterSpacing: '0.04em',
          color: copied ? 'var(--good)' : 'var(--ink-3)',
        }}
      >
        {copied ? (
          <Check size={13} strokeWidth={ICON_STROKE} aria-hidden />
        ) : (
          <Copy size={13} strokeWidth={ICON_STROKE} aria-hidden />
        )}
        {copied ? copiedLabel : 'Copy'}
      </span>
    </button>
  );
}

/** The segmented "Add money / Receive" tab switcher. */
function TabSwitcher({ tab, onTab }: { tab: Tab; onTab: (t: Tab) => void }) {
  const tabs: { id: Tab; label: string }[] = [
    { id: 'add', label: 'Add money' },
    { id: 'receive', label: 'Receive' },
  ];
  return (
    <div
      role="tablist"
      aria-label="Add or receive"
      style={{
        display: 'flex',
        gap: 4,
        marginBottom: 20,
        borderBottom: '1px solid var(--hair-2)',
      }}
    >
      {tabs.map((t) => {
        const active = t.id === tab;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onTab(t.id)}
            style={{
              appearance: 'none',
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
              padding: '8px 4px 11px',
              marginBottom: -1,
              fontFamily: 'var(--sans)',
              fontSize: 14,
              letterSpacing: '0.01em',
              color: active ? 'var(--ink)' : 'var(--ink-3)',
              borderBottom: `2px solid ${active ? 'var(--cyan)' : 'transparent'}`,
              transition: 'color .25s var(--e-quart), border-color .25s var(--e-quart)',
            }}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

/** A small action button (Copy / Share / Email) used in the Receive tab's action row. */
function ActionButton({
  icon,
  label,
  onClick,
  href,
  done = false,
}: {
  icon: React.ReactNode;
  label: string;
  onClick?: () => void;
  href?: string;
  done?: boolean;
}) {
  const style: React.CSSProperties = {
    flex: '1 1 0',
    display: 'inline-flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    padding: '13px 8px',
    borderRadius: 'var(--corner)',
    border: '1px solid var(--hair)',
    background: 'var(--paper)',
    color: done ? 'var(--good)' : 'var(--ink)',
    fontFamily: 'var(--mono)',
    fontSize: 11,
    letterSpacing: '0.04em',
    textDecoration: 'none',
    cursor: 'pointer',
    transition: 'border-color .3s var(--e-quart), color .3s var(--e-quart)',
  };
  const inner = (
    <>
      {done ? <Check size={17} strokeWidth={ICON_STROKE} aria-hidden /> : icon}
      {done ? 'Copied' : label}
    </>
  );
  if (href) {
    return (
      <a href={href} aria-label={label} style={style}>
        {inner}
      </a>
    );
  }
  return (
    <button type="button" aria-label={label} onClick={onClick} style={style}>
      {inner}
    </button>
  );
}

/** TAB: "Add money" — the deposit surface (QR + @name/hex + coming-soon onramps). */
function AddTab({ handle, address }: { handle: string; address: string }) {
  return (
    <>
      {/* QR */}
      <div style={{ display: 'grid', placeItems: 'center', marginBottom: 18 }}>
        <Qr value={address || handle} size={176} />
      </div>

      {/* @name + hex, both copyable */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
        <CopyRow
          value={handle}
          display={handle}
          ariaLabel="Tap your name to copy"
          copiedLabel="Copied your name"
          mono={false}
        />
        <CopyRow
          value={address}
          display={shortHex(address)}
          ariaLabel="Copy wallet address"
          copiedLabel="Copied address"
        />
      </div>

      {/* Coming soon — muted, non-interactive, never faked */}
      <div style={{ marginTop: 24 }}>
        <div
          style={{
            fontFamily: 'var(--mono)',
            fontSize: 10.5,
            letterSpacing: '0.2em',
            textTransform: 'uppercase',
            color: 'var(--ink-3)',
            marginBottom: 10,
          }}
        >
          Coming soon
        </div>
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 7 }}>
          {[
            { icon: <Smartphone size={17} strokeWidth={ICON_STROKE} aria-hidden />, label: 'Apple Pay' },
            { icon: <Landmark size={17} strokeWidth={ICON_STROKE} aria-hidden />, label: 'Bank transfer' },
            { icon: <CreditCard size={17} strokeWidth={ICON_STROKE} aria-hidden />, label: 'Card' },
          ].map((row) => (
            <li
              key={row.label}
              aria-disabled="true"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '12px 15px',
                borderRadius: 'var(--corner)',
                border: '1px solid var(--hair-2)',
                background: 'transparent',
                color: 'var(--ink-3)',
                opacity: 0.65,
                cursor: 'default',
                userSelect: 'none',
              }}
            >
              <span style={{ flex: '0 0 auto', display: 'inline-flex' }}>{row.icon}</span>
              <span style={{ fontFamily: 'var(--sans)', fontSize: 14, flex: '1 1 auto' }}>{row.label}</span>
              <span style={{ fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                Soon
              </span>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}

/** TAB: "Receive" — a payment-request builder (pay-link QR + Copy/Share/Email). */
function ReceiveTab({ handle }: { handle: string }) {
  const [amount, setAmount] = useState('');
  const [copied, setCopied] = useState(false);
  const [shared, setShared] = useState(false);

  const trimmed = amount.trim();
  const link = buildPayLink({ handle, amount: trimmed || undefined });

  const flash = useCallback((set: (v: boolean) => void) => {
    set(true);
    window.setTimeout(() => set(false), 1600);
  }, []);

  const onCopy = useCallback(() => {
    void navigator.clipboard?.writeText(link).then(() => flash(setCopied), () => {});
  }, [link, flash]);

  const onShare = useCallback(() => {
    const text = payLinkShareText(link, trimmed || undefined);
    // Native share when available, else graceful fallback to copying the link.
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      void navigator.share({ url: link, text }).catch(() => {});
      return;
    }
    void navigator.clipboard?.writeText(link).then(() => flash(setShared), () => {});
  }, [link, trimmed, flash]);

  return (
    <>
      {/* the @handle, large */}
      <div style={{ display: 'grid', placeItems: 'center', marginBottom: 18, textAlign: 'center' }}>
        <div
          style={{
            fontFamily: 'var(--serif)',
            fontWeight: 400,
            fontSize: 'clamp(1.5rem, 6vw, 1.9rem)',
            letterSpacing: '-0.01em',
            color: 'var(--ink)',
          }}
        >
          {handle}
        </div>
        <div
          style={{
            marginTop: 4,
            fontFamily: 'var(--sans)',
            fontSize: 13,
            color: 'var(--ink-3)',
          }}
        >
          Ask someone to pay you
        </div>
      </div>

      {/* optional request amount */}
      <div style={{ marginBottom: 16 }}>
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
          Request amount · optional
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '12px 15px',
            borderRadius: 'var(--corner)',
            border: '1px solid var(--hair)',
            background: 'var(--paper)',
          }}
        >
          <span style={{ fontFamily: 'var(--sans)', fontSize: 18, color: 'var(--ink-3)' }}>$</span>
          <input
            value={amount}
            onChange={(e) => setAmount(e.currentTarget.value)}
            placeholder="0.00"
            inputMode="decimal"
            spellCheck={false}
            aria-label="Request amount in dollars"
            style={{
              flex: '1 1 auto',
              minWidth: 0,
              appearance: 'none',
              border: 'none',
              outline: 'none',
              background: 'transparent',
              fontFamily: 'var(--sans)',
              fontSize: 18,
              color: 'var(--ink)',
            }}
          />
          <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--ink-3)' }}>USDC</span>
        </div>
      </div>

      {/* pay-link QR */}
      <div style={{ display: 'grid', placeItems: 'center', marginBottom: 14 }}>
        <Qr value={link} size={176} />
      </div>

      {/* the pay-link itself, tap-to-copy */}
      <CopyRow
        value={link}
        display={link.replace(/^https?:\/\//, '')}
        ariaLabel="Copy your payment link"
        copiedLabel="Copied link"
      />

      {/* actions: Copy · Share · Email (Email is a REAL mailto) */}
      <div style={{ display: 'flex', gap: 9, marginTop: 12 }}>
        <ActionButton
          icon={<LinkIcon size={17} strokeWidth={ICON_STROKE} aria-hidden />}
          label="Copy"
          onClick={onCopy}
          done={copied}
        />
        <ActionButton
          icon={<Share2 size={17} strokeWidth={ICON_STROKE} aria-hidden />}
          label="Share"
          onClick={onShare}
          done={shared}
        />
        <ActionButton
          icon={<Mail size={17} strokeWidth={ICON_STROKE} aria-hidden />}
          label="Email"
          href={payLinkMailto(link, handle, trimmed || undefined)}
        />
      </div>

      {/* honest helper — the link only prefills a normal send; no fake backend */}
      <p
        style={{
          margin: '16px 0 0',
          display: 'flex',
          alignItems: 'flex-start',
          gap: 8,
          fontFamily: 'var(--sans)',
          fontSize: 12.5,
          lineHeight: 1.5,
          color: 'var(--ink-3)',
        }}
      >
        <QrCode size={14} strokeWidth={ICON_STROKE} aria-hidden style={{ flex: '0 0 auto', marginTop: 2 }} />
        {handle
          ? `This link just opens a payment to you — people can also simply send to ${handle}.`
          : 'This link just opens a payment to you.'}
      </p>
    </>
  );
}

export function AddFundsSheet({ handle, address, onClose }: AddFundsSheetProps) {
  const [tab, setTab] = useState<Tab>('add');

  return (
    <Sheet
      title="Add / Receive"
      sub={
        tab === 'add'
          ? 'Share this to get paid. Money lands in your wallet.'
          : 'Request a payment — share a link anyone can pay.'
      }
      onClose={onClose}
    >
      <TabSwitcher tab={tab} onTab={setTab} />
      {tab === 'add' ? (
        <AddTab handle={handle} address={address} />
      ) : (
        <ReceiveTab handle={handle} />
      )}
    </Sheet>
  );
}

export default AddFundsSheet;
