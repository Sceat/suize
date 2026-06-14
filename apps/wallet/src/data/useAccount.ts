/**
 * The PAY data layer — the v1 wallet on the STANDALONE `subs::subscription` module
 * + a plain wallet-USDC balance. REPLACES the retired `suize::account` cage (the
 * funded shared Account + its deposit/withdraw/spend verbs are GONE — there is no
 * on-chain "sub-account" balance anymore).
 *
 * READS (real, on-chain):
 *   • "Your money"  — the owner's wallet USDC balance via `getBalance`.
 *   • Subscriptions — live `Subscription<USDC>` Party objects the owner holds,
 *     via `getOwnedObjects` (StructType-filtered — proven for Party objects).
 *   • Activity      — the subs lifecycle events (SubscriptionCreated/Renewed/
 *     Cancelled for THIS owner) MERGED with sent payments (queryTransactionBlocks
 *     FromAddress, the negative-USDC `balanceChanges` rows). Reverse-chron, each
 *     row carrying its tx digest for the "verify ↗" link. This IS the trace.
 *
 * WRITES:
 *   • sendWallet — a GASLESS single-output P2P transfer (vanilla-x402 Address-
 *     Balance `send_funds` via @suize/x402; the payer's OWN session signs the
 *     gasless bytes, the chain covers gas; no fee, no sponsor). FREE.
 *   • cancelSubscription — `subs::subscription::cancel`, ridden over the WS sponsor
 *     path (`sponsored.ts`). Create + silent renew live in `useSubscriptions`.
 *
 * The hook signature is STABLE: `useAccount(ownerAddress?, handle?) -> PayApi`.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSignTransaction, useSuiClient } from '@mysten/dapp-kit';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { Transaction } from '@mysten/sui/transactions';
import { fromBase64 } from '@mysten/sui/utils';
import { SUBS_PUBLISHED } from '@suize/shared';
import { buildGaslessOutputs, assertUnsignedBytesSafe, combineForMultisig } from '@suize/x402';
import type { MultiSigPublicKey } from '@mysten/sui/multisig';
import { resolveTreasury } from '@suize/shared';
import { NETWORK } from '../lib/env';
import { USDC } from './coins';
import { priceOf, usePrices } from './prices';
import { runSponsored, type SignTransaction } from './sponsored';
import { buildCancel, listSubscriptions, type OwnedObjectsClient } from './subs';
import { grpc } from './grpc';
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
import { PACKAGE_IDS } from '@suize/shared';

const SUBS_PKG = PACKAGE_IDS.SUBS.PACKAGE;

/** USDC has 6 decimals. raw → ui = raw / 1e6. */
const USDC_SCALE = 10 ** USDC.decimals;

/** An empty USDC balance — the honest zero state. */
const ZERO_BALANCE: UsdcBalance = { raw: '0', ui: 0, usd: 0 };

/** How far back the activity feed scans (events + sent + received payments). */
const EVENTS_SCAN_CAP = 600;
const SENT_SCAN_CAP = 80;
const RECEIVED_SCAN_CAP = 80;

/** Does this address receive the Suize rail fee? Presence of a fee output is what
 *  separates a PAYMENT (paid/charged) from a plain transfer (sent/received). Matched
 *  against the live-resolved `treasury@suize` ONLY. '' (not yet resolved) → no match,
 *  so everything reads as a plain transfer until it resolves: the honest fallback. */
const makeIsTreasury =
  (treasuryLc: string) =>
  (addr: string): boolean =>
    treasuryLc !== '' && addr.toLowerCase() === treasuryLc;

/** Build a UsdcBalance from a raw string + the live USDC price. */
function usdcBalance(raw: string, usdcPrice: number): UsdcBalance {
  const ui = Number(raw) / USDC_SCALE;
  return { raw, ui, usd: ui * usdcPrice };
}

