// Privacy aside: the visibility tiers the product actually offers.
//
// There is no "unlisted" path in the product (only public and Seal-private), so
// that tier is not shown. The whole aside hides on any network with no verified
// Seal key-server committee (an empty SEAL_KEY_SERVERS list) rather than
// overclaim an encryption tier a deploy there can't get.

import { NETWORK } from '../config'
import { SEAL_KEY_SERVERS } from '@suize/shared'

export function Privacy() {
  if (SEAL_KEY_SERVERS[NETWORK].length === 0) return null
  return (
    <section className="wrap privacy">
      <div className="privacy__grid">
        <div>
          <span className="kicker">On visibility</span>
          <h2>Two ways to be seen.</h2>
        </div>
        <div className="tiers">
          <div className="tier">
            <div className="tier__t">Public</div>
            <div className="tier__d">
              <b>Listed here.</b> Anyone can find it and visit it. It rides the front page above.
            </div>
          </div>
          <div className="tier">
            <div className="tier__t">Private</div>
            <div className="tier__d">
              <b>Seal-encrypted.</b> The bytes stored on Walrus are encrypted at rest; only wallets
              you allow on-chain can decrypt them, client-side. The service keeps no copy of your
              keys.
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
