/**
 * IdentityMenu — the masthead handle becomes the account menu: tap it to copy
 * your address or SIGN OUT (the affordance the old screens lost in the cutover).
 * A small glass dropdown; a transparent click-catcher closes it.
 */
import { useEffect, useState } from 'react';
import { Check, ChevronDown, Copy, Power, ICON_STROKE } from '../system';

function shortAddr(a: string): string {
  if (!a || a.length < 12) return a;
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

export function IdentityMenu({
  handle,
  address,
  onSignOut,
}: {
  handle: string;
  address: string;
  onSignOut: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  // Escape closes the menu (the click-catcher handles taps)
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <span className="rd-id">
      <button type="button" className="rd-id__btn" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span className="rd-mast__handle rd-handle">{handle}</span>
        <ChevronDown size={12} strokeWidth={ICON_STROKE} aria-hidden />
      </button>

      {open ? (
        <>
          <span className="rd-id__catch" onClick={() => setOpen(false)} aria-hidden="true" />
          <div className="rd-id__menu rd-glass" role="menu">
            <button
              type="button"
              className="rd-id__row"
              role="menuitem"
              onClick={() => {
                void navigator.clipboard?.writeText(address).catch(() => {});
                setCopied(true);
                setTimeout(() => setCopied(false), 1400);
              }}
            >
              <span className="rd-money" style={{ fontSize: 11.5 }}>
                {shortAddr(address)}
              </span>
              {copied ? (
                <span className="rd-sheet__copied">
                  <Check size={12} strokeWidth={2.2} aria-hidden />
                  Copied
                </span>
              ) : (
                <Copy size={13} strokeWidth={ICON_STROKE} aria-hidden />
              )}
            </button>
            <div className="rd-rule" />
            <button type="button" className="rd-id__row rd-id__out" role="menuitem" onClick={onSignOut}>
              Sign out
              <Power size={13} strokeWidth={ICON_STROKE} aria-hidden />
            </button>
          </div>
        </>
      ) : null}
    </span>
  );
}
