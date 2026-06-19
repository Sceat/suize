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
import { formAgentSubaccount, discoverFundedSubaccounts } from '@suize/x402';
import type { MultiSigPublicKey } from '@mysten/sui/multisig';
import { USDC } from './coins';
import { priceOf, usePrices } from './prices';
import { getAgentMembers } from './payStore';
import type { UsdcBalance } from './payTypes';

/** Google's app-permissions page — where a user revokes the agent's Google access. */
export const GOOGLE_REVOKE_URL = 'https://myaccount.google.com/permissions';

const USDC_SCALE = 10 ** USDC.decimals;
const ZERO_BALANCE: UsdcBalance = { raw: '0', ui: 0, usd: 0 };

/** One outbound spend FROM the sub-account to an external payee — the agent's "Sent"
 *  rows (the spending half of the sub-account ledger), reconstructed from chain. */
export interface AgentSend {
  id: string;
  ts: number;
  amountUi: number;
  to: string;
  txDigest: string;
}

export interface UseAgent {
  /** the derived sub-account (multisig) address, or null until the agent is armed. */
  agentAddress: string | null;
  /** the sub-account's 1-of-2 MultiSigPublicKey (for signing spends FROM it), or null
   *  until armed. Pure function of the two members — re-derived, never trusted state. */
  multisig: MultiSigPublicKey | null;
  /** true once both members are known (the agent OAuth has run once) → the
   *  sub-account exists and can be funded / withdrawn. */
  armed: boolean;
  /** the sub-account's USDC balance — its hard spend cap. Zero state when unarmed. */
  balance: UsdcBalance;
  /** the agent's OWN outbound sends (sub-account → external payee), from chain. Empty
   *  until armed. The main-wallet activity can't show these — they never touch main. */
  sends: AgentSend[];
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
  /** spend `amountRaw` FROM the sub-account to an arbitrary payee `to` (the agent's
   *  send path — MAIN member signs the multisig). The sub-account balance is the cap;
   *  the agent NEVER spends from the owner's main wallet. Throws if unarmed / over cap. */
  spend(to: string, amountRaw: bigint): Promise<string>;
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

/** A confirmed sub-account the signed-in main controls: its address + the signing
 *  multisig (recovered from chain, or derived from the local seed for a just-armed one). */
type Subaccount = { address: string; multisig: MultiSigPublicKey };

/** The resolved agent state from ONE chain read: the PRIMARY sub-account (where the
 *  funds are — the spend/withdraw target), its balance, and the unioned sends. `owner`
 *  stamps WHOSE state this is, so `keepPreviousData` can never leak the previous user's
 *  balance/history across an in-browser account switch (cross-owner data is ignored). */
interface AgentState {
  owner: string;
  primary: Subaccount | null;
  balanceRaw: string;
  sends: AgentSend[];
}

/** The minimal read surface `fetchAgentSends` needs (dapp-kit's SuiClient satisfies it). */
type SendsClient = {
  queryTransactionBlocks(args: {
    filter: { FromAddress: string };
    options?: { showBalanceChanges?: boolean };
    order?: 'ascending' | 'descending';
    limit?: number;
  }): Promise<{
    data: Array<{
      digest: string;
      timestampMs?: string | null;
      balanceChanges?: Array<{ amount: string; coinType: string; owner: unknown }> | null;
    }>;
  }>;
};

/** Reconstruct ONE sub-account's outbound sends (sub → external payee) from chain. The
 *  read is resilient: a fullnode "effect is empty" page error (effect-pruned history)
 *  degrades to no rows rather than throwing, so a single bad tx never blanks activity. */
async function fetchAgentSends(client: SendsClient, sub: string, ownerLc: string): Promise<AgentSend[]> {
  let data: Awaited<ReturnType<SendsClient['queryTransactionBlocks']>>['data'] = [];
  try {
    const res = await client.queryTransactionBlocks({
      filter: { FromAddress: sub },
      options: { showBalanceChanges: true },
      limit: 30,
      order: 'descending',
    });
    data = res.data;
  } catch {
    // a fullnode "effect is empty" page error (effect-pruned history) → no rows, never throw.
    data = [];
  }
  const subLc = sub.toLowerCase();
  const out: AgentSend[] = [];
  for (const tx of data) {
    let subDelta = 0n;
    let payee: { addr: string; amt: bigint } | null = null;
    for (const c of tx.balanceChanges ?? []) {
      if (c.coinType !== USDC.type) continue;
      const addr = (
        typeof c.owner === 'string' ? c.owner : (c.owner as { AddressOwner?: string })?.AddressOwner ?? ''
      ).toLowerCase();
      const amt = BigInt(c.amount);
      if (addr === subLc) {
        subDelta += amt;
        continue;
      }
      // the payee is the largest positive non-sub credit (a fee leg, if any, is smaller).
      if (amt > 0n && (!payee || amt > payee.amt)) payee = { addr, amt };
    }
    // an outflow (sub net-negative) to a REAL payee (not the owner — that's a withdraw).
    if (subDelta >= 0n || !payee || payee.addr === ownerLc) continue;
    out.push({
      id: tx.digest,
      ts: tx.timestampMs ? Number(tx.timestampMs) : 0,
      amountUi: Number(-subDelta) / USDC_SCALE,
      to: payee.addr,
      txDigest: tx.digest,
    });
  }
  return out;
}

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

