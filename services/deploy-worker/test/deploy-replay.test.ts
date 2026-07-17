// F3 (pre-mainnet blocker) — a REPLAYED / retried settled payment must never
// re-store to Walrus. The fix settles first (idempotent by digest) and, if the
// digest already minted a Site, returns that site BEFORE any WAL spend. This
// suite drives the REAL handleDeploy twice with the same X-PAYMENT and proves the
// publisher store path (a real storeQuilt/storeBlob PUT) runs EXACTLY ONCE, the
// second request recovering the same siteId with no second burn.
//
// Offline: the facilitator + Walrus publisher are fetch-mocked (store PUTs are
// counted); the chain writes are module-mocked (../src/chain) with a snapshot
// spread so EVERY real export stays present — only the three functions this test
// steers (siteIdByDigest / createSiteOnChain / readSite) are overridden.
//
// (The already_executed structural-recovery variant needs a real signed tx to
// recover the payer — covered by scripts/e2e-live.ts; here /verify returns valid
// both times, which exercises the SAME post-settle digest→site gate and also the
// common honest-retry trigger, a deploy whose 200 was lost.)
import { test, expect, afterEach, mock } from "bun:test";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { deployPriceUsdc } from "@suize/shared";
import { fetchPolicy, quoteRequirements } from "../src/payment";
import type { Env } from "../src/env";

const MERCHANT = "0x" + "6a".repeat(32);
const TREASURY = "0x" + "33".repeat(32);
const PAYER = "0x" + "aa".repeat(32);
const SITE_ID = "0x" + "5e".repeat(32);
const DIGEST = "SETTLED_DIGEST_123";
const DEPLOY_URL = "http://localhost/deploy?months=1";

// Stateful chain stub: createSiteOnChain records digest→site, siteIdByDigest
// reads it back — so the FIRST request mints (map empty → store runs) and the
// SECOND recovers (map hit → no store). Snapshot-spread keeps ChainError,
// EDIGEST_USED_STATUS, wallet, serviceAddress, … real for every other importer.
const digestToSite = new Map<string, string>();
import * as chainNS from "../src/chain";
const realChain = { ...chainNS };
mock.module("../src/chain", () => ({
  ...realChain,
  siteIdByDigest: async (_env: Env, digest: string) => digestToSite.get(digest) ?? null,
  createSiteOnChain: async (_env: Env, a: { paymentDigest: string }) => {
    digestToSite.set(a.paymentDigest, SITE_ID);
    return { siteId: SITE_ID, digest: a.paymentDigest };
  },
  readSite: async () => ({
    owner: PAYER,
    sealed: false,
    paidUntilMs: Date.now() + 30 * 24 * 3600 * 1000,
    quiltBlobObject: "0x1",
    manifestBlobObject: "0x2",
    sizeBytes: 11,
  }),
}));

const env: Env = {
  SUI_GRAPHQL_URL: "https://graphql.example/graphql",
  WALRUS_AGGREGATOR: "https://aggregator.example",
  SUI_NETWORK: "testnet",
  // Unique per-suite FACILITATOR_URL dodges payment.ts's per-(url|merchant) policy cache.
  FACILITATOR_URL: "https://fac-replay.example",
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

// A canned publisher blob object (`newlyCreated` is REQUIRED — dedup would 502).
const NEWLY = { blobObject: { id: "0x" + "ab".repeat(32), blobId: "blobABC", storage: { endEpoch: 99 } } };

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Facilitator + publisher fetch stub. Counts the two WAL-spending store PUTs and
 * echoes a quilt patch id for every uploaded identifier (read off the FormData). */
const stubNetwork = () => {
  const n = { quiltPuts: 0, blobPuts: 0 };
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/supported")) return new Response(JSON.stringify(SUPPORTED), { status: 200 });
    if (url.includes("/verify")) return new Response(JSON.stringify({ isValid: true, payer: PAYER }), { status: 200 });
    if (url.includes("/settle"))
      return new Response(JSON.stringify({ success: true, transaction: DIGEST, network: "sui:testnet" }), { status: 200 });
    if (url.includes("/v1/quilts")) {
      n.quiltPuts++;
      const form = init?.body as FormData | undefined;
      const ids = form && typeof (form as FormData).keys === "function" ? [...(form as FormData).keys()] : [];
      return new Response(
        JSON.stringify({
          blobStoreResult: { newlyCreated: NEWLY },
          storedQuiltBlobs: ids.map((id) => ({ identifier: id, quiltPatchId: `patch-${id}` })),
        }),
        { status: 200 },
      );
    }
    if (url.includes("/v1/blobs")) {
      n.blobPuts++;
      return new Response(JSON.stringify({ newlyCreated: NEWLY }), { status: 200 });
    }
    // The post-deploy warm fetch to the site URL (non-sealed) — benign.
    return new Response("", { status: 200 });
  }) as unknown as typeof fetch;
  return n;
};

test("a replayed settled payment recovers the same site and stores to Walrus ONLY once", async () => {
  const { handleDeploy } = await import("../src/publish");
  const { createTar } = await import("nanotar");
  const counts = stubNetwork();

  // Build one honest X-PAYMENT echoing our own quote (termsMatch passes).
  const policy = await fetchPolicy(env);
  const amount = BigInt(deployPriceUsdc(1, false));
  const { requirements } = quoteRequirements(env, policy, amount, DEPLOY_URL);
  const payHeader = btoa(
    JSON.stringify({ x402Version: 2, accepted: requirements, payload: { signature: "AA==", transaction: "AAAA" } }),
  );

  const tarBytes = createTar([{ name: "index.html", data: "<h1>hi</h1>" }]);
  const makeReq = () => {
    const form = new FormData();
    form.append("name", "mysite");
    form.append("site.tar", new File([tarBytes], "site.tar", { type: "application/x-tar" }));
    return new Request(DEPLOY_URL, { method: "POST", headers: { "X-PAYMENT": payHeader }, body: form });
  };

  // ── first deploy: fresh payment → mints + stores exactly one site ──────────
  const r1 = await handleDeploy(makeReq(), env);
  expect(r1.status).toBe(200);
  const b1 = (await r1.json()) as { siteId: string; recovered?: boolean };
  expect(b1.siteId).toBe(SITE_ID);
  expect(b1.recovered).toBeUndefined(); // a genuine mint, not a recovery
  expect(counts.quiltPuts).toBe(1);
  expect(counts.blobPuts).toBe(1);

  // ── replay the SAME X-PAYMENT: recovers, spends NO more WAL ────────────────
  const r2 = await handleDeploy(makeReq(), env);
  expect(r2.status).toBe(200);
  const b2 = (await r2.json()) as { siteId: string; recovered?: boolean };
  expect(b2.siteId).toBe(SITE_ID); // same site
  expect(b2.recovered).toBe(true); // the idempotent recovery shape
  // The load-bearing assertion: the Walrus store path did NOT run a second time.
  expect(counts.quiltPuts).toBe(1);
  expect(counts.blobPuts).toBe(1);
});
