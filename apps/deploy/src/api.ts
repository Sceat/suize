import type {
  DeployResponse,
  DomainChallengeResponse,
  SiteInfo,
} from '@suize/shared'
import type { PaymentRequired, Output } from '@suize/pay'
import { DEPLOY_API_URL } from './config'

// ============================================================================
// The deploy backend API client. REAL fetches against the unified backend's
// `deploy` module. All wire types come from @suize/shared (the single source of
// truth, LOCKED DECISION #5); x402 V2 wire shapes from @suize/pay.
//
// PAYMENTS = x402 V2 'exact', first-party (account.move DEAD). A payment-less
// POST /deploy answers 402 with the x402 V2 PaymentRequired body; the dashboard
// builds the gasless send_funds payment (POST /build), signs it with the local
// zkLogin session, and retries with the b64 PaymentPayload in the X-PAYMENT header.
//
// Reads are OPEN. DEPLOY is authenticated BY THE PAYMENT ITSELF: the recovered payer
// IS the on-chain owner (whoever pays, owns) — there is no separate deploy-auth nonce.
// DOMAIN WRITES are CRYPTOGRAPHICALLY AUTHENTICATED: the client signs an op-bound,
// STATELESS-timestamped personal message and the backend recovers the signer (no
// client-claimed `owner`/`requester`, no nonce store).
//
//   POST   /deploy            multipart: name, site.tar + X-PAYMENT header  -> DeployResponse
//   POST   /build             { sender, outputs }                  -> { bytes } (unsigned gasless)
//   POST   /sites/:id/extend  X-PAYMENT header                     -> { siteId, digest, … }
//   GET    /sites             ?owner=<addr>                        -> SiteInfo[]
//   GET    /sites/:id                                              -> SiteInfo
//   POST   /domains?verify=0  { siteId, domain }                   -> DomainChallengeResponse (issue)
//   POST   /domains?verify=1  { siteId, domain, ts, signature }    -> DomainChallengeResponse (verify+link)
//   DELETE /domains/:domain   { ts, signature }                    -> { status }
//
// The backend module 503s when the deploy service wallet is unconfigured; we
// surface those as a typed error so the UI can show a calm "backend not ready"
// state instead of a crash (graceful empty/error states — never fake data).
// ============================================================================

export class DeployApiError extends Error {
  constructor(
    public status: number,
    public path: string,
    public detail?: string,
    /** The parsed error body, when JSON — e.g. a 402 carries the x402 PaymentRequired. */
    public body?: unknown,
  ) {
    super(`Deploy API ${path} -> ${status}${detail ? `: ${detail}` : ''}`)
    this.name = 'DeployApiError'
  }
}

// Read a JSON body if present; tolerate empty/non-JSON error bodies.
const read_body = async (res: Response): Promise<unknown> => {
  const text = await res.text()
  if (!text) return undefined
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
  let res: Response
  try {
    res = await fetch(`${DEPLOY_API_URL}${path}`, init)
  } catch (e) {
    // Network failure / backend down — a connection error, not an HTTP status.
    throw new DeployApiError(0, path, (e as Error)?.message ?? 'network error')
  }
  const body = await read_body(res)
  if (!res.ok) {
    const detail =
      typeof body === 'string'
        ? body
        : (body as { error?: string; message?: string } | undefined)?.error ??
          (body as { message?: string } | undefined)?.message
    throw new DeployApiError(res.status, path, detail, body)
  }
  return body as T
}

