// The one-shot Walrus cap (owner decision 2026-07-13): a purchase may only fund
// storage as far as Walrus can store in ONE shot (WALRUS_MAX_EPOCHS_AHEAD), there
// is no drip-funding cron. This suite guards the money seams that enforce it:
//   (1) the charge doors reject over-cap months with a 400 BEFORE any 402;
//   (2) the pure extend-ceiling predicate + storage-extend planner (the inline
//       funding math) hold at the boundary;
//   (3) the cron is GONE (no runStorageCron export, no scheduled() handler).
// All offline: the 400 rejects never reach a facilitator; the one 402 case mocks
// /supported; the pure helpers need no network.
import { test, expect, afterEach } from "bun:test";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import {
  DEPLOY_MONTH_MS,
  deployEpochsForMonths,
  maxDeployMonths,
  WALRUS_EPOCHS,
  WALRUS_MAX_EPOCHS_AHEAD,
} from "@suize/shared";
import type { Env } from "../src/env";
import { handleDeploy } from "../src/publish";
import { handleExtend, extendExceedsWalrusCeiling, storageExtendPlan } from "../src/extend";

const MERCHANT = "0x" + "6a".repeat(32);
const TREASURY = "0x" + "33".repeat(32);
const SITE = "0x" + "ab".repeat(32);

// A fully-configured TESTNET charge env (chargeConfigured → true). Testnet's
// 1-day epochs make maxDeployMonths === 1, so cap+1 === 2 — the tightest bound.
const env: Env = {
  SUI_GRAPHQL_URL: "https://graphql.testnet.sui.io/graphql",
  WALRUS_AGGREGATOR: "https://aggregator.example",
  SUI_NETWORK: "testnet",
  FACILITATOR_URL: "https://fac-cap.example",
  SUIZE_MERCHANT: MERCHANT,
  WALRUS_PUBLISHER: "https://publisher.example",
  DEPLOY_WALLET_KEY: Ed25519Keypair.generate().getSecretKey(),
};

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Any network call in a 400-reject test is a bug: the reject must precede it. */
const forbidFetch = () => {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    throw new Error(`unexpected fetch in a pre-quote reject: ${String(input)}`);
  }) as unknown as typeof fetch;
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

// ── (1) charge doors reject over-cap months BEFORE any 402 ────────────────────

test("POST /deploy with months over the network cap is a 400 before any facilitator call", async () => {
  forbidFetch();
  const cap = maxDeployMonths("testnet"); // 1
  const res = await handleDeploy(
    new Request(`http://localhost/deploy?months=${cap + 1}`, { method: "POST" }),
    env,
  );
  expect(res.status).toBe(400);
  const body = (await res.json()) as { error?: string };
  expect(body.error).toContain(`[1, ${cap}]`);
});

test("POST /deploy at exactly the cap answers a 402 quote", async () => {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    if (String(input).includes("/supported")) return new Response(JSON.stringify(SUPPORTED), { status: 200 });
    throw new Error(`unexpected fetch: ${String(input)}`);
  }) as typeof fetch;
  const cap = maxDeployMonths("testnet"); // 1
  const res = await handleDeploy(
    new Request(`http://localhost/deploy?months=${cap}`, { method: "POST" }),
    env,
  );
  expect(res.status).toBe(402);
});

test("POST /extend with months over the network cap is a 400 before reading the site", async () => {
  forbidFetch();
  const cap = maxDeployMonths("testnet"); // 1
  const res = await handleExtend(
    new Request(`http://localhost/extend?site=${SITE}&months=${cap + 1}`, { method: "POST" }),
    env,
  );
  expect(res.status).toBe(400);
  const body = (await res.json()) as { error?: string };
  expect(body.error).toContain(`[1, ${cap}]`);
});

// ── (2) the pure extend-ceiling predicate (the resulting-end-epoch check) ─────

test("extendExceedsWalrusCeiling: a near-expiry site can extend by the full cap", () => {
  const now = Date.now();
  const addMs = maxDeployMonths("mainnet") * DEPLOY_MONTH_MS; // 24 months = 52 epochs
  // paid through now (about to lapse): the new end sits ~52 epochs out, inside 53.
  expect(extendExceedsWalrusCeiling("mainnet", now, addMs, now)).toBe(false);
});

test("extendExceedsWalrusCeiling: a site already funded far out cannot stack another cap", () => {
  const now = Date.now();
  const dur = WALRUS_EPOCHS.mainnet.durationMs;
  const paidUntil = now + 40 * dur; // already ~40 epochs ahead
  const addMs = maxDeployMonths("mainnet") * DEPLOY_MONTH_MS; // +52 epochs → ~92 > 53
  expect(extendExceedsWalrusCeiling("mainnet", paidUntil, addMs, now)).toBe(true);
});

test("extendExceedsWalrusCeiling: an add beyond the month cap overflows the ring", () => {
  const now = Date.now();
  // cap+1 months from a fresh site: deployEpochsForMonths(cap+1) > 53 by construction.
  const overCap = (maxDeployMonths("mainnet") + 1) * DEPLOY_MONTH_MS;
  expect(deployEpochsForMonths(maxDeployMonths("mainnet") + 1, "mainnet")).toBeGreaterThan(
    WALRUS_MAX_EPOCHS_AHEAD,
  );
  expect(extendExceedsWalrusCeiling("mainnet", now, overCap, now)).toBe(true);
});

// ── (2b) the storage-extend planner (the inline extend_blob math, stubbed) ────

const msForEpoch = (net: "mainnet" | "testnet", epoch: number): number =>
  WALRUS_EPOCHS[net].genesisMs + epoch * WALRUS_EPOCHS[net].durationMs;

test("storageExtendPlan tops each live blob up to the paid-through target", () => {
  const nowEpoch = 100;
  const paidUntil = msForEpoch("mainnet", 120); // target = min(121, now+53) = 121
  const plan = storageExtendPlan("mainnet", nowEpoch, paidUntil, 105, 121);
  expect(plan.quiltAdd).toBe(16); // 121 - 105
  expect(plan.manifestAdd).toBe(0); // already at target
});

test("storageExtendPlan clamps the target to the one-shot ceiling", () => {
  const nowEpoch = 100;
  const paidUntil = msForEpoch("mainnet", 300); // way past the ring → clamp to now+53 = 153
  const plan = storageExtendPlan("mainnet", nowEpoch, paidUntil, 110, 110);
  expect(plan.quiltAdd).toBe(43); // 153 - 110, not 300 - 110
  expect(plan.manifestAdd).toBe(43);
});

test("storageExtendPlan cannot resurrect a lapsed or unreadable blob", () => {
  const nowEpoch = 100;
  const paidUntil = msForEpoch("mainnet", 120);
  const plan = storageExtendPlan("mainnet", nowEpoch, paidUntil, 97 /* < now */, null);
  expect(plan.quiltAdd).toBe(0);
  expect(plan.manifestAdd).toBe(0);
});

// ── (3) the cron is deleted ───────────────────────────────────────────────────

test("the storage cron export is gone from extend.ts", async () => {
  const extend = (await import("../src/extend")) as Record<string, unknown>;
  expect(extend.runStorageCron).toBeUndefined();
});

test("the worker no longer exports a scheduled() handler", async () => {
  const worker = (await import("../src/index")).default as { fetch?: unknown; scheduled?: unknown };
  expect(typeof worker.fetch).toBe("function");
  expect(worker.scheduled).toBeUndefined();
});
