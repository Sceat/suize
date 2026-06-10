/**
 * PTB builders + event/object reads for the `suize::account` module — the v1 PAY core.
 *
 * This file is the SINGLE source of truth for the Account's Move SHAPES (targets, arg
 * order, the `Account<USDC>` type arg, the Clock at 0x6). Builders are PURE: tx in,
 * tx out — they return a `@mysten/sui` `Transaction`, never bytes and never a network
 * call. The transport (build KIND bytes → wsSponsor → sign verbatim → wsExecute) lives
 * in `useAccount.runSponsored`, exactly the Crash/legacy pattern. One concern per file.
 *
 * THE ON-CHAIN INTERFACE (verified against packages/move-wallet/sources/account.move).
 * Fee policy is the rail's, NOT the Account's: the CHARGE verbs take a `&RailConfig`
 * (the shared `PACKAGE_IDS.ACCOUNT.RAIL_CONFIG`) — the rate + recipient resolve from it,
 * never from an Account. `create_account` no longer takes a `fee_recipient` arg.
 *   create_account<T>(ctx)                                         — mints + SHARES Account<T> (no fee arg)
 *   deposit<T>(&mut Account<T>, Coin<T>, ctx)                       — anyone tops up
 *   spend<T>(&mut Account<T>, amount:u64, payee:address,
 *            memo:vector<u8>, &Clock, ctx)                          — OWNER-ONLY free transfer (no config)
 *   charge<T>(&mut Account<T>, &RailConfig, merchant:address,
 *            amount:u64, memo:vector<u8>, &Clock, ctx)              — OWNER-ONLY one-off charge
 *   withdraw<T>(&mut Account<T>, amount:u64, ctx): Coin<T>          — OWNER-ONLY, RETURNS Coin
 *   create_subscription<T>(&mut Account<T>, payee:address,
 *            period_cap:u64, period_ms:u64, &Clock, ctx): u64       — OWNER-ONLY
 *   cancel_subscription<T>(&mut Account<T>, sub_key:u64, ctx)       — OWNER-ONLY
 *   charge_subscription<T>(&mut Account<T>, &RailConfig, sub_key:u64,
 *            amount:u64, &Clock, ctx)                               — permissionless (relayer)
 *   pay<T>(&Account<T>, &RailConfig, Coin<T>, memo:vector<u8>,
 *            &Clock, ctx)                                           — permissionless raw-payer
 *   accessors (devInspect): balance_value / owner / has_subscription /
 *            subscription_info   (the rate accessors — default_fee_bps /
 *            fee_recipient / merchant_fee_bps — live on RailConfig, not the Account)
 *
 * EVENTS (the verifiable trace — the timeline reads these):
 *   AccountCreated · Deposited · Withdrawn · Spent · SubscriptionCreated ·
 *   Charged · SubscriptionCancelled
 *
 * PUBLISH GATE: the package id + the shared `RailConfig` id come from `@suize/shared`
 * (`PACKAGE_IDS.ACCOUNT.PACKAGE` / `PACKAGE_IDS.ACCOUNT.RAIL_CONFIG`), both `0x0` until
 * `account` publishes to testnet (the `RailConfig` id is captured from the publish/init
 * effects). `ACCOUNT_PUBLISHED` is the boolean the UI gates live writes on; reads are
 * harmless before publish (they resolve nothing → honest empty states).
 */

import { Transaction } from '@mysten/sui/transactions';
import { PACKAGE_IDS } from '@suize/shared';
import { USDC } from './coins';

const T = PACKAGE_IDS.ACCOUNT.TARGETS;

/** The settlement coin type arg for the production `Account<USDC>`. */
export const ACCOUNT_COIN = USDC;

/** The system Clock object id — always 0x6 on every Sui network (spend/sub time-gate). */
export const CLOCK_ID = '0x6';

/** One year of milliseconds — the default subscription period (monthly is `MONTH_MS`). */
export const MONTH_MS = 30 * 24 * 60 * 60 * 1000;

