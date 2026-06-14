// DEPLOY PAY-LINK E2E — the no-Sui-key door, end-to-end on testnet (nonce-free).
//
// THE FLOW under test (LOCKED #10 + the unified signed-payload door):
//   1. A Deploy AGENT with no Sui key discovers the price: bare POST /deploy → 402.
//      The 402 carries a `payLink` (pay.suize.io?…&mode=authorize) — no secret.
//   2. The agent hands the payLink to its HUMAN (a SECOND, distinct key). The human
//      builds + signs the gasless $0.50 to the Deploy treasury but does NOT settle —
//      EXACTLY what pay.suize.io's mode=authorize does (build gasless → sign → return
//      the SIGNED-but-UNSETTLED b64 PaymentPayload). Nothing is on-chain yet.
//   3. The agent submits THAT signed payload as the X-PAYMENT header on the upload
//      { name, site.tar } — the SAME door as a Sui-native agent. The backend VERIFIES
//      + SETTLES it during the deploy, sets owner = the PAYER (the human), mints.
//   → PROOF: the Site is OWNED BY THE HUMAN (the payer), not the agent.
//
// ONE-SITE-PER-PAYMENT (also proven here): re-submitting the SAME signed payload after
// the site mints → 409 (the on-chain SiteDigestRegistry rejects a second mint). Nothing
// was public before the deploy, so there is nothing for an attacker to replay.
//
// WHO PAYS WHOM: the dev wallet (Sui CLI active address) is BOTH the deploy SERVICE
// wallet (mints the Site, pays its SUI) AND the Deploy treasury (receives the $0.50).
// The HUMAN payer is a FRESH ephemeral key (≠ the treasury) funded with ~$0.55 USDC —
// the payment is gasless so it needs NO SUI; there is NO deploy-auth signature on this
// door (the signed payment payload IS the auth, and the recovered payer is the owner).
//
// RUN:    SUIZE_E2E=1 bun test ./test/e2e/deploy.paylink.e2e.ts
//         (skips cleanly without SUIZE_E2E=1; the explicit ./path form is required.)
// NEEDS:  the dev wallet holding testnet Circle USDC (≥ $0.60) + SUI (create_site gas +
//         the one funding transfer); the Deploy treasury resolvable.
// BACKEND: boots the real backend with DEPLOY_WALLET_PRIVATE_KEY = the dev wallet key.
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { fromBase64 } from "@mysten/sui/utils";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import { randomBytes } from "node:crypto";
import type { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import { USDC_TYPE, caip2 } from "@suize/shared";
import type { Output, PaymentPayload, PaymentRequirements } from "@suize/x402";
import { E2E_ENABLED, e2eClient, loadPayerKeypair, coinBalance, faucetHelp } from "./setup";

const BACKEND_DIR = new URL("../..", import.meta.url).pathname;
const NETWORK = caip2("testnet");
const SUI_TYPE = "0x2::sui::SUI";
const FUND_USDC = 550_000n; // the human's USDC: one $0.50 pay-link + headroom
const MIN_DEV_USDC = FUND_USDC + 50_000n;
const MIN_DEV_SUI = 100_000_000n;

let client: SuiJsonRpcClient;
let dev: Ed25519Keypair; // dev wallet = service wallet + treasury
let human: Ed25519Keypair; // the SECOND key — the human who pays the pay-link
let humanAddress = "";
let backend: ReturnType<typeof Bun.spawn> | null = null;
let base = "";

const b64json = (o: unknown): string => Buffer.from(JSON.stringify(o), "utf8").toString("base64");

const post = async (url: string, body: unknown): Promise<{ status: number; body: Record<string, unknown> }> => {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: (await r.json().catch(() => ({}))) as Record<string, unknown> };
};

/** A 1-file tar (ustar) Blob with UNIQUE bytes per run so Walrus never dedups the quilt. */
const oneFileTar = (path: string, contents: string): Blob => {
  const enc = new TextEncoder();
  const data = enc.encode(contents);
  const header = new Uint8Array(512);
  const write = (s: string, off: number, len: number) => {
    const b = enc.encode(s);
    header.set(b.subarray(0, Math.min(b.length, len)), off);
  };
  write(path, 0, 100);
  write("0000644\0", 100, 8);
  write("0000000\0", 108, 8);
  write("0000000\0", 116, 8);
  write(data.length.toString(8).padStart(11, "0") + "\0", 124, 12);
  write(Math.floor(Date.now() / 1000).toString(8).padStart(11, "0") + "\0", 136, 12);
  write("        ", 148, 8);
  header[156] = 0x30;
  write("ustar\0", 257, 6);
  write("00", 263, 2);
  let sum = 0;
  for (const byte of header) sum += byte;
  write(sum.toString(8).padStart(6, "0") + "\0 ", 148, 8);
  const padded = new Uint8Array(Math.ceil(data.length / 512) * 512);
  padded.set(data);
  const out = new Uint8Array(512 + padded.length + 1024);
  out.set(header, 0);
  out.set(padded, 512);
  return new Blob([out], { type: "application/x-tar" });
};

