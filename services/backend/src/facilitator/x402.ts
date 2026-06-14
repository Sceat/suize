// Facilitator CORE — x402 V2 'exact' verify + settle + build, KEYLESS.
//
// The new rail is vanilla x402: the payer signs a gasless Address-Balance
// `send_funds` PTB whose outputs are the declared fee split; the facilitator
// VERIFIES the signed-but-not-executed tx pays EXACTLY that split (simulate +
// assertOutputsExact), then SETTLES by broadcasting it via gRPC executeTransaction
// — NO Enoki, NO sponsor, NO owner-tx signing. account.move is dead here.
//
//   doVerify(payload, requirements) → VerifyResponse
//     scheme==='exact' + network match + payload {signature, transaction};
//     gasless-shape guard; REPLAY guard (reject an already-executed digest — a
//     re-simulation of a settled gasless tx SUCCEEDS, so the chain read is the only
//     sound guard); then recover the payer from the signature ∥ simulate the tx, in
//     parallel; assertOutputsExact vs requirements.extra.outputs (default: a single
//     output of the full amount to payTo — the free tier); the recovered signer MUST
//     equal the simulated sender. Returns { isValid:true, payer } or
//     { isValid:false, invalidReason, invalidMessage } (reason = OutputsError.code).
//
//   doSettle(payload, requirements) → SettleResponse
//     IDEMPOTENT, stateless-first: precompute the digest from the bytes, then read the
//     chain — an already-executed digest returns its on-chain result WITHOUT re-verify
//     or re-broadcast (gRPC executeTransaction throws on a spent tx); else re-verify
//     (never broadcast an unverified tx) → executeTransaction → waitForTransaction →
//     check effects success. A per-replica cache + in-flight join fast-paths the local
//     replay; the chain read covers cross-replica/restart, so a replay of the same
//     payment always returns the SAME response and never double-charges.
//
//   buildDoor({ sender, outputs }) → unsigned gasless bytes (THE PROBE RECIPE:
//     buildGaslessOutputs → setGasBudget(0n) inside @suize/x402). The optional
//     facilitator-built door for a payer that doesn't want to construct the PTB.
//
// ONE SuiGrpcClient singleton — the transport where gasless eligibility resolves.

import { Transaction } from "@mysten/sui/transactions";
import { fromBase64 } from "@mysten/sui/utils";
import type { SuiGrpcClient } from "@mysten/sui/grpc";
import {
  grpcClient,
  recoverPayer,
  assertOutputsExact,
  assertGaslessTxShape,
  OutputsError,
  buildGaslessOutputs,
  type Output,
  type PaymentRequirements,
  type PaymentPayload,
  type VerifyResponse,
  type SettleResponse,
  type Network,
} from "@suize/x402";
import { caip2, USDC_TYPES, type SuiNetwork } from "@suize/shared";
import { config } from "../config";

// ── network + the one gRPC client ─────────────────────────────────────────────
export const FACILITATOR_NETWORK: Network = caip2(config.suiNetwork);
const ASSET = USDC_TYPES[config.suiNetwork as SuiNetwork];

let _client: SuiGrpcClient | null = null;
/** The ONE gRPC client (the transport that bakes in gasless params + does the
 * simulate/execute). Built lazily so the module imports cleanly. */
export const client = (): SuiGrpcClient => {
  if (!_client) _client = grpcClient(FACILITATOR_NETWORK);
  return _client;
};

/** The default output split for a PaymentRequirements with no explicit outputs:
 * a SINGLE output of the full amount to payTo (the free tier). */
const defaultOutputs = (r: PaymentRequirements): Output[] =>
  r.extra?.outputs && r.extra.outputs.length > 0
    ? r.extra.outputs
    : [{ to: r.payTo, amount: r.amount }];

/** Shape guard for the inbound exact-Sui payload (both fields base64 strings). */
const isExactPayload = (p: unknown): p is { signature: string; transaction: string } =>
  typeof p === "object" &&
  p !== null &&
  typeof (p as { signature?: unknown }).signature === "string" &&
  typeof (p as { transaction?: unknown }).transaction === "string";

