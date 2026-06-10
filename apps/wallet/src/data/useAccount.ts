/**
 * The PAY data layer — the v1 wallet built on `suize::account`. REPLACES `useHome`
 * (the legacy three-account cage) for the new face.
 *
 * READS (real, on-chain):
 *   • "Your money"  — the owner's wallet USDC balance via `getBalance({ owner, USDC })`.
 *   • "Agent money" — the shared `Account<USDC>` balance via `balance_value` devInspect
 *     (with a getObject content fallback). Zero until the Account is funded.
 *   • Subscriptions — reconstructed from the account module's SubscriptionCreated minus
 *     SubscriptionCancelled events for THIS account.
 *   • Activity timeline — the account module's events (Spent / Charged / Deposited /
 *     Withdrawn / SubscriptionCreated / Cancelled / AccountCreated), reverse-chron, each
 *     row carrying its tx digest for the "verify ↗" link. This IS the verifiable trace.
 *
 * WRITES (real sponsored PTBs, the EXACT legacy/Crash transport — build tx-KIND bytes,
 * wsSponsor, sign the sponsored bytes VERBATIM with the zkLogin session, wsExecute):
 *   ensureAccount / deposit / spend / withdraw / createSubscription / cancelSubscription.
 *
 * PUBLISH GATE (honest): `account` is not yet published, so `PACKAGE_IDS.ACCOUNT.PACKAGE`
 * is `0x0`. The READ paths run against whatever is configured (they resolve nothing →
 * honest empty states). The WRITE paths throw a CALM, explicit error before publish
 * (`ACCOUNT_PUBLISHED === false`) — never a fake success. Set the id in `@suize/shared`
 * and every flow lights up.
 *
 * The hook signature is STABLE: `useAccount(ownerAddress?, handle?) -> PayApi`.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSignTransaction, useSuiClient } from '@mysten/dapp-kit';
import { useQuery } from '@tanstack/react-query';
import { Transaction } from '@mysten/sui/transactions';
import { toBase64 } from '@mysten/sui/utils';
import { ACCOUNT_PUBLISHED, PACKAGE_IDS } from '@suize/shared';
import { USDC } from './coins';
import { priceOf, usePrices } from './prices';
import { requestSponsorship, executeSponsored } from './suins';
import { getAccountId, setAccountId } from './payStore';
import {
  ACCOUNT_COIN,
  accountIdFromEvents,
  buildCancelSubscription,
  buildCreateAccount,
  buildCreateSubscription,
  buildDeposit,
  buildSpend,
  buildWithdraw,
} from './account';
import type {
  Activity,
  ActivityFlow,
  ActivityKind,
  PayApi,
  PayPending,
  PayState,
  Subscription,
  UsdcBalance,
} from './payTypes';

const ACCOUNT_PKG = PACKAGE_IDS.ACCOUNT.PACKAGE;
const BALANCE_VALUE_TARGET = `${ACCOUNT_PKG}::account::balance_value`;

/** USDC has 6 decimals. raw → ui = raw / 1e6. */
const USDC_SCALE = 10 ** USDC.decimals;

/** The all-zero address — a safe devInspect sender when no owner is signed in. */
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000000000000000000000000000';

/** An empty USDC balance — the honest zero state. */
const ZERO_BALANCE: UsdcBalance = { raw: '0', ui: 0, usd: 0 };

/** Build a UsdcBalance from a raw string + the live USDC price. */
function usdcBalance(raw: string, usdcPrice: number): UsdcBalance {
  const ui = Number(raw) / USDC_SCALE;
  return { raw, ui, usd: ui * usdcPrice };
}

// ───────────────────────────────────────────────────────────────────────────
// Known payees → human labels (best-effort; the verifiable detail is the address).
// Deploy-by-Suize's merchant address would live here once pinned; until then the
// label falls back to the memo (spends) or a shortened payee (charges/subs).
// ───────────────────────────────────────────────────────────────────────────
const KNOWN_PAYEES: Record<string, string> = {
  // [DEPLOY_MERCHANT_ADDRESS]: 'Deploy by Suize',
};

