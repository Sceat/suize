// CHARGE↔Deploy join — the payment gate in front of the deploy flow (the #1 demo
// item). A deploy is now a one-off $0.50 `charge` on the Suize rail BEFORE any
// Walrus upload or Site mint runs. "Deploy is the first merchant on the rail" — this
// is the wiring that makes it true.
//
// THE BACKEND NEVER SIGNS AN OWNER TX. `charge` is owner-only, so the caller's LOCAL
// zkLogin session signs it; the backend only (a) builds the sponsored bytes and (b)
// — after the caller executes — VERIFIES the charge settled before running the
// deploy. Three steps, because non-custodial signing is inherently multi-leg:
//
//   1. POST /deploy/quote   -> { amount: 500_000, merchant, feeBps: 200, … } (402-shaped).
//   2. POST /deploy/charge  -> the backend builds the `charge(account, config, merchant,
//      $0.50, memo, clock)` PTB (config = the shared RailConfig, source of the rate),
//      Enoki-SPONSORS it (sender pinned to the caller's verified owner), and returns
//      { bytes, digest }. The caller signs `bytes` locally and submits via the existing
//      POST /execute (sponsor) path → the charge tx digest.
//   3. POST /deploy (multipart, existing) carrying `chargeDigest` -> the deploy module
//      calls reserveDeployCharge() here; only a VALID, fresh, unconsumed charge paying
//      the Deploy merchant exactly $0.50 lets the Walrus upload + Site mint proceed.
//      The digest is committed (burned) only AFTER the Site mints — a downstream
//      failure releases it so the same paid charge can retry.
//
// GATED exactly like the deploy module's 0x0-package gate: every op 503s until ALL of
// `account` is published (PACKAGE_IDS.ACCOUNT.PACKAGE != 0x0 → ACCOUNT_PUBLISHED), the
// shared RailConfig id is captured (PACKAGE_IDS.ACCOUNT.RAIL_CONFIG != 0x0 →
// RAIL_CONFIG_SET — the charge PTB can't be built without the &RailConfig arg), AND the
// Deploy merchant address is pinned (SUIZE_DEPLOY_MERCHANT != 0x0). Until then the
// deploy route keeps running un-gated (auth + rate limits only) so the rest of the
// product ships — the moment those ids are set, the charge gate lights up.
import { Transaction } from "@mysten/sui/transactions";
import {
  PACKAGE_IDS,
  ACCOUNT_PUBLISHED,
  RAIL_CONFIG_SET,
  SUIZE_DEPLOY_MERCHANT,
  DEPLOY_MERCHANT_SET,
  DEPLOY_CHARGE_AMOUNT,
  DEPLOY_SUB_PRICE_USDC,
  DEPLOY_SUB_PERIOD_CAP,
  USDC_TYPE,
} from "@suize/shared";
import type {
  DeployQuoteResponse,
  DeployChargeRequest,
  DeployChargeResponse,
} from "@suize/shared";
import { config } from "../config";
import { sponsorKindBytes, executeSponsor, suiClient, SponsorError } from "../sponsor";
import type { ExecuteRequest } from "@suize/shared";

// ---------------------------------------------------------------------------
// The gate. The join is LIVE only when the rail package is published AND the
// merchant address is pinned. `chargeGateReady` is the single predicate both this
// module's endpoints and the deploy module's `chargeDigest` check read.
// ---------------------------------------------------------------------------

export const chargeGateReady = (): boolean =>
  ACCOUNT_PUBLISHED && RAIL_CONFIG_SET && DEPLOY_MERCHANT_SET;

/** A clear reason the join isn't live yet (for the 503 body). */
export const chargeGateReason = (): string =>
  !ACCOUNT_PUBLISHED
    ? "rail not configured: account package unpublished (PACKAGE_IDS.ACCOUNT is 0x0)"
    : !RAIL_CONFIG_SET
      ? "rail not configured: RailConfig object id uncaptured (PACKAGE_IDS.ACCOUNT.RAIL_CONFIG is 0x0)"
      : "rail not configured: Deploy merchant address unpinned (SUIZE_DEPLOY_MERCHANT is 0x0)";

