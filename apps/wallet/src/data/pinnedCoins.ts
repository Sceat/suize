/**
 * Pinned UNKNOWN coins — the owner-scoped set of coin types the user chose to pin
 * ABOVE the collapsed "more tokens" section on their MAIN account.
 *
 * WHY: a wallet can hold any coin; the curated SUPPORTED set is always shown, but the
 * long tail of detected (unknown) coins is collapsed by default. Pinning lets the user
 * promote the few unknowns they care about so they sit right under the known coins and
 * survive reloads — a pure UI preference (no chain, no price, no money moves).
 *
 * STORAGE: localStorage, owner-scoped — `suize:pinned-coins:<owner>` (owner lower-cased),
 * mirroring the `suize:handle:<owner>` convention in suins.ts so different accounts never
 * collide and nothing needs clearing on sign-out. The value is a JSON string[] of coin
 * types. Read/write are defensive (private-mode / quota failures degrade to "nothing
 * pinned" rather than throwing into render).
 *
 * SEAM: same shape as the handle cache — swap the body for a WS RPC later if pins ever
 * need to follow the user across devices; the signatures stay identical.
 */

const PINNED_KEY = (owner: string) => `suize:pinned-coins:${owner.toLowerCase()}`;

/** Read the set of pinned coin types for `owner` on THIS device (empty if none / no owner). */
export function getPinnedCoins(owner: string): Set<string> {
  if (!owner) return new Set();
  try {
    const raw = localStorage.getItem(PINNED_KEY(owner));
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? new Set(parsed.filter((t): t is string => typeof t === 'string')) : new Set();
  } catch {
    return new Set();
  }
}

/** Persist the pinned-coin set for `owner`. Stores a JSON string[] of coin types. */
export function setPinnedCoins(owner: string, types: Set<string>): void {
  if (!owner) return;
  try {
    localStorage.setItem(PINNED_KEY(owner), JSON.stringify([...types]));
  } catch {
    // Storage full / disabled (private mode) — the in-memory pin state still drives
    // this session's UI; we just won't persist the change across a reload.
  }
}

/**
 * Toggle `coinType` in `owner`'s pinned set and PERSIST the result. Returns the new
 * set so the caller can update React state from the same source of truth. Pure-ish:
 * the only side effect is the localStorage write.
 */
export function togglePinnedCoin(owner: string, coinType: string): Set<string> {
  const next = new Set(getPinnedCoins(owner));
  if (next.has(coinType)) next.delete(coinType);
  else next.add(coinType);
  setPinnedCoins(owner, next);
  return next;
}
