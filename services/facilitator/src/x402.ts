// Facilitator CORE — x402 V2 'exact' verify + settle, KEYLESS.
//
// The payer signs a gasless Address-Balance `send_funds` PTB whose outputs are the
// declared fee split; the facilitator VERIFIES the signed-but-not-executed tx pays
// EXACTLY the split the OPERATOR policy recomputes (simulate + assertOutputsExact),
// then SETTLES by broadcasting it over gRPC — no key, no sponsor, no owner-tx signing.
//
//   doVerify(client, policy, payload, requirements) → VerifyResponse
//     scheme 'exact' + network match + { signature, transaction } shape; a cheap
//     gasless command-shape guard; recompute the canonical split from POLICY (ignoring
//     the payer-declared outputs); a chain-read REPLAY guard (a re-simulation of a
//     settled gasless tx SUCCEEDS — the chain is the only sound guard); simulate +
//     assertOutputsExact; the recovered signer must equal the simulated sender.
//
//   doSettle(client, policy, payload, requirements) → SettleResponse
//     IDEMPOTENT per (digest, payTo, amount): read the chain first — an already-executed
//     digest returns success ONLY after its ON-CHAIN balance changes are matched against
//     the split recomputed for THESE requirements (an executed digest is never blessed
//     for requirements it did not pay — the mis-attribution guard); else re-verify →
//     executeTransaction → waitForTransaction → check effects. A replay never
//     double-charges (the chain refuses a spent tx).
//
// FAILURE TAXONOMY (load-bearing): TERMINAL failures (bad bytes, bad signature, output
// mismatch, already-executed) are cacheable — the same payload can never become valid.
// TRANSIENT failures (treasury name unresolved, RPC unreachable) surface as
// `facilitator_unready` and are NEVER cached — the same payload may be valid in a
// minute, and pinning the failure would wedge a legitimate payment on this isolate.

import { Transaction } from "@mysten/sui/transactions";
import { fromBase64 } from "@mysten/sui/utils";
import type { SuiGrpcClient } from "@mysten/sui/grpc";
import {
  recoverPayer,
  assertOutputsExact,
  assertGaslessTxShape,
  normalizeBalanceChanges,
  outputProblems,
  OutputsError,
  type Output,
  type PaymentRequirements,
  type PaymentPayload,
  type VerifyResponse,
  type SettleResponse,
} from "@suize/x402";
import type { FeePolicy } from "./env";
import { outputsFor, TreasuryUnresolvedError } from "./fees";

/** The TRANSIENT failure reason — facilitator-side, never the payload's fault, never
 * cached. Merchants/payers should retry; /supported.ready reflects the same state. */
export const TRANSIENT_REASON = "facilitator_unready";

/** Shape guard for the inbound exact-Sui payload (both fields base64 strings). */
const isExactPayload = (
  p: unknown,
): p is { signature: string; transaction: string } =>
  typeof p === "object" &&
  p !== null &&
  typeof (p as { signature?: unknown }).signature === "string" &&
  typeof (p as { transaction?: unknown }).transaction === "string";

const fail = (reason: string, message: string): VerifyResponse => ({
  isValid: false,
  invalidReason: reason,
  invalidMessage: message,
});

/** A gRPC "this digest is not on chain" — the ONLY error `alreadyExecuted` may
 * swallow. Anything else (transport, rate-limit, TLS…) means WE DON'T KNOW, and
 * unknown must fail closed, never read as "unexecuted". */
const isNotFound = (e: unknown): boolean => {
  const err = e as { code?: unknown; message?: unknown };
  return (
    err?.code === "NOT_FOUND" ||
    err?.code === 5 || // gRPC status code NOT_FOUND
    /not[ _-]?found/i.test(String(err?.message ?? ""))
  );
};

/** Thrown when the replay guard cannot get an answer from the chain. TRANSIENT. */
class ReplayGuardUnavailableError extends Error {
  constructor(cause: string) {
    super(`replay guard unavailable (chain read failed): ${cause}`);
    this.name = "ReplayGuardUnavailableError";
  }
}

