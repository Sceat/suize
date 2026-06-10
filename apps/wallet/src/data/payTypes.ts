/**
 * The PAY-model data shapes — the v1 wallet built on the `suize::account` module.
 *
 * This REPLACES the legacy three-account cage types (mandate/vault) for the new face.
 * The mental model is TWO cards + a verifiable timeline:
 *   • "Your money"  — the user's OWN wallet USDC balance (getAllBalances).
 *   • "Agent money" — the shared `Account<USDC>` balance (balance_value).
 * Plus subscriptions (read from SubscriptionCreated/Cancelled events) and the
 * on-chain activity timeline (read from the account module's events).
 *
 * Every figure is REAL on-chain truth or an honest empty/zero state — never fabricated.
 * Money is rendered in Martian-Mono blue (the locked broadsheet language).
 */

// ───────────────────────────────────────────────────────────────────────────
// Balances — the two cards.
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
// Subscriptions — owner-approved recurring authorizations (child fields).
// ───────────────────────────────────────────────────────────────────────────

/**
 * One active subscription, reconstructed from the on-chain events
 * (`SubscriptionCreated` minus `SubscriptionCancelled`) and confirmed live via
 * `subscription_info`. The payee is FIXED at creation and can never be redirected.
 */
export interface Subscription {
  /** the u64 sub key (dynamic-field key on the Account) — as a string for bigint-safety. */
  subKey: string;
  /** the FIXED recipient address. */
  payee: string;
  /** the per-period ceiling in USDC base units (1e-6) as a string. */
  periodCapRaw: string;
  /** per-period cap, human-scaled (USDC). */
  periodCapUi: number;
  /** the period length in ms (e.g. 30 days for monthly). */
  periodMs: number;
  /** wall-clock ms of the most recent charge (or of creation). */
  lastChargedMs: number;
  /** a human label for the merchant, derived from the memo/known payees (best-effort). */
  label: string;
}

// ───────────────────────────────────────────────────────────────────────────
// Activity timeline — the verifiable trace, read straight from chain events.
// ───────────────────────────────────────────────────────────────────────────

/** The kind of activity row — one per on-chain account event. Drives the glyph + copy. */
export type ActivityKind =
  | 'created' // AccountCreated
  | 'deposit' // Deposited
  | 'withdraw' // Withdrawn
  | 'spend' // Spent (the PAY receipt)
  | 'charge' // Charged (the CHARGE receipt — a subscription debit)
  | 'sub-created' // SubscriptionCreated
  | 'sub-cancelled'; // SubscriptionCancelled

/** The sign of an amount on a timeline row — money out (−), money in (+), or neutral. */
export type ActivityFlow = 'out' | 'in' | 'none';

/**
 * One row in the verifiable activity timeline, reconstructed from a single on-chain
 * `account` event. Reverse-chronological. `txDigest` is tappable → the explorer
 * (the "verify ↗" affordance — this is the verifiable trace, read from chain).
 */
export interface Activity {
  /** stable id (the event id: `${txDigest}:${eventSeq}`). */
  id: string;
  /** epoch ms (event timestampMs, or the on-chain `timestamp` field where present). */
  ts: number;
  kind: ActivityKind;
  /** the human headline ("Paid", "Topped up", "Subscribed", …). */
  title: string;
  /** the counterparty / memo line under the title (payee, "Deploy by Suize", a memo). */
  detail?: string;
  /** the amount in USDC base units (1e-6) as a string, or null for non-money rows. */
  amountRaw: string | null;
  /** human-scaled amount (USDC), or null. */
  amountUi: number | null;
  /** money direction for the +/− sign + color. */
  flow: ActivityFlow;
  /** the tx digest — tappable → explorer ("verify ↗"). Always present (events carry it). */
  txDigest: string;
}

// ───────────────────────────────────────────────────────────────────────────
// The hook contract — useAccount() returns this.
// ───────────────────────────────────────────────────────────────────────────

/** Which primitive is mid-mutation (disables its control + shows a spinner). */
export type PayPending =
  | 'create'
  | 'deposit'
  | 'spend'
  | 'withdraw'
  | 'subscribe'
  | 'send'
  | null;

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
  /** "Agent money" — the shared Account<USDC> balance. Zero until the Account is funded. */
  agent: UsdcBalance;

  /** the shared Account<USDC> object id once it exists on-chain (else null). */
  accountId: string | null;
  /** true while the first balances/account read is still settling (drives the skeleton). */
  loading: boolean;

  /** active subscriptions (created minus cancelled), newest first. */
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
   * Make the Account exist on-chain (idempotent — returns the existing id if already
   * created). Mints + shares `Account<USDC>` (no fee_recipient arg — fee policy lives in
   * the shared `RailConfig`, not the Account). Throws calmly (no fake success) before the
   * `account` package publishes.
   */
  ensureAccount(): Promise<string>;

  /** Move `amountRaw` USDC from the wallet → the Account (`deposit`). Auto-creates the Account first. */
  deposit(amountRaw: bigint): Promise<string>;

  /** OWNER-signed `spend`: pay `payee` `amountRaw` USDC from the Account with a `memo` (free). */
  spend(args: { amountRaw: bigint; payee: string; memo: string }): Promise<string>;

  /** OWNER-signed `withdraw`: pull `amountRaw` USDC from the Account back to the wallet. */
  withdraw(amountRaw: bigint): Promise<string>;

  /**
   * OWNER-signed `create_subscription`: approve a recurring charge of up to
   * `periodCapRaw` USDC to `payee` every `periodMs`. Auto-creates the Account first.
   */
  createSubscription(args: {
    payee: string;
    periodCapRaw: bigint;
    periodMs: number;
    label?: string;
  }): Promise<string>;

  /** OWNER-signed `cancel_subscription`: stop a recurring charge by its sub key. */
  cancelSubscription(subKey: string): Promise<string>;

  /**
   * Send `amountRaw` of the user's OWN wallet USDC to `to` (a resolved 0x address) —
   * a plain sponsored P2P transfer, NOT an Account verb. No fee, no publish gate
   * (it never touches `account.move`). The Send sheet resolves names first.
   */
  sendWallet(args: { amountRaw: bigint; to: string }): Promise<string>;

  /** Force a re-read of balances + account + events (after an external change). */
  refresh(): void;
}
