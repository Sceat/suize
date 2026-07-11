// GET /supported — the capability descriptor must carry the PUBLISHED fee policy in
// `extra` (what a merchant reads to compute its split). A plain-address FEE_TREASURY
// needs no network, so this runs fully offline.
import { test, expect } from "bun:test";
import { policyFor, type Env } from "../src/env";
import { handleSupported } from "../src/index";

const TREASURY = "0x0000000000000000000000000000000000000000000000000000000000000abc";

const env: Env = {
  SUI_NETWORK: "testnet",
  FEE_BPS: "200",
  FEE_FLOOR: "10000",
  FEE_TREASURY: TREASURY,
};

test("/supported returns the exact kinds + the fee extra + signers/extensions", async () => {
  const res = await handleSupported(policyFor(env));
  expect(res.status).toBe(200);
  const body = (await res.json()) as any;

  // The one kind: x402 V2, exact, the CAIP-2 network.
  expect(body.kinds).toHaveLength(1);
  const kind = body.kinds[0];
  expect(kind.x402Version).toBe(2);
  expect(kind.scheme).toBe("exact");
  expect(kind.network).toBe("sui:testnet");

  // The published fee policy merchants use to compute their splits client-side.
  expect(kind.extra).toEqual({
    assetTransferMethod: "address-balance",
    feeBps: 200,
    feeFloor: 10000,
    treasury: TREASURY,
  });

  // Wire shape (kept from the reference facilitator, minus any /build-related fields).
  expect(body.extensions).toEqual(["payment-identifier"]);
  expect(body.signers).toEqual({ "sui:*": [] });
  expect(body.ready).toBe(true);
});

test("a plain-address treasury reports ready:true with no network", async () => {
  // No SUI_GRPC_URL, no live call — a plain address is used as-is.
  const res = await handleSupported(policyFor(env));
  expect(((await res.json()) as any).ready).toBe(true);
});

test("an UNSET FEE_TREASURY fails closed: ready:false, empty treasury", async () => {
  const res = await handleSupported(policyFor({ SUI_NETWORK: "testnet" }));
  const body = (await res.json()) as any;
  expect(body.ready).toBe(false);
  expect(body.kinds[0].extra.treasury).toBe("");
});
