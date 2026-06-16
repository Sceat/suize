// x402 V2 'exact' facilitator E2E — REAL TESTNET, KEYLESS settle. The whole new
// rail end-to-end: GET /supported → GET /terms → POST /build (unsigned gasless
// bytes) → LOCAL payer signature → POST /verify (isValid + payer) → POST /settle
// (broadcast over gRPC, USDC deltas EXACT) → replay returns the SAME cached
// response. Plus the cheat (single-output vs a declared fee split) is rejected,
// malformed bodies 400, and the per-IP limiter 429s. NO Enoki, NO account.move.
//
// RUN:    SUIZE_E2E=1 bun test ./test/e2e/facilitator.x402.e2e.ts
//         (skips cleanly without SUIZE_E2E=1 — see test/e2e/setup.ts.)
// NEEDS:  the payer (env key or the Sui CLI active address) holding testnet
//         Circle USDC (≥ $0.20). The payment is GASLESS — the payer's SUI is
//         untouched (asserted) — and the backend signs NOTHING (keyless settle).
// BACKEND: boots a FACILITATOR-ONLY harness (test/e2e/_facilitator-harness.ts) on
//         an ephemeral port (cwd=services/backend so its .env loads) with a SEEDED
//         SUIZE_MERCHANTS env so a fee-tier merchant exists in-process; tears it
//         down after. The harness mounts ONLY the facilitator route — the full
//         src/index.ts can't currently boot (the Phase-C deploy module imports a
//         removed @suize/pay export; UNRELATED to the facilitator). It is
//         behaviorally identical to how src/index.ts mounts handleFacilitatorRoute.
//         SUIZE_E2E_VERBOSE=1 inherits the harness stdio.
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { randomBytes } from "node:crypto";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { fromBase64 } from "@mysten/sui/utils";
import type { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import { USDC_TYPE, resolveTreasury, caip2 } from "@suize/shared";
import type { Output, PaymentRequirements, PaymentPayload } from "@suize/x402";
import { E2E_ENABLED, e2eClient, loadPayerKeypair, coinBalance, faucetHelp } from "./setup";

// ── the payment under test ──────────────────────────────────────────────────
const NETWORK = caip2("testnet");
const SUI_TYPE = "0x2::sui::SUI";
let TREASURY = ""; // resolved from treasury@suize in beforeAll (the live fee recipient)
const FEE_BPS = 200n;
const FEE_FLOOR = 10_000n;

// Free-tier: a single full-amount output (no merchant in the registry).
const FREE_AMOUNT = 100_000n; // $0.10
const FREE_AMOUNT_DECIMAL = "0.10";

// Fee-tier: 2% of $0.10 = $0.002 (above the $0.01 floor? no — 2000 < 10000, so the
// FLOOR wins → fee = $0.01). Use $1.00 so the percentage exceeds the floor.
const FEE_AMOUNT = 1_000_000n; // $1.00
const FEE_AMOUNT_DECIMAL = "1.00";
const FEE_PCT = (FEE_AMOUNT * FEE_BPS) / 10_000n; // 20_000 ($0.02) — exceeds the floor
const FEE = FEE_PCT > FEE_FLOOR ? FEE_PCT : FEE_FLOOR;
const NET = FEE_AMOUNT - FEE;

const BACKEND_DIR = new URL("../..", import.meta.url).pathname;

// ── suite state ──────────────────────────────────────────────────────────────
let client: SuiJsonRpcClient;
let payer: Ed25519Keypair;
let payerAddress = "";
let freeMerchant = ""; // fresh, unregistered (default-fee) merchant — for a single-output payment
let feeMerchant = ""; // fresh — seeded into SUIZE_MERCHANTS as a 2% merchant
let backend: ReturnType<typeof Bun.spawn> | null = null;
let base = "";

const freshAddress = (): string =>
  Ed25519Keypair.fromSecretKey(new Uint8Array(randomBytes(32))).toSuiAddress();

const post = async (path: string, body: unknown): Promise<{ status: number; body: Record<string, unknown> }> => {
  const r = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: (await r.json().catch(() => ({}))) as Record<string, unknown> };
};

const get = async (path: string): Promise<{ status: number; body: Record<string, unknown> }> => {
  const r = await fetch(`${base}${path}`);
  return { status: r.status, body: (await r.json().catch(() => ({}))) as Record<string, unknown> };
};

