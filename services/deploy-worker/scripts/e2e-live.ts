// T-004 LIVE E2E — one REAL testnet run through the worker charge door:
//   1. POST /deploy (no payment)  → 402 with months-priced terms
//   2. pay the terms (gasless send_funds, payer signs locally) → site LIVE
//   3. serve check (Host-header route through the dev worker; aggregator fallback)
//   4. POST /extend (pay 1 month) → paid_until bumped on-chain
//   5. REPLAY the extend X-PAYMENT → 409 (EDigestUsed — the Move replay wall)
//   6. REPLAY the deploy X-PAYMENT → 409 (one site per payment)
// Run (repo root): PAYER_KEY=suiprivkey1… SITE_TAR=/path/site.tar WORKER_URL=http://127.0.0.1:8802 \
//   bun run services/deploy-worker/scripts/e2e-live.ts
// (both wrangler devs up: facilitator 8801, worker 8802 — or point WORKER_URL at prod)
import { grpcClient, buildGaslessOutputs } from "@suize/x402";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { fromBase64 } from "@mysten/sui/utils";
import { readFileSync } from "node:fs";

const WORKER = (process.env.WORKER_URL ?? "http://127.0.0.1:8802").replace(/\/$/, "");


// PAYER_KEY inline, or PAYER_KEY_FILE (a path — keeps the key off stdout/history).
const payerKey = (
  process.env.PAYER_KEY ?? (process.env.PAYER_KEY_FILE ? readFileSync(process.env.PAYER_KEY_FILE, "utf8") : "")
).trim();
const kp = Ed25519Keypair.fromSecretKey(payerKey);
const payer = kp.toSuiAddress();
const tarBytes = readFileSync(process.env.SITE_TAR!);
const client = grpcClient("sui:testnet");

let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

/** Pay a 402: build the gasless PTB from the challenge's own terms, sign, return the header. */
const payChallenge = async (challenge: any): Promise<{ header: string; accepted: any }> => {
  const accepted = challenge.accepts[0];
  const outputs = accepted.extra.outputs;
  const { bytes } = await buildGaslessOutputs({ client, sender: payer, asset: accepted.asset, outputs });
  const { signature } = await kp.signTransaction(fromBase64(bytes));
  const payload = { x402Version: 2, accepted, payload: { signature, transaction: bytes } };
  return { header: btoa(JSON.stringify(payload)), accepted };
};

// ── 1. discovery: 402 with 2-month pricing ($0.20) ───────────────────────────
const disc = await fetch(`${WORKER}/deploy?months=2`, { method: "POST" });
const challenge = (await disc.json()) as any;
check("discovery answers 402", disc.status === 402);
check(
  "2-month quote is $0.20 (200000 atomic)",
  challenge?.accepts?.[0]?.amount === "200000",
  `amount=${challenge?.accepts?.[0]?.amount}`,
);
const outs = challenge?.accepts?.[0]?.extra?.outputs ?? [];
check("terms declare a fee split (2 outputs)", outs.length === 2, JSON.stringify(outs));
if (disc.status !== 402) process.exit(1);

// ── 2. pay + deploy ───────────────────────────────────────────────────────────
const paid = await payChallenge(challenge);
const form = new FormData();
form.append("name", "t004-e2e");
form.append("site.tar", new Blob([tarBytes]), "site.tar");
const dep = await fetch(`${WORKER}/deploy?months=2`, {
  method: "POST",
  headers: { "X-PAYMENT": paid.header },
  body: form,
});
const site = (await dep.json()) as any;
check("paid deploy returns 200", dep.status === 200, dep.status !== 200 ? JSON.stringify(site).slice(0, 300) : "");
if (dep.status !== 200) process.exit(1);
console.log(`      site ${site.siteId}\n      url  ${site.url}\n      digest ${site.digest}\n      paidUntil ${new Date(site.paidUntilMs).toISOString()} · storageEndEpoch ${site.storageEndEpoch}`);
check("owner-visible paid window ≈ 2 months", Math.abs(site.paidUntilMs - Date.now() - 2 * 2_592_000_000) < 60_000);

