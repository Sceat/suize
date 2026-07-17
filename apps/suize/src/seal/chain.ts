// =============================================================================
// On-chain reads + tx builders for the sealed-site viewer, over gRPC. All ids
// and Move targets come from @suize/shared (LOCKED #15 — never hardcoded here).
//
// Local structural response types are used deliberately: the SDK's deep
// conditional gRPC types otherwise over-infer through `include: { json: true }`
// (TS7022). These narrow types document exactly the fields the viewer reads.
// =============================================================================

import { Transaction } from '@mysten/sui/transactions'
import { packageIds, type SuiNetwork } from '@suize/shared'
import { vecU8ToHex } from './manifest'

/** The minimal gRPC client surface the viewer needs (getObject + owned scan). */
export interface ObjectReader {
  getObject(input: {
    objectId: string
    include: { json: true }
  }): Promise<{ object: { type?: string | null; json?: Record<string, unknown> | null } }>
  listOwnedObjects(input: {
    owner: string
    type: string
    cursor: string | null
    limit: number
    include: { json: true }
  }): Promise<{
    objects: Array<{ objectId: string; json?: Record<string, unknown> | null }>
    hasNextPage: boolean
    cursor: string | null
  }>
}

/** The on-chain `Site` (v3) fields the viewer consumes. */
export interface OnChainSite {
  owner: string
  name: string
  manifestBlobId: string
  /** sha256 of the manifest JSON, lower-case hex (normalised across transports). */
  manifestHashHex: string
  sealed: boolean
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '')

/** Read a `Site` object and normalise its fields. Throws if the id is not a Site
 *  (no Move json) — the viewer surfaces that as "not found". */
export async function readSite(client: ObjectReader, siteId: string): Promise<OnChainSite> {
  const { object } = await client.getObject({ objectId: siteId, include: { json: true } })
  const f = object.json
  if (!f) throw new Error('not-found')
  return {
    owner: str(f.owner),
    name: str(f.name),
    manifestBlobId: str(f.manifest_blob_id),
    manifestHashHex: vecU8ToHex(f.manifest_hash),
    sealed: f.sealed === true,
  }
}

/** Read the current member list of a shared `Allowlist` object. */
export async function readAllowlistMembers(
  client: ObjectReader,
  allowlistId: string,
): Promise<string[]> {
  const { object } = await client.getObject({ objectId: allowlistId, include: { json: true } })
  const list = object.json?.list
  return Array.isArray(list) ? list.map((a) => String(a)) : []
}

const eqId = (a: string, b: string): boolean =>
  a.replace(/^0x/, '').toLowerCase() === b.replace(/^0x/, '').toLowerCase()

/**
 * Find the connected wallet's `AllowlistCap` for a specific allowlist, by
 * scanning its owned objects of type `<pkg>::allowlist::AllowlistCap` and
 * matching `allowlist_id`. Returns the cap object id, or null when the wallet
 * holds no cap for this list (so the UI can hide the manage controls).
 */
export async function findAllowlistCap(
  client: ObjectReader,
  owner: string,
  network: SuiNetwork,
  allowlistId: string,
): Promise<string | null> {
  const pkg = packageIds(network).DEPLOY.PACKAGE
  const capType = `${pkg}::allowlist::AllowlistCap`
  let cursor: string | null = null
  for (let page = 0; page < 5; page++) {
    const owned = await client.listOwnedObjects({
      owner,
      type: capType,
      cursor,
      limit: 50,
      include: { json: true },
    })
    for (const o of owned.objects) {
      const capAllowlistId = o.json?.allowlist_id
      if (typeof capAllowlistId === 'string' && eqId(capAllowlistId, allowlistId)) {
        return o.objectId
      }
    }
    if (!owned.hasNextPage || !owned.cursor) break
    cursor = owned.cursor
  }
  return null
}

/**
 * Build the `add`/`remove` tx: `fn(allowlist, cap, version, account)`. The
 * caller signs + executes it with their AllowlistCap via dapp-kit. The shared
 * `Version` object gates add/remove (seal_approve stays un-gated so an upgrade
 * freeze can never brick decryption).
 */
export function buildMembershipTx(opts: {
  kind: 'add' | 'remove'
  network: SuiNetwork
  allowlistId: string
  capId: string
  account: string
}): Transaction {
  const ids = packageIds(opts.network).DEPLOY
  const target = opts.kind === 'add' ? ids.TARGETS.ALLOWLIST_ADD : ids.TARGETS.ALLOWLIST_REMOVE
  const tx = new Transaction()
  tx.moveCall({
    target,
    arguments: [
      tx.object(opts.allowlistId),
      tx.object(opts.capId),
      tx.object(ids.VERSION_OBJECT),
      tx.pure.address(opts.account),
    ],
  })
  return tx
}
