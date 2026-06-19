import type { SiteInfo } from '@suize/shared'
import { DEPLOY_API_URL } from './config'

// ============================================================================
// The deploy backend API client — the small READ surface the dashboard still
// uses. The console is a READ-ONLY human view: every WRITE (deploy / extend /
// subscribe / domain link+unlink) is the AGENT's job through the Deploy HTTP API
// directly (documented in public/llms.txt), never through this client. Site
// listing + provenance are read straight from chain (chain.ts); this file only
// fetches the two backend-COMPUTED reads chain can't give cheaply:
//
//   GET /sites/:id              -> SiteInfo (incl. expiresAtMs / storageEndEpoch)
//   GET /deploy/wallet-address  -> DeployWalletInfo (admin panel)
//
// The backend module 503s when the deploy service wallet is unconfigured; we
// surface those as a typed error so the UI shows a calm "backend not ready" state
// instead of a crash (graceful empty/error states — never fake data).
// ============================================================================

export class DeployApiError extends Error {
  constructor(
    public status: number,
    public path: string,
    public detail?: string,
    /** The parsed error body, when JSON. */
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

// One site's detail (size, file count, linked domains, created, url, storage end).
export const fetch_site = (siteId: string): Promise<SiteInfo> =>
  request<SiteInfo>(`/sites/${encodeURIComponent(siteId)}`)

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
