import { ConnectButton } from '@mysten/dapp-kit-react/ui'
import { useCurrentAccount } from '@mysten/dapp-kit-react'

// Door 02 CTA — the real dapp-kit v2 <mysten-dapp-kit-connect-button> (themed in
// styles.css to approximate .btn--primary) plus the ghost "Read the docs" link.
// When connected it renders the account menu; we also surface the address inline
// so the connected state is unmistakable.

const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`

export function WalletCta() {
  const account = useCurrentAccount()
  return (
    <>
      <div className="door__cta">
        <ConnectButton />
        <a className="btn btn--ghost" href="#">
          Read the docs
        </a>
      </div>
      {account && (
        <p className="door__addr mono">
          Connected · <b>{shortAddr(account.address)}</b>
        </p>
      )}
    </>
  )
}
