// =============================================================================
// A minimal hash router — enough for the three viewer surfaces without pulling
// in a routing dependency. The landing (App's default) renders when no viewer
// route matches, so the front page is untouched.
//   #/sites                    → the connected wallet's dashboard (My sites)
//   #/view/<siteId>            → the sealed-site viewer (reads the on-chain Site)
//   #/access/<allowlistId>     → the viewer-list manager
//   #/view-dev/<manifestBlobId>→ DEV-ONLY: load straight from a manifest blob id
//                                 (skips the Site read; for the E2E fixture)
//   #/publish                  → DEV-ONLY: operator tool to publish a Move package
//                                 with the connected wallet (never in prod builds)
// =============================================================================

import { useSyncExternalStore } from 'react'

export type Route =
  | { kind: 'home' }
  | { kind: 'sites' }
  | { kind: 'view'; id: string }
  | { kind: 'view-dev'; id: string }
  | { kind: 'access'; id: string }
  | { kind: 'publish' }

export function parseHash(hash: string): Route {
  const h = hash.replace(/^#/, '')
  if (/^\/sites(?:[/?#]|$)/.test(h)) return { kind: 'sites' }
  if (/^\/publish(?:[/?#]|$)/.test(h)) {
    // Dev-only operator tool — never resolves in a production build.
    return import.meta.env.DEV ? { kind: 'publish' } : { kind: 'home' }
  }
  const m = h.match(/^\/(view-dev|view|access)\/([^/?#]+)/)
  if (!m) return { kind: 'home' }
  const id = decodeURIComponent(m[2])
  if (m[1] === 'view-dev') {
    // Dev-only entry — never resolves in a production build.
    return import.meta.env.DEV ? { kind: 'view-dev', id } : { kind: 'home' }
  }
  if (m[1] === 'access') return { kind: 'access', id }
  return { kind: 'view', id }
}

const subscribe = (cb: () => void) => {
  window.addEventListener('hashchange', cb)
  return () => window.removeEventListener('hashchange', cb)
}

/** The current route, re-rendering on every hash change. */
export function useHashRoute(): Route {
  const hash = useSyncExternalStore(
    subscribe,
    () => window.location.hash,
    () => '',
  )
  return parseHash(hash)
}

/** Navigate by setting the hash (used by the viewer's "manage" link). */
export function navigate(hash: string): void {
  window.location.hash = hash
}
