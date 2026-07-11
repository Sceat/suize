// ============================================================================
// The persisted zkLogin session — load / validate / save / sign.
//
// WHAT IS PERSISTED (~/.suize/session.json, chmod 0600): the EXACT payload the
// Suize wallet's /agent-connect page POSTs to the loopback callback: the agent's
// zkLogin address, the pre-minted zk proof, the Enoki-SDK-serialized EPHEMERAL
// session secret (base64 raw 32-byte Ed25519 —
// `toBase64(decodeSuiPrivateKey(kp.getSecretKey()).secretKey)`, see EnokiFlow.mjs),
// and optionally the user's main wallet address (the suize_kill sweep destination).
// The Google JWT is deliberately NOT in the payload.
//
// CUSTODY: this material signs sponsored bytes 100% LOCALLY via the Enoki SDK's
// own `EnokiKeypair` (zero remote calls — the proof is already minted) and dies
// at `maxEpoch`. Reconstructing the SDK-serialized ephemeral inside
// `EnokiKeypair` is the Enoki SDK's own session-restore path (EnokiFlow does
// the identical `Ed25519Keypair.fromSecretKey(fromBase64(...))` internally) —
// it is NOT a standalone raw-keypair signer, and there is NO dev-signer
// fallback of any kind. Keys never leave the user's machine; the backend never
// signs the payer leg.
// ============================================================================

import { chmodSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { EnokiKeypair } from '@mysten/enoki'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { fromBase64 } from '@mysten/sui/utils'
import { publicKeyFromSuiBytes } from '@mysten/sui/verify'
import type { ZkLoginSignatureInputs } from '@mysten/sui/zklogin'
import { formAgentSubaccount } from '@suize/x402'
import type { MultiSigPublicKey } from '@mysten/sui/multisig'
import { grpcClient } from './chain'
import { SESSION_PATH, SUI_ADDRESS_RE, type SuiNetwork } from './config'

/** The /agent-connect loopback payload (version 1) — what crosses to the cb and
 * what we persist verbatim (plus `savedAt` for humans reading the file). This is
 * the FIXED contract the wallet's /agent-connect page builds against. */
export interface SuizeSession {
  version: 1
  provider: 'google'
  network: SuiNetwork
  /** The AGENT's own zkLogin address — the signer + the payer of every tool. */
  address: string
  publicKey: string | null
  maxEpoch: number
  /** ms epoch — Enoki's session-lifetime estimate (the cheap local expiry check). */
  expiresAt: number
  randomness: string
  /** base64 raw 32-byte Ed25519 ephemeral SECRET (Enoki-SDK-serialized). */
  ephemeralKeyPair: string
  proof: ZkLoginSignatureInputs
  /**
   * OPTIONAL — the user's MAIN wallet zkLogin public key, Sui-serialized
   * (`PublicKey.toSuiPublicKey()` base64), when the /agent-connect page posts it.
   * It is the OTHER member of the agent's 1-of-2 sub-account multisig {MAIN, AGENT}
   * — so its presence is what makes the agent's spendable address the sub-account
   * (`subaccountFor`), and its `toSuiAddress()` is the suize_kill sweep home (a
   * loss-proof "send it all back" with no arg to fat-finger). Absent → no multisig
   * (the agent spends its bare address) and suize_kill needs an explicit `to`.
   */
  mainPubKey?: string
}

// The uniform "go sign in" lines — suize_pay's no-session error is asserted by
// the stdio smoke test, so keep the "authenticate tool first" phrasing stable.
export const AUTH_REQUIRED_MSG =
  'No Suize session — run the authenticate tool first. (It opens the Suize Pay connect page; you sign in with Google and keys never leave this machine.)'
export const AUTH_EXPIRED_MSG =
  'Your Suize session has expired — run the authenticate tool first to sign in again.'

/** Validate an unknown value against the version-1 /agent-connect payload. Returns
 * a human-readable reason on failure (sent back to the connect page as a 400). */
export const validateSessionPayload = (
  v: unknown,
): { ok: true; session: SuizeSession } | { ok: false; error: string } => {
  if (!v || typeof v !== 'object') return { ok: false, error: 'payload is not an object' }
  const o = v as Record<string, unknown>
  if (o.version !== 1) return { ok: false, error: `unsupported payload version: ${String(o.version)}` }
  if (o.provider !== 'google') return { ok: false, error: 'unsupported provider' }
  if (o.network !== 'testnet' && o.network !== 'mainnet') {
    return { ok: false, error: 'missing or unknown network' }
  }
  if (typeof o.address !== 'string' || !SUI_ADDRESS_RE.test(o.address)) {
    return { ok: false, error: 'missing or malformed address' }
  }
  if (typeof o.maxEpoch !== 'number' || !Number.isInteger(o.maxEpoch) || o.maxEpoch <= 0) {
    return { ok: false, error: 'missing or malformed maxEpoch' }
  }
  if (typeof o.expiresAt !== 'number' || o.expiresAt <= 0) {
    return { ok: false, error: 'missing or malformed expiresAt' }
  }
  if (typeof o.randomness !== 'string' || !o.randomness) {
    return { ok: false, error: 'missing randomness' }
  }
  if (typeof o.ephemeralKeyPair !== 'string' || !o.ephemeralKeyPair) {
    return { ok: false, error: 'missing ephemeralKeyPair' }
  }
  // The ephemeral must decode to the 32-byte secret the Enoki SDK serialized —
  // prove it reconstructs NOW, not at first payment.
  try {
    const secret = fromBase64(o.ephemeralKeyPair)
    if (secret.length !== 32) return { ok: false, error: 'ephemeralKeyPair is not a 32-byte secret' }
    Ed25519Keypair.fromSecretKey(secret)
  } catch {
    return { ok: false, error: 'ephemeralKeyPair does not decode' }
  }
  const proof = o.proof as Record<string, unknown> | null | undefined
  if (
    !proof ||
    typeof proof !== 'object' ||
    !proof.proofPoints ||
    !proof.issBase64Details ||
    typeof proof.headerBase64 !== 'string' ||
    typeof proof.addressSeed !== 'string'
  ) {
    return { ok: false, error: 'missing or malformed zk proof' }
  }
  const publicKey = typeof o.publicKey === 'string' ? o.publicKey : null
  // mainPubKey is OPTIONAL; when present it must be a Sui-serialized public key that
  // reconstructs NOW (it is the multisig's other member AND, via toSuiAddress(), the
  // suize_kill sweep home — a malformed one would brick both). Prove it parses here,
  // not at first spend.
  let mainPubKey: string | undefined
  if (o.mainPubKey !== undefined && o.mainPubKey !== null && o.mainPubKey !== '') {
    if (typeof o.mainPubKey !== 'string') return { ok: false, error: 'malformed mainPubKey' }
    try {
      publicKeyFromSuiBytes(o.mainPubKey)
    } catch {
      return { ok: false, error: 'mainPubKey does not decode to a Sui public key' }
    }
    mainPubKey = o.mainPubKey
  }
  return {
    ok: true,
    session: {
      version: 1,
      provider: 'google',
      network: o.network,
      address: o.address,
      publicKey,
      maxEpoch: o.maxEpoch,
      expiresAt: o.expiresAt,
      randomness: o.randomness,
      ephemeralKeyPair: o.ephemeralKeyPair,
      proof: o.proof as ZkLoginSignatureInputs,
      ...(mainPubKey ? { mainPubKey } : {}),
    },
  }
}

export type SessionState =
  | { state: 'none' }
  | { state: 'corrupt' }
  | { state: 'expired'; session: SuizeSession }
  | { state: 'ok'; session: SuizeSession }

/** Read + validate the persisted session. `expired` here is the cheap LOCAL
 * check (Enoki's expiresAt estimate); the authoritative maxEpoch-vs-current-
 * epoch check happens in suize_pay against the live chain. */
export const loadSession = (): SessionState => {
  let raw: string
  try {
    raw = readFileSync(SESSION_PATH, 'utf8')
  } catch {
    return { state: 'none' }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { state: 'corrupt' }
  }
  const v = validateSessionPayload(parsed)
  if (!v.ok) return { state: 'corrupt' }
  if (v.session.expiresAt <= Date.now()) return { state: 'expired', session: v.session }
  return { state: 'ok', session: v.session }
}

/** Persist atomically with owner-only permissions (dir 0700, file 0600). */
export const saveSession = (session: SuizeSession): void => {
  const dir = dirname(SESSION_PATH)
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const tmp = join(dir, `.session.${process.pid}.tmp`)
  writeFileSync(tmp, JSON.stringify({ ...session, savedAt: new Date().toISOString() }, null, 2), {
    mode: 0o600,
  })
  renameSync(tmp, SESSION_PATH)
  chmodSync(SESSION_PATH, 0o600) // belt-and-braces: rename preserves the tmp mode, but pin it
}

/** Drop a session that can no longer sign (expired/corrupt) so the next state is clean. */
export const clearSession = (): void => {
  try {
    rmSync(SESSION_PATH, { force: true })
  } catch {
    /* best-effort */
  }
}

/** Load the session or throw the uniform "go sign in" error (the shape every
 * session-gated tool returns when there is nothing valid to sign with). */
export const requireSession = (): SuizeSession => {
  const st = loadSession()
  if (st.state === 'expired') throw new Error(AUTH_EXPIRED_MSG)
  if (st.state !== 'ok') throw new Error(AUTH_REQUIRED_MSG)
  return st.session
}

/** The LOCAL signer — the Enoki SDK's own zkLogin keypair, reconstructed from
 * the persisted material exactly as EnokiFlow restores its own session. Signs
 * sponsored bytes with zero remote calls until maxEpoch. */
export const signerFor = (session: SuizeSession): EnokiKeypair =>
  new EnokiKeypair({
    address: session.address,
    maxEpoch: session.maxEpoch,
    proof: session.proof,
    ephemeralKeypair: Ed25519Keypair.fromSecretKey(fromBase64(session.ephemeralKeyPair)),
  })

/** The agent's spendable SUB-ACCOUNT: the 1-of-2 multisig {MAIN, AGENT} the agent's
 * funds live in. Returns `{ address, multisig }` (re-derivable by anyone from the two
 * pubkeys — see @suize/x402 formAgentSubaccount) when the session carries the MAIN
 * pubkey, else `null` (no MAIN member was connected → the agent spends its own bare
 * address). The AGENT member is the persisted signer's own public key; the MAIN member
 * is reconstructed from the session's Sui-serialized `mainPubKey`. */
export const subaccountFor = (
  session: SuizeSession,
): { address: string; multisig: MultiSigPublicKey } | null => {
  if (!session.mainPubKey) return null
  const mainPubKey = publicKeyFromSuiBytes(session.mainPubKey)
  const agentPubKey = signerFor(session).getPublicKey()
  return formAgentSubaccount(mainPubKey, agentPubKey)
}

/** Past maxEpoch a zkLogin signature is invalid no matter what `expiresAt`
 * estimated — every spending tool runs this against the live chain before it
 * builds. Clears the dead session + rethrows the uniform expiry message. */
export const assertEpochLive = async (session: SuizeSession): Promise<void> => {
  let currentEpoch: number
  try {
    const { systemState } = await grpcClient(session.network).core.getCurrentSystemState()
    currentEpoch = Number(systemState.epoch)
  } catch {
    throw new Error('could not read the current Sui epoch — check your connection and retry')
  }
  if (Number.isFinite(currentEpoch) && currentEpoch > session.maxEpoch) {
    clearSession()
    throw new Error(AUTH_EXPIRED_MSG)
  }
}