// ───────────────────────────────────────────────────────────────────────────
// Create — mint + SHARE the user's Account<USDC>. No fee arg: fee policy is the
// rail's, in the shared RailConfig (default 2%), not on the Account.
// ───────────────────────────────────────────────────────────────────────────

/**
 * Build `create_account<USDC>()`. Shares a fresh Account owned by the sender. Takes NO
 * fee_recipient arg anymore — the fee rate + recipient live in the shared `RailConfig`
 * (default 2%), resolved per-merchant on the CHARGE verbs. The new Account id is only
 * known POST-execution (read it from the `AccountCreated` event — see `accountIdFromEvents`).
 */
export function buildCreateAccount(): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: T.CREATE_ACCOUNT,
    arguments: [],
    typeArguments: [ACCOUNT_COIN.type],
  });
  return tx;
}

// ───────────────────────────────────────────────────────────────────────────
// Deposit — move USDC from the owner's wallet INTO the Account (anyone may call).
// ───────────────────────────────────────────────────────────────────────────

/**
 * Build `deposit<USDC>(account, coin)` — merge a freshly-split USDC coin into the
 * Account balance. The caller resolves the owner's USDC coin objects and passes their
 * ids; we merge + split the exact `amountRaw` (USDC base units, 1e-6) and deposit it.
 *
 * @param accountId    the shared Account<USDC> id.
 * @param amountRaw    amount in USDC base units (1 USDC = 1_000_000).
 * @param sourceCoinIds the owner's USDC coin object ids to draw from (merged → split).
 */
export function buildDeposit(opts: {
  accountId: string;
  amountRaw: bigint | number;
  sourceCoinIds: string[];
}): Transaction {
  if (opts.sourceCoinIds.length === 0) {
    throw new Error('buildDeposit: no USDC coins to deposit from.');
  }
  const tx = new Transaction();
  const primary = tx.object(opts.sourceCoinIds[0]);
  if (opts.sourceCoinIds.length > 1) {
    tx.mergeCoins(primary, opts.sourceCoinIds.slice(1).map((id) => tx.object(id)));
  }
  const [coin] = tx.splitCoins(primary, [tx.pure.u64(BigInt(opts.amountRaw))]);
  tx.moveCall({
    target: T.DEPOSIT,
    arguments: [tx.object(opts.accountId), coin],
    typeArguments: [ACCOUNT_COIN.type],
  });
  return tx;
}

// ───────────────────────────────────────────────────────────────────────────
// Spend — the PAY primitive. OWNER-ONLY free transfer to a payee + memo.
// ───────────────────────────────────────────────────────────────────────────

/**
 * Build `spend<USDC>(account, amount, payee, memo, clock)`. FREE transfer: the full
 * `amountRaw` lands with `payee` (no fee on the PAY path), capped only by the Account
 * balance. `memo` is encoded UTF-8 → `vector<u8>`. Emits `Spent`.
 */
export function buildSpend(opts: {
  accountId: string;
  amountRaw: bigint | number;
  payee: string;
  memo: string;
}): Transaction {
  const tx = new Transaction();
  const memoBytes = Array.from(new TextEncoder().encode(opts.memo));
  tx.moveCall({
    target: T.SPEND,
    arguments: [
      tx.object(opts.accountId),
      tx.pure.u64(BigInt(opts.amountRaw)),
      tx.pure.address(opts.payee),
      tx.pure.vector('u8', memoBytes),
      tx.object(CLOCK_ID),
    ],
    typeArguments: [ACCOUNT_COIN.type],
  });
  return tx;
}

// ───────────────────────────────────────────────────────────────────────────
// Withdraw — OWNER-ONLY pull back to the wallet. `withdraw` RETURNS a Coin<T>, so
// we transfer that returned coin to the owner in the SAME PTB.
// ───────────────────────────────────────────────────────────────────────────

