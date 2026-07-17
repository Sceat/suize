import type { SuiGrpcClient } from '@mysten/sui/grpc'
import type { SuiClientTypes } from '@mysten/sui/client'
import { bcs } from '@mysten/sui/bcs'
import { isValidSuiNSName, normalizeSuiAddress, normalizeSuiNSName } from '@mysten/sui/utils'
import { resolveMediaUrl, shortType, typeLabel } from '../lib/format'

export const KIOSK_OWNER_CAP = '0x2::kiosk::KioskOwnerCap'

export interface TokenBalance {
  coinType: string
  balance: string
  coinBalance: string
  addressBalance: string
  decimals: number
  name: string
  symbol: string
  description: string
  iconUrl: string | null
}

export interface DisplayItem {
  objectId: string
  type: string
  name: string
  collection: string
  description: string | null
  imageUrl: string | null
  publicTransfer: boolean
  kioskId?: string
}

export interface PlainObject {
  objectId: string
  type: string
  publicTransfer: boolean
}

export interface OwnedSections {
  nfts: DisplayItem[]
  objects: PlainObject[]
}

export interface KioskData {
  kioskCount: number
  items: DisplayItem[]
}

interface GraphQLError {
  message: string
}

interface GraphQLResponse<T> {
  data?: T
  errors?: GraphQLError[]
}

interface OwnedNode {
  address: string
  asMoveObject: {
    hasPublicTransfer: boolean
    contents: {
      type: { repr: string }
      display: {
        output: Record<string, unknown> | null
        errors: Record<string, string> | null
      } | null
    }
  } | null
}

interface OwnedPageData {
  objects: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null }
    nodes: OwnedNode[]
  }
}

const OWNED_OBJECTS_QUERY = /* GraphQL */ `
  query OwnedObjects($owner: SuiAddress!, $first: Int!, $after: String) {
    objects(first: $first, after: $after, filter: { owner: $owner }) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        address
        asMoveObject {
          hasPublicTransfer
          contents {
            type {
              repr
            }
            display {
              output
              errors
            }
          }
        }
      }
    }
  }
`

const OBJECT_DISPLAY_FRAGMENT = /* GraphQL */ `
  fragment ItemDisplay on Object {
    address
    asMoveObject {
      hasPublicTransfer
      contents {
        type {
          repr
        }
        display {
          output
          errors
        }
      }
    }
  }
`

// The GraphQL ObjectFilter cannot select by a list of ids, so resolve each
// kiosk item by address with an aliased `object(address:)` batch (one round trip
// per chunk). ids originate from onchain dynamic fields; guard the inline anyway.
function buildObjectsByIdsQuery(ids: string[]): string {
  const fields = ids
    .filter((id) => /^0x[0-9a-fA-F]{1,64}$/.test(id))
    .map((id, index) => `  o${index}: object(address: "${id}") { ...ItemDisplay }`)
    .join('\n')
  return `query ItemsByIds {\n${fields}\n}\n${OBJECT_DISPLAY_FRAGMENT}`
}

const REVERSE_NAME_QUERY = /* GraphQL */ `
  query ReverseName($address: SuiAddress!) {
    address(address: $address) {
      defaultNameRecord {
        domain
      }
    }
  }
`

async function queryGraphQL<T>(
  url: string,
  query: string,
  variables: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables }),
    signal,
  })
  if (!response.ok) throw new Error(`GraphQL request failed (${response.status})`)
  const payload = (await response.json()) as GraphQLResponse<T>
  if (payload.errors?.length) {
    throw new Error(payload.errors.map((error) => error.message).join('; '))
  }
  if (!payload.data) throw new Error('GraphQL returned no data')
  return payload.data
}