// ── VERIFY ─────────────────────────────────────────────────────────────────────

const fail = (reason: string, message: string): VerifyResponse => ({
  isValid: false,
  invalidReason: reason,
  invalidMessage: message,
});

/**
 * Has the chain ALREADY executed this digest? — the ONLY sound replay guard for a
 * gasless Address-Balance payment. Re-SIMULATING an already-executed gasless tx
 * SUCCEEDS (proven on testnet 2026-06-12: a gasless transfer has NO object inputs,
 * so nothing is consumed and the dry-run still passes for its whole ~2-epoch
 * ValidDuring window) — so simulation is NOT a replay guard. The digest is the unique
 * payment identity, derivable from the signed bytes; ONE getTransaction read against
 * it is the stateless replay check (the chain is the database). A not-found read
 * THROWS (unexecuted → proceed); a found read means it already settled → reject/idempotent.
 */
const alreadyExecuted = async (digest: string): Promise<boolean> => {
  try {
    const read = await client().getTransaction({ digest, include: { effects: true } });
    const tx = read.$kind === "Transaction" ? read.Transaction : read.FailedTransaction;
    // A FOUND tx (success OR on-chain failure) consumed this payment's identity — a
    // re-presentation of the same bytes must never re-serve a merchant.
    return tx != null;
  } catch {
    // Not found / unreadable → treat as unexecuted (the simulate/exact-fee gate and,
    // at settle, the executeTransaction throw-then-read fallback remain the backstops).
    return false;
  }
};

/**
 * Verify a signed-but-not-executed `exact` payment pays the declared split.
 * Pure read (simulate only — never broadcasts). Returns the recovered payer on
 * success; an x402 invalidReason on any mismatch.
 */
export const doVerify = async (
  payload: PaymentPayload,
  requirements: PaymentRequirements,
): Promise<VerifyResponse> => {
  if (requirements.scheme !== "exact") {
    return fail("unsupported_scheme", `scheme must be 'exact', got '${requirements.scheme}'`);
  }
  if (requirements.network !== FACILITATOR_NETWORK) {
    return fail(
      "invalid_network",
      `network must be '${FACILITATOR_NETWORK}', got '${requirements.network}'`,
    );
  }
  if (!isExactPayload(payload?.payload)) {
    return fail("invalid_payload", "payload.payload must be { signature, transaction } (base64)");
  }

  const { signature, transaction } = payload.payload;
  const outputs = defaultOutputs(requirements);

  try {
    // F3: POWER-door guard. The payer may have built its OWN PTB, so before the
    // simulation we cheaply assert the tx is gasless-command-shaped (gasPrice 0,
    // gasPayment empty, only allowlisted send_funds/redeem_funds/into_balance +
    // coin SplitCoins/MergeCoins) — no arbitrary command can route the asset
    // through an unexpected path. Pure decode, no network. (The exact-fee check
    // below already binds every credit; this is defence-in-depth on the shape.)
    assertGaslessTxShape(transaction);

    // REPLAY GUARD: simulation alone is NOT one for gasless Address-Balance txs (a
    // re-simulation of an already-settled gasless tx SUCCEEDS — no inputs consumed).
    // The digest is the payment's unique identity; if the chain already executed it,
    // this PaymentPayload was already settled → invalid (a replayed payment must not
    // pass /verify for its entire ValidDuring window and double-serve a merchant).
    const digest = await Transaction.from(fromBase64(transaction)).getDigest();
    if (await alreadyExecuted(digest)) {
      return fail(
        "invalid_exact_sui_payload_already_executed",
        `payment already executed on-chain (digest ${digest})`,
      );
    }

    // Recover the signer ∥ simulate the tx in parallel: the signer is the claimed
    // payer; the simulation proves the exact split AND yields the simulated sender.
    const [recovered, sim] = await Promise.all([
      recoverPayer(transaction, signature),
      assertOutputsExact({ client: client(), txBytesB64: transaction, asset: ASSET, outputs }),
    ]);

    // The recovered signer MUST be the simulated sender — a payment signed by one
    // key but built to debit another address is rejected (no proxy debits).
    if (recovered.toLowerCase() !== sim.payer.toLowerCase()) {
      return fail(
        "invalid_exact_sui_payload_outputs_mismatch",
        `signer ${recovered} ≠ sender ${sim.payer}`,
      );
    }
    return { isValid: true, payer: sim.payer };
  } catch (e) {
    if (e instanceof OutputsError) return fail(e.code, e.message);
    console.error("[facilitator/verify]", (e as Error).message);
    return fail("invalid_payload", `verify failed: ${(e as Error).message}`);
  }
};

