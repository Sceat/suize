import Nav from '../components/Nav'
import Footer from '../components/Footer'
import { Reveal } from '../ui'

// /pricing — the ONE place fees live (hidden from the landing per the brief).
// Rendered as a ledger: dotted-leader rows, mono values.
export default function Pricing() {
  return (
    <>
      <Nav />
      <main className="sx-main sx-page">
        <div className="sx-wrap">
          <div className="sx-marker">
            <span className="sx-marker__no">//</span>
            <span className="sx-marker__label">Pricing</span>
            <span className="sx-marker__line" />
          </div>
          <Reveal className="sx-pricing">
            <p className="sx-pricing__hero">Free</p>
            <p className="sx-pricing__herolabel">to send money. Always.</p>

            <div className="sx-prows">
              <div className="sx-prow">
                <span className="sx-prow__k">Send / transfer money</span>
                <span className="sx-prow__lead" />
                <span className="sx-prow__v is-free">Free</span>
              </div>
              <div className="sx-prow">
                <span className="sx-prow__k">Get paid by an agent (Charge)</span>
                <span className="sx-prow__lead" />
                <span className="sx-prow__v">2%</span>
              </div>
              <div className="sx-prow">
                <span className="sx-prow__k">Setup / account</span>
                <span className="sx-prow__lead" />
                <span className="sx-prow__v">$0</span>
              </div>
            </div>

            <p className="sx-pricing__close">No seats. No tiers. No sales call.</p>
          </Reveal>
        </div>
      </main>
      <Footer />
    </>
  )
}