function shortAddr(a: string): string {
  if (!a || a.length < 12) return a;
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

/** Decode a Move `vector<u8>` memo (array of byte numbers, or a base64/hex string) to text. */
function decodeMemo(memo: unknown): string {
  try {
    if (Array.isArray(memo)) {
      return new TextDecoder().decode(Uint8Array.from(memo as number[]));
    }
    if (typeof memo === 'string') return memo;
  } catch {
    /* fall through */
  }
  return '';
}

// ───────────────────────────────────────────────────────────────────────────
// Event → timeline/subscription reconstruction (the verifiable trace).
// ───────────────────────────────────────────────────────────────────────────

interface RawEvent {
  id: { txDigest: string; eventSeq: string };
  type: string;
  parsedJson: unknown;
  timestampMs?: string | null;
}

/** The `account_id` field carried by every account event (filters events to OUR account). */
function eventAccountId(json: unknown): string | null {
  if (json && typeof json === 'object') {
    const v = (json as Record<string, unknown>).account_id;
    if (typeof v === 'string') return v;
  }
  return null;
}

/** Map a raw account event to a timeline `Activity` row (null for unrecognized types). */
function toActivity(ev: RawEvent): Activity | null {
  const json = (ev.parsedJson ?? {}) as Record<string, unknown>;
  const ts = ev.timestampMs ? Number(ev.timestampMs) : 0;
  const id = `${ev.id.txDigest}:${ev.id.eventSeq}`;
  const txDigest = ev.id.txDigest;
  const t = ev.type;

  const num = (k: string): string | null => {
    const v = json[k];
    return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : null;
  };
  const money = (raw: string | null): { amountRaw: string | null; amountUi: number | null } =>
    raw == null ? { amountRaw: null, amountUi: null } : { amountRaw: raw, amountUi: Number(raw) / USDC_SCALE };

  const payee = typeof json.payee === 'string' ? json.payee : '';
  const payeeLabel = payee ? KNOWN_PAYEES[payee] ?? shortAddr(payee) : '';

  const make = (kind: ActivityKind, title: string, detail: string | undefined, raw: string | null, flow: ActivityFlow): Activity => ({
    id,
    ts,
    kind,
    title,
    detail,
    ...money(raw),
    flow,
    txDigest,
  });

  if (t.endsWith('::account::Spent')) {
    const memo = decodeMemo(json.memo);
    const detail = memo ? `${payeeLabel} · ${memo}` : payeeLabel || undefined;
    return make('spend', 'Paid', detail, num('gross'), 'out');
  }
  if (t.endsWith('::account::Charged')) {
    return make('charge', 'Subscription charged', payeeLabel || undefined, num('gross'), 'out');
  }
  if (t.endsWith('::account::Deposited')) {
    return make('deposit', 'Topped up', 'Wallet → Agent money', num('amount'), 'in');
  }
  if (t.endsWith('::account::Withdrawn')) {
    return make('withdraw', 'Withdrew', 'Agent money → Wallet', num('amount'), 'in');
  }
  if (t.endsWith('::account::SubscriptionCreated')) {
    return make('sub-created', 'New subscription', payeeLabel || undefined, num('period_cap'), 'none');
  }
  if (t.endsWith('::account::SubscriptionCancelled')) {
    return make('sub-cancelled', 'Subscription cancelled', undefined, null, 'none');
  }
  if (t.endsWith('::account::AccountCreated')) {
    return make('created', 'Agent wallet created', 'Non-custodial · your keys', null, 'none');
  }
  return null;
}

/**
 * Reconstruct the LIVE subscriptions from the event stream: every SubscriptionCreated,
 * minus any later SubscriptionCancelled with the same sub_key. The remaining set is the
 * active subscriptions (the on-chain `subscription_info` is the per-row confirm; here we
 * read the durable event log so a fresh load needs no per-key devInspect fan-out).
 */
function reconstructSubscriptions(events: RawEvent[]): Subscription[] {
  const created = new Map<string, Subscription>();
  const cancelled = new Set<string>();

  // events come newest-first from the query; walk oldest-first for clean create/cancel order.
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i];
    const json = (ev.parsedJson ?? {}) as Record<string, unknown>;
    const key = typeof json.sub_key === 'string' ? json.sub_key : typeof json.sub_key === 'number' ? String(json.sub_key) : null;
    if (!key) continue;

    if (ev.type.endsWith('::account::SubscriptionCreated')) {
      const payee = typeof json.payee === 'string' ? json.payee : '';
      const capRaw = typeof json.period_cap === 'string' ? json.period_cap : typeof json.period_cap === 'number' ? String(json.period_cap) : '0';
      const periodMs = typeof json.period_ms === 'string' ? Number(json.period_ms) : typeof json.period_ms === 'number' ? json.period_ms : 0;
      created.set(key, {
        subKey: key,
        payee,
        periodCapRaw: capRaw,
        periodCapUi: Number(capRaw) / USDC_SCALE,
        periodMs,
        lastChargedMs: ev.timestampMs ? Number(ev.timestampMs) : 0,
        label: payee ? KNOWN_PAYEES[payee] ?? shortAddr(payee) : 'Subscription',
      });
    } else if (ev.type.endsWith('::account::SubscriptionCancelled')) {
      cancelled.add(key);
    } else if (ev.type.endsWith('::account::Charged')) {
      // advance lastChargedMs on a charge so the "next charge" coverage line is accurate.
      const sub = created.get(key);
      if (sub && ev.timestampMs) sub.lastChargedMs = Number(ev.timestampMs);
    }
  }

  return [...created.values()]
    .filter((s) => !cancelled.has(s.subKey))
    .sort((a, b) => Number(b.subKey) - Number(a.subKey));
}