/**
 * Has the chain ALREADY executed this digest? — the ONLY sound replay guard for a
 * gasless Address-Balance payment: re-SIMULATING an already-executed gasless tx
 * SUCCEEDS (no object inputs are consumed), so simulation is NOT a replay guard.
 * NOT_FOUND → false (unexecuted). Any OTHER error throws (fail closed): during an
 * RPC blip we cannot distinguish a replay from a fresh payment, so we refuse to
 * answer rather than wave a possible replay through.
 */
const alreadyExecuted = async (
  client: SuiGrpcClient,
  digest: string,
): Promise<boolean> => {
  try {
    const read = await client.getTransaction({ digest, include: { effects: true } });
    const tx = read.$kind === "Transaction" ? read.Transaction : read.FailedTransaction;
    return tx != null; // a found tx (success OR on-chain failure) consumed this identity
  } catch (e) {
    if (isNotFound(e)) return false;
    throw new ReplayGuardUnavailableError((e as Error).message);
  }
};

// ── broadcast-ack-lost recovery poll ──────────────────────────────────────────
// A gasless send_funds finalizes DETERMINISTICALLY from its signed bytes, but not
// always by the instant a broadcast throws — a gRPC deadline abort can fire while the
// tx is still 1-3s from finality. So when the broadcast path loses its ack, we do NOT
// read the chain once and give up (that reports a LANDED settle as failed, and the
// payer then pays twice — the reproduced double-charge). We POLL a few times over
// ~8s, tolerating NOT_FOUND between reads, and stop on the first definitive answer.

/** Poll schedule (ms between the 5 reads → ~8s window). Overridable in tests
 * (setSettlePoll) so the suite never sleeps the real window. */
let SETTLE_POLL_WAITS_MS: readonly number[] = [1500, 2000, 2000, 2500];
/** TEST SEAM ONLY — shrink the settle recovery-poll waits. No production caller. */
export const setSettlePoll = (waits: readonly number[]): void => {
  SETTLE_POLL_WAITS_MS = waits;
};

/**
 * Poll the chain for an EXECUTED tx after a lost broadcast ack. Reads up to
 * SETTLE_POLL_WAITS_MS.length + 1 times, waiting between reads and tolerating
 * NOT_FOUND. Returns the found tx (executed SUCCESS or on-chain FAILURE) on the first
 * hit, or null if still NOT_FOUND after the window. A non-NOT_FOUND read error
 * propagates (the caller treats it as the original broadcast failure).
 */
const pollExecuted = async (client: SuiGrpcClient, digest: string): Promise<unknown | null> => {
  for (let i = 0; ; i++) {
    try {
      const read = await client.getTransaction({
        digest,
        include: { effects: true, balanceChanges: true, transaction: true },
      });
      return read.$kind === "Transaction" ? read.Transaction : read.FailedTransaction;
    } catch (e) {
      if (!isNotFound(e)) throw e; // unknown read error → let the caller fail closed
    }
    if (i >= SETTLE_POLL_WAITS_MS.length) return null; // window exhausted, still unseen
    await new Promise((r) => setTimeout(r, SETTLE_POLL_WAITS_MS[i]));
  }
};

/**
 * Verify a signed-but-not-executed `exact` payment pays the recomputed split. Pure
 * read (simulate only — never broadcasts). Returns the recovered payer on success; an
 * x402 invalidReason on any mismatch; `facilitator_unready` on facilitator-side
 * transients (NEVER cacheable — see the failure taxonomy above).
 */
