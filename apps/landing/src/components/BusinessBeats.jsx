import { BUSINESS } from '../config'
import { Reveal, CopyButton } from '../ui'

// ============================================================================
// /for-business — THE CHARGE FACE (consensus §4). The SAME house as the home,
// the read inverted: not leashing a spender — RECEIVING. The artifacts read as
// rising to be paid (`.is-rising`). Every "section" is a beat over the fixed
// <Backdrop> (the clean editorial surface) — ONE giant Newsreader line alone in
// open space, NO card, NO border, NO fill behind the type (consensus §3).
// Legibility comes from the paper, not a box.
//
//   Station 1 · ChargeBeat  — "Charge an agent. Get paid now." + the rising
//                             snippet↔receipt pair (two floating laminae)
//   Station 2 · SpeedBeat    — "Start earning now." — 3 speed facts as a premium
//                             corporate ledger panel (NOT cheap bullets)
//   Station 3 · ProofBeat     — charge-side proof ONLY (no Deploy reference)
//   Station 3.5 · TrustBeat    — "Trusted by thousands" — a WEIGHTY high-contrast
//                             heading over a seamless wordmark marquee (moved here
//                             from the home; the rail is the merchant trust signal)
//   Station 4 · CloseBeat      — the honesty payload + the FOMO 2-line close
//
// LAWS: every CTA is a sharp frosted rectangle (.sx-cta) — never a pill; ZERO
// decorative dots; ZERO boxes. Copy is pulled from BUSINESS (config.js).
// HONESTY (claim ladder): `gasless, x402-compatible by design`; NEVER "on x402".
// NO PRICING anywhere on this page — the receipt shows the paid moment (an
// agent's payment landing), never a fee split / net / "2%". Pricing lives only
// on the /pricing page.
// ============================================================================

// the shared station header — a huge serif line alone in the water (mirrors
// HomeBeats' StationHead so the two pages share one editorial scale)
function StationHead({ eyebrow, head, sub }) {
  return (
    <Reveal className="sx-stationhead">
      <span className="ed-eyebrow">{eyebrow}</span>
      <h2 className="sx-stationhead__title">{head}</h2>
      <p className="sx-stationhead__sub">{sub}</p>
    </Reveal>
  )
}

// STANDARDS-ONLY STRIP — a single restrained capability band sitting between the
// payment lane and the charge station. NOT the trust marquee: this is one quiet,
// confident line that says "plugs in anywhere," grounded in the open standards we
// share with the incumbents. NO platform logos, NO Shopify/WooCommerce names — a
// hairlined eyebrow + line on the deep corporate floor, theme-aware via --biz-*,
// static under reduced motion (Reveal degrades to a plain fade per theme.css).
export function IntegrationsStrip() {
  const { integrations } = BUSINESS
  if (!integrations?.line) return null
  return (
    <section className="sx-station sx-station--integ" id="integrations" aria-label="Integrations and standards">
      <div className="sx-wrap">
        <Reveal className="bz-integ">
          <span className="bz-integ__rule" aria-hidden="true" />
          <span className="bz-integ__eyebrow ed-eyebrow">{integrations.eyebrow}</span>
          <p className="bz-integ__line">{integrations.line}</p>
          <span className="bz-integ__rule" aria-hidden="true" />
        </Reveal>
      </div>
    </section>
  )
}

function StationCta({ cta, ghost }) {
  return (
    <Reveal className="sx-station__cta">
      <a
        className="sx-cta"
        href={cta.href}
        target={cta.href.startsWith('#') ? undefined : '_blank'}
        rel={cta.href.startsWith('#') ? undefined : 'noreferrer'}
      >
        {cta.label}
      </a>
      {ghost && (
        <a className="sx-ghost" href={ghost.href}>
          {ghost.label}
        </a>
      )}
    </Reveal>
  )
}

// The CHARGE snippet — the REAL @suize/pay middleware (npm-published). Kept in
// sync with the rendered <pre>. The price is the merchant's OWN example number
// (allowed), never a Suize fee. Subscriptions are push-not-pull: the customer
// signs each renewal, nothing reaches into their account — no relayer, no pull.
const CHARGE_SNIPPET = `import { suize } from '@suize/pay'

app.use(suize({ to: '0xYOU', price: '9.00' }))`