function shortAddr(a: string): string {
  if (!a || a.length < 12) return a;
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

// ───────────────────────────────────────────────────────────────────────────
// Activity reconstruction (the verifiable trace) — subs events + sent payments.
// ───────────────────────────────────────────────────────────────────────────

interface RawEvent {
  id: { txDigest: string; eventSeq: string };
  type: string;
  parsedJson: unknown;
  timestampMs?: string | null;
}

/** Map a raw subs event to a timeline `Activity` row (null for unrecognized). */
function subsEventToActivity(ev: RawEvent): Activity | null {
  const json = (ev.parsedJson ?? {}) as Record<string, unknown>;
  const ts = ev.timestampMs ? Number(ev.timestampMs) : 0;
  const id = `${ev.id.txDigest}:${ev.id.eventSeq}`;
  const txDigest = ev.id.txDigest;
  const t = ev.type;

  const rawAmount = (): string | null => {
    const v = json.amount;
    return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : null;
  };
  const merchant = typeof json.merchant === 'string' ? json.merchant : '';
  const label = merchant ? shortAddr(merchant) : '';

  const make = (
    kind: ActivityKind,
    title: string,
    detail: string | undefined,
    raw: string | null,
    flow: ActivityFlow,
  ): Activity => ({
    id,
    ts,
    kind,
    title,
    detail,
    counterparty: merchant || undefined,
    amountRaw: raw,
    amountUi: raw == null ? null : Number(raw) / USDC_SCALE,
    flow,
    txDigest,
  });

  if (t.endsWith('::subscription::SubscriptionCreated')) {
    return make('sub-created', 'Subscribed', label || undefined, rawAmount(), 'out');
  }
  if (t.endsWith('::subscription::SubscriptionRenewed')) {
    return make('sub-renewed', 'Renewed', label || undefined, rawAmount(), 'out');
  }
  if (t.endsWith('::subscription::SubscriptionCancelled')) {
    return make('sub-cancelled', 'Subscription cancelled', label || undefined, null, 'none');
  }
  return null;
}

/** A queryTransactionBlocks node, narrowed to what the sent-payment row needs. */
interface TxNode {
  digest: string;
  timestampMs?: string | null;
  balanceChanges?: Array<{
    coinType: string;
    owner?: { AddressOwner?: string } | string;
    amount: string;
  }> | null;
}

/** One USDC balance-change row, narrowed to {address, amount}. */
function usdcDelta(c: NonNullable<TxNode['balanceChanges']>[number]): { addr: string; amt: bigint } | null {
  if (c.coinType !== USDC.type) return null;
  const addr = typeof c.owner === 'string' ? c.owner : c.owner?.AddressOwner ?? '';
  return { addr, amt: BigInt(c.amount) };
}

/**
 * Map an OUTBOUND tx (owner net-negative USDC) to a `sent` (plain transfer) or `paid`
 * (rail payment) row. The split is the treasury fee output: if the Suize treasury was
 * credited USDC in this tx, it's a PAYMENT (`paid`), else a plain `sent`. A subs
 * create/renew also debits USDC, so the caller SKIPS digests already covered by a
 * subs event. "To whom" is the largest POSITIVE non-owner, NON-treasury USDC credit
 * (the merchant, never the fee output); when the treasury is the ONLY credit
 * (a first-party charge, merchant == treasury) it stands as the counterparty. The
 * amount is the owner's full outflow — what you paid, fee included. */
function sentTxToActivity(node: TxNode, owner: string, treasuryLc: string): Activity | null {
  const ownerLc = owner.toLowerCase();
  const isTreasury = makeIsTreasury(treasuryLc);
  let delta = 0n;
  let merchant: { addr: string; amt: bigint } | null = null;
  let treasuryCredit: { addr: string; amt: bigint } | null = null;
  let feePaid = false;
  for (const raw of node.balanceChanges ?? []) {
    const c = usdcDelta(raw);
    if (!c) continue;
    if (c.addr.toLowerCase() === ownerLc) {
      delta += c.amt;
      continue;
    }
    if (c.amt <= 0n) continue;
    if (isTreasury(c.addr)) {
      feePaid = true;
      treasuryCredit = c;
    } else if (!merchant || c.amt > merchant.amt) {
      merchant = c;
    }
  }
  if (delta >= 0n) return null; // not a net USDC outflow from the owner
  const out = (-delta).toString();
  // merchant wins; only when there's no non-treasury credit does the treasury stand in.
  const counterparty = (merchant ?? treasuryCredit)?.addr;
  return {
    id: node.digest,
    ts: node.timestampMs ? Number(node.timestampMs) : 0,
    kind: feePaid ? 'paid' : 'sent',
    title: feePaid ? 'Paid' : 'Sent',
    // immediate fallback "to whom" (short addr) — upgraded to a @suize handle once
    // the reverse-name lookup resolves (see `namesQuery`).
    detail: counterparty ? shortAddr(counterparty) : undefined,
    counterparty,
    amountRaw: out,
    amountUi: Number(out) / USDC_SCALE,
    flow: 'out',
    txDigest: node.digest,
  };
}

/**
 * Map an INBOUND tx (owner net-POSITIVE USDC) to a `received` (someone sent you money)
 * or `charged` (someone PAID YOU on the rail) row — the merchant leg the business side
 * lives on. The split is again the treasury fee output: a rail payment credits the
 * treasury, a plain transfer doesn't. "From whom" is the payer (the largest-magnitude
 * NEGATIVE non-owner USDC delta). The amount is the owner's net inflow — what actually
 * landed in your balance (price minus the 2% on a rail charge). */
function receivedTxToActivity(node: TxNode, owner: string, treasuryLc: string): Activity | null {
  const ownerLc = owner.toLowerCase();
  const isTreasury = makeIsTreasury(treasuryLc);
  let delta = 0n;
  let payer: { addr: string; amt: bigint } | null = null;
  let feePaid = false;
  for (const raw of node.balanceChanges ?? []) {
    const c = usdcDelta(raw);
    if (!c) continue;
    if (c.addr.toLowerCase() === ownerLc) {
      delta += c.amt;
      continue;
    }
    if (c.amt > 0n && isTreasury(c.addr)) feePaid = true;
    // the payer is the most-negative non-owner leg (someone's funds went out to us).
    if (c.amt < 0n && (!payer || c.amt < payer.amt)) payer = c;
  }
  if (delta <= 0n) return null; // not a net USDC inflow to the owner
  const inc = delta.toString();
  const counterparty = payer?.addr;
  return {
    id: node.digest,
    ts: node.timestampMs ? Number(node.timestampMs) : 0,
    kind: feePaid ? 'charged' : 'received',
    title: feePaid ? 'Payment' : 'Received',
    detail: counterparty ? shortAddr(counterparty) : undefined,
    counterparty,
    amountRaw: inc,
    amountUi: Number(inc) / USDC_SCALE,
    flow: 'in',
    txDigest: node.digest,
  };
}

/**
 * Pick the best human display name for a recipient from its SuiNS reverse records:
 * a `*.suize.sui` leaf renders as the native `<name>@suize` handle; any other SuiNS
 * name shows as-is; no name → null (the caller keeps the short address). */
function formatRecipientName(names: string[]): string | null {
  const suize = names.find((n) => n.endsWith('.suize.sui'));
  if (suize) return `${suize.slice(0, -'.suize.sui'.length)}@suize`;
  return names.find((n) => n.endsWith('.sui')) ?? null;
}

/** How many distinct counterparties we reverse-resolve per load (1 RPC each, the
 *  rest keep their short address — bounds the lookup fan-out on a busy ledger). */
const NAME_RESOLVE_CAP = 30;

// ───────────────────────────────────────────────────────────────────────────
// The hook.
// ───────────────────────────────────────────────────────────────────────────

/**
 * An OPTIMISTIC wallet send — applied to the UI the instant the user confirms,
 * reconciled against the chain. `snapshotRaw` is the real wallet balance (raw) at
 * send time; the send is "balance-reflected" once the refetched real balance has
 * dropped to/below `snapshotRaw - amountRaw` (so we stop subtracting and never
 * double-count). `digest` arrives after execute; the row shows "confirming…" until
 * the real sent-tx feed surfaces that digest, then the real row takes over.
 */
interface OptimisticSend {
  key: string;
  amountRaw: bigint;
  amountUi: number;
  label: string;
  ts: number;
  snapshotRaw: string;
  digest: string | null;
}

/** Safety net: an optimistic row never outlives the chain truth by more than this —
 *  if it neither reconciles nor fails, it's dropped and the real balance is shown. */
const OPTIMISTIC_TTL_MS = 30_000;

export function useAccount(ownerAddress?: string | null, handle?: string): PayApi {
  const client = useSuiClient();
  const { mutateAsync: signTransactionRaw } = useSignTransaction();
  const owner = ownerAddress ?? '';
  const prices = usePrices();
  const usdcPrice = priceOf(USDC.type, prices);

  const [pending, setPending] = useState<PayPending>(null);
  const [version, setVersion] = useState(0);
  const bump = useCallback(() => setVersion((v) => v + 1), []);

  // Optimistic sends — instant UI, reconciled against the chain (see below).
  const [optimistic, setOptimistic] = useState<OptimisticSend[]>([]);
  // latest real wallet balance (raw), readable from sendWallet without a dep churn.
  const balanceRef = useRef<string | null>(null);

  // dapp-kit's signer thunk, typed for the sponsored helper (base64-in/sig-out).
  const signTransaction = signTransactionRaw as unknown as SignTransaction;

  // ── "Your money" — the owner's wallet USDC balance. ──
  const walletQuery = useQuery({
    queryKey: ['pay-wallet-usdc', owner, version],
    enabled: owner.length > 0,
    staleTime: 8_000,
    // keep prior data on a `version`-bump refetch (no empty flash → no jitter)
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<string> => {
      const bal = await client.getBalance({ owner, coinType: USDC.type });
      return bal.totalBalance;
    },
  });

  // ── Subscriptions — live Party objects the owner holds. ──
  const subsQuery = useQuery({
    queryKey: ['pay-subscriptions', owner, version, SUBS_PKG],
    enabled: owner.length > 0 && SUBS_PUBLISHED,
    staleTime: 8_000,
    // keep prior data on a `version`-bump refetch (no empty flash → no jitter)
    placeholderData: keepPreviousData,
    queryFn: (): Promise<Subscription[]> =>
      listSubscriptions(client as unknown as OwnedObjectsClient, owner),
  });

  // ── The subs event stream for THIS owner (the timeline's recurring rows). ──
  const eventsQuery = useQuery({
    queryKey: ['pay-subs-events', owner, version, SUBS_PKG],
    enabled: owner.length > 0 && SUBS_PUBLISHED,
    staleTime: 8_000,
    // keep prior data on a `version`-bump refetch (no empty flash → no jitter)
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<RawEvent[]> => {
      const mine: RawEvent[] = [];
      const structs = ['SubscriptionCreated', 'SubscriptionRenewed', 'SubscriptionCancelled'];
      const ownerLc = owner.toLowerCase();
      for (const struct of structs) {
        let cursor: { txDigest: string; eventSeq: string } | null | undefined = undefined;
        let scanned = 0;
        while (scanned < EVENTS_SCAN_CAP) {
          const page = await client.queryEvents({
            query: { MoveEventType: `${SUBS_PKG}::subscription::${struct}` },
            order: 'descending',
            limit: 50,
            cursor: cursor ?? undefined,
          });
          for (const ev of page.data as unknown as RawEvent[]) {
            const j = (ev.parsedJson ?? {}) as Record<string, unknown>;
            if (typeof j.owner === 'string' && j.owner.toLowerCase() === ownerLc) mine.push(ev);
          }
          scanned += page.data.length;
          if (!page.hasNextPage || !page.nextCursor) break;
          cursor = page.nextCursor;
        }
      }
      return mine;
    },
  });

  // ── The treasury — RESOLVED live from `treasury@suize`, the ONE source of truth
  //    (no hardcoded address, no CLI). '' until it resolves → rows read as plain
  //    transfers meanwhile. Display-only: decides Payment-vs-transfer, never a money
  //    path. The labelling re-tags (no refetch) the instant it resolves. ──
  const treasuryQuery = useQuery({
    queryKey: ['suize-treasury', NETWORK],
    staleTime: Infinity, // the treasury is effectively fixed — resolve once per session
    queryFn: async (): Promise<string> => (await resolveTreasury(client)) ?? '',
  });
  const treasuryLc = treasuryQuery.data ?? '';

  // ── Sent payments — the owner's recent txs (NET USDC outflow). Raw nodes; the
  //    sent-vs-paid labelling happens in the merge memo, against `treasuryLc`. ──
  const sentQuery = useQuery({
    queryKey: ['pay-sent', owner, version],
    enabled: owner.length > 0,
    staleTime: 8_000,
    // keep prior data on a `version`-bump refetch (no empty flash → no jitter)
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<TxNode[]> => {
      const res = await client.queryTransactionBlocks({
        filter: { FromAddress: owner },
        options: { showBalanceChanges: true },
        order: 'descending',
        limit: SENT_SCAN_CAP,
      });
      return res.data as unknown as TxNode[];
    },
  });

  // ── Received payments — the owner's recent txs (NET USDC inflow): a plain transfer
  //    in, or a rail charge you got paid. Raw nodes; labelled in the merge memo. ──
  const receivedQuery = useQuery({
    queryKey: ['pay-received', owner, version],
    enabled: owner.length > 0,
    staleTime: 8_000,
    // keep prior data on a `version`-bump refetch (no empty flash → no jitter)
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<TxNode[]> => {
      const res = await client.queryTransactionBlocks({
        filter: { ToAddress: owner },
        options: { showBalanceChanges: true },
        order: 'descending',
        limit: RECEIVED_SCAN_CAP,
      });
      return res.data as unknown as TxNode[];
    },
  });

  // the real sent-tx digests — the reconciliation clock for optimistic rows.
  const sentDigests = useMemo(
    () => new Set((sentQuery.data ?? []).map((n) => n.digest)),
    [sentQuery.data],
  );

  // ── The merged, de-duped activity timeline. ──
  // Subs events are authoritative; a sent/received row for the SAME digest as a subs
  // event is a duplicate (the create/renew debit) → drop it. An outbound row wins over
  // an inbound one for a shared digest (a tx is net one way). Labelling reacts to the
  // resolved treasury, so rows re-tag (no refetch) the instant it resolves.
  const activity = useMemo<Activity[]>(() => {
    const subsRows = (eventsQuery.data ?? [])
      .map(subsEventToActivity)
      .filter((a): a is Activity => a != null);
    const seen = new Set(subsRows.map((r) => r.txDigest));
    const map = (nodes: TxNode[], build: (n: TxNode) => Activity | null): Activity[] => {
      const out: Activity[] = [];
      for (const node of nodes) {
        if (seen.has(node.digest)) continue;
        const row = build(node);
        if (row) {
          seen.add(node.digest);
          out.push(row);
        }
      }
      return out;
    };
    const sentRows = map(sentQuery.data ?? [], (n) => sentTxToActivity(n, owner, treasuryLc));
    const receivedRows = map(receivedQuery.data ?? [], (n) => receivedTxToActivity(n, owner, treasuryLc));
    // optimistic rows the real feed hasn't surfaced yet → render "confirming…".
    const optimisticRows: Activity[] = optimistic
      .filter((o) => !(o.digest && sentDigests.has(o.digest)))
      .map((o) => ({
        id: `optimistic:${o.key}`,
        ts: o.ts,
        kind: 'sent',
        title: 'Sent',
        detail: o.label,
        amountRaw: o.amountRaw.toString(),
        amountUi: o.amountUi,
        flow: 'out',
        txDigest: o.digest ?? '',
        pending: true,
      }));
    return [...optimisticRows, ...subsRows, ...sentRows, ...receivedRows].sort((a, b) => b.ts - a.ts);
  }, [eventsQuery.data, sentQuery.data, receivedQuery.data, owner, treasuryLc, optimistic, sentDigests]);

  // ── "To whom" — reverse-resolve the distinct counterparties to @suize handles. ──
  // Each row already carries a short-address fallback; this upgrades the ones that
  // hold a SuiNS reverse record to a real handle. One RPC per unique address (capped),
  // cached long since names rarely change. The query key is the address list, so it
  // only re-runs when a new counterparty appears.
  const counterpartyAddrs = useMemo(() => {
    const seen = new Set<string>();
    for (const a of activity) if (a.counterparty) seen.add(a.counterparty);
    return [...seen].slice(0, NAME_RESOLVE_CAP);
  }, [activity]);

  const namesQuery = useQuery({
    queryKey: ['pay-names', counterpartyAddrs],
    enabled: counterpartyAddrs.length > 0,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<Record<string, string>> => {
      const map: Record<string, string> = {};
      await Promise.all(
        counterpartyAddrs.map(async (addr) => {
          try {
            const { data } = await client.resolveNameServiceNames({ address: addr, limit: 5 });
            const name = formatRecipientName(data ?? []);
            if (name) map[addr.toLowerCase()] = name;
          } catch {
            /* a flaky reverse lookup just leaves the short-address fallback in place */
          }
        }),
      );
      return map;
    },
  });

  // Overlay the resolved handles onto each row's `detail` (the short address stays
  // when a counterparty has no reverse record — never a blank "to whom").
  const names = namesQuery.data;
  const resolvedActivity = useMemo<Activity[]>(() => {
    if (!names) return activity;
    return activity.map((a) => {
      if (!a.counterparty) return a;
      const human = names[a.counterparty.toLowerCase()];
      return human ? { ...a, detail: human } : a;
    });
  }, [activity, names]);

  // RECONCILE: a send is "balance-reflected" once the refetched real balance has
  // dropped to/below snapshot − amount (so we stop subtracting; never double-count).
  const optimisticOutflow = useMemo(() => {
    const realRaw = walletQuery.data;
    return optimistic.reduce((sum, o) => {
      const reflected = realRaw != null && BigInt(realRaw) <= BigInt(o.snapshotRaw) - o.amountRaw;
      return reflected ? sum : sum + o.amountRaw;
    }, 0n);
  }, [optimistic, walletQuery.data]);

  // Drop entries once FULLY reconciled (balance reflected AND the digest is in the
  // real sent feed) — the real row + real balance then carry the truth, no flicker.
  useEffect(() => {
    if (optimistic.length === 0) return;
    const realRaw = walletQuery.data;
    const next = optimistic.filter((o) => {
      const reflected = realRaw != null && BigInt(realRaw) <= BigInt(o.snapshotRaw) - o.amountRaw;
      const inFeed = o.digest != null && sentDigests.has(o.digest);
      return !(reflected && inFeed);
    });
    if (next.length !== optimistic.length) setOptimistic(next);
  }, [optimistic, walletQuery.data, sentDigests]);

  const subscriptions = useMemo<Subscription[]>(() => subsQuery.data ?? [], [subsQuery.data]);

  // keep the latest real balance readable from sendWallet (the optimistic snapshot)
  // without making sendWallet's identity churn on every balance refetch.
  balanceRef.current = walletQuery.data ?? null;

  // ── The snapshot. ──
  const state = useMemo<PayState>(() => {
    const resolvedHandle = handle ?? '';
    // displayed balance = real − the still-unreflected optimistic outflow (clamped
    // at 0). Once the chain reflects a send, its amount drops out of the outflow,
    // so the real balance carries through with no double-subtraction.
    let wallet = ZERO_BALANCE;
    if (walletQuery.data != null) {
      const raw = BigInt(walletQuery.data) - optimisticOutflow;
      wallet = usdcBalance((raw < 0n ? 0n : raw).toString(), usdcPrice);
    }
    const loading = owner.length > 0 && walletQuery.isLoading;
    return {
      address: owner,
      handle: resolvedHandle,
      name: resolvedHandle.split('@')[0] ?? '',
      wallet,
      loading,
      subscriptions,
      activity: resolvedActivity,
    };
  }, [owner, handle, walletQuery.data, walletQuery.isLoading, usdcPrice, subscriptions, resolvedActivity, optimisticOutflow]);

  // ── The gasless send core (single source) — build the Address-Balance
  // `send_funds` PTB (gasless via @suize/x402), prove it is safe + gasless
  // (assertUnsignedBytesSafe), sign the EXACT bytes locally, then execute over the
  // gRPC client. `combine` wraps a member signature into a 1-of-2 multisig signature
  // when the SENDER is the agent sub-account (the MAIN member signs alone); for a
  // plain wallet send it is undefined and the lone owner signature stands. No fee,
  // no sponsor — the chain covers gas.
  const sendGasless = useCallback(
    async (args: {
      sender: string;
      to: string;
      amountRaw: bigint;
      combine?: (sig: string) => string;
    }): Promise<string> => {
      const outputs = [{ to: args.to, amount: args.amountRaw.toString() }];
      const g = grpc();
      const { bytes } = await buildGaslessOutputs({
        client: g,
        sender: args.sender,
        asset: USDC.type,
        outputs,
      });
      // The pre-sign guard (mandatory): never sign bytes that aren't gasless + exact.
      await assertUnsignedBytesSafe({ client: g, bytesB64: bytes, sender: args.sender, asset: USDC.type, outputs });
      // dapp-kit's Enoki wallet does `setSenderIfNotSet` — the sender is already set
      // (owner OR multisig), so it signs these EXACT bytes with the MAIN session key.
      const { signature } = await signTransaction({ transaction: bytes });
      const exec = await g.executeTransaction({
        transaction: fromBase64(bytes),
        signatures: [args.combine ? args.combine(signature) : signature],
        include: { effects: true },
      });
      const tx = exec.$kind === 'Transaction' ? exec.Transaction : exec.FailedTransaction;
      const digest = tx?.digest ?? (await Transaction.from(fromBase64(bytes)).getDigest());
      // The gRPC EXECUTE node returns before the JSON-RPC READ node (balance) and
      // the indexer (the sent-tx activity feed) reflect the tx — so a bump() alone
      // refetches PRE-send state and the UI looks unchanged. Bump immediately
      // (optimistic), then refresh AGAIN in the BACKGROUND once the read node sees
      // the digest (fresh balance) plus once more after a beat for the indexer-
      // backed activity row — without making the caller's "Sent" wait on reads.
      bump();
      void (async () => {
        try {
          await client.waitForTransaction({ digest });
        } catch {
          /* read node will catch up; the delayed bump is the backstop */
        }
        bump();
        setTimeout(() => bump(), 2_500);
      })();
      return digest;
    },
    [client, signTransaction, bump],
  );

  // ── sendWallet — a GASLESS single-output P2P USDC transfer (vanilla x402). ──
  // OPTIMISTIC: drop the amount from the displayed balance + prepend a
  // "confirming…" activity row the instant the user confirms; reconcile against
  // the chain (balance math + the cleanup effect below); roll back on failure.
  const sendWallet = useCallback(
    async (args: { amountRaw: bigint; to: string; label?: string }): Promise<string> => {
      if (!owner) throw new Error('Not signed in.');
      setPending('send');
      const key = crypto.randomUUID();
      const entry: OptimisticSend = {
        key,
        amountRaw: args.amountRaw,
        amountUi: Number(args.amountRaw) / 1e6,
        label: args.label || `${args.to.slice(0, 6)}…${args.to.slice(-4)}`,
        ts: Date.now(),
        snapshotRaw: balanceRef.current ?? '0',
        digest: null,
      };
      setOptimistic((prev) => [entry, ...prev]);
      // safety net: never let an unreconciled optimistic row outlive chain truth.
      const ttl = setTimeout(
        () => setOptimistic((prev) => prev.filter((e) => e.key !== key)),
        OPTIMISTIC_TTL_MS,
      );
      try {
        const digest = await sendGasless({ sender: owner, to: args.to, amountRaw: args.amountRaw });
        setOptimistic((prev) => prev.map((e) => (e.key === key ? { ...e, digest } : e)));
        return digest;
      } catch (e) {
        clearTimeout(ttl);
        setOptimistic((prev) => prev.filter((e) => e.key !== key)); // rollback
        throw e;
      } finally {
        setPending(null);
      }
    },
    [owner, sendGasless],
  );

  // ── spendFromSubaccount — a GASLESS send FROM the agent's 1-of-2 multisig
  // sub-account, signed by the MAIN member ALONE then combined (threshold 1). This
  // is the AI's spend primitive AND the user's one-tap Withdraw (sender = the
  // sub-account, recipient = the merchant / the user's own wallet). ──
  const spendFromSubaccount = useCallback(
    async (args: { multisig: MultiSigPublicKey; to: string; amountRaw: bigint }): Promise<string> => {
      if (!owner) throw new Error('Not signed in.');
      setPending('send');
      try {
        return await sendGasless({
          sender: args.multisig.toSuiAddress(),
          to: args.to,
          amountRaw: args.amountRaw,
          combine: (sig) => combineForMultisig(args.multisig, sig),
        });
      } catch (e) {
        // "unknown public key" = the signing identity isn't one of the sub-account's
        // 1-of-2 members. Dump the committee vs the signer (the definitive diagnostic:
        // does the owner's address appear in the committee?) and surface an honest,
        // non-cryptic error. This fires ONLY on real failure — no risk of false-trip.
        const msg = (e as Error)?.message ?? '';
        if (/unknown public key/i.test(msg)) {
          try {
            const committee = args.multisig
              .getPublicKeys()
              .map((m) => m.publicKey.toSuiAddress())
              .join(', ');
            console.error(
              `[withdraw] signer not in the sub-account committee.\n  signer (owner): ${owner}\n  committee:      ${committee}\n  sub-account:    ${args.multisig.toSuiAddress()}`,
            );
          } catch {
            /* best-effort diagnostic */
          }
          throw new Error(
            "Couldn't authorize this from your agent's sub-account — the signing key isn't one of its two members. Re-arm the agent; if it still fails, the console has the committee-vs-signer dump.",
          );
        }
        throw e;
      } finally {
        setPending(null);
      }
    },
    [owner, sendGasless],
  );

  // ── cancelSubscription — `subs::subscription::cancel` (sponsored). ──
  const cancelSubscription = useCallback(
    async (subId: string): Promise<string> => {
      if (!owner) throw new Error('Not signed in.');
      if (!SUBS_PUBLISHED) throw new Error('Subscriptions aren’t live here yet.');
      setPending('cancel');
      try {
        const digest = await runSponsored({
          tx: buildCancel({ subId }),
          owner,
          client: client as unknown as Parameters<typeof runSponsored>[0]['client'],
          signTransaction,
        });
        bump();
        return digest;
      } finally {
        setPending(null);
      }
    },
    [owner, client, signTransaction, bump],
  );

  // keep a ref so `refresh` is stable without re-creating callbacks.
  const bumpRef = useRef(bump);
  bumpRef.current = bump;
  const refresh = useCallback(() => bumpRef.current(), []);

  return {
    state,
    pending,
    sendWallet,
    spendFromSubaccount,
    cancelSubscription,
    refresh,
  };
}
