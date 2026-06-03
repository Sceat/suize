/**
 * Shared UI primitives — Button · Field · Eyebrow · Pill · HealthDot ·
 * ModeSwitch · CopyButton. Built on the button/field tokens in tokens.css.
 *
 * Every leaf group (onboarding, home-simple, home-advanced, sheets) imports
 * these from the system barrel so the visual language stays identical and the
 * prop APIs are stable. NO green diode anywhere except the ONE allowed HealthDot.
 */
import {
  forwardRef,
  useCallback,
  useState,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type InputHTMLAttributes,
  type ReactNode,
} from 'react';
import { Check, Copy } from 'lucide-react';
import { ICON_STROKE } from './icons';

// ───────────────────────────────────────────────────────────────────────────
// Button
// ───────────────────────────────────────────────────────────────────────────

export type ButtonVariant = 'primary' | 'secondary' | 'ghost';
export type ButtonSize = 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** primary = cyan gradient face (inset + glow) · secondary = paper face · ghost = transparent. */
  variant?: ButtonVariant;
  /** md = 13px pad / 12.5px label · lg = 15px pad / 13px label. */
  size?: ButtonSize;
  /** disables + dims while a background action runs. */
  busy?: boolean;
  /** optional leading icon (lucide element). */
  icon?: ReactNode;
  children?: ReactNode;
}

const BASE_BTN: CSSProperties = {
  position: 'relative',
  fontFamily: 'var(--mono)',
  fontWeight: 500,
  letterSpacing: '0.02em',
  border: '1px solid var(--btn-line)',
  borderRadius: 'var(--corner)',
  background: 'var(--btn-face)',
  color: 'var(--btn-ink)',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 10,
  userSelect: 'none',
  cursor: 'pointer',
  boxShadow: 'inset 0 1px 0 rgba(255,255,255,.04)',
  transition:
    'transform .26s var(--e-expo), border-color .32s var(--e-quart), background .32s var(--e-quart), color .32s var(--e-quart), box-shadow .32s var(--e-quart)',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', busy = false, icon, children, disabled, style, type, ...rest },
  ref,
) {
  const isDisabled = disabled || busy;

  const sizeStyle: CSSProperties =
    size === 'lg'
      ? { padding: '15px 22px', fontSize: 13 }
      : { padding: '13px 22px', fontSize: 12.5 };

  const variantStyle: CSSProperties =
    variant === 'primary'
      ? {
          color: 'var(--btn-cy-ink)',
          borderColor: 'var(--btn-cy-line)',
          background: 'linear-gradient(180deg, var(--btn-cy-from) 0%, var(--btn-cy-to) 100%)',
          boxShadow:
            'inset 0 1px 0 0 rgba(255,255,255,.28), inset 0 -1px 0 0 rgba(0,0,0,.16), 0 8px 24px -12px var(--btn-cy-glow)',
        }
      : variant === 'ghost'
        ? { color: 'var(--ink-2)', background: 'transparent', borderColor: 'transparent' }
        : {};

  // Disabled floor: a visible-but-muted resting state (hairline + muted label on a
  // faint face), NOT an opacity collapse — so a `busy=false` blocked primary CTA
  // ("Pick a name") stays clearly legible in BOTH themes. The gradient/glow + the
  // near-black primary ink are dropped; the `busy` spinner case stays dimmed.
  const disabledStyle: CSSProperties = busy
    ? { opacity: 0.55, pointerEvents: 'none' }
    : {
        color: 'var(--ink-3)',
        background: 'var(--paper-3)',
        borderColor: 'var(--hair)',
        boxShadow: 'none',
        pointerEvents: 'none',
      };

  return (
    <button
      ref={ref}
      {...rest}
      type={type ?? 'button'}
      disabled={isDisabled}
      aria-busy={busy || undefined}
      style={{
        ...BASE_BTN,
        ...sizeStyle,
        ...variantStyle,
        ...(isDisabled ? disabledStyle : null),
        ...style,
      }}
    >
      {icon}
      {children}
    </button>
  );
});

// ───────────────────────────────────────────────────────────────────────────
// Field
// ───────────────────────────────────────────────────────────────────────────

