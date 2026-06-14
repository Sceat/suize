/**
 * The PAY-model data shapes — the v1 wallet on the STANDALONE `subs::subscription`
 * module + a plain wallet-USDC balance. The old `suize::account` cage (a funded
 * shared Account + its deposit/withdraw/spend verbs) is RETIRED: there is no
 * on-chain "sub-account" balance to deposit into anymore. The agent's spend cap is
 * now its OWN address balance (see `useAgent`), and recurring payments are
 * push-not-pull Party objects the user signs each period (see `subs.ts`). The
 * agent's spend cap is the balance of its 1-of-2 multisig sub-account (see
 * `useAgent`) — a separate on-chain address the user funds and can withdraw from.
 *
 * The mental model is now ONE wallet balance + two lists:
 *   • "Your money" — the user's OWN wallet USDC balance (getBalance).
 *   • Subscriptions — live `Subscription<USDC>` Party objects this owner holds
 *     (read via getOwnedObjects), each {merchant, amount, period, paid-through}.
 *   • Activity — subscription lifecycle events (Created/Renewed/Cancelled) +
 *     sent payments (queryTransactionBlocks FromAddress, negative-USDC rows).
 *
 * Every figure is REAL on-chain truth or an honest empty/zero state — never
 * fabricated. Money renders in Martian-Mono blue (the locked broadsheet language).
 */

import type { MultiSigPublicKey } from '@mysten/sui/multisig';

// ───────────────────────────────────────────────────────────────────────────
// Balances — the one wallet pot.
// ───────────────────────────────────────────────────────────────────────────

/** A USDC balance, both raw (base units) and human-scaled, plus its USD value. */
export interface UsdcBalance {
  /** raw on-chain balance in USDC base units (1e-6) as a string — bigint-safe. */
  raw: string;
  /** human amount = Number(raw) / 1e6. */
  ui: number;
  /** USD value (USDC ≈ $1; live via Pyth merged over the fallback). */
  usd: number;
}

// ───────────────────────────────────────────────────────────────────────────
// Subscriptions — live `subs::subscription::Subscription<USDC>` Party objects.
// ───────────────────────────────────────────────────────────────────────────

/**
 * One live subscription, read straight from the on-chain Party object the owner
 * holds (getOwnedObjects → showContent). The merchant + amount + period are FIXED
 * at creation; only `paidUntilMs` advances. PUSH-not-pull: the object holds NO
 * balance — each period is paid inline at create/renew (see `subs.ts`).
 */
export interface Subscription {
  /** the on-chain Subscription<USDC> object id (the Party object). */
  id: string;
  /** the FIXED merchant/recipient address. */
  merchant: string;
  /** the per-period price in USDC base units (1e-6) as a string. */
  amountRaw: string;
  /** per-period price, human-scaled (USDC). */
  amountUi: number;
  /** the period length in ms (e.g. 30 days for monthly). */
  periodMs: number;
  /** wall-clock ms the subscription is paid THROUGH (`active ⇔ now < paidUntilMs`). */
  paidUntilMs: number;
  /** merchant-supplied opaque ref (hex `0x…`), echoed from every event. */
  ref: string;
  /** a human label for the merchant (best-effort from known payees / ref). */
  label: string;
}

// ───────────────────────────────────────────────────────────────────────────
// Activity timeline — the verifiable trace (subs events + sent payments).
// ───────────────────────────────────────────────────────────────────────────

/**
 * The kind of activity row. Drives the glyph + copy. The send/payment split is the
 * presence of the Suize treasury fee output: a plain transfer has none (`sent`/
 * `received`), a rail payment carries the 2%/$0.01 split (`paid`/`charged`).
 */
export type ActivityKind =
  | 'sub-created' // SubscriptionCreated (first period paid inline)
  | 'sub-renewed' // SubscriptionRenewed (one period charged)
  | 'sub-cancelled' // SubscriptionCancelled
  | 'sent' // a wallet → anyone PLAIN USDC transfer (no rail fee) — money OUT
  | 'paid' // a wallet → merchant RAIL PAYMENT (treasury fee output) — money OUT
  | 'received' // anyone → wallet PLAIN USDC transfer (no rail fee) — money IN
  | 'charged'; // someone PAID YOU on the rail (treasury fee output) — money IN (the merchant leg)

