// Unit test for the facilitator's PURE fee-split math + the same-address MERGE.
// No network, no client — splitOutputs is the testable kernel of outputsFor.
// The MERGE case is the review-flagged invariant: duplicate addresses in the
// declared outputs break assertOutputsExact's exact-match by construction, so a
// merchant that IS the treasury must collapse to ONE full-amount output.
import { test, expect } from "bun:test";
import { splitOutputs } from "../src/facilitator/fees";

const MERCHANT = "0x" + "a".repeat(64);
const TREASURY = "0x" + "b".repeat(64);
const BPS = 200n; // 2%

test("normal split: 2 legs [merchant net, treasury fee]; pct above the floor", () => {
  // $1.00 → fee = 2% = $0.02 (20_000) > floor; net = $0.98 (980_000).
  const out = splitOutputs(MERCHANT, TREASURY, 1_000_000n, BPS);
  expect(out).toEqual([
    { to: MERCHANT, amount: "980000" },
    { to: TREASURY, amount: "20000" },
  ]);
});

test("floor wins when 2% is below $0.01: fee == the $0.01 floor", () => {
  // $0.10 → 2% = $0.002 (2_000) < floor; fee clamps UP to $0.01 (10_000).
  const out = splitOutputs(MERCHANT, TREASURY, 100_000n, BPS);
  expect(out).toEqual([
    { to: MERCHANT, amount: "90000" }, // 100_000 − 10_000
    { to: TREASURY, amount: "10000" },
  ]);
});

test("MERGE: merchant === treasury collapses to ONE full-amount output", () => {
  // The exact-match guard forbids a duplicate address — so the two legs become one.
  const out = splitOutputs(MERCHANT, MERCHANT, 1_000_000n, BPS);
  expect(out).toEqual([{ to: MERCHANT, amount: "1000000" }]);
});

test("MERGE is case-insensitive on the address comparison", () => {
  const out = splitOutputs(MERCHANT.toUpperCase().replace("0X", "0x"), MERCHANT, 1_000_000n, BPS);
  expect(out).toHaveLength(1);
  expect(out[0].amount).toBe("1000000");
});

test("the split always reconciles: net + fee == gross", () => {
  for (const amount of [20_000n, 100_000n, 333_333n, 1_000_000n, 999_999_999n]) {
    const out = splitOutputs(MERCHANT, TREASURY, amount, BPS);
    const total = out.reduce((s, o) => s + BigInt(o.amount), 0n);
    expect(total).toBe(amount); // every base unit is accounted for, no dust lost
  }
});

test("zero-fee merchant (feeBps 0): floor still applies (fee == $0.01)", () => {
  // A 0-bps override is still subject to the $0.01 floor — the floor is the policy
  // minimum, not the percentage.
  const out = splitOutputs(MERCHANT, TREASURY, 1_000_000n, 0n);
  expect(out[1].amount).toBe("10000"); // the floor
  expect(out[0].amount).toBe("990000");
});
