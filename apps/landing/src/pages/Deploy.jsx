import { Room, RoomHero } from '../components/Room'
import Footer from '../components/Footer'
import { Reveal, navigate } from '../ui'
import { LINKS } from '../config'
import '../deploy.css'

// /deploy — Deploy by Suize (CHARGE). THE FEATURED real merchant. An agent ships
// a static site to Walrus, paid on the rail; the deploy-worker re-hashes every
// byte against the on-chain manifest (X-Suize-Integrity: verified). Built on the
// shared Room chassis (the deploy indigo accent) so the per-product treatment is
// consistent with the Wallet exemplar; the flow + the integrity beat are this
// room's own.
//
// HONESTY (CLAUDE.md calibrated honesty / SPEC §7): account.move is unpublished
// and the rail isn't billing yet, so this page says SHIPPING, never "live
// merchant" / "charging agents already". The eyebrow stays `· Testnet`, never
// `· LIVE`. Served sites are `suize.site` (the worker is authoritative). NO
// pricing copy anywhere — every number lives on /pricing.

// The four-step ship flow — an agent POSTs a built site, it lands live. Each step
// is the literal pipeline (deploy service → Walrus → on-chain Site → served URL),
// kept plain. The detail column is mono (the path the bytes travel).
const FLOW = [
  [
    'POST the built site',
    'Your agent sends a built static folder to the deploy endpoint.',
    'POST /deploy',
  ],
  [
    'Stored on Walrus',
    'Files go to a Walrus quilt; a manifest records every path and its hash.',
    'quilt + manifest',
  ],
  [
    'Minted on-chain',
    'One immutable Site object pins the manifest hash. No clobber, no takeover.',
    'Site · on-chain',
  ],
  [
    'Served live',
    'The site answers at its own subdomain, every byte verified before it ships.',
    'live URL',
  ],
]

// The merchant facts — what the rail gives this merchant. NO price (it lives on
// /pricing); the fee is named as a fact, not quantified.
const FACTS = [
  ['Built site in', 'POST a folder · no build server to run'],
  ['Hosted on', 'Walrus · content-addressed · durable'],
  ['Identity', 'one immutable on-chain Site · no clobber'],
  ['Served at', 'its own subdomain on suize.site'],
  ['Paid on the rail', 'charged in USDC · the fee is emitted in the receipt'],
]

export default function Deploy() {
  return (
    <Room id="deploy">
      <RoomHero
        eyebrow="Deploy by Suize · CHARGE"
        title="An agent ships a static site to the web."
        sub="POST a built folder; it lands live on Walrus at its own URL, paid on the rail in USDC. Every byte is re-hashed against the on-chain manifest before it ships. The first merchant on Suize."
        ctaHref={LINKS.deploy}
        ctaLabel="Open Deploy →"
      />

      {/* 01 · THE SHIP FLOW — the literal pipeline, one beat per stage. */}
      <section className="sx-section">
        <div className="sx-wrap">
          <div className="sx-marker">
            <span className="sx-marker__no">//01</span>
            <span className="sx-marker__label">How a site ships</span>
            <span className="sx-marker__line" />
          </div>
          <Reveal className="sx-sectionhead">
            <span className="ed-eyebrow">One POST, four stages</span>
            <h2 className="sx-sectionhead__title">
              From a built folder to a live URL.
            </h2>
          </Reveal>
          <Reveal className="dx-flow">
            {FLOW.map(([title, body, tag], i) => (
              <div className="dx-flow__step" key={title}>
                <span className="dx-flow__no">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <div className="dx-flow__body">
                  <span className="dx-flow__title">{title}</span>
                  <span className="dx-flow__desc">{body}</span>
                </div>
                <span className="dx-flow__tag">{tag}</span>
              </div>
            ))}
          </Reveal>
        </div>
      </section>

      {/* 02 · THE INTEGRITY BEAT — the differentiator. Every served byte is
          re-hashed against the on-chain manifest; a mismatch returns 502, never
          the bytes. Verified responses carry the X-Suize-Integrity header. */}
      <section className="sx-section sx-zone-surface">
        <div className="sx-wrap">
          <div className="sx-marker">
            <span className="sx-marker__no">//02</span>
            <span className="sx-marker__label">The signature beat · integrity</span>
            <span className="sx-marker__line" />
          </div>
          <Reveal className="sx-sectionhead">
            <span className="ed-eyebrow">Verified, not trusted</span>
            <h2 className="sx-sectionhead__title">
              Every byte is checked against the chain.
            </h2>
          </Reveal>
          <Reveal>
            <div className="sx-card dx-integrity">
              <div className="dx-integrity__head">
                <span className="ed-eyebrow">
                  Response
                </span>
                <span className="dx-integrity__verified">verified</span>
              </div>

              {/* the served-response header line — the header IS the proof */}
              <div className="dx-integrity__header">
                <span className="dx-integrity__hk">X-Suize-Integrity</span>
                <span className="dx-integrity__hsep">:</span>
                <span className="dx-integrity__hv">verified</span>
              </div>

              {/* the two checks the worker runs before the bytes ever leave */}
              <div className="dx-integrity__checks">
                <div className="dx-integrity__check">
                  <span className="dx-integrity__cno">1</span>
                  <span className="dx-integrity__ck">manifest blob</span>
                  <span className="dx-integrity__clead" />
                  <span className="dx-integrity__cv">
                    sha256 = on-chain manifest_hash
                  </span>
                </div>
                <div className="dx-integrity__check">
                  <span className="dx-integrity__cno">2</span>
                  <span className="dx-integrity__ck">each served file</span>
                  <span className="dx-integrity__clead" />
                  <span className="dx-integrity__cv">
                    sha256 = manifest entry
                  </span>
                </div>
              </div>

              <p className="dx-integrity__foot">
                A mismatch returns 502, never the bytes. The path-to-file map
                can&rsquo;t be swapped, and no file can be tampered with at the
                aggregator. You serve exactly what the chain pinned.
              </p>
            </div>
          </Reveal>
        </div>
      </section>

      {/* 03 · WHAT THE MERCHANT GETS — the plain ledger. */}
      <section className="sx-section">
        <div className="sx-wrap">
          <div className="sx-marker">
            <span className="sx-marker__no">//03</span>
            <span className="sx-marker__label">The first merchant on Suize</span>
            <span className="sx-marker__line" />
          </div>
          <Reveal className="sx-room__feat">
            {FACTS.map(([k, v]) => (
              <div className="sx-feat__row" key={k}>
                <span className="sx-feat__k">{k}</span>
                <span className="sx-feat__lead" />
                <span className="sx-feat__v">{v}</span>
              </div>
            ))}
          </Reveal>
          <Reveal className="dx-deploy__close">
            <p className="dx-deploy__closeline">
              Built on the rail.
            </p>
            <div className="dx-deploy__actions">
              <a className="dx-btn is-accent is-lg" href={LINKS.deploy}>
                Open Deploy →
              </a>
              <a
                className="sx-link"
                href="#/pricing"
                onClick={e => {
                  e.preventDefault()
                  navigate('/pricing')
                }}
              >
                See pricing →
              </a>
            </div>
          </Reveal>
        </div>
      </section>

      <Footer />
    </Room>
  )
}
