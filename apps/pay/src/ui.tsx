import { useEffect, useState, type ReactNode } from 'react'
import { useSuiClient } from '@mysten/dapp-kit'
import { useAuth } from './auth'
import { reverseResolve, type ReverseClient } from './suins'
import { BASE_PATH } from './config'

// Shared UI atoms for the three screens. Everything text-only is rendered via
// React's normal escaping — NO merchant-supplied value ever lands in markup.

// Session-lived reverse-name cache — the payer/merchant lookups repeat across
// re-renders and screens; ONE RPC per address. RPC failures are NOT cached
// (a later mount retries); a definitive "no name" is.
const name_cache = new Map<string, string | null>()

/** Reverse-resolve an address to its display handle (e.g. "sceat@suize" —
 * see suins.ts reverseResolve). Null while pending or when no SuiNS name
 * exists — callers fall back to the short hex, never block on this. */
export function useReverseName(address: string | null): string | null {
  const client = useSuiClient()
  const [name, setName] = useState<string | null>(() =>
    address ? (name_cache.get(address) ?? null) : null,
  )
  useEffect(() => {
    if (!address) {
      setName(null)
      return
    }
    if (name_cache.has(address)) {
      setName(name_cache.get(address) ?? null)
      return
    }
    let alive = true
    reverseResolve(client as unknown as ReverseClient, address)
      .then(resolved => {
        name_cache.set(address, resolved)
        if (alive) setName(resolved)
      })
      .catch(() => {
        if (alive) setName(null) // chain unreadable — hex fallback, retry next mount
      })
    return () => {
      alive = false
    }
  }, [address, client])
  return name
}

export function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="shell">
      <header className="top">
        <a className="wordmark" href={BASE_PATH}>
          Suize <span>Pay</span>
        </a>
        <SessionBadge />
      </header>
      {children}
      <footer className="foot">Built on Sui · payments settle in USDC on-chain</footer>
    </div>
  )
}

function SessionBadge() {
  const { address, wallet_label, sign_out } = useAuth()
  const name = useReverseName(address)
  if (!address) return null
  return (
    <div className="top-session">
      <span>{wallet_label}</span>
      {/* No-hex law: the handle whenever one resolves; hex only when the
          address truly has no name (nothing else to show). */}
      {name ? <span className="handle">{name}</span> : <span className="mono">{shortAddr(address)}</span>}
      <button className="linklike" onClick={sign_out}>
        Switch account
      </button>
    </div>
  )
}

export const shortAddr = (a: string): string =>
  a.length > 14 ? `${a.slice(0, 8)}…${a.slice(-6)}` : a

// (PayPage renders its own auth pair — the "Pay with Suize" Google sign-in
// (pay.suize.io's OWN Enoki zkLogin) + the ConnectModal. See routes/PayPage.tsx.)

export function Busy({ children }: { children: ReactNode }) {
  return (
    <div className="status-line">
      <span className="spinner" aria-hidden />
      <span>{children}</span>
    </div>
  )
}
