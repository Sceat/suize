import type { DisplayItem, PlainObject, TokenBalance } from '../data/wallet'
import { shortType } from './format'

/**
 * Case-insensitive substring match across a set of candidate fields.
 * Empty / whitespace query matches everything (unfiltered view).
 * This is the single source of truth for global search — every section
 * builds its own field list and defers the actual matching here.
 */
export function matchesQuery(fields: Array<string | null | undefined>, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  for (const field of fields) {
    if (field && field.toLowerCase().includes(q)) return true
  }
  return false
}

export function tokenMatches(token: TokenBalance, query: string): boolean {
  return matchesQuery(
    [token.symbol, token.name, token.coinType, shortType(token.coinType)],
    query,
  )
}

export function displayMatches(item: DisplayItem, query: string): boolean {
  return matchesQuery(
    [item.name, item.collection, item.type, shortType(item.type), item.objectId],
    query,
  )
}

export function objectMatches(object: PlainObject, query: string): boolean {
  return matchesQuery([object.type, shortType(object.type), object.objectId], query)
}