const ACCOUNT_PACKAGE = PACKAGE_IDS.ACCOUNT.PACKAGE;
const RAIL_CONFIG_ID = PACKAGE_IDS.ACCOUNT.RAIL_CONFIG;
const CHARGE_TARGET = PACKAGE_IDS.ACCOUNT.TARGETS.CHARGE;
const CHARGE_PAID_EVENT = `${ACCOUNT_PACKAGE}::account::ChargePaid`;
/** The system Clock object id — always 0x6 on every Sui network (charge takes &Clock). */
const CLOCK_ID = "0x6";
const SUI_ADDRESS_RE = /^0x[0-9a-fA-F]{64}$/;
const DEPLOY_MEMO_DEFAULT = "Suize Deploy: one-off $0.50 deploy charge";

// ---------------------------------------------------------------------------
// The 402-shaped quote — what the caller must settle before a deploy runs.
// ---------------------------------------------------------------------------

export const deployQuote = (): DeployQuoteResponse => ({
  amount: DEPLOY_CHARGE_AMOUNT,
  coinType: USDC_TYPE,
  merchant: SUIZE_DEPLOY_MERCHANT,
  // 2% — the rail's only rake, split inline by `charge` + emitted in the event
  // (monetization as a trust feature, visible by design). The actual rate is resolved
  // on-chain from the shared RailConfig (per-merchant override or the default);
  // 200 (= default_fee_bps) is the locked default we quote.
  feeBps: 200,
  payVerb: "charge",
  description: "$0.50 per deploy (one-off). 2% rail fee, split inline + emitted on-chain.",
});

// ---------------------------------------------------------------------------
// Build + sponsor the $0.50 `charge` PTB for the caller's Account.
//
// `charge<USDC>(account, config, merchant, amount, memo, clock, ctx)` is OWNER-ONLY, so
// the `sender` of the sponsored tx MUST be the Account owner — we pin it to the verified
// caller address the deploy auth nonce recovered (NEVER a raw body field). The
// sponsor's allowedAddresses=[sender] + the on-chain owner gate together mean the
// caller can only ever charge THEIR OWN Account.
//
// We build `onlyTransactionKind` bytes (the sponsor adds gas), exactly like the
// wallet/crash clients do, then hand them to the in-process sponsor.
// ---------------------------------------------------------------------------

class ChargeError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "ChargeError";
  }
}

export { ChargeError };

/**
 * Build the sponsored `charge` ($0.50) transaction the caller signs locally.
 *
 * @param input.account the caller's shared Account<USDC> object id.
 * @param input.sender  the VERIFIED owner address (= the Account owner; pinned as the
 *                      sponsored `sender`). Validated `0x…64hex`.
 * @param input.memo    optional UTF-8 memo recorded in the ChargePaid event.
 * @throws ChargeError (400/503) on bad input / gate closed; SponsorError on Enoki failure.
 */
