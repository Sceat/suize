// The broadcast-ack-lost recovery poll (the reproduced double-charge fix). When the
// settle broadcast throws (a gRPC deadline abort) but the gasless tx actually LANDED,
// the old single immediate read saw NOT_FOUND (the tx finalizes 1-3s later) and
// reported `settle_failed` — the client then paid a SECOND time. doSettle now POLLS a
// few reads over the finality window and returns success once the tx is seen.
//
// Reaching the broadcast path needs doVerify to PASS, which needs a GASLESS payment;
// the suite's captured fixture is deliberately NON-gasless and can't be built offline
// (the SDK's gasless election needs a live node). So we mock.module @suize/x402's
// pure crypto/shape/simulate helpers (snapshot-spread — every other export stays
// real), exactly the pattern f3-fail-closed / deploy-replay use for ../src/chain.
// The gRPC client itself is a plain mock; setSettlePoll shrinks the waits to 0.
import { test, expect, beforeAll, afterAll, mock } from "bun:test";
import * as realX402 from "@suize/x402";
import type { PaymentPayload, PaymentRequirements } from "@suize/x402";
import { policyFor, type Env } from "../src/env";

const SENDER = "0x" + "ab".repeat(32);
const MERCHANT = "0x" + "22".repeat(32);
const TREASURY = "0x" + "33".repeat(32);
const ASSET = "0xe95040085976bfd54a1a07225cd46c8a2b4e8e2b6732f140a0fc49850ba73e1a::dusdc::DUSDC";

// The suite's decodable fixture (a real captured tx) — only needs to DECODE + digest;
// its bytes are otherwise irrelevant here (shape/sim/recover are mocked below).
const FIXTURE_BYTES =
  "AAAEACAiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIgAgMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMCANB+AQAAAAAAAAfpUEAIWXa/1UoaByJc1GyKK06OK2cy8UCg/EmFC6c+GgVkdXNkYwVEVVNEQwAAAgDQBwAAAAAAAAAH6VBACFl2v9VKGgciXNRsiitOjitnMvFAoPxJhQunPhoFZHVzZGMFRFVTREMAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIHYmFsYW5jZQxyZWRlZW1fZnVuZHMBB+lQQAhZdr/VShoHIlzUbIorTo4rZzLxQKD8SYULpz4aBWR1c2RjBURVU0RDAAEBAgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIHYmFsYW5jZQpzZW5kX2Z1bmRzAQfpUEAIWXa/1UoaByJc1GyKK06OK2cy8UCg/EmFC6c+GgVkdXNkYwVEVVNEQwACAwAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIHYmFsYW5jZQxyZWRlZW1fZnVuZHMBB+lQQAhZdr/VShoHIlzUbIorTo4rZzLxQKD8SYULpz4aBWR1c2RjBURVU0RDAAEBAwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIHYmFsYW5jZQpzZW5kX2Z1bmRzAQfpUEAIWXa/1UoaByJc1GyKK06OK2cy8UCg/EmFC6c+GgVkdXNkYwVEVVNEQwACAwIAAAABAQAIeqhiymRcC5RADEnhG0kQEfyjXbg3NhzPxMb2nTVuhgGHk6dMXiEpHYsqnuARXluYGTePY2jZpKNnh/7sFxlX9tGJlzUAAAAAILTpgkjY77LfsuBCFd7ZWlhW+bTRW44EaAJUJB9IOsCdCHqoYspkXAuUQAxJ4RtJEBH8o124NzYcz8TG9p01boboAwAAAAAAAICEHgAAAAAAAA==";

const env: Env = { SUI_NETWORK: "testnet", FEE_BPS: "200", FEE_FLOOR: "10000", FEE_TREASURY: TREASURY };
const policy = policyFor(env);
const POLICY_ASSET = policy.asset;

const requirements = (over: Partial<PaymentRequirements> = {}): PaymentRequirements => ({
  scheme: "exact",
  network: "sui:testnet",
  amount: "1000000",
  asset: ASSET,
  payTo: MERCHANT,
  maxTimeoutSeconds: 60,
  extra: { outputs: [] },
  ...over,
});

const payload = (): PaymentPayload => ({
  x402Version: 2,
  accepted: requirements(),
  payload: { signature: "AA==", transaction: FIXTURE_BYTES },
});

const notFound = () => Object.assign(new Error("transaction not found"), { code: "NOT_FOUND" });

