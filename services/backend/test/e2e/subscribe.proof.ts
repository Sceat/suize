// DEPLOY SUBSCRIPTION — full testnet PROOF (not a bun:test; a standalone script so it
// never runs under a plain `bun test`). The loop:
//   1. fund a FRESH payer (≠ the treasury) with USDC for one $0.50 deploy + one sub.
//   2. deploy a tiny site AS that payer (payer == owner) → a real siteId the payer owns.
//   3. show the /domains gate REJECTS (402) — no subscription yet.
//   4. POST /deploy/subscribe/build → sign the sponsored bytes LOCALLY → POST /submit.
//   5. show suizeSubs.findByRef(siteId) + isActive(subId) see it ACTIVE.
//   6. show the /domains gate now PASSES (200 challenge) — reject→pass flip.
//
// RUN: SUIZE_E2E=1 bun run ./test/e2e/subscribe.proof.ts
// NEEDS: the dev wallet (CLI active address) holding testnet USDC (≥ ~$0.65) + SUI.
// Uses a REDUCED sub price (DEPLOY_SUB_PRICE_USDC=50000 = $0.05) so a fresh payer can
// afford it — the PRODUCTION price is the $19.99 number-wall const (config override only).
import { fromBase64 } from "@mysten/sui/utils";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import { randomBytes } from "node:crypto";
import { USDC_TYPE, resolveTreasury } from "@suize/shared";
import { suizeSubs } from "@suize/pay/subs";
import { e2eClient, loadPayerKeypair, coinBalance, faucetHelp } from "./setup";

const BACKEND_DIR = new URL("../..", import.meta.url).pathname;
let TREASURY = ""; // resolved from treasury@suize once the client exists (in main)
const SUB_PRICE = 50_000n; // $0.05 reduced test price
const FUND_USDC = 650_000n; // $0.50 deploy + $0.05 sub + headroom
const log = (...a: unknown[]) => console.log(...a);
const b64json = (o: unknown): string => Buffer.from(JSON.stringify(o), "utf8").toString("base64");

const oneFileTar = (path: string, contents: string): Blob => {
  const enc = new TextEncoder();
  const data = enc.encode(contents);
  const header = new Uint8Array(512);
  const write = (s: string, off: number, len: number) => header.set(enc.encode(s).subarray(0, len), off);
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
  for (const b of header) sum += b;
  write(sum.toString(8).padStart(6, "0") + "\0 ", 148, 8);
  const padded = new Uint8Array(Math.ceil(data.length / 512) * 512);
  padded.set(data);
  const out = new Uint8Array(512 + padded.length + 1024);
  out.set(header, 0);
  out.set(padded, 512);
  return new Blob([out], { type: "application/x-tar" });
};

