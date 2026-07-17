// chargeConfigured gates the paid publish routes: unconfigured must 503, never
// mint a 402 that pays a dead address. "0x0" is the mainnet-placeholder value in
// @suize/shared before the deploy_sui republish — a premature mainnet deploy must
// treat it as unconfigured, not as a real payTo (the fee leg would burn to 0x0).
import { test, expect } from "bun:test";
import { chargeConfigured, type Env } from "../src/env";

const BASE: Env = {
  SUI_GRAPHQL_URL: "https://graphql.testnet.sui.io/graphql",
  WALRUS_AGGREGATOR: "https://aggregator.example",
  FACILITATOR_URL: "https://fac.example",
  SUIZE_MERCHANT: "0x" + "6a".repeat(32),
  WALRUS_PUBLISHER: "https://publisher.example",
  DEPLOY_WALLET_KEY: "suiprivkey1notarealkey",
};

test("fully configured is true", () => {
  expect(chargeConfigured(BASE)).toBe(true);
});

test("SUIZE_MERCHANT === '0x0' is NOT configured (mainnet-placeholder guard)", () => {
  expect(chargeConfigured({ ...BASE, SUIZE_MERCHANT: "0x0" })).toBe(false);
});

test("empty SUIZE_MERCHANT is not configured", () => {
  expect(chargeConfigured({ ...BASE, SUIZE_MERCHANT: "" })).toBe(false);
});

test("missing DEPLOY_WALLET_KEY is not configured", () => {
  expect(chargeConfigured({ ...BASE, DEPLOY_WALLET_KEY: undefined })).toBe(false);
});
