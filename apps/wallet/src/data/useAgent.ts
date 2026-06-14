/**
 * The AGENT hook — the sub-account, as a 1-of-2 multisig.
 *
 * THE MODEL (multisig sub-account): the agent's spendable balance lives in a 1-of-2
 * Sui multisig over { MAIN wallet session key, AGENT session key }, threshold 1 —
 * EITHER member signs alone (`@suize/x402` formAgentSubaccount). The address is a
 * PURE FUNCTION of the two public keys, so the wallet (MAIN member) and the MCP
 * (AGENT member) re-derive the SAME sub-account with no shared trusted state. You
 * FUND that address, the AI spends from it, and — the change from the old "fund a
 * foreign address" model — YOU can withdraw from it in ONE TAP: the MAIN member
 * signs a gasless send from the multisig back to your wallet, alone.
 *
 * ARMING: the AGENT member's public key is only knowable after the agent OAuth has
 * run once (/agent-connect, under the second zkLogin client). Until then there is
 * no second member, so `armed` is false and the sub-account does not yet exist. The
 * address is stable forever after the first arm.
 *
 * THE HONEST CAVEAT (custody law): within its funded balance the agent can spend —
 * you CAP it by funding only what you're comfortable with, and you EXIT it by
 * withdrawing (one tap, MAIN member alone). That is delegated-spend, bounded by the
 * deposit and reversible by you — not custody risk.
 *
 * READS: the sub-account address (derived from the stored members) + its USDC
 * balance (getBalance). WRITES: Fund = a plain gasless `sendWallet` to the
 * sub-account; Withdraw = a gasless multisig send from the sub-account to MAIN,
 * signed by the MAIN member and combined (`spendFromSubaccount`).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSuiClient } from '@mysten/dapp-kit';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { publicKeyFromSuiBytes } from '@mysten/sui/verify';
import { formAgentSubaccount } from '@suize/x402';
import type { MultiSigPublicKey } from '@mysten/sui/multisig';
import { USDC } from './coins';
import { priceOf, usePrices } from './prices';
import { getAgentMembers } from './payStore';
import type { UsdcBalance } from './payTypes';

/** Google's app-permissions page — where a user revokes the agent's Google access. */
export const GOOGLE_REVOKE_URL = 'https://myaccount.google.com/permissions';

const USDC_SCALE = 10 ** USDC.decimals;
const ZERO_BALANCE: UsdcBalance = { raw: '0', ui: 0, usd: 0 };

export interface UseAgent {
  /** the derived sub-account (multisig) address, or null until the agent is armed. */
  agentAddress: string | null;
  /** true once both members are known (the agent OAuth has run once) → the
   *  sub-account exists and can be funded / withdrawn. */
  armed: boolean;
  /** the sub-account's USDC balance — its hard spend cap. Zero state when unarmed. */
  balance: UsdcBalance;
  /** true while the balance read is settling. */
  loading: boolean;
  /** re-read the persisted members from the store — call after the arm popup closes,
   *  so a just-created sub-account appears without a page reload. */
  reloadMembers(): void;
  /** fund the agent: send `amountRaw` of the owner's wallet USDC to the sub-account. */
  fund(amountRaw: bigint): Promise<string>;
  /** withdraw `amountRaw` from the sub-account back to the owner's wallet (MAIN member
   *  signs alone). Throws if unarmed, non-positive, or more than the balance. */
  withdraw(amountRaw: bigint): Promise<string>;
  /** force a balance re-read. */
  refresh(): void;
}

/** A gasless send FROM the sub-account multisig (MAIN member signs, combines). The
 *  caller (`useAccount.spendFromSubaccount`) owns the single gasless transport. */
export type SpendFromSubaccount = (args: {
  multisig: MultiSigPublicKey;
  to: string;
  amountRaw: bigint;
}) => Promise<string>;

/**
 * `useAgent(owner, sendWallet, spendFromSubaccount)` — the sub-account members store
 * + balance + Fund + one-tap Withdraw. `sendWallet` funds it (a plain P2P send);
 * `spendFromSubaccount` is the multisig-signed gasless send used for Withdraw.
 */
