import { CopyButton } from './CopyButton'
import { WalletCta } from './WalletButton'

// The lead editorial + the two doors (agents / humans).
const MCP_CMD = 'claude mcp add suize -- npx -y @suize/mcp'

export function Lead() {
  return (
    <section className="wrap lead">
      <div className="lead__grid">
        <div>
          <span className="kicker">The lead dispatch</span>
          <h2>
            Ship a site the moment your agent <em>decides</em> to.
          </h2>
          <p className="lead__lede">
            Point an agent at a folder. It pays fifty cents in USDC over an HTTP 402 challenge, and
            the site is live on Walrus seconds later — every byte content-hashed, every payment a
            digest you can open on-chain. No dashboard, no account, no one holding your keys.
          </p>
        </div>

        <div className="doors">
          <div className="door">
            <div className="door__hd">
              <span className="door__title">For agents</span>
              <span className="door__no">door 01</span>
            </div>
            <div className="cmd">
              <span className="cmd__ps">$</span>
              <span className="cmd__txt">{MCP_CMD}</span>
              <CopyButton text={MCP_CMD} />
            </div>
            <p className="door__note">
              Then just say <b>“publish this folder.”</b> It answers the 402, settles, and hands
              back a live URL.
            </p>
          </div>

          <div className="door">
            <div className="door__hd">
              <span className="door__title">For humans</span>
              <span className="door__no">door 02</span>
            </div>
            <div className="steps">
              <b>Connect wallet</b>
              <span>→</span>
              <b>Drop a folder</b>
              <span>→</span>
              <b className="price">Pay $0.50</b>
              <span>→</span>
              <b>Live</b>
            </div>
            <WalletCta />
          </div>
        </div>
      </div>
    </section>
  )
}