// STATION 1 — THE CHARGE. The snippet and the receipt it produces RISE side by
// side as two floating SHARP-cornered glass laminae (NOT a boxed card pair, NO
// dots). Write it (left), read the receipt (right). The receipt shows the paid
// moment landing — NO fee split, NO pricing (pricing lives only on /pricing).
export function ChargeBeat() {
  const { charge } = BUSINESS
  return (
    <section className="sx-station sx-station--charge" id="charge">
      <div className="sx-wrap">
        <StationHead
          eyebrow={charge.eyebrow}
          head={charge.head}
          sub={charge.sub}
        />

        <Reveal className="bz-pair">
          {/* the snippet — a rising frosted lamina, syntax-highlit, tagged */}
          <div className="bz-lamina bz-snippet is-rising">
            <span className="bz-lamina__hair" aria-hidden="true" />
            <div className="bz-snippet__head">
              <span className="ed-eyebrow">@suize/pay</span>
              <span className="bz-snippet__tags">
                <span className="bz-tag">x402</span>
                <CopyButton value={CHARGE_SNIPPET} label="Copy charge snippet" />
              </span>
            </div>
            <pre className="bz-snippet__code">
              <code>
                <span className="c-key">import</span> {'{ suize }'}{' '}
                <span className="c-key">from</span>{' '}
                <span className="c-str">'@suize/pay'</span>
                {'\n\n'}app.<span className="c-fn">use</span>(
                <span className="c-fn">suize</span>({'{ '}to:{' '}
                <span className="c-str">'0xYOU'</span>, price:{' '}
                <span className="c-str">'9.00'</span>
                {' }'}))
              </code>
            </pre>
          </div>

          {/* the verifiable receipt — a rising frosted lamina, testnet sample.
              Shows the paid moment landing — NO fee split, NO pricing. */}
          <div className="bz-lamina bz-receipt is-rising" style={{ '--rise-d': '0.5s' }}>
            <span className="bz-lamina__hair" aria-hidden="true" />
            <div className="bz-receipt__head">
              <span className="ed-eyebrow">On-chain receipt</span>
            </div>
            <div className="bz-receipt__rows">
              <div className="bz-receipt__row">
                <span className="bz-receipt__act">
                  Charged <span className="host">· your-service</span>
                </span>
                <span className="bz-receipt__lead" />
                <span className="bz-receipt__amt">$9.00</span>
              </div>
              <div className="bz-receipt__row">
                <span className="bz-receipt__act">
                  Settled <span className="host">· USDC, on-chain</span>
                </span>
                <span className="bz-receipt__lead" />
                <span className="bz-receipt__amt">seconds</span>
              </div>
              <div className="bz-receipt__row">
                <span className="bz-receipt__act">
                  Verified <span className="host">· on-chain</span>
                </span>
                <span className="bz-receipt__lead" />
                <span className="bz-receipt__amt">paid ✓</span>
              </div>
            </div>
            <div className="bz-receipt__foot">
              <span className="bz-receipt__id">tx</span>
              <span className="bz-receipt__id">every charge is logged</span>
            </div>
          </div>
        </Reveal>

        <StationCta cta={charge.cta} />
      </div>
    </section>
  )
}

// STATION 2 — START EARNING NOW. The three SPEED facts get a PREMIUM corporate
// treatment (the owner: the old 3 cheap bullets were "too cheap"): a single
// substantial frosted ledger panel on the deep --biz-panel surface, each fact a
// numbered row separated by corporate hairlines — index · headline · note + a
// quiet mono tag on the right. Reads like an enterprise spec sheet, not bullets.
export function SpeedBeat() {
  const { speed } = BUSINESS
  return (
    <section className="sx-station sx-station--speed" id="speed">
      <div className="sx-wrap">
        <StationHead eyebrow={speed.eyebrow} head={speed.head} sub={speed.sub} />
        <Reveal className="bz-ledger" lines>
          {speed.cards.map((c, i) => (
            <div className="bz-ledger__row" key={c.focal}>
              <span className="bz-ledger__idx" aria-hidden="true">
                {c.focal}
              </span>
              <div className="bz-ledger__body">
                <h3 className="bz-ledger__title">{c.title}</h3>
                <p className="bz-ledger__note">{c.note}</p>
              </div>
              <span className="bz-ledger__step" aria-hidden="true">
                {`Step ${i + 1}`}
              </span>
            </div>
          ))}
        </Reveal>
        <StationCta cta={speed.cta} />
      </div>
    </section>
  )
}

