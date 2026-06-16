/**
 * The ONE sponsored-write transport — the wallet's gasless owner-tx path, lifted
 * out of `useAccount` so every write surface (subs create/renew/cancel, agent
 * funding) shares a single implementation (single-source-of-truth).
 *
 * THE PATTERN (the proven Crash/legacy transport): build the tx-KIND bytes
 * (`onlyTransactionKind`), ask the backend to wrap + gas-SPONSOR them over the WS
 * (`requestSponsorship`), sign the EXACT sponsored bytes VERBATIM with the live
 * zkLogin session, then submit (`executeSponsored`) — the backend pays gas, the
 * owner's key never leaves the machine, and Suize never signs the owner leg.
 *
 * USED FOR: the `subs::subscription` writes (create / renew / cancel) — these are
 * Party-object owner txs the relayer can only SPONSOR, never sign. The wallet's
 * own P2P send takes a DIFFERENT path (vanilla-x402 Address-Balance gasless, no
 * sponsor — see `useAccount.sendWallet`); funding the agent is just a P2P send.
 */

import type { Transaction } from '@mysten/sui/transactions';
import { toBase64 } from '@mysten/sui/utils';
import { requestSponsorship, executeSponsored } from './suins';

/** The dapp-kit `useSignTransaction().mutateAsync` shape — base64-in, signature-out. */
export type SignTransaction = (args: {
  transaction: string;
}) => Promise<{ signature: string }>;

/** The minimal SuiClient slice `tx.build({ client })` needs (dapp-kit's client). */
export type BuildClient = NonNullable<Parameters<Transaction['build']>[0]>['client'];

/**
 * Run a sponsored owner tx and return its executed digest.
 *
 * build KIND bytes → wsSponsor → sign the sponsored bytes verbatim → wsExecute.
 *
 * @param tx              a PURE @mysten/sui Transaction (no sender/gas set — KIND only).
 * @param owner           the signed-in zkLogin address (the sponsored sender).
 * @param client          the dapp-kit SuiClient (for `tx.build`).
 * @param signTransaction the dapp-kit signer thunk (signs the sponsored bytes).
 */
export async function runSponsored(opts: {
  tx: Transaction;
  owner: string;
  client: BuildClient;
  signTransaction: SignTransaction;
}): Promise<string> {
  const { tx, owner, client, signTransaction } = opts;
  if (!owner) throw new Error('Not signed in.');
  // The CoinWithBalance intent (`tx.balance(...)`, used by subs + profile to push an
  // exact USDC fee) resolves the sender's coins at build time — even for a KIND-only
  // build — so the sender MUST be set first, or `tx.build` throws "Sender must be set
  // to resolve CoinWithBalance". Idempotent: skips if a caller already set it.
  tx.setSenderIfNotSet(owner);
  const kindBytes = await tx.build({ client, onlyTransactionKind: true });
  const { bytes, digest } = await requestSponsorship({
    kindBytesB64: toBase64(kindBytes),
    sender: owner,
  });
  const { signature } = await signTransaction({ transaction: bytes });
  const executed = await executeSponsored({ digest, signature });
  return executed.digest;
}
