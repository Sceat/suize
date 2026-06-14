// TIER-3 MIDDLEWARE E2E — the FLAGSHIP 402 loop, end-to-end on REAL TESTNET, against
// @suize/pay v2 (vanilla x402 V2 'exact'). A localhost MERCHANT protects a premium
// endpoint with NOTHING but the `suize({…}).wrap` middleware, and a generic AGENT
// settles the x402 V2 PaymentRequired through the real facilitator: 402 → /build the
// gasless send_funds → LOCAL sign → assemble the b64 PaymentPayload → retry with
// X-PAYMENT → 200. The agent uses ONLY what the challenge hands it (accepts[0] +
// extra.outputs/buildUrl) — the zero-shot contract, exercised literally.
//
// The merchant is a FREE-TIER merchant (NOT in SUIZE_MERCHANTS), so the declared
// requirement is a single full-amount output — the clean middleware contract. (The
// fee-tier 2-leg split is proven separately by facilitator.x402.e2e.ts; running it
// here would hit the treasury == dev-payer merge, un-assertable as a 2-leg split.)
//
// RUN:    SUIZE_E2E=1 bun test ./test/e2e/tier3.middleware.e2e.ts
//         (skips cleanly without SUIZE_E2E=1; the explicit ./path form is required.)
// NEEDS:  the payer (env key or the Sui CLI active address) holding testnet Circle
//         USDC (≥ $0.10). The payment is GASLESS — the payer's SUI is untouched.
// BACKEND: boots the FACILITATOR-ONLY harness (same as facilitator.x402); tears down.
//
// THE LOOP + NEGATIVES (mirrors @suize/pay's 33-test contract at the E2E level):
//   1. GET (no payment) → 402: PAYMENT-REQUIRED header + x402 V2 body, accepts[0]
//      asserted (scheme/network/asset/payTo/amount/extra.outputs/buildUrl).
//   2. The agent builds the gasless payment from extra.outputs, signs locally,
//      assembles the PaymentPayload, retries with X-PAYMENT → 200 + premium body +
//      PAYMENT-RESPONSE receipt header.
//   3. The SAME X-PAYMENT replayed → 402 (seen-tx single-use) with a NEW paymentId.
//   4. A TAMPERED `accepted` (outputs mutated) → 402 (deep-equal mismatch).
//   5. Facilitator unreachable mid-verify → 503 (NOT a fresh 402 — never re-pay).
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { randomBytes } from "node:crypto";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { fromBase64 } from "@mysten/sui/utils";
import type { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import { USDC_TYPE, caip2 } from "@suize/shared";
import { suize, type PaymentRequired, type Output, type PaymentPayload } from "@suize/pay";
import { E2E_ENABLED, e2eClient, loadPayerKeypair, coinBalance, faucetHelp } from "./setup";

const NETWORK = caip2("testnet");
const PRICE = "0.10"; // the merchant's configured price
const MIN_FUNDING = 100_000n; // one $0.10 happy-path settle, base units
const PAYMENT_ID_RE = /^pay_[0-9a-f]{32}$/;
const PREMIUM = { report: "premium", content: "the walrus-grade alpha" };
const TOTAL = "100000"; // $0.10 atomic — the single declared output

const BACKEND_DIR = new URL("../..", import.meta.url).pathname;

// ── suite state (bun runs tests in declaration order within a file) ─────────
let client: SuiJsonRpcClient;
let payer: Ed25519Keypair;
let payerAddress = "";
let merchantAddress = ""; // fresh CSPRNG — seeded as the fee-tier merchant
let backend: ReturnType<typeof Bun.spawn> | null = null;
let merchantServer: ReturnType<typeof Bun.serve> | null = null;
let base = (process.env.SUIZE_E2E_BACKEND_URL ?? "").replace(/\/$/, "");
let merchantUrl = "";
// handed from test to test:
let challenge1: PaymentRequired; // the happy-path challenge
let happyHeader = ""; // the X-PAYMENT value that unlocked the 200

const freshAddress = (): string =>
  Ed25519Keypair.fromSecretKey(new Uint8Array(randomBytes(32))).toSuiAddress();

const b64json = (o: unknown): string => Buffer.from(JSON.stringify(o), "utf8").toString("base64");

const getMerchant = async (
  payment?: string,
): Promise<{ status: number; protoHeader: string | null; receipt: string | null; body: Record<string, unknown> }> => {
  const r = await fetch(`${merchantUrl}/premium-report`, {
    headers: payment ? { "X-PAYMENT": payment } : {},
  });
  return {
    status: r.status,
    protoHeader: r.headers.get("PAYMENT-REQUIRED"),
    receipt: r.headers.get("PAYMENT-RESPONSE"),
    body: (await r.json()) as Record<string, unknown>,
  };
};

const post = async (url: string, body: unknown): Promise<{ status: number; body: Record<string, unknown> }> => {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: (await r.json().catch(() => ({}))) as Record<string, unknown> };
};

