// GET /supported?payTo=… — the EFFECTIVE rate for an override merchant, so it can
// compute the exact split the facilitator will enforce (without the operator
// publishing the whole MERCHANT_RATES registry).
import { test, expect } from "bun:test";
import { policyFor, type Env } from "../src/env";
import { handleSupported } from "../src/index";

const TREASURY = "0x3333333333333333333333333333333333333333333333333333333333333333";
const VIP = "0x5555555555555555555555555555555555555555555555555555555555555555";

const env: Env = {
  SUI_NETWORK: "testnet",
  FEE_BPS: "200",
  FEE_FLOOR: "10000",
  FEE_TREASURY: TREASURY,
  MERCHANT_RATES: JSON.stringify({ [VIP]: { feeBps: 50 } }),
};

const extraOf = async (payTo?: string) => {
  const res = await handleSupported(policyFor(env), payTo ?? null);
  const body = (await res.json()) as { kinds: Array<{ extra: { feeBps: number } }> };
  return body.kinds[0].extra;
};

test("/supported advertises the default rate without payTo", async () => {
  expect((await extraOf()).feeBps).toBe(200);
});

test("/supported?payTo=<override merchant> advertises the effective override rate", async () => {
  expect((await extraOf(VIP)).feeBps).toBe(50);
});

test("/supported?payTo=<unknown merchant> advertises the default rate", async () => {
  expect((await extraOf("0x9999999999999999999999999999999999999999999999999999999999999999")).feeBps).toBe(200);
});