export const buildDeployCharge = async (
  input: DeployChargeRequest,
): Promise<DeployChargeResponse> => {
  if (!chargeGateReady()) throw new ChargeError(chargeGateReason(), 503);

  const account = typeof input?.account === "string" ? input.account.trim() : "";
  const sender = typeof input?.sender === "string" ? input.sender.trim() : "";
  const memo = typeof input?.memo === "string" && input.memo.trim() ? input.memo.trim() : DEPLOY_MEMO_DEFAULT;

  if (!SUI_ADDRESS_RE.test(account)) throw new ChargeError("invalid account id", 400);
  if (!SUI_ADDRESS_RE.test(sender)) throw new ChargeError("invalid sender address", 400);

  // charge<USDC>(account: &mut Account<USDC>, config: &RailConfig, merchant: address,
  //   amount: u64, memo: vector<u8>, clock: &Clock, ctx)
  // Post-refactor the fee rate is resolved from the shared RailConfig (per-merchant
  // override or the 2% default) + paid to RailConfig.fee_recipient — NOT from any
  // Account. The config shared object MUST be passed right after the account.
  const tx = new Transaction();
  tx.moveCall({
    target: CHARGE_TARGET,
    typeArguments: [USDC_TYPE],
    arguments: [
      tx.object(account),
      tx.object(RAIL_CONFIG_ID),
      tx.pure.address(SUIZE_DEPLOY_MERCHANT),
      tx.pure.u64(BigInt(DEPLOY_CHARGE_AMOUNT)),
      tx.pure.vector("u8", Array.from(new TextEncoder().encode(memo))),
      tx.object(CLOCK_ID),
    ],
  });

  // Build the transaction-KIND bytes (the sponsor adds the gas object). The in-process
  // sponsor pins allowedAddresses=[sender] + allow-lists the `charge` target (it is in
  // ACCOUNT_MOVE_TARGETS, unioned into the effective allow-list once published).
  const kindBytes = await tx.build({ client: suiClient, onlyTransactionKind: true });
  const transactionKindBytes = Buffer.from(kindBytes).toString("base64");

  const { bytes, digest } = await sponsorKindBytes(sender, transactionKindBytes);
  return { bytes, digest, amount: DEPLOY_CHARGE_AMOUNT, merchant: SUIZE_DEPLOY_MERCHANT };
};

// ---------------------------------------------------------------------------
// Build + sponsor the Deploy SUBSCRIPTION ($19.99/mo) `create_subscription` PTB.
//
// `create_subscription<USDC>(account, payee, period_cap, period_ms, clock, ctx): u64`
// is OWNER-ONLY (it arms a recurring debit), so exactly like `buildDeployCharge` the
// sponsored `sender` is pinned to the caller and the on-chain owner gate does the
// rest. The TERMS are the locked Deploy subscription: payee = the Deploy merchant,
// period_cap = the on-chain per-period LEASH (DEPLOY_SUB_PERIOD_CAP), period_ms =
// config.deploySubPeriodMs (defaults to the shared 30d; env-overridable so a demo
// can run 2-minute periods). The returned u64 sub_key is droppable, so the PTB
// needs no transfer; the caller reads the key from the SubscriptionCreated event.
// The relayer then debits DEPLOY_SUB_PRICE_USDC per period — never more
// (`EOverPeriodCap` is physics if it tried).
// ---------------------------------------------------------------------------

/** POST /deploy/subscribe request — `account` = the caller's shared Account<USDC>
 * id, `sender` = the caller's zkLogin owner address (pinned as sponsored sender).
 * Local (not @suize/shared) until the wire contract ships there. */
export interface DeploySubscribeRequest {
  account: string;
  sender: string;
}

/** POST /deploy/subscribe response — the sponsored bytes/digest + an echo of the
 * subscription terms the caller is about to sign. */
export interface DeploySubscribeResponse {
  bytes: string;
  digest: string;
  payee: string;
  /** What the relayer debits each period (USDC base units). */
  price: number;
  /** The on-chain per-period cap the owner signs (USDC base units). */
  periodCap: number;
  /** The recurring interval (ms). */
  periodMs: number;
}

/**
 * Build the sponsored `create_subscription` transaction the caller signs locally.
 * Mirrors {@link buildDeployCharge} (same gate, same validation, same sponsor path).
 * @throws ChargeError (400/503) on bad input / gate closed; SponsorError on Enoki failure.
 */
