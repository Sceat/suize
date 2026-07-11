// Verify semantics — the guard chain + the load-bearing property: the facilitator
// RECOMPUTES the split from the OPERATOR policy and rejects a payment that doesn't pay
// it EXACTLY (the fee-free cheat). Uses the packages/x402 fixture pattern: a real
// decodable send_funds tx + a mock transport whose simulate returns a canned result.
// No live chain, no funded keys.
import { test, expect } from "bun:test";
import { assertOutputsExact, OutputsError, type PaymentPayload, type PaymentRequirements } from "@suize/x402";
import { policyFor, type Env } from "../src/env";
import { outputsFor } from "../src/fees";
import { doVerify } from "../src/x402";

// ── fixture (captured author-time; the test never touches the network) ───────────
// A real testnet two-output send_funds tx. It is NOT gasless (the funded sender paid
// SUI gas) — used here to prove the gasless-shape gate in doVerify rejects it.
const FIXTURE_BYTES =
  "AAAEACAiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIgAgMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMCANB+AQAAAAAAAAfpUEAIWXa/1UoaByJc1GyKK06OK2cy8UCg/EmFC6c+GgVkdXNkYwVEVVNEQwAAAgDQBwAAAAAAAAAH6VBACFl2v9VKGgciXNRsiitOjitnMvFAoPxJhQunPhoFZHVzZGMFRFVTREMAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIHYmFsYW5jZQxyZWRlZW1fZnVuZHMBB+lQQAhZdr/VShoHIlzUbIorTo4rZzLxQKD8SYULpz4aBWR1c2RjBURVU0RDAAEBAgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIHYmFsYW5jZQpzZW5kX2Z1bmRzAQfpUEAIWXa/1UoaByJc1GyKK06OK2cy8UCg/EmFC6c+GgVkdXNkYwVEVVNEQwACAwAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIHYmFsYW5jZQxyZWRlZW1fZnVuZHMBB+lQQAhZdr/VShoHIlzUbIorTo4rZzLxQKD8SYULpz4aBWR1c2RjBURVU0RDAAEBAwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIHYmFsYW5jZQpzZW5kX2Z1bmRzAQfpUEAIWXa/1UoaByJc1GyKK06OK2cy8UCg/EmFC6c+GgVkdXNkYwVEVVNEQwACAwIAAAABAQAIeqhiymRcC5RADEnhG0kQEfyjXbg3NhzPxMb2nTVuhgGHk6dMXiEpHYsqnuARXluYGTePY2jZpKNnh/7sFxlX9tGJlzUAAAAAILTpgkjY77LfsuBCFd7ZWlhW+bTRW44EaAJUJB9IOsCdCHqoYspkXAuUQAxJ4RtJEBH8o124NzYcz8TG9p01boboAwAAAAAAAICEHgAAAAAAAA==";
const SENDER = "0x087aa862ca645c0b94400c49e11b491011fca35db837361ccfc4c6f69d356e86";
const ASSET = "0xe95040085976bfd54a1a07225cd46c8a2b4e8e2b6732f140a0fc49850ba73e1a::dusdc::DUSDC";
const MERCHANT = "0x2222222222222222222222222222222222222222222222222222222222222222";
const TREASURY = "0x3333333333333333333333333333333333333333333333333333333333333333";

/** A mock gRPC client returning a canned simulate result (never hits the network).
 * getTransaction throws NOT_FOUND: the replay guard reads "unexecuted" and verify
 * proceeds to simulation (the guard's fail-closed path has its own tests in
 * settle.test.ts). */
const notFound = () => Object.assign(new Error("transaction not found"), { code: "NOT_FOUND" });
const mockClient = (simResult: unknown) =>
  ({
    simulateTransaction: async () => simResult,
    getTransaction: async () => {
      throw notFound();
    },
  }) as any;

const sim = (balanceChanges: Array<{ coinType: string; address: string; amount: string }>) => ({
  $kind: "Transaction",
  Transaction: { status: { success: true, error: null }, balanceChanges, transaction: { sender: SENDER } },
});

