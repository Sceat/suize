// ===========================================================================
//  SuiNS handle resolver — client-side mirror of the backend's `meCore`
//  (services/backend/src/handle/index.ts:213-229).
// ---------------------------------------------------------------------------
//  Onboarded Suize users hold an on-chain SuiNS REVERSE record (set by their
//  claim's set_reverse_lookup tx), so resolveNameServiceNames({ address }) over
//  the JSON-RPC client returns their dotted names. The one ending in
//  `.suize.sui` is their handle; we surface it in display form `<label>@suize`.
//
//  Presentation only — purely a read; never feeds a transaction. Errors and the
//  no-handle case both collapse to null so the caller falls back to the hex.
// ===========================================================================
import type { SuiJsonRpcClient } from '@mysten/sui/jsonRpc'

// The parent domain whose leaf subnames are Suize handles.
const PARENT_SUFFIX = '.suize.sui'

/**
 * Resolve a connected address to its `<label>@suize` handle, or null when the
 * address has no `.suize.sui` reverse record (or any RPC error). Swallows all
 * failures — a missing/slow handle must never break the account cluster, which
 * falls back to the truncated hex.
 */
export async function resolveSuizeHandle(
  address: string,
  client: SuiJsonRpcClient,
): Promise<string | null> {
  try {
    const { data } = await client.resolveNameServiceNames({
      address,
      format: 'dot',
    })
    const dotted = data.find(n => n.endsWith(PARENT_SUFFIX))
    if (!dotted) return null
    const label = dotted.slice(0, -PARENT_SUFFIX.length)
    if (!label) return null
    return `${label}@suize`
  } catch {
    return null
  }
}
