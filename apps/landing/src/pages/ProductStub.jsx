import { Room, RoomHero } from '../components/Room'
import Footer from '../components/Footer'
import { Reveal } from '../ui'
import { PRODUCTS } from '../config'

// A stubbed product room — inherits the full chassis + its own accent so the
// per-product theming is provable, with a "detail page coming" badge. Used now
// only by Crash; Deploy has its own full page (pages/Deploy.jsx).
export default function ProductStub({ id }) {
  const p = PRODUCTS.find(x => x.id === id) || PRODUCTS[0]
  return (
    <Room id={id}>
      <RoomHero
        eyebrow={`${p.name} · ${p.side}`}
        title={p.desc}
        sub={`Part of the Suize ecosystem — the same dark house, this room's own motif. Open the live product, or head back to the rail.`}
        ctaHref={p.external}
        ctaLabel="Open the product →"
      />
      <section className="sx-section">
        <div className="sx-wrap">
          <div className="sx-marker">
            <span className="sx-marker__no">//01</span>
            <span className="sx-marker__label">{p.verb}</span>
            <span className="sx-marker__line" />
          </div>
          <Reveal className="sx-stub">
            <span className="sx-stub__badge">
              Detail page in progress
            </span>
            <h2 className="sx-sectionhead__title" style={{ marginTop: 22 }}>
              The full {p.name} experience lands here.
            </h2>
            <p className="sx-room__sub" style={{ marginTop: 18 }}>
              This room reuses the shared chassis and the hero motif engine with
              its own accent temperature. Open the live product for the full
              experience.
            </p>
          </Reveal>
        </div>
      </section>
      <Footer />
    </Room>
  )
}
