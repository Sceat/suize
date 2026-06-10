/**
 * Per-owner Account-id store for the PAY wallet — where the user's shared
 * `Account<USDC>` object id lives across reloads.
 *
 * WHY localStorage (the YAGNI win, mirroring the legacy `accountStore`): the Account
 * is a SHARED object created by an owner tx. Shared objects have no cheap owner-index
 * to scan, so we cache the id (a PUBLIC on-chain object id, not a secret) keyed by the
 * owner's stable zkLogin address. A reload re-reads it instantly; a missing entry
 * triggers a one-time `getOwnedObjects`-free recovery scan via the AccountCreated
 * event (handled in useAccount, which also writes the cache on first create).
 *
 * Keyed by `suize:account:<owner>` so two Google logins on one browser never collide.
 *
 * SEAM: to move this to the backend later, swap the get/set bodies for a WS RPC —
 * the `string | null` signature stays, so useAccount is unchanged.
 */

const KEY = (owner: string) => `suize:account:${owner.toLowerCase()}`;

/** Read the persisted shared-Account id for `owner`, or null if none cached yet. */
export function getAccountId(owner: string): string | null {
  if (!owner) return null;
  try {
    const v = localStorage.getItem(KEY(owner));
    return v && v.length > 0 ? v : null;
  } catch {
    return null;
  }
}

/** Cache the shared-Account id for `owner`. Call ONLY with an id a real create/read produced. */
export function setAccountId(owner: string, accountId: string): void {
  if (!owner || !accountId) return;
  try {
    localStorage.setItem(KEY(owner), accountId);
  } catch {
    // Storage full / disabled (private mode) — the in-memory state still carries the
    // id for this session; it just won't persist across a reload.
  }
}
