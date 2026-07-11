// Trust beats — the three verifiable/permanence/custody columns.

export function Trust() {
  return (
    <section className="trust">
      <div className="wrap trust__in">
        <div className="beat">
          <div className="beat__marker">
            <span className="beat__no">01</span>
            <span className="beat__lbl">Verifiable</span>
            <span className="beat__line" />
          </div>
          <h3>Receipts you can open.</h3>
          <p>
            Every deploy returns a manifest, a double content hash, and the payment digest. Each
            one is an explorer link — nothing to trust, everything to check.
          </p>
          <div className="beat__proof">
            <span>
              manifest <b>0x9f3a…c1</b>
            </span>
            <span>
              content sha256×2 <b>verified</b>
            </span>
            <span>
              payment digest <b>0x41b8…7e</b>
            </span>
          </div>
        </div>

        <div className="beat">
          <div className="beat__marker">
            <span className="beat__no">02</span>
            <span className="beat__lbl">Permanence</span>
            <span className="beat__line" />
          </div>
          <h3>Your sites outlive us.</h3>
          <p>
            Storage is a funded pool on Walrus that anyone can top up. Suize could disappear
            tomorrow and every permanent site keeps serving. Extend by hash, no login required.
          </p>
          <div className="beat__proof">
            <span>
              storage <b>Walrus</b>
            </span>
            <span>
              fundable by <b>anyone</b>
            </span>
            <span>
              extend by <b>site hash</b>
            </span>
          </div>
        </div>

        <div className="beat">
          <div className="beat__marker">
            <span className="beat__no">03</span>
            <span className="beat__lbl">Custody</span>
            <span className="beat__line" />
          </div>
          <h3>Zero custody, by design.</h3>
          <p>
            You connect your own wallet and sign your own payment. Keys never leave your machine,
            funds never touch a Suize account. The facilitator is open source — run your own.
          </p>
          <div className="beat__proof">
            <span>
              keys <b>never leave you</b>
            </span>
            <span>
              facilitator <b>open source</b>
            </span>
            <span>
              fee <b>operator-owned</b>
            </span>
          </div>
        </div>
      </div>
    </section>
  )
}
