// The minimal viewer chrome: a small Suize masthead bar + a status line. The
// decrypted site fills the viewport beneath it. Kept deliberately plain so the
// hosted content, not the frame, is what the visitor reads.

import type { ReactNode } from 'react'
import { ConnectButton } from '@mysten/dapp-kit-react/ui'

export function ViewerBar({
  status,
  tone,
  right,
}: {
  status?: ReactNode
  tone?: 'muted' | 'work' | 'ok' | 'deny'
  right?: ReactNode
}) {
  return (
    <header className="vbar">
      <a className="vbar__mark" href="#/" aria-label="Suize home">
        Suize
      </a>
      <div className={`vbar__status mono vbar__status--${tone ?? 'muted'}`}>{status}</div>
      <div className="vbar__right">{right ?? <ConnectButton />}</div>
    </header>
  )
}

/** A centered editorial panel for the pre-unlock / denied / error states. */
export function ViewerPanel({
  kicker,
  title,
  children,
  actions,
}: {
  kicker: string
  title: string
  children?: ReactNode
  actions?: ReactNode
}) {
  return (
    <div className="vpanel">
      <div className="vpanel__card">
        <span className="kicker">{kicker}</span>
        <h1 className="vpanel__title">{title}</h1>
        {children && <div className="vpanel__body">{children}</div>}
        {actions && <div className="vpanel__actions">{actions}</div>}
      </div>
    </div>
  )
}
