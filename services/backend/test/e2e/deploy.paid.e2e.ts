// DEPLOY PAID E2E — a REAL $0.50 gasless deploy, end-to-end on testnet (nonce-free).
// The full loop: bare POST /deploy → 402 (x402 V2) → /build the gasless send_funds →
// LOCAL sign → assemble the b64 SIGNED-but-UNSETTLED PaymentPayload (the X-PAYMENT) →
// multipart retry with that X-PAYMENT header → the backend VERIFIES + SETTLES it during
// the deploy → a Site mints with owner = the recovered PAYER → the live URL. Then the
// SAME header replayed → 409 (the on-chain SiteDigestRegistry rejects a second mint for
// the same settled payment — EDigestUsed).
//
// THE PAYMENT IS THE AUTHORIZATION: there is no separate deploy-auth nonce/signature.
// The recovered payer IS the on-chain owner — whoever pays, owns.
//
// WHO PAYS WHOM: the dev wallet (the Sui CLI active address) is BOTH the deploy
// SERVICE wallet (mints the Site, pays its SUI) AND the Deploy treasury (receives the
// $0.50). So the PAYER must be a DISTINCT address (else it's a self-pay that nets to
// zero — the exact-fee guard correctly rejects it). The suite funds a FRESH ephemeral
// payer with ~$0.55 USDC from the dev wallet, and that fresh payer signs the gasless
// payment. The payment is GASLESS so the fresh payer needs NO SUI.
//
// RUN:    SUIZE_E2E=1 bun test ./test/e2e/deploy.paid.e2e.ts
//         (skips cleanly without SUIZE_E2E=1; the explicit ./path form is required.)
// NEEDS:  the dev wallet (env key or the Sui CLI active address) holding testnet
//         Circle USDC (≥ $0.60, to fund the fresh payer) + SUI (for create_site gas +
//         the one funding transfer); the Deploy treasury resolvable.
// BACKEND: boots the real backend with DEPLOY_WALLET_PRIVATE_KEY = the dev wallet key.
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { fromBase64 } from "@mysten/sui/utils";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import { randomBytes } from "node:crypto";
import type { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import { USDC_TYPE } from "@suize/shared";
import { E2E_ENABLED, e2eClient, loadPayerKeypair, coinBalance, faucetHelp } from "./setup";

const BACKEND_DIR = new URL("../..", import.meta.url).pathname;
const SUI_TYPE = "0x2::sui::SUI";
const FUND_USDC = 550_000n; // the fresh payer's USDC: one $0.50 deploy + headroom
const MIN_DEV_USDC = FUND_USDC + 50_000n; // dev wallet must afford the funding transfer
const MIN_DEV_SUI = 100_000_000n; // create_site gas + the funding transfer

let client: SuiJsonRpcClient;
let dev: Ed25519Keypair; // the dev wallet = service wallet + treasury
let payer: Ed25519Keypair; // a FRESH ephemeral payer ≠ the treasury
let payerAddress = "";
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
  write("0000644\0", 100, 8); // mode
  write("0000000\0", 108, 8); // uid
  write("0000000\0", 116, 8); // gid
  write(data.length.toString(8).padStart(11, "0") + "\0", 124, 12); // size (octal)
  write(Math.floor(Date.now() / 1000).toString(8).padStart(11, "0") + "\0", 136, 12); // mtime
  write("        ", 148, 8); // checksum placeholder (spaces)
  header[156] = 0x30; // typeflag '0' = regular file
  write("ustar\0", 257, 6);
  write("00", 263, 2);
  let sum = 0;
  for (const byte of header) sum += byte;
  write(sum.toString(8).padStart(6, "0") + "\0 ", 148, 8); // real checksum
  const padded = new Uint8Array(Math.ceil(data.length / 512) * 512);
  padded.set(data);
  const out = new Uint8Array(512 + padded.length + 1024); // + two zero blocks (EOF)
  out.set(header, 0);
  out.set(padded, 512);
  return new Blob([out], { type: "application/x-tar" });
};

