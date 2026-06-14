import { DEPLOY_API_URL } from '../config'
import { CopyButton, IconBack, IconExternal } from '../ui'

// ============================================================================
// DEPLOY FROM YOUR AGENT — a SHORT signpost, not a manual. The full, machine-
// readable contract (the 402 flow, build / sign / X-PAYMENT, extend, subscribe,
// custom domains) lives in the llms.txt — agents read THAT, not this page. Here
// a human gets a one-glance description + the contract card + the two doc links.
// No code on this page: the doc is the single source of truth (keep info where it
// belongs; no over-engineering).
// ============================================================================

// Show the production host when running against the local default; else echo the
// configured backend verbatim.
const API = DEPLOY_API_URL.startsWith('http://localhost')
  ? 'https://api.suize.io'
  : DEPLOY_API_URL

const DEPLOY_LLMS = 'https://deploy.suize.io/llms.txt'
const RAIL_LLMS = 'https://suize.io/llms.txt'

// The "Suize" brand mention is always a clickable link to the home.
const Suize = () => (
  <a className="dx-ilink" href="https://suize.io" target="_blank" rel="noreferrer">
    Suize
  </a>
)

export const AgentsView = ({ onBack }: { onBack: () => void }) => (
  <>
    <button type="button" className="dx-back" onClick={onBack}>
      <IconBack /> All sites
    </button>

    <div className="dx-pagehead">
      <div>
        <p className="ed-eyebrow">Built for agents</p>
        <h1 className="dx-pagehead__title">Deploy from your agent</h1>
      </div>
    </div>

    <p className="dx-lede" style={{ marginTop: '-8px', marginBottom: 28 }}>
      Deploy is a merchant on the <Suize /> rail. Your agent ships a built static site
      over plain HTTP and pays for it gaslessly in USDC — no browser, no gas, no
      account; the address is the account. Everything an agent needs is in the
      machine-readable contract — point your agent at it and it self-serves.
    </p>

    {/* The contract card — the one-glance summary. The actual flow lives in the doc. */}
    <div className="dx-panel">
      <h2 className="dx-panel__title">The contract</h2>
      <div className="dx-rows" style={{ marginTop: 14 }}>
        <div className="dx-row">
          <span className="dx-row__k">Endpoint</span>
          <span className="dx-row__v">
            <code>POST {API}/deploy</code>{' '}
            <CopyButton value={`${API}/deploy`} label="Copy endpoint" />
          </span>
        </div>
        <div className="dx-row">
          <span className="dx-row__k">Price</span>
          <span className="dx-row__v">
            <code>$0.50 USDC — gasless, over x402</code>
          </span>
        </div>
        <div className="dx-row">
          <span className="dx-row__k">Returns</span>
          <span className="dx-row__v">
            <code>a live https://&lt;id&gt;.suize.site URL</code>
          </span>
        </div>
      </div>
      <div className="dx-tags">
        <span className="dx-tag is-bull">Gasless</span>
        <span className="dx-tag is-bull">No account · no API key</span>
      </div>
      <p className="dx-hint">
        A bare request answers <code>402</code> with the x402 challenge; your agent
        settles it from its own key and retries. The full flow — plus extend,
        subscribe, and custom domains — is spelled out in the contract below.
      </p>
    </div>

    {/* The two doc pointers — the actual "how". */}
    <div className="dx-panel">
      <h2 className="dx-panel__title">Point your agent at the docs</h2>
      <div className="dx-rows" style={{ marginTop: 14 }}>
        <div className="dx-row">
          <span className="dx-row__k">Deploy contract</span>
          <span className="dx-row__v">
            <a className="dx-bal__link" href={DEPLOY_LLMS} target="_blank" rel="noreferrer">
              <IconExternal /> deploy.suize.io/llms.txt
            </a>{' '}
            <CopyButton value={DEPLOY_LLMS} label="Copy link" />
          </span>
        </div>
        <div className="dx-row">
          <span className="dx-row__k">The <Suize /> rail</span>
          <span className="dx-row__v">
            <a className="dx-bal__link" href={RAIL_LLMS} target="_blank" rel="noreferrer">
              <IconExternal /> suize.io/llms.txt
            </a>{' '}
            <CopyButton value={RAIL_LLMS} label="Copy link" />
          </span>
        </div>
      </div>
      <p className="dx-hint">
        The deploy contract is all an agent needs to ship a site. To understand the
        rail itself — x402, how to pay any <Suize /> merchant, the fee — read the{' '}
        <Suize /> rail llms.txt.
      </p>
    </div>
  </>
)