// ── SETTLE — idempotent broadcast ───────────────────────────────────────────────
// Idempotency discipline (digest = the payment's identity, precomputed from the bytes
// via Transaction.from().getDigest()): a terminal result is cached by digest; concurrent
// settles of the same digest join ONE in-flight promise; a periodic sweeper bounds both
// maps. Across replicas/restarts the cache misses, so the run-closure FIRST reads the
// chain for an already-executed digest and returns its on-chain result — never a
// re-broadcast (gRPC executeTransaction THROWS on a spent tx). A replay therefore
// always returns the same response and never double-charges.

const settleCache = new Map<string, SettleResponse>(); // terminal results only
const inflightSettles = new Map<string, Promise<SettleResponse>>();

const settleErr = (
  digest: string,
  reason: string,
  message: string,
  payer?: string,
): SettleResponse => ({
  success: false,
  errorReason: reason,
  errorMessage: message,
  transaction: digest,
  network: FACILITATOR_NETWORK,
  payer,
});

/**
 * Broadcast a verified `exact` payment and await finality. Idempotent by digest.
 * Re-verifies first (never broadcasts an unverified tx). A tx that executes but
 * FAILS on-chain returns success:false — a failed tx never reads as settled.
 */
export const doSettle = async (
  payload: PaymentPayload,
  requirements: PaymentRequirements,
): Promise<SettleResponse> => {
  if (!isExactPayload(payload?.payload)) {
    return settleErr("", "invalid_payload", "payload.payload must be { signature, transaction }");
  }
  const { signature, transaction } = payload.payload;

  // Precompute the digest from the bytes — the idempotency key, known before any
  // broadcast (a fully-built tx is self-resolving, no client needed).
  let digest: string;
  try {
    digest = await Transaction.from(fromBase64(transaction)).getDigest();
  } catch (e) {
    return settleErr("", "invalid_payload", `undecodable tx bytes: ${(e as Error).message}`);
  }

  const cached = settleCache.get(digest);
  if (cached) return cached;
  const inflight = inflightSettles.get(digest);
  if (inflight) return inflight;

  const run = (async (): Promise<SettleResponse> => {
    // IDEMPOTENCY across replicas/restarts: if the chain already executed this digest
    // (settleCache missed because a DIFFERENT replica settled it), read the on-chain
    // result and return it directly — do NOT re-broadcast (gRPC executeTransaction
    // THROWS on a spent tx) and do NOT route through doVerify (which now correctly
    // REJECTS an already-executed digest as a replay). A success reads back as success;
    // an executed-but-failed tx reads back as a terminal settle failure.
    try {
      const read = await client().getTransaction({ digest, include: { effects: true, transaction: true } });
      const tx = read.$kind === "Transaction" ? read.Transaction : read.FailedTransaction;
      const payer = (tx?.transaction as { sender?: string } | undefined)?.sender;
      const r: SettleResponse =
        tx?.effects?.status?.success === true || tx?.status?.success === true
          ? { success: true, transaction: digest, network: FACILITATOR_NETWORK, payer, amount: requirements.amount }
          : settleErr(digest, "settle_failed", "tx already executed on-chain but FAILED", payer);
      settleCache.set(digest, r);
      return r;
    } catch {
      // Not found / unreadable → unexecuted; fall through to verify + broadcast.
    }

    // Re-verify before broadcasting (the verify call may be from a stale quote;
    // settle is the authoritative gate).
    const verified = await doVerify(payload, requirements);
    if (!verified.isValid) {
      // A verify failure is terminal for THIS payload — cache so a retry of an
      // un-settleable payment doesn't re-simulate forever.
      const r = settleErr(digest, verified.invalidReason ?? "invalid_payload", verified.invalidMessage ?? "verify failed");
      settleCache.set(digest, r);
      return r;
    }
    const payer = verified.payer;

    let result: SettleResponse;
    try {
      const exec = await client().executeTransaction({
        transaction: fromBase64(transaction),
        signatures: [signature],
        include: { effects: true },
      });
      // Await finality on the SAME client so an immediate read is answerable.
      const final = await client().waitForTransaction({ digest, include: { effects: true } });
      const tx = final.$kind === "Transaction" ? final.Transaction : final.FailedTransaction;
      const ok = tx?.effects?.status?.success === true || tx?.status?.success === true;
      result = ok
        ? {
            success: true,
            transaction: digest,
            network: FACILITATOR_NETWORK,
            payer,
            amount: requirements.amount,
          }
        : settleErr(
            digest,
            "settle_failed",
            `tx executed but FAILED on-chain: ${JSON.stringify(tx?.effects?.status?.error ?? tx?.status?.error ?? "unknown")}`.slice(0, 200),
            payer,
          );
      void exec; // execute is awaited above; waitForTransaction is the truth.
    } catch (e) {
      // Idempotency fallback: a replay where the chain already executed this digest
      // makes executeTransaction throw (the tx is spent). The chain is the truth —
      // read it; if it succeeded, this WAS a settlement of ours.
      try {
        const read = await client().getTransaction({ digest, include: { effects: true } });
        const tx = read.$kind === "Transaction" ? read.Transaction : read.FailedTransaction;
        if (tx?.effects?.status?.success === true || tx?.status?.success === true) {
          result = { success: true, transaction: digest, network: FACILITATOR_NETWORK, payer, amount: requirements.amount };
        } else {
          // Not readable as a success → the original broadcast error is the truth.
          return settleErr(digest, "settle_failed", `broadcast failed: ${(e as Error).message}`.slice(0, 200), payer);
        }
      } catch {
        // A transport error (NOT a terminal on-chain failure) — do NOT cache; the
        // caller may legitimately retry.
        return settleErr(digest, "settle_failed", `broadcast failed: ${(e as Error).message}`.slice(0, 200), payer);
      }
    }

    settleCache.set(digest, result); // terminal — cache it
    return result;
  })();

  inflightSettles.set(digest, run);
  try {
    return await run;
  } finally {
    inflightSettles.delete(digest);
  }
};

