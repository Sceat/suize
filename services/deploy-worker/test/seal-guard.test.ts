// FIX 1 (money-safety) — the seal guard rejects a sealed (private) deploy with a
// 400 BEFORE any facilitator contact / settle when the target network has NO
// configured Seal key servers (an empty SEAL_KEY_SERVERS list). Otherwise the
// payment settles and sealEncrypt fails (no key servers) → the payer paid for a
// site that can never be produced. Both live networks now carry a verified Open-
// mode committee (testnet 2 servers, mainnet 3), so sealed quotes the normal 2x
// price on each; the guard stays as fail-closed defense for any future/empty
// network. These tests prove sealed is NOT gated where a committee exists.
//
// Offline: no chain writes are reached; a fetch stub serves the /supported policy
// for the paths that legitimately quote a 402.
import { test, expect, afterEach } from "bun:test";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { SEAL_KEY_SERVERS } from "@suize/shared";
import type { Env } from "../src/env";

const MERCHANT_MAIN = "0x" + "99".repeat(32);
const MERCHANT_TEST = "0x" + "6a".repeat(32);
const TREASURY = "0x" + "33".repeat(32);

// Sanity-guard the test's premise: both networks now carry a Seal committee.
test("premise: both networks carry a Seal key-server committee", () => {
  expect(SEAL_KEY_SERVERS.mainnet.length).toBeGreaterThan(0);
  expect(SEAL_KEY_SERVERS.testnet.length).toBeGreaterThan(0);
});

const baseEnv = (net: "testnet" | "mainnet", merchant: string, facUrl: string): Env => ({
  SUI_GRAPHQL_URL: "https://graphql.example/graphql",
  WALRUS_AGGREGATOR: "https://aggregator.example",
  SUI_NETWORK: net,
  FACILITATOR_URL: facUrl,
  SUIZE_MERCHANT: merchant,
  WALRUS_PUBLISHER: "https://publisher.example",
  DEPLOY_WALLET_KEY: Ed25519Keypair.generate().getSecretKey(),
});

const supported = (net: string) => ({
  kinds: [
    {
      x402Version: 2,
      scheme: "exact",
      network: `sui:${net}`,
      extra: { assetTransferMethod: "address-balance", feeBps: 200, feeFloor: 10000, treasury: TREASURY },
    },
  ],
  extensions: ["payment-identifier"],
  ready: true,
});

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

test("mainnet sealed DISCOVERY → NOT blocked, quotes a 402 (committee is wired)", async () => {
  const FAC = "https://fac-seal-a.example";
  const env = baseEnv("mainnet", MERCHANT_MAIN, FAC);
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/supported")) return new Response(JSON.stringify(supported("mainnet")), { status: 200 });
    return new Response("", { status: 200 });
  }) as unknown as typeof fetch;
  const { handleDeploy } = await import("../src/publish");

  // No X-PAYMENT ⇒ the discovery/quote shot; sealed via query.
  const req = new Request("http://localhost/deploy?sealed=1", { method: "POST" });
  const res = await handleDeploy(req, env);
  expect(res.status).toBe(402); // seal available on mainnet → normal 2x quote, not a 400
});

test("testnet sealed DISCOVERY → NOT blocked (quotes a 402)", async () => {
  const FAC = "https://fac-seal-c.example";
  const env = baseEnv("testnet", MERCHANT_TEST, FAC);
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/supported")) return new Response(JSON.stringify(supported("testnet")), { status: 200 });
    return new Response("", { status: 200 });
  }) as unknown as typeof fetch;
  const { handleDeploy } = await import("../src/publish");

  const req = new Request("http://localhost/deploy?sealed=1", { method: "POST" });
  const res = await handleDeploy(req, env);
  expect(res.status).toBe(402); // seal available on testnet → normal price quote, not a 400
});

test("mainnet NON-sealed DISCOVERY → NOT blocked (public sites quote normally)", async () => {
  const FAC = "https://fac-seal-d.example";
  const env = baseEnv("mainnet", MERCHANT_MAIN, FAC);
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/supported")) return new Response(JSON.stringify(supported("mainnet")), { status: 200 });
    return new Response("", { status: 200 });
  }) as unknown as typeof fetch;
  const { handleDeploy } = await import("../src/publish");

  const req = new Request("http://localhost/deploy?months=1", { method: "POST" });
  const res = await handleDeploy(req, env);
  expect(res.status).toBe(402); // public site on mainnet is fine
});
