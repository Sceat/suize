// DEPLOY SUBSCRIBE — endpoint arg-validation + the suizeSubs DOMAIN-GATE rejection,
// proven against the REAL booted backend. No funds spent: every path under test
// short-circuits before any on-chain write (bad args, a non-existent site, and the
// custom-domain gate rejecting a site with NO active subscription). The full create→
// suizeSubs→gate-flip loop (which DOES spend) lives in subscribe.proof.ts (a script,
// run manually with funds).
//
// RUN:    SUIZE_E2E=1 bun test ./test/e2e/deploy.subscribe.e2e.ts
//         (skips cleanly without SUIZE_E2E=1; the explicit ./path form is required.)
// NEEDS:  the subs module published (it is — testnet) + the Deploy treasury resolvable.
// BACKEND: boots the real backend with an EPHEMERAL deploy wallet (opens the gate; the
//         tested paths never reach paid work, so it signs/holds nothing).
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { E2E_ENABLED } from "./setup";

const BACKEND_DIR = new URL("../..", import.meta.url).pathname;
const RANDOM_SITE = "0x" + "ab".repeat(32); // a well-formed id that owns no Site → 404 / unsubscribed
const SENDER = "0x" + "cd".repeat(32);

let backend: ReturnType<typeof Bun.spawn> | null = null;
let base = (process.env.SUIZE_E2E_BACKEND_URL ?? "").replace(/\/$/, "");

const refill = () => Bun.sleep(5_200); // the /domains + /deploy buckets are tight (burst 4)

const post = async (path: string, body: unknown) => {
  const r = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: (await r.json().catch(() => ({}))) as Record<string, unknown> };
};

describe.skipIf(!E2E_ENABLED)("deploy subscribe (arg validation + suizeSubs domain gate)", () => {
  beforeAll(async () => {
    if (!E2E_ENABLED) return;
    if (!base) {
      const port = 18_000 + Math.floor(Math.random() * 10_000);
      const io = process.env.SUIZE_E2E_VERBOSE === "1" ? "inherit" : "ignore";
      backend = Bun.spawn(["bun", "run", "src/index.ts"], {
        cwd: BACKEND_DIR,
        env: {
          ...process.env,
          PORT: String(port),
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
  }, 30_000);

  afterAll(() => {
    backend?.kill();
  }, 15_000);

  test("build: rejects a malformed siteId (400)", async () => {
    const r = await post("/deploy/subscribe/build", { siteId: "0xabc", sender: SENDER });
    expect(r.status).toBe(400);
    expect(String(r.body.error)).toContain("siteId");
  });

  test("build: rejects a malformed sender (400)", async () => {
    const r = await post("/deploy/subscribe/build", { siteId: RANDOM_SITE, sender: "nope" });
    expect(r.status).toBe(400);
    expect(String(r.body.error)).toContain("sender");
  });

  test("build: a well-formed but non-existent site → 404 (no Site to own)", async () => {
    const r = await post("/deploy/subscribe/build", { siteId: RANDOM_SITE, sender: SENDER });
    expect(r.status).toBe(404);
    expect(String(r.body.error)).toContain("site not found");
  });

  test("submit: missing signature (400)", async () => {
    const r = await post("/deploy/subscribe/submit", { digest: "abc" });
    expect(r.status).toBe(400);
    expect(String(r.body.error)).toContain("signature");
  });

  test("submit: an unknown digest fails closed (409 — no build context to bind owner)", async () => {
    const r = await post("/deploy/subscribe/submit", { digest: "ZZxnotarealdigest", signature: "AAAA" });
    expect(r.status).toBe(409);
    expect(String(r.body.error)).toContain("unknown or expired digest");
  });

  test(
    "DOMAIN GATE: a site with no active subscription is rejected (402) — the LOCKED #10 unlock",
    async () => {
      await refill(); // the /domains bucket is tight (burst 4); wait a refill so we reach the gate
      const r = await post("/domains", { siteId: RANDOM_SITE, domain: "gate.example.com" });
      // The suizeSubs.findByRef gate runs BEFORE the DNS-challenge issue: no active
      // Deploy-merchant sub for this siteId → 402 (custom domains require a subscription).
      expect(r.status).toBe(402);
      expect(String(r.body.error).toLowerCase()).toContain("subscription");
    },
    20_000,
  );
});
