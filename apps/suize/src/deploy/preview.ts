// =============================================================================
// Site og-preview metadata for the dashboard cards, served by the deploy worker
// (GET /preview?site=<id> — parses the site's own index.html server-side, since
// the browser can't fetch site HTML cross-origin). Module-level cache: a card
// re-render never refetches; a miss/outage renders the card without a cut.
// =============================================================================

import { DEPLOY_API } from '../config'

export interface SitePreview {
  title: string | null
  description: string | null
  image: string | null
  favicon: string | null
  sealed?: boolean
  lapsed?: boolean
}

const cache = new Map<string, Promise<SitePreview | null>>()

export function fetchSitePreview(siteId: string): Promise<SitePreview | null> {
  let p = cache.get(siteId)
  if (!p) {
    p = fetch(`${DEPLOY_API}/preview?site=${siteId}`)
      .then((r) => (r.ok ? (r.json() as Promise<SitePreview>) : null))
      .catch(() => null)
    cache.set(siteId, p)
  }
  return p
}
