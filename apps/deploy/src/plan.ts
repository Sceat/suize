// ===========================================================================
// useDeploySub — the per-ACCOUNT Deploy storage plan, read straight off chain.
// ONE source of truth for "am I premium?" shared by the dashboard PlanRail, the
// per-site Storage panel, and the analytics ledger.
//
// WHO HOLDS THE PLAN: an agent deploys (and subscribes) from its SUB-ACCOUNT, so
// the $19.99/mo Deploy subscription lives on the sub-account address — NOT the
// human's main address. So this hook accepts ONE address OR several (the human's
// main + their agent sub-accounts, derived on-chain from their sites) and reports
// premium if ANY of them holds a VALID active sub.
//
// VALID, not merely active: mirrors the backend's isValidDeploySub
// (services/backend/src/deploy/subs-state.ts) — a junk-coin / underpriced /
// century-long "active" sub is NOT premium, so the UI never claims premium where
// the backend would deny the $0.10 rate + storage renewal.
//
// The Deploy merchant == the Suize treasury, resolved LIVE from `treasury@suize`
// (never hardcoded). Read-only — subscribe/cancel are agent-via-API actions.
// ===========================================================================
import { useSuiClient } from '@mysten/dapp-kit'
import { useQuery } from '@tanstack/react-query'
import {
  DEPLOY_SUB_PERIOD_MS,
  DEPLOY_SUB_PRICE_USDC,
  PACKAGE_IDS,
  USDC_TYPES,
  resolveTreasury,
} from '@suize/shared'
import { suizeSubs, type SubStatus } from '@suize/pay/subs'
import { fetch_site } from './api'
import { SUI_NETWORK } from './config'

const USDC_TYPE = USDC_TYPES[SUI_NETWORK].toLowerCase()

// Client mirror of services/backend/src/deploy/subs-state.ts `isValidDeploySub`:
// premium requires a sub that pays in USDC, at least one Deploy period's price, on a
// period no longer than one Deploy period. Keeps the UI honest with the backend gate.
const isValidDeploySub = (s: SubStatus): boolean =>
  s.active &&
  (s.coinType ?? '').toLowerCase() === USDC_TYPE &&
  s.amount >= DEPLOY_SUB_PRICE_USDC &&
  s.periodMs > 0 &&
  s.periodMs <= DEPLOY_SUB_PERIOD_MS

export interface DeploySub {
  /** The first VALID active plan across the given owners, or null on the free tier. */
  sub: SubStatus | null
  /** True iff a valid active plan was found (premium). */
  active: boolean
  /** True while the plan read is still settling (callers stay quiet, not "Free"). */
  loading: boolean
}

/** Build the list of plan owners for a human: their main address PLUS the distinct
 * agent sub-accounts that own their sites (the `viaAgent` owners). The plan lives on
 * the sub-account, so the main alone would always read "Free". */
export const planOwnersOf = (
  main: string | null | undefined,
  sites: { owner: string; viaAgent?: boolean }[],
): string[] => {
  const set = new Set<string>()
  if (main) set.add(main)
  for (const s of sites) if (s.viaAgent && s.owner) set.add(s.owner)
  return [...set]
}

export const useDeploySub = (
  owners: string | readonly string[] | null | undefined,
): DeploySub => {
  const client = useSuiClient()
  const list = (Array.isArray(owners) ? owners : owners ? [owners] : [])
    .filter(Boolean)
    .map(String)

  const treasuryQ = useQuery({
    queryKey: ['suize-treasury', SUI_NETWORK],
    queryFn: () => resolveTreasury(client),
    staleTime: Infinity,
  })
  const merchant = treasuryQ.data ?? null

  const subQ = useQuery({
    // Sorted owners → callers passing the same set share one fetch + cache.
    queryKey: ['deploy-sub', merchant, [...list].sort()],
    enabled: Boolean(merchant) && list.length > 0,
    queryFn: async (): Promise<SubStatus | null> => {
      const api = suizeSubs({
        merchant: merchant as string,
        network: SUI_NETWORK,
        subsPackage: PACKAGE_IDS.SUBS.PACKAGE,
      })
      const all = (await Promise.all(list.map((o) => api.activeFor(o)))).flat()
      return all.find(isValidDeploySub) ?? null
    },
    staleTime: 30_000,
    retry: false,
  })

  const sub = subQ.data ?? null
  return {
    sub,
    active: !!sub, // sub is already validity-filtered
    loading:
      treasuryQ.isLoading || (Boolean(merchant) && list.length > 0 && subQ.isLoading),
  }
}

// A site's live Walrus storage-end wall-clock (ms), or null while unresolved /
// unknown. Backend-backed (GET /sites/:id computes it from the blobs' end epoch),
// best-effort, react-query-cached under the SAME key the dossier uses → one fetch
// shared between a site's card and its detail page. The card still renders from
// chain without it (a backend blip just hides the expiry line).
export const useSiteExpiry = (siteId: string): number | null => {
  const q = useQuery({
    queryKey: ['site-storage', siteId],
    queryFn: () => fetch_site(siteId),
    staleTime: 60_000,
    retry: false,
  })
  return q.data?.expiresAtMs ?? null
}
