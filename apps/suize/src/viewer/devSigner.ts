// =============================================================================
// DEV-ONLY keypair signer (for the T-007b E2E). The viewer's only dependency on
// a browser wallet is (a) a connected address and (b) a personal-message
// signature for the Seal SessionKey. This lets an automated E2E drive the whole
// sealed-site flow — real Seal crypto, real state machine, real denied/unlocked
// UI — without a wallet extension, by selecting a throwaway testnet keypair via
// `?dev-key=<alias|suiprivkey…>`. The `import.meta.env.DEV` guard tree-shakes
// this out of every production build; it is never a code path a real user hits.
// =============================================================================

import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import type { PersonalMessageSigner } from '../seal/seal'

export interface DevSigner {
  address: string
  sign: PersonalMessageSigner
  /** The raw keypair — lets the E2E execute manager add/remove txs without a
   *  browser wallet (dev-only path in AccessPage). */
  keypair: Ed25519Keypair
  label: string
}

/** Resolve the `?dev-key=` param to a signer, or null (prod, or no/invalid key).
 *  The value is an ALIAS ONLY, looked up as `VITE_DEV_<ALIAS>_KEY` in the
 *  gitignored env (.env.local). Raw keys in a URL are rejected outright (owner
 *  law 2026-07-12: plain-text keys in a URL land in history/logs — never). */
export function getDevSigner(): DevSigner | null {
  if (!import.meta.env.DEV) return null
  const raw = new URLSearchParams(window.location.search).get('dev-key')
  if (!raw || raw.startsWith('suiprivkey')) return null
  const secret = (import.meta.env as Record<string, string | undefined>)[`VITE_DEV_${raw.toUpperCase()}_KEY`]
  if (!secret) return null
  try {
    const kp = Ed25519Keypair.fromSecretKey(secret)
    return {
      address: kp.toSuiAddress(),
      keypair: kp,
      label: raw,
      sign: async (message) => (await kp.signPersonalMessage(message)).signature,
    }
  } catch {
    return null
  }
}
