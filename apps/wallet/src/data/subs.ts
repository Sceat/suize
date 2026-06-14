/**
 * PTB builders + object reads for the STANDALONE `subs::subscription` module —
 * the recurring half of the rail (the v1 PAY subscriptions). PUBLISHED on testnet
 * (`PACKAGE_IDS.SUBS`); ids live ONLY in `@suize/shared`.
 *
 * This is the SINGLE source of truth for the subscription Move SHAPES (targets,
 * arg order, the `Subscription<USDC>` type arg, the shared `SubsConfig`, the Clock
 * at 0x6). Builders are PURE: tx in, tx out — a `@mysten/sui` `Transaction`, never
 * bytes and never a network call. The sponsored transport lives in `sponsored.ts`.
 *
 * THE ON-CHAIN INTERFACE (verified against packages/move-subs/sources/subscription.move):
 *   create<T>(config: &SubsConfig, merchant: address, amount: u64, period_ms: u64,
 *             ref: vector<u8>, payment: Balance<T>, clock: &Clock, ctx)  — owner mints + pays period 1
 *   renew<T>(sub: &mut Subscription<T>, config: &SubsConfig,
 *             payment: Balance<T>, clock: &Clock, ctx)                   — pay one more period (owner-signed, relayer-sponsored)
 *   cancel<T>(sub: Subscription<T>, ctx)                                 — destroy (the only exit)
 *
 * PUSH-NOT-PULL: each period's `Balance<USDC>` is PUSHED into create/renew via the
 * SDK's `tx.balance({ type, balance })` intent (materialized from the sender's own
 * USDC under sponsorship — the `redeem_funds`/`into_balance` helpers the sponsor
 * allow-list accepts). The module asserts `payment.value() == amount` and carves
 * the 2% (+$0.01 floor) to the treasury.
 *
 * EVENTS (the verifiable trace — the timeline reads these):
 *   SubscriptionCreated · SubscriptionRenewed · SubscriptionCancelled
 *
 * PUBLISH GATE: `PACKAGE_IDS.SUBS.PACKAGE` / `CONFIG_OBJECT` come from `@suize/shared`
 * (published — `SUBS_PUBLISHED === true`). `Subscription<USDC>` is the production
 * type; the type arg is `USDC.type`.
 */

import { Transaction } from '@mysten/sui/transactions';
import { PACKAGE_IDS } from '@suize/shared';
import { USDC } from './coins';
import type { Subscription } from './payTypes';

const T = PACKAGE_IDS.SUBS.TARGETS;
const SUBS_CONFIG = PACKAGE_IDS.SUBS.CONFIG_OBJECT;
const SUBS_PKG = PACKAGE_IDS.SUBS.PACKAGE;

/** The settlement coin type arg for the production `Subscription<USDC>`. */
export const SUBS_COIN = USDC;

/** USDC has 6 decimals. raw → ui = raw / 1e6. */
const USDC_SCALE = 10 ** USDC.decimals;

/** The system Clock object id — always 0x6 on every Sui network (the time-gate). */
export const CLOCK_ID = '0x6';

/** The fully-qualified `Subscription<USDC>` struct type — the getOwnedObjects filter. */
export const SUBSCRIPTION_TYPE = `${SUBS_PKG}::subscription::Subscription<${USDC.type}>`;

/** Decode a Move `vector<u8>` ref (hex string `0x…`, or a byte array) to a hex string. */
function toRefBytes(ref: string): number[] {
  const clean = ref.startsWith('0x') ? ref.slice(2) : ref;
  if (clean.length === 0) return [];
  // Even-length hex → bytes; otherwise treat the whole string as UTF-8.
  if (/^[0-9a-fA-F]*$/.test(clean) && clean.length % 2 === 0) {
    const out: number[] = [];
    for (let i = 0; i < clean.length; i += 2) out.push(parseInt(clean.slice(i, i + 2), 16));
    return out;
  }
  return Array.from(new TextEncoder().encode(ref));
}

// ───────────────────────────────────────────────────────────────────────────
// create — owner mints a Subscription, paying period 1 inline.
// ───────────────────────────────────────────────────────────────────────────

/**
 * Build `create<USDC>(config, merchant, amount, period_ms, ref, payment, clock)`.
 * The `payment` is exactly one period's `Balance<USDC>`, materialized from the
 * sender's own USDC via the SDK `tx.balance` intent (sponsored). Premium is live
 * the instant this lands (`paid_until_ms = now + period_ms`).
 *
 * @param merchant   the FIXED recipient address.
 * @param amountRaw  the per-period price in USDC base units (1 USDC = 1_000_000).
 * @param periodMs   the period length in ms (e.g. 30 days for monthly).
 * @param refHex     a hex correlation id (the 402 paymentId), stamped into events.
 */
export function buildCreate(opts: {
  merchant: string;
  amountRaw: bigint | number;
  periodMs: number;
  refHex: string;
}): Transaction {
  const tx = new Transaction();
  const amount = BigInt(opts.amountRaw);
  const payment = tx.balance({ type: USDC.type, balance: amount });
  tx.moveCall({
    target: T.CREATE,
    arguments: [
      tx.object(SUBS_CONFIG),
      tx.pure.address(opts.merchant),
      tx.pure.u64(amount),
      tx.pure.u64(BigInt(opts.periodMs)),
      tx.pure.vector('u8', toRefBytes(opts.refHex)),
      payment,
      tx.object(CLOCK_ID),
    ],
    typeArguments: [USDC.type],
  });
  return tx;
}

