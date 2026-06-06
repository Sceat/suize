import type {
  DeployResponse,
  DomainChallengeResponse,
  SiteInfo,
} from '@suize/shared'
import { DEPLOY_API_URL } from './config'

// ============================================================================
// The deploy backend API client. REAL fetches against the unified backend's
// `deploy` module (docs/deploy/SPEC.md §7). All wire types come from
// @suize/shared — the single source of truth (LOCKED DECISION #5). The route is
// OPEN (no auth); `owner` is best-effort attribution only.
//
//   POST   /deploy            multipart: name, site.tar, optional owner -> DeployResponse
//   GET    /sites             ?owner=<addr>                             -> SiteInfo[]
//   GET    /sites/:id                                                   -> SiteInfo
//   POST   /domains           { siteId, domain }                        -> DomainChallengeResponse
//   DELETE /domains/:domain                                             -> { status }
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
    throw new DeployApiError(res.status, path, detail)
  }
  return body as T
}

// ---- Sites --------------------------------------------------------------

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
// the picked folder — see pack.ts); `name` is the human label; `owner` is
// optional best-effort attribution (the logged-in address).
export const deploy_site = async (args: {
  name: string
  site_tar: Blob
  owner?: string | null
}): Promise<DeployResponse> => {
  const form = new FormData()
  form.append('name', args.name)
  // Field name MUST be `site.tar` per SPEC §2/§7 (multipart key the backend reads).
  form.append('site.tar', args.site_tar, 'site.tar')
  if (args.owner) form.append('owner', args.owner)
  return request<DeployResponse>('/deploy', {
    method: 'POST',
    body: form,
  })
}

// ---- Domains ------------------------------------------------------------

// Request a custom-domain link. Returns the DNS TXT ownership challenge + the
// CNAME target the user must add; the backend verifies the TXT then calls
// link_domain on-chain (the `status` walks pending -> verified -> linked).
export const link_domain = (
  siteId: string,
  domain: string,
): Promise<DomainChallengeResponse> =>
  request<DomainChallengeResponse>('/domains', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ siteId, domain }),
  })

// Unlink a custom domain. The backend calls unlink_domain on-chain. Returns the
// resulting status (e.g. { status: 'unlinked' }) — we don't depend on the exact
// shape, only that a 2xx means success.
export const unlink_domain = (
  domain: string,
): Promise<{ status: string }> =>
  request<{ status: string }>(`/domains/${encodeURIComponent(domain)}`, {
    method: 'DELETE',
  })
