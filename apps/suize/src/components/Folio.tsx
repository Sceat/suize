// The folio strip — the sticky top nav shared by the front page and the
// dashboard: wordmark (home) on the left, and on the right the "My sites" link +
// the wallet connect/account button (standard top-right login). When connected,
// dapp-kit's button becomes the account menu.

import { ConnectButton } from '@mysten/dapp-kit-react/ui'
import { useCurrentAccount } from '@mysten/dapp-kit-react'
import { navigate } from '../viewer/router'

export function Folio() {
  const account = useCurrentAccount()
  return (
    <div className="folio">
      <div className="wrap folio__in">
        <a className="folio__mark" href="#" onClick={() => navigate('')}>
          Suize
        </a>
        <nav className="folio__nav">
          <a
            className="folio__link"
            href="#/sites"
            onClick={(e) => {
              e.preventDefault()
              navigate('/sites')
            }}
          >
            {account ? 'My sites' : 'Sites'}
          </a>
          <a className="folio__link" href="https://github.com/Sceat/suize" target="_blank" rel="noopener noreferrer">
            Open source ↗
          </a>
          <ConnectButton />
        </nav>
      </div>
    </div>
  )
}
