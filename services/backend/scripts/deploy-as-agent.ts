#!/usr/bin/env bun
/**
 * deploy-as-agent.ts — drive the CHARGE↔Deploy join "as the agent," over HTTP.
 *
 * This is the demo cut-line script: the local MCP's pay+deploy tools fall back to
 * a clean terminal script so the chain writes are PROVEN before any MCP polish.
 * It pays the one-off $0.50 deploy `charge` from a funded Suize Account, then ships
 * a static site to Walrus — the full "first merchant on the rail" loop, end to end.
 *
 * THE BACKEND NEVER SIGNS. This script holds the agent's keypair locally and signs:
 *   (a) the sponsored `charge` bytes, and
 *   (b) the deploy auth nonce.
 * The backend only builds sponsored bytes + verifies the settled charge.
 *
 * ── What it does ──────────────────────────────────────────────────────────────
 *   1. POST /deploy/quote                    -> read { amount, merchant, feeBps }.
 *   2. (optional --bootstrap) create_account + deposit so the agent has a funded
 *      Account<USDC> to charge from.  [needs the agent's key to own USDC coins]
 *   3. POST /deploy/charge { account, sender } -> sponsored `charge` bytes.
 *   4. sign bytes locally -> POST /execute { digest, signature } -> chargeDigest.
 *   5. GET /auth/nonce -> sign buildDeployAuthMessage(nonce) -> deploy auth.
 *   6. tar the site dir -> POST /deploy (multipart + chargeDigest) -> { siteId, url }.
 *   7. print { chargeDigest, siteId, url, deployDigest }.
 *
 * ── Usage ─────────────────────────────────────────────────────────────────────
 *   AGENT_KEY=suiprivkey1... \
 *   bun scripts/deploy-as-agent.ts \
 *     --backend http://localhost:8080 \
 *     --site ./examples/hello-site \
 *     --name my-first-agent-site \
 *     --account 0x<your Account<USDC> object id>
 *
 *   # First run: create + fund the Account in one go (needs the agent to hold USDC):
 *   bun scripts/deploy-as-agent.ts ... --bootstrap --deposit 2000000   # $2.00
 *
 * Requires (to run LIVE): the `account` package published (PACKAGE_IDS.ACCOUNT set),
 * the Deploy merchant pinned (SUIZE_DEPLOY_MERCHANT set), the backend running with a
 * funded Enoki sponsor + deploy wallet, and the agent key holding testnet USDC + a
 * little SUI. Until those ids are set the backend 503s "rail not configured" — the
 * script prints that verbatim and stops (nothing to sign).
 */
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import { Transaction } from "@mysten/sui/transactions";
import { toBase64 } from "@mysten/sui/utils";
import {
  PACKAGE_IDS,
  USDC_TYPE,
  buildDeployAuthMessage,
  fullnodeUrl,
  resolveNetwork,
} from "@suize/shared";
import type {
  DeployQuoteResponse,
  DeployChargeResponse,
  DeployResponse,
  DeployNonceResponse,
} from "@suize/shared";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

// ── tiny arg parser ────────────────────────────────────────────────────────────
const args = new Map<string, string>();
const flags = new Set<string>();
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a.startsWith("--")) {
    const key = a.slice(2);
    const next = process.argv[i + 1];
    if (next && !next.startsWith("--")) { args.set(key, next); i++; }
    else flags.add(key);
  }
}
const arg = (k: string, dflt?: string): string => args.get(k) ?? dflt ?? "";
const die = (msg: string): never => { console.error(`\n✗ ${msg}\n`); process.exit(1); };

const BACKEND = arg("backend", process.env.SUIZE_BACKEND ?? "http://localhost:8080").replace(/\/$/, "");
const SITE_DIR = arg("site");
const SITE_NAME = arg("name", "agent-deploy");
const SUI_NETWORK = resolveNetwork(process.env.SUI_NETWORK);
const RPC_URL = arg("rpc", process.env.SUI_RPC_URL ?? fullnodeUrl(SUI_NETWORK));
const AGENT_KEY = process.env.AGENT_KEY ?? arg("key");

if (!AGENT_KEY) die("set AGENT_KEY=suiprivkey1… (the agent's funded testnet key) or pass --key");
if (!SITE_DIR) die("pass --site <dir> (a built static site directory)");

const agent = Ed25519Keypair.fromSecretKey(AGENT_KEY);
const SENDER = agent.toSuiAddress();
const client = new SuiJsonRpcClient({ url: RPC_URL, network: SUI_NETWORK });