export const buildDeploySubscribe = async (
  input: DeploySubscribeRequest,
): Promise<DeploySubscribeResponse> => {
  if (!chargeGateReady()) throw new ChargeError(chargeGateReason(), 503);

  const account = typeof input?.account === "string" ? input.account.trim() : "";
  const sender = typeof input?.sender === "string" ? input.sender.trim() : "";
  if (!SUI_ADDRESS_RE.test(account)) throw new ChargeError("invalid account id", 400);
  if (!SUI_ADDRESS_RE.test(sender)) throw new ChargeError("invalid sender address", 400);

  // create_subscription<USDC>(account: &mut Account<USDC>, payee: address,
  //   period_cap: u64, period_ms: u64, clock: &Clock, ctx): u64
  // NOTE: last_charged_ms is set to NOW on-chain, so the FIRST charge waits one
  // full period (approve-once must not also debit-now — the $0.50 deploy charge is
  // the up-front leg; the subscription is purely the recurring storage leg).
  const tx = new Transaction();
  tx.moveCall({
    target: PACKAGE_IDS.ACCOUNT.TARGETS.CREATE_SUBSCRIPTION,
    typeArguments: [USDC_TYPE],
    arguments: [
      tx.object(account),
      tx.pure.address(SUIZE_DEPLOY_MERCHANT),
      tx.pure.u64(BigInt(DEPLOY_SUB_PERIOD_CAP)),
      tx.pure.u64(BigInt(config.deploySubPeriodMs)),
      tx.object(CLOCK_ID),
    ],
  });

  const kindBytes = await tx.build({ client: suiClient, onlyTransactionKind: true });
  const transactionKindBytes = Buffer.from(kindBytes).toString("base64");

  const { bytes, digest } = await sponsorKindBytes(sender, transactionKindBytes);
  return {
    bytes,
    digest,
    payee: SUIZE_DEPLOY_MERCHANT,
    price: DEPLOY_SUB_PRICE_USDC,
    periodCap: DEPLOY_SUB_PERIOD_CAP,
    periodMs: config.deploySubPeriodMs,
  };
};

/** POST /deploy/account response — the sponsored `create_account` bytes/digest.
 * The Account id is read from the executed tx's AccountCreated event client-side. */
export interface DeployAccountCreateResponse {
  bytes: string;
  digest: string;
}

/**
 * Build the sponsored `create_account<USDC>` transaction the caller signs locally —
 * the missing first rung for a zkLogin user with no rail Account (the CLI can't
 * sign for a zkLogin address, and `create_account` sets owner = sender, so the
 * user's own session MUST be the sender). Takes only `sender`; the Account is
 * shared on-chain by the Move fn and discovered via its AccountCreated event.
 * Mirrors {@link buildDeployCharge}'s gate/validation/sponsor path.
 */
export const buildDeployAccountCreate = async (
  sender: string,
): Promise<DeployAccountCreateResponse> => {
  if (!chargeGateReady()) throw new ChargeError(chargeGateReason(), 503);

  const s = typeof sender === "string" ? sender.trim() : "";
  if (!SUI_ADDRESS_RE.test(s)) throw new ChargeError("invalid sender address", 400);

  // create_account<USDC>(ctx) — mints + SHARES an Account owned by the tx sender.
  const tx = new Transaction();
  tx.moveCall({
    target: PACKAGE_IDS.ACCOUNT.TARGETS.CREATE_ACCOUNT,
    typeArguments: [USDC_TYPE],
    arguments: [],
  });

  const kindBytes = await tx.build({ client: suiClient, onlyTransactionKind: true });
  const transactionKindBytes = Buffer.from(kindBytes).toString("base64");

  const { bytes, digest } = await sponsorKindBytes(s, transactionKindBytes);
  return { bytes, digest };
};

/**
 * Execute a previously-sponsored charge the caller signed locally. The minimal HTTP
 * execute slice the join needs to be driveable as a terminal script (the full
 * HTTP-only sponsor transport — re-adding a general /sponsor + /execute — is the
 * separate SPEC §6 refactor, NOT built here). Security: the sponsored `digest` was
 * already pinned to a `sender` at sponsor time (allowedAddresses=[sender]); executing
 * needs that exact digest AND the user's signature over the sponsored bytes — neither
 * forgeable by a third party — so this carries the same property as the WS execute.
 * Thin wrapper over {@link executeSponsor}; throws SponsorError on bad input/Enoki.
 */
export const executeDeployCharge = async (
  input: Partial<ExecuteRequest>,
): Promise<{ digest: string }> => {
  if (!chargeGateReady()) throw new ChargeError(chargeGateReason(), 503);
  return executeSponsor(input);
};

