// The minimal viewer chrome: a small Suize masthead bar + a status line, used by
// the viewer-list manager (#/access). The sealed-site viewer itself renders its
// own navbar-less vault door (see ViewerPage). Kept deliberately plain.

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
