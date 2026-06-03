import { NETWORK } from '@suize/shared'
import type {
  ExecuteRequest,
  ExecuteResponse,
  SponsorRequest,
  SponsorResponse,
} from '@suize/shared'

// ============================================================================
// Gasless sponsorship client — talks to the unified Suize backend.
// ----------------------------------------------------------------------------
// zkLogin (Enoki/Google) users hold a fresh Sui address with NO SUI for gas, so
// a self-paid bet aborts with "No valid gas coins". The backend (which holds the
// Enoki PRIVATE key) sponsors gas for the seven allowlisted router::* targets:
//
//   POST /sponsor  { network, transactionKindBytes, sender } -> { bytes, digest }
//   POST /execute  { digest, signature }                     -> { digest }
//
// The flow per gasless write:
//   1. build the tx KIND bytes (onlyTransactionKind) + base64 them
//   2. /sponsor -> the backend wraps them with a sponsor gas budget, returns the
//      FULL sponsored tx `bytes` (which the user must sign verbatim) + a `digest`
//   3. the user signs the EXACT sponsored `bytes` with their zkLogin session
//   4. /execute the (digest, signature) pair -> the backend submits + pays gas
//
// The base URL is configurable via VITE_SPONSOR_URL so local dev points at the
// backend's local port while prod points at the deployed sponsor host. We never
// hardcode a port that only works in one environment.
// ============================================================================

// Default to the backend's local dev port (services/backend/.env PORT=8099).
// Override with VITE_SPONSOR_URL for any other environment (prod sponsor host).
const SPONSOR_URL = (
  import.meta.env.VITE_SPONSOR_URL?.trim() || 'http://localhost:8099'
).replace(/\/$/, '')

// POST a JSON body and return the parsed JSON, or throw a clear, debuggable
// error. We NEVER fall back to self-pay on failure — a zkLogin user has no gas,
// so a silent fallback would just fail confusingly downstream. Surfacing
// "sponsorship unavailable" makes the broken hop obvious.
const post_json = async <Res>(
  path: string,
  body: unknown,
): Promise<Res> => {
  let res: Response
  try {
    res = await fetch(`${SPONSOR_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch (e) {
    throw new Error(
      `Sponsorship unavailable — could not reach the gas sponsor (${(e as Error).message}).`,
    )
  }
  if (!res.ok) {
    // The backend returns { error } on failure; surface it when present.
    let detail = ''
    try {
      const j = (await res.json()) as { error?: string }
      if (j?.error) detail = `: ${j.error}`
    } catch {
      // body not JSON — keep the status alone.
    }
    throw new Error(
      `Sponsorship unavailable (sponsor responded ${res.status}${detail}).`,
    )
  }
  return (await res.json()) as Res
}

// Step 2: ask the backend to sponsor the given tx KIND bytes for `sender`.
// Returns the FULL sponsored tx bytes (base64) the user must sign verbatim, plus
// the sponsored tx digest to echo back to /execute.
export const request_sponsorship = async (opts: {
  kind_bytes_b64: string
  sender: string
}): Promise<SponsorResponse> => {
  const req: SponsorRequest = {
    network: NETWORK,
    transactionKindBytes: opts.kind_bytes_b64,
    sender: opts.sender,
  }
  return post_json<SponsorResponse>('/sponsor', req)
}

// Step 4: hand the backend the user's signature over the sponsored bytes; it
// submits the tx (paying gas) and returns the executed digest.
export const execute_sponsored = async (opts: {
  digest: string
  signature: string
}): Promise<ExecuteResponse> => {
  const req: ExecuteRequest = {
    digest: opts.digest,
    signature: opts.signature,
  }
  return post_json<ExecuteResponse>('/execute', req)
}
