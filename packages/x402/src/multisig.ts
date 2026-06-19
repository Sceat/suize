// The agent SUB-ACCOUNT — a 1-of-2 Sui multisig. The ONE place the form +
// sign-and-combine logic lives (the wallet and the MCP import this; no dup).
//
// THE MODEL (proven on testnet, /tmp/multisig-spike): the sub-account is a
// MultiSigPublicKey over { MAIN session key, AGENT session key }, threshold 1,
// each weight 1 — so EITHER member signs ALONE (the agent spends; the human's
// one-key exit withdraws). The address is a PURE FUNCTION of (members, weights
// 1/1, threshold 1): re-derivable by anyone from the two pubkeys, no stored
// trusted state. CANONICAL MEMBER ORDER IS MANDATORY — (A,B) and (B,A) hash to
// DIFFERENT addresses, so we sort members by toSuiAddress() ascending; both
// callers then derive the identical sub-account.

import { MultiSigPublicKey } from '@mysten/sui/multisig'
import { parseSerializedSignature } from '@mysten/sui/cryptography'
import type { PublicKey } from '@mysten/sui/cryptography'

/** Sort the two members into canonical (toSuiAddress-ascending) order, then build
 * the 1-of-2 multisig. Order-independent: formAgentSubaccount(a,b) === (b,a). */
export function formAgentSubaccount(
  mainPubKey: PublicKey,
  agentPubKey: PublicKey,
): { address: string; multisig: MultiSigPublicKey } {
  const members = [mainPubKey, agentPubKey].sort((x, y) =>
    x.toSuiAddress() < y.toSuiAddress() ? -1 : 1,
  )
  const multisig = MultiSigPublicKey.fromPublicKeys({
    threshold: 1,
    publicKeys: [
      { publicKey: members[0], weight: 1 },
      { publicKey: members[1], weight: 1 },
    ],
  })
  return { address: multisig.toSuiAddress(), multisig }
}

/** The sub-account address alone — the part anyone can re-derive from the two
 * pubkeys (no trusted state). The form's address, without the MultiSigPublicKey. */
export const deriveSubaccountAddress = (
  mainPubKey: PublicKey,
  agentPubKey: PublicKey,
): string => formAgentSubaccount(mainPubKey, agentPubKey).address

/** Wrap ONE member's partial signature into the 1-of-2 multisig signature ready
 * for executeTransactionBlock — the agent's spend or the human's withdraw, each
 * signed by a single member (threshold 1). */
export const combineForMultisig = (
  multisig: MultiSigPublicKey,
  memberSignature: string,
): string => multisig.combinePartialSignatures([memberSignature])

// ── CHAIN-DERIVATION — recover a sub-account from chain, never from localStorage ──
//
// The sub-account address is a pure function of its two members, but a client that
// did NOT arm the agent (a different browser/device, or the wallet when the agent
// was armed via the MCP / Deploy app) has no stored members — so it cannot re-derive
// the address. It does NOT need to: every gasless payment the sub-account signs is a
// MultiSig signature that embeds the FULL committee. So given a candidate address we
// read ONE tx it sent, parse the committee, and we have BOTH the address AND the
// MultiSigPublicKey needed to sign (the MAIN member signs alone, threshold 1) — with
// zero trusted/stored state. This is the same chain-as-source-of-truth link the
// Deploy dashboard uses for "your sites" (apps/deploy/src/chain.ts).

/** The minimal read surface both dapp-kit's `SuiClient` and the backend's
 * `SuiJsonRpcClient` satisfy — just `queryTransactionBlocks`. */
export interface SubaccountQueryClient {
  queryTransactionBlocks(args: {
    filter: { FromAddress: string } | { ToAddress: string }
    options?: { showInput?: boolean; showBalanceChanges?: boolean }
    order?: 'ascending' | 'descending'
    cursor?: string | null
    limit?: number
  }): Promise<{
    data: Array<{
      transaction?: { txSignatures?: string[] } | null
      balanceChanges?: Array<{ amount: string; coinType: string; owner: unknown }> | null
    }>
  }>
}