export type FieldState = 'idle' | 'ok' | 'bad';

export interface FieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'prefix'> {
  /** content shown before the input (e.g. "@", "$"). Tinted cyan. */
  prefix?: ReactNode;
  /** content shown after the input (e.g. "@suize", "USDC", a status glyph). */
  suffix?: ReactNode;
  /** idle | ok (cyan/good ring) | bad (warn ring). Drives the border color only. */
  state?: FieldState;
}

const STATE_BORDER: Record<FieldState, string> = {
  idle: 'var(--hair)',
  ok: 'var(--good)',
  bad: 'var(--warn)',
};

/**
 * Field — soft `--corner` bordered row with optional prefix/suffix. No bubble,
 * no "weird highlight": the only emphasis is the border color (idle/ok/bad) and
 * a cyan border on focus-within. Used by the name step + every sheet input.
 */
export const Field = forwardRef<HTMLInputElement, FieldProps>(function Field(
  { prefix, suffix, state = 'idle', style, onFocus, onBlur, ...rest },
  ref,
) {
  const [focused, setFocused] = useState(false);
  const border = focused && state === 'idle' ? 'var(--cyan)' : STATE_BORDER[state];

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        border: `1px solid ${border}`,
        borderRadius: 'var(--corner)',
        padding: '14px 16px',
        background: 'var(--paper)',
        transition: 'border-color .4s var(--e-quart)',
      }}
    >
      {prefix != null ? (
        <span style={{ fontFamily: 'var(--mono)', fontSize: 15, color: 'var(--cyan)', flex: '0 0 auto' }}>
          {prefix}
        </span>
      ) : null}
      <input
        ref={ref}
        {...rest}
        onFocus={(e) => {
          setFocused(true);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          onBlur?.(e);
        }}
        style={{
          flex: '1 1 auto',
          minWidth: 0,
          background: 'transparent',
          border: 'none',
          outline: 'none',
          fontFamily: 'var(--mono)',
          fontSize: 15,
          color: 'var(--ink)',
          ...style,
        }}
      />
      {suffix != null ? (
        <span style={{ fontFamily: 'var(--mono)', fontSize: 14, color: 'var(--ink-3)', flex: '0 0 auto', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          {suffix}
        </span>
      ) : null}
    </div>
  );
});

// ───────────────────────────────────────────────────────────────────────────
// Eyebrow
// ───────────────────────────────────────────────────────────────────────────

/**
 * Eyebrow — mono 10.5px, .2em tracking, uppercase, muted. Section labels.
 *
 * Restores the mockup's signature ~26px leading cyan hairline rule (the design's
 * `.eyebrow::before`): a 1px cyan line sits flush before the label. The deck's
 * numeric index ("03") is INTENTIONALLY dropped — this is a real app, not the
 * 10-section deck — so it's just the hairline + the label.
 */
export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={className}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        fontFamily: 'var(--mono)',
        fontSize: 10.5,
        letterSpacing: '0.2em',
        textTransform: 'uppercase',
        color: 'var(--ink-3)',
      }}
    >
      <span
        aria-hidden
        style={{
          width: 26,
          height: 1,
          background: 'var(--cyan)',
          flex: '0 0 auto',
          display: 'inline-block',
        }}
      />
      {children}
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Pill
// ───────────────────────────────────────────────────────────────────────────

/**
 * Pill — a small mono chip (handle / strategy label). NOT a status dot: it never
 * renders a live/pulsing dot. tone 'cyan' (default) or 'good'.
 */
export function Pill({
  children,
  tone = 'cyan',
  className,
}: {
  children: ReactNode;
  tone?: 'cyan' | 'good';
  className?: string;
}) {
  const color = tone === 'good' ? 'var(--good)' : 'var(--cyan)';
  const wash = tone === 'good' ? 'var(--good-wash)' : 'var(--cyan-wash)';
  return (
    <span
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 7,
        padding: '4px 10px',
        borderRadius: 999,
        fontFamily: 'var(--mono)',
        fontSize: 10,
        letterSpacing: '0.1em',
        textTransform: 'uppercase',
        color,
        background: wash,
        border: `1px solid color-mix(in srgb, ${color} 30%, transparent)`,
      }}
    >
      {children}
    </span>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// HealthDot — THE ONE allowed green dot
