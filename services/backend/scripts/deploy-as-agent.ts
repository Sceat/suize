#!/usr/bin/env bun
/**
 * deploy-as-agent.ts — drive the x402 V2 Deploy charge "as the agent," over HTTP.
 *
 * The terminal reference for the agent door: a bare POST /deploy answers 402 with
 * an x402 V2 PaymentRequired; the agent builds the gasless `send_funds` payment, signs
 * it LOCALLY with its own key, and retries with the X-PAYMENT header. The payment IS the
 * authorization — the recovered payer becomes the on-chain owner (whoever pays, owns).
 * There is NO separate deploy-auth nonce/signature. The full "first merchant on the
 * rail" loop, end to end. No Suize account, no API key — the address is the account.
 *
 * THE BACKEND NEVER SIGNS. This script holds the agent's keypair locally and signs the
 * gasless payment bytes. The backend only builds the unsigned gasless bytes (/build) +
 * verifies + settles the payment keyless (it broadcasts the agent's signed tx; it never
 * signs an owner leg), then mints the Site with owner = the recovered payer.
 *
 * ── What it does ──────────────────────────────────────────────────────────────
 *   1. POST /deploy (bare)                  -> 402 { accepts:[{ payTo, amount, extra:{ outputs, buildUrl } }] }.
 *   2. POST {buildUrl} { sender, outputs }  -> { bytes } (unsigned gasless send_funds).
 *   3. sign bytes locally -> assemble the b64 PaymentPayload (the X-PAYMENT header).
 *   4. tar the site dir -> POST /deploy (multipart + X-PAYMENT) -> { siteId, url, digest }.
 *   5. print { siteId, url, deployDigest }.
 *
 * ── Usage ─────────────────────────────────────────────────────────────────────
 *   AGENT_KEY=suiprivkey1... \
 *   bun scripts/deploy-as-agent.ts \
 *     --backend http://localhost:8080 \
 *     --site ./examples/hello-site \
 *     --name my-first-agent-site
 *
 * Requires (to run LIVE): the Deploy treasury resolvable (the charge gate live), the
 * backend running with a funded deploy wallet, and the agent key holding testnet USDC
 * (in its Address Balance — received via send_funds). The payment is GASLESS, so the
 * agent needs NO SUI; the deploy auth is a signed message. When the gate is OFF the
 * deploy runs un-gated (the script then deploys with no payment).
 */
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import type { DeployResponse } from "@suize/shared";
import type { PaymentRequired, Output } from "@suize/pay";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

// ── tiny arg parser ────────────────────────────────────────────────────────────
const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a.startsWith("--")) {
    const key = a.slice(2);
    const next = process.argv[i + 1];
    if (next && !next.startsWith("--")) { args.set(key, next); i++; }
  }
}
const arg = (k: string, dflt?: string): string => args.get(k) ?? dflt ?? "";
const die = (msg: string): never => { console.error(`\n✗ ${msg}\n`); process.exit(1); };

const BACKEND = arg("backend", process.env.SUIZE_BACKEND ?? "http://localhost:8080").replace(/\/$/, "");
const SITE_DIR = arg("site");
const SITE_NAME = arg("name", "agent-deploy");
const AGENT_KEY = process.env.AGENT_KEY ?? arg("key");

if (!AGENT_KEY) die("set AGENT_KEY=suiprivkey1… (the agent's funded testnet key) or pass --key");
if (!SITE_DIR) die("pass --site <dir> (a built static site directory)");

const agent = Ed25519Keypair.fromSecretKey(AGENT_KEY);
const SENDER = agent.toSuiAddress();

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
const b64json = (o: unknown): string => Buffer.from(JSON.stringify(o), "utf8").toString("base64");

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

// ── main ─────────────────────────────────────────────────────────────────────────
const main = async () => {
  console.log(`\n▶ Suize deploy-as-agent (x402 V2)`);
  console.log(`  backend : ${BACKEND}`);
  console.log(`  agent   : ${SENDER}`);
  console.log(`  site    : ${SITE_DIR}  (name="${SITE_NAME}")\n`);

  // 1. discover — a bare POST answers 402 with the x402 V2 PaymentRequired (or, when
  //    the gate is off, a 400/401 — we then deploy un-gated). We detect the 402.
  console.log(`① POST /deploy (bare) — discovering the price…`);
  const disc = await fetch(`${BACKEND}/deploy`, { method: "POST" });
  let xPayment = "";
  if (disc.status === 402) {
    const challenge = (await disc.json()) as PaymentRequired;
    const accepted = challenge.accepts[0];
    const outputs: Output[] = accepted.extra.outputs;
    console.log(`   402: ${(Number(accepted.amount) / 1e6).toFixed(2)} USDC → ${accepted.payTo}`);

    // 2. build the gasless payment + sign LOCALLY + assemble the X-PAYMENT header.
    console.log(`② POST ${accepted.extra.buildUrl} — building the gasless payment…`);
    const { bytes } = await post(new URL(accepted.extra.buildUrl).pathname, { sender: SENDER, outputs });
    const { signature } = await agent.signTransaction(Buffer.from(bytes, "base64"));
    xPayment = b64json({
      x402Version: 2,
      accepted,
      payload: { signature, transaction: bytes },
      extensions: challenge.extensions ?? {},
    });
    console.log(`   ✓ payment signed (gasless — the agent pays no SUI; the payment IS the auth)\n`);
  } else {
    console.log(`   charge gate OFF (status ${disc.status}) — deploying un-gated\n`);
    await disc.text(); // drain
  }

  // 3. tar + POST /deploy with the X-PAYMENT header. NO separate deploy-auth signature:
  //    the payment payload IS the authorization, and the recovered payer becomes the
  //    on-chain owner (whoever pays, owns).
  console.log(`③ POST /deploy (tar + X-PAYMENT)…`);
  const tarBytes = tarSite(SITE_DIR);
  const form = new FormData();
  form.set("name", SITE_NAME);
  form.set("site.tar", new Blob([tarBytes as BlobPart], { type: "application/x-tar" }), "site.tar");
  const dr = await fetch(`${BACKEND}/deploy`, {
    method: "POST",
    headers: xPayment ? { "X-PAYMENT": xPayment } : {},
    body: form,
  });
  const drText = await dr.text();
  let deployRes: DeployResponse & { error?: string };
  try { deployRes = JSON.parse(drText); } catch { deployRes = { error: drText } as any; }
  if (!dr.ok) die(`POST /deploy → ${dr.status}: ${deployRes.error ?? drText}`);

  // 5. result
  console.log(`\n✓ DEPLOYED — the full x402 V2 Deploy loop, on-chain:\n`);
  console.log(JSON.stringify({
    siteId: deployRes.siteId,
    url: deployRes.url,
    deployDigest: deployRes.digest,
  }, null, 2));
  console.log("");
};

main().catch((e) => die(e?.message ?? String(e)));
