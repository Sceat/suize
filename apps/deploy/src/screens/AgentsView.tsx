import './agents.css'
import {
  DEPLOY_CHARGE_AMOUNT,
  DEPLOY_PREMIUM_CHARGE_AMOUNT,
  DEPLOY_STORAGE_EPOCHS,
} from '@suize/shared'
import { DEPLOY_API_URL } from '../config'
import { fmt_usdc } from '../format'
import { CopyButton, IconBack, IconExternal } from '../ui'
import { IconBolt, IconShield, IconBox } from '../primitives'

// ============================================================================
// DEPLOY FROM YOUR AGENT — a SHORT signpost, not a manual. The full, machine-
// readable contract (the 402 flow, build / sign / X-PAYMENT, extend, subscribe,
// custom domains) lives in the llms.txt — agents read THAT, not this page. Here
// a human gets a one-glance description + a "THREE MOVES" press run that typesets
// how an agent deploys + the contract card + the two doc links. No runnable code
// on this page: the doc is the single source of truth (keep info where it belongs;
// no over-engineering). The three moves are EDITORIAL, not a diagram — mono press
// numerals, serif heads, hairline register frames, dotted ledger leaders.
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

// One numbered MOVE — a register card in the THREE MOVES press run. A big mono
// press numeral + a dotted leader + the rail glyph head the card; a serif verb
// sits over the sans note. Pure presentation; carries no copy claims of its own.
const Move = ({
  no,
  glyph,
  title,
  children,
}: {
  no: string
  glyph: React.ReactNode
  title: string
  children: React.ReactNode
}) => (
  <article className="ax-move ed-stream">
    <div className="ax-move__head">
      <span className="ax-move__no tnum">{no}</span>
      <span className="ax-move__lead" aria-hidden="true" />
      <span className="ax-move__glyph">{glyph}</span>
    </div>
    <h3 className="ax-move__title">{title}</h3>
    <p className="ax-move__body">{children}</p>
  </article>
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

    {/* THREE MOVES — the deploy handshake, typeset as an editorial press run.
        Honest to the live wire: 402 challenge → gasless self-signed USDC pay →
        upload, get an integrity-verified live URL. Claim-ladder clean. */}
    <section className="ax-moves" aria-label="How an agent deploys">
      <div className="ed-sep">
        <span className="ed-sep__label">Three moves</span>
        <span className="ed-sep__line" />
      </div>

      <div className="ax-moves__grid">
        <Move no="01" glyph={<IconBolt size={15} />} title="A bare request answers 402">
          Your agent <code>POST</code>s with no payment; Deploy replies{' '}
          <code>402</code> carrying the x402 challenge — the price and the
          terms, machine-readable.
        </Move>

        <Move no="02" glyph={<IconShield size={15} />} title="Sign a gasless payment">
          The agent signs a gasless USDC payment with its own key and retries.
          No browser, no gas, no account — the address is the account.
        </Move>

        <Move no="03" glyph={<IconBox size={15} />} title="Upload, get a live URL">
          Send the built site as a <code>tar</code>; it returns a live{' '}
          <code>https://&lt;id&gt;.suize.site</code> URL — permanent on Walrus,
          integrity-verified on every byte.
        </Move>
      </div>

      <div className="ax-coda">
        <span className="ax-coda__mark">One handshake.</span>
        <p className="ax-coda__note">
          Whoever pays owns the site. The full machine-readable flow — plus
          extend, subscribe, and custom domains — is in the contract below.
        </p>
      </div>
    </section>

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
            <code>
              {fmt_usdc(DEPLOY_CHARGE_AMOUNT)} USDC ·{' '}
              {fmt_usdc(DEPLOY_PREMIUM_CHARGE_AMOUNT)} for subscribers — gasless,
              over x402
            </code>
          </span>
        </div>
        <div className="dx-row">
          <span className="dx-row__k">Storage</span>
          <span className="dx-row__v">
            <code>
              ~{DEPLOY_STORAGE_EPOCHS} Walrus epochs / deploy — extend or subscribe
              to keep it permanent
            </code>
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