  // The LOCAL SEED — a {address, multisig} derived from the stored members. This is a
  // BOOTSTRAP HINT ONLY, never the source of truth: it lets a just-armed sub-account
  // show before it has transacted, and is one candidate fed into chain discovery. The
  // self-heal (MAIN member must round-trip to THIS owner) still applies, so a member
  // captured by old buggy code / a different sign-in is ignored rather than trusted.
  const seed = useMemo<Subaccount | null>(() => {
    if (!members || !ownerAddr) return null;
    try {
      const main = publicKeyFromSuiBytes(members.mainPubKey);
      if (main.toSuiAddress() !== ownerAddr) return null;
      return formAgentSubaccount(main, publicKeyFromSuiBytes(members.agentPubKey));
    } catch {
      return null;
    }
  }, [members, ownerAddr]);

  const reloadMembers = useCallback(() => {
    setMembers(ownerAddr ? getAgentMembers(ownerAddr) : null);
    refresh();
  }, [ownerAddr, refresh]);

  // ── THE AGENT STATE — derived from CHAIN, not localStorage. ──
  // The bug this fixes: the sub-account was derived purely from locally-stored members,
  // so a sub-account armed in ANOTHER client (the Deploy app / the MCP, with a different
  // agent session) — even though the SAME human main controls it — was invisible: wrong
  // address queried → no balance, no activity. Now we DISCOVER the main's sub-account(s)
  // from chain (every gasless payment embeds the multisig committee; we keep the ones
  // whose committee includes this main), read each balance, take the PRIMARY (where the
  // funds are — the spend/withdraw target), and UNION their sends. The local seed is
  // merged in so a freshly-armed-but-unfunded sub-account still shows. localStorage is
  // now a hint, not a source of truth.
  const agentQuery = useQuery({
    queryKey: ['agent', ownerAddr, seed?.address ?? '', version],
    enabled: Boolean(ownerAddr),
    staleTime: 8_000,
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<AgentState> => {
      const ownerLc = ownerAddr.toLowerCase();
      const discovered = await discoverFundedSubaccounts(client, ownerAddr, {
        seeds: seed ? [seed.address] : [],
      });
      // Merge chain-discovered subs (multisig recovered from chain) with the local seed
      // (multisig from the stored pubkeys — the only way to sign a never-yet-sent one).
      const byAddr = new Map<string, Subaccount>();
      for (const s of discovered) byAddr.set(s.address.toLowerCase(), s);
      if (seed && !byAddr.has(seed.address.toLowerCase())) byAddr.set(seed.address.toLowerCase(), seed);
      const subs = [...byAddr.values()];
      if (subs.length === 0) return { owner: ownerAddr, primary: null, balanceRaw: '0', sends: [] };

      // Balances — the PRIMARY is the sub-account holding the most (spend/withdraw act on it).
      const balances = await Promise.all(
        subs.map((s) =>
          client
            .getBalance({ owner: s.address, coinType: USDC.type })
            .then((b) => BigInt(b.totalBalance))
            .catch(() => 0n),
        ),
      );
      let pi = 0;
      for (let i = 1; i < subs.length; i++) if (balances[i] > balances[pi]) pi = i;

      // Sends — union across ALL the main's sub-accounts so no agent activity is hidden,
      // whichever client armed which one.
      const sendArrays = await Promise.all(subs.map((s) => fetchAgentSends(client, s.address, ownerLc)));
      const seen = new Set<string>();
      const sends: AgentSend[] = [];
      for (const arr of sendArrays) for (const s of arr) if (!seen.has(s.id)) { seen.add(s.id); sends.push(s); }
      sends.sort((a, b) => b.ts - a.ts);

      return { owner: ownerAddr, primary: subs[pi], balanceRaw: balances[pi].toString(), sends };
    },
  });