export const doVerify = async (
  client: SuiGrpcClient,
  policy: FeePolicy,
  payload: PaymentPayload,
  requirements: PaymentRequirements,
): Promise<VerifyResponse> => {
  if (requirements.scheme !== "exact") {
    return fail("unsupported_scheme", `scheme must be 'exact', got '${requirements.scheme}'`);
  }
  if (requirements.network !== policy.caip2) {
    return fail("invalid_network", `network must be '${policy.caip2}', got '${requirements.network}'`);
  }
  if (!isExactPayload(payload?.payload)) {
    return fail("invalid_payload", "payload.payload must be { signature, transaction } (base64)");
  }

  const { signature, transaction } = payload.payload;

  // ── TERMINAL phase: pure decode + crypto, no network. Any throw here means the
  // BYTES/SIGNATURE are bad — the same payload can never become valid (cacheable).
  let digest: string;
  let recovered: string;
  try {
    // Gasless command-shape guard: gasPrice 0, gasPayment empty, only allowlisted
    // send_funds/redeem_funds/into_balance + coin SplitCoins/MergeCoins. The exact-fee
    // check below binds every credit; this is defence-in-depth on the shape.
    assertGaslessTxShape(transaction);
    digest = await Transaction.from(fromBase64(transaction)).getDigest();
    recovered = await recoverPayer(transaction, signature); // pure crypto, no network
  } catch (e) {
    // assertGaslessTxShape throws OutputsError with its own terminal code (e.g. the
    // not-gasless / disallowed-command verdicts) — preserve it; anything else here is
    // undecodable bytes or an unusable signature (equally terminal).
    if (e instanceof OutputsError) return fail(e.code, e.message);
    return fail("invalid_payload", `verify failed: ${(e as Error).message}`);
  }

  // ── NETWORK phase: policy recompute, replay guard, simulation. Typed transients
  // surface as facilitator_unready; an OutputsError is a terminal verdict.
  try {
    // FORCE THE FEE. Recompute the canonical split from the OPERATOR policy, IGNORING
    // whatever the merchant declared in requirements.extra.outputs — a merchant cannot
    // present fee-free terms and have us settle them.
    const outputs = await outputsFor(policy, client, requirements.payTo, BigInt(requirements.amount));

    // REPLAY GUARD (see alreadyExecuted): the digest is the payment's unique identity.
    if (await alreadyExecuted(client, digest)) {
      return fail(
        "invalid_exact_sui_payload_already_executed",
        `payment already executed on-chain (digest ${digest})`,
      );
    }

    // Simulate: proves the exact split AND yields the simulated sender.
    const sim = await assertOutputsExact({ client, txBytesB64: transaction, asset: policy.asset, outputs });

    // The recovered signer MUST be the simulated sender — no proxy debits.
    if (recovered.toLowerCase() !== sim.payer.toLowerCase()) {
      return fail("invalid_exact_sui_payload_outputs_mismatch", `signer ${recovered} ≠ sender ${sim.payer}`);
    }
    return { isValid: true, payer: sim.payer };
  } catch (e) {
    if (e instanceof OutputsError) return fail(e.code, e.message); // terminal verdict
    if (e instanceof TreasuryUnresolvedError || e instanceof ReplayGuardUnavailableError) {
      console.error("[facilitator/verify] transient:", (e as Error).message);
      return fail(TRANSIENT_REASON, (e as Error).message);
    }
    // Unknown error in the NETWORK phase — conservatively transient (a transport
    // failure must never pin a legitimate payment as terminally invalid).
    console.error("[facilitator/verify]", (e as Error).message);
    return fail(TRANSIENT_REASON, `verify could not complete: ${(e as Error).message}`);
  }
};

// ── SETTLE — idempotent broadcast, requirements-bound ────────────────────────────
// The idempotency key is (digest, payTo, amount) — NOT the digest alone. Binding the
// key (and every cached result) to the requirements prevents cross-requirements
// poisoning in BOTH directions: an attacker's mismatched settle can't pin a failure
// for the honest merchant, and an honest success can't be replayed as success for
// fabricated requirements. Terminal results only; transients are never cached.

const settleCache = new Map<string, SettleResponse>(); // terminal results only
const inflightSettles = new Map<string, Promise<SettleResponse>>();
const MAX_CACHED_SETTLES = 10_000;

const settleKey = (digest: string, req: PaymentRequirements): string =>
  `${digest}|${req.payTo.trim().toLowerCase()}|${String(req.amount)}`;

/** Cache a terminal settle result, bounding the map inline (FIFO — the chain is the
 * durable truth; this cache is only a fast-path replay guard). Evict on insert:
 * a Worker has no reliable between-request timer. */
const cacheSettle = (key: string, r: SettleResponse): SettleResponse => {
  settleCache.set(key, r);
  if (settleCache.size > MAX_CACHED_SETTLES) {
    const oldest = settleCache.keys().next().value;
    if (oldest !== undefined) settleCache.delete(oldest);
  }
  return r;
};

