import { useEffect, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchFeed, fetchSlots, fetchStats, fetchRankings, recordVisit } from '../api'
import { useNow } from '../ui'
import type { DirectoryData } from '../variants/shared'
import { stubData } from '../variants/stub'
import { V3 } from '../variants/V3'

/** `?stub=1` renders preview data so the populated layout can be eyeballed while testnet
 *  has no third-party merchants yet. The live site (no param) always shows real chain data. */
const STUB = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('stub') === '1'

// ============================================================================
// Suize Agents — the directory application (agents.suize.io). Fetches the live
// on-chain projections (feed / slots / rankings / stats), ticks one shared clock,
// records a single visit per session, and renders the directory UI. Reads ONLY —
// the bid + creative-update writes are agent-only (the on-chain auction via
// llms.txt), never a human button on this page. Real on-chain data; empty states
// are first-class (a fresh testnet shows them until merchants settle).
// ============================================================================

const VISIT_FLAG = 'suize-agents-visited'

export function App() {
  const now = useNow()
  const stub = useMemo(() => (STUB ? stubData() : null), [])

  useEffect(() => {
    if (STUB) return
    try {
      if (sessionStorage.getItem(VISIT_FLAG)) return
      sessionStorage.setItem(VISIT_FLAG, '1')
    } catch {
      /* private mode — record the visit anyway */
    }
    recordVisit()
  }, [])

  const feed = useQuery({ queryKey: ['feed'], queryFn: () => fetchFeed(50), refetchInterval: 3_000, enabled: !STUB })
  const slots = useQuery({ queryKey: ['slots'], queryFn: fetchSlots, refetchInterval: 4_000, enabled: !STUB })
  const rankings = useQuery({ queryKey: ['rankings'], queryFn: fetchRankings, refetchInterval: 8_000, enabled: !STUB })
  const stats = useQuery({ queryKey: ['stats'], queryFn: fetchStats, refetchInterval: 15_000, enabled: !STUB })

  const data: DirectoryData = stub ?? {
    slots: slots.data?.slots ?? [],
    cheapest: slots.data?.cheapest,
    rankings: rankings.data?.merchants ?? [],
    feed: feed.data?.payments ?? [],
    visitorsToday: stats.data?.visitorsToday ?? null,
    loading: { slots: slots.isLoading, rankings: rankings.isLoading, feed: feed.isLoading },
  }

  return <V3 data={data} now={now} />
}
