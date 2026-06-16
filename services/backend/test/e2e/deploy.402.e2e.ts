// DEPLOY 402 E2E — the x402 V2 PaymentRequired POST /deploy answers when unpaid,
// proven against the REAL booted backend. Deploy is a FIRST-PARTY merchant (the
// merchant IS the Suize treasury), so the requirement is a SINGLE full-amount output
// of $0.50 to the treasury — NO fee split. This suite proves the CHALLENGE side
// only (no funds spent); the settled path is covered by deploy.paid.e2e.ts.
//
// RUN:    SUIZE_E2E=1 bun test ./test/e2e/deploy.402.e2e.ts
//         (skips cleanly without SUIZE_E2E=1; the explicit ./path form is required.)
// NEEDS:  the Deploy treasury (treasury@suize, or the testnet fallback address)
//         resolvable — chargeGateReady. No funds are spent.
// BACKEND: boots the real backend (bun run src/index.ts, cwd=services/backend so its
//         .env loads, ephemeral PORT) and tears it down. SUIZE_E2E_BACKEND_URL to
//         point at a running one.
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { resolveTreasury, caip2, USDC_TYPE } from "@suize/shared";
import { E2E_ENABLED, e2eClient } from "./setup";

const BACKEND_DIR = new URL("../..", import.meta.url).pathname;
const NETWORK = caip2("testnet");
let TREASURY = ""; // resolved from treasury@suize in beforeAll (the first-party Deploy treasury)
const PAYMENT_ID_RE = /^pay_[0-9a-f]{32}$/;

let backend: ReturnType<typeof Bun.spawn> | null = null;
let base = (process.env.SUIZE_E2E_BACKEND_URL ?? "").replace(/\/$/, "");

// The deploy route's per-IP bucket is TIGHT by design (burst 4, ~1 token/5s — a
// deploy is rare). The suite respects it: tests beyond the burst wait one refill.
const refill = () => Bun.sleep(5_200);

const b64json = <T>(s: string): T => JSON.parse(Buffer.from(s, "base64").toString("utf8")) as T;