const settleErr = (
  network: `sui:${string}`,
  digest: string,
  reason: string,
  message: string,
  payer?: string,
): SettleResponse => ({
  success: false,
  errorReason: reason,
  errorMessage: message,
  transaction: digest,
  network,
  payer,
});

/** Match an EXECUTED tx's on-chain balance changes against the split recomputed for
 * the caller's requirements. The mis-attribution guard: an already-settled digest is
 * blessed ONLY for the requirements it actually paid. Returns null when it matches,
 * else the problem list. Throws TreasuryUnresolvedError (transient) when the policy
 * treasury can't resolve. */
const executedMatchesRequirements = async (
  client: SuiGrpcClient,
  policy: FeePolicy,
  tx: unknown,
  requirements: PaymentRequirements,
  payer: string,
): Promise<string[] | null> => {
  const outputs: Output[] = await outputsFor(
    policy,
    client,
    requirements.payTo,
    BigInt(requirements.amount),
  );
  const problems = outputProblems(normalizeBalanceChanges(tx), policy.asset, outputs, payer);
  return problems.length === 0 ? null : problems;
};

/**
 * Broadcast a verified `exact` payment and await finality. Idempotent per
 * (digest, payTo, amount). Re-verifies first (never broadcasts an unverified tx). A tx
 * that executes but FAILS on-chain returns success:false — a failed tx never reads as
 * settled. An already-executed digest returns success ONLY when its on-chain balance
 * changes satisfy the split recomputed for THESE requirements.
 */