const main = async () => {
  if (process.env.SUIZE_E2E !== "1") {
    log("skip: set SUIZE_E2E=1 to run the real-testnet proof");
    return;
  }
  const client = e2eClient();
  TREASURY = (await resolveTreasury(client)) ?? "";
  const dev = loadPayerKeypair();
  const devAddr = dev.toSuiAddress();
  const devUsdc = await coinBalance(client, devAddr, USDC_TYPE);
  if (devUsdc < FUND_USDC + 50_000n) throw new Error(faucetHelp(devAddr));

  // A FRESH payer ≠ the treasury (else the $0.50 deploy is a self-pay → exact-fee reject).
  const payer = Ed25519Keypair.fromSecretKey(new Uint8Array(randomBytes(32)));
  const payerAddr = payer.toSuiAddress();
  log("fresh payer:", payerAddr);

  // Fund it via send_funds (address-balance — the same primitive x402 + tx.balance use).
  const fund = new Transaction();
  fund.setSender(devAddr);
  fund.moveCall({
    target: "0x2::balance::send_funds",
    typeArguments: [USDC_TYPE],
    arguments: [fund.balance({ type: USDC_TYPE, balance: FUND_USDC }), fund.pure.address(payerAddr)],
  });
  const fundRes = await client.signAndExecuteTransaction({ transaction: fund, signer: dev, options: { showEffects: true } });
  if (fundRes.effects?.status?.status !== "success") throw new Error(`fund failed: ${fundRes.effects?.status?.error}`);
  await client.waitForTransaction({ digest: fundRes.digest });
  for (let i = 0; i < 24; i++) {
    if ((await coinBalance(client, payerAddr, USDC_TYPE)) >= FUND_USDC) break;
    await Bun.sleep(500);
  }
  log("funded payer with", FUND_USDC, "USDC");

  // Boot the backend (deploy wallet = dev; reduced sub price).
  const port = 18_000 + Math.floor(Math.random() * 10_000);
  const io = process.env.SUIZE_E2E_VERBOSE === "1" ? "inherit" : "ignore";
  const backend = Bun.spawn(["bun", "run", "src/index.ts"], {
    cwd: BACKEND_DIR,
    env: { ...process.env, PORT: String(port), DEPLOY_WALLET_PRIVATE_KEY: dev.getSecretKey(), DEPLOY_SUB_PRICE_USDC: String(SUB_PRICE) },
    stdout: io,
    stderr: io,
  });
  const base = `http://localhost:${port}`;
  try {
    const deadline = Date.now() + 25_000;
    for (;;) {
      try { if ((await fetch(`${base}/health`)).ok) break; } catch {}
      if (Date.now() > deadline) throw new Error("backend did not boot");
      await Bun.sleep(250);
    }

    // ── 2. DEPLOY a site as the payer (payer == owner) ───────────────────────
    const post = async (url: string, body: unknown) => {
      const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      return { status: r.status, body: (await r.json().catch(() => ({}))) as Record<string, unknown> };
    };
    const challenge = await fetch(`${base}/deploy`, { method: "POST" }).then((r) => r.json());
    const accepted = challenge.accepts[0];
    const built = await post(accepted.extra.buildUrl, { sender: payerAddr, outputs: accepted.extra.outputs });
    const payBytes = built.body.bytes as string;
    const signedPay = await payer.signTransaction(fromBase64(payBytes));
    // SIGNED-but-UNSETTLED X-PAYMENT — the deploy settles it in-process; the recovered
    // payer becomes the on-chain owner (no separate deploy-auth signature).
    const payHeader = b64json({ x402Version: 2, accepted, payload: { signature: signedPay.signature, transaction: payBytes }, extensions: challenge.extensions ?? {} });
    const form = new FormData();
    form.append("name", "sub-proof");
    form.append("site.tar", oneFileTar("index.html", `<h1>sub proof ${Date.now()}</h1>`), "site.tar");
    const deployRes = await fetch(`${base}/deploy`, { method: "POST", headers: { "X-PAYMENT": payHeader }, body: form });
    const deployBody = (await deployRes.json()) as Record<string, any>;
    if (deployRes.status !== 200) throw new Error(`deploy failed [${deployRes.status}]: ${JSON.stringify(deployBody)}`);
    const siteId = deployBody.siteId as string;
    log("\n=== DEPLOYED ===");
    log("siteId:", siteId);
    log("deploy digest:", deployBody.digest);
    log("url:", deployBody.url);

    // ── 3. GATE BEFORE the sub → expect 402 reject ───────────────────────────
    const gateBefore = await post(`${base}/domains`, { siteId, domain: "proof.example.com" });
    log("\n=== GATE (no sub) ===");
    log(`POST /domains → [${gateBefore.status}] ${JSON.stringify(gateBefore.body)}`);
    if (gateBefore.status !== 402) throw new Error(`expected 402 gate reject, got ${gateBefore.status}`);

    // ── 4. SUBSCRIBE: build → sign → submit ──────────────────────────────────
    const buildSub = await post(`${base}/deploy/subscribe/build`, { siteId, sender: payerAddr });
    log("\n=== /deploy/subscribe/build ===");
    log(`[${buildSub.status}]`, { digest: buildSub.body.digest, amount: buildSub.body.amount, merchant: buildSub.body.merchant });
    if (buildSub.status !== 200) throw new Error(`build failed: ${JSON.stringify(buildSub.body)}`);
    const subBytes = buildSub.body.bytes as string;
    const subDigest = buildSub.body.digest as string;
    const signedSub = await payer.signTransaction(fromBase64(subBytes));
    const submit = await post(`${base}/deploy/subscribe/submit`, { digest: subDigest, signature: signedSub.signature });
    log("\n=== /deploy/subscribe/submit ===");
    log(`[${submit.status}]`, submit.body);
    if (submit.status !== 200) throw new Error(`submit failed: ${JSON.stringify(submit.body)}`);
    const createDigest = submit.body.digest as string;
    const subId = submit.body.subscriptionId as string;

    // ── 5. suizeSubs SEES it active (the merchant SDK, merchant = treasury) ───
    const subs = suizeSubs({ merchant: TREASURY, network: "testnet" });
    let byRef = null as Awaited<ReturnType<typeof subs.findByRef>>;
    for (let i = 0; i < 16; i++) {
      byRef = await subs.findByRef(siteId);
      if (byRef) break;
      await Bun.sleep(500);
    }
    const isActive = subId ? await subs.isActive(subId) : false;
    log("\n=== suizeSubs (merchant SDK) ===");
    log("create digest:", createDigest);
    log("Subscription object id:", subId);
    log("suizeSubs.findByRef(siteId):", byRef ? { subscriptionId: byRef.subscriptionId, ref: byRef.ref, active: byRef.active, paidUntilMs: byRef.paidUntilMs } : null);
    log("suizeSubs.isActive(subId):", isActive);
    if (!byRef?.active) throw new Error("suizeSubs.findByRef did not see the sub as active");
    if (!isActive) throw new Error("suizeSubs.isActive(subId) was false");

    // ── 6. GATE AFTER the sub → expect 200 challenge (reject→pass flip) ──────
    const gateAfter = await post(`${base}/domains`, { siteId, domain: "proof.example.com" });
    log("\n=== GATE (subscribed) ===");
    log(`POST /domains → [${gateAfter.status}]`, { status: gateAfter.body.status, txtName: gateAfter.body.txtName, cname: gateAfter.body.cname });
    if (gateAfter.status !== 200) throw new Error(`expected 200 gate pass, got ${gateAfter.status}: ${JSON.stringify(gateAfter.body)}`);

    log("\n✅ PROOF COMPLETE — build→sign→submit created an active sub; suizeSubs sees it; gate flipped reject(402)→pass(200).");
  } finally {
    backend.kill();
  }
};

main().then(() => process.exit(0)).catch((err) => { console.error("PROOF FAILED:", err); process.exit(1); });
