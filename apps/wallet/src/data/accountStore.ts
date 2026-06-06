/**
 * The per-owner account-ref store — where the created-account object ids live.
 *
 * WHY localStorage (the simplest REAL option): the mandate / AgentCap / vault ids
 * only come into existence when the owner CREATES an account (a real on-chain tx).
 * They must survive a reload so pause/strategy/convert keep working across sessions.
 * The honest options were: (a) re-derive from on-chain events every load (slow + a
 * scan with no stable anchor — mandates are shared, not owned, so there's no cheap
 * owner-index), (b) a backend Redis key per user (another round-trip + a new WS
 * frame), or (c) localStorage keyed by owner+role. (c) is the YAGNI win: zero new
 * infra, owner-scoped, instant. The ids are PUBLIC on-chain object ids (not secrets),
 * so localStorage is a fine home. The agent PRIVATE key never touches this (it lives
 * in the helm); we only store the agent's public ADDRESS alongside the ids.
 *
 * Keyed by `suize:acct:<owner>:<role>` so two different zkLogin logins on the same
 * browser never cross-read each other's accounts. Reading another owner's key is
 * impossible (the key embeds the owner address).
 *
 * SEAM: to move this to the backend later, swap the body of get/set/clear for a WS
 * RPC — the signature (`AccountRefs | null`) stays identical, so useHome is unchanged.
 */

import type { AiRole } from './types';
import type { AccountRefs, AllocationWeights } from './types';
import { AGENT_ADDRESS } from '../lib/env';

const KEY = (owner: string, role: AiRole) => `suize:acct:${owner.toLowerCase()}:${role}`;

/** Read the persisted refs for (owner, role), or null if the account isn't created. */
export function getAccountRefs(owner: string, role: AiRole): AccountRefs | null {
  if (!owner) return null;
  try {
    const raw = localStorage.getItem(KEY(owner, role));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AccountRefs>;
    // Validate the shape — a partial/corrupt blob reads as "no account" rather than
    // building an invalid tx from half-set ids.
    if (
      typeof parsed.mandateId === 'string' &&
      typeof parsed.capId === 'string' &&
      typeof parsed.vaultId === 'string' &&
      typeof parsed.agentAddress === 'string' &&
      (parsed.vaultKind === 'single' || parsed.vaultKind === 'swap')
    ) {
      // SECURITY (defense in depth): the agent address feeds issue_agent_cap on
      // resume / strategy-change. localStorage is attacker-writable, so NEVER trust
      // the persisted value — pin it to the build-time AGENT_ADDRESS constant. On a
      // mismatch we warn and override (the persisted ids are public object ids; only
      // the cap RECIPIENT must be the configured agent). If the constant is unset we
      // keep the parsed value — the create path already gates on AGENT_ADDRESS, so an
      // unset constant means no AI accounts exist to mint a cap for anyway.
      if (AGENT_ADDRESS && parsed.agentAddress !== AGENT_ADDRESS) {
        console.warn(
          `[accountStore] persisted agentAddress (${parsed.agentAddress}) != trusted AGENT_ADDRESS — overriding with the configured agent.`,
        );
        return { ...(parsed as AccountRefs), agentAddress: AGENT_ADDRESS };
      }
      return parsed as AccountRefs;
    }
    return null;
  } catch {
    return null;
  }
}

/** Persist the refs for (owner, role). Overwrites any prior account for that role. */
export function setAccountRefs(owner: string, role: AiRole, refs: AccountRefs): void {
  if (!owner) return;
  try {
    localStorage.setItem(KEY(owner, role), JSON.stringify(refs));
  } catch {
    // Storage full / disabled (private mode). The in-memory copy in useHome still
    // works for this session; we just won't survive a reload. Non-fatal.
  }
}

/** Update only the cap id (used on pause->resume / restrategy re-issue). */
export function updateCapId(owner: string, role: AiRole, capId: string): void {
  const refs = getAccountRefs(owner, role);
  if (!refs) return;
  setAccountRefs(owner, role, { ...refs, capId });
}

/** Replace the mandate + cap (used when set_strategy re-leashes onto a new mandate). */
export function updateMandate(
  owner: string,
  role: AiRole,
  mandateId: string,
  capId: string,
): void {
  const refs = getAccountRefs(owner, role);
  if (!refs) return;
  setAccountRefs(owner, role, { ...refs, mandateId, capId });
}

/**
 * Merge the journal's INVESTING multi-select intent (the chosen split) into the
 * stored refs. Additive + idempotent — the validate-shape guard in `getAccountRefs`
 * ignores the unknown `allocations` field on old blobs, so this never breaks an
 * existing account. No-op when the account isn't created yet.
 */
export function updateAllocations(
  owner: string,
  role: AiRole,
  allocations: AllocationWeights,
): void {
  const refs = getAccountRefs(owner, role);
  if (!refs) return;
  setAccountRefs(owner, role, { ...refs, allocations });
}
