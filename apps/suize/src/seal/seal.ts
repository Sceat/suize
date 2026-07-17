// =============================================================================
// Seal session management. The recorded spike GOTCHA: construct ONE SealClient
// per browser session and REUSE it (reconstruction poisons its key cache), and
// prompt for the SessionKey signature ONCE per session. Both live here as
// module singletons keyed by the connected address; a wallet switch resets them.
// =============================================================================

import { SealClient, SessionKey, type SealCompatibleClient } from '@mysten/seal'
import { SEAL_KEY_SERVERS } from '@suize/shared'
import { NETWORK } from '../config'

/**
 * Construct a FRESH SealClient against the current network's OPEN key-server
 * committee — the ONE list in @suize/shared the worker also encrypts against, so
 * a mainnet build never decrypts with testnet ids (that would brick paid sites).
 * Denial is enforced by the servers: they dry-run the package's `seal_approve`
 * and refuse a share when the wallet is off the allowlist. The E2E's allowed-vs-
 * denied matrix needs a clean cache per wallet; the browser uses the shared
 * singleton below.
 */
export function makeSealClient(suiClient: SealCompatibleClient): SealClient {
  return new SealClient({
    suiClient,
    serverConfigs: SEAL_KEY_SERVERS[NETWORK].map((objectId) => ({ objectId, weight: 1 })),
    verifyKeyServers: false,
  })
}

let sealSingleton: SealClient | null = null

/** The reused per-session SealClient (built once). Reset on a wallet switch. */
export function getSealClient(suiClient: SealCompatibleClient): SealClient {
  if (!sealSingleton) sealSingleton = makeSealClient(suiClient)
  return sealSingleton
}

// The one signed SessionKey for the session, cached by address. Recreated (a new
// signature prompt) only when the address changes or the key expires.
let cached: { address: string; packageId: string; key: SessionKey } | null = null

/** Reset the cached SealClient + SessionKey — called when the connected wallet
 *  changes, so a new identity never reuses another's key material. */
export function resetSealSession(): void {
  sealSingleton = null
  cached = null
}

/** Sign the SessionKey's personal message → base64 signature. Injected so the
 *  browser (dapp-kit wallet) and the headless proof (a keypair) share this flow. */
export type PersonalMessageSigner = (message: Uint8Array) => Promise<string>

/**
 * Get a ready-to-use (signature-set) SessionKey for `address` under `packageId`,
 * reusing the cached one when it is still valid so the wallet prompts at most
 * once per session. Calls `sign` (a single wallet popup) only when a fresh key
 * is needed.
 */
export async function ensureSessionKey(opts: {
  address: string
  packageId: string
  suiClient: SealCompatibleClient
  sign: PersonalMessageSigner
  ttlMin?: number
}): Promise<SessionKey> {
  const { address, packageId, suiClient, sign, ttlMin = 10 } = opts
  if (
    cached &&
    cached.address === address &&
    cached.packageId === packageId &&
    !cached.key.isExpired()
  ) {
    return cached.key
  }
  const key = await SessionKey.create({ address, packageId, ttlMin, suiClient })
  const signature = await sign(key.getPersonalMessage())
  await key.setPersonalMessageSignature(signature)
  cached = { address, packageId, key }
  return key
}
