import Nav from '../components/Nav'
import Hero from '../components/Hero'
import Footer from '../components/Footer'
import {
  LeashBeat,
  CapabilitiesBeat,
  ConfirmBeat,
  LogBeat,
  TrustCloser,
} from '../components/HomeBeats'
import '../hero.css'
import '../home.css'

// ============================================================================
// THE HOME = THE PAY / AGENTIC MAGIC. An ASYMMETRIC, choreographed scroll (NOT
// a linear slide-deck): the approved hero, then a PINNED horizontal-scroll
// reassurance beat, the iOS confirm→receipt UI moment, the alive ledger, and the
// locked close. The spine is FOMO → REASSURE → MOMENT → PROOF → TRUST.
//
//   Hero          — the approved <1s gut-punch + glass notification (kept)
//   LeashBeat     — "Your easy-to-use wallet." (PINNED horizontal scroll)
//   ConfirmBeat   — the iOS notification → confirm → receipt sequence (UI moment)
//   LogBeat        — "Fully transparent. You stay in control." + the alive ledger
//   TrustCloser    — the honesty payload + the locked close
// ============================================================================
export default function Landing() {
  return (
    <>
      <Nav />
      <main className="sx-main">
        <Hero />
        <LeashBeat />
        <CapabilitiesBeat />
        <ConfirmBeat />
        <LogBeat />
        <TrustCloser />
      </main>
      <Footer />
    </>
  )
}
