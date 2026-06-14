// DEPLOY FULL-LIFECYCLE ACCEPTANCE — one headless flow, real testnet, against a
// backend THIS script boots. Exercises: deploy ($0.50 gasless x402) → serve (prod
// worker / on-chain Site verify) → extend (re-402 $0.50) → subscribe (sponsored
// subs::create, ref=siteId) → domain gate (reject unsubscribed, pass subscribed) →
// receipts (treasury balance-change proof). Mirrors the e2e helpers verbatim
// (oneFileTar / buildSigned — the signed X-PAYMENT IS the auth, no deploy nonce) and
// the subscribe.proof.ts flow.
//
// RUN: SUIZE_E2E=1 bun run ./test/e2e/lifecycle.acceptance.ts
// Uses a REDUCED sub price (DEPLOY_SUB_PRICE_USDC=50000 = $0.05) — the prod price is
// the $19.99 number-wall const; the dev wallet holds only ~$1.45 native testnet USDC.
import { fromBase64 } from "@mysten/sui/utils";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import { createHash, randomBytes } from "node:crypto";
import { USDC_TYPE, resolveTreasury, DEPLOY_CHARGE_AMOUNT } from "@suize/shared";
import { suizeSubs } from "@suize/pay/subs";
import { e2eClient, loadPayerKeypair, coinBalance, faucetHelp } from "./setup";

const BACKEND_DIR = new URL("../..", import.meta.url).pathname;
let TREASURY = ""; // resolved from treasury@suize once the client exists (in main)
const SUI_TYPE = "0x2::sui::SUI";
const SUB_PRICE = 50_000n; // $0.05 reduced test price
const CHARGE = BigInt(DEPLOY_CHARGE_AMOUNT); // 500_000 = $0.50

const log = (...a: unknown[]) => console.log(...a);
const b64json = (o: unknown): string => Buffer.from(JSON.stringify(o), "utf8").toString("base64");
const sha256hex = (b: Uint8Array): string => createHash("sha256").update(b).digest("hex");

// A 1-file tar (ustar) — UNIQUE bytes per run so Walrus never dedups the quilt.
const oneFileTar = (path: string, contents: string): { blob: Blob; bytes: Uint8Array } => {
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
  return { blob: new Blob([out], { type: "application/x-tar" }), bytes: data };
};