export const doSettle = async (
  client: SuiGrpcClient,
  policy: FeePolicy,
  payload: PaymentPayload,
  requirements: PaymentRequirements,
): Promise<SettleResponse> => {
  const network = policy.caip2;
  if (!isExactPayload(payload?.payload)) {
    return settleErr(network, "", "invalid_payload", "payload.payload must be { signature, transaction }");
  }
  const { signature, transaction } = payload.payload;

  // Precompute the digest from the bytes — known before any broadcast.
  let digest: string;
  try {
    digest = await Transaction.from(fromBase64(transaction)).getDigest();
  } catch (e) {
    return settleErr(network, "", "invalid_payload", `undecodable tx bytes: ${(e as Error).message}`);
  }

  const key = settleKey(digest, requirements);
  const cached = settleCache.get(key);
  if (cached) return cached;
  const inflight = inflightSettles.get(key);
  if (inflight) return inflight;

  const run = (async (): Promise<SettleResponse> => {
    // IDEMPOTENCY across isolates/restarts: if the chain already executed this digest,
    // return its result — BOUND to these requirements (see executedMatchesRequirements)
    // — and do NOT re-broadcast (executeTransaction THROWS on a spent tx) and do NOT
    // route through doVerify (which correctly REJECTS an executed digest as a replay).
    let executedTx: unknown | null = null;
    try {
      const read = await client.getTransaction({
        digest,
        include: { effects: true, balanceChanges: true, transaction: true },
      });
      executedTx = read.$kind === "Transaction" ? read.Transaction : read.FailedTransaction;
    } catch (e) {
      if (!isNotFound(e)) {
        // Chain unreadable: we cannot know whether this digest is spent — refuse
        // (transient, uncached) rather than risk a double-broadcast error path.
        return settleErr(network, digest, TRANSIENT_REASON, `chain read failed: ${(e as Error).message}`);
      }
      // NOT_FOUND → genuinely unexecuted; fall through to verify + broadcast.
    }

    if (executedTx != null) {
      const t = executedTx as {
        effects?: { status?: { success?: boolean } };
        status?: { success?: boolean };
        transaction?: { sender?: string };
      };
      const ok = t.effects?.status?.success === true || t.status?.success === true;
      const payer = t.transaction?.sender ?? "";
      if (!ok) {
        return cacheSettle(key, settleErr(network, digest, "settle_failed", "tx already executed on-chain but FAILED", payer));
      }
      try {
        const problems = await executedMatchesRequirements(client, policy, executedTx, requirements, payer);
        if (problems) {
          // The digest is real but did NOT pay these requirements — the mis-attribution
          // guard. Terminal for this (digest, requirements) key, and safe to cache
          // BECAUSE the key carries the requirements (the honest pair is a different key).
          return cacheSettle(
            key,
            settleErr(
              network,
              digest,
              "invalid_exact_sui_payload_outputs_mismatch",
              `executed digest does not satisfy these requirements: ${problems.join("; ")}`.slice(0, 300),
              payer,
            ),
          );
        }
      } catch (e) {
        if (e instanceof TreasuryUnresolvedError) {
          return settleErr(network, digest, TRANSIENT_REASON, e.message); // uncached
        }
        return settleErr(network, digest, TRANSIENT_REASON, `binding check failed: ${(e as Error).message}`); // uncached
      }
      return cacheSettle(key, { success: true, transaction: digest, network, payer, amount: requirements.amount });
    }

    // Re-verify before broadcasting (the earlier /verify may be from a stale quote;
    // settle is the authoritative gate).
    const verified = await doVerify(client, policy, payload, requirements);
    if (!verified.isValid) {
      const reason = verified.invalidReason ?? "invalid_payload";
      const err = settleErr(network, digest, reason, verified.invalidMessage ?? "verify failed");
      // Cache ONLY terminal verdicts. A transient (facilitator_unready) must stay
      // retryable — pinning it would wedge a legitimate payment on this isolate.
      return reason === TRANSIENT_REASON ? err : cacheSettle(key, err);
    }
    const payer = verified.payer ?? "";

    let result: SettleResponse;
    try {
      await client.executeTransaction({
        transaction: fromBase64(transaction),
        signatures: [signature],
        include: { effects: true },
      });
      // Await finality on the SAME client so an immediate read is answerable.
      const final = await client.waitForTransaction({ digest, include: { effects: true } });
      const tx = final.$kind === "Transaction" ? final.Transaction : final.FailedTransaction;
      const ok = tx?.effects?.status?.success === true || tx?.status?.success === true;
      result = ok
        ? { success: true, transaction: digest, network, payer, amount: requirements.amount }
        : settleErr(
            network,
            digest,
            "settle_failed",
            `tx executed but FAILED on-chain: ${JSON.stringify(tx?.effects?.status?.error ?? tx?.status?.error ?? "unknown")}`.slice(0, 200),
            payer,
          );
    } catch (e) {
      // Idempotency fallback: the broadcast lost its ack — either a race that already
      // executed this digest between our read and the broadcast, or a gRPC deadline
      // abort while the tx was still finalizing. POLL the chain (a gasless send_funds
      // finalizes 1-3s later, deterministically from the signed bytes) rather than
      // reading once — a landed settle reported as failed is the double-charge bug.
      // Bind any executed success to THESE requirements exactly like the fast path.
      try {
        const tx = await pollExecuted(client, digest);
        const ok = (tx as { effects?: { status?: { success?: boolean } } })?.effects?.status?.success === true || (tx as { status?: { success?: boolean } })?.status?.success === true;
        if (ok && tx != null) {
          const problems = await executedMatchesRequirements(client, policy, tx, requirements, payer);
          if (problems) {
            return cacheSettle(
              key,
              settleErr(network, digest, "invalid_exact_sui_payload_outputs_mismatch", `executed digest does not satisfy these requirements: ${problems.join("; ")}`.slice(0, 300), payer),
            );
          }
          result = { success: true, transaction: digest, network, payer, amount: requirements.amount };
        } else {
          // Not readable as a success → the original broadcast error is the truth. Do
          // NOT cache — a transport error may be legitimately retried.
          return settleErr(network, digest, "settle_failed", `broadcast failed: ${(e as Error).message}`.slice(0, 200), payer);
        }
      } catch {
        return settleErr(network, digest, "settle_failed", `broadcast failed: ${(e as Error).message}`.slice(0, 200), payer);
      }
    }

    return cacheSettle(key, result); // terminal — cache it
  })();

  inflightSettles.set(key, run);
  try {
    return await run;
  } finally {
    inflightSettles.delete(key);
  }
};
