// The front page's single live-data hook. Fetches the real gallery + counters
// once on mount (and on a slow refresh), exposing a loading flag so the UI shows
// an honest empty/loading state rather than fabricated rows.

import { useEffect, useState } from 'react'
import { fetchLive, type LiveData } from './live'

export type LiveState =
  | { status: 'loading'; data: null }
  | { status: 'ready'; data: LiveData }
  | { status: 'error'; data: null }

/** Refresh cadence for the live feed — gentle; the chain doesn't move fast. */
const REFRESH_MS = 60_000

export function useLive(): LiveState {
  const [state, setState] = useState<LiveState>({ status: 'loading', data: null })

  useEffect(() => {
    let alive = true
    const load = () => {
      fetchLive()
        .then((data) => {
          if (alive) setState({ status: 'ready', data })
        })
        .catch(() => {
          if (alive) setState((prev) => (prev.status === 'ready' ? prev : { status: 'error', data: null }))
        })
    }
    load()
    const id = window.setInterval(load, REFRESH_MS)
    return () => {
      alive = false
      window.clearInterval(id)
    }
  }, [])

  return state
}