// doVerify now reads the live epoch + chain for the expiration gate (issue #1). The
// captured fixture carries a None expiration on a funded (client-paid) tx, so it passes
// the gate regardless — these reads only need to answer for the re-verify to proceed.
const core = {
  getCurrentSystemState: async () => ({ systemState: { epoch: "100" } }),
  getChainIdentifier: async () => ({ chainIdentifier: "x" }),
};

/** An executed-SUCCESS tx paying the honest split of `amount` (fee = 2%, floor $0.01). */
const executedTx = (amount: bigint, fee: bigint) => ({
  effects: { status: { success: true } },
  transaction: { sender: SENDER },
  balanceChanges: [
    { coinType: POLICY_ASSET, address: SENDER, amount: String(-amount) },
    { coinType: POLICY_ASSET, address: MERCHANT, amount: String(amount - fee) },
    { coinType: POLICY_ASSET, address: TREASURY, amount: String(fee) },
  ],
});

// doVerify's pure helpers are mocked so the NON-gasless fixture verifies; every other
// @suize/x402 export (outputProblems / normalizeBalanceChanges / OutputsError / types)
// stays REAL via the snapshot spread, so the settle binding checks run for real.
let doSettle: typeof import("../src/x402").doSettle;

// A non-literal specifier + cache-bust query → a FRESH x402.ts eval that binds the
// mocked @suize/x402 (and its own isolated settle cache); the `?query` must be a
// template interpolation so tsc doesn't try to resolve it (cli-signer.test pattern).
const X402_SRC = "../src/x402.ts";

beforeAll(async () => {
  mock.module("@suize/x402", () => ({
    ...realX402,
    assertGaslessTxShape: () => {},
    recoverPayer: async () => SENDER,
    assertOutputsExact: async () => ({ payer: SENDER, debit: 1_000_000n }),
  }));
  const mod = (await import(`${X402_SRC}?pollfix=1`)) as typeof import("../src/x402");
  doSettle = mod.doSettle;
  mod.setSettlePoll([0, 0, 0, 0]); // no real sleeping in the suite
});

afterAll(() => {
  mock.restore(); // un-register the module mock so verify.test sees the REAL gasless gate
});

// ── the fix: a broadcast that lost its ack but LANDED settles as success ──────────
test("broadcast timeout → first read NOT_FOUND → a later poll read sees the executed tx → success", async () => {
  let reads = 0;
  const client = {
    // 1 pre-read, 2 verify.alreadyExecuted, 3 poll read #1 → NOT_FOUND; 4th → executed.
    getTransaction: async () => {
      reads++;
      if (reads <= 3) throw notFound();
      return { $kind: "Transaction", Transaction: executedTx(1_000_000n, 20_000n) };
    },
    executeTransaction: async () => ({}),
    // The broadcast's finality wait aborts (the reproduced gRPC deadline).
    waitForTransaction: async () => {
      throw new Error("The operation was aborted due to timeout");
    },
    core,
  } as any;

  const r = await doSettle(client, policy, payload(), requirements());
  expect(r.success).toBe(true);
  expect(r.payer).toBe(SENDER);
  expect(r.amount).toBe("1000000");
  expect(reads).toBeGreaterThanOrEqual(4); // it polled past the first NOT_FOUND
});

// ── still unseen after the window → today's settle_failed, UNCACHED (retry recovers)
test("still NOT_FOUND after the poll window → settle_failed, and NOT cached (a later retry recovers)", async () => {
  const AMOUNT = "500000"; // distinct key from the test above
  const req = requirements({ amount: AMOUNT });

  const neverFound = {
    getTransaction: async () => {
      throw notFound();
    },
    executeTransaction: async () => ({}),
    waitForTransaction: async () => {
      throw new Error("The operation was aborted due to timeout");
    },
    core,
  } as any;

  const failed = await doSettle(neverFound, policy, payload(), req);
  expect(failed.success).toBe(false);
  expect(failed.errorReason).toBe("settle_failed");
  expect(failed.errorMessage).toContain("broadcast failed");

  // UNCACHED: the tx finalizes; a retry finds it on the pre-read fast path and
  // succeeds. A cached failure would have wedged this legitimate payment.
  const healthy = {
    getTransaction: async () => ({ $kind: "Transaction", Transaction: executedTx(500_000n, 10_000n) }),
  } as any;
  const recovered = await doSettle(healthy, policy, payload(), req);
  expect(recovered.success).toBe(true);
  expect(recovered.amount).toBe("500000");
});
