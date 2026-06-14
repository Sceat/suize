import { useCallback, useEffect, useState } from 'react'
import { fmt_id } from './format'

// ============================================================================
// Tiny shared UI primitives + hooks for the dashboard. No component library —
// just enough to keep the screens DRY (copy-to-clipboard, toasts, icons).
// ============================================================================

// ---- Icons (inline SVG, currentColor, 16px grid) ------------------------

type IconProps = { size?: number }

export const IconCopy = ({ size = 14 }: IconProps) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.4"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
    <path d="M10.5 5.5V4a1.5 1.5 0 0 0-1.5-1.5H4A1.5 1.5 0 0 0 2.5 4v5A1.5 1.5 0 0 0 4 10.5h1.5" />
  </svg>
)

export const IconCheck = ({ size = 14 }: IconProps) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M3 8.5 6.5 12 13 4.5" />
  </svg>
)

export const IconBack = ({ size = 14 }: IconProps) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M9.5 3.5 5 8l4.5 4.5" />
  </svg>
)

export const IconPlus = ({ size = 14 }: IconProps) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    aria-hidden="true"
  >
    <path d="M8 3.5v9M3.5 8h9" />
  </svg>
)

export const IconExternal = ({ size = 12 }: IconProps) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.4"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M6 3.5H4A1.5 1.5 0 0 0 2.5 5v7A1.5 1.5 0 0 0 4 13.5h7A1.5 1.5 0 0 0 12.5 12v-2M9 2.5h4.5V7M13 3 7 9" />
  </svg>
)

export const IconSun = ({ size = 16 }: IconProps) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.4"
    strokeLinecap="round"
    aria-hidden="true"
  >
    <circle cx="8" cy="8" r="3" />
    <path d="M8 1v1.5M8 13.5V15M1 8h1.5M13.5 8H15M3 3l1 1M12 12l1 1M13 3l-1 1M4 12l-1 1" />
  </svg>
)

export const IconMoon = ({ size = 16 }: IconProps) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.4"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M13 9.5A5.5 5.5 0 0 1 6.5 3a5.5 5.5 0 1 0 6.5 6.5Z" />
  </svg>
)

export const IconChevronDown = ({ size = 12 }: IconProps) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M4 6l4 4 4-4" />
  </svg>
)

export const IconPower = ({ size = 13 }: IconProps) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M8 2v6" />
    <path d="M4.6 4.6a4.5 4.5 0 1 0 6.8 0" />
  </svg>
)

// The permanence seal — a small star/asterisk burst, used inside the
// "Live · permanent on Walrus" mark on each site card.
export const IconSeal = ({ size = 10 }: IconProps) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M8 2.5v11M3.4 4.6l9.2 6.8M12.6 4.6l-9.2 6.8" />
  </svg>
)

// The upload glyph — a plate with an up-feed arrow, used on the deploy drop zone.
export const IconPress = ({ size = 22 }: IconProps) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M12 15V5M8.5 8.5 12 5l3.5 3.5" />
    <path d="M5 14v3.5A1.5 1.5 0 0 0 6.5 19h11a1.5 1.5 0 0 0 1.5-1.5V14" />
  </svg>
)

// A globe — linked custom domains.
export const IconGlobe = ({ size = 11 }: IconProps) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.3"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <circle cx="8" cy="8" r="5.5" />
    <path d="M2.5 8h11M8 2.5c1.6 1.6 2.4 3.6 2.4 5.5S9.6 11.9 8 13.5C6.4 11.9 5.6 9.9 5.6 8S6.4 4.1 8 2.5Z" />
  </svg>
)

// The official multi-colour Google "G" — used ONLY on the Enoki sign-in button
// so the affordance reads as a genuine Google login at a glance. Self-coloured
// (ignores currentColor) per Google's brand mark.
export const GoogleMark = ({ size = 14 }: IconProps) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 18 18"
    aria-hidden="true"
    focusable="false"
  >
    <path
      fill="#4285F4"
      d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z"
    />
    <path
      fill="#34A853"
      d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z"
    />
    <path
      fill="#FBBC05"
      d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33Z"
    />
    <path
      fill="#EA4335"
      d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.9 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z"
    />
  </svg>
)

// ---- Copy button --------------------------------------------------------

export const CopyButton = ({
  value,
  label = 'Copy',
}: {
  value: string
  label?: string
}) => {
  const [done, setDone] = useState(false)
  const onCopy = useCallback(() => {
    void navigator.clipboard?.writeText(value).then(
      () => {
        setDone(true)
        window.setTimeout(() => setDone(false), 1400)
      },
      () => {
        /* clipboard blocked (insecure context); silently no-op */
      },
    )
  }, [value])
  return (
    <button
      type="button"
      className={`dx-copy${done ? ' is-done' : ''}`}
      onClick={onCopy}
      aria-label={done ? 'Copied' : label}
      title={done ? 'Copied' : label}
    >
      {done ? <IconCheck /> : <IconCopy />}
    </button>
  )
}