describe.skipIf(!E2E_ENABLED)("deploy PAY-LINK (spoof-safe no-Sui-key door → site owned by the human payer, real testnet)", () => {
  beforeAll(async () => {
    if (!E2E_ENABLED) return;
    client = e2eClient();
    dev = loadPayerKeypair();
    const devAddress = dev.toSuiAddress();

    const devUsdc = await coinBalance(client, devAddress, USDC_TYPE);
    if (devUsdc < MIN_DEV_USDC) throw new Error(faucetHelp(devAddress));
    const devSui = await coinBalance(client, devAddress, SUI_TYPE);
    if (devSui < MIN_DEV_SUI) {
      throw new Error(
        `\nNO TESTNET SUI — the dev wallet (${devAddress}) needs gas for create_site + the funding transfer.\n` +
          `  fund it at https://faucet.sui.io (Sui Testnet)\n`,
      );
    }

    // The HUMAN: a FRESH key (≠ the treasury) so the $0.50 is a REAL transfer.
    human = Ed25519Keypair.fromSecretKey(new Uint8Array(randomBytes(32)));
    humanAddress = human.toSuiAddress();

    // Fund the human with USDC via send_funds (the same Address-Balance primitive x402
    // uses). The human pays gasless afterward; needs no SUI.
    const tx = new Transaction();
    tx.setSender(devAddress);
    tx.moveCall({
      target: "0x2::balance::send_funds",
      typeArguments: [USDC_TYPE],
      arguments: [tx.balance({ type: USDC_TYPE, balance: FUND_USDC }), tx.pure.address(humanAddress)],
    });
    const fundRes = await client.signAndExecuteTransaction({ transaction: tx, signer: dev, options: { showEffects: true } });
    if (fundRes.effects?.status?.status !== "success") {
      throw new Error(`funding the human failed: ${fundRes.effects?.status?.error ?? "unknown"}`);
    }
    await client.waitForTransaction({ digest: fundRes.digest });
    const deadlineFund = Date.now() + 12_000;
    for (;;) {
      if ((await coinBalance(client, humanAddress, USDC_TYPE)) >= FUND_USDC) break;
      if (Date.now() > deadlineFund) throw new Error("human USDC not visible after funding");
      await Bun.sleep(500);
    }

    const port = 18_000 + Math.floor(Math.random() * 10_000);
    const io = process.env.SUIZE_E2E_VERBOSE === "1" ? "inherit" : "ignore";
    backend = Bun.spawn(["bun", "run", "src/index.ts"], {
      cwd: BACKEND_DIR,
      env: { ...process.env, PORT: String(port), DEPLOY_WALLET_PRIVATE_KEY: dev.getSecretKey() },
      stdout: io,
      stderr: io,
    });
    base = `http://localhost:${port}`;
    const deadline = Date.now() + 25_000;
    for (;;) {
      try {
        if ((await fetch(`${base}/health`)).ok) break;
      } catch {
        /* booting */
      }
      if (Date.now() > deadline) throw new Error("backend did not boot in 25s");
      await Bun.sleep(250);
    }
    const probe = await fetch(`${base}/deploy`, { method: "POST" });
    if (probe.status !== 402) {
      throw new Error(`charge gate not armed (bare POST /deploy -> ${probe.status}); need the Deploy treasury resolvable`);
    }
  }, 60_000);

  afterAll(() => {
    backend?.kill();
  }, 15_000);

  // The HUMAN authorizes the pay-link: build the gasless $0.50 to the treasury, sign
  // LOCALLY, but do NOT settle — return the SIGNED-but-UNSETTLED b64 PaymentPayload
  // (exactly what pay.suize.io's mode=authorize hands back). The agent submits this as
  // the X-PAYMENT header; the backend settles it DURING the deploy.
  const humanAuthorizes = async (challenge: any): Promise<string> => {
    const accepted = challenge.accepts[0] as PaymentRequirements;
    const outputs = accepted.extra!.outputs as Output[];
    const built = await post(`${base}/build`, { sender: humanAddress, outputs });
    expect(built.status).toBe(200);
    const bytes = built.body.bytes as string;
    const signed = await human.signTransaction(fromBase64(bytes));
    const payload: PaymentPayload = {
      x402Version: 2,
      accepted,
      payload: { signature: signed.signature, transaction: bytes },
      extensions: challenge.extensions ?? {},
    };
    // NOT settled — hand back the b64 signed payload (the X-PAYMENT header value).
    return b64json(payload);
  };

  let humanHeader = "";

  test(
    "402 → human authorizes (signs, NO settle) → agent submits it as X-PAYMENT → site owned by the HUMAN payer",
    async () => {
      const treasury = dev.toSuiAddress();
      const treasuryBefore = await coinBalance(client, treasury, USDC_TYPE);
      const humanUsdcBefore = await coinBalance(client, humanAddress, USDC_TYPE);
      expect(await coinBalance(client, humanAddress, SUI_TYPE)).toBe(0n); // gasless proof

      // 1. AGENT discovers the price → 402 with a payLink (mode=authorize, no secret).
      const challenge = await fetch(`${base}/deploy`, { method: "POST" }).then((r) => r.json());
      expect(challenge.accepts?.[0]?.amount).toBe("500000");
      const link = new URL(challenge.payLink as string);
      expect(link.searchParams.get("mode")).toBe("authorize");
      expect(challenge.nonce).toBeUndefined(); // no secret nonce anymore

      // 2. HUMAN authorizes — builds + signs, does NOT settle.
      humanHeader = await humanAuthorizes(challenge);

      // 3. AGENT submits the human's signed payload as X-PAYMENT — the SAME door.
      await Bun.sleep(5_200); // respect the tight per-IP deploy bucket
      const form = new FormData();
      form.append("name", "paylink-e2e");
      form.append("site.tar", oneFileTar("index.html", `<h1>paylink ${Date.now()}-${Math.random()}</h1>`), "site.tar");
      const r = await fetch(`${base}/deploy`, { method: "POST", headers: { "X-PAYMENT": humanHeader }, body: form });
      const body = (await r.json()) as Record<string, any>;
      expect(r.status).toBe(200);
      expect(body.siteId).toMatch(/^0x[0-9a-fA-F]{64}$/);
      expect(String(body.url)).toContain(".suize.site");

      // PROOF — whoever paid owns the site: the on-chain Site.owner == the HUMAN payer.
      const site = await client.getObject({ id: body.siteId, options: { showContent: true } });
      const fields = (site.data?.content as any)?.fields as Record<string, unknown>;
      expect(String(fields.owner).toLowerCase()).toBe(humanAddress.toLowerCase());

      // PHYSICS: the human was debited exactly $0.50, the treasury credited it, the
      // human's SUI still zero (gasless). Poll for node lag.
      let treasuryAfter = 0n;
      let humanUsdcAfter = 0n;
      const deadline = Date.now() + 15_000;
      for (;;) {
        treasuryAfter = await coinBalance(client, treasury, USDC_TYPE);
        humanUsdcAfter = await coinBalance(client, humanAddress, USDC_TYPE);
        if (treasuryAfter - treasuryBefore === 500_000n || Date.now() > deadline) break;
        await Bun.sleep(500);
      }
      expect(treasuryAfter - treasuryBefore).toBe(500_000n);
      expect(humanUsdcBefore - humanUsdcAfter).toBe(500_000n);
      expect(await coinBalance(client, humanAddress, SUI_TYPE)).toBe(0n); // STILL gasless
    },
    180_000,
  );

  test(
    "the SAME signed payload re-submitted → 409 (one payment mints one site, on-chain)",
    async () => {
      await Bun.sleep(6_000);
      const form = new FormData();
      form.append("name", "paylink-replay");
      form.append("site.tar", oneFileTar("index.html", "<h1>replay</h1>"), "site.tar");
      const r = await fetch(`${base}/deploy`, { method: "POST", headers: { "X-PAYMENT": humanHeader }, body: form });
      // The first deploy consumed this settled payment in the on-chain registry → a
      // re-submit aborts EDigestUsed at create_site → 409. Never 200.
      expect(r.status).toBe(409);
      const body = (await r.json()) as Record<string, any>;
      expect(body.siteId).toBeUndefined(); // proof: no second site
      expect(String(body.error).toLowerCase()).toContain("already used");
    },
    60_000,
  );
});
