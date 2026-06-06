import type { SponsorResponse, ExecuteResponse } from '@suize/shared'
import { ws_sponsor, ws_execute } from './ws'

// ============================================================================
// Gasless sponsorship client — rides the unified backend's Enoki-verified
// WebSocket (the SAME single-socket transport the Suize wallet uses).
// ----------------------------------------------------------------------------
// zkLogin (Enoki/Google) users hold a fresh Sui address with NO SUI for gas, so
// a self-paid bet aborts with "No valid gas coins". The backend (which holds the
// Enoki PRIVATE key) sponsors gas for the seven allowlisted router::* targets.
//
// This used to be HTTP (POST /sponsor + /execute). It now rides the authenticated
// WebSocket (ws.ts): the socket is opened on sign-in and authenticated AT the
// connection via a personal-message signature, after which the backend PINS the
// sponsor `sender` to the verified socket address — a socket for A can never
// sponsor for B. The two RPCs are:
//
//   sponsorRequest  { network, transactionKindBytes, sender } -> { bytes, digest }
//   executeRequest  { digest, signature }                     -> { digest }
//
// The flow per gasless write (UNCHANGED — same shape as the old HTTP path, so
// App.tsx's signAndExecute wrapper calls these two functions verbatim):
//   1. build the tx KIND bytes (onlyTransactionKind) + base64 them
//   2. sponsor -> the backend wraps them with a sponsor gas budget, returns the
//      FULL sponsored tx `bytes` (which the user must sign verbatim) + a `digest`
//   3. the user signs the EXACT sponsored `bytes` with their zkLogin session
//   4. execute the (digest, signature) pair -> the backend submits + pays gas
//
// We NEVER fall back to self-pay on failure — a zkLogin user has no gas, so a
// silent fallback would just fail confusingly downstream. The WS transport
// surfaces a clear "sponsorship unavailable" / real backend error instead, which
// App.tsx routes to set_error.
// ============================================================================

// Step 2: ask the backend to sponsor the given tx KIND bytes for `sender`.
// Returns the FULL sponsored tx bytes (base64) the user must sign verbatim, plus
// the sponsored tx digest to echo back to execute.
export const request_sponsorship = async (opts: {
  kind_bytes_b64: string
  sender: string
}): Promise<SponsorResponse> => {
  return ws_sponsor({
    transactionKindBytes: opts.kind_bytes_b64,
    sender: opts.sender,
  })
}

// Step 4: hand the backend the user's signature over the sponsored bytes; it
// submits the tx (paying gas) and returns the executed digest.
export const execute_sponsored = async (opts: {
  digest: string
  signature: string
}): Promise<ExecuteResponse> => {
  return ws_execute({ digest: opts.digest, signature: opts.signature })
}