const main = async () => {
  if (process.env.SUIZE_E2E !== "1") {
    log("skip: set SUIZE_E2E=1 to run the real-testnet acceptance");
    return;
  }
  const client = e2eClient();
  TREASURY = ((await resolveTreasury(client)) ?? "").toLowerCase();
  const dev = loadPayerKeypair();
  const devAddr = dev.toSuiAddress();
  const out: Record<string, unknown> = {};

  log("dev/treasury:", devAddr);
  if (devAddr.toLowerCase() !== TREASURY) {
    log(`WARNING: dev address != pinned treasury ${TREASURY} — receipts assume first-party self-pay`);
  }
  const devUsdc0 = await coinBalance(client, devAddr, USDC_TYPE);
  const devSui0 = await coinBalance(client, devAddr, SUI_TYPE);
  log("dev native USDC:", Number(devUsdc0) / 1e6, " SUI:", Number(devSui0) / 1e9);
  if (devSui0 < 100_000_000n) throw new Error("dev wallet needs SUI for create_site gas + funding transfers");

  // send_funds USDC from the dev wallet into a fresh payer's ADDRESS BALANCE (the same
  // Address-Balance primitive x402 uses). Returns the funding digest.
  const fund = async (toAddr: string, amount: bigint): Promise<string> => {
    if ((await coinBalance(client, devAddr, USDC_TYPE)) < amount + 20_000n) {
      throw new Error(faucetHelp(devAddr));
    }
    const tx = new Transaction();
    tx.setSender(devAddr);
    tx.moveCall({
      target: "0x2::balance::send_funds",
      typeArguments: [USDC_TYPE],
      arguments: [tx.balance({ type: USDC_TYPE, balance: amount }), tx.pure.address(toAddr)],
    });
    const r = await client.signAndExecuteTransaction({ transaction: tx, signer: dev, options: { showEffects: true } });
    if (r.effects?.status?.status !== "success") throw new Error(`fund failed: ${r.effects?.status?.error}`);
    await client.waitForTransaction({ digest: r.digest });
    for (let i = 0; i < 24; i++) {
      if ((await coinBalance(client, toAddr, USDC_TYPE)) >= amount) break;
      await Bun.sleep(500);
    }
    return r.digest;
  };

  // ── boot the backend (deploy wallet = dev; reduced sub price) ─────────────────
  const port = 18_000 + Math.floor(Math.random() * 10_000);
  const io = process.env.SUIZE_E2E_VERBOSE === "1" ? "inherit" : "ignore";
  const backend = Bun.spawn(["bun", "run", "src/index.ts"], {
    cwd: BACKEND_DIR,
    env: {
      ...process.env,
      PORT: String(port),
      DEPLOY_WALLET_PRIVATE_KEY: dev.getSecretKey(),
      DEPLOY_SUB_PRICE_USDC: String(SUB_PRICE),
    },
    stdout: io,
    stderr: io,
  });
  const base = `http://localhost:${port}`;
  const post = async (url: string, body: unknown) => {
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return { status: r.status, body: (await r.json().catch(() => ({}))) as Record<string, any> };
  };

  try {
    const deadline = Date.now() + 25_000;
    for (;;) {
      try { if ((await fetch(`${base}/health`)).ok) break; } catch {}
      if (Date.now() > deadline) throw new Error("backend did not boot in 25s");
      await Bun.sleep(250);
    }
    const probe = await fetch(`${base}/deploy`, { method: "POST" });
    if (probe.status !== 402) throw new Error(`charge gate not armed (POST /deploy -> ${probe.status})`);
    log("backend up @", base, "— charge gate ARMED (402)");

    // Build + sign a 402 challenge → the b64 X-PAYMENT header (gasless, SIGNED-but-
    // UNSETTLED — the deploy/extend settles it in-process). The signed payment IS the
    // authorization; the recovered payer becomes the on-chain owner (no deploy-auth).
    const buildSigned = async (challenge: any, payer: Ed25519Keypair, payerAddr: string): Promise<string> => {
      const accepted = challenge.accepts[0];
      const built = await post(accepted.extra.buildUrl, { sender: payerAddr, outputs: accepted.extra.outputs });
      if (built.status !== 200) throw new Error(`build failed [${built.status}]: ${JSON.stringify(built.body)}`);
      const bytes = built.body.bytes as string;
      const signed = await payer.signTransaction(fromBase64(bytes));
      return b64json({ x402Version: 2, accepted, payload: { signature: signed.signature, transaction: bytes }, extensions: challenge.extensions ?? {} });
    };
    // Wait for the treasury USDC balance to move by exactly `delta` (settlement landed).
    // Returns the on-chain digest that moved it (the settled payment receipt).
    const awaitTreasuryDelta = async (before: bigint, delta: bigint, label: string): Promise<{ after: bigint; digest: string | null }> => {
      let after = before;
      const dl = Date.now() + 20_000;
      for (;;) {
        after = await coinBalance(client, TREASURY, USDC_TYPE);
        if (after - before === delta || Date.now() > dl) break;
        await Bun.sleep(600);
      }
      // Find the digest of the inbound USDC transfer at the treasury (newest txs).
      let digest: string | null = null;
      try {
        const txs = await client.queryTransactionBlocks({
          filter: { ToAddress: TREASURY },
          options: { showBalanceChanges: true },
          limit: 12,
          order: "descending",
        });
        for (const t of txs.data) {
          const bc = (t.balanceChanges ?? []).find(
            (c: any) => c.coinType === USDC_TYPE && String((c.owner as any)?.AddressOwner ?? "").toLowerCase() === TREASURY && BigInt(c.amount) > 0n,
          );
          if (bc) { digest = t.digest; break; }
        }
      } catch { /* best-effort */ }
      log(`  [${label}] treasury USDC ${Number(before) / 1e6} -> ${Number(after) / 1e6} (Δ ${Number(after - before) / 1e6}); inbound digest ${digest}`);
      return { after, digest };
    };

    // =====================================================================
    // PHASE A — SITE 1: deploy → serve → extend → subscribe → domain-gate pass
    // =====================================================================
    const payer1 = Ed25519Keypair.fromSecretKey(new Uint8Array(randomBytes(32)));
    const payer1Addr = payer1.toSuiAddress();
    // INCREMENTAL FUNDING (the dev/treasury wallet holds only ~$0.85 native USDC — a
    // testnet hard cap; the Circle faucet is reCAPTCHA-gated, see setup.ts). Because
    // dev == treasury, every $0.50/$0.05 charge lands straight back, so we fund each
    // leg JUST BEFORE it pays — the wallet never has to front $1.05+ at once. The
    // payer pays exactly the listed price (the 2%/$0.01 fee is carved INSIDE that).
    const fundDigest1 = await fund(payer1Addr, 520_000n); // $0.52 — the $0.50 deploy + headroom
    log("\n=== funded site-1 payer", payer1Addr, "with $0.52 for the deploy leg (digest", fundDigest1 + ") ===");

    // ── 1. DEPLOY ──────────────────────────────────────────────────────────────
    const indexHtml = `<!doctype html><html><head><meta charset=utf-8><title>suize accept</title></head><body><h1>suize lifecycle acceptance ${Date.now()}-${Math.random()}</h1></body></html>`;
    const tar1 = oneFileTar("index.html", indexHtml);
    const htmlHash = sha256hex(tar1.bytes);

    const treasuryBeforeDeploy = await coinBalance(client, TREASURY, USDC_TYPE);
    const payer1SuiBefore = await coinBalance(client, payer1Addr, SUI_TYPE);
    const ch1 = await fetch(`${base}/deploy`, { method: "POST" }).then((r) => r.json());
    if (ch1.accepts?.[0]?.amount !== "500000") throw new Error("deploy 402 amount != 500000");
    const payHeader1 = await buildSigned(ch1, payer1, payer1Addr);
    const form1 = new FormData();
    form1.append("name", "accept-site-1");
    form1.append("site.tar", tar1.blob, "site.tar");
    const depRes1 = await fetch(`${base}/deploy`, { method: "POST", headers: { "X-PAYMENT": payHeader1 }, body: form1 });
    const depBody1 = (await depRes1.json()) as Record<string, any>;
    if (depRes1.status !== 200) throw new Error(`deploy failed [${depRes1.status}]: ${JSON.stringify(depBody1)}`);
    const siteId1 = depBody1.siteId as string;
    const url1 = depBody1.url as string;
    log("\n=== 1. DEPLOY (site 1) ===");
    log("  siteId:", siteId1);
    log("  url:", url1);
    log("  create_site digest:", depBody1.digest);
    log("  index.html sha256:", htmlHash);
    const dep1Receipt = await awaitTreasuryDelta(treasuryBeforeDeploy, CHARGE, "deploy");
    if (dep1Receipt.after - treasuryBeforeDeploy !== CHARGE) throw new Error("deploy $0.50 did not land at treasury");
    // gasless proof
    const payer1SuiAfter = await coinBalance(client, payer1Addr, SUI_TYPE);
    log("  payer SUI before/after:", Number(payer1SuiBefore) / 1e9, "/", Number(payer1SuiAfter) / 1e9, "(gasless)");
    out.deploy = { siteId: siteId1, url: url1, createSiteDigest: depBody1.digest, paymentSettledDigest: dep1Receipt.digest, htmlSha256: htmlHash, gasless: payer1SuiBefore === 0n && payer1SuiAfter === 0n };

    // ── 2. SERVE — prod worker (or on-chain Site fallback) ──────────────────────
    log("\n=== 2. SERVE ===");
    let served: any = { url: url1, exercised: false };
    // poll the prod worker briefly for propagation
    let workerOk = false;
    const workerDl = Date.now() + 25_000;
    for (;;) {
      try {
        const r = await fetch(url1, { redirect: "follow", signal: AbortSignal.timeout(8000) });
        if (r.ok) {
          const body = await r.text();
          const bodyHash = sha256hex(new TextEncoder().encode(body));
          const exact = body === indexHtml;
          log(`  GET ${url1} -> ${r.status}; exact-bytes=${exact}; served sha256=${bodyHash}`);
          served = { url: url1, exercised: true, status: r.status, exactBytes: exact, servedSha256: bodyHash, expectedSha256: htmlHash };
          workerOk = true;
          break;
        } else if (r.status === 404 || r.status === 502 || r.status === 530) {
          // not propagated yet / not resolvable
        }
      } catch { /* dns/propagation */ }
      if (Date.now() > workerDl) break;
      await Bun.sleep(2500);
    }
    if (!workerOk) {
      // Fallback: verify the on-chain Site object + manifest_hash directly.
      const so = await client.getObject({ id: siteId1, options: { showContent: true } });
      const f = (so.data?.content as any)?.fields ?? {};
      const mh = f.manifest_hash;
      const manifestHashHex = Array.isArray(mh) ? mh.map((b: number) => (b & 0xff).toString(16).padStart(2, "0")).join("") : String(mh);
      log("  prod worker did NOT serve the fresh testnet site within 25s (propagation). Verified on-chain Site instead:");
      log("    Site.owner:", f.owner, " name:", f.name, " files:", f.file_count, " manifest_hash:", manifestHashHex);
      served = { url: url1, exercised: false, reason: "worker not propagated within 25s; on-chain Site verified instead", siteOwner: f.owner, manifestHashHex, fileCount: f.file_count };
    }
    out.serve = served;

    // ── 3. EXTEND (re-402, $0.50) ───────────────────────────────────────────────
    log("\n=== 3. EXTEND ===");
    // Top up the payer for the extend leg now that the deploy $0.50 has landed back
    // at the treasury (== dev wallet) — incremental funding (see the deploy leg note).
    const fundExtDigest = await fund(payer1Addr, 510_000n); // $0.51 — the $0.50 extend + headroom
    log("  topped up payer for extend with $0.51 (digest", fundExtDigest + ")");
    const beforeSite = await fetch(`${base}/sites/${siteId1}`).then((r) => r.json());
    log("  GET /sites/:id BEFORE — expiresAtMs:", beforeSite.expiresAtMs, " storageEndEpoch:", beforeSite.storageEndEpoch);
    const treasuryBeforeExt = await coinBalance(client, TREASURY, USDC_TYPE);
    // discover extend 402
    const extCh = await fetch(`${base}/sites/${siteId1}/extend`, { method: "POST" }).then((r) => r.json());
    if (!extCh.accepts?.[0]) throw new Error("extend did not 402 with a challenge");
    if (extCh.accepts[0].amount !== "500000") throw new Error("extend 402 amount != 500000");
    const extHeader = await buildSigned(extCh, payer1, payer1Addr);
    const extRes = await fetch(`${base}/sites/${siteId1}/extend`, { method: "POST", headers: { "X-PAYMENT": extHeader } });
    const extBody = (await extRes.json()) as Record<string, any>;
    log(`  POST extend (paid) -> ${extRes.status}: ${JSON.stringify(extBody)}`);
    const extReceipt = await awaitTreasuryDelta(treasuryBeforeExt, CHARGE, "extend");
    const afterSite = await fetch(`${base}/sites/${siteId1}`).then((r) => r.json());
    log("  GET /sites/:id AFTER — expiresAtMs:", afterSite.expiresAtMs, " storageEndEpoch:", afterSite.storageEndEpoch);
    out.extend = {
      extend402Amount: extCh.accepts[0].amount,
      paidStatus: extRes.status,
      paidBody: extBody,
      paymentLandedAtTreasury: extReceipt.after - treasuryBeforeExt === CHARGE,
      paymentSettledDigest: extReceipt.digest,
      expiresBeforeMs: beforeSite.expiresAtMs ?? null,
      expiresAfterMs: afterSite.expiresAtMs ?? null,
      storageEndEpochBefore: beforeSite.storageEndEpoch ?? null,
      storageEndEpochAfter: afterSite.storageEndEpoch ?? null,
    };

    // ── 4. SUBSCRIBE (sponsored subs::create, ref=siteId) ───────────────────────
    log("\n=== 4. SUBSCRIBE ===");
    // Ensure the payer holds at least the reduced sub price ($0.05). Whatever change
    // survived deploy+extend stays; top up the difference (incremental funding).
    const payerUsdcNow = await coinBalance(client, payer1Addr, USDC_TYPE);
    if (payerUsdcNow < SUB_PRICE + 5_000n) {
      const topUp = SUB_PRICE + 10_000n - payerUsdcNow;
      const fundSubDigest = await fund(payer1Addr, topUp);
      log(`  topped up payer for the sub with ${Number(topUp) / 1e6} (digest ${fundSubDigest})`);
    }
    const treasuryBeforeSub = await coinBalance(client, TREASURY, USDC_TYPE);
    const buildSub = await post(`${base}/deploy/subscribe/build`, { siteId: siteId1, sender: payer1Addr });
    log(`  /subscribe/build -> [${buildSub.status}] digest=${buildSub.body.digest} amount=${buildSub.body.amount} merchant=${buildSub.body.merchant}`);
    if (buildSub.status !== 200) throw new Error(`subscribe build failed: ${JSON.stringify(buildSub.body)}`);
    const subBytes = buildSub.body.bytes as string;
    const subBuildDigest = buildSub.body.digest as string;
    const signedSub = await payer1.signTransaction(fromBase64(subBytes));
    const submit = await post(`${base}/deploy/subscribe/submit`, { digest: subBuildDigest, signature: signedSub.signature });
    log(`  /subscribe/submit -> [${submit.status}] ${JSON.stringify(submit.body)}`);
    if (submit.status !== 200) throw new Error(`subscribe submit failed: ${JSON.stringify(submit.body)}`);
    const createDigest = submit.body.digest as string;
    const subId = submit.body.subscriptionId as string;
    const subReceipt = await awaitTreasuryDelta(treasuryBeforeSub, SUB_PRICE, "subscribe");

    // suizeSubs (merchant SDK) sees it active
    const subs = suizeSubs({ merchant: TREASURY, network: "testnet" });
    let byRef: any = null;
    for (let i = 0; i < 16; i++) { byRef = await subs.findByRef(siteId1); if (byRef) break; await Bun.sleep(500); }
    const isActive = subId ? await subs.isActive(subId) : false;
    log("  create digest:", createDigest);
    log("  Subscription id:", subId);
    log("  suizeSubs.findByRef(siteId).active:", byRef?.active, " isActive(subId):", isActive);
    if (!byRef?.active) throw new Error("suizeSubs.findByRef did not see the sub as active");
    // GET /sites/:id now shows subscribed:true
    const siteAfterSub = await fetch(`${base}/sites/${siteId1}`).then((r) => r.json());
    log("  GET /sites/:id subscribed:", siteAfterSub.subscribed);
    out.subscribe = {
      buildDigest: subBuildDigest,
      createDigest,
      subscriptionId: subId,
      ref: byRef?.ref,
      refMatchesSiteId: byRef?.ref ? (byRef.ref.replace(/^0x/, "").toLowerCase() === siteId1.replace(/^0x/, "").toLowerCase()) : false,
      active: byRef?.active,
      isActive,
      siteSubscribedFlag: siteAfterSub.subscribed,
      subPriceUsdc: String(SUB_PRICE),
      subPeriodMs: buildSub.body.periodMs,
      paymentLandedAtTreasury: subReceipt.after - treasuryBeforeSub === SUB_PRICE,
      paymentSettledDigest: subReceipt.digest,
    };

    // ── 5. DOMAIN GATE ──────────────────────────────────────────────────────────
    log("\n=== 5. DOMAIN GATE ===");
    // 5a. a NON-subscribed site → 402. Deploy a 2nd site (don't subscribe it).
    const payer2 = Ed25519Keypair.fromSecretKey(new Uint8Array(randomBytes(32)));
    const payer2Addr = payer2.toSuiAddress();
    const fundDigest2 = await fund(payer2Addr, 520_000n); // one $0.50 deploy + headroom
    log("  funded site-2 payer", payer2Addr, "with $0.52 (digest", fundDigest2 + ")");
    const tar2 = oneFileTar("index.html", `<h1>unsubscribed site ${Date.now()}-${Math.random()}</h1>`);
    // The deploy route's per-IP bucket is tight (burst 4, ~1 token/5s). The prior phase
    // drained it; wait a refill so discovery + the paid retry both reach the gate.
    const discoverDeploy = async (): Promise<any> => {
      for (let i = 0; i < 8; i++) {
        const r = await fetch(`${base}/deploy`, { method: "POST" });
        if (r.status === 402) return r.json();
        await Bun.sleep(5_200); // one token refill
      }
      throw new Error("deploy discovery kept hitting the rate limiter");
    };
    log("  (waiting out the deploy rate-limit bucket before site 2)");
    await Bun.sleep(11_000);
    const ch2 = await discoverDeploy();
    const payHeader2 = await buildSigned(ch2, payer2, payer2Addr);
    let depRes2: Response;
    let depBody2: Record<string, any> = {};
    for (let i = 0; i < 8; i++) {
      const form2 = new FormData();
      form2.append("name", "accept-site-2-unsub");
      form2.append("site.tar", tar2.blob, "site.tar");
      depRes2 = await fetch(`${base}/deploy`, { method: "POST", headers: { "X-PAYMENT": payHeader2 }, body: form2 });
      depBody2 = (await depRes2.json()) as Record<string, any>;
      if (depRes2.status !== 429) break;
      log("  site-2 deploy hit 429 — waiting a refill and retrying");
      await Bun.sleep(5_200);
    }
    if (depRes2!.status !== 200) throw new Error(`site-2 deploy failed [${depRes2!.status}]: ${JSON.stringify(depBody2)}`);
    const siteId2 = depBody2.siteId as string;
    log("  deployed UNSUBSCRIBED site 2:", siteId2);

    const gateUnsub = await post(`${base}/domains`, { siteId: siteId2, domain: "unsub.example.com" });
    log(`  POST /domains (unsubscribed site) -> [${gateUnsub.status}] ${JSON.stringify(gateUnsub.body)}`);
    if (gateUnsub.status !== 402) throw new Error(`expected 402 reject for unsubscribed site, got ${gateUnsub.status}`);

    // 5b. the SUBSCRIBED site (site 1) → 200 challenge (TXT + CNAME). No real DNS.
    const gateSub = await post(`${base}/domains`, { siteId: siteId1, domain: "accept.example.com" });
    log(`  POST /domains (subscribed site) -> [${gateSub.status}] txtName=${gateSub.body.txtName} txtValue=${String(gateSub.body.txtValue).slice(0, 16)}… cname=${gateSub.body.cname} status=${gateSub.body.status}`);
    if (gateSub.status !== 200) throw new Error(`expected 200 challenge for subscribed site, got ${gateSub.status}: ${JSON.stringify(gateSub.body)}`);
    out.domainGate = {
      unsubscribedSiteId: siteId2,
      rejectStatus: gateUnsub.status,
      rejectError: gateUnsub.body.error,
      subscribedSiteId: siteId1,
      passStatus: gateSub.status,
      challenge: { status: gateSub.body.status, txtName: gateSub.body.txtName, txtValue: gateSub.body.txtValue, cname: gateSub.body.cname },
    };

    // ── 6. RECEIPTS — treasury balance-change proof ─────────────────────────────
    log("\n=== 6. RECEIPTS (treasury balance-change proof) ===");
    out.receipts = {
      treasury: TREASURY,
      deployChargeLanded: { amountUsdc: Number(CHARGE) / 1e6, digest: dep1Receipt.digest },
      extendChargeLanded: { amountUsdc: Number(CHARGE) / 1e6, landed: out.extend && (out.extend as any).paymentLandedAtTreasury, digest: extReceipt.digest },
      subPeriodLanded: { amountUsdc: Number(SUB_PRICE) / 1e6, landed: subReceipt.after - treasuryBeforeSub === SUB_PRICE, digest: subReceipt.digest },
    };
    log(JSON.stringify(out.receipts, null, 2));

    log("\n========== ACCEPTANCE RESULT (JSON) ==========");
    log(JSON.stringify(out, null, 2));
    log("\nDONE.");
  } finally {
    backend.kill();
  }
};

main().then(() => process.exit(0)).catch((err) => { console.error("\nACCEPTANCE FAILED:", err); process.exit(1); });
