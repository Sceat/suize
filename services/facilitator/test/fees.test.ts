// The PURE fee-split math + the same-address MERGE — the testable kernel of
// outputsFor. No network, no client. Ported from the Suize backend fees test and
// extended for the now operator-configurable FEE_BPS + FEE_FLOOR.
import { test, expect } from "bun:test";
import { splitOutputs } from "../src/fees";

const MERCHANT = "0x" + "a".repeat(64);
const TREASURY = "0x" + "b".repeat(64);
const BPS = 200n; // 2%
const FLOOR = 10_000n; // $0.01

test("normal split: 2 legs [merchant net, treasury fee]; pct above the floor", () => {
  // $1.00 → fee = 2% = $0.02 (20_000) > floor; net = $0.98 (980_000).
  const out = splitOutputs(MERCHANT, TREASURY, 1_000_000n, BPS, FLOOR);
  expect(out).toEqual([
    { to: MERCHANT, amount: "980000" },
    { to: TREASURY, amount: "20000" },
  ]);
});

test("floor wins when 2% is below $0.01: fee == the $0.01 floor", () => {
  // $0.10 → 2% = $0.002 (2_000) < floor; fee clamps UP to $0.01 (10_000).
  const out = splitOutputs(MERCHANT, TREASURY, 100_000n, BPS, FLOOR);
  expect(out).toEqual([
    { to: MERCHANT, amount: "90000" }, // 100_000 − 10_000
    { to: TREASURY, amount: "10000" },
  ]);
});

test("MERGE: merchant === treasury collapses to ONE full-amount output", () => {
  // The exact-match guard forbids a duplicate address — so the two legs become one.
  const out = splitOutputs(MERCHANT, MERCHANT, 1_000_000n, BPS, FLOOR);
  expect(out).toEqual([{ to: MERCHANT, amount: "1000000" }]);
});

test("MERGE is case-insensitive on the address comparison", () => {
  const out = splitOutputs(MERCHANT.toUpperCase().replace("0X", "0x"), MERCHANT, 1_000_000n, BPS, FLOOR);
  expect(out).toHaveLength(1);
  expect(out[0].amount).toBe("1000000");
});

test("the split always reconciles: net + fee == gross", () => {
  for (const amount of [20_000n, 100_000n, 333_333n, 1_000_000n, 999_999_999n]) {
    const out = splitOutputs(MERCHANT, TREASURY, amount, BPS, FLOOR);
    const total = out.reduce((s, o) => s + BigInt(o.amount), 0n);
    expect(total).toBe(amount); // every base unit is accounted for, no dust lost
  }
});

test("zero-fee override (feeBps 0): the floor still applies (fee == the floor)", () => {
  // A 0-bps override is still subject to the floor — the floor is the policy minimum,
  // not the percentage. There is no free tier.
  const out = splitOutputs(MERCHANT, TREASURY, 1_000_000n, 0n, FLOOR);
  expect(out[1].amount).toBe("10000"); // the floor
  expect(out[0].amount).toBe("990000");
});

// ── operator-configurable policy (the generalization over the fixed Suize rate) ──

test("operator FEE_BPS is honored: 3% → fee = 30_000", () => {
  const out = splitOutputs(MERCHANT, TREASURY, 1_000_000n, 300n, FLOOR);
  expect(out).toEqual([
    { to: MERCHANT, amount: "970000" },
    { to: TREASURY, amount: "30000" },
  ]);
});

test("operator FEE_FLOOR is honored: a $0.05 floor clamps a below-floor percentage", () => {
  // $1.00 at 1% = $0.01 (10_000), below a $0.05 (50_000) floor → fee clamps up.
  const out = splitOutputs(MERCHANT, TREASURY, 1_000_000n, 100n, 50_000n);
  expect(out).toEqual([
    { to: MERCHANT, amount: "950000" },
    { to: TREASURY, amount: "50000" },
  ]);
});

test("sub-unit amount collapses to a single output (no zero/negative fee leg)", () => {
  // 1 atomic unit ($0.000001): the floor can't be carved without a zero net — the only
  // physically-unavoidable single-output case (NOT a free tier).
  const out = splitOutputs(MERCHANT, TREASURY, 1n, BPS, FLOOR);
  expect(out).toEqual([{ to: MERCHANT, amount: "1" }]);
});