/**
 * Build `withdraw<USDC>(account, amount)` and route the returned `Coin<USDC>` back to
 * the owner via `transferObjects`. (The Move fn returns the coin so it's composable;
 * "back to my wallet" means transferring it to `owner`.) Emits `Withdrawn`.
 */
export function buildWithdraw(opts: {
  accountId: string;
  amountRaw: bigint | number;
  owner: string;
}): Transaction {
  const tx = new Transaction();
  const [coin] = tx.moveCall({
    target: T.WITHDRAW,
    arguments: [tx.object(opts.accountId), tx.pure.u64(BigInt(opts.amountRaw))],
    typeArguments: [ACCOUNT_COIN.type],
  });
  tx.transferObjects([coin], tx.pure.address(opts.owner));
  return tx;
}

// ───────────────────────────────────────────────────────────────────────────
// Subscriptions — OWNER-ONLY create / cancel.
// ───────────────────────────────────────────────────────────────────────────

/**
 * Build `create_subscription<USDC>(account, payee, period_cap, period_ms, clock)` —
 * approve a recurring charge ONCE. The fresh `sub_key` is returned by the Move fn AND
 * emitted in `SubscriptionCreated` (read it post-execution). The first charge waits
 * one full `period_ms` (the Move sets `last_charged_ms = now` at creation).
 *
 * @param periodCapRaw the per-period ceiling in USDC base units (e.g. $19.99 → 19_990_000).
 * @param periodMs     the period length in ms (default `MONTH_MS`).
 */
export function buildCreateSubscription(opts: {
  accountId: string;
  payee: string;
  periodCapRaw: bigint | number;
  periodMs?: number;
}): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: T.CREATE_SUBSCRIPTION,
    arguments: [
      tx.object(opts.accountId),
      tx.pure.address(opts.payee),
      tx.pure.u64(BigInt(opts.periodCapRaw)),
      tx.pure.u64(BigInt(opts.periodMs ?? MONTH_MS)),
      tx.object(CLOCK_ID),
    ],
    typeArguments: [ACCOUNT_COIN.type],
  });
  return tx;
}

/** Build `cancel_subscription<USDC>(account, sub_key)` — OWNER-ONLY. Emits `SubscriptionCancelled`. */
export function buildCancelSubscription(opts: {
  accountId: string;
  subKey: bigint | number;
}): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: T.CANCEL_SUBSCRIPTION,
    arguments: [tx.object(opts.accountId), tx.pure.u64(BigInt(opts.subKey))],
    typeArguments: [ACCOUNT_COIN.type],
  });
  return tx;
}

// ───────────────────────────────────────────────────────────────────────────
// Event readers — pull created-object ids out of a tx's emitted events.
// ───────────────────────────────────────────────────────────────────────────

/** A minimal view of a Sui event the readers below consume. */
export interface MinimalEvent {
  type: string;
  parsedJson?: unknown;
}

/** Read the new Account id from a `create_account` tx's `AccountCreated` event. */
export function accountIdFromEvents(events: MinimalEvent[] | null | undefined): string | null {
  return eventField(events, '::account::AccountCreated', 'account_id');
}

/** Read the new sub key from a `create_subscription` tx's `SubscriptionCreated` event. */
export function subKeyFromEvents(events: MinimalEvent[] | null | undefined): string | null {
  return eventField(events, '::account::SubscriptionCreated', 'sub_key');
}

/** Extract a string field from one of a tx's emitted events whose type ends with `suffix`. */
function eventField(
  events: MinimalEvent[] | null | undefined,
  typeSuffix: string,
  field: string,
): string | null {
  if (!events) return null;
  for (const ev of events) {
    if (ev.type.endsWith(typeSuffix) && ev.parsedJson && typeof ev.parsedJson === 'object') {
      const val = (ev.parsedJson as Record<string, unknown>)[field];
      if (typeof val === 'string') return val;
      if (typeof val === 'number') return String(val);
    }
  }
  return null;
}
