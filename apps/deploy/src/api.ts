import type {
  DeployChargeRequest,
  DeployChargeResponse,
  DeployNonceResponse,
  DeployQuoteResponse,
  DeployRenewalLinkRequest,
  DeployRenewalResponse,
  DeployRenewalUnlinkRequest,
  DeployResponse,
  DomainChallengeResponse,
  ExecuteRequest,
  ExecuteResponse,
  SiteInfo,
  SponsorResponse,
} from '@suize/shared'
import { DEPLOY_API_URL } from './config'

// ============================================================================
// The deploy backend API client. REAL fetches against the unified backend's
// `deploy` module (docs/deploy/SPEC.md §7). All wire types come from
// @suize/shared — the single source of truth (LOCKED DECISION #5).
//
// Reads are OPEN; ALL writes — deploy + domain ops — are now CRYPTOGRAPHICALLY
// AUTHENTICATED: the client signs an op-bound, nonce-fresh personal message and the
// backend recovers the signer address (no client-claimed `owner`/`requester` — those
// fields are gone). The deploy/verify/unlink calls carry { nonce, signature } only.
//
//   POST   /deploy            multipart: name, site.tar, nonce, signature
//                             [+ chargeDigest when the charge gate is live]   -> DeployResponse
//   GET    /deploy/quote                                                -> DeployQuoteResponse (503 = gate off)
//   POST   /deploy/charge     { account, sender }                       -> DeployChargeResponse (sponsored bytes)
//   POST   /execute           { digest, signature }                     -> ExecuteResponse
//   POST   /deploy/subscribe  { account, sender }                       -> { bytes, digest } (sponsored bytes)
//   POST   /deploy/renewal    DeployRenewalLinkRequest                  -> DeployRenewalResponse
//   DELETE /deploy/renewal    DeployRenewalUnlinkRequest                -> DeployRenewalResponse
//   GET    /sites             ?owner=<addr>                             -> SiteInfo[]
//   GET    /sites/:id                                                   -> SiteInfo
//   GET    /auth/nonce                                                  -> { nonce }
//   POST   /domains?verify=0  { siteId, domain }                        -> DomainChallengeResponse (issue)
//   POST   /domains?verify=1  { siteId, domain, nonce, signature }      -> DomainChallengeResponse (verify+link)
//   DELETE /domains/:domain   { nonce, signature }                      -> { status }
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
    /** The parsed error body, when JSON — e.g. a 402 carries { error, quote }. */
    public body?: unknown,
  ) {
    super(
      `Deploy API ${path} -> ${status}${detail ? `: ${detail}` : ''}`,
    )
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

const request = async <T>(
  path: string,
  init?: RequestInit,
): Promise<T> => {
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

// ---- Sites (READ — backend-backed, NO LONGER used by the dashboard) -------
// The dashboard reads the LIST + DETAIL directly from chain (see src/chain.ts)
// so browsing works with the backend offline. These backend readers are kept
// for reference / non-dashboard callers; the GET /sites endpoints still exist.

// List sites, optionally scoped to an owner address (the logged-in user). The
// backend reads SiteCreated events; an unconfigured backend 503s (surfaced as
// DeployApiError so the UI shows "backend not ready", never fake rows).
export const fetch_sites = (owner?: string | null): Promise<SiteInfo[]> => {
  const qs = owner ? `?owner=${encodeURIComponent(owner)}` : ''
  return request<SiteInfo[]>(`/sites${qs}`)
}

// One site's detail (size, file count, linked domains, created, url).
export const fetch_site = (siteId: string): Promise<SiteInfo> =>
  request<SiteInfo>(`/sites/${encodeURIComponent(siteId)}`)

// ---- Deploy -------------------------------------------------------------

// POST a built static site as multipart. The backend unpacks the tar, uploads
// to Walrus, mints a fresh Site, and returns { siteId, subdomain, url, version,
// digest }. `site_tar` is the packed bundle (a .tar Blob built client-side from
// the picked folder — see pack.ts); `name` is the human label.
//
// The deploy is CRYPTOGRAPHICALLY AUTHENTICATED: the caller fetches a fresh
// single-use nonce (get_nonce), signs buildDeployAuthMessage(nonce) as a base64
// personal-message signature, and passes { nonce, signature } here. The backend
// recovers the signer and uses it AS the on-chain `owner` — there is NO
// client-claimed `owner` (that field is gone) and NO anonymous deploy path; an
// unsigned/invalid request is rejected with 401.
//
// When the CHARGE↔Deploy join is live the backend 402s unless the multipart also
// carries `chargeDigest` — the EXECUTED $0.50 `charge` tx digest the caller
// settled via POST /deploy/charge → POST /execute. A consumed digest 409s
// (single-use); the caller then clears it and pays a fresh charge.
export const deploy_site = async (args: {
  name: string
  site_tar: Blob
  nonce: string
  signature: string
  charge_digest?: string
}): Promise<DeployResponse> => {
  const form = new FormData()
  form.append('name', args.name)
  // Field name MUST be `site.tar` per SPEC §2/§7 (multipart key the backend reads).
  form.append('site.tar', args.site_tar, 'site.tar')
  form.append('nonce', args.nonce)
  form.append('signature', args.signature)
  if (args.charge_digest) form.append('chargeDigest', args.charge_digest)
  return request<DeployResponse>('/deploy', {
    method: 'POST',
    body: form,
  })
}

// ---- CHARGE↔Deploy join (the $0.50 paid deploy + the storage subscription) ---
// The backend NEVER signs an owner tx: it builds + Enoki-sponsors the rail PTB,
// the user's LOCAL zkLogin session signs the returned `bytes` VERBATIM as a
// TRANSACTION (dapp-kit useSignTransaction — not a personal message), and the
// { digest, signature } pair goes to POST /execute. Non-custodial law.

const json_request = <T>(path: string, method: string, body: unknown): Promise<T> =>
  request<T>(path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

// GET /deploy/quote — the 402-shaped price of one deploy. Returns null when the
// charge gate is OFF (the backend 503s with a precise reason until the rail
// package + merchant are pinned) — the deploy then runs un-gated. Any other
// failure (backend offline, rate-limit) also resolves null: the gate state is
// then unknown and the reactive 402 on POST /deploy is the authority.
export const get_deploy_quote = async (): Promise<DeployQuoteResponse | null> => {
  try {
    return await request<DeployQuoteResponse>('/deploy/quote')
  } catch (e) {
    if (e instanceof DeployApiError) return null
    throw e
  }
}

// POST /deploy/charge — build + sponsor the $0.50 `charge` PTB for the caller's
// rail Account. `account` is the shared Account<USDC> object id; `sender` the
// connected zkLogin owner address (must equal Account.owner — charge is
// owner-only). The returned base64 `bytes` are signed locally, then executed.
export const build_deploy_charge = (
  body: DeployChargeRequest,
): Promise<DeployChargeResponse> =>
  json_request<DeployChargeResponse>('/deploy/charge', 'POST', body)

// POST /execute — submit { digest, signature } for sponsored bytes the caller
// signed locally (the charge OR the subscription). Returns the EXECUTED digest —
// for a charge, that executed digest is the `chargeDigest` POST /deploy verifies.
export const execute_sponsored = (body: ExecuteRequest): Promise<ExecuteResponse> =>
  json_request<ExecuteResponse>('/execute', 'POST', body)

// POST /deploy/account — build + sponsor the rail `create_account<USDC>` for a
// zkLogin user with NO rail Account yet (the CLI can't sign for a zkLogin
// address; create_account sets owner = sender, so the user's own session must be
// the sender). Same local-sign + /execute settlement; the executed tx emits
// AccountCreated whose `account_id` becomes the rail Account.
export const build_deploy_account = (body: {
  sender: string
}): Promise<SponsorResponse> =>
  json_request<SponsorResponse>('/deploy/account', 'POST', body)

// POST /deploy/subscribe — build + sponsor the rail `create_subscription`
// ($19.99/mo to the Deploy merchant) for the caller's Account. Same local-sign +
// /execute settlement as the charge; the executed tx emits SubscriptionCreated
// whose `sub_key` feeds the renewal link below.
export const build_deploy_subscribe = (body: {
  account: string
  sender: string
}): Promise<SponsorResponse> =>
  json_request<SponsorResponse>('/deploy/subscribe', 'POST', body)

// POST /deploy/renewal — link a settled subscription (accountId + subKey) to this
// site's Walrus auto-renewal. Authority = a personal-message signature over
// buildDeployRenewalLinkAuthMessage(siteId, accountId, subKey, nonce); the
// backend recovers the signer, requires it == Account.owner ON-CHAIN, then
// cap-signs renewal_registry::link_renewal.
export const link_renewal = (
  body: DeployRenewalLinkRequest,
): Promise<DeployRenewalResponse> =>
  json_request<DeployRenewalResponse>('/deploy/renewal', 'POST', body)

// DELETE /deploy/renewal — unlink (signature over the unlink message; accepted
// from the Account.owner or the Site.owner).
export const unlink_renewal = (
  body: DeployRenewalUnlinkRequest,
): Promise<DeployRenewalResponse> =>
  json_request<DeployRenewalResponse>('/deploy/renewal', 'DELETE', body)

// ---- Auth nonce ---------------------------------------------------------

// Fetch a fresh single-use, short-TTL nonce to bind into the signed message for
// a domain write. The backend burns the nonce on each verify, so every signed
// op needs its own nonce — fetch one immediately before signing.
export const get_nonce = (): Promise<DeployNonceResponse> =>
  request<DeployNonceResponse>('/auth/nonce')

// ---- Domains ------------------------------------------------------------

// ISSUE a custom-domain link challenge (verify=0 — UNAUTHENTICATED, writes
// nothing on-chain). Returns the DNS TXT ownership record + the CNAME target the
// user must add, plus a fresh single-use `nonce` to sign for the verify step.
export const link_domain_issue = (
  siteId: string,
  domain: string,
): Promise<DomainChallengeResponse> =>
  request<DomainChallengeResponse>('/domains?verify=0', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ siteId, domain }),
  })

