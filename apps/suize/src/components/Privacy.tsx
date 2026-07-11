// Privacy aside — the three visibility tiers.

export function Privacy() {
  return (
    <section className="wrap privacy">
      <div className="privacy__grid">
        <div>
          <span className="kicker">On visibility</span>
          <h2>Three ways to be seen.</h2>
        </div>
        <div className="tiers">
          <div className="tier">
            <div className="tier__t">Public</div>
            <div className="tier__d">
              <b>Listed here.</b> Anyone can find it and visit it — it rides the front page above.
            </div>
          </div>
          <div className="tier">
            <div className="tier__t">Unlisted</div>
            <div className="tier__d">
              <b>Live for anyone with the link.</b> Never indexed, never in the gallery — quiet by
              choice.
            </div>
          </div>
          <div className="tier">
            <div className="tier__t">Private</div>
            <div className="tier__d">
              <b>Seal-encrypted.</b> The blob decrypts client-side only for wallets you allow
              on-chain. Nobody else — including us — can read a byte.
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