// Bound the terminal cache on a long-running replica (FIFO eviction — the chain is
// the durable truth, the cache is only a fast-path replay guard).
const MAX_CACHED_SETTLES = 10_000;
setInterval(() => {
  if (settleCache.size > MAX_CACHED_SETTLES) {
    const overflow = settleCache.size - MAX_CACHED_SETTLES;
    let i = 0;
    for (const k of settleCache.keys()) {
      if (i++ >= overflow) break;
      settleCache.delete(k);
    }
  }
}, 60_000).unref?.();

// ── BUILD DOOR — the optional facilitator-built unsigned bytes ──────────────────

/**
 * Build the unsigned gasless `exact` payment bytes for a declared split (THE PROBE
 * RECIPE: buildGaslessOutputs sets gasBudget(0n) to force the gasless election).
 * The payer signs these LOCALLY (the facilitator never signs an owner leg) — and
 * MUST run assertUnsignedBytesSafe before signing (the hard pre-sign gate). Returns
 * the base64 TransactionData bytes — exactly what X-PAYMENT carries.
 */
export const buildDoor = async (opts: {
  sender: string;
  outputs: Output[];
}): Promise<{ bytes: string }> => {
  const { bytes } = await buildGaslessOutputs({
    client: client(),
    sender: opts.sender,
    asset: ASSET,
    outputs: opts.outputs,
  });
  return { bytes };
};

export { ASSET };
