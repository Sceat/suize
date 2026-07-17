// FIX 2 (HIGH money-safety) — /extend must PREFLIGHT that BOTH of a site's Walrus
// blobs (quilt + manifest) are still LIVE before it quotes/settles a payment.
// `extend_blob` can only ADD epochs to a live blob; it cannot resurrect one that
// has lapsed past recovery or is unreadable. Without the preflight the payment
// settles and paid_until moves on-chain while storage can never be funded → money
// taken, site still dead. The preflight rejects with a 400 BEFORE any facilitator
// contact; a site with live blobs is NOT rejected (it quotes a normal 402).
//
// Offline: `../src/chain` is module-mocked (snapshot spread) so readSite returns a
// canned site and suiClient.getObject returns each blob's storage.end_epoch (or a
// throw / null for the unreadable case). No payment is ever reached in the reject
// cases; a fetch stub FORBIDS the facilitator to prove the reject precedes it.
import { test, expect, afterEach, mock } from "bun:test";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { WALRUS_EPOCHS } from "@suize/shared";
import type { Env } from "../src/env";

const SITE_ID = "0x" + "5e".repeat(32);
const QUILT_OBJ = "0x" + "01".repeat(32);
const MANI_OBJ = "0x" + "02".repeat(32);
const PAYER = "0x" + "aa".repeat(32);
const FAC = "https://fac-extend-lapse.example";

// Testnet epoch clock — compute a "live" and a "lapsed" end epoch relative to now.
const e = WALRUS_EPOCHS.testnet;
const NOW_EPOCH = Math.floor((Date.now() - e.genesisMs) / e.durationMs);
const LIVE = NOW_EPOCH + 100;
const LAPSED = NOW_EPOCH - 5;

// The blob end epochs each test sets before driving handleExtend. `null` ⇒ the
// getObject read returns no object (unreadable); a thrown error also ⇒ unreadable.
let quiltEnd: number | null = LIVE;
let manifestEnd: number | null = LIVE;
let quiltThrows = false;

const blobObj = (end: number | null) =>
  end === null ? { object: null } : { object: { json: { storage: { end_epoch: end } } } };

import * as chainNS from "../src/chain";
const realChain = { ...chainNS };
mock.module("../src/chain", () => ({
  ...realChain,
  readSite: async () => ({
    owner: PAYER,
    sealed: false,
    paidUntilMs: Date.now(), // near now ⇒ a 1-month extend stays within the ceiling
    quiltBlobObject: QUILT_OBJ,
    manifestBlobObject: MANI_OBJ,
    sizeBytes: 10,
  }),
  suiClient: () => ({
    getObject: async ({ objectId }: { objectId: string }) => {
      if (objectId === QUILT_OBJ) {
        if (quiltThrows) throw new Error("rpc down");
        return blobObj(quiltEnd);
      }
      return blobObj(manifestEnd);
    },
  }),
}));

const env: Env = {
  SUI_GRAPHQL_URL: "https://graphql.example/graphql",
  WALRUS_AGGREGATOR: "https://aggregator.example",
  SUI_NETWORK: "testnet",
  FACILITATOR_URL: FAC,
  SUIZE_MERCHANT: "0x" + "6a".repeat(32),
  WALRUS_PUBLISHER: "https://publisher.example",
  DEPLOY_WALLET_KEY: Ed25519Keypair.generate().getSecretKey(),
};

const SUPPORTED = {
  kinds: [
    {
      x402Version: 2,
      scheme: "exact",
      network: "sui:testnet",
      extra: { assetTransferMethod: "address-balance", feeBps: 200, feeFloor: 10000, treasury: "0x" + "33".repeat(32) },
    },
  ],
  extensions: ["payment-identifier"],
  ready: true,
};

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  quiltEnd = LIVE;
  manifestEnd = LIVE;
  quiltThrows = false;
});

/** fetch stub that FAILS the test if the facilitator is contacted at all. */
const forbidFacilitator = () => {
  let touched = false;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith(FAC)) {
      touched = true;
      throw new Error(`facilitator must NOT be contacted before the storage preflight: ${url}`);
    }
    return new Response("", { status: 200 });
  }) as unknown as typeof fetch;
  return () => touched;
};

const extendReq = () =>
  new Request(`http://localhost/extend`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ site: SITE_ID, months: 1 }),
  });

test("extend on a LAPSED blob → 400 before any facilitator/settle call", async () => {
  quiltEnd = LAPSED; // one blob expired past recovery
  manifestEnd = LIVE;
  const touched = forbidFacilitator();
  const { handleExtend } = await import("../src/extend");

  const res = await handleExtend(extendReq(), env);
  expect(res.status).toBe(400);
  expect(((await res.json()) as { error?: string }).error).toContain("lapsed past recovery");
  expect(touched()).toBe(false);
});

test("extend on an UNREADABLE blob → 400 before any facilitator/settle call", async () => {
  quiltThrows = true; // the blob object read throws (indeterminate/gone) → treat as unrecoverable
  const touched = forbidFacilitator();
  const { handleExtend } = await import("../src/extend");

  const res = await handleExtend(extendReq(), env);
  expect(res.status).toBe(400);
  expect(((await res.json()) as { error?: string }).error).toContain("lapsed past recovery");
  expect(touched()).toBe(false);
});

test("extend on LIVE blobs → NOT rejected (quotes a 402)", async () => {
  quiltEnd = LIVE;
  manifestEnd = LIVE;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/supported")) return new Response(JSON.stringify(SUPPORTED), { status: 200 });
    return new Response("", { status: 200 });
  }) as unknown as typeof fetch;
  const { handleExtend } = await import("../src/extend");

  const res = await handleExtend(extendReq(), env); // no X-PAYMENT ⇒ the 402 quote
  expect(res.status).toBe(402);
});