/** The sign of an amount on a timeline row — money out (−), money in (+), or neutral. */
export type ActivityFlow = 'out' | 'in' | 'none';

/**
 * One row in the verifiable activity timeline. Reverse-chronological. `txDigest`
 * is tappable → the explorer (the "verify ↗" affordance). Every row carries one.
 */
export interface Activity {
  /** stable id (the event id `${txDigest}:${eventSeq}` or the tx digest). */
  id: string;
  /** epoch ms (event/tx timestampMs). */
  ts: number;
  kind: ActivityKind;
  /** the human headline ("Subscribed", "Renewed", "Sent", …). */
  title: string;
  /** the resolved counterparty line — a `<name>@suize` handle, a SuiNS name, or a
   *  short 0x… address. This is the "to whom" the row answers. */
  detail?: string;
  /** the raw counterparty 0x… address (the send recipient / the subscription
   *  merchant), before name resolution. Drives the reverse-SuiNS lookup that fills
   *  `detail` with a human handle; absent only when no counterparty is on-chain. */
  counterparty?: string;
  /** the amount in USDC base units (1e-6) as a string, or null for non-money rows. */
  amountRaw: string | null;
  /** human-scaled amount (USDC), or null. */
  amountUi: number | null;
  /** money direction for the +/− sign + color. */
  flow: ActivityFlow;
  /** the tx digest — tappable → explorer ("verify ↗"). Always present. */
  txDigest: string;
  /** true for an OPTIMISTIC row not yet confirmed on-chain — rendered "confirming…",
   *  no verify link, replaced by the real row once the chain surfaces it. */
  pending?: boolean;
}

// ───────────────────────────────────────────────────────────────────────────
// The hook contract — useAccount() returns this.
// ───────────────────────────────────────────────────────────────────────────

/** Which primitive is mid-mutation (disables its control + shows a spinner). */
export type PayPending = 'send' | 'subscribe' | 'cancel' | 'renew' | 'fund' | null;

/** The full PAY snapshot the UI renders. Read-only; mutations go through the API. */
export interface PayState {
  /** the user's zkLogin wallet address (0x…), or '' pre-login. */
  address: string;
  /** the resolved "<name>@suize" handle (or '' until resolved). */
  handle: string;
  /** the bare <name> before the @ (or ''). */
  name: string;

  /** "Your money" — the user's OWN wallet USDC balance. */
  wallet: UsdcBalance;

  /** true while the first balance/subs read is still settling (drives the skeleton). */
  loading: boolean;

  /** active subscriptions (live Party objects), newest first. */
  subscriptions: Subscription[];
  /** the verifiable activity timeline, reverse-chronological. */
  activity: Activity[];
}

/** The data-hook contract. `useAccount(ownerAddress, handle)` returns this. */
export interface PayApi {
  state: PayState;
  /** which primitive is mid-mutation, or null when idle. */
  pending: PayPending;

  /**
   * Send `amountRaw` of the user's OWN wallet USDC to `to` (a resolved 0x address)
   * — a single-output GASLESS P2P transfer (no fee, no merchant rake). The payer's
   * own zkLogin session signs the gasless bytes locally; the chain's Address-Balance
   * path covers gas. The Send sheet resolves names first. `label` is the recipient's
   * display name (the typed handle) for the OPTIMISTIC activity row, if any.
   */
  sendWallet(args: { amountRaw: bigint; to: string; label?: string }): Promise<string>;

  /**
   * Send `amountRaw` of USDC FROM the agent's 1-of-2 multisig sub-account to `to`
   * — a GASLESS send the MAIN session member signs ALONE then combines (threshold
   * 1). This is the AI's spend primitive AND the user's one-tap Withdraw (sweep to
   * the user's own wallet). The chain enforces the sub-account balance as the cap.
   */
  spendFromSubaccount(args: { multisig: MultiSigPublicKey; to: string; amountRaw: bigint }): Promise<string>;

  /** OWNER-signed `cancel`: stop + destroy a subscription by its object id. */
  cancelSubscription(subId: string): Promise<string>;

  /** Force a re-read of balance + subscriptions + activity (after an external change). */
  refresh(): void;
}