// STATION 3 — THE PROOF (shown, not claimed). CHARGE-SIDE proof ONLY — no Deploy
// reference (Deploy is its own product page). A rising frosted lamina states the
// proof (settlement / every fee on the receipt / non-custodial) on the left and
// lists the three charge-side facts as a corporate spec column on the right. NO
// pricing numbers here (pricing lives only on /pricing).
export function ProofBeat() {
  const { proof } = BUSINESS
  return (
    <section className="sx-station sx-station--proof" id="proof">
      <div className="sx-wrap">
        <StationHead eyebrow={proof.eyebrow} head={proof.head} sub={proof.sub} />
        <Reveal className="bz-proof">
          <div className="bz-lamina bz-proofcard is-rising">
            <span className="bz-lamina__hair" aria-hidden="true" />
            <div className="bz-proofcard__main">
              <span className="ed-eyebrow">On the rail · charge-side proof</span>
              <p className="bz-proofcard__lede">
                Every charge — one-off or a subscription that renews on its own —
                settles to you in USDC on-chain in seconds, with every fee printed
                right on the receipt. We never custody a cent.
              </p>
              <a
                className="sx-ghost bz-proofcard__link"
                href={proof.link.href}
              >
                {proof.link.label}
              </a>
            </div>
            <div className="bz-proofcard__facts">
              {proof.facts.map(([k, v]) => (
                <div className="bz-proofcard__fact" key={k}>
                  <span className="bz-proofcard__fk">{k}</span>
                  <span className="bz-proofcard__fv">{v}</span>
                </div>
              ))}
            </div>
          </div>
        </Reveal>
        <StationCta cta={proof.cta} />
      </div>
    </section>
  )
}

// STATION 3.5 — TRUSTED BY THOUSANDS (moved here from the home — the rail is the
// merchant trust signal). A BOLD, high-contrast heading you FEEL, over a single
// seamless wordmark marquee of the placeholder company names: logo-style caps,
// masked edges, NO seam (the track is duplicated and translated -50%). This is a
// distinct full-bleed band — breaks the floating-station rhythm on purpose so
// the page isn't all identical blocks. Static under prefers-reduced-motion.
export function TrustBeat() {
  const { trust } = BUSINESS
  if (!trust?.marquee?.length) return null
  // duplicate the list so the -50% translate loops with no visible seam
  const items = [...trust.marquee, ...trust.marquee]
  return (
    <section className="sx-station sx-station--trust" id="trusted">
      <Reveal className="sx-wrap bz-trust">
        <span className="ed-eyebrow bz-trust__eyebrow">Trusted by builders</span>
        <h2 className="bz-trust__title">{trust.marqueeTitle}</h2>
      </Reveal>

      <div className="bz-trust__marquee" aria-label="Companies charging agents on Suize">
        <div className="bz-trust__track" aria-hidden="true">
          {items.map((m, i) => (
            <span className="bz-trust__mark" key={i}>
              {m}
            </span>
          ))}
        </div>
      </div>
    </section>
  )
}

// STATION 4 — THE CLOSE (the surface, broken). The honesty payload as plain
// floating lines, the locked 2-line close title, the final sharp CTA + the one
// back-bridge to PAY. No box. (The trust marquee now lives in its own TrustBeat
// station above, so it is NOT repeated here.)
export function CloseBeat() {
  const { close } = BUSINESS
  const closeLines = Array.isArray(close.closer) ? close.closer : [close.closer]
  return (
    <section className="sx-station sx-station--close sx-station--bzclose" id="get-paid">
      <div className="sx-wrap sx-close__inner">
        <Reveal>
          {/* the claim-ladder honesty line — read plainly, not a whisper */}
          <p className="sx-close__custody bz-close__honest">{close.honest}</p>
        </Reveal>

        <Reveal className="sx-close__closerwrap">
          <h2 className="sx-close__title">
            {closeLines.map((line, i) => (
              <span className="sx-close__line" key={i}>
                {line}
                {i < closeLines.length - 1 && <br />}
              </span>
            ))}
          </h2>
          <div className="sx-station__cta sx-close__cta">
            <a
              className="sx-cta sx-cta--lg"
              href={close.cta.href}
              target={close.cta.href.startsWith('#') ? undefined : '_blank'}
              rel={close.cta.href.startsWith('#') ? undefined : 'noreferrer'}
            >
              {close.cta.label}
            </a>
          </div>
          <a className="sx-ghost sx-close__bridge" href={close.bridge.href}>
            {close.bridge.label}
          </a>
        </Reveal>
      </div>
    </section>
  )
}