const json_request = <T>(path: string, method: string, body: unknown): Promise<T> =>
  request<T>(path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

// ---- Sites (READ — backend-backed; the dashboard reads detail from chain) ----

// List sites, optionally scoped to an owner address (the logged-in user).
export const fetch_sites = (owner?: string | null): Promise<SiteInfo[]> => {
  const qs = owner ? `?owner=${encodeURIComponent(owner)}` : ''
  return request<SiteInfo[]>(`/sites${qs}`)
}

// One site's detail (size, file count, linked domains, created, url, storage end).
export const fetch_site = (siteId: string): Promise<SiteInfo> =>
  request<SiteInfo>(`/sites/${encodeURIComponent(siteId)}`)

// ---- x402 V2 payment (gasless send_funds) ---------------------------------
// The backend NEVER signs an owner tx. POST /build returns the UNSIGNED gasless
// bytes; the user's LOCAL zkLogin session signs them; we assemble the X-PAYMENT
// header from the signed bytes + the challenge's accepted terms.

/** POST /build { sender, outputs } — the unsigned gasless send_funds bytes. The
 * caller signs `bytes` locally, then settles via the X-PAYMENT retry. */
export const build_payment = (sender: string, outputs: Output[]): Promise<{ bytes: string }> =>
  json_request<{ bytes: string }>('/build', 'POST', { sender, outputs })

// ---- Deploy ----------------------------------------------------------------

// POST a built static site as multipart. The deploy is AUTHENTICATED BY THE PAYMENT:
// the X-PAYMENT header carries the signed gasless payment, and the RECOVERED PAYER is
// the on-chain owner (whoever pays, owns) — there is no separate deploy-auth signature.
// When the charge gate is live the backend 402s unless the X-PAYMENT header is present.
export const deploy_site = async (args: {
  name: string
  site_tar: Blob
  /** The b64 PaymentPayload (the X-PAYMENT header value), when the gate is live. */
  payment?: string
}): Promise<DeployResponse> => {
  const form = new FormData()
  form.append('name', args.name)
  // Field name MUST be `site.tar` (the multipart key the backend reads).
  form.append('site.tar', args.site_tar, 'site.tar')
  return request<DeployResponse>('/deploy', {
    method: 'POST',
    headers: args.payment ? { 'X-PAYMENT': args.payment } : {},
    body: form,
  })
}

// ---- Storage extend (paid one-off $0.50) -----------------------------------

export interface ExtendResponse {
  siteId: string
  digest: string
  storageEndEpoch: number | null
  expiresAtMs: number | null
}

// POST /sites/:id/extend — a paid one-off Walrus-storage extend. Same x402 gate as
// a deploy (the payer must == the site owner). Carries the X-PAYMENT header.
export const extend_site = (siteId: string, payment: string): Promise<ExtendResponse> =>
  request<ExtendResponse>(`/sites/${encodeURIComponent(siteId)}/extend`, {
    method: 'POST',
    headers: { 'X-PAYMENT': payment },
  })

// ---- Deploy service wallet (admin panel) -----------------------------------

export interface DeployWalletInfo {
  /** The deploy SERVICE wallet address — pays create_site gas + Walrus-extend WAL. */
  address: string
  /** The WAL coin type the service wallet's storage payments are denominated in
   * (single source of truth = backend config.walCoinType — never hardcode it here). */
  walCoinType: string
}

// GET /deploy/wallet-address — the PUBLIC address of the deploy service wallet (+
// the WAL coin type). Read-only; the admin panel reads its SUI + WAL balances
// directly from chain. 503 when the deploy wallet is unconfigured.
export const fetch_deploy_wallet = (): Promise<DeployWalletInfo> =>
  request<DeployWalletInfo>('/deploy/wallet-address')

// ---- Domains ---------------------------------------------------------------

// ISSUE a custom-domain link challenge (verify=0 — UNAUTHENTICATED, writes nothing
// on-chain). Returns the DNS TXT ownership record + the CNAME target. No auth nonce:
// the verify step signs an op-bound STATELESS-timestamped message (the client picks ts).
export const link_domain_issue = (
  siteId: string,
  domain: string,
): Promise<DomainChallengeResponse> =>
  json_request<DomainChallengeResponse>('/domains?verify=0', 'POST', { siteId, domain })

// VERIFY + link on-chain (verify=1 — CRYPTOGRAPHICALLY AUTHENTICATED). The backend
// re-reads DNS, reports per-record status, and once both pass recovers the signer
// from `signature` (a base64 personal-message sig over
// buildDeployLinkAuthMessage(domain, siteId, ts)), requires it == Site.owner and `ts`
// within its freshness window, then runs link_domain on-chain + SSL provisioning.
export const link_domain_verify = (
  siteId: string,
  domain: string,
  ts: number,
  signature: string,
): Promise<DomainChallengeResponse> =>
  json_request<DomainChallengeResponse>('/domains?verify=1', 'POST', {
    siteId,
    domain,
    ts,
    signature,
  })

// Unlink a custom domain (CRYPTOGRAPHICALLY AUTHENTICATED — sig over
// buildDeployUnlinkAuthMessage(domain, ts); recovered signer must == Site.owner).
export const unlink_domain = (
  domain: string,
  ts: number,
  signature: string,
): Promise<{ status: string }> =>
  request<{ status: string }>(`/domains/${encodeURIComponent(domain)}`, {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ts, signature }),
  })

// ---- x402 helper: settle a 402 challenge → the X-PAYMENT header ------------
// Build the gasless payment for a PaymentRequired challenge, sign it locally, and
// assemble the b64 X-PAYMENT header. `signBytes` is the caller's local signer
// (dapp-kit useSignTransaction → { signature }) over the unsigned gasless bytes.

const b64json = (o: unknown): string =>
  btoa(unescape(encodeURIComponent(JSON.stringify(o))))

/**
 * Settle an x402 V2 PaymentRequired challenge: POST /build with the challenge's
 * single declared output, sign the gasless bytes locally, and return the b64
 * X-PAYMENT header value (+ the tx bytes, so a caller can persist the SIGNED
 * payload until consumed). `sender` is the connected zkLogin address.
 */
export const settle_challenge = async (
  challenge: PaymentRequired,
  sender: string,
  signBytes: (bytes: string) => Promise<{ signature: string }>,
): Promise<{ header: string; bytes: string }> => {
  const accepted = challenge.accepts?.[0]
  if (!accepted) throw new Error('challenge carries no payment requirement')
  const { bytes } = await build_payment(sender, accepted.extra.outputs)
  const { signature } = await signBytes(bytes)
  // Echo the challenge's payment-identifier extension so the wire stays spec-shaped.
  const payload = {
    x402Version: 2,
    accepted,
    payload: { signature, transaction: bytes },
    extensions: challenge.extensions ?? {},
  }
  return { header: b64json(payload), bytes }
}
