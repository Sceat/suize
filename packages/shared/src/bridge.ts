/**
 * The Suize SSO bridge — the cross-subdomain identity protocol (wire shapes ONLY;
 * policy — the origin allowlist — lives with the bridge HOST in apps/wallet).
 *
 * MODEL (owner-approved 2026-06-11): the Enoki zkLogin session lives in exactly
 * ONE origin — the wallet (`wallet.suize.io`). Every other `*.suize.io` product
 * is a CLIENT of two wallet-origin surfaces:
 *
 *   • the BRIDGE IFRAME (`/bridge`, a hidden same-site iframe) — ONE silent op:
 *       `getSession`     → { address } | null   (who is signed in, nothing more)
 *     NOTHING signs on the silent surface. A second op `signAuthNonce` (sign the
 *     fixed `buildAuthMessage(nonce)` so another *.suize.io product could open
 *     its OWN authenticated backend WS with the shared session) is DESIGNED but
 *     DELIBERATELY NOT SHIPPED: it has no consumer yet (pay.suize.io uses the
 *     facilitator HTTP + the confirm popup, never a WS), and a zero-click signer
 *     is the one piece that materially widens an allowlisted-origin XSS into a
 *     full WS session as the victim. Re-add it WITH a mitigation (one-time
 *     visible consent, or an audience-scoped nonce) when the first WS product
 *     lands — see `services/backend/SPEC.md` §6 and `apps/wallet/SPEC.md` §6b.
 *   • the CONFIRM POPUP (`/confirm`, a visible top-level window) — MONEY. The
 *     popup receives the payment TERMS, then builds + signs + submits the tx
 *     ITSELF (display = build — a malicious parent cannot show $1 and sign $100),
 *     returning only the digest. The key never leaves the wallet origin; no
 *     bridge surface ever exports key material or signs arbitrary tx bytes.
 *
 * TRANSPORT: the parent initiates with a `connect` window message carrying a
 * MessagePort (origin-checked by the host against its allowlist); all requests
 * ride the port afterwards (ports are pairwise — no later origin spoofing).
 * The popup flow is window messages both ways: the popup beacons `ready`
 * (no payload), the opener sends `terms` (origin-checked by the popup), the
 * popup answers `result` to the PINNED opener origin.
 *
 * Same-site note: `pay.suize.io` embedding `wallet.suize.io` is cross-origin but
 * SAME-SITE (one eTLD+1), so browser third-party storage partitioning does not
 * apply — the iframe sees the wallet's real session in every browser. This holds
 * ONLY inside `*.suize.io`; `*.suize.site` (user-deployed content) must never be
 * allowlisted.
 */

// ── Paths on the wallet origin ───────────────────────────────────────────────
export const BRIDGE_PATH = "/bridge";
export const CONFIRM_PATH = "/confirm";
/** The recurring-money gate (set up / cancel a subscription). Same popup machinery
 *  + same display=build law as /confirm, for the SubscribeTerms pair. */
export const CONFIRM_SUBSCRIBE_PATH = "/confirm-subscribe";

/** Protocol version — bump on breaking change; hosts drop mismatched frames. */
export const BRIDGE_V = 1;

// ── Window-level handshake frames (iframe) ──────────────────────────────────

/** Parent → iframe window: open the channel (carries `port` as a transferable). */
export interface BridgeConnect {
  type: "suize-bridge-connect";
  v: typeof BRIDGE_V;
}

/** Iframe → parent over the PORT once the host accepted the origin. */
export interface BridgeReady {
  type: "suize-bridge-ready";
  v: typeof BRIDGE_V;
}

// ── Port RPC frames (iframe) ─────────────────────────────────────────────────

export type BridgeOp = "getSession";

export type BridgeRequest = { id: string; op: "getSession" };

export interface BridgeSession {
  /** The signed-in zkLogin address, or null when no wallet session exists. */
  address: string | null;
}

export type BridgeResponse =
  | { id: string; ok: true; data: BridgeSession }
  | { id: string; ok: false; error: string };

// ── Confirm-popup frames (window messages) ──────────────────────────────────

/** What the opener asks the popup to charge. Decimal USDC string amounts —
 * the same wire convention as the facilitator. `toHandle` is a DISPLAY label
 * (the popup prints the payTo hex alongside it; the tx is built from payTo). */
export interface ConfirmTerms {
  payTo: string;
  /** decimal USDC string, e.g. "0.50". */
  amount: string;
  memo: string;
  /** optional display handle (e.g. "name@suize") shown above the address. */
  toHandle?: string;
  /**
   * `'settle'` (default) — the popup settles on-chain and returns the digest.
   * `'authorize'` — the popup builds + signs but DOES NOT settle, and returns the
   * SIGNED-UNSETTLED b64 PaymentPayload (the deploy door: the agent submits it as
   * X-PAYMENT and the merchant settles it during the deploy, so nothing is public
   * before then — there is nothing to replay). Used by Deploy's no-Sui-key pay-link.
   */
  mode?: 'settle' | 'authorize';
}

/** Popup → opener (no payload — a beacon; the opener answers with terms). */
export interface ConfirmReady {
  type: "suize-confirm-ready";
  v: typeof BRIDGE_V;
}

/** Opener → popup. The popup validates the sender origin before accepting. */
export interface ConfirmTermsMsg {
  type: "suize-confirm-terms";
  v: typeof BRIDGE_V;
  terms: ConfirmTerms;
}

/** Popup → opener, posted to the PINNED origin that sent the terms. The success
 * variant carries EITHER a settled `digest` (mode 'settle', the default) OR a
 * `payment` (mode 'authorize' — the b64 SIGNED-UNSETTLED PaymentPayload the opener
 * hands an agent to submit as X-PAYMENT). Exactly one is present. */
export type ConfirmResultMsg =
  | { type: "suize-pay-result"; v: typeof BRIDGE_V; ok: true; digest: string }
  | { type: "suize-pay-result"; v: typeof BRIDGE_V; ok: true; payment: string }
  | { type: "suize-pay-result"; v: typeof BRIDGE_V; ok: false; cancelled: boolean; error?: string };

// ── Confirm-subscribe popup frames (window messages) ─────────────────────────
// Same /confirm popup, MONEY surface, same display=build law: the popup receives
// the subscription TERMS, then builds + signs + submits the create-subscription tx
// ITSELF (a malicious parent can't show one cap and sign another). Mirrors the
// one-off ConfirmTerms pair; reuses ConfirmReady (the popup's payload-less beacon).

/** What the opener asks the popup to set up as a recurring subscription. Decimal
 * USDC string `amount` (same wire convention as ConfirmTerms); `periodMs` the
 * recurring interval; `ref` the hex paymentId/correlation stamped into renewals'
 * receipts; `label` an optional display name for the merchant/plan. */
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