// ---- Identity menu ------------------------------------------------------
// The masthead handle becomes an account menu (the wallet's pattern): TAP the
// handle to open a small dropdown — copy your address or sign out. Clicking the
// handle no longer signs you out (the old footgun); sign-out is one explicit row.

export const IdentityMenu = ({
  handle,
  address,
  onSignOut,
}: {
  // The `<name>@suize` handle, or null when the address has none (we fall back
  // to the truncated hex so the menu still labels the connected account).
  handle: string | null
  address: string
  onSignOut: () => void
}) => {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)

  // Escape closes the menu (the click-catcher handles taps elsewhere).
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <span className="dx-id">
      <button
        type="button"
        className="dx-id__btn"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen(v => !v)}
      >
        <span className="dx-acct">{handle ?? fmt_id(address)}</span>
        <IconChevronDown />
      </button>

      {open && (
        <>
          <span
            className="dx-id__catch"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <div className="dx-id__menu" role="menu">
            <button
              type="button"
              className="dx-id__row"
              role="menuitem"
              onClick={() => {
                void navigator.clipboard?.writeText(address).catch(() => {})
                setCopied(true)
                window.setTimeout(() => setCopied(false), 1400)
              }}
            >
              <span className="dx-id__addr">{fmt_id(address)}</span>
              {copied ? <IconCheck /> : <IconCopy />}
            </button>
            <div className="dx-id__rule" />
            <button
              type="button"
              className="dx-id__row dx-id__out"
              role="menuitem"
              onClick={onSignOut}
            >
              Sign out
              <IconPower />
            </button>
          </div>
        </>
      )}
    </span>
  )
}

// ---- Toasts -------------------------------------------------------------

export type Toast = { id: number; kind: 'ok' | 'err'; text: string }

let _toastId = 0

export const useToasts = () => {
  const [toasts, setToasts] = useState<Toast[]>([])
  const push = useCallback((kind: Toast['kind'], text: string) => {
    const id = ++_toastId
    setToasts(t => [...t, { id, kind, text }])
    window.setTimeout(() => {
      setToasts(t => t.filter(x => x.id !== id))
    }, 4200)
  }, [])
  return {
    toasts,
    ok: (text: string) => push('ok', text),
    err: (text: string) => push('err', text),
  }
}

export const Toasts = ({ toasts }: { toasts: Toast[] }) => {
  if (toasts.length === 0) return null
  return (
    <div className="dx-toasts" role="status" aria-live="polite">
      {toasts.map(t => (
        <div key={t.id} className={`dx-toast is-${t.kind}`}>
          <span className="dx-toast__dot" />
          <span>{t.text}</span>
        </div>
      ))}
    </div>
  )
}

// ---- Generic state blocks ----------------------------------------------

export const LoadingState = ({ label }: { label: string }) => (
  <div className="dx-state" role="status" aria-busy="true">
    <p className="dx-state__kicker">Working</p>
    <span className="spin" />
    <p className="dx-state__body">{label}</p>
  </div>
)

export const EmptyState = ({
  kicker = 'Notice',
  title,
  body,
  action,
}: {
  kicker?: string
  // Optional — omit to render just the kicker + body (e.g. when a page H1 above
  // already states the prompt and a card title would duplicate it).
  title?: string
  body: React.ReactNode
  action?: React.ReactNode
}) => (
  <div className="dx-state">
    <p className="dx-state__kicker">{kicker}</p>
    {title && <p className="dx-state__title">{title}</p>}
    <p className="dx-state__body">{body}</p>
    {action}
  </div>
)

// A friendly read of an API failure. A status of 0 = backend unreachable;
// 503 = the deploy module isn't configured (no service wallet) yet.
export const describe_error = (err: unknown): { title: string; body: React.ReactNode } => {
  const e = err as { status?: number; detail?: string; message?: string }
  if (e?.status === 0)
    return {
      title: 'Backend offline',
      body: (
        <>
          Couldn't reach the deploy backend at its configured{' '}
          <code>VITE_DEPLOY_API_URL</code>. Start the unified backend
          (services/backend) and refresh.
        </>
      ),
    }
  if (e?.status === 503)
    return {
      title: 'Deploy not configured',
      body: (
        <>
          The backend is up but the <code>deploy</code> module is waiting on its
          service wallet (<code>DEPLOY_WALLET_PRIVATE_KEY</code>). Once it's set
          + funded, sites appear here.
        </>
      ),
    }
  if (e?.status === 404)
    return { title: 'Not found', body: 'That site no longer exists.' }
  if (e?.status === 402)
    return {
      title: e?.detail || 'Payment required',
      body: 'Settle the deploy charge, then retry.',
    }
  if (e?.status === 409)
    return {
      title: e?.detail || 'Charge already used',
      body: 'That charge digest was already consumed — confirm again to pay a fresh one.',
    }
  return {
    title: 'Something went wrong',
    body: e?.detail || e?.message || 'Unexpected error talking to the backend.',
  }
}