const addressOwnerOf = (owner: unknown): string | null =>
  typeof owner === 'object' && owner !== null && 'AddressOwner' in owner
    ? String((owner as { AddressOwner: string }).AddressOwner).toLowerCase()
    : null

/**
 * Recover the 1-of-2 `MultiSigPublicKey` of a Suize agent sub-account by reading ONE
 * transaction it signed and parsing the embedded committee. Returns null when the
 * address never sent a tx, isn't a 1-of-2 threshold-1 multisig, doesn't derive back to
 * itself, or (when `requireMember` is given) that member is not in the committee — so
 * it NEVER yields a false positive. `showBalanceChanges` is intentionally NOT requested
 * (only `showInput` for the signatures), so this read never trips the fullnode's
 * effect-pruning "effect is empty" error. Never throws (any read/parse failure → null).
 */
export async function recoverSubaccountMultisig(
  client: SubaccountQueryClient,
  address: string,
  requireMember?: string,
): Promise<MultiSigPublicKey | null> {
  try {
    const page = await client.queryTransactionBlocks({
      filter: { FromAddress: address },
      options: { showInput: true },
      order: 'descending',
      limit: 1,
    })
    const want = address.toLowerCase()
    const member = requireMember?.toLowerCase()
    for (const tx of page.data) {
      for (const sig of tx.transaction?.txSignatures ?? []) {
        const parsed = parseSerializedSignature(sig)
        if (parsed.signatureScheme !== 'MultiSig') continue
        const mpk = new MultiSigPublicKey(parsed.multisig.multisig_pk)
        const members = mpk.getPublicKeys()
        if (members.length !== 2 || mpk.getThreshold() !== 1) continue
        if (mpk.toSuiAddress().toLowerCase() !== want) continue
        if (member && !members.some((m) => m.publicKey.toSuiAddress().toLowerCase() === member)) continue
        return mpk
      }
    }
  } catch {
    /* unreadable candidate → not recoverable */
  }
  return null
}

/**
 * Discover the agent sub-account(s) a `main` address controls, fully from chain. The
 * human funds a sub-account by sending USDC to it, so its recent SENDS name the
 * candidate sub-account addresses; we committee-check each (`recoverSubaccountMultisig`
 * with `requireMember = main`) and return the confirmed ones with their signing
 * multisig. `seeds` (e.g. a locally-armed address) are checked too, so a freshly-armed
 * sub-account that has already transacted is found even before it appears in the scan.
 * Resilient: if the main's send scan can't be read, falls back to checking the seeds.
 */
export async function discoverFundedSubaccounts(
  client: SubaccountQueryClient,
  main: string,
  opts?: { seeds?: string[]; scanLimit?: number; cap?: number },
): Promise<Array<{ address: string; multisig: MultiSigPublicKey }>> {
  const mainLc = main.toLowerCase()
  const cap = opts?.cap ?? 12
  const candidates = new Set<string>((opts?.seeds ?? []).map((s) => s.toLowerCase()))
  try {
    const page = await client.queryTransactionBlocks({
      filter: { FromAddress: main },
      options: { showBalanceChanges: true },
      order: 'descending',
      limit: opts?.scanLimit ?? 25,
    })
    for (const tx of page.data) {
      for (const c of tx.balanceChanges ?? []) {
        if (!c.coinType.toLowerCase().includes('::usdc::usdc')) continue
        const addr = addressOwnerOf(c.owner)
        if (!addr || addr === mainLc) continue
        if (BigInt(c.amount) > 0n) candidates.add(addr) // a recipient of a main USDC send
      }
    }
  } catch {
    /* main's sends unreadable (effect-pruned / RPC) → seeds-only fallback */
  }
  const checked = await Promise.all(
    [...candidates].slice(0, cap).map(async (addr) => {
      const mpk = await recoverSubaccountMultisig(client, addr, mainLc)
      return mpk ? { address: addr, multisig: mpk } : null
    }),
  )
  return checked.filter((x): x is { address: string; multisig: MultiSigPublicKey } => x != null)
}