// VERIFY + link on-chain (verify=1 — CRYPTOGRAPHICALLY AUTHENTICATED). The
// backend re-reads DNS, reports per-record status (`txtOk`/`cnameOk`), and once
// both pass recovers the signer from `signature` (a base64 personal-message sig
// over buildDeployLinkAuthMessage(domain, siteId, nonce)), requires it to equal
// Site.owner, then runs link_domain on-chain + SSL provisioning (`sslStatus`).
// There is NO client-claimed `requester` — the recovered signer IS the requester.
export const link_domain_verify = (
  siteId: string,
  domain: string,
  nonce: string,
  signature: string,
): Promise<DomainChallengeResponse> =>
  request<DomainChallengeResponse>('/domains?verify=1', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ siteId, domain, nonce, signature }),
  })

// Unlink a custom domain (CRYPTOGRAPHICALLY AUTHENTICATED). The backend recovers
// the signer from `signature` (base64 personal-message sig over
// buildDeployUnlinkAuthMessage(domain, nonce)), requires it to equal the
// Site.owner the domain points at, then calls unlink_domain on-chain. Returns the
// resulting status; we depend only on a 2xx meaning success. No `requester`.
export const unlink_domain = (
  domain: string,
  nonce: string,
  signature: string,
): Promise<{ status: string }> =>
  request<{ status: string }>(`/domains/${encodeURIComponent(domain)}`, {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ nonce, signature }),
  })