// ---------------------------------------------------------------------------
// Verify a settled charge before a deploy runs. The caller passes the EXECUTED
// charge tx digest (from POST /execute); we read that transaction's events and
// require a ChargePaid that (a) pays the Deploy merchant, (b) for ≥ $0.50 gross, and
// (c) was signed by the deploying owner (so a charge can't be replayed by a third
// party). Single-use: a digest is consumed on first successful deploy so the same
// $0.50 can't pay for two sites.
// ---------------------------------------------------------------------------

// Charge digests move through three states: AVAILABLE → IN-FLIGHT (reserved by a
// deploy that verified it on-chain) → CONSUMED (that deploy minted its Site). The
// split matters twice: (a) a digest is only burned AFTER the Site exists, so a
// transient Walrus/mint failure releases the reservation and the SAME paid charge
// can retry — no "paid but no site"; (b) the in-flight set is checked+written
// SYNCHRONOUSLY before any await, so two concurrent deploys carrying the same
// digest can't both pass verification. In-memory, per replica (single-replica is
// the documented constraint; a cross-replica store is post-demo work) — the
// on-chain charge is the hard fact, this stops replay within the process.
const consumedCharges = new Set<string>();
const inflightCharges = new Set<string>();

const TX_DIGEST_RE = /^[A-Za-z0-9]{40,50}$/; // base58 Sui tx digest (no 0/O/I/l, ~44 chars).

interface ChargePaidJson {
  account_id?: string;
  merchant?: string;
  gross?: string | number;
  net?: string | number;
  fee?: string | number;
}

const toNum = (v: unknown): number => {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : NaN;
};

/** Reject charges older than this — bounds replay-after-eviction (the consumed set
 * FIFO-prunes past 10k entries; an evicted ancient digest must still never gate a
 * deploy). A freshly-executed tx may not carry `timestampMs` yet (not checkpointed)
 * — that is the OPPOSITE of stale, so a missing timestamp is allowed. */
const MAX_CHARGE_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Verify the charge `digest` settled the EXACT $0.50 payment to the Deploy merchant,
 * signed by `expectedPayer`, and RESERVE it (in-flight). Returns null on success; a
 * ChargeError (402/409/502) otherwise. The digest is NOT consumed here — the deploy
 * calls {@link commitDeployCharge} after the Site mint succeeds, or
 * {@link releaseDeployCharge} on a downstream failure so the paid charge can retry.
 *
 * @param digest         the executed charge tx digest the caller got from /execute.
 * @param expectedPayer  the deploy owner (the recovered deploy-auth signer). The
 *                       charge's `ChargePaid.account_id` Account must be owned by them
 *                       AND the tx must have been sent by them — proven by requiring
 *                       the tx sender == expectedPayer (charge is owner-only, so the
 *                       on-chain `sender == account.owner` already holds; we re-check
 *                       the tx sender so a third party can't hand us someone else's
 *                       unrelated charge digest).
 */
