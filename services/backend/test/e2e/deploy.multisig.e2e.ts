// DEPLOY MULTISIG E2E — a REAL $0.50 gasless deploy where the deployer is a 1-of-2
// SUB-ACCOUNT MULTISIG {MAIN, AGENT}, not a bare key. This is the detached-agent
// path: the agent spends from the multisig sub-account the human controls 1-of-2.
//
// WHAT THIS GUARDS (nonce-free, 2026-06-14): the deployer pays the $0.50 FROM the
// multisig sub-account, and recoverPayer(payment) recovers the MULTISIG address (the
// backend's @suize/x402 recoverPayer dispatches by signature scheme — a 1-of-2 multisig
// signature recovers the multisig pubkey/address). That recovered payer IS the on-chain
// `owner` — whoever pays, owns. There is NO separate deploy-auth signature anymore: the
// multisig-signed PAYMENT is the authorization. The Site mints with owner == the multisig.
//
// HEADLESS: both members are ed25519 (no OAuth / zkLogin proof needed) — the SAME
// 1-of-2 / threshold-1 / either-member-signs-alone model as the real {MAIN zkLogin,
// AGENT zkLogin} sub-account, formed via the SAME @suize/x402 formAgentSubaccount the
// MCP uses (canonical member order), and signed via the SAME combineForMultisig.
//
// WHO PAYS WHOM: the dev wallet (Sui CLI active address) is BOTH the deploy SERVICE
// wallet AND the Deploy treasury. The PAYER must be DISTINCT (else a self-pay nets to
// zero — the exact-fee guard rejects it), so the payer is the FRESH multisig, funded
// with ~$0.55 USDC from the dev wallet. The payment is GASLESS → the multisig needs
// NO SUI; the signed payment payload IS the auth (no separate signed message).
//
// RUN:    SUIZE_E2E=1 bun test ./test/e2e/deploy.multisig.e2e.ts
//         (skips cleanly without SUIZE_E2E=1; the explicit ./path form is required.)
// NEEDS:  the dev wallet holding testnet Circle USDC (≥ $0.60) + SUI; the Deploy
//         treasury resolvable.
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { fromBase64 } from "@mysten/sui/utils";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import { randomBytes } from "node:crypto";
import type { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import { USDC_TYPE } from "@suize/shared";
import { formAgentSubaccount, combineForMultisig } from "@suize/x402";
import { E2E_ENABLED, e2eClient, loadPayerKeypair, coinBalance, faucetHelp } from "./setup";

const BACKEND_DIR = new URL("../..", import.meta.url).pathname;
const SUI_TYPE = "0x2::sui::SUI";
const FUND_USDC = 550_000n; // the multisig's USDC: one $0.50 deploy + headroom
const MIN_DEV_USDC = FUND_USDC + 50_000n; // dev wallet must afford the funding transfer
const MIN_DEV_SUI = 100_000_000n; // create_site gas + the funding transfer

let client: SuiJsonRpcClient;
let dev: Ed25519Keypair; // the dev wallet = service wallet + treasury
let main: Ed25519Keypair; // the MAIN member (the human's one-key exit)
let agent: Ed25519Keypair; // the AGENT member (signs the agent's spends alone)
let multisig: ReturnType<typeof formAgentSubaccount>; // { address, multisig }
let msAddress = "";
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

describe.skipIf(!E2E_ENABLED)("deploy MULTISIG (real $0.50 gasless deploy from a 1-of-2 sub-account → Site owner == multisig, real testnet)", () => {
  beforeAll(async () => {
    if (!E2E_ENABLED) return;
    client = e2eClient();
    dev = loadPayerKeypair();
    const devAddress = dev.toSuiAddress();

    // The dev wallet must afford funding the multisig + the create_site gas.
    const devUsdc = await coinBalance(client, devAddress, USDC_TYPE);
    if (devUsdc < MIN_DEV_USDC) throw new Error(faucetHelp(devAddress));
    const devSui = await coinBalance(client, devAddress, SUI_TYPE);
    if (devSui < MIN_DEV_SUI) {
      throw new Error(
        `\nNO TESTNET SUI — the dev wallet (${devAddress}) needs gas for create_site + the funding transfer.\n` +
          `  fund it at https://faucet.sui.io (Sui Testnet)\n`,
      );
    }

    // The agent's 1-of-2 sub-account multisig {MAIN, AGENT} (≠ the treasury) — formed
    // via the SAME helper + canonical member order the MCP uses, so the test exercises
    // the real derivation. Either member signs alone (threshold 1); the agent member
    // signs the agent's spend + the deploy auth here.
    main = Ed25519Keypair.fromSecretKey(new Uint8Array(randomBytes(32)));
    agent = Ed25519Keypair.fromSecretKey(new Uint8Array(randomBytes(32)));
    multisig = formAgentSubaccount(main.getPublicKey(), agent.getPublicKey());
    msAddress = multisig.address;

    // Fund the multisig with USDC from the dev wallet via `send_funds` — the SAME
    // Address-Balance primitive x402 uses (the dev wallet's USDC lives in its address
    // balance). The dev wallet pays the SUI gas for this one transfer. The multisig
    // needs NO SUI afterward (the payment is gasless + the auth is a signed message).
    const tx = new Transaction();
    tx.setSender(devAddress);
    tx.moveCall({
      target: "0x2::balance::send_funds",
      typeArguments: [USDC_TYPE],
      arguments: [tx.balance({ type: USDC_TYPE, balance: FUND_USDC }), tx.pure.address(msAddress)],
    });
    const fundRes = await client.signAndExecuteTransaction({ transaction: tx, signer: dev, options: { showEffects: true } });
    if (fundRes.effects?.status?.status !== "success") {
      throw new Error(`funding the multisig failed: ${fundRes.effects?.status?.error ?? "unknown"}`);
    }
    await client.waitForTransaction({ digest: fundRes.digest });
    const deadlineFund = Date.now() + 12_000;
    for (;;) {
      if ((await coinBalance(client, msAddress, USDC_TYPE)) >= FUND_USDC) break;
      if (Date.now() > deadlineFund) throw new Error("multisig USDC not visible after funding");
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

  // Build + sign a 402 challenge → the b64 X-PAYMENT header (SIGNED-but-UNSETTLED). The
  // gasless payment is built for the MULTISIG sender, signed by the AGENT member alone,
  // then combined into the 1-of-2 multisig signature (the SAME path the MCP takes). The
  // backend recovers the MULTISIG address as the payer → the on-chain owner. NO separate
  // deploy-auth: the multisig-signed payment IS the authorization.
  const buildSigned = async (challenge: any): Promise<string> => {
    const accepted = challenge.accepts[0];
    const built = await post(accepted.extra.buildUrl, { sender: msAddress, outputs: accepted.extra.outputs });
    expect(built.status).toBe(200);
    const bytes = built.body.bytes as string;
    const memberSig = (await agent.signTransaction(fromBase64(bytes))).signature;
    const signature = combineForMultisig(multisig.multisig, memberSig);
    return b64json({
      x402Version: 2,
      accepted,
      payload: { signature, transaction: bytes },
      extensions: challenge.extensions ?? {},
    });
  };

  test(
    "402 → build → MULTISIG-sign payment → X-PAYMENT retry → Site mints with owner == the multisig (recovered payer)",
    async () => {
      const treasury = dev.toSuiAddress(); // first-party: the treasury == the dev wallet
      const treasuryBefore = await coinBalance(client, treasury, USDC_TYPE);
      const msUsdcBefore = await coinBalance(client, msAddress, USDC_TYPE);
      // The multisig holds ZERO SUI — the payment can ONLY succeed if it is gasless.
      expect(await coinBalance(client, msAddress, SUI_TYPE)).toBe(0n);

      // 1. discover → 402 challenge
      const challenge = await fetch(`${base}/deploy`, { method: "POST" }).then((r) => r.json());
      expect(challenge.accepts?.[0]?.amount).toBe("500000");

      // 2. build + sign the gasless payment FROM the multisig (agent member + combine)
      const paidHeader = await buildSigned(challenge);

      // 3. the paid multipart retry — the multisig-signed X-PAYMENT is the sole auth
      const form = new FormData();
      form.append("name", "multisig-e2e");
      form.append(
        "site.tar",
        oneFileTar("index.html", `<h1>multisig ${Date.now()}-${Math.random()}</h1>`),
        "site.tar",
      );
      const r = await fetch(`${base}/deploy`, { method: "POST", headers: { "X-PAYMENT": paidHeader }, body: form });
      const body = (await r.json()) as Record<string, any>;
      expect(r.status).toBe(200); // the bug under test would 402 here forever
      expect(body.siteId).toMatch(/^0x[0-9a-fA-F]{64}$/);
      expect(String(body.url)).toContain(".suize.site");
      expect(body.version).toBe(1);

      // OWNER == THE MULTISIG: read the on-chain Site and assert its `owner` field is
      // the multisig address (the human controls it 1-of-2 → can manage the Site).
      const site = await client.getObject({ id: body.siteId as string, options: { showContent: true } });
      const content = site.data?.content;
      expect(content?.dataType).toBe("moveObject");
      const owner = (content as any).fields?.owner as string;
      expect(owner.toLowerCase()).toBe(msAddress.toLowerCase()); // owner == payer == multisig

      // PHYSICS: the multisig was debited exactly $0.50 USDC, the treasury credited it,
      // and the multisig's SUI is STILL zero (gasless proof). Poll for node lag.
      let treasuryAfter = 0n;
      let msUsdcAfter = 0n;
      const deadline = Date.now() + 15_000;
      for (;;) {
        treasuryAfter = await coinBalance(client, treasury, USDC_TYPE);
        msUsdcAfter = await coinBalance(client, msAddress, USDC_TYPE);
        if (treasuryAfter - treasuryBefore === 500_000n || Date.now() > deadline) break;
        await Bun.sleep(500);
      }
      expect(treasuryAfter - treasuryBefore).toBe(500_000n); // first-party: full $0.50 to treasury
      expect(msUsdcBefore - msUsdcAfter).toBe(500_000n); // multisig debited exactly $0.50
      expect(await coinBalance(client, msAddress, SUI_TYPE)).toBe(0n); // STILL gasless
    },
    180_000,
  );
});