/** Build a PaymentRequirements for `outputs` paying `payTo` a gross of `amount`. */
const requirements = (payTo: string, amount: string, outputs: Output[]): PaymentRequirements => ({
  scheme: "exact",
  network: NETWORK,
  amount,
  asset: USDC_TYPE,
  payTo,
  maxTimeoutSeconds: 120,
  extra: { outputs },
});

/** /build → local sign → assemble the PaymentPayload. */
const buildAndSign = async (
  payTo: string,
  amountDecimal: string,
  outputs: Output[],
): Promise<{ payload: PaymentPayload; requirements: PaymentRequirements; bytes: string }> => {
  const built = await post("/build", { sender: payerAddress, outputs });
  if (built.status !== 200) throw new Error(`/build ${built.status}: ${JSON.stringify(built.body)}`);
  const bytes = built.body.bytes as string;
  const signed = await payer.signTransaction(fromBase64(bytes));
  const reqs = requirements(payTo, amountDecimal, outputs);
  const payload: PaymentPayload = {
    x402Version: 2,
    accepted: reqs,
    payload: { signature: signed.signature, transaction: bytes },
  };
  return { payload, requirements: reqs, bytes };
};

describe.skipIf(!E2E_ENABLED)("facilitator x402 V2 'exact' (build → verify → settle, real testnet)", () => {
  beforeAll(async () => {
    if (!E2E_ENABLED) return;

    client = e2eClient();
    TREASURY = (await resolveTreasury(client)) ?? "";
    payer = loadPayerKeypair();
    payerAddress = payer.toSuiAddress();
    freeMerchant = freshAddress();
    feeMerchant = freshAddress();

    // FUNDING GATE — fail fast with the manual faucet step, never a fake green.
    const usdc = await coinBalance(client, payerAddress, USDC_TYPE);
    if (usdc < FREE_AMOUNT + FEE_AMOUNT) throw new Error(faucetHelp(payerAddress));

    // Boot the real backend with a SEEDED fee-tier merchant. The backend reads
    // SUIZE_MERCHANTS at module load, so it MUST be present in the spawn env.
    const port = 18_000 + Math.floor(Math.random() * 10_000);
    const io = process.env.SUIZE_E2E_VERBOSE === "1" ? "inherit" : "ignore";
    backend = Bun.spawn(["bun", "run", "test/e2e/_facilitator-harness.ts"], {
      cwd: BACKEND_DIR,
      env: {
        ...process.env,
        PORT: String(port),
        SUIZE_MERCHANTS: JSON.stringify({ [feeMerchant]: { feeBps: 200 } }),
      },
      stdout: io,
      stderr: io,
    });
    base = `http://localhost:${port}`;
    const deadline = Date.now() + 20_000;
    for (;;) {
      try {
        if ((await fetch(`${base}/health`)).ok) break;
      } catch {
        /* not up yet */
      }
      if (Date.now() > deadline) throw new Error("backend did not become healthy in 20s");
      await Bun.sleep(250);
    }
  }, 60_000);

  afterAll(() => {
    backend?.kill();
  });

  test("GET /supported advertises the x402 V2 'exact' Sui scheme", async () => {
    const r = await get("/supported");
    expect(r.status).toBe(200);
    const kinds = r.body.kinds as Array<Record<string, unknown>>;
    expect(Array.isArray(kinds)).toBe(true);
    expect(kinds[0]).toMatchObject({ x402Version: 2, scheme: "exact", network: NETWORK });
    expect(r.body.extensions).toEqual(["payment-identifier"]);
    expect(r.body.signers).toMatchObject({ "sui:*": [] });
  });

  test("GET /terms: unregistered merchant → DEFAULT 2% split (NO free tier)", async () => {
    // Owner law 2026-06-14: the fee is never waived. An unregistered merchant pays the
    // default 2% — /terms returns the [merchant net, treasury fee] split, not null.
    const r = await get(`/terms?payTo=${freeMerchant}&amount=${FREE_AMOUNT_DECIMAL}`);
    expect(r.status).toBe(200);
    expect(r.body.feeBps).toBe(200);
    const outputs = r.body.outputs as Output[];
    expect(outputs).toHaveLength(2);
    expect(outputs[0].to.toLowerCase()).toBe(freeMerchant.toLowerCase());
    expect(outputs[1].to.toLowerCase()).toBe(TREASURY.toLowerCase());
  });

  test("GET /terms: fee-tier merchant → a 2-leg split [merchant net, treasury fee]", async () => {
    const r = await get(`/terms?payTo=${feeMerchant}&amount=${FEE_AMOUNT_DECIMAL}`);
    expect(r.status).toBe(200);
    expect(r.body.feeBps).toBe(200);
    const outputs = r.body.outputs as Output[];
    expect(outputs).toHaveLength(2);
    expect(outputs[0]).toEqual({ to: feeMerchant, amount: NET.toString() });
    expect(outputs[1].to.toLowerCase()).toBe(TREASURY.toLowerCase());
    expect(outputs[1].amount).toBe(FEE.toString());
  });

  test("SINGLE-OUTPUT to an unregistered merchant is REJECTED — Suize is not a free facilitator", async () => {
    // NO FREE TIER (owner law). /verify RECOMPUTES the canonical split from policy
    // (outputsFor) and IGNORES the merchant's declared outputs, so a payment that pays
    // the merchant the whole amount — with no treasury fee leg — fails verify and never
    // settles. (The deploy charge's single output is the ONLY legit one, and only because
    // its payTo IS the treasury so the two legs merge — see deploy.402.e2e.)
    const outputs: Output[] = [{ to: freeMerchant, amount: FREE_AMOUNT.toString() }];
    expect(await coinBalance(client, freeMerchant, USDC_TYPE)).toBe(0n);

    const { payload, requirements: reqs } = await buildAndSign(freeMerchant, FREE_AMOUNT_DECIMAL, outputs);

    // VERIFY must REJECT it — the missing treasury leg is caught (the recomputed split
    // expects [merchant net, treasury fee], the tx pays only the merchant).
    const verify = await post("/verify", { paymentPayload: payload, paymentRequirements: reqs });
    expect(verify.status).toBe(200);
    expect(verify.body.isValid).toBe(false);

    // It never reaches chain — the merchant got nothing (the fee was not skipped).
    expect(await coinBalance(client, freeMerchant, USDC_TYPE)).toBe(0n);
  }, 120_000);

  test("FEE-TIER happy path: the canonical 2-leg split → verify → settle; merchant +net, treasury +fee, gasless + replay-safe", async () => {
    // Strict verify RECOMPUTES the split, so the payment MUST pay the REAL resolved
    // treasury (treasury@suize) — a fresh/arbitrary treasury is now rejected. For a clean
    // 2-leg, treasury@suize MUST resolve to a DISTINCT address (≠ the payer): a dev-fallback
    // treasury == payer makes the fee leg a self-credit that nets out of the balance-change
    // set (verify would then reject). Point treasury@suize at a real testnet address to run.
    expect(TREASURY).not.toBe("");
    expect(TREASURY.toLowerCase()).not.toBe(payerAddress.toLowerCase());

    const outputs: Output[] = [
      { to: feeMerchant, amount: NET.toString() },
      { to: TREASURY, amount: FEE.toString() },
    ];
    expect(await coinBalance(client, feeMerchant, USDC_TYPE)).toBe(0n);
    const treasuryBefore = await coinBalance(client, TREASURY, USDC_TYPE);
    const payerSuiBefore = await coinBalance(client, payerAddress, SUI_TYPE);

    const { payload, requirements: reqs } = await buildAndSign(feeMerchant, FEE_AMOUNT_DECIMAL, outputs);

    // VERIFY — the recomputed canonical split matches the payment; recovers the payer.
    const verify = await post("/verify", { paymentPayload: payload, paymentRequirements: reqs });
    expect(verify.body.isValid).toBe(true);
    expect((verify.body.payer as string).toLowerCase()).toBe(payerAddress.toLowerCase());

    // SETTLE — KEYLESS gRPC broadcast.
    const settle = await post("/settle", { paymentPayload: payload, paymentRequirements: reqs });
    expect(settle.body.success).toBe(true);
    const digest = settle.body.transaction as string;
    expect(digest.length).toBeGreaterThan(0);

    // BOTH legs land: merchant +net (fresh → absolute), treasury +fee (DELTA — it may hold a
    // prior balance); payer SUI UNTOUCHED (gasless).
    let merchantAfter = 0n;
    let treasuryAfter = treasuryBefore;
    const deadline = Date.now() + 12_000;
    for (;;) {
      merchantAfter = await coinBalance(client, feeMerchant, USDC_TYPE);
      treasuryAfter = await coinBalance(client, TREASURY, USDC_TYPE);
      if ((merchantAfter === NET && treasuryAfter - treasuryBefore === FEE) || Date.now() > deadline) break;
      await Bun.sleep(500);
    }
    expect(merchantAfter).toBe(NET);
    expect(treasuryAfter - treasuryBefore).toBe(FEE);
    expect(NET + FEE).toBe(FEE_AMOUNT); // every base unit accounted for
    expect(await coinBalance(client, payerAddress, SUI_TYPE)).toBe(payerSuiBefore); // gasless proof

    // REPLAY (settle) → idempotent, SAME digest (chain-read-first — never a double charge).
    const replay = await post("/settle", { paymentPayload: payload, paymentRequirements: reqs });
    expect(replay.body.success).toBe(true);
    expect(replay.body.transaction).toBe(digest);

    // REPLAY (verify) → /verify REJECTS the already-executed payment itself (the digest
    // chain-read is the only sound replay guard for a gasless tx — re-simulation succeeds).
    const verifyReplay = await post("/verify", { paymentPayload: payload, paymentRequirements: reqs });
    expect(verifyReplay.body.isValid).toBe(false);
    expect(verifyReplay.body.invalidReason).toBe("invalid_exact_sui_payload_already_executed");
  }, 120_000);

  test("CHEAT: a single-output payment against DECLARED split terms → rejected outputs_mismatch", async () => {
    // The payer builds + signs a SINGLE full-amount output to the merchant, but the
    // requirements DECLARE the 2-leg fee split. assertOutputsExact must reject it
    // (the treasury leg is missing + the merchant is over-credited).
    const cheatOutputs: Output[] = [{ to: feeMerchant, amount: FEE_AMOUNT.toString() }];
    const built = await post("/build", { sender: payerAddress, outputs: cheatOutputs });
    expect(built.status).toBe(200);
    const bytes = built.body.bytes as string;
    const signed = await payer.signTransaction(fromBase64(bytes));

    const declaredSplit: PaymentRequirements = requirements(feeMerchant, FEE_AMOUNT_DECIMAL, [
      { to: feeMerchant, amount: NET.toString() },
      { to: TREASURY, amount: FEE.toString() },
    ]);
    const cheatPayload: PaymentPayload = {
      x402Version: 2,
      accepted: declaredSplit,
      payload: { signature: signed.signature, transaction: bytes },
    };

    const verify = await post("/verify", { paymentPayload: cheatPayload, paymentRequirements: declaredSplit });
    expect(verify.status).toBe(200);
    expect(verify.body.isValid).toBe(false);
    expect(verify.body.invalidReason).toBe("invalid_exact_sui_payload_outputs_mismatch");

    // And /settle refuses to broadcast it (success:false, never executed).
    const settle = await post("/settle", { paymentPayload: cheatPayload, paymentRequirements: declaredSplit });
    expect(settle.body.success).toBe(false);
  }, 60_000);

  test("malformed /verify body → 400", async () => {
    const r = await post("/verify", { nope: true });
    expect(r.status).toBe(400);
  });

  test("malformed /settle body → 400", async () => {
    const r = await post("/settle", {});
    expect(r.status).toBe(400);
  });

  test("/terms junk payTo → 400; junk amount → 400", async () => {
    expect((await get(`/terms?payTo=0xnope&amount=${FREE_AMOUNT_DECIMAL}`)).status).toBe(400);
    expect((await get(`/terms?payTo=${freeMerchant}&amount=1.2345678`)).status).toBe(400);
  });

  test("/build hammered past the per-IP WRITE limit → 429", async () => {
    // Valid-shape /build requests (random senders hold no USDC, so the build itself
    // fails — but validation passes and each costs a WRITE token). The bucket
    // (capacity 6, refill 0.5/s) must reject the overflow with 429.
    const results = await Promise.all(
      Array.from({ length: 12 }, () =>
        post("/build", { sender: freshAddress(), outputs: [{ to: freshAddress(), amount: "10000" }] }),
      ),
    );
    const statuses = results.map((r) => r.status);
    expect(statuses.filter((s) => s === 429).length).toBeGreaterThan(0);
    // Every outcome is a non-success: 429 (rate limited) or 402 (built but the
    // random sender holds no USDC → the payer-side build/simulate fails). A no-funds
    // build is a 402 with a readable reason, NEVER a 5xx — a 5xx would be stripped of
    // its body + CORS by the CDN and read to the payer as a network blip.
    expect(statuses.every((s) => s === 429 || s === 402)).toBe(true);
  }, 30_000);
});