describe.skipIf(!E2E_ENABLED)(
  "deploy 402 (x402 V2 PaymentRequired on POST /deploy — discovery before auth, first-party single-output)",
  () => {
    beforeAll(async () => {
      if (!E2E_ENABLED) return;
      TREASURY = ((await resolveTreasury(e2eClient())) ?? "").toLowerCase();
      if (!base) {
        const port = 18_000 + Math.floor(Math.random() * 10_000);
        const io = process.env.SUIZE_E2E_VERBOSE === "1" ? "inherit" : "ignore";
        backend = Bun.spawn(["bun", "run", "src/index.ts"], {
          cwd: BACKEND_DIR,
          env: {
            ...process.env,
            PORT: String(port),
            // DEPLOY_ENABLED gates the whole route; the challenge paths under test
            // never reach paid work, so an EPHEMERAL wallet (signs/holds nothing) is
            // enough to open the gate locally.
            DEPLOY_WALLET_PRIVATE_KEY:
              process.env.DEPLOY_WALLET_PRIVATE_KEY ?? Ed25519Keypair.generate().getSecretKey(),
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
            /* booting */
          }
          if (Date.now() > deadline) throw new Error("backend did not boot in 20s");
          await Bun.sleep(250);
        }
      }
      // The whole suite is meaningless with the charge gate off — fail loud. The gate
      // is live iff a bare POST /deploy answers 402 (vs 400/401 when un-gated).
      const probe = await fetch(`${base}/deploy`, { method: "POST" });
      if (probe.status !== 402) {
        throw new Error(
          `charge gate not armed (bare POST /deploy -> ${probe.status}); this suite proves the ` +
            "x402 V2 402 and needs the Deploy treasury (treasury@suize / testnet fallback) resolvable",
        );
      }
    });

    afterAll(() => {
      backend?.kill();
    }, 15_000);

    test("bare POST /deploy (no auth, no body) → 402 with an x402 V2 PaymentRequired", async () => {
      const r = await fetch(`${base}/deploy`, { method: "POST" });
      expect(r.status).toBe(402); // 402 BEFORE 401 — discovery is public
      // The PAYMENT-REQUIRED header carries base64(the body).
      const hdr = r.headers.get("PAYMENT-REQUIRED");
      expect(hdr).toBeTruthy();
      const c = (await r.json()) as Record<string, any>;
      expect(b64json<Record<string, any>>(hdr!).accepts[0].payTo).toBe(c.accepts[0].payTo);

      // x402 V2 shape, field-for-field.
      expect(c.x402Version).toBe(2);
      expect(typeof c.error).toBe("string");
      expect(String(c.error)).toContain("whoever pays owns the site"); // the deploy rider (owner = payer)
      const a = c.accepts[0];
      expect(a.scheme).toBe("exact");
      expect(a.network).toBe(NETWORK);
      expect(a.asset).toBe(USDC_TYPE);
      expect(a.amount).toBe("500000"); // $0.50 atomic, the TOTAL
      expect(a.payTo.toLowerCase()).toBe(TREASURY); // first-party: the Deploy treasury
      // SINGLE full-amount output (first-party — NO fee split).
      expect(a.extra.outputs).toHaveLength(1);
      expect(a.extra.outputs[0].to.toLowerCase()).toBe(TREASURY);
      expect(a.extra.outputs[0].amount).toBe("500000");
      // buildUrl points at THIS process's own origin (merchant + facilitator are one).
      expect(a.extra.buildUrl).toBe(`${base}/build`);
      // The payment-identifier id is spec-shaped + in the extension.
      const id = c.extensions["payment-identifier"]?.info?.id;
      expect(id).toMatch(PAYMENT_ID_RE);
      // NO legacy suize-402/1 fields on the wire.
      expect(c.protocol).toBeUndefined();
      expect(c.actions).toBeUndefined();
      // NO human/relay path (2026-06-15): the 402 carries NO payLink — the agent
      // self-signs X-PAYMENT (its own Sui key, or its Suize MCP session).
      expect(c.payLink).toBeUndefined();
      expect(c.nonce).toBeUndefined();
    }, 15_000);

    test("stateless mint: two discoveries → two distinct paymentIds (no session, no store)", async () => {
      await refill();
      const a = (await fetch(`${base}/deploy`, { method: "POST" }).then((r) => r.json())) as any;
      await refill();
      const b = (await fetch(`${base}/deploy`, { method: "POST" }).then((r) => r.json())) as any;
      const idA = a.extensions["payment-identifier"]?.info?.id;
      const idB = b.extensions["payment-identifier"]?.info?.id;
      expect(idA).toMatch(PAYMENT_ID_RE);
      expect(idB).toMatch(PAYMENT_ID_RE);
      expect(idA).not.toBe(idB);
    }, 20_000);

    test("malformed X-PAYMENT header → 402 with a fresh challenge (never a 500)", async () => {
      await refill();
      const form = new FormData();
      form.append("name", "malformed-check");
      const r = await fetch(`${base}/deploy`, {
        method: "POST",
        headers: { "X-PAYMENT": "!!not-base64-json!!" },
        body: form,
      });
      // The payment IS the auth — a malformed X-PAYMENT can't recover a payer, so it
      // re-mints a fresh 402 challenge (there is no separate auth wall anymore).
      expect(r.status).toBe(402);
      const body = (await r.json()) as Record<string, any>;
      expect(body.x402Version).toBe(2);
      expect(body.siteId).toBeUndefined();
    }, 15_000);

    test("empty {} X-PAYMENT → 402 (no valid payload to recover a payer)", async () => {
      // A well-formed-base64 but empty payment carries no signed transaction, so no
      // payer can be recovered → a fresh 402 challenge. Pins: the payment is the auth.
      await refill();
      const form = new FormData();
      form.append("name", "empty-payment-check");
      const r = await fetch(`${base}/deploy`, {
        method: "POST",
        headers: { "X-PAYMENT": Buffer.from("{}", "utf8").toString("base64") },
        body: form,
      });
      expect(r.status).toBe(402);
      const body = (await r.json()) as Record<string, any>;
      expect(body.x402Version).toBe(2);
      expect(body.siteId).toBeUndefined();
    }, 15_000);
  },
);