// ───────────────────────────────────────────────────────────────────────────

/**
 * HealthDot — the single allowed green status indicator in the entire app:
 * a small --good dot (soft halo pulse) + "Everything's healthy". Every other
 * live/diode dot is banned.
 */
export function HealthDot({ label = "Everything's healthy" }: { label?: string }) {
  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 10,
        fontFamily: 'var(--mono)',
        fontSize: 12,
        letterSpacing: '0.02em',
        color: 'var(--good)',
      }}
    >
      <span
        className="suize-health-dot"
        aria-hidden
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: 'var(--good)',
          boxShadow: '0 0 9px var(--good)',
          animation: 'suize-dp 3.2s var(--e-quart) infinite',
          flex: '0 0 auto',
        }}
      />
      {label}
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// ModeSwitch — Simple | Advanced 2-segment toggle
// ───────────────────────────────────────────────────────────────────────────

export type Mode = 'simple' | 'advanced';

/**
 * ModeSwitch — the 2-segment pill [ Simple | Advanced ]. `aria-pressed` per
 * segment; the active segment gets the cyan-wash fill + cyan ink. Switching is
 * instant (the crossfade lives in WalletShell's Stage).
 */
export function ModeSwitch({
  mode,
  onChange,
  className,
}: {
  mode: Mode;
  onChange: (m: Mode) => void;
  className?: string;
}) {
  const seg = (value: Mode, label: string) => {
    const active = mode === value;
    return (
      <button
        type="button"
        aria-pressed={active}
        onClick={() => onChange(value)}
        style={{
          fontFamily: 'var(--mono)',
          fontSize: 11.5,
          letterSpacing: '0.04em',
          padding: '7px 14px',
          borderRadius: 999,
          border: 'none',
          cursor: 'pointer',
          color: active ? 'var(--cyan)' : 'var(--ink-3)',
          background: active ? 'var(--cyan-wash)' : 'transparent',
          transition: 'color .4s var(--e-quart), background .4s var(--e-quart)',
        }}
      >
        {label}
      </button>
    );
  };

  return (
    <div
      className={className}
      role="group"
      aria-label="View mode"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 2,
        padding: 3,
        borderRadius: 999,
        border: '1px solid var(--hair)',
        background: 'color-mix(in srgb, var(--paper-2) 60%, transparent)',
      }}
    >
      {seg('simple', 'Simple')}
      {seg('advanced', 'Advanced')}
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// CopyButton
// ───────────────────────────────────────────────────────────────────────────

/**
 * CopyButton — copies `value` to the clipboard; swaps to "Copied" + Check for
 * ~1.6s. `label` is the resting caption (e.g. "Copy address"). Mono, ghost-ish.
 */
export function CopyButton({
  value,
  label = 'Copy',
  copiedLabel = 'Copied',
  className,
}: {
  value: string;
  label?: string;
  copiedLabel?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  const onCopy = useCallback(() => {
    void navigator.clipboard?.writeText(value).then(
      () => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1600);
      },
      () => {
        /* clipboard blocked; no-op */
      },
    );
  }, [value]);

  return (
    <button
      type="button"
      onClick={onCopy}
      aria-label={copied ? copiedLabel : label}
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 7,
        padding: '6px 11px',
        borderRadius: 999,
        border: '1px solid var(--hair)',
        background: 'transparent',
        cursor: 'pointer',
        fontFamily: 'var(--mono)',
        fontSize: 11,
        letterSpacing: '0.04em',
        color: copied ? 'var(--good)' : 'var(--ink-2)',
        transition: 'color .4s var(--e-quart), border-color .4s var(--e-quart)',
      }}
    >
      {copied ? (
        <Check size={13} strokeWidth={ICON_STROKE} aria-hidden />
      ) : (
        <Copy size={13} strokeWidth={ICON_STROKE} aria-hidden />
      )}
      {copied ? copiedLabel : label}
    </button>
  );
}
