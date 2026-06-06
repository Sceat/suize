/**
 * SuiNS recipient resolution + the real handle calls (claim / availability / me).
 * The Send sheet's "To" field resolves on-chain; the onboarding + gate calls ride
 * the single Enoki-verified WebSocket (see `ws.ts`) — the wallet is pure-WS now.
 *
 * `resolveRecipient(input, client)`:
 *   - input that looks like a raw address (0x + 64 hex) -> passthrough, no RPC.
 *   - anything else -> treated as a SuiNS name and resolved on-chain via
 *     `client.resolveNameServiceAddress({ name })` (REAL — works on testnet).
 * The CALLER debounces (the SPEC mandates ~600ms in the Send sheet); this function
 * is a single pure async resolve so it stays trivially testable and reusable. It is
 * the ONE thing here that is NOT WS — it's a direct on-chain SuiNS lookup, untouched.
 *
 * Handle calls (over the WS, correlated request/response; bodies from
 * @suize/shared/protocol):
 *   handleAvailableRequest { name }  -> WsHandleAvailableResponse { available, reason? }
 *   handleMeRequest {}               -> WsHandleMeResponse        { handle, suggestedName? }
 *   handleClaimRequest { name }      -> WsHandleClaimResponse     { handle, txDigest, setDefaultBytes?, setDefaultDigest? }
 * Handles are `<name>@suize` (= `<name>.suize.sui` leaf subnames). Source of truth is
 * fully ON-CHAIN now (no Redis): availability is `getNameRecord`, ownership is the
 * SuiNS reverse record. Issuance is self-custody (Path B): the backend mints + sponsors
 * the leaf — gasless to the user — THEN returns a SECOND sponsored tx (`set_reverse_lookup`,
 * sender = the verified user) that the WALLET signs with its zkLogin signer and executes,
 * which is what actually sets the reverse record so `/me` resolves on any device. A leaf
 * subname does NOT auto-set a reverse record, so this second leg is mandatory — without it
 * the handle is minted but `resolveNameServiceNames(address)` returns nothing.
 * The claim/me requests carry NO address — the authenticated subject is `ws.data`.
 */

import type { SuiJsonRpcClient } from '@mysten/sui/jsonRpc';
import { NETWORK } from '@suize/shared';
import type {
  WsExecuteResponse as ExecuteResponse,
  WsHandleAvailableResponse as HandleAvailableResponse,
  WsHandleMeResponse as HandleMeResponse,
  WsSponsorResponse as SponsorResponse,
} from '@suize/shared/protocol';
import {
  wsExecute,
  wsHandleAvailable,
  wsHandleClaim,
  wsHandleMe,
  wsSponsor,
} from './ws';

/**
 * The SuiClient type the Send sheet threads in. This is exactly what dapp-kit's
 * `useSuiClient()` returns (`SuiJsonRpcClient`); aliased so call-sites read clean.
 */
export type SuiClient = SuiJsonRpcClient;

// ───────────────────────────────────────────────────────────────────────────
// resolveRecipient (Send sheet)
// ───────────────────────────────────────────────────────────────────────────

/** Discriminates how a Send recipient was understood. */
export type RecipientKind = 'hex' | 'name';

/**
 * The resolution of a Send recipient. `address` is null only for a `name` that did
 * not resolve (unknown / unregistered) — a `hex` recipient always carries an address.
 */
export interface ResolvedRecipient {
  kind: RecipientKind;
  /** the destination 0x… address, or null when a name could not be resolved. */
  address: string | null;
}

/** Matches a fully-formed Sui address: 0x followed by exactly 64 hex chars. */
const HEX_ADDRESS = /^0x[0-9a-fA-F]{64}$/;

/**
 * True when `input` is a raw Sui address (0x + 64 hex). Exposed so callers (Send
 * sheet) can branch their copy ("address" vs "name") before resolution completes.
 */
export function isHexAddress(input: string): boolean {
  return HEX_ADDRESS.test(input.trim());
}

/**
 * Resolve a Send recipient.
 *
 * A raw address passes straight through (`{ kind: 'hex', address }`). Otherwise the
 * input is treated as a SuiNS name and resolved on-chain; an unresolvable name
 * yields `{ kind: 'name', address: null }`. Empty input -> `{ kind:'name', address:null }`.
 *
 * @param input  the raw "To" field text (a 0x… address OR a SuiNS name).
 * @param client the SuiClient from dapp-kit's `useSuiClient()`.
 */
