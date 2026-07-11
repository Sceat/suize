// Settle semantics — the load-bearing guards added at review:
//   (1) MIS-ATTRIBUTION: an already-executed digest is blessed ONLY for requirements
//       its on-chain balance changes actually satisfy (an attacker replaying a real
//       digest under fabricated {payTo, amount} is rejected);
//   (2) NO CACHE POISONING: the idempotency key carries the requirements, so a
//       mismatched settle can never pin a verdict for the honest merchant's key;
//   (3) TRANSIENTS UNCACHED: a chain-read failure returns `facilitator_unready` and a
//       retry with a healthy chain succeeds — nothing wedges.
// All offline: mock gRPC client, no funded keys. The tx fixture only needs to DECODE
// (the digest is computed from bytes); executed-first paths never simulate it.
import { test, expect } from "bun:test";
import type { PaymentPayload, PaymentRequirements } from "@suize/x402";
import { policyFor, type Env } from "../src/env";
import { doSettle, TRANSIENT_REASON } from "../src/x402";

// Reuse the decodable fixture from verify.test.ts (a real captured testnet tx).
const FIXTURE_BYTES =
  "AAAEACAiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIgAgMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMCANB+AQAAAAAAAAfpUEAIWXa/1UoaByJc1GyKK06OK2cy8UCg/EmFC6c+GgVkdXNkYwVEVVNEQwAAAgDQBwAAAAAAAAAH6VBACFl2v9VKGgciXNRsiitOjitnMvFAoPxJhQunPhoFZHVzZGMFRFVTREMAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIHYmFsYW5jZQxyZWRlZW1fZnVuZHMBB+lQQAhZdr/VShoHIlzUbIorTo4rZzLxQKD8SYULpz4aBWR1c2RjBURVU0RDAAEBAgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIHYmFsYW5jZQpzZW5kX2Z1bmRzAQfpUEAIWXa/1UoaByJc1GyKK06OK2cy8UCg/EmFC6c+GgVkdXNkYwVEVVNEQwACAwAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIHYmFsYW5jZQxyZWRlZW1fZnVuZHMBB+lQQAhZdr/VShoHIlzUbIorTo4rZzLxQKD8SYULpz4aBWR1c2RjBURVU0RDAAEBAwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIHYmFsYW5jZQpzZW5kX2Z1bmRzAQfpUEAIWXa/1UoaByJc1GyKK06OK2cy8UCg/EmFC6c+GgVkdXNkYwVEVVNEQwACAwIAAAABAQAIeqhiymRcC5RADEnhG0kQEfyjXbg3NhzPxMb2nTVuhgGHk6dMXiEpHYsqnuARXluYGTePY2jZpKNnh/7sFxlX9tGJlzUAAAAAILTpgkjY77LfsuBCFd7ZWlhW+bTRW44EaAJUJB9IOsCdCHqoYspkXAuUQAxJ4RtJEBH8o124NzYcz8TG9p01boboAwAAAAAAAICEHgAAAAAAAA==";
const SENDER = "0x087aa862ca645c0b94400c49e11b491011fca35db837361ccfc4c6f69d356e86";
const ASSET = "0xe95040085976bfd54a1a07225cd46c8a2b4e8e2b6732f140a0fc49850ba73e1a::dusdc::DUSDC";
const MERCHANT = "0x2222222222222222222222222222222222222222222222222222222222222222";
const TREASURY = "0x3333333333333333333333333333333333333333333333333333333333333333";
const ATTACKER = "0x4444444444444444444444444444444444444444444444444444444444444444";

const env: Env = { SUI_NETWORK: "testnet", FEE_BPS: "200", FEE_FLOOR: "10000", FEE_TREASURY: TREASURY };
const policy = policyFor(env);
// The binding check is pinned to the POLICY asset (never requirements.asset) — the
// mock balance changes must therefore carry the policy asset to count.
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

/** The on-chain truth: the executed tx paid [merchant 980000, treasury 20000] with the
 * payer debited 1000000 — i.e. the honest 2%/$0.01 split of a 1_000_000 payment. */
const executedTx = () => ({
  effects: { status: { success: true } },
  transaction: { sender: SENDER },
  balanceChanges: [
    { coinType: POLICY_ASSET, address: SENDER, amount: "-1000000" },
    { coinType: POLICY_ASSET, address: MERCHANT, amount: "980000" },
    { coinType: POLICY_ASSET, address: TREASURY, amount: "20000" },
  ],
});

const clientExecuted = () =>
  ({
    getTransaction: async () => ({ $kind: "Transaction", Transaction: executedTx() }),
  }) as any;

const clientChainDown = () =>
  ({
    getTransaction: async () => {
      throw new Error("UNAVAILABLE: connection refused");
    },
  }) as any;

// ── (1)+(2) mis-attribution guard + poisoning probe — ORDER MATTERS: the attacker
// settles FIRST so a poisoned digest-only cache would be caught by the honest call.
test("settle rejects an executed digest replayed under fabricated requirements", async () => {
  const r = await doSettle(clientExecuted(), policy, payload(), requirements({ payTo: ATTACKER, amount: "100000000" }));
  expect(r.success).toBe(false);
  expect(r.errorReason).toBe("invalid_exact_sui_payload_outputs_mismatch");
});

test("the honest merchant's settle of the same digest still succeeds (no cross-requirements poisoning)", async () => {
  const r = await doSettle(clientExecuted(), policy, payload(), requirements());
  expect(r.success).toBe(true);
  expect(r.payer).toBe(SENDER);
  expect(r.amount).toBe("1000000");
});

test("an executed digest under a merely-wrong amount is rejected too", async () => {
  const r = await doSettle(clientExecuted(), policy, payload(), requirements({ amount: "999999" }));
  expect(r.success).toBe(false);
  expect(r.errorReason).toBe("invalid_exact_sui_payload_outputs_mismatch");
});

// ── (3) transients are never cached — a retry after recovery succeeds.
// Distinct amount → distinct idempotency key from the tests above.
test("a chain-read failure is facilitator_unready and does not wedge the retry", async () => {
  const req = requirements({ amount: "500000" });
  const down = await doSettle(clientChainDown(), policy, payload(), req);
  expect(down.success).toBe(false);
  expect(down.errorReason).toBe(TRANSIENT_REASON);

  // Chain recovers; the executed tx paid the 500000 split (fee = floor 10000).
  const healthy = {
    getTransaction: async () => ({
      $kind: "Transaction",
      Transaction: {
        effects: { status: { success: true } },
        transaction: { sender: SENDER },
        balanceChanges: [
          { coinType: POLICY_ASSET, address: SENDER, amount: "-500000" },
          { coinType: POLICY_ASSET, address: MERCHANT, amount: "490000" },
          { coinType: POLICY_ASSET, address: TREASURY, amount: "10000" },
        ],
      },
    }),
  } as any;
  const retry = await doSettle(healthy, policy, payload(), req);
  expect(retry.success).toBe(true);
  expect(retry.amount).toBe("500000");
});

// ── an executed-but-FAILED tx never reads as settled.
test("an on-chain-failed executed digest settles as failure (cached terminal)", async () => {
  const req = requirements({ amount: "777777" });
  const failed = {
    getTransaction: async () => ({
      $kind: "FailedTransaction",
      FailedTransaction: { effects: { status: { success: false } }, transaction: { sender: SENDER } },
    }),
  } as any;
  const r = await doSettle(failed, policy, req && payload(), req);
  expect(r.success).toBe(false);
  expect(r.errorReason).toBe("settle_failed");
});
