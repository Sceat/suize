/**
 * The wallet's /confirm-subscribe popup protocol (wire shapes ONLY; policy — the
 * origin allowlist — lives with the popup host in apps/wallet/src/bridge/origins.ts).
 *
 * MODEL: the Enoki zkLogin session lives in exactly ONE origin — the wallet
 * (`wallet.suize.io`). Deploy opens a VISIBLE popup at `wallet.suize.io/confirm-subscribe`
 * to set up / cancel its storage subscription against that session — MONEY. The popup
 * receives the subscription TERMS, then builds + signs + submits the create/cancel tx
 * ITSELF (display = build — a malicious parent cannot show one cap and sign another),
 * returning only the digest + subKey. The key never leaves the wallet origin.
 *
 * TRANSPORT: window messages both ways. The popup beacons `ready` (no payload); the
 * opener answers `terms` (origin-checked by the popup against its pinned opener); the
 * popup posts `result` back to that PINNED opener origin.
 */

/** The recurring-money gate (set up / cancel a subscription) on the wallet origin. */
export const CONFIRM_SUBSCRIBE_PATH = "/confirm-subscribe";

/** Protocol version — bump on breaking change; the popup drops mismatched frames. */
export const BRIDGE_V = 1;

/** Popup → opener (no payload — a beacon; the opener answers with terms). */
export interface ConfirmReady {
  type: "suize-confirm-ready";
  v: typeof BRIDGE_V;
}

/** What the opener asks the popup to set up as a recurring subscription. Decimal
 * USDC string `amount` (the facilitator's wire convention); `periodMs` the recurring
 * interval; `ref` the hex paymentId/correlation stamped into renewals' receipts;
 * `label` an optional display name for the merchant/plan. */
export interface SubscribeTerms {
  merchant: string;
  /** decimal USDC string, e.g. "19.99". */
  amount: string;
  /** recurring interval in ms (e.g. 2_592_000_000 = 30 days). */
  periodMs: number;
  /** hex correlation id stamped into each renewal's receipt memo. */
  ref: string;
  /** optional display label (e.g. the merchant/plan name). */
  label?: string;
}

/** Opener → popup. The popup validates the sender origin before accepting. */
export interface SubscribeTermsMsg {
  type: "suize-subscribe-terms";
  v: typeof BRIDGE_V;
  terms: SubscribeTerms;
}

/** Popup → opener, posted to the PINNED origin that sent the terms. `digest` is
 * the create-subscription tx; `subKey` the new subscription's on-chain key. */
export type SubscribeResultMsg =
  | { type: "suize-subscribe-result"; v: typeof BRIDGE_V; ok: true; digest: string; subKey: number }
  | { type: "suize-subscribe-result"; v: typeof BRIDGE_V; ok: false; cancelled: boolean; error?: string };