export async function resolveRecipient(
  input: string,
  client: SuiClient,
): Promise<ResolvedRecipient> {
  const value = input.trim();

  if (isHexAddress(value)) {
    return { kind: 'hex', address: value };
  }

  if (value.length === 0) {
    return { kind: 'name', address: null };
  }

  try {
    const address = await client.resolveNameServiceAddress({ name: value });
    return { kind: 'name', address: address ?? null };
  } catch {
    // A malformed name (or a transient RPC error) reads as "not found" rather than
    // throwing into the debounced caller; the UI shows the `not found` state.
    return { kind: 'name', address: null };
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Confirmed-handle cache (same-device, owner-scoped).
// ───────────────────────────────────────────────────────────────────────────
//
// WHY: the `/me` gate resolves a handle from the SuiNS REVERSE record
// (`resolveNameServiceNames`). A leaf subname's reverse record can lag or fail to
// index, so `/me` can return null EVEN AFTER a successful claim — leaving the
// masthead stuck on "…@suize". The claim itself, though, returns the
// backend-MINTED "<name>@suize" (honest — it's the real on-chain mint, not
// fabricated). We cache THAT, keyed by the owner's (stable) zkLogin address, so:
//   • same-device users see their real handle INSTANTLY + across reloads, and
//   • a later empty `/me` can never blank out a known-good cached handle.
// The `/me` reverse lookup stays the cross-device fallback; a NON-null `/me` also
// writes the cache. Keyed by owner so different Google accounts never collide and
// nothing needs clearing on sign-out.
//
// SEAM: mirrors accountStore — swap the body for a WS RPC later, signature stays.

const HANDLE_KEY = (owner: string) => `suize:handle:${owner.toLowerCase()}`;

/** Read the confirmed handle cached for `owner` on THIS device, or null. */
export function getCachedHandle(owner: string): string | null {
  if (!owner) return null;
  try {
    const v = localStorage.getItem(HANDLE_KEY(owner));
    return v && v.length > 0 ? v : null;
  } catch {
    return null;
  }
}

/**
 * Cache the confirmed "<name>@suize" handle for `owner`. Call ONLY with a handle the
 * backend actually returned (a successful claim, or a non-null `/me`) — never fabricate.
 */
export function setCachedHandle(owner: string, handle: string): void {
  if (!owner || !handle) return;
  try {
    localStorage.setItem(HANDLE_KEY(owner), handle);
  } catch {
    // Storage full / disabled (private mode) — the in-memory identity state still
    // carries the handle for this session; we just won't persist across a reload.
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Handle endpoints (onboarding + gate)
// ───────────────────────────────────────────────────────────────────────────

/** The outcome of an onboarding handle claim. */
export interface ClaimedHandle {
  /** the chosen <name> (lower-cased, trimmed). */
  name: string;
  /** the full SuiNS handle "<name>@suize", as returned by the backend. */
  handle: string;
  /** the leaf-subname mint tx digest (sponsored). */
  txDigest: string;
  /**
   * The SECOND, user-signed leg of the claim: the sponsored `set_reverse_lookup`
   * (setDefault) tx whose SENDER is this user. `null` only on a legacy/forward-compat
   * response that omits it (the wallet then skips the second leg). When present, the
   * caller MUST sign `bytes` with the zkLogin signer and `setReverseRecord({ bytes,
   * digest })` BEFORE treating the claim as complete — otherwise the handle is minted
   * but the reverse record is unset and `/me` resolves nothing on any device.
   */
  setDefault: { bytes: string; digest: string } | null;
}

/**
 * Check whether a bare label is available. `name` is the BARE label (lowercase
 * [a-z0-9-], 3–20); the backend adds the `@suize` suffix. `reason` is meaningful
 * only when `available === false` (taken / too-short / bad-charset / blocklisted /
 * reserved) and drives StepName's `taken` state. The caller debounces (~450ms).
 * Rides the single WS as a correlated `handleAvailableRequest`.
 */
export async function checkHandleAvailable(name: string): Promise<HandleAvailableResponse> {
  const clean = name.trim().toLowerCase();
  return wsHandleAvailable(clean);
}

/**
 * Resolve whether the AUTHENTICATED owner already has a handle (the onboarding gate).
 * `handle === null` => no handle => onboarding. `suggestedName` (optional) seeds the
 * name step (e.g. the Google email local-part). Used by useIdentity.
 *
 * Over the WS the subject is `ws.data.address` (verified at the handshake), so the
 * request carries NO address — identity is never re-asserted by a message. Mirrors
 * aresrpg's "the socket IS the session" stance.
 */
export async function getHandleForAddress(): Promise<HandleMeResponse> {
  return wsHandleMe();
}

/**
 * Claim `<name>@suize` during onboarding (gasless). Sends ONLY the bare label —
 * the backend targets the authenticated `ws.data.address` (a claim cannot be
 * spoofed), mints the leaf subname (issuer-signed, sponsored), and returns the full
 * handle + leaf digest PLUS a SECOND sponsored tx (`set_reverse_lookup`) for the
 * wallet to sign + execute so the reverse record is set. No address is sent (the WS
 * already knows who you are). Throws on failure (taken / unauthorized / connection)
 * so onboarding can surface a calm retry.
 *
 * The returned `setDefault` is `null` only when the backend omitted both sponsored
 * fields (forward-compat / a server that already set the reverse record); the caller
 * then skips the second leg. Whenever it is present the caller MUST sign + execute it
 * (see `setReverseRecord`) BEFORE completing — the leaf alone does NOT set the reverse
 * record, so without it `/me` resolves nothing.
 */
export async function claimHandle(name: string): Promise<ClaimedHandle> {
  const clean = name.trim().toLowerCase();
  const res = await wsHandleClaim(clean);
  // Both halves of the sponsored setDefault must be present to attempt the second leg;
  // a partial response (one without the other) is treated as "no second leg" rather than
  // trying to execute an undefined digest.
  const setDefault =
    res.setDefaultBytes && res.setDefaultDigest
      ? { bytes: res.setDefaultBytes, digest: res.setDefaultDigest }
      : null;
  return { name: clean, handle: res.handle, txDigest: res.txDigest, setDefault };
}

/**
 * Submit the user's signature over the sponsored setDefault (`set_reverse_lookup`)
 * bytes — the SECOND leg of a claim. The caller signs `bytes` VERBATIM with the
 * zkLogin signer (dapp-kit `useSignTransaction`, same path as a sponsored send) and
 * passes the resulting `signature` here; the backend submits it + pays gas. After this
 * lands, the reverse record is set and `resolveNameServiceNames(address)` returns the
 * handle on any device. Throws on failure so onboarding can surface a calm retry (the
 * handle is already minted — only the reverse record is missing).
 */
export async function setReverseRecord(opts: {
  digest: string;
  signature: string;
}): Promise<ExecuteResponse> {
  return wsExecute({ digest: opts.digest, signature: opts.signature });
}

// ───────────────────────────────────────────────────────────────────────────
// Gasless sponsorship client — the wallet's mandate/vault PTBs (mirror Crash).
// ───────────────────────────────────────────────────────────────────────────
//
// zkLogin (Enoki/Google) users hold a fresh Sui address with NO SUI for gas, so a
// self-paid mandate/vault write aborts with "No valid gas coins". The unified
// backend (which holds the Enoki PRIVATE key + allow-lists the wallet targets)
// sponsors gas — now over the single WS instead of HTTP:
//   sponsorRequest { network, transactionKindBytes, sender } -> { bytes, digest }
//   executeRequest { digest, signature }                     -> { digest }
// Per write: build the tx-KIND bytes (onlyTransactionKind) + base64; sponsorRequest;
// sign the EXACT sponsored bytes verbatim (zkLogin session); executeRequest. We
// NEVER fall back to self-pay (a zkLogin user has no gas). Used by useHome's PTBs.

/** Ask the backend to sponsor the given tx-KIND bytes for `sender` (WS RPC). */
export const requestSponsorship = async (opts: {
  kindBytesB64: string;
  sender: string;
}): Promise<SponsorResponse> => {
  return wsSponsor({
    network: NETWORK,
    transactionKindBytes: opts.kindBytesB64,
    sender: opts.sender,
  });
};

/** Hand the backend the user's signature over the sponsored bytes; it submits + pays gas (WS RPC). */
export const executeSponsored = async (opts: {
  digest: string;
  signature: string;
}): Promise<ExecuteResponse> => {
  return wsExecute({ digest: opts.digest, signature: opts.signature });
};
