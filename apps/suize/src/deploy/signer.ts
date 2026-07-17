// =============================================================================
// PaySigner factories. The pay flow is signer-agnostic (pay.ts); these bind it
// to either the connected wallet (prod) or a throwaway keypair (dev/E2E — the
// same escape hatch AccessPage uses so an automated run can drive the real money
// seam without a wallet extension). Neither ever leaves the browser.
// =============================================================================

import { Transaction } from '@mysten/sui/transactions'
import { fromBase64 } from '@mysten/sui/utils'
import type { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import type { PaySigner } from './pay'

/** The connected-wallet signer. We hand the wallet the fully-built gasless bytes
 * (nothing left to gas), then submit whatever bytes it returns signed. */
export function mkWalletSigner(
  address: string,
  signTransaction: (args: { transaction: Transaction }) => Promise<{ bytes: string; signature: string }>,
  signPersonalMessage: (args: { message: Uint8Array }) => Promise<{ signature: string }>,
): PaySigner {
  return {
    address,
    sign: async (unsigned) => {
      const { bytes, signature } = await signTransaction({ transaction: Transaction.from(fromBase64(unsigned)) })
      return { bytes, signature }
    },
    signMessage: async (message) => (await signPersonalMessage({ message })).signature,
  }
}

/** The dev/E2E signer — a local keypair signs the exact bytes (the MCP path). */
export function mkKeypairSigner(kp: Ed25519Keypair): PaySigner {
  return {
    address: kp.toSuiAddress(),
    sign: async (unsigned) => {
      const { signature } = await kp.signTransaction(fromBase64(unsigned))
      return { bytes: unsigned, signature }
    },
    signMessage: async (message) => (await kp.signPersonalMessage(message)).signature,
  }
}
