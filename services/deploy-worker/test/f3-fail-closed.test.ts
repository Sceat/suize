// FIX 3b (money-safety, integration) — when the pre-store replay guard
// (siteIdByDigest) hits an indeterminate RPC read and FAILS CLOSED (throws), the
// deploy route must STOP after settle: it must NOT proceed to a permanent Walrus
// store. This drives the REAL handleDeploy with the facilitator + publisher
// fetch-mocked (store PUTs counted) and `../src/chain` module-mocked so the
// pre-store siteIdByDigest throws a retryable ChainError. Expectation: the payment
// was settled, the route returns 5xx (retryable), and ZERO store PUTs ran.
import { test, expect, afterEach, mock } from "bun:test";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { deployPriceUsdc } from "@suize/shared";
import { fetchPolicy, quoteRequirements } from "../src/payment";
import type { Env } from "../src/env";

const MERCHANT = "0x" + "6a".repeat(32);
const TREASURY = "0x" + "33".repeat(32);
const PAYER = "0x" + "aa".repeat(32);
const DIGEST = "SETTLED_DIGEST_F3B";
const DEPLOY_URL = "http://localhost/deploy?months=1";

import * as chainNS from "../src/chain";
const realChain = { ...chainNS };
mock.module("../src/chain", () => ({
  ...realChain,
  // The pre-store recovery read fails CLOSED (indeterminate RPC fault → throw).
  siteIdByDigest: async () => {
    throw new realChain.ChainError("digest registry unreadable: rpc down", 503);
  },
  // Must never be reached — a failed-closed guard precedes the mint.
  createSiteOnChain: async () => {
    throw new Error("createSiteOnChain must not be reached when the guard fails closed");
  },
  readSite: async () => null,
}));

const env: Env = {
  SUI_GRAPHQL_URL: "https://graphql.example/graphql",
  WALRUS_AGGREGATOR: "https://aggregator.example",
  SUI_NETWORK: "testnet",
  FACILITATOR_URL: "https://fac-f3b.example", // unique ⇒ dodges the policy cache
  SUIZE_MERCHANT: MERCHANT,
  WALRUS_PUBLISHER: "https://publisher.example",
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

const stubNetwork = () => {
  const n = { settles: 0, quiltPuts: 0, blobPuts: 0 };
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/supported")) return new Response(JSON.stringify(SUPPORTED), { status: 200 });
    if (url.includes("/verify")) return new Response(JSON.stringify({ isValid: true, payer: PAYER }), { status: 200 });
    if (url.includes("/settle")) {
      n.settles++;
      return new Response(JSON.stringify({ success: true, transaction: DIGEST, network: "sui:testnet" }), { status: 200 });
    }
    if (url.includes("/v1/quilts")) {
      n.quiltPuts++;
      return new Response(JSON.stringify({ blobStoreResult: {}, storedQuiltBlobs: [] }), { status: 200 });
    }
    if (url.includes("/v1/blobs")) {
      n.blobPuts++;
      return new Response(JSON.stringify({ newlyCreated: {} }), { status: 200 });
    }
    return new Response("", { status: 200 });
  }) as unknown as typeof fetch;
  return n;
};

test("a fail-CLOSED pre-store guard settles but does NOT store to Walrus", async () => {
  const { handleDeploy } = await import("../src/publish");
  const { createTar } = await import("nanotar");
  const counts = stubNetwork();

  const policy = await fetchPolicy(env);
  const amount = BigInt(deployPriceUsdc(1, false));
  const { requirements } = quoteRequirements(env, policy, amount, DEPLOY_URL);
  const payHeader = btoa(
    JSON.stringify({ x402Version: 2, accepted: requirements, payload: { signature: "AA==", transaction: "AAAA" } }),
  );

  const tarBytes = createTar([{ name: "index.html", data: "<h1>hi</h1>" }]);
  const form = new FormData();
  form.append("name", "mysite");
  form.append("site.tar", new File([tarBytes], "site.tar", { type: "application/x-tar" }));
  const req = new Request(DEPLOY_URL, { method: "POST", headers: { "X-PAYMENT": payHeader }, body: form });

  const res = await handleDeploy(req, env);

  expect(counts.settles).toBe(1); // the payment DID settle (idempotent by digest — a retry re-settles)
  expect(res.status).toBeGreaterThanOrEqual(500); // retryable, not a false success
  // The load-bearing assertion: NO permanent Walrus store ran behind the settle.
  expect(counts.quiltPuts).toBe(0);
  expect(counts.blobPuts).toBe(0);
});