const env: Env = { SUI_NETWORK: "testnet", FEE_BPS: "200", FEE_FLOOR: "10000", FEE_TREASURY: TREASURY };
const policy = policyFor(env);

const requirements = (over: Partial<PaymentRequirements> = {}): PaymentRequirements => ({
  scheme: "exact",
  network: "sui:testnet",
  amount: "1000000",
  asset: ASSET,
  payTo: MERCHANT,
  maxTimeoutSeconds: 60,
  extra: { outputs: [{ to: MERCHANT, amount: "1000000" }] }, // payer-declared — DELIBERATELY fee-free; must be ignored
  ...over,
});

const payload = (): PaymentPayload => ({
  x402Version: 2,
  accepted: requirements(),
  payload: { signature: "AA==", transaction: FIXTURE_BYTES },
});

// ── the guard chain ──────────────────────────────────────────────────────────────

test("doVerify rejects a non-'exact' scheme", async () => {
  const r = await doVerify(mockClient(null), policy, payload(), requirements({ scheme: "erc3009" }));
  expect(r.isValid).toBe(false);
  expect(r.invalidReason).toBe("unsupported_scheme");
});

test("doVerify rejects a network mismatch", async () => {
  const r = await doVerify(mockClient(null), policy, payload(), requirements({ network: "sui:mainnet" }));
  expect(r.isValid).toBe(false);
  expect(r.invalidReason).toBe("invalid_network");
});

test("doVerify rejects a non-gasless payment at the shape gate", async () => {
  // The fixture pays SUI gas → not gasless. doVerify must refuse to settle it.
  const r = await doVerify(mockClient(null), policy, payload(), requirements());
  expect(r.isValid).toBe(false);
  expect(r.invalidReason).toBe("invalid_exact_sui_payload_outputs_mismatch");
  expect(r.invalidMessage).toContain("not gasless");
});

// ── the recompute-and-enforce property (the fee is never waived) ──────────────────

test("outputsFor recomputes the canonical split from the OPERATOR policy", async () => {
  // 2% of $1.00 = $0.02; the merchant's declared fee-free terms are irrelevant.
  const outputs = await outputsFor(policy, mockClient(null), MERCHANT, 1_000_000n);
  expect(outputs).toEqual([
    { to: MERCHANT, amount: "980000" },
    { to: TREASURY.toLowerCase(), amount: "20000" },
  ]);
});

test("verify ENFORCES the recomputed split: a fee-free payment is rejected", async () => {
  const outputs = await outputsFor(policy, mockClient(null), MERCHANT, 1_000_000n);
  // The payer's tx credits the merchant the FULL amount and the treasury NOTHING — the
  // exact cheat the operator policy must catch. assertOutputsExact is the same enforcement
  // doVerify runs after the gasless gate.
  const cheat = sim([
    { coinType: ASSET, address: SENDER, amount: "-1000000" },
    { coinType: ASSET, address: MERCHANT, amount: "1000000" },
  ]);
  const err = await assertOutputsExact({
    client: mockClient(cheat),
    txBytesB64: FIXTURE_BYTES,
    asset: ASSET,
    outputs,
  }).catch((e) => e as OutputsError);
  expect((err as OutputsError).code).toBe("invalid_exact_sui_payload_outputs_mismatch");
});

test("verify ACCEPTS a payment that pays the recomputed split exactly", async () => {
  const outputs = await outputsFor(policy, mockClient(null), MERCHANT, 1_000_000n);
  const good = sim([
    { coinType: ASSET, address: SENDER, amount: "-1000000" },
    { coinType: ASSET, address: MERCHANT, amount: "980000" },
    { coinType: ASSET, address: TREASURY.toLowerCase(), amount: "20000" },
  ]);
  const { payer, debit } = await assertOutputsExact({
    client: mockClient(good),
    txBytesB64: FIXTURE_BYTES,
    asset: ASSET,
    outputs,
  });
  expect(payer).toBe(SENDER);
  expect(debit).toBe(1_000_000n);
});
