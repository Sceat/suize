// ===========================================================================
// useSuizeHandle — resolve a signed-in address to its `<name>@suize` handle for
// display. Wraps resolveSuizeHandle (chain.ts) in a react-query read against
// dapp-kit's one testnet client (useSuiClient), so it shares the app's RPC pool
// and cache. Presentation only — the caller renders `handle ?? fmt_id(address)`,
// so a missing handle / RPC hiccup degrades to the hex address, never blank.
//
// A localStorage fast-path (suize:handle:<addr>) seeds the query so a returning
// user sees their handle instantly on reload, before the RPC settles — mirrors
// the wallet's pattern. The RPC result is authoritative and overwrites it.
// ===========================================================================
import { useSuiClient } from '@mysten/dapp-kit'
import { useQuery } from '@tanstack/react-query'
import { resolveSuizeHandle } from './chain'

const cacheKey = (address: string): string =>
  `suize:handle:${address.toLowerCase()}`

const readCache = (address: string): string | null => {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage.getItem(cacheKey(address))
  } catch {
    return null
  }
}

const writeCache = (address: string, handle: string | null): void => {
  if (typeof window === 'undefined') return
  try {
    if (handle) window.localStorage.setItem(cacheKey(address), handle)
    else window.localStorage.removeItem(cacheKey(address))
  } catch {
    // storage unavailable (private mode / quota) — fine, the RPC still resolves
  }
}

// The `<name>@suize` handle for `address`, or null while unresolved / handleless.
// Returns null when address is falsy (signed out).
export const useSuizeHandle = (
  address: string | null | undefined,
): string | null => {
  const client = useSuiClient()

  const q = useQuery({
    queryKey: ['suins-handle', address],
    enabled: !!address,
    retry: false,
    // Seed from the last-known handle so a returning user never flickers to hex.
    initialData: () => (address ? (readCache(address) ?? undefined) : undefined),
    queryFn: async () => {
      const handle = await resolveSuizeHandle(address as string, client)
      writeCache(address as string, handle)
      // react-query forbids `undefined` as data; null = "resolved, no handle".
      return handle
    },
  })

  return q.data ?? null
}
