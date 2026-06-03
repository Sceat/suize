import { useEffect, useRef } from 'react'
import * as e05 from './crash-e05'
import type { CrashActions, CrashData, CrashHost } from './crash-host'

// ============================================================================
// <CrashE05> — the thin React bridge that mounts the PORTED e05 design (the
// verbatim DOM + scoped .e05 CSS + canvas chart from crash-e05.ts / crash-
// base.ts) into a ref'd div, and keeps it fed with live data.
// ----------------------------------------------------------------------------
// App.tsx owns ALL the data/gasless LOGIC; it passes a fresh `data` snapshot
// and stable `actions` every render. We hold ONE host object whose `.data` we
// overwrite in place each render (the e05 rAF reads host.data live, so the
// chart + count-ups + footer stay in sync without re-mounting). The design is
// mounted ONCE under a `.e05` root and torn down on unmount.
// ============================================================================
export function CrashE05({
  data,
  actions,
}: {
  data: CrashData
  actions: CrashActions
}) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  // The single host object the ported design reads from. `data` is replaced in
  // place each render; `actions` is stable (App memoizes the callbacks).
  const hostRef = useRef<CrashHost>({ data, actions })
  // keep the host pointing at the freshest snapshot BEFORE paint so the rAF
  // never reads a stale frame.
  hostRef.current.data = data
  hostRef.current.actions = actions

  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const teardown = e05.mount(root, hostRef.current)
    return () => teardown()
    // mount ONCE — the host object is mutated in place for live updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return <div ref={rootRef} className="e05" />
}
