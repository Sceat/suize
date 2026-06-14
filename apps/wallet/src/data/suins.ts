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
 * Handle DETECTION + AVAILABILITY are ON-CHAIN ONLY (owner law 2026-06-11 — "we
 * only ask on chain, nothing else"): the gate is `resolveHandleOnChain` (the SuiNS
 * reverse record via `resolveNameServiceNames`), availability is
 * `checkHandleAvailable` (`resolveNameServiceAddress` on `<label>.suize.sui`,
 * failing CLOSED). No localStorage cache, no backend `/me`. The ONLY WS handle
 * call left is ISSUANCE:
 *   handleClaimRequest { name } -> WsHandleClaimResponse { handle, txDigest, setDefaultBytes?, setDefaultDigest? }
 * Handles are `<name>@suize` (= `<name>.suize.sui` leaf subnames). Issuance is
 * self-custody (Path B): the backend mints + sponsors
 * the leaf — gasless to the user — THEN returns a SECOND sponsored tx (`set_reverse_lookup`,
 * sender = the verified user) that the WALLET signs with its zkLogin signer and executes,
 * which is what actually sets the reverse record so `/me` resolves on any device. A leaf
 * subname does NOT auto-set a reverse record, so this second leg is mandatory — without it
 * the handle is minted but `resolveNameServiceNames(address)` returns nothing.
 * The claim/me requests carry NO address — the authenticated subject is `ws.data`.
 */

import type { SuiJsonRpcClient } from '@mysten/sui/jsonRpc';
import { NETWORK } from '../lib/env';
import type {
  WsExecuteResponse as ExecuteResponse,
  WsHandleAvailableResponse as HandleAvailableResponse,
  WsSponsorResponse as SponsorResponse,
} from '@suize/shared/protocol';
import { wsExecute, wsHandleClaim, wsSponsor } from './ws';

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

/** A valid SuiNS name in dotted form: one or more `[a-z0-9-]` labels + `.sui`. */
const SUINS_NAME = /^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.sui$/;

/**
 * Normalize every accepted recipient-name form to the dotted `.sui` name the
 * SuiNS RPC actually resolves — they are all valid SuiNS names/subnames and must
 * send the same (owner law, 2026-06-13). Returns null when `input` isn't a name
 * we accept (the caller then treats it as not-a-recipient / email / phone).
 *
 *   hello@suize  → hello.suize.sui   (a Suize handle = label@parent, parent is ONE label)
 *   @name        → name.sui          (SuiNS @-form; @x.y → x.y.sui)
 *   name.sui     → name.sui          (already a dotted SuiNS name)
 *   x.y.sui      → x.y.sui           (a subname / subdomain)
 *
 * `a@b.tld` (a DOTTED parent) is an email, not a handle → null (so email copy wins).
 */
export function normalizeSuiName(input: string): string | null {
  let v = input.trim().toLowerCase();
  if (!v) return null;
  if (v.startsWith('@')) {
    // leading-@ explicitly means "a SuiNS name": @name → name.sui, @x.y → x.y.sui
    v = v.slice(1);
    if (!v.endsWith('.sui')) v = `${v}.sui`;
  } else if (v.includes('@')) {
    // label@parent → label.parent.sui — but ONLY when parent is a single label
    // (the Suize-handle shape `hello@suize`). A dotted parent is an email address.
    const at = v.indexOf('@');
    const label = v.slice(0, at);
    const parent = v.slice(at + 1);
    if (!label || !parent || parent.includes('.') || parent.includes('@')) return null;
    v = `${label}.${parent}.sui`;
  } else if (!v.endsWith('.sui')) {
    // a bare label or dotted name without the `.sui` TLD is ambiguous — reject.
    return null;
  }
  return SUINS_NAME.test(v) ? v : null;
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

  // Every accepted name form (@name · name.sui · x.y.sui · hello@suize) is
  // normalized to the dotted `.sui` name the RPC understands; anything else is
  // not a resolvable recipient.
  const name = normalizeSuiName(value);
  if (!name) {
    return { kind: 'name', address: null };
  }

  try {
    const address = await client.resolveNameServiceAddress({ name });
    return { kind: 'name', address: address ?? null };
  } catch {
    // A transient RPC error reads as "not found" rather than throwing into the
    // debounced caller; the UI shows the `not found` state.
    return { kind: 'name', address: null };
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Handle detection — ON-CHAIN ONLY (owner law, 2026-06-11).
// ───────────────────────────────────────────────────────────────────────────
//
// The localStorage handle cache and the backend `/me` gate are GONE: "we only
// ask on chain, nothing else." The SuiNS reverse record is the single source of
// truth — `resolveNameServiceNames(address)` answers on ANY device with zero
// local state and zero backend dependency. A claim's second leg
// (`set_reverse_lookup`, user-signed) is what makes this true cross-device,
// which is why it is mandatory.

const SUIZE_SUFFIX = '.suize.sui';

/**
 * Resolve the owner's "<name>@suize" handle from the CHAIN (the SuiNS reverse
 * record) — the onboarding gate. Scans the address's names for a `*.suize.sui`
 * leaf (a non-Suize SuiNS default must not satisfy the gate) and returns the
 * display form, or null when the owner genuinely has no Suize handle.
 * THROWS on RPC failure — callers must treat that as "unknown", never as
 * "no handle" (the gate retries; it must not dump an existing user into the
 * name-picker on a flaky read).
 */
export async function resolveHandleOnChain(
  owner: string,
  client: SuiClient,
): Promise<string | null> {
  const { data } = await client.resolveNameServiceNames({
    address: owner,
    limit: 50,
  });
  const suize = (data ?? []).find((n) => n.endsWith(SUIZE_SUFFIX));
  if (!suize) return null;
  return `${suize.slice(0, -SUIZE_SUFFIX.length)}@suize`;
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

/** The bare-label rule (mirrors the backend issuer): lowercase a-z0-9-, 3–20, no edge hyphens. */
const LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{1,18})[a-z0-9]$/;

/**
 * Check whether a bare label is available — ON-CHAIN (owner law 2026-06-11: chain
 * only, nothing else). `<label>.suize.sui` resolving to an address = TAKEN; a
 * definitive null = available. An RPC failure FAILS CLOSED (`available: false`,
 * reason 'unreachable') — a taken name must never read as free because a read
 * failed (that exact fail-open bug showed the owner his own handle as
 * "available"). Format rules are enforced here so bad labels never hit the RPC.
 * The caller debounces (~450ms).
 */
export async function checkHandleAvailable(
  name: string,
  client: SuiClient,
): Promise<HandleAvailableResponse> {
  const clean = name.trim().toLowerCase();
  if (!LABEL_RE.test(clean)) {
    return { available: false, reason: 'invalid' };
  }
  try {
    const address = await client.resolveNameServiceAddress({
      name: `${clean}${SUIZE_SUFFIX}`,
    });
    return address
      ? { available: false, reason: 'taken' }
      : { available: true };
  } catch {
    return { available: false, reason: 'unreachable' };
  }
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
