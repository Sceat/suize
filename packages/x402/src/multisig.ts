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
