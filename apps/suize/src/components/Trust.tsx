// Trust beats: after you publish. Three plain-language columns (ownership /
// integrity / payment), one short sentence each. Every claim is literally true
// today: whoever pays is the on-chain Site.owner, the bytes are content-addressed
// and integrity-checked at serve time, and one gasless USDC payment funds storage.

export function Trust() {
  return (
    <section className="trust">
      <div className="wrap trust__in">
        <div className="beat">
          <div className="beat__marker">
            <span className="beat__no">01</span>
            <span className="beat__lbl">Ownership</span>
            <span className="beat__line" />
          </div>
          <h3>The payer owns it on-chain.</h3>
          <p>
            Whoever makes the payment owns the site. There is no account to open and no API keys to
            manage.
          </p>
        </div>

        <div className="beat">
          <div className="beat__marker">
            <span className="beat__no">02</span>
            <span className="beat__lbl">Integrity</span>
            <span className="beat__line" />
          </div>
          <h3>Visitors get the exact files.</h3>
          <p>The site is content-addressed, and every byte is checked when it is served.</p>
        </div>

        <div className="beat">
          <div className="beat__marker">
            <span className="beat__no">03</span>
            <span className="beat__lbl">Payment</span>
            <span className="beat__line" />
          </div>
          <h3>Pay once, then it is live.</h3>
          <p>
            One gasless USDC payment puts the static site on Walrus. Keep it for years, or throw it
            away tomorrow.
          </p>
        </div>
      </div>
    </section>
  )
}