// ───────────────────────────────────────────────────────────────────────────
// renew — pay one more period (owner-signed, relayer-sponsored).
// ───────────────────────────────────────────────────────────────────────────

/**
 * Build `renew<USDC>(sub, config, payment, clock)` — push exactly one more
 * period's `Balance<USDC>` and advance `paid_until_ms`. Aborts `ETooEarly` (code 0)
 * if fired more than 24h before the current paid-through (the on-chain
 * double-charge guard); the silent-renew loop treats that as a quiet skip.
 *
 * @param subId      the live `Subscription<USDC>` Party object id.
 * @param amountRaw  one period's price (MUST equal the object's fixed `amount`).
 */
export function buildRenew(opts: { subId: string; amountRaw: bigint | number }): Transaction {
  const tx = new Transaction();
  const amount = BigInt(opts.amountRaw);
  const payment = tx.balance({ type: USDC.type, balance: amount });
  tx.moveCall({
    target: T.RENEW,
    arguments: [tx.object(opts.subId), tx.object(SUBS_CONFIG), payment, tx.object(CLOCK_ID)],
    typeArguments: [USDC.type],
  });
  return tx;
}

// ───────────────────────────────────────────────────────────────────────────
// cancel — destroy the subscription (the only exit; no fee, no refund).
// ───────────────────────────────────────────────────────────────────────────

/** Build `cancel<USDC>(sub)` — OWNER-ONLY. Emits `SubscriptionCancelled`. */
export function buildCancel(opts: { subId: string }): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: T.CANCEL,
    arguments: [tx.object(opts.subId)],
    typeArguments: [USDC.type],
  });
  return tx;
}

// ───────────────────────────────────────────────────────────────────────────
// Reads — the owner's live subscriptions via getOwnedObjects (proven: Party
// objects are owned by exactly one address; the StructType filter works).
// ───────────────────────────────────────────────────────────────────────────

/** The minimal getOwnedObjects client slice — exactly what dapp-kit's client exposes. */
export interface OwnedObjectsClient {
  getOwnedObjects(args: {
    owner: string;
    filter?: { StructType: string };
    options?: { showContent?: boolean; showType?: boolean };
    cursor?: string | null;
    limit?: number;
  }): Promise<{
    data: Array<{
      data?: {
        objectId: string;
        type?: string;
        content?: { fields?: Record<string, unknown> } | null;
      } | null;
    }>;
    hasNextPage: boolean;
    nextCursor?: string | null;
  }>;
}

/** A best-effort human label for a subscription (the address is the verifiable id). */
function labelFor(merchant: string): string {
  if (!merchant || merchant.length < 12) return 'Subscription';
  return `${merchant.slice(0, 6)}…${merchant.slice(-4)}`;
}

/** Coerce a Move u64 field (string | number) to a base-unit string. */
function rawStr(v: unknown): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  return '0';
}

/** Map one owned-object's content fields to a `Subscription`. Returns null if it
 *  isn't a well-formed Subscription<USDC> (wrong type / missing fields). */
export function subscriptionFromFields(
  objectId: string,
  fields: Record<string, unknown> | null | undefined,
): Subscription | null {
  if (!fields) return null;
  const merchant = typeof fields.merchant === 'string' ? fields.merchant : '';
  if (!merchant) return null;
  const amountRaw = rawStr(fields.amount);
  const periodMs = Number(rawStr(fields.period_ms));
  const paidUntilMs = Number(rawStr(fields.paid_until_ms));
  const ref = typeof fields.ref === 'string' ? fields.ref : '';
  return {
    id: objectId,
    merchant,
    amountRaw,
    amountUi: Number(amountRaw) / USDC_SCALE,
    periodMs,
    paidUntilMs,
    ref,
    label: labelFor(merchant),
  };
}

/**
 * List every live `Subscription<USDC>` the `owner` holds (paged getOwnedObjects,
 * StructType-filtered — proven for Party objects). Cancelled subs are deleted
 * objects, so they never appear; lapsed-but-live subs DO (the UI flags them).
 */
export async function listSubscriptions(
  client: OwnedObjectsClient,
  owner: string,
): Promise<Subscription[]> {
  if (!owner) return [];
  const out: Subscription[] = [];
  let cursor: string | null | undefined = undefined;
  // Bound the walk — a single user holding > a few hundred subs is not a v1 case.
  for (let page = 0; page < 10; page++) {
    const res = await client.getOwnedObjects({
      owner,
      filter: { StructType: SUBSCRIPTION_TYPE },
      options: { showContent: true, showType: true },
      cursor: cursor ?? undefined,
      limit: 50,
    });
    for (const node of res.data) {
      const d = node.data;
      if (!d) continue;
      const fields = d.content?.fields ?? null;
      const sub = subscriptionFromFields(d.objectId, fields);
      if (sub) out.push(sub);
    }
    if (!res.hasNextPage || !res.nextCursor) break;
    cursor = res.nextCursor;
  }
  // Newest paid-through first is a reasonable stable order for the UI.
  return out.sort((a, b) => b.paidUntilMs - a.paidUntilMs);
}

/** Read the new Subscription id from a `create` tx's `SubscriptionCreated` event. */
export function subIdFromEvents(
  events: Array<{ type: string; parsedJson?: unknown }> | null | undefined,
): string | null {
  if (!events) return null;
  for (const ev of events) {
    if (ev.type.endsWith('::subscription::SubscriptionCreated') && ev.parsedJson && typeof ev.parsedJson === 'object') {
      const id = (ev.parsedJson as Record<string, unknown>).subscription_id;
      if (typeof id === 'string') return id;
    }
  }
  return null;
}
