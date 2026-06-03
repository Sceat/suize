/**
 * AddFundsSheet — the "receive" sheet (SPEC §3 Group E · §4 ADD).
 *
 * Props: { handle, address, onClose }.
 *
 * Contents:
 *   - a decorative QR (recolors with theme)
 *   - the @name, tappable to copy ("Copied your name")
 *   - the raw hex address, tappable to copy
 *   - a "Coming soon" block: Apple Pay · Bank transfer · Card — MUTED, NON-INTERACTIVE,
 *     never faked (honesty brand: "coming soon" means coming soon).
 *
 * The "Secure" footer + chrome come from <Sheet/>.
 */
import { useCallback, useState } from 'react';
import { Sheet } from './Sheet';
import { Qr } from '../Qr';
import { Check, Copy, CreditCard, Landmark, Smartphone, ICON_STROKE } from '../../system';

export interface AddFundsSheetProps {
  /** "<name>@suize". */
  handle: string;
  /** the raw 0x… wallet address. */
  address: string;
  onClose: () => void;
}

function shortHex(addr: string): string {
  if (addr.length <= 16) return addr;
  return `${addr.slice(0, 10)}…${addr.slice(-6)}`;
}

/** A tap-to-copy row used for both the @name and the hex address. */
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

export function AddFundsSheet({ handle, address, onClose }: AddFundsSheetProps) {
  return (
    <Sheet
      title="Add funds"
      sub="Share this to get paid. Money lands in your wallet."
      onClose={onClose}
    >
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
    </Sheet>
  );
}

export default AddFundsSheet;