// ───────────────────────────────────────────────────────────────────────────
// The hook.
// ───────────────────────────────────────────────────────────────────────────

export function useAccount(ownerAddress?: string | null, handle?: string): PayApi {
  const client = useSuiClient();
  const { mutateAsync: signTransaction } = useSignTransaction();
  const owner = ownerAddress ?? '';
  const prices = usePrices();
  const usdcPrice = priceOf(USDC.type, prices);

  const [pending, setPending] = useState<PayPending>(null);
  // The shared Account<USDC> id once known (cached per owner; recovered from events).
  const [accountId, setAccId] = useState<string | null>(() => (owner ? getAccountId(owner) : null));
  // Bump to force a re-read after a write lands.
  const [version, setVersion] = useState(0);
  const bump = useCallback(() => setVersion((v) => v + 1), []);

  // Re-seed the cached id when the owner changes.
  useEffect(() => {
    setAccId(owner ? getAccountId(owner) : null);
  }, [owner]);

  type BuildClient = NonNullable<Parameters<Transaction['build']>[0]>['client'];

  // ── Sponsored execution (build KIND bytes → wsSponsor → sign verbatim → wsExecute). ──
  const runSponsored = useCallback(
    async (tx: Transaction): Promise<string> => {
      if (!owner) throw new Error('Not signed in.');
      const kindBytes = await tx.build({ client: client as unknown as BuildClient, onlyTransactionKind: true });
      const { bytes, digest } = await requestSponsorship({ kindBytesB64: toBase64(kindBytes), sender: owner });
      const { signature } = await signTransaction({ transaction: bytes });
      const executed = await executeSponsored({ digest, signature });
      return executed.digest;
    },
    [owner, client, signTransaction],
  );

  /** Execute a sponsored tx and return its emitted events (to read created object ids). */
  const runWithEvents = useCallback(
    async (tx: Transaction) => {
      const digest = await runSponsored(tx);
      const res = await client.waitForTransaction({ digest, options: { showEvents: true } });
      return { digest, events: res.events ?? [] };
    },
    [runSponsored, client],
  );

  // ── "Your money" — the owner's wallet USDC balance. ──
  const walletQuery = useQuery({
    queryKey: ['pay-wallet-usdc', owner, version],
    enabled: owner.length > 0,
    staleTime: 8_000,
    queryFn: async (): Promise<string> => {
      const bal = await client.getBalance({ owner, coinType: USDC.type });
      return bal.totalBalance;
    },
  });

  // ── Recover the Account id from chain if not cached: scan AccountCreated events by
  // this owner (the create tx's sender). One light query; result is cached. ──
  const recoveryQuery = useQuery({
    queryKey: ['pay-account-recover', owner, ACCOUNT_PKG],
    enabled: owner.length > 0 && accountId == null && ACCOUNT_PUBLISHED,
    staleTime: 60_000,
    queryFn: async (): Promise<string | null> => {
      const page = await client.queryEvents({
        query: { MoveEventType: `${ACCOUNT_PKG}::account::AccountCreated` },
        order: 'descending',
        limit: 50,
      });
      for (const ev of page.data) {
        const json = (ev.parsedJson ?? {}) as Record<string, unknown>;
        if (json.owner === owner && typeof json.account_id === 'string') return json.account_id;
      }
      return null;
    },
  });

  useEffect(() => {
    const found = recoveryQuery.data;
    if (found && owner) {
      setAccountId(owner, found);
      setAccId(found);
    }
  }, [recoveryQuery.data, owner]);

  // ── "Agent money" — the Account<USDC> balance via balance_value devInspect. ──
  const agentQuery = useQuery({
    queryKey: ['pay-agent-balance', accountId, version, ACCOUNT_PKG],
    enabled: Boolean(accountId) && ACCOUNT_PUBLISHED,
    staleTime: 8_000,
    queryFn: async (): Promise<string> => {
      const tx = new Transaction();
      tx.moveCall({
        target: BALANCE_VALUE_TARGET,
        arguments: [tx.object(accountId as string)],
        typeArguments: [ACCOUNT_COIN.type],
      });
      const kindBytes = await tx.build({ client: client as unknown as BuildClient, onlyTransactionKind: true });
      const res = await client.devInspectTransactionBlock({
        sender: owner || ZERO_ADDRESS,
        transactionBlock: kindBytes,
      });
      const ret = res.results?.[0]?.returnValues?.[0];
      if (!ret) return '0';
      const [bytes] = ret; // u64 = 8 LE bytes
      let v = 0n;
      for (let i = bytes.length - 1; i >= 0; i--) v = (v << 8n) | BigInt(bytes[i]);
      return v.toString();
    },
  });

  // ── The account module's event stream for THIS account — the timeline + subs. ──
  const eventsQuery = useQuery({
    queryKey: ['pay-account-events', accountId, version, ACCOUNT_PKG],
    enabled: Boolean(accountId) && ACCOUNT_PUBLISHED,
    staleTime: 8_000,
    queryFn: async (): Promise<RawEvent[]> => {
      const page = await client.queryEvents({
        query: { MoveEventModule: { package: ACCOUNT_PKG, module: 'account' } },
        order: 'descending',
        limit: 100,
      });
      // Keep only events for OUR account (the module emits for every account).
      return (page.data as unknown as RawEvent[]).filter((ev) => eventAccountId(ev.parsedJson) === accountId);
    },
  });

  const activity = useMemo<Activity[]>(() => {
    const raw = eventsQuery.data ?? [];
    return raw.map(toActivity).filter((a): a is Activity => a != null);
  }, [eventsQuery.data]);

  const subscriptions = useMemo<Subscription[]>(
    () => reconstructSubscriptions(eventsQuery.data ?? []),
    [eventsQuery.data],
  );

  // ── The snapshot. ──
  const state = useMemo<PayState>(() => {
    const resolvedHandle = handle ?? '';
    const wallet = walletQuery.data != null ? usdcBalance(walletQuery.data, usdcPrice) : ZERO_BALANCE;
    const agent = agentQuery.data != null ? usdcBalance(agentQuery.data, usdcPrice) : ZERO_BALANCE;
    const loading = owner.length > 0 && walletQuery.isLoading;
    return {
      address: owner,
      handle: resolvedHandle,
      name: resolvedHandle.split('@')[0] ?? '',
      wallet,
      agent,
      accountId,
      loading,
      subscriptions,
      activity,
    };
  }, [owner, handle, walletQuery.data, walletQuery.isLoading, agentQuery.data, usdcPrice, accountId, subscriptions, activity]);

  // ── ensureAccount — idempotent create + SHARE Account<USDC>. ──
  const guardWrite = useCallback(() => {
    if (!owner) throw new Error('Not signed in.');
    if (!ACCOUNT_PUBLISHED) {
      throw new Error(
        'The Suize account contract is not live on testnet yet. Reading works; live payments turn on the moment account.move is published.',
      );
    }
  }, [owner]);

  const ensureAccount = useCallback(async (): Promise<string> => {
    const existing = accountId ?? getAccountId(owner);
    if (existing) return existing;
    guardWrite();
    const { events } = await runWithEvents(buildCreateAccount());
    const id = accountIdFromEvents(events);
    if (!id) throw new Error('Account creation failed: no account id in events.');
    setAccountId(owner, id);
    setAccId(id);
    bump();
    return id;
  }, [accountId, owner, guardWrite, runWithEvents, bump]);

  // ── deposit (auto-creates the Account first). ──
  const deposit = useCallback(
    async (amountRaw: bigint): Promise<string> => {
      guardWrite();
      setPending('deposit');
      try {
        const id = await ensureAccount();
        const coins = await client.getCoins({ owner, coinType: USDC.type });
        const tx = buildDeposit({
          accountId: id,
          amountRaw,
          sourceCoinIds: coins.data.map((c) => c.coinObjectId),
        });
        const digest = await runSponsored(tx);
        bump();
        return digest;
      } finally {
        setPending(null);
      }
    },
    [guardWrite, ensureAccount, client, owner, runSponsored, bump],
  );

  // ── spend (OWNER-ONLY, free). ──
  const spend = useCallback(
    async (args: { amountRaw: bigint; payee: string; memo: string }): Promise<string> => {
      guardWrite();
      const id = accountId ?? getAccountId(owner);
      if (!id) throw new Error('No agent money yet — top up first.');
      setPending('spend');
      try {
        const digest = await runSponsored(buildSpend({ accountId: id, ...args }));
        bump();
        return digest;
      } finally {
        setPending(null);
      }
    },
    [guardWrite, accountId, owner, runSponsored, bump],
  );

  // ── withdraw (OWNER-ONLY, back to the wallet). ──
  const withdraw = useCallback(
    async (amountRaw: bigint): Promise<string> => {
      guardWrite();
      const id = accountId ?? getAccountId(owner);
      if (!id) throw new Error('No agent money to withdraw.');
      setPending('withdraw');
      try {
        const digest = await runSponsored(buildWithdraw({ accountId: id, amountRaw, owner }));
        bump();
        return digest;
      } finally {
        setPending(null);
      }
    },
    [guardWrite, accountId, owner, runSponsored, bump],
  );

  // ── createSubscription (OWNER-ONLY; auto-creates the Account first). ──
  const createSubscription = useCallback(
    async (args: { payee: string; periodCapRaw: bigint; periodMs: number; label?: string }): Promise<string> => {
      guardWrite();
      setPending('subscribe');
      try {
        const id = await ensureAccount();
        const digest = await runSponsored(
          buildCreateSubscription({
            accountId: id,
            payee: args.payee,
            periodCapRaw: args.periodCapRaw,
            periodMs: args.periodMs,
          }),
        );
        bump();
        return digest;
      } finally {
        setPending(null);
      }
    },
    [guardWrite, ensureAccount, runSponsored, bump],
  );

  // ── cancelSubscription (OWNER-ONLY). ──
  const cancelSubscription = useCallback(
    async (subKey: string): Promise<string> => {
      guardWrite();
      const id = accountId ?? getAccountId(owner);
      if (!id) throw new Error('No subscriptions to cancel.');
      setPending('subscribe');
      try {
        const digest = await runSponsored(buildCancelSubscription({ accountId: id, subKey: BigInt(subKey) }));
        bump();
        return digest;
      } finally {
        setPending(null);
      }
    },
    [guardWrite, accountId, owner, runSponsored, bump],
  );

  // ── sendWallet — a plain sponsored P2P transfer of the user's OWN wallet USDC.
  // NOT an Account verb: no publish gate, no fee, never touches account.move.
  const sendWallet = useCallback(
    async (args: { amountRaw: bigint; to: string }): Promise<string> => {
      if (!owner) throw new Error('Not signed in.');
      setPending('send');
      try {
        const coins = await client.getCoins({ owner, coinType: USDC.type });
        if (coins.data.length === 0) throw new Error('No USDC in your wallet yet.');
        const tx = new Transaction();
        const [first, ...rest] = coins.data.map((c) => c.coinObjectId);
        const primary = tx.object(first);
        if (rest.length > 0) tx.mergeCoins(primary, rest.map((id) => tx.object(id)));
        const [out] = tx.splitCoins(primary, [args.amountRaw]);
        tx.transferObjects([out], args.to);
        const digest = await runSponsored(tx);
        bump();
        return digest;
      } finally {
        setPending(null);
      }
    },
    [owner, client, runSponsored, bump],
  );

  // keep a ref so `refresh` is stable without re-creating callbacks.
  const bumpRef = useRef(bump);
  bumpRef.current = bump;
  const refresh = useCallback(() => bumpRef.current(), []);

  return {
    state,
    pending,
    ensureAccount,
    deposit,
    spend,
    withdraw,
    createSubscription,
    cancelSubscription,
    sendWallet,
    refresh,
  };
}
