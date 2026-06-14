import Nav from '../components/Nav'
import BusinessHero from '../components/BusinessHero'
import PaymentLane from '../components/PaymentLane'
import Footer from '../components/Footer'
import { IntegrationsStrip, ChargeBeat, SpeedBeat, ProofBeat, TrustBeat, CloseBeat } from '../components/BusinessBeats'
import '../home.css'
import '../businesses.css'

// ============================================================================
// /for-business = THE CHARGE FACE (consensus §4 + §6). The same house as the PAY
// home, the read inverted: not leashing a spender — RECEIVING. The whole page
// sits over the fixed <Backdrop> (the clean editorial surface); beats, each ONE
// giant Newsreader line alone in open space (no card, no box), every CTA the same
// sharp frosted "Start earning now" rectangle. The spine is REFRAME → LANE →
// CHARGE → SPEED → PROOF → CLOSE.
//
//   Station 0 · BusinessHero — "AI Agents are your new customer. / Take their
//                              money." + a rising "paid by agent" receipt artifact
//   Station 0.5 · PaymentLane — THE FACTORIO LANE: agent payments stream past on
//                              a conveyor; plug in one line → they drop into your
//                              balance (the centerpiece, the FOMO-then-collect read)
//   Station 1 · ChargeBeat    — "Charge an agent. Get paid now." + the rising
//                              snippet↔receipt pair (paid moment, no pricing)
//   Station 2 · SpeedBeat      — "Start earning now." — the 3 speed facts as a
//                              premium corporate ledger (NOT cheap bullets)
//   Station 3 · ProofBeat       — charge-side proof ONLY (settlement / every fee
//                              on the receipt / non-custodial). NO Deploy reference.
//   Station 3.5 · TrustBeat     — "Trusted by thousands" — a weighty heading over a
//                              seamless wordmark marquee (moved here from the home)
//   Station 4 · CloseBeat        — the claim-ladder honesty + the FOMO close
//
// ENVIRONMENT: the whole page lives in the BUSINESS ROOM (data-room='business'
// → theme.css --biz-* tokens). A .bz-room wrapper paints a deep corporate-blue
// floor over the airy backdrop so the mood shifts on arrival. businesses.css
// holds the inverted-current artifacts (rising laminae, the snippet/receipt) +
// the corporate retint. NO boxes-as-pills, NO dots, NO phone. Nav flips its CTA
// to the business variant on this route (config).
// ============================================================================
export default function Businesses() {
  return (
    <>
      <Nav />
      {/* the BUSINESS ROOM — a self-contained deep corporate-blue surface that
          covers the airy blueprint backdrop (backdrop.css does NOT retint for
          data-room='business'), so the page reads darker/corporate the moment
          you arrive. The wrapper also re-scopes --grad-hot / --grad-accent /
          --cta-fill / --notif-fill to the corporate --biz-* tokens. */}
      <div className="bz-room">
        <div className="bz-room__floor" aria-hidden="true" />
        <main className="sx-main bz-page">
          <BusinessHero />
          <PaymentLane />
          {/* the STANDARDS-ONLY capability band — a quiet "plugs in anywhere"
              one-liner right after the lane hook, before the charge dive. NOT
              the trust marquee; no platform logos. */}
          <IntegrationsStrip />
          <ChargeBeat />
          <SpeedBeat />
          <ProofBeat />
          <TrustBeat />
          <CloseBeat />
        </main>
      </div>
      <Footer />
    </>
  )
}
