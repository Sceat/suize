// The agent SUB-ACCOUNT wiring (session side): the validator round-trips the MAIN
// pubkey the /agent-connect page now posts, `subaccountFor` only forms a multisig
// when that pubkey is present, and the suize_kill home derives from it. Pure +
// network-free — a deterministic ed25519 stands in for the MAIN zkLogin member (the
// pubkey serialization round-trip is scheme-agnostic; the agent member's real zkLogin
// keypair needs a live proof, exercised on-chain in /tmp/multisig-spike).
import { expect, test } from 'bun:test'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { publicKeyFromSuiBytes } from '@mysten/sui/verify'
import { validateSessionPayload, subaccountFor } from '../src/session'

// A well-formed v1 /agent-connect payload (no mainPubKey by default).
const basePayload = {
  version: 1,
  provider: 'google',
  network: 'testnet',
  address: '0x' + '1'.repeat(64),
  publicKey: null,
  maxEpoch: 999_999,
  expiresAt: Date.now() + 3_600_000,
  randomness: 'r',
  ephemeralKeyPair: Buffer.from(new Uint8Array(32).fill(7)).toString('base64'),
  proof: {
    proofPoints: {},
    issBase64Details: {},
    headerBase64: 'h',
    addressSeed: '1',
  },
}

const MAIN = new Ed25519Keypair().getPublicKey()
const MAIN_SUI_PUBKEY = MAIN.toSuiPublicKey() // what the wallet posts

test('validator round-trips a Sui-serialized mainPubKey', () => {
  const v = validateSessionPayload({ ...basePayload, mainPubKey: MAIN_SUI_PUBKEY })
  expect(v.ok).toBe(true)
  if (v.ok) expect(v.session.mainPubKey).toBe(MAIN_SUI_PUBKEY)
})

test('validator omits mainPubKey when absent/empty', () => {
  const v1 = validateSessionPayload(basePayload)
  const v2 = validateSessionPayload({ ...basePayload, mainPubKey: '' })
  expect(v1.ok && v2.ok).toBe(true)
  if (v1.ok) expect(v1.session.mainPubKey).toBeUndefined()
  if (v2.ok) expect(v2.session.mainPubKey).toBeUndefined()
})

test('validator rejects a mainPubKey that does not decode', () => {
  const v = validateSessionPayload({ ...basePayload, mainPubKey: 'not-a-pubkey!!!' })
  expect(v.ok).toBe(false)
  if (!v.ok) expect(v.error).toContain('mainPubKey')
})

test('subaccountFor returns null without a mainPubKey (bare-address agent)', () => {
  const v = validateSessionPayload(basePayload)
  expect(v.ok).toBe(true)
  if (v.ok) expect(subaccountFor(v.session)).toBeNull()
})

test('the suize_kill home derives from mainPubKey === the MAIN address', () => {
  // The exact derivation reads.ts uses for the sweep destination.
  expect(publicKeyFromSuiBytes(MAIN_SUI_PUBKEY).toSuiAddress()).toBe(MAIN.toSuiAddress())
})
