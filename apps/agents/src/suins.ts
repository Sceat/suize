// ============================================================================
// Suize handle (SuiNS) resolution — CLIENT-SIDE, on-chain. Mirrors
// apps/pay/src/suins.ts. The directory displays @suize handles wherever an
// address has one (the no-hex display law): the feed payer/merchant, the
// rankings rows, and the ad-slot holders. The backend may already return a
// resolved `handle` for a row; where it returns null this module's reverse
// lookup is the client-side fallback before the short hex.
// ============================================================================

// Bare-label policy mirrors the issuer (services/backend/src/handle/index.ts):
// lowercase [a-z0-9-], 3–20 chars, no leading/trailing hyphen.
const LABEL_RE = /^[a-z0-9][a-z0-9-]{1,18}[a-z0-9]$/

export type ParsedHandle = {
  /** Display form — `<label>@suize` (rendered with the red/orange gradient). */
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

// Structural REVERSE slice — suix_resolveNameServiceNames via the dapp-kit
// client; data[0] is the address's primary/default name (the SDK returns dotted
// form by default, e.g. "sceat.suize.sui").
export type ReverseClient = {
  resolveNameServiceNames: (args: { address: string }) => Promise<{ data: string[] }>
}

/** Reverse-resolve an address to its primary SuiNS name in DISPLAY form —
 * `<label>.suize.sui` → `<label>@suize`, any other SuiNS name as-is. Null = the
 * address has no name (a definitive NO — the caller falls back to the short
 * hex). THROWS on an RPC failure (display-only sugar; callers retry/fall back). */
export const reverseResolve = async (
  client: ReverseClient,
  address: string,
): Promise<string | null> => {
  const { data } = await client.resolveNameServiceNames({ address })
  const name = data?.[0]?.trim()
  if (!name) return null
  return parseHandle(name)?.display ?? name
}