describe.skipIf(!E2E_ENABLED)("deploy PAID (real $0.50 gasless x402 deploy → site mints, real testnet)", () => {
  beforeAll(async () => {
    if (!E2E_ENABLED) return;
    client = e2eClient();
    dev = loadPayerKeypair();
    const devAddress = dev.toSuiAddress();

    // The dev wallet must afford funding the fresh payer + the create_site gas.
    const devUsdc = await coinBalance(client, devAddress, USDC_TYPE);
    if (devUsdc < MIN_DEV_USDC) throw new Error(faucetHelp(devAddress));
    const devSui = await coinBalance(client, devAddress, SUI_TYPE);
    if (devSui < MIN_DEV_SUI) {
      throw new Error(
        `\nNO TESTNET SUI — the dev wallet (${devAddress}) needs gas for create_site + the funding transfer.\n` +
          `  fund it at https://faucet.sui.io (Sui Testnet)\n`,
      );
    }

    // A FRESH payer (≠ the treasury) so the $0.50 is a REAL transfer, not a self-pay.
    payer = Ed25519Keypair.fromSecretKey(new Uint8Array(randomBytes(32)));
    payerAddress = payer.toSuiAddress();

    // Fund it with USDC from the dev wallet via `send_funds` — the SAME Address-Balance
    // primitive x402 uses (the dev wallet's USDC lives in its address balance, received
    // via send_funds, NOT as a Coin object — getCoins would return none). The dev wallet
    // pays the SUI gas for this one transfer. The fresh payer needs NO SUI afterward
    // (the payment is gasless + the deploy auth is a signed message).
    if (devUsdc < FUND_USDC) throw new Error(faucetHelp(devAddress));
    const tx = new Transaction();
    tx.setSender(devAddress);
    tx.moveCall({
      target: "0x2::balance::send_funds",
      typeArguments: [USDC_TYPE],
      arguments: [tx.balance({ type: USDC_TYPE, balance: FUND_USDC }), tx.pure.address(payerAddress)],
    });
    const fundRes = await client.signAndExecuteTransaction({ transaction: tx, signer: dev, options: { showEffects: true } });
    if (fundRes.effects?.status?.status !== "success") {
      throw new Error(`funding the fresh payer failed: ${fundRes.effects?.status?.error ?? "unknown"}`);
    }
    await client.waitForTransaction({ digest: fundRes.digest });
    // Confirm the payer is funded before the suite runs (node lag tolerance).
    const deadlineFund = Date.now() + 12_000;
    for (;;) {
      if ((await coinBalance(client, payerAddress, USDC_TYPE)) >= FUND_USDC) break;
      if (Date.now() > deadlineFund) throw new Error("fresh payer USDC not visible after funding");
      await Bun.sleep(500);
    }

    const port = 18_000 + Math.floor(Math.random() * 10_000);
    const io = process.env.SUIZE_E2E_VERBOSE === "1" ? "inherit" : "ignore";
    // The deploy SERVICE wallet is the dev wallet (it mints the Site + pays gas). The
    // PAYER is the fresh ephemeral key — the recovered payer becomes the on-chain owner
    // (whoever pays, owns; no separate deploy-auth signature).
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
    // The gate must be live (bare POST → 402) or this suite is meaningless.
    const probe = await fetch(`${base}/deploy`, { method: "POST" });
    if (probe.status !== 402) {
      throw new Error(`charge gate not armed (bare POST /deploy -> ${probe.status}); need the Deploy treasury resolvable`);
    }
  }, 60_000);

  afterAll(() => {
    backend?.kill();
  }, 15_000);

  // Build + sign a 402 challenge → the b64 X-PAYMENT header (the SIGNED-but-UNSETTLED
  // gasless payment — the backend settles it DURING the deploy). NO /settle here, and
  // NO separate deploy-auth: the payment payload IS the authorization.
  const buildSigned = async (challenge: any): Promise<string> => {
    const accepted = challenge.accepts[0];
    const built = await post(accepted.extra.buildUrl, { sender: payerAddress, outputs: accepted.extra.outputs });
    expect(built.status).toBe(200);
    const bytes = built.body.bytes as string;
    const signed = await payer.signTransaction(fromBase64(bytes));
    return b64json({
      x402Version: 2,
      accepted,
      payload: { signature: signed.signature, transaction: bytes },
      extensions: challenge.extensions ?? {},
    });
  };

  let paidHeader = "";

  test(
    "402 → build → sign → X-PAYMENT retry → backend settles + mints; owner = the PAYER; $0.50 GASLESS (zero SUI)",
    async () => {
      const treasury = dev.toSuiAddress(); // first-party: the treasury == the dev wallet
      const treasuryBefore = await coinBalance(client, treasury, USDC_TYPE);
      const payerUsdcBefore = await coinBalance(client, payerAddress, USDC_TYPE);
      // The fresh payer holds ZERO SUI — so the payment can ONLY succeed if it is
      // genuinely gasless (a gas-paying tx would fail at build with no SUI).
      expect(await coinBalance(client, payerAddress, SUI_TYPE)).toBe(0n);

      // 1. discover → 402 challenge
      const challenge = await fetch(`${base}/deploy`, { method: "POST" }).then((r) => r.json());
      expect(challenge.accepts?.[0]?.amount).toBe("500000");

      // 2. build + sign the gasless payment (NOT settled — the deploy settles it)
      paidHeader = await buildSigned(challenge);

      // 3. the paid multipart retry — the X-PAYMENT header is the sole authorization
      const form = new FormData();
      form.append("name", "paid-e2e");
      form.append(
        "site.tar",
        oneFileTar("index.html", `<h1>paid ${Date.now()}-${Math.random()}</h1>`),
        "site.tar",
      );
      const r = await fetch(`${base}/deploy`, { method: "POST", headers: { "X-PAYMENT": paidHeader }, body: form });
      const body = (await r.json()) as Record<string, any>;
      expect(r.status).toBe(200);
      expect(body.siteId).toMatch(/^0x[0-9a-fA-F]{64}$/);
      expect(String(body.url)).toContain(".suize.site");
      expect(body.version).toBe(1);

      // PROOF — whoever pays owns: the on-chain Site.owner == the recovered PAYER.
      const site = await client.getObject({ id: body.siteId, options: { showContent: true } });
      const fields = (site.data?.content as any)?.fields as Record<string, unknown>;
      expect(String(fields.owner).toLowerCase()).toBe(payerAddress.toLowerCase());

      // PHYSICS: the payer was debited exactly $0.50 USDC, the treasury credited it,
      // and the payer's SUI is STILL zero (gasless proof). Poll for node lag.
      let treasuryAfter = 0n;
      let payerUsdcAfter = 0n;
      const deadline = Date.now() + 15_000;
      for (;;) {
        treasuryAfter = await coinBalance(client, treasury, USDC_TYPE);
        payerUsdcAfter = await coinBalance(client, payerAddress, USDC_TYPE);
        if (treasuryAfter - treasuryBefore === 500_000n || Date.now() > deadline) break;
        await Bun.sleep(500);
      }
      expect(treasuryAfter - treasuryBefore).toBe(500_000n); // first-party: full $0.50 to treasury
      expect(payerUsdcBefore - payerUsdcAfter).toBe(500_000n); // payer debited exactly $0.50
      expect(await coinBalance(client, payerAddress, SUI_TYPE)).toBe(0n); // STILL gasless
    },
    180_000,
  );

  test(
    "the SAME X-PAYMENT replayed → 409 (the on-chain registry rejects a second mint)",
    async () => {
      // The deploy route's per-IP bucket is tight (burst 4, ~1 token/5s); the prior
      // discovery + paid deploy burned tokens — wait a refill so the replay reaches
      // the gate (not a 429).
      await Bun.sleep(6_000);
      const form = new FormData();
      form.append("name", "paid-e2e-replay");
      form.append("site.tar", oneFileTar("index.html", "<h1>replay</h1>"), "site.tar");
      const r = await fetch(`${base}/deploy`, { method: "POST", headers: { "X-PAYMENT": paidHeader }, body: form });
      // The first deploy CONSUMED the settled payment digest in the on-chain
      // SiteDigestRegistry → a re-submit aborts EDigestUsed at create_site → 409
      // (the multi-replica-safe one-site-per-payment guard).
      expect(r.status).toBe(409);
      const body = (await r.json()) as Record<string, any>;
      expect(String(body.error).toLowerCase()).toContain("already used");
    },
    60_000,
  );
});
