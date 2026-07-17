// The money math — every number here is a billing contract (owner-locked
// 2026-07-10; one-shot cap 2026-07-13): $0.10/month flat, sealed 2×, the prepay
// ceiling DERIVED per network from the Walrus one-shot window, and the
// $0.05/month Walrus storage-cost cap. A drift in any of these mis-prices charges.
import { test, expect } from "bun:test";
import {
  DEPLOY_MAX_MONTHS,
  DEPLOY_MONTH_MS,
  deployEpochsForMonths,
  deployPriceUsdc,
  DOMAIN_PRICE_PER_YEAR_USDC,
  maxDeployMonths,
  MAX_SITE_WALRUS_USD_PER_MONTH,
  WALRUS_MAX_EPOCHS_AHEAD,
  walrusMonthlyCostUsd,
  withinUploadCap,
} from "@suize/shared";

test("one month costs exactly $0.10 (100_000 atomic)", () => {
  expect(deployPriceUsdc(1, false)).toBe(100_000);
});

test("sealed doubles the rate", () => {
  expect(deployPriceUsdc(1, true)).toBe(200_000);
  expect(deployPriceUsdc(7, true)).toBe(1_400_000);
});

test("the max prepay (the mainnet one-shot cap, 24 months) is $2.40 public / $4.80 sealed", () => {
  expect(DEPLOY_MAX_MONTHS).toBe(24);
  expect(deployPriceUsdc(DEPLOY_MAX_MONTHS, false)).toBe(2_400_000);
  expect(deployPriceUsdc(DEPLOY_MAX_MONTHS, true)).toBe(4_800_000);
});

test("out-of-range months throw (never a mis-priced quote)", () => {
  expect(() => deployPriceUsdc(0, false)).toThrow(RangeError);
  expect(() => deployPriceUsdc(DEPLOY_MAX_MONTHS + 1, false)).toThrow(RangeError);
  expect(() => deployPriceUsdc(1.5, false)).toThrow(RangeError);
  expect(() => deployPriceUsdc(-3, false)).toThrow(RangeError);
  expect(() => deployPriceUsdc(Number.NaN, false)).toThrow(RangeError);
});

test("the Walrus one-shot ceiling is the 53-epoch protocol ring", () => {
  expect(WALRUS_MAX_EPOCHS_AHEAD).toBe(53);
});

test("maxDeployMonths is DERIVED per network from the one-shot ceiling", () => {
  // mainnet 14-day epochs: 24 months = 52 epochs fits; 25 = 54 does not.
  expect(maxDeployMonths("mainnet")).toBe(24);
  // testnet 1-day epochs: 1 month = 30 epochs fits; 2 = 60 does not.
  expect(maxDeployMonths("testnet")).toBe(1);
  // the absolute ceiling constant IS the largest network's cap (mainnet).
  expect(DEPLOY_MAX_MONTHS).toBe(maxDeployMonths("mainnet"));
});

test("the cap is exactly the boundary: cap fits the ceiling, cap+1 overflows it", () => {
  for (const net of ["mainnet", "testnet"] as const) {
    const cap = maxDeployMonths(net);
    expect(deployEpochsForMonths(cap, net)).toBeLessThanOrEqual(WALRUS_MAX_EPOCHS_AHEAD);
    expect(deployEpochsForMonths(cap + 1, net)).toBeGreaterThan(WALRUS_MAX_EPOCHS_AHEAD);
  }
});

test("a custom domain year is $19.99", () => {
  expect(DOMAIN_PRICE_PER_YEAR_USDC).toBe(19_990_000);
});

test("a month is 30 days flat", () => {
  expect(DEPLOY_MONTH_MS).toBe(30 * 24 * 60 * 60 * 1000);
});

test("epochs are ceil'd — the buyer never gets less storage than paid time", () => {
  // testnet: 1-day epochs → 30/month exactly
  expect(deployEpochsForMonths(1, "testnet")).toBe(30);
  expect(deployEpochsForMonths(12, "testnet")).toBe(360);
  // mainnet: 14-day epochs → 30d needs 3 (42d — rounds UP in the buyer's favor)
  expect(deployEpochsForMonths(1, "mainnet")).toBe(3);
  expect(deployEpochsForMonths(12, "mainnet")).toBe(Math.ceil(360 / 14));
});

test("the upload cap sits just under 420 MiB raw", () => {
  const mib = 1024 ** 2;
  expect(withinUploadCap(419 * mib)).toBe(true);
  expect(withinUploadCap(421 * mib)).toBe(false);
  // a typical site is far under the cap and nearly free to store
  expect(walrusMonthlyCostUsd(5 * mib)).toBeLessThan(0.004);
  // the boundary formula: cost(cap-passing size) <= $0.05
  expect(walrusMonthlyCostUsd(419 * mib)).toBeLessThanOrEqual(MAX_SITE_WALRUS_USD_PER_MONTH);
});