function displayString(output: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = output[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return null
}

function toDisplayItem(node: OwnedNode, kioskId?: string): DisplayItem {
  const moveObject = node.asMoveObject
  if (!moveObject) throw new Error(`Object ${node.address} is not a Move object`)
  const output = moveObject.contents.display?.output ?? {}
  const type = moveObject.contents.type.repr
  return {
    objectId: node.address,
    type,
    name: displayString(output, 'name', 'title') ?? typeLabel(type),
    collection:
      displayString(output, 'collection_name', 'collection', 'project_name') ?? shortType(type),
    description: displayString(output, 'description'),
    imageUrl: resolveMediaUrl(
      displayString(output, 'image_url', 'image', 'thumbnail_url', 'project_url'),
    ),
    publicTransfer: moveObject.hasPublicTransfer,
    kioskId,
  }
}

function isCoinObject(type: string): boolean {
  return /^(?:0x0*2)::coin::Coin</.test(type)
}

export async function loadTokens(
  client: SuiGrpcClient,
  owner: string,
  signal?: AbortSignal,
): Promise<TokenBalance[]> {
  const balances: Array<{
    coinType: string
    balance: string
    coinBalance: string
    addressBalance: string
  }> = []
  let cursor: string | null = null
  do {
    const page = await client.listBalances({ owner, limit: 50, cursor, signal })
    balances.push(...page.balances.filter((balance) => BigInt(balance.balance) > 0n))
    cursor = page.hasNextPage ? page.cursor : null
  } while (cursor)

  const rows = await Promise.all(
    balances.map(async (balance): Promise<TokenBalance> => {
      const { coinMetadata } = await client.getCoinMetadata({
        coinType: balance.coinType,
        signal,
      })
      const fallback = typeLabel(balance.coinType)
      return {
        ...balance,
        decimals: coinMetadata?.decimals ?? 0,
        name: coinMetadata?.name || fallback,
        symbol: coinMetadata?.symbol || fallback,
        description: coinMetadata?.description || '',
        iconUrl: resolveMediaUrl(coinMetadata?.iconUrl),
      }
    }),
  )

  return rows.sort((a, b) => {
    if (a.coinType === '0x2::sui::SUI') return -1
    if (b.coinType === '0x2::sui::SUI') return 1
    return a.symbol.localeCompare(b.symbol)
  })
}

export async function loadOwnedSections(
  graphqlUrl: string,
  owner: string,
  signal?: AbortSignal,
): Promise<OwnedSections> {
  const nodes: OwnedNode[] = []
  let after: string | null = null
  do {
    const data: OwnedPageData = await queryGraphQL<OwnedPageData>(
      graphqlUrl,
      OWNED_OBJECTS_QUERY,
      { owner, first: 50, after },
      signal,
    )
    const page = data.objects
    nodes.push(...page.nodes)
    after = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null
  } while (after)

  const nfts: DisplayItem[] = []
  const objects: PlainObject[] = []
  for (const node of nodes) {
    const moveObject = node.asMoveObject
    if (!moveObject || isCoinObject(moveObject.contents.type.repr)) continue
    if (moveObject.contents.display) {
      nfts.push(toDisplayItem(node))
    } else {
      objects.push({
        objectId: node.address,
        type: moveObject.contents.type.repr,
        publicTransfer: moveObject.hasPublicTransfer,
      })
    }
  }
  nfts.sort((a, b) => a.name.localeCompare(b.name))
  objects.sort((a, b) => a.type.localeCompare(b.type))
  return { nfts, objects }
}

const KioskOwnerCapBcs = bcs.struct('KioskOwnerCap', {
  id: bcs.Address,
  for: bcs.Address,
})

async function getKioskIds(client: SuiGrpcClient, owner: string, signal?: AbortSignal) {
  const ids: string[] = []
  let cursor: string | null = null
  do {
    const page: SuiClientTypes.ListOwnedObjectsResponse<{ content: true }> =
      await client.listOwnedObjects({
        owner,
        type: KIOSK_OWNER_CAP,
        include: { content: true },
        limit: 50,
        cursor,
        signal,
      })
    for (const cap of page.objects) {
      if (cap.content) ids.push(KioskOwnerCapBcs.parse(cap.content).for)
    }
    cursor = page.hasNextPage ? page.cursor : null
  } while (cursor)
  return [...new Set(ids)]
}

export async function loadKiosks(
  client: SuiGrpcClient,
  graphqlUrl: string,
  owner: string,
  signal?: AbortSignal,
): Promise<KioskData> {
  const kioskIds = await getKioskIds(client, owner, signal)
  const itemToKiosk = new Map<string, string>()

  await Promise.all(
    kioskIds.map(async (kioskId) => {
      let cursor: string | null = null
      do {
        const page: Awaited<ReturnType<typeof client.listDynamicFields>> =
          await client.listDynamicFields({ parentId: kioskId, limit: 50, cursor, signal })
        for (const field of page.dynamicFields) {
          if (field.$kind === 'DynamicObject' && /::kiosk::Item$/.test(field.name.type)) {
            itemToKiosk.set(field.childId, kioskId)
          }
        }
        cursor = page.hasNextPage ? page.cursor : null
      } while (cursor)
    }),
  )

  const ids = [...itemToKiosk.keys()]
  if (!ids.length) return { kioskCount: kioskIds.length, items: [] }

  // Resolve each kiosk item's OWN Display through the same GraphQL resolver the
  // NFT section uses (toDisplayItem), so kiosk cards render real onchain art
  // instead of "No image". Chunked to respect the objects page limit.
  const items: DisplayItem[] = []
  for (let start = 0; start < ids.length; start += 50) {
    const chunk = ids.slice(start, start + 50)
    const data = await queryGraphQL<Record<string, OwnedNode | null>>(
      graphqlUrl,
      buildObjectsByIdsQuery(chunk),
      {},
      signal,
    )
    for (const node of Object.values(data)) {
      if (!node?.asMoveObject) continue
      items.push(toDisplayItem(node, itemToKiosk.get(node.address)))
    }
  }
  items.sort((a, b) => a.name.localeCompare(b.name))
  return { kioskCount: kioskIds.length, items }
}

export async function loadReverseName(
  graphqlUrl: string,
  address: string,
  signal?: AbortSignal,
): Promise<string | null> {
  const data = await queryGraphQL<{
    address: { defaultNameRecord: { domain: string } | null } | null
  }>(graphqlUrl, REVERSE_NAME_QUERY, { address }, signal)
  return data.address?.defaultNameRecord?.domain ?? null
}

export async function resolveRecipient(client: SuiGrpcClient, input: string): Promise<string> {
  const value = input.trim()
  if (/^0x[0-9a-fA-F]{1,64}$/.test(value)) return normalizeSuiAddress(value)
  if (!isValidSuiNSName(value)) {
    throw new Error('Enter a Sui address or a valid SuiNS name')
  }
  const normalized = normalizeSuiNSName(value, 'dot')
  const { response } = await client.nameService.lookupName({ name: normalized })
  const address = response.record?.targetAddress
  if (!address) throw new Error(`No address is set for ${normalized}`)
  return normalizeSuiAddress(address)
}