export function useAgent(
  owner: string | null | undefined,
  sendWallet: (args: { amountRaw: bigint; to: string }) => Promise<string>,
  spendFromSubaccount: SpendFromSubaccount,
): UseAgent {
  const client = useSuiClient();
  const ownerAddr = owner ?? '';
  const prices = usePrices();
  const usdcPrice = priceOf(USDC.type, prices);

  const [members, setMembers] = useState(() => (ownerAddr ? getAgentMembers(ownerAddr) : null));
  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  // Re-seed when the owner changes (two Google logins on one browser).
  useEffect(() => {
    setMembers(ownerAddr ? getAgentMembers(ownerAddr) : null);
  }, [ownerAddr]);

  // The sub-account is a pure function of the two members — re-derive it (and keep
  // the MultiSigPublicKey for signing) whenever the members change.
  const subaccount = useMemo<{ address: string; multisig: MultiSigPublicKey } | null>(() => {
    if (!members || !ownerAddr) return null;
    try {
      const main = publicKeyFromSuiBytes(members.mainPubKey);
      // SELF-HEAL: the MAIN member must be THIS signed-in owner. A member captured by
      // the old buggy code (which mis-parsed the flag-prefixed account.publicKey) — or
      // armed under a different sign-in — won't derive back to ownerAddr. Treat that as
      // NOT armed so the UI offers a clean re-arm, instead of a broken sub-account whose
      // committee the owner's signature can never satisfy (the withdraw "unknown public
      // key"). A correctly-captured member always round-trips (the capture self-checks it).
      if (main.toSuiAddress() !== ownerAddr) return null;
      return formAgentSubaccount(main, publicKeyFromSuiBytes(members.agentPubKey));
    } catch {
      return null; // a malformed stored member → treat as unarmed
    }
  }, [members, ownerAddr]);

  const agentAddress = subaccount?.address ?? null;
  const armed = subaccount != null;

  const reloadMembers = useCallback(() => {
    setMembers(ownerAddr ? getAgentMembers(ownerAddr) : null);
    refresh();
  }, [ownerAddr, refresh]);

  const balanceQuery = useQuery({
    queryKey: ['agent-balance', agentAddress, version],
    enabled: Boolean(agentAddress),
    staleTime: 8_000,
    // keep the prior balance visible while a refresh refetches (no flash to $0)
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<string> => {
      const bal = await client.getBalance({ owner: agentAddress as string, coinType: USDC.type });
      return bal.totalBalance;
    },
  });

  const fund = useCallback(
    async (amountRaw: bigint): Promise<string> => {
      if (!agentAddress) throw new Error('Arm your agent first.');
      const digest = await sendWallet({ amountRaw, to: agentAddress });
      // The funds land at the agent ADDRESS; the gRPC execute returns BEFORE the read
      // node reflects the new balance, so an immediate refetch reads the stale (pre-
      // funding) amount — which is why the balance looked unchanged until a manual
      // page reload. Refetch now AND again once the tx settles (+ a delayed beat).
      refresh();
      void (async () => {
        try {
          await client.waitForTransaction({ digest });
        } catch {
          /* read node will catch up; the delayed refresh is the backstop */
        }
        refresh();
        window.setTimeout(refresh, 2_500);
      })();
      return digest;
    },
    [agentAddress, sendWallet, refresh, client],
  );

  const withdraw = useCallback(
    async (amountRaw: bigint): Promise<string> => {
      if (!subaccount) throw new Error('Arm your agent first.');
      if (!ownerAddr) throw new Error('Not signed in.');
      const have = BigInt(balanceQuery.data ?? '0');
      if (amountRaw <= 0n) throw new Error('Enter an amount to withdraw.');
      if (amountRaw > have) throw new Error('That’s more than the sub-account holds.');
      const digest = await spendFromSubaccount({ multisig: subaccount.multisig, to: ownerAddr, amountRaw });
      // Same read-node lag as fund: the gRPC execute returns before getBalance
      // reflects the debit — refetch now, after the tx settles, and a delayed beat.
      refresh();
      void (async () => {
        try {
          await client.waitForTransaction({ digest });
        } catch {
          /* read node will catch up; the delayed refresh is the backstop */
        }
        refresh();
        window.setTimeout(refresh, 2_500);
      })();
      return digest;
    },
    [subaccount, ownerAddr, balanceQuery.data, spendFromSubaccount, refresh, client],
  );

  const balance: UsdcBalance =
    balanceQuery.data != null
      ? {
          raw: balanceQuery.data,
          ui: Number(balanceQuery.data) / USDC_SCALE,
          usd: (Number(balanceQuery.data) / USDC_SCALE) * usdcPrice,
        }
      : ZERO_BALANCE;

  return {
    agentAddress,
    armed,
    balance,
    loading: Boolean(agentAddress) && balanceQuery.isLoading,
    reloadMembers,
    fund,
    withdraw,
    refresh,
  };
}