  // Use the query data ONLY when it's THIS owner's (keepPreviousData can briefly hold the
  // previous user's resolved state after an in-browser account switch — ignore it, so a
  // cross-owner read is treated as pre-resolution: fail-closed, cap 0n, no leaked balance).
  const data = agentQuery.data?.owner === ownerAddr ? agentQuery.data : undefined;

  // The effective sub-account: the chain-resolved PRIMARY wins; the local seed only
  // bootstraps the pre-resolution window (and a brand-new, never-sent sub-account).
  const primary = data?.primary ?? null;
  const effective = primary ?? seed;
  const agentAddress = effective?.address ?? null;
  const armed = effective != null;
  const balanceRaw = data?.balanceRaw;

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
      if (!effective) throw new Error('Arm your agent first.');
      if (!ownerAddr) throw new Error('Not signed in.');
      const have = BigInt(balanceRaw ?? '0');
      if (amountRaw <= 0n) throw new Error('Enter an amount to withdraw.');
      if (amountRaw > have) throw new Error('That’s more than the sub-account holds.');
      const digest = await spendFromSubaccount({ multisig: effective.multisig, to: ownerAddr, amountRaw });
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
    [effective, ownerAddr, balanceRaw, spendFromSubaccount, refresh, client],
  );

  const spend = useCallback(
    async (to: string, amountRaw: bigint): Promise<string> => {
      if (!effective) throw new Error('Arm your agent first.');
      if (!to) throw new Error('No recipient.');
      const have = BigInt(balanceRaw ?? '0');
      if (amountRaw <= 0n) throw new Error('Enter an amount.');
      // THE CAP: the agent can never spend more than the sub-account holds — and the
      // source is the sub-account multisig, NEVER the owner's main wallet.
      if (amountRaw > have) throw new Error('That’s more than the agent sub-account holds.');
      const digest = await spendFromSubaccount({ multisig: effective.multisig, to, amountRaw });
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
    [effective, balanceRaw, spendFromSubaccount, refresh, client],
  );

  const balance: UsdcBalance =
    balanceRaw != null
      ? {
          raw: balanceRaw,
          ui: Number(balanceRaw) / USDC_SCALE,
          usd: (Number(balanceRaw) / USDC_SCALE) * usdcPrice,
        }
      : ZERO_BALANCE;

  return {
    agentAddress,
    multisig: effective?.multisig ?? null,
    armed,
    balance,
    sends: data?.sends ?? [],
    loading: Boolean(ownerAddr) && agentQuery.isLoading && !data,
    reloadMembers,
    fund,
    withdraw,
    spend,
    refresh,
  };
}
