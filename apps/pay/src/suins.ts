// ============================================================================
// Suize handle (SuiNS) resolution for pay-links — CLIENT-SIDE, on-chain.
// Handles are `<label>@suize` = `<label>.suize.sui` LEAF subnames (issued by
// services/backend/src/handle; parent domain suize.sui). A pay-link carries
// `?to=<handle>` (preferred over the raw `?payTo=0x…` protocol fallback); this
// module parses the handle and resolves it to its target address via the
// fullnode's suix_resolveNameServiceAddress — resolution is the PAGE's job
// (the backend stays stateless), and an unresolvable handle is a HARD error,
// never a silent fallback. The REVERSE direction (address → primary SuiNS
// name, suix_resolveNameServiceNames) powers the no-hex display law: anywhere
// an address has a name, the page shows the handle instead of hex.
// ============================================================================

import { SUI_ADDRESS_RE } from './config'

// Bare-label policy mirrors the issuer (services/backend/src/handle/index.ts):
// lowercase [a-z0-9-], 3–20 chars, no leading/trailing hyphen.
const LABEL_RE = /^[a-z0-9][a-z0-9-]{1,18}[a-z0-9]$/

export type ParsedHandle = {
  /** Display form — `<label>@suize` (rendered PROMINENTLY on the page). */
  display: string
  /** Dotted SuiNS name — `<label>.suize.sui` (what the RPC resolves). */
  dotted: string
}

/** Canonicalize the three equivalent spellings of a Suize handle — `label`,
 * `label@suize`, `label.suize.sui`. Null = not a valid Suize handle. */
export const parseHandle = (raw: string): ParsedHandle | null => {
  const v = raw.trim().toLowerCase()
  const label = v.endsWith('@suize')
    ? v.slice(0, -'@suize'.length)
    : v.endsWith('.suize.sui')
      ? v.slice(0, -'.suize.sui'.length)
      : v
  if (!LABEL_RE.test(label)) return null
  return { display: `${label}@suize`, dotted: `${label}.suize.sui` }
}

// Structural client slice (same pattern as rail.ts) — dapp-kit's useSuiClient
// is the JSON-RPC client, whose resolveNameServiceAddress answers SuiNS
// forward lookups (the same record the backend's leaf mint targets).
export type NameClient = {
  resolveNameServiceAddress: (args: { name: string }) => Promise<string | null>
}

/** Resolve a parsed handle to its on-chain target address. Null = the handle
 * does not exist / has no target (a definitive NO). THROWS on an RPC failure
 * so the caller can tell "no such handle" from "chain unreadable — retry". */
export const resolveHandle = async (
  client: NameClient,
  handle: ParsedHandle,
): Promise<string | null> => {
  const address = await client.resolveNameServiceAddress({ name: handle.dotted })
  return address && SUI_ADDRESS_RE.test(address) ? address : null
}

// Structural REVERSE slice — suix_resolveNameServiceNames via the same
// dapp-kit client; data[0] is the address's primary/default name (the SDK
// returns dotted form by default, e.g. "sceat.suize.sui").
export type ReverseClient = {
  resolveNameServiceNames: (args: { address: string }) => Promise<{ data: string[] }>
}

/** Reverse-resolve an address to its primary SuiNS name in DISPLAY form —
 * `<label>.suize.sui` → `<label>@suize`, any other SuiNS name as-is. Null =
 * the address has no name (a definitive NO — the caller falls back to the
 * short hex). THROWS on an RPC failure (display-only sugar: callers show the
 * hex and may retry, they never hard-stop on it). */
export const reverseResolve = async (
  client: ReverseClient,
  address: string,
): Promise<string | null> => {
  const { data } = await client.resolveNameServiceNames({ address })
  const name = data?.[0]?.trim()
  if (!name) return null
  return parseHandle(name)?.display ?? name
}