export const reserveDeployCharge = async (
  digest: string,
  expectedPayer: string,
): Promise<ChargeError | null> => {
  if (!chargeGateReady()) return new ChargeError(chargeGateReason(), 503);

  const d = typeof digest === "string" ? digest.trim() : "";
  if (!d || !TX_DIGEST_RE.test(d)) {
    return new ChargeError("payment required: missing or malformed chargeDigest", 402);
  }
  if (!SUI_ADDRESS_RE.test(expectedPayer)) {
    return new ChargeError("invalid payer address", 400);
  }
  if (consumedCharges.has(d)) {
    return new ChargeError("charge already used for a deploy", 409);
  }
  if (inflightCharges.has(d)) {
    return new ChargeError("charge is already gating a deploy in progress", 409);
  }

  // Reserve BEFORE the first await — without this, two concurrent deploys carrying
  // the same digest both pass the checks above during the RPC reads below and one
  // $0.50 pays for two sites. Every failure path past here MUST release.
  inflightCharges.add(d);
  const fail = (err: ChargeError): ChargeError => {
    inflightCharges.delete(d);
    return err;
  };

  let tx;
  try {
    tx = await suiClient.getTransactionBlock({
      digest: d,
      options: { showEvents: true, showEffects: true, showInput: true },
    });
  } catch (err) {
    console.error("[deploy/charge] tx read failed:", (err as Error).message);
    return fail(new ChargeError("could not verify charge (tx unreadable)", 502));
  }

  if (tx.effects?.status?.status !== "success") {
    return fail(new ChargeError("charge transaction did not succeed", 402));
  }

  // Stale-charge guard: an old settled charge (possibly evicted from the consumed
  // set) can't be dusted off to gate a new deploy.
  const ts = tx.timestampMs ? Number(tx.timestampMs) : NaN;
  if (Number.isFinite(ts) && Date.now() - ts > MAX_CHARGE_AGE_MS) {
    return fail(
      new ChargeError("charge too old (settle the quote within 24h of deploying)", 402),
    );
  }

  // The tx must have been SENT by the deploying owner — a third party can't pass us
  // an unrelated ChargePaid digest. `charge` is owner-only on-chain, so the tx sender
  // already equals the Account owner; we re-assert it equals the deploy signer.
  const txSender = tx.transaction?.data?.sender;
  if (typeof txSender !== "string" || txSender.toLowerCase() !== expectedPayer.toLowerCase()) {
    return fail(new ChargeError("charge was not signed by the deploying owner", 402));
  }

  // Find a ChargePaid event in THIS tx paying the Deploy merchant EXACTLY $0.50 —
  // exact, not ≥: our builder charges the quoted amount to the unit, so anything
  // else is a hand-rolled PTB we don't want to silently accept.
  const events = tx.events ?? [];
  const paid = events.find((ev) => {
    if (ev.type !== CHARGE_PAID_EVENT) return false;
    const pj = ev.parsedJson as ChargePaidJson;
    if (!pj || typeof pj.merchant !== "string") return false;
    if (pj.merchant.toLowerCase() !== SUIZE_DEPLOY_MERCHANT.toLowerCase()) return false;
    const gross = toNum(pj.gross);
    return gross === DEPLOY_CHARGE_AMOUNT;
  });

  if (!paid) {
    return fail(
      new ChargeError(
        "no qualifying ChargePaid (need the exact $0.50 charge to the Deploy merchant in this tx)",
        402,
      ),
    );
  }

  return null; // verified — stays reserved until commit/release.
};

/** Burn a reserved charge — call ONLY after the Site mint succeeded. */
export const commitDeployCharge = (digest: string): void => {
  const d = digest.trim();
  inflightCharges.delete(d);
  consumedCharges.add(d);
};

/** Release a reserved charge after a downstream failure — the paid digest stays
 * valid for a retry. No-op for a committed digest (it left the in-flight set). */
export const releaseDeployCharge = (digest: string): void => {
  inflightCharges.delete(digest.trim());
};

// Bound the consumed-charges set so it can't grow unbounded across a long-running
// replica. Charges are cheap to re-verify on-chain; pruning the oldest entries when
// the set gets large is safe (the on-chain record is the source of truth). A simple
// size cap with FIFO eviction is enough — replay within the window is what we block.
const MAX_CONSUMED = 10_000;
setInterval(() => {
  if (consumedCharges.size <= MAX_CONSUMED) return;
  const overflow = consumedCharges.size - MAX_CONSUMED;
  let i = 0;
  for (const d of consumedCharges) {
    if (i++ >= overflow) break;
    consumedCharges.delete(d);
  }
}, 60 * 60 * 1000).unref?.();

export const chargeInfo = {
  enabled: chargeGateReady(),
  amount: DEPLOY_CHARGE_AMOUNT,
  merchant: SUIZE_DEPLOY_MERCHANT,
  accountPublished: ACCOUNT_PUBLISHED,
  railConfigSet: RAIL_CONFIG_SET,
  merchantSet: DEPLOY_MERCHANT_SET,
};

// Re-export so the deploy module can map a SponsorError thrown by buildDeployCharge
// onto an HTTP response without importing the sponsor module itself.
export { SponsorError };
