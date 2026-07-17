// The merchant-side payment gate — the seams that guard real money:
//   (1) the presented terms must EQUAL our quote (price/payTo/outputs/op-binding
//       tampering is rejected BEFORE any facilitator call);
//   (2) facilitator outages are 503 (same header retries; a settled payer never
//       re-pays through a blip) — only a DEFINITIVE invalid mints a challenge;
//   (3) settle's `facilitator_unready` is transient (503); anything else is
//       terminal (402 + challenge).
// All offline: global fetch is mocked per test.
import { test, expect, afterEach } from "bun:test";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import type { PaymentRequirements } from "@suize/pay";
import type { Env } from "../src/env";
import { fetchPolicy, gatePayment, settlePayment, quoteRequirements } from "../src/payment";

const MERCHANT = "0x" + "6a".repeat(32);
const TREASURY = "0x" + "33".repeat(32);
const PAYER = "0x" + "aa".repeat(32);

const env: Env = {
  SUI_GRAPHQL_URL: "https://graphql.testnet.sui.io/graphql",
  WALRUS_AGGREGATOR: "https://aggregator.example",
  SUI_NETWORK: "testnet",
  FACILITATOR_URL: "https://fac.example",
  SUIZE_MERCHANT: MERCHANT,
  WALRUS_PUBLISHER: "https://publisher.example",
  // Ephemeral — never a committed key (this suite mocks the facilitator and
  // never signs, but a committed suiprivkey is the anti-pattern the project bans).
  DEPLOY_WALLET_KEY: Ed25519Keypair.generate().getSecretKey(),
};

const SUPPORTED = {
  kinds: [
    {
      x402Version: 2,
      scheme: "exact",
      network: "sui:testnet",
      extra: { assetTransferMethod: "address-balance", feeBps: 200, feeFloor: 10000, treasury: TREASURY },
    },
  ],
  extensions: ["payment-identifier"],
  ready: true,
};

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Route-shaped fetch mock: /supported always answers; verify/settle per test. */
const mockFacilitator = (routes: {
  verify?: unknown | (() => never);
  settle?: unknown;
  supportedOverride?: unknown;
}) => {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/supported")) {
      return new Response(JSON.stringify(routes.supportedOverride ?? SUPPORTED), { status: 200 });
    }
    if (url.includes("/verify")) {
      if (typeof routes.verify === "function") throw new Error("connection refused");
      return new Response(JSON.stringify(routes.verify), { status: 200 });
    }
    if (url.includes("/settle")) {
      return new Response(JSON.stringify(routes.settle), { status: 200 });
    }
    throw new Error(`unexpected fetch: ${url}`);
  }) as typeof fetch;
};

const b64 = (o: unknown): string => btoa(JSON.stringify(o));

/** A payload echoing OUR terms exactly (the honest agent), or a tampered copy. */
const payloadFor = (requirements: PaymentRequirements, tamper?: Partial<PaymentRequirements>): string =>
  b64({
    x402Version: 2,
    accepted: { ...requirements, ...tamper },
    payload: { signature: "AA==", transaction: "AAAA" },
  });

const quote = async (amount: bigint, extraSuize?: Record<string, unknown>) => {
  const policy = await fetchPolicy(env);
  const { requirements } = quoteRequirements(env, policy, amount, "https://deploy.example/deploy");
  return extraSuize ? { ...requirements, extra: { ...requirements.extra, suize: extraSuize } } : requirements;
};

test("the honest payload passes and returns the facilitator-recovered payer", async () => {
  mockFacilitator({ verify: { isValid: true, payer: PAYER } });
  const req = await quote(600_000n);
  const v = await gatePayment(env, payloadFor(req), req);
  expect(v.payer).toBe(PAYER);
  expect(v.requirements).toEqual(req);
});

test("a tampered amount is rejected before any facilitator call", async () => {
  mockFacilitator({ verify: () => {
    throw new Error("must not be called");
  } });
  const req = await quote(600_000n);
  await expect(gatePayment(env, payloadFor(req, { amount: "100000" }), req)).rejects.toMatchObject({
    status: 402,
    challenge: true,
  });
});

test("a tampered payTo is rejected", async () => {
  mockFacilitator({ verify: { isValid: true, payer: PAYER } });
  const req = await quote(600_000n);
  await expect(
    gatePayment(env, payloadFor(req, { payTo: "0x" + "99".repeat(32) }), req),
  ).rejects.toMatchObject({ status: 402, challenge: true });
});

