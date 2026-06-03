/**
 * Sheet — the shared bottom-sheet modal chrome for Add / Send / Convert.
 *
 * Behavior (SPEC §3 Group E · DESIGN §8):
 *   - scrim (blurred backdrop) + a panel that slides up from the bottom
 *   - radius --sheet-corner on the TOP corners only; a centered grip; an X close (top-right)
 *   - closes on ESC, on scrim click, and on the X; role="dialog" aria-modal
 *   - a quiet "Secure" footer (ShieldCheck) on every sheet
 *
 * The sheet is portaled to <body> by WalletShell's SheetHost, so it owns its OWN
 * fixed positioning + scrim (it must escape the shell's overflow:hidden clip).
 * Theme-reactive purely via CSS vars (--scrim, --paper-2, --hair, …).
 */
import {
  useEffect,
  useId,
  useRef,
  type ReactNode,
} from 'react';
import { ShieldCheck, X } from '../../system';
import { ICON_STROKE } from '../../system';

export interface SheetProps {
  /** serif title, e.g. "Add funds". */
  title: string;
  /** optional sub-line under the title. */
  sub?: string;
  /** close handler — wired to ESC, scrim-click and the X. */
  onClose: () => void;
  /** sheet body. */
  children: ReactNode;
}

export function Sheet({ title, sub, onClose, children }: SheetProps) {
  const titleId = useId();
  const subId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  // ESC to close + lock the body scroll while open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  return (
    <div
      // The scrim. Clicking it (but not the panel) closes the sheet.
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
        background: 'var(--scrim)',
        backdropFilter: 'blur(6px)',
        WebkitBackdropFilter: 'blur(6px)',
        animation: 'suize-scrim-in 0.3s var(--e-quart) both',
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={sub ? subId : undefined}
        style={{
          position: 'relative',
          width: 'min(480px, 100%)',
          maxHeight: '88svh',
          overflowY: 'auto',
          background: 'var(--paper-2)',
          borderTop: '1px solid var(--hair)',
          borderTopLeftRadius: 'var(--sheet-corner)',
          borderTopRightRadius: 'var(--sheet-corner)',
          boxShadow: '0 -30px 80px -40px rgba(11,27,43,.6)',
          padding: '10px clamp(20px, 6vw, 30px) clamp(20px, 5vw, 28px)',
          animation: 'suize-sheet-in 0.42s var(--e-expo) both',
        }}
        className="no-scrollbar"
      >
        {/* grip */}
        <div
          aria-hidden
          style={{
            width: 40,
            height: 4,
            borderRadius: 4,
            background: 'var(--hair)',
            margin: '4px auto 14px',
          }}
        />

        {/* X close */}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          style={{
            position: 'absolute',
            top: 14,
            right: 'clamp(16px, 5vw, 24px)',
            width: 34,
            height: 34,
            display: 'grid',
            placeItems: 'center',
            borderRadius: 999,
            border: '1px solid var(--hair)',
            background: 'transparent',
            color: 'var(--ink-3)',
            cursor: 'pointer',
            transition: 'color .3s var(--e-quart), border-color .3s var(--e-quart)',
          }}
        >
          <X size={16} strokeWidth={ICON_STROKE} aria-hidden />
        </button>

        {/* header */}
        <h2
          id={titleId}
          style={{
            margin: '4px 0 0',
            fontFamily: 'var(--serif)',
            fontWeight: 400,
            fontSize: 'clamp(1.7rem, 6vw, 2.1rem)',
            lineHeight: 1.05,
            letterSpacing: '-0.02em',
            color: 'var(--ink)',
            paddingRight: 40,
          }}
        >
          {title}
        </h2>
        {sub ? (
          <p
            id={subId}
            style={{
              margin: '8px 0 0',
              fontFamily: 'var(--serif)',
              fontWeight: 300,
              fontSize: 15,
              lineHeight: 1.45,
              color: 'var(--ink-2)',
              maxWidth: '46ch',
            }}
          >
            {sub}
          </p>
        ) : null}

        {/* body */}
        <div style={{ marginTop: 22 }}>{children}</div>

        {/* secure footer */}
        <div
          style={{
            marginTop: 24,
            paddingTop: 16,
            borderTop: '1px solid var(--hair-2)',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontFamily: 'var(--mono)',
            fontSize: 11,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: 'var(--ink-3)',
          }}
        >
          <ShieldCheck size={14} strokeWidth={ICON_STROKE} aria-hidden style={{ color: 'var(--good)' }} />
          Secure
        </div>
      </div>

      <style>{`
        @keyframes suize-scrim-in { from { opacity: 0 } to { opacity: 1 } }
        @keyframes suize-sheet-in { from { transform: translateY(100%) } to { transform: translateY(0) } }
        @media (prefers-reduced-motion: reduce) {
          [role="dialog"] { animation: none !important }
        }
      `}</style>
    </div>
  );
}

export default Sheet;
