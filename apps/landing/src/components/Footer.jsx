import { LINKS, PRODUCTS } from '../config'
import { navigate } from '../ui'

// FOOTER — the agent door + an oversized wordmark bleeding off the bottom.
export default function Footer() {
  return (
    <footer className="sx-foot">
      <div className="sx-wrap">
        <div className="sx-foot__grid">
          <div className="sx-foot__brand">
            <a className="sx-logo" href="/" aria-label="Suize home">
              <span className="sx-logo__mark">SUIZE</span>
            </a>
            <p className="sx-foot__tag">
              Money for the agentic web. Fund an agent and it pays anywhere;
              charge any agent and settle instantly — on Sui.
            </p>
          </div>

          <div className="sx-foot__cols">
            <div className="sx-foot__col">
              <span className="sx-foot__colhead">Products</span>
              {PRODUCTS.map(p => (
                <a
                  className="sx-foot__link"
                  key={p.id}
                  href={p.route}
                  onClick={e => {
                    e.preventDefault()
                    navigate(p.route)
                  }}
                >
                  {p.name}
                </a>
              ))}
            </div>
            <div className="sx-foot__col">
              <span className="sx-foot__colhead">Learn</span>
              {/* the in-app docs page — docs + quickstart merged (the old
                  docs.suize.io site is DEAD; never link it). */}
              <a
                className="sx-foot__link"
                href={LINKS.docs}
                onClick={e => {
                  e.preventDefault()
                  navigate('/docs')
                }}
              >
                Docs
              </a>
              <a
                className="sx-foot__link"
                href="/pricing"
                onClick={e => {
                  e.preventDefault()
                  navigate('/pricing')
                }}
              >
                Pricing
              </a>
            </div>
            <div className="sx-foot__col">
              <span className="sx-foot__colhead">For agents</span>
              <a className="sx-foot__agent" href={LINKS.llms}>
                suize.io/llms.txt ↗
              </a>
            </div>
          </div>
        </div>

        <p className="sx-foot__legal">
          Fully non-custodial — your keys never leave your machine. The funded
          balance is delegated-spend, bounded by the deposit, the receipt, and a
          one-tap kill. Built on Sui.
        </p>
      </div>

      <div className="sx-foot__wordmark" aria-hidden="true">
        SUIZE
      </div>
    </footer>
  )
}