// ── 3. serve check — the PUBLIC url through the deployed worker. A cold Walrus
// read is a multi-second sliver reconstruct; retry a few times. (Requires the
// worker deployed on the suize.site route; wrangler dev pins the Host and can't
// route subdomains — set SKIP_SERVE=1 to skip in a pure-local run.)
let served = false;
if (process.env.SKIP_SERVE === "1") {
  console.log("skip  serve check (SKIP_SERVE=1)");
  served = true;
} else {
  for (let i = 0; i < 5 && !served; i++) {
    try {
      const res = await fetch(site.url);
      const body = await res.text();
      served = res.status === 200 && body.includes("paid-and-published");
      if (!served) await new Promise((r) => setTimeout(r, 6000));
    } catch {
      await new Promise((r) => setTimeout(r, 6000));
    }
  }
  check("site SERVES at its public URL", served, site.url);
}

// ── 4. paid extend (+1 month) ─────────────────────────────────────────────────
const extDisc = await fetch(`${WORKER}/extend?site=${site.siteId}&months=1`, { method: "POST" });
const extChallenge = (await extDisc.json()) as any;
check("extend discovery answers 402 at $0.10", extDisc.status === 402 && extChallenge?.accepts?.[0]?.amount === "100000");

const extPaid = await payChallenge(extChallenge);
const ext = await fetch(`${WORKER}/extend?site=${site.siteId}&months=1`, {
  method: "POST",
  headers: { "X-PAYMENT": extPaid.header },
});
const extBody = (await ext.json()) as any;
check("paid extend returns 200", ext.status === 200, ext.status !== 200 ? JSON.stringify(extBody).slice(0, 300) : "");
// +1 month RELATIVE to the site's current paid-through (v4 extend_site adds a
// duration on-chain; base = max(now, paid_until)). The site is not lapsed, so
// base = its paidUntilMs and the result is +1 month exactly.
check(
  "paid_until extended by exactly +1 month",
  extBody.paidUntilMs === site.paidUntilMs + 2_592_000_000,
  `now ${extBody.paidUntilMs} vs ${site.paidUntilMs}`,
);
const extendedPaidUntil = extBody.paidUntilMs;

// ── 5. REPLAY the extend payment → IDEMPOTENT SUCCESS (the money-safety fix).
// A retried settled payment must NEVER strand or double-charge: gatePayment
// recovers (already-executed), settle is idempotent, extend_site aborts
// EDigestUsed (digest consumed), and the route returns the ALREADY-APPLIED state
// (200, same paid_until — NOT bumped again, NOT a 402 "pay again").
const replay = await fetch(`${WORKER}/extend?site=${site.siteId}&months=1`, {
  method: "POST",
  headers: { "X-PAYMENT": extPaid.header },
});
const replayBody = (await replay.json()) as any;
check(
  "replayed extend is IDEMPOTENT (200, paid_until unchanged — no double-extend, no strand)",
  replay.status === 200 && replayBody.paidUntilMs === extendedPaidUntil,
  `status=${replay.status} paidUntil=${replayBody.paidUntilMs} (expected ${extendedPaidUntil})`,
);

// ── 6. REPLAY the deploy payment → IDEMPOTENT RECOVERY (same site, not a 2nd
// mint, not a strand). The digest already minted site S; the retry recovers S
// via the on-chain digest→site trail and returns it (recovered:true, same id).
const form2 = new FormData();
form2.append("name", "t004-e2e-replay");
form2.append("site.tar", new Blob([tarBytes]), "site.tar");
const replayDep = await fetch(`${WORKER}/deploy?months=2`, {
  method: "POST",
  headers: { "X-PAYMENT": paid.header },
  body: form2,
});
const replayDepBody = (await replayDep.json()) as any;
check(
  "replayed deploy RECOVERS the same site (200, recovered, same id — no double-mint)",
  replayDep.status === 200 && replayDepBody.recovered === true && replayDepBody.siteId === site.siteId,
  `status=${replayDep.status} siteId=${replayDepBody.siteId} (expected ${site.siteId})`,
);

console.log(failures === 0 ? "\nT-004 LIVE E2E: ALL GREEN" : `\nT-004 LIVE E2E: ${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