// ── http helpers ────────────────────────────────────────────────────────────────
const post = async (path: string, body: unknown): Promise<any> => {
  const r = await fetch(`${BACKEND}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  let parsed: any; try { parsed = JSON.parse(text); } catch { parsed = text; }
  if (!r.ok) die(`POST ${path} → ${r.status}: ${typeof parsed === "string" ? parsed : JSON.stringify(parsed)}`);
  return parsed;
};
const getJson = async (path: string): Promise<any> => {
  const r = await fetch(`${BACKEND}${path}`);
  const text = await r.text();
  let parsed: any; try { parsed = JSON.parse(text); } catch { parsed = text; }
  if (!r.ok) die(`GET ${path} → ${r.status}: ${typeof parsed === "string" ? parsed : JSON.stringify(parsed)}`);
  return parsed;
};

// ── minimal in-process tar writer (ustar) — no dep; matches what the backend parses.
const tarSite = (dir: string): Uint8Array => {
  const files: { name: string; data: Uint8Array }[] = [];
  const walk = (d: string) => {
    for (const entry of readdirSync(d)) {
      const full = join(d, entry);
      const st = statSync(full);
      if (st.isDirectory()) walk(full);
      else files.push({ name: relative(dir, full).replace(/\\/g, "/"), data: new Uint8Array(readFileSync(full)) });
    }
  };
  walk(dir);
  if (files.length === 0) die(`no files under --site ${dir}`);

  const blocks: Uint8Array[] = [];
  const enc = new TextEncoder();
  for (const f of files) {
    const header = new Uint8Array(512);
    const writeStr = (s: string, off: number, len: number) => {
      const b = enc.encode(s);
      header.set(b.subarray(0, len), off);
    };
    const writeOct = (n: number, off: number, len: number) => {
      writeStr(n.toString(8).padStart(len - 1, "0"), off, len);
    };
    writeStr(f.name, 0, 100);
    writeOct(0o644, 100, 8);
    writeOct(0, 108, 8);
    writeOct(0, 116, 8);
    writeOct(f.data.length, 124, 12);
    writeOct(Math.floor(Date.now() / 1000), 136, 12);
    writeStr("ustar\0", 257, 6);
    writeStr("00", 263, 2);
    header[156] = "0".charCodeAt(0); // typeflag: regular file
    // checksum: spaces, sum bytes, then write octal
    for (let i = 148; i < 156; i++) header[i] = 32;
    let sum = 0; for (let i = 0; i < 512; i++) sum += header[i];
    writeStr(sum.toString(8).padStart(6, "0") + "\0 ", 148, 8);
    blocks.push(header);
    const padded = new Uint8Array(Math.ceil(f.data.length / 512) * 512);
    padded.set(f.data);
    blocks.push(padded);
  }
  blocks.push(new Uint8Array(1024)); // two zero blocks = EOF
  const total = blocks.reduce((n, b) => n + b.length, 0);
  const out = new Uint8Array(total);
  let o = 0; for (const b of blocks) { out.set(b, o); o += b.length; }
  return out;
};

// ── optional bootstrap: create_account + deposit so the agent has a funded Account.
const bootstrapAccount = async (depositRaw: number): Promise<string> => {
  console.log(`  bootstrap: create_account<USDC> + deposit ${depositRaw} (self-signed, agent pays own gas)…`);
  // 1. create_account<USDC>() — shares the Account. No fee arg anymore: fee policy
  //    lives in the shared RailConfig (default 2%), not on the Account.
  const t1 = new Transaction();
  t1.moveCall({
    target: PACKAGE_IDS.ACCOUNT.TARGETS.CREATE_ACCOUNT,
    typeArguments: [USDC_TYPE],
    arguments: [],
  });
  const r1 = await client.signAndExecuteTransaction({
    transaction: t1, signer: agent, options: { showObjectChanges: true, showEffects: true },
  });
  if (r1.effects?.status?.status !== "success") die(`create_account failed: ${r1.effects?.status?.error}`);
  const accountType = `${PACKAGE_IDS.ACCOUNT.PACKAGE}::account::Account<${USDC_TYPE}>`;
  const created = (r1.objectChanges ?? []).find(
    (c: any) => c.type === "created" && typeof c.objectType === "string" && c.objectType.startsWith(`${PACKAGE_IDS.ACCOUNT.PACKAGE}::account::Account`),
  ) as any;
  if (!created) die("create_account: Account object not found in effects");
  const account = created.objectId as string;
  await client.waitForTransaction({ digest: r1.digest });
  console.log(`  Account created: ${account}`);

  // 2. deposit<USDC>(account, coin) — pick a USDC coin the agent owns, split the amount.
  const coins = await client.getCoins({ owner: SENDER, coinType: USDC_TYPE });
  if (coins.data.length === 0) die(`agent ${SENDER} holds no ${USDC_TYPE} — fund it first`);
  const t2 = new Transaction();
  const primary = t2.object(coins.data[0].coinObjectId);
  if (coins.data.length > 1) t2.mergeCoins(primary, coins.data.slice(1).map((c) => t2.object(c.coinObjectId)));
  const [depositCoin] = t2.splitCoins(primary, [t2.pure.u64(BigInt(depositRaw))]);
  t2.moveCall({
    target: PACKAGE_IDS.ACCOUNT.TARGETS.DEPOSIT,
    typeArguments: [USDC_TYPE],
    arguments: [t2.object(account), depositCoin],
  });
  const r2 = await client.signAndExecuteTransaction({ transaction: t2, signer: agent, options: { showEffects: true } });
  if (r2.effects?.status?.status !== "success") die(`deposit failed: ${r2.effects?.status?.error}`);
  await client.waitForTransaction({ digest: r2.digest });
  console.log(`  deposited ${depositRaw} USDC base units → Account funded.`);
  return account;
};

// ── main ─────────────────────────────────────────────────────────────────────────
const main = async () => {
  console.log(`\n▶ Suize deploy-as-agent`);
  console.log(`  backend : ${BACKEND}`);
  console.log(`  agent   : ${SENDER}`);
  console.log(`  site    : ${SITE_DIR}  (name="${SITE_NAME}")\n`);

  // 1. quote
  const quote: DeployQuoteResponse = await getJson("/deploy/quote");
  console.log(`① quote: ${quote.description}`);
  console.log(`   amount=${quote.amount} (${(quote.amount / 1e6).toFixed(2)} USDC) merchant=${quote.merchant} feeBps=${quote.feeBps}\n`);

  // 2. account (bootstrap or provided)
  let account = arg("account");
  if (flags.has("bootstrap")) {
    const deposit = Number(arg("deposit", String(quote.amount * 4))); // default: 4× the price
    account = await bootstrapAccount(deposit);
    console.log("");
  }
  if (!account) die("pass --account 0x<Account<USDC> id> (or --bootstrap to create + fund one)");

  // 3. build + sponsor the $0.50 charge
  console.log(`② POST /deploy/charge — building sponsored charge from ${account}…`);
  const charge: DeployChargeResponse = await post("/deploy/charge", { account, sender: SENDER, memo: `deploy ${SITE_NAME}` });
  console.log(`   sponsored charge built (digest=${charge.digest.slice(0, 12)}…)\n`);

  // 4. sign the sponsored bytes LOCALLY + execute
  console.log(`③ signing the charge LOCALLY (backend never signs) + POST /execute…`);
  const { signature: chargeSig } = await agent.signTransaction(Buffer.from(charge.bytes, "base64"));
  const exec = await post("/execute", { digest: charge.digest, signature: chargeSig });
  const chargeDigest = exec.digest as string;
  console.log(`   ✓ charge settled on-chain: ${chargeDigest}\n`);

  // 5. deploy auth nonce + sign
  console.log(`④ GET /auth/nonce + sign the deploy authorization…`);
  const { nonce }: DeployNonceResponse = await getJson("/auth/nonce");
  const authMsg = buildDeployAuthMessage(nonce);
  const { signature: deploySig } = await agent.signPersonalMessage(new TextEncoder().encode(authMsg));

  // 6. tar + POST /deploy with the chargeDigest gate
  console.log(`⑤ POST /deploy (tar + chargeDigest gate)…`);
  const tarBytes = tarSite(SITE_DIR);
  const form = new FormData();
  form.set("name", SITE_NAME);
  form.set("nonce", nonce);
  form.set("signature", deploySig);
  form.set("chargeDigest", chargeDigest);
  form.set("site.tar", new Blob([tarBytes as BlobPart], { type: "application/x-tar" }), "site.tar");
  const dr = await fetch(`${BACKEND}/deploy`, { method: "POST", body: form });
  const drText = await dr.text();
  let deployRes: DeployResponse & { error?: string };
  try { deployRes = JSON.parse(drText); } catch { deployRes = { error: drText } as any; }
  if (!dr.ok) die(`POST /deploy → ${dr.status}: ${deployRes.error ?? drText}`);

  // 7. result
  console.log(`\n✓ DEPLOYED — the full CHARGE↔Deploy loop, on-chain:\n`);
  console.log(JSON.stringify({
    chargeDigest,
    siteId: deployRes.siteId,
    url: deployRes.url,
    deployDigest: deployRes.digest,
  }, null, 2));
  console.log("");
};

main().catch((e) => die(e?.message ?? String(e)));