/** The whole agent leg: build the gasless payment from the challenge's declared
 * outputs → local sign → assemble the b64 X-PAYMENT PaymentPayload. `outputs`
 * defaults to the challenge's own (the happy path); pass a mutated set for negatives. */
const payChallenge = async (c: PaymentRequired, outputs?: Output[]): Promise<string> => {
  const accepted = c.accepts[0];
  const buildOutputs = outputs ?? accepted.extra.outputs;
  const built = await post(accepted.extra.buildUrl, { sender: payerAddress, outputs: buildOutputs });
  expect(built.status).toBe(200);
  const bytes = built.body.bytes as string;
  const signed = await payer.signTransaction(fromBase64(bytes));
  const payload: PaymentPayload = {
    x402Version: 2,
    accepted,
    payload: { signature: signed.signature, transaction: bytes },
    extensions: c.extensions ?? {},
  };
  return b64json(payload);
};

describe.skipIf(!E2E_ENABLED)(
  "TIER-3 @suize/pay v2 middleware (402 → build → sign → X-PAYMENT → 200, real testnet)",
  () => {
    beforeAll(async () => {
      if (!E2E_ENABLED) return;

      client = e2eClient();
      payer = loadPayerKeypair();
      payerAddress = payer.toSuiAddress();
      merchantAddress = freshAddress();

      // FUNDING GATE — fail fast with the manual faucet step, never a fake green.
      const usdc = await coinBalance(client, payerAddress, USDC_TYPE);
      if (usdc < MIN_FUNDING) throw new Error(faucetHelp(payerAddress));

      // Boot the facilitator harness. The merchant is FREE-TIER (NOT seeded), so the
      // declared requirement is a single full-amount output.
      if (!base) {
        const port = 18_000 + Math.floor(Math.random() * 10_000);
        const io = process.env.SUIZE_E2E_VERBOSE === "1" ? "inherit" : "ignore";
        backend = Bun.spawn(["bun", "run", "test/e2e/_facilitator-harness.ts"], {
          cwd: BACKEND_DIR,
          env: { ...process.env, PORT: String(port) },
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
      }

      // THE MERCHANT — the entire integration: one middleware around one handler.
      const paywall = suize({ to: merchantAddress, price: PRICE, facilitator: base, network: NETWORK });
      merchantServer = Bun.serve({
        port: 0,
        fetch: paywall.wrap(() => Response.json(PREMIUM)),
      });
      merchantUrl = `http://localhost:${merchantServer.port}`;
    }, 60_000);

    afterAll(() => {
      merchantServer?.stop(true);
      backend?.kill();
    });

    test("GET without payment → 402 carrying the x402 V2 PaymentRequired (free tier)", async () => {
      const r = await getMerchant();
      expect(r.status).toBe(402);
      expect(r.protoHeader).toBeTruthy(); // PAYMENT-REQUIRED header present

      const c = r.body as unknown as PaymentRequired;
      expect(c.x402Version).toBe(2);
      const a = c.accepts[0];
      expect(a.scheme).toBe("exact");
      expect(a.network).toBe(NETWORK);
      expect(a.asset).toBe(USDC_TYPE);
      expect(a.payTo).toBe(merchantAddress);
      expect(a.amount).toBe(TOTAL); // atomic units of $0.10
      // FREE tier: a single full-amount output to the merchant (no fee leg).
      expect(a.extra.outputs).toHaveLength(1);
      expect(a.extra.outputs[0].to).toBe(merchantAddress);
      expect(a.extra.outputs[0].amount).toBe(TOTAL);
      expect(a.extra.buildUrl).toBe(`${base}/build`);
      // The payment-identifier id is spec-shaped + lives in the extension.
      const id = (c.extensions["payment-identifier"] as { info?: { id?: string } })?.info?.id;
      expect(id).toMatch(PAYMENT_ID_RE);

      challenge1 = c;
    });

    test(
      "the agent settles the challenge → retry unlocks 200 + the premium body + receipt",
      async () => {
        happyHeader = await payChallenge(challenge1);
        const r = await getMerchant(happyHeader);
        expect(r.status).toBe(200);
        expect(r.body).toEqual(PREMIUM);
        expect(r.receipt).toBeTruthy(); // PAYMENT-RESPONSE settlement receipt
      },
      120_000,
    );

    test(
      "the SAME X-PAYMENT replayed → 402 with a NEW paymentId (one settlement = one serve)",
      async () => {
        const r = await getMerchant(happyHeader);
        expect(r.status).toBe(402);
        const c = r.body as unknown as PaymentRequired;
        const id = (c.extensions["payment-identifier"] as { info?: { id?: string } })?.info?.id;
        const id1 = (challenge1.extensions["payment-identifier"] as { info?: { id?: string } })?.info?.id;
        expect(id).toMatch(PAYMENT_ID_RE);
        expect(id).not.toBe(id1);
      },
      30_000,
    );

    test(
      "a TAMPERED `accepted` (mutated outputs) → 402 (deep-equal mismatch, never settled)",
      async () => {
        // A fresh challenge, then tamper the accepted output (the cheat: redirect part
        // of the amount to the payer). The middleware must reject it SYNCHRONOUSLY —
        // the presented accepted no longer deep-equals what the merchant minted.
        const fresh = (await getMerchant()).body as unknown as PaymentRequired;
        const accepted = fresh.accepts[0];
        const tampered: PaymentPayload = {
          x402Version: 2,
          accepted: {
            ...accepted,
            extra: {
              ...accepted.extra,
              outputs: [
                { to: merchantAddress, amount: "90000" }, // merchant short-changed…
                { to: payerAddress, amount: "10000" }, // …with a skim leg to the payer — tamper
              ],
            },
          },
          payload: { signature: "AA==", transaction: "AA==" }, // never reached (synchronous deny)
          extensions: fresh.extensions,
        };
        const r = await getMerchant(b64json(tampered));
        expect(r.status).toBe(402); // rejected before any chain read
      },
      30_000,
    );

    test(
      "facilitator unreachable mid-verify → 503, NOT a fresh 402 (never re-pay)",
      async () => {
        // Point a SECOND merchant at a dead facilitator port. A real signed payment
        // that /verify can't reach is INDISTINGUISHABLE from in-flight — the
        // middleware MUST answer 503 (retry the SAME header), never a fresh 402.
        const deadPort = 0; // an unbound port → connection refused
        const deadFac = `http://127.0.0.1:${1}`; // port 1: reliably refused
        void deadPort;
        const deadMerchant = freshAddress();
        const deadPaywall = suize({ to: deadMerchant, price: PRICE, facilitator: deadFac, network: NETWORK });
        const deadServer = Bun.serve({ port: 0, fetch: deadPaywall.wrap(() => Response.json(PREMIUM)) });
        try {
          const deadUrl = `http://localhost:${deadServer.port}`;
          // First a 402 to mint an id this middleware tracks…
          const c = (await fetch(`${deadUrl}/x`).then((r) => r.json())) as PaymentRequired;
          const id = (c.extensions["payment-identifier"] as { info?: { id?: string } })?.info?.id;
          // …then present a shaped X-PAYMENT for that id (the verify fetch will refuse).
          const payload: PaymentPayload = {
            x402Version: 2,
            accepted: c.accepts[0],
            payload: { signature: "AA==", transaction: b64json({ t: id }) },
            extensions: c.extensions,
          };
          const r = await fetch(`${deadUrl}/x`, { headers: { "X-PAYMENT": b64json(payload) } });
          expect(r.status).toBe(503);
          // a 503 must NOT carry a fresh challenge — nothing that invites a re-pay
          expect(r.headers.get("PAYMENT-REQUIRED")).toBeNull();
        } finally {
          deadServer.stop(true);
        }
      },
      30_000,
    );
  },
);