test("tampered outputs (a re-split of the fee) are rejected", async () => {
  mockFacilitator({ verify: { isValid: true, payer: PAYER } });
  const req = await quote(600_000n);
  const evil = {
    ...req,
    extra: { ...req.extra, outputs: [{ to: PAYER, amount: "600000" }] },
  };
  await expect(gatePayment(env, b64({ x402Version: 2, accepted: evil, payload: { signature: "AA==", transaction: "AAAA" } }), req)).rejects.toMatchObject({
    status: 402,
    challenge: true,
  });
});

test("the op-binding (extra.suize) is compared — a link payment can't move to another domain", async () => {
  mockFacilitator({ verify: { isValid: true, payer: PAYER } });
  const reqA = await quote(19_990_000n, { op: "link-domain", domain: "a.example", siteId: "0x1" });
  const reqB = await quote(19_990_000n, { op: "link-domain", domain: "b.example", siteId: "0x1" });
  // The payer's payload echoes quote A; presenting it against quote B must fail.
  await expect(gatePayment(env, payloadFor(reqA), reqB)).rejects.toMatchObject({
    status: 402,
    challenge: true,
  });
  // …and against its own quote it passes.
  const ok = await gatePayment(env, payloadFor(reqA), reqA);
  expect(ok.payer).toBe(PAYER);
});

test("a definitive verify-invalid mints a challenge (402)", async () => {
  mockFacilitator({
    verify: { isValid: false, invalidReason: "invalid_exact_sui_payload_outputs_mismatch" },
  });
  const req = await quote(600_000n);
  await expect(gatePayment(env, payloadFor(req), req)).rejects.toMatchObject({
    status: 402,
    challenge: true,
  });
});

test("an ALREADY-EXECUTED payment is not a rejection — it recovers as alreadySettled", async () => {
  // The money-safety contract: a settled payment being retried (a death after
  // settle, before the on-chain effect / response) must NOT be told to pay
  // again. gatePayment recovers the payer from the signature and flags it so
  // the route re-drives its idempotent on-chain effect. (Payer recovery is
  // structural — this needs a REAL signed tx, which the offline fixture lacks —
  // so here we assert the branch taken: no 402, and the failure mode when the
  // sig can't be recovered stays a challenge, never a silent success.)
  mockFacilitator({
    verify: { isValid: false, invalidReason: "invalid_exact_sui_payload_already_executed" },
  });
  const req = await quote(600_000n);
  // The fixture's payload has an unrecoverable dummy sig — the branch must land
  // in the explicit "could not recover the payer" challenge, proving the
  // already_executed path was ENTERED (not the generic verify-invalid path).
  await expect(gatePayment(env, payloadFor(req), req)).rejects.toMatchObject({
    message: "could not recover the payer of a settled payment",
    status: 402,
  });
  // The LIVE proof of the happy recovery path is scripts/e2e-live.ts steps 5+6
  // (replayed extend idempotent · replayed deploy recovers the same site).
});

test("a facilitator OUTAGE at verify is 503, never a fresh challenge", async () => {
  mockFacilitator({ verify: () => {
    throw new Error("down");
  } });
  const req = await quote(600_000n);
  await expect(gatePayment(env, payloadFor(req), req)).rejects.toMatchObject({
    status: 503,
    challenge: false,
  });
});

test("settle success returns the digest; facilitator_unready is a retriable 503", async () => {
  mockFacilitator({
    verify: { isValid: true, payer: PAYER },
    settle: { success: true, transaction: "DIGEST123", network: "sui:testnet" },
  });
  const req = await quote(600_000n);
  const v = await gatePayment(env, payloadFor(req), req);
  expect(await settlePayment(env, v)).toBe("DIGEST123");

  mockFacilitator({
    verify: { isValid: true, payer: PAYER },
    settle: { success: false, errorReason: "facilitator_unready" },
  });
  await expect(settlePayment(env, v)).rejects.toMatchObject({ status: 503, challenge: false });

  mockFacilitator({
    verify: { isValid: true, payer: PAYER },
    settle: { success: false, errorReason: "settle_failed" },
  });
  await expect(settlePayment(env, v)).rejects.toMatchObject({ status: 402, challenge: true });
});

test("an unready facilitator (unresolved treasury) blocks quoting fail-closed", async () => {
  mockFacilitator({ supportedOverride: { ...SUPPORTED, ready: false, kinds: [{ ...SUPPORTED.kinds[0], extra: { ...SUPPORTED.kinds[0].extra, treasury: "" } }] } });
  // fetchPolicy caches per (url|merchant); use a distinct facilitator to dodge it.
  const env2 = { ...env, FACILITATOR_URL: "https://fac2.example" };
  await expect(fetchPolicy(env2)).rejects.toMatchObject({ status: 503 });
});
