/**
 * HexAddress — the raw 0x… wallet address with a copy affordance + an explorer
 * link. ADVANCED-only (SIMPLE never shows hex). The address is the user's zkLogin
 * wallet address (HomeState.address).
 *
 * Layout: a soft `--corner` bordered row — [label / mono hex (truncated)] · [Copy]
 * · [explorer link]. The hex is shown short-form (0x7c41…788f) but the FULL value
 * is copied + linked, so nothing is lost.
 *
 * NO emojis · soft 4px corners · the single gradient signature is reserved for the
 * hero surfaces, not this utility row.
 */
import { NETWORK } from '../lib/env';
import { shortHash } from '../data/format';
import {
  CopyButton,
  Eyebrow,
  ExternalLink,
  ICON_STROKE,
} from '../system';

export interface HexAddressProps {
  /** the raw 0x… address (full value — copied + linked in full). */
  address: string;
  /** the row label, e.g. "Wallet address". */
  label?: string;
}

/** Explorer account URL — mirrors lib/env's EXPLORER_TX, same suiscan host + NETWORK. */
const explorerAddress = (address: string) =>
  `https://suiscan.xyz/${NETWORK}/account/${address}`;

export function HexAddress({ address, label = 'Wallet address' }: HexAddressProps) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <Eyebrow>{label}</Eyebrow>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '12px 14px',
          border: '1px solid var(--hair)',
          borderRadius: 'var(--corner)',
          background: 'var(--paper-2)',
        }}
      >
        <span
          className="tnum"
          title={address}
          style={{
            flex: '1 1 auto',
            minWidth: 0,
            fontFamily: 'var(--mono)',
            fontSize: 13,
            color: 'var(--ink-2)',
            letterSpacing: '-0.01em',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {shortHash(address)}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: '0 0 auto' }}>
          <CopyButton value={address} label="Copy" copiedLabel="Copied" />
          <a
            href={explorerAddress(address)}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="View on explorer"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 30,
              height: 30,
              borderRadius: 999,
              border: '1px solid var(--hair)',
              color: 'var(--ink-2)',
              textDecoration: 'none',
              transition: 'color .4s var(--e-quart), border-color .4s var(--e-quart)',
            }}
          >
            <ExternalLink size={14} strokeWidth={ICON_STROKE} aria-hidden />
          </a>
        </div>
      </div>
    </div>
  );
}

export default HexAddress;
