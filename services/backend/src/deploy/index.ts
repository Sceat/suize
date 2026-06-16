// Deploy module — "Suize Deploy" (Vercel for Sui). The ORCHESTRATION BRAIN.
//
// POST /deploy is AUTHENTICATED BY THE PAYMENT ITSELF (nonce-free since 2026-06-14).
// There is NO anonymous deploy and NO separate deploy-auth signature: the X-PAYMENT
// header carries a signed gasless payment, and the RECOVERED PAYER becomes the on-chain
// `owner` — whoever pays, owns. The payment payload IS the private signed authorization,
// so a caller can only ever set THEMSELVES (the address that paid) as the owner. The
// recovery dispatches by signature scheme (zkLogin, plain Ed25519, OR a 1-of-2
// sub-account MultiSig — the multisig address is recovered), so a detached-agent deploy
// paying FROM a sub-account is owned BY that sub-account.
//
// TWO DOORS, ONE WIRE: the agent signs the payment itself — with its own Sui key (the
// Sui-aware door) or its Suize zkLogin session via the MCP (the Suize door). Both submit
// the SAME X-PAYMENT; owner = the recovered payer. There is NO human/relay path.
//
// A deployer POSTs a built static site as a tar (+ the X-PAYMENT header); this module:
//   0. VERIFIES the X-PAYMENT pays the exact $0.50 to the Deploy treasury and recovers
//      the payer (→ `owner`); there is no client-claimed `owner` and no service-wallet
//      fallback,
//   1. unpacks the tar in-memory, enforcing size + file-count caps,
//   2. SETTLES the verified payment (keyless gRPC) BEFORE any Walrus spend,
//   3. uploads ALL files as ONE Walrus quilt via the HTTP publisher (the publisher
//      pays WAL; the deploy wallet only pays the on-chain create_site gas) + a manifest
//      JSON (path -> {patch, sha256, ct, size}) stored as a Walrus blob,
//   4. mints a FRESH on-chain
//      `deploy_sui::site::Site` (signed by the deploy service wallet — NOT
//      Enoki-sponsored; the agent signs nothing), with the recovered payer as `owner`
//      and the settled payment digest recorded in the on-chain SiteDigestRegistry (the
//      atomic one-site-per-payment guard — a duplicate aborts EDigestUsed → 409),
//   5. returns { siteId, subdomain: base36(siteId), url, version: 1, digest }.
//
// Every deploy mints a NEW immutable Site (new id -> new URL) — there is no
// overwrite path. Custom domains are linked via a DNS-TXT challenge + on-chain
// `domain_registry::link_domain`, with an optional Cloudflare-for-SaaS auto-SSL
// adapter.
//
// 503s cleanly (like the handle module) when DEPLOY_WALLET_PRIVATE_KEY is unset,
// so the rest of the backend boots before the deploy wallet is provisioned.
import { createHash, randomBytes } from "node:crypto";
import { resolveTxt, resolveCname, resolve as resolveDns } from "node:dns/promises";
import type { Server } from "bun";
import { parseTar, type ParsedTarFileItem } from "nanotar";
import { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import { fromBase64 } from "@mysten/sui/utils";
import { verifyPersonalMessageSignature } from "@mysten/sui/verify";
import {
  PACKAGE_IDS,
  buildDeployLinkAuthMessage,
  buildDeployUnlinkAuthMessage,
} from "@suize/shared";
import type {
  DeployResponse,
  SiteInfo,
  DomainChallengeResponse,
} from "@suize/shared";
import { config } from "../config";
import { json, getIp } from "../http";
import { deployDailyCeiling } from "../quota";
import { encodeObjectIdToBase36 } from "./base36";
import { contentTypeFor } from "./content-type";
import { storeQuilt, storeBlob, WalrusError, type QuiltInputFile } from "./walrus";
// x402 V2 first-party charge gate (account.move DEAD): the payer signs a gasless
// send_funds PTB, this process verifies + settles it keyless. See deploy/payment.ts.
import {
  chargeGateReady,
  deployRequirements,
  gateDeployPayment,
  settleDeployPayment,
  DeployPaymentError,
  chargeInfo,
  type VerifiedDeployPayment,
} from "./payment";
import { extendOnce, storageEndForSite, epochToMs } from "./extend";
import { deploySubs, isValidDeploySub, hasValidDeploySub } from "./subs-state";
import { handleSubscribeBuild, handleSubscribeSubmit } from "./subscribe";
import {
  cloudflareEnabled,
  provisionCustomHostname,
  removeCustomHostname,
  customHostnameSslStatus,
} from "./cloudflare";

// ---------------------------------------------------------------------------
// Configuration gate. The module is ENABLED only when the deploy service wallet
// key is present; until then every op returns a clear 503 so the backend boots
// before the wallet is provisioned (mirrors the handle module's gate).
// ---------------------------------------------------------------------------

const DEPLOY_ENABLED = Boolean(config.deployWalletKey);

// The on-chain ids are PLACEHOLDERS ('0x0') until `deploy_sui` is published
// (see @suize/shared + SPEC §13). Even when the wallet key is set, real deploys
// cannot run against a 0x0 package — we detect that and 503 with a precise reason
// rather than building a doomed PTB.
const DEPLOY_PACKAGE: string = PACKAGE_IDS.DEPLOY.PACKAGE;
const VERSION_OBJECT: string = PACKAGE_IDS.DEPLOY.VERSION_OBJECT;
const DOMAIN_REGISTRY_OBJECT: string = PACKAGE_IDS.DEPLOY.DOMAIN_REGISTRY_OBJECT;
// The shared SiteDigestRegistry — the on-chain one-site-per-payment dedup set.
// create_site records the deploy's payment digest here + aborts EDigestUsed on a
// duplicate (the multi-replica-safe consume guard; replaces the in-memory map).
const SITE_DIGEST_REGISTRY_OBJECT: string =
  PACKAGE_IDS.DEPLOY.SITE_DIGEST_REGISTRY_OBJECT;
// The owned DeployerCap — create_site's mint authority (the FIRST moveCall arg). Only
// the deploy service wallet (which owns it) can mint a Site, so owner/size/blob-ids are
// service-attested (no free-mint, no renewer-draining forged Site). Mainnet '0x0' until
// the cap is transferred to the prod service wallet → deploy stays disabled there.
const DEPLOYER_CAP_OBJECT: string = PACKAGE_IDS.DEPLOY.DEPLOYER_CAP_OBJECT;
const CHAIN_IDS_PUBLISHED =
  DEPLOY_PACKAGE !== "0x0" &&
  VERSION_OBJECT !== "0x0" &&
  DOMAIN_REGISTRY_OBJECT !== "0x0" &&
  SITE_DIGEST_REGISTRY_OBJECT !== "0x0" &&
  DEPLOYER_CAP_OBJECT !== "0x0";

const notConfigured = (origin: string | null): Response =>
  json(
    {
      error: DEPLOY_ENABLED
        ? "deploy package not yet published (placeholder on-chain ids)"
        : "deploy not configured",
    },
    503,
    origin,
  );

// ---------------------------------------------------------------------------
// Limits — abuse mitigation until payments gate the open route.
// ---------------------------------------------------------------------------

const MAX_BUNDLE_BYTES = 100 * 1024 * 1024; // 100 MiB total tar — generous for a static site.
const MAX_FILE_COUNT = 2000;                // file entries in the bundle.
const MAX_NAME_LEN = 64;                    // site label length cap.

// The per-deploy receipt file injected into every bundle (unique bytes → Walrus
// can never dedup the quilt; see the injection block in handleDeploy). RESERVED:
// a user file at this path is dropped and replaced.
const DEPLOY_RECEIPT_PATH = "/.suize/deploy.json";

// ---------------------------------------------------------------------------
// Per-IP token bucket — same pattern as the sponsor/handle modules. Deploys are
// far heavier than a sponsor call, so the bucket is tight (a deploy is rare).
// ---------------------------------------------------------------------------

const RATE_LIMIT_CAPACITY = 4;        // burst
const RATE_LIMIT_REFILL_PER_SEC = 0.2; // sustained — ~1 deploy / 5s steady state
type Bucket = { tokens: number; last: number };
const buckets = new Map<string, Bucket>();

const takeToken = (key: string | null): boolean => {
  if (!key) return true;
  const now = Date.now();
  const b = buckets.get(key) ?? { tokens: RATE_LIMIT_CAPACITY, last: now };
  const elapsed = (now - b.last) / 1000;
  b.tokens = Math.min(RATE_LIMIT_CAPACITY, b.tokens + elapsed * RATE_LIMIT_REFILL_PER_SEC);
  b.last = now;
  if (b.tokens < 1) {
    buckets.set(key, b);
    return false;
  }
  b.tokens -= 1;
  buckets.set(key, b);
  return true;
};

setInterval(() => {
  const cutoff = Date.now() - 120_000;
  for (const [k, b] of buckets) if (b.last < cutoff) buckets.delete(k);
}, 120_000).unref?.();

// ---------------------------------------------------------------------------
// Clients — lazy singletons (the module imports cleanly when not configured).
// ---------------------------------------------------------------------------

const SUI_ADDRESS_RE = /^0x[0-9a-fA-F]{64}$/;
// A custom domain: a conservative hostname (labels of [a-z0-9-], 1+ dots, no
// scheme/port/path). Apex or sub — the worker resolves whatever string is stored.
const DOMAIN_RE = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

let _suiClient: SuiJsonRpcClient | null = null;
let _wallet: Ed25519Keypair | null = null;

const suiClient = (): SuiJsonRpcClient => {
  if (!_suiClient) _suiClient = new SuiJsonRpcClient({ url: config.suiRpcUrl, network: config.suiNetwork });
  return _suiClient;
};

const wallet = (): Ed25519Keypair => {
  if (!_wallet) _wallet = Ed25519Keypair.fromSecretKey(config.deployWalletKey!);
  return _wallet;
};

const serviceAddress = (): string => wallet().toSuiAddress();

// ---------------------------------------------------------------------------
// Tagged error -> HTTP status (mirrors SponsorError / HandleError).
// ---------------------------------------------------------------------------

class DeployError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "DeployError";
  }
}

const sha256Hex = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");

const subdomainFor = (siteId: string): string => encodeObjectIdToBase36(siteId);
const urlFor = (siteId: string): string =>
  `https://${subdomainFor(siteId)}.${config.deployBaseDomain}`;

// ---------------------------------------------------------------------------
// Path normalisation. The tar carries arbitrary entry names; we normalise each
// to a served path ("/index.html"), reject traversal/absolute escapes, and
// derive a UNIQUE quilt-patch identifier (the multipart part name we send to the
// publisher) by flattening the served path. Directories / non-files are skipped.
// ---------------------------------------------------------------------------

interface NormalizedFile {
  servedPath: string;   // "/index.html"
  identifier: string;   // unique flattened basename for the quilt patch
  data: Uint8Array;
}

/** Flatten "/assets/app.js" -> "assets__app.js" so quilt identifiers are unique + filesystem-safe. */
const identifierFor = (servedPath: string): string =>
  servedPath.replace(/^\//, "").replace(/\//g, "__") || "index.html";

const normalizeEntries = (
  entries: ParsedTarFileItem[],
): NormalizedFile[] => {
  const out: NormalizedFile[] = [];
  const seenIds = new Set<string>();

  for (const e of entries) {
    // nanotar marks directories as type "directory"; skip those + any non-file
    // entry (symlinks/devices) and any entry without data.
    if (e.type && e.type !== "file" && e.type !== "contiguousFile") continue;
    if (!e.data || e.data.length === 0 && e.name.endsWith("/")) continue;

    // Normalise the entry name to a served path.
    let name = e.name.replace(/\\/g, "/").trim();
    if (!name || name.endsWith("/")) continue;             // directory marker
    name = name.replace(/^\.\//, "").replace(/^\/+/, "");  // strip "./" + leading slash
    if (name.split("/").some((seg) => seg === "..")) {
      throw new DeployError(`unsafe path in bundle: ${e.name}`, 400);
    }
    // Common case: a built site is tarred with a top-level "dist/" or "build/"
    // folder. We keep the structure as-is (the SPA fallback handles routing); the
    // served path is the full normalised path under root.
    const servedPath = `/${name}`;

    const data = e.data ?? new Uint8Array(0);
    let identifier = identifierFor(servedPath);
    // Defend against a collision after flattening (e.g. "a/b" vs "a__b").
    let n = 1;
    while (seenIds.has(identifier)) identifier = `${identifierFor(servedPath)}.${n++}`;
    seenIds.add(identifier);

    out.push({ servedPath, identifier, data });
  }
  return out;
};

// ---------------------------------------------------------------------------
// On-chain: build + sign + execute the create_site PTB. The Site is a SHARED
// object (the worker reads it); the returned SiteAdminCap is transferred to the
// service wallet (for later domain ops). Payment is settled (the x402 gasless
// send_funds in deploy/payment.ts) IMMEDIATELY before this runs, and the settled
// digest is threaded in as `paymentDigest` — create_site records it in the shared
// SiteDigestRegistry and aborts EDigestUsed on a duplicate (the atomic, multi-replica-
// safe one-site-per-payment guard; the chain is the database — no in-process map). We
// parse the created Site object id out of objectChanges.
// ---------------------------------------------------------------------------

interface CreatedSite {
  siteId: string;
  digest: string;
}

const createSiteOnChain = async (
  name: string,
  owner: string,
  quiltId: string,
  manifestBlobId: string,
  manifestHashHex: string,
  quiltBlobObject: string,
  manifestBlobObject: string,
  sizeBytes: number,
  fileCount: number,
  // The deploy's one-site-per-payment key: the settled payment digest (the ONE door —
  // an X-PAYMENT payload, self-paid or relayed via the pay-link). create_site records
  // it in the on-chain SiteDigestRegistry + aborts EDigestUsed on a duplicate. It is
  // the base58 tx-digest STRING, so we key the registry on its UTF-8 bytes — stable +
  // unique per deploy, no base58/hex decode to get wrong.
  paymentDigest: string,
): Promise<CreatedSite> => {
  const tx = new Transaction();
  const manifestHashBytes = Uint8Array.from(Buffer.from(manifestHashHex, "hex"));
  const paymentDigestBytes = new TextEncoder().encode(paymentDigest);

  // create_site(v: &Version, reg: &mut SiteDigestRegistry, payment_digest: vector<u8>,
  //   name: String, owner: address, quilt_id: String, manifest_blob_id: String,
  //   manifest_hash: vector<u8>, quilt_blob_object: ID, manifest_blob_object: ID,
  //   size_bytes: u64, file_count: u64, ctx): SiteAdminCap
  // The registry + digest are the atomic on-chain dedup (multi-replica-safe). The two
  // blob OBJECT ids (owned by the service wallet via send_object_to) are recorded
  // on-chain so the storage extender knows WHICH Walrus objects to extend.
  // size_bytes/file_count are recorded so the read endpoints surface real metrics.
  const cap = tx.moveCall({
    target: PACKAGE_IDS.DEPLOY.TARGETS.CREATE_SITE,
    arguments: [
      tx.object(DEPLOYER_CAP_OBJECT), // mint authority — the gate; first param `_deployer`
      tx.object(VERSION_OBJECT),
      tx.object(SITE_DIGEST_REGISTRY_OBJECT),
      tx.pure.vector("u8", paymentDigestBytes),
      tx.pure.string(name),
      tx.pure.address(owner),
      tx.pure.string(quiltId),
      tx.pure.string(manifestBlobId),
      tx.pure.vector("u8", manifestHashBytes),
      tx.pure.id(quiltBlobObject),
      tx.pure.id(manifestBlobObject),
      tx.pure.u64(sizeBytes),
      tx.pure.u64(fileCount),
    ],
  });

  // create_site RETURNS the SiteAdminCap (composable style — it does NOT transfer it
  // internally), so the PTB must take ownership or it fails resolution with
  // UnusedValueWithoutDrop. Send it to the deploy service wallet (the signer), which
  // holds the cap for later domain ops.
  tx.transferObjects([cap], wallet().toSuiAddress());

  let res;
  try {
    res = await suiClient().signAndExecuteTransaction({
      transaction: tx,
      signer: wallet(),
      options: { showObjectChanges: true, showEffects: true },
    });
  } catch (err) {
    throw new DeployError(`create_site failed: ${(err as Error).message}`, 502);
  }

  if (res.effects?.status?.status === "failure") {
    const abortErr = res.effects.status.error ?? "unknown";
    // EDigestUsed (site.move code 0): this payment digest already minted a Site —
    // the on-chain one-site-per-payment guard fired (a retry that landed here after
    // the first mint already committed, or a double-submit). Surface 409, the
    // multi-replica-safe replacement for the old in-memory settledDeploys 409. The
    // SDK formats a MoveAbort as e.g.
    //   MoveAbort(MoveLocation { ... name: Identifier("site") ... }, 0) in command 0
    // so we match the `site` module + the `, <code>)` abort code 0.
    if (/MoveAbort\b/.test(abortErr) && /Identifier\("site"\)/.test(abortErr) && /,\s*0\)/.test(abortErr)) {
      throw new DeployError("payment already used for a deploy", 409);
    }
    throw new DeployError(`create_site aborted: ${abortErr}`, 502);
  }

  const siteType = `${DEPLOY_PACKAGE}::site::Site`;
  const created = (res.objectChanges ?? []).find(
    (c): c is Extract<typeof c, { type: "created" }> =>
      c.type === "created" && c.objectType === siteType,
  );
  if (!created) {
    throw new DeployError("create_site: Site object not found in tx effects", 502);
  }

  // Confirm finality before we hand back a URL the worker will immediately read —
  // bounded, and LOUD on failure. Deliberately non-fatal: the mint already
  // succeeded (effects checked above), so throwing here would tell the caller a
  // live Site failed — and release a charge that already paid for it.
  try {
    await suiClient().waitForTransaction({ digest: res.digest, timeout: 15_000 });
  } catch {
    console.warn(
      `[deploy] create_site ${res.digest} executed but not yet indexed after 15s — ` +
        `the returned URL may 404 briefly while the worker's fullnode catches up`,
    );
  }

  return { siteId: created.objectId, digest: res.digest };
};

// ---------------------------------------------------------------------------
// POST /deploy — the one-call deploy flow. AUTHENTICATED BY THE PAYMENT ITSELF.
//
// Every deploy carries the X-PAYMENT header (a signed gasless payment). The backend
// VERIFIES it pays the exact $0.50 to the Deploy treasury and recovers the payer; the
// recovered payer IS the on-chain `owner` — there is no client-claimed `owner` field,
// no separate deploy-auth signature, and no service-wallet fallback, so a caller can
// only ever set THEMSELVES (the address that paid) as owner. Whoever pays, owns.
// Missing payment (gate live) → 402 with a fresh x402 challenge; no anonymous deploy.
// ---------------------------------------------------------------------------

const handleDeploy = async (req: Request, origin: string | null, server?: Server<unknown>): Promise<Response> => {
  if (!DEPLOY_ENABLED || !CHAIN_IDS_PUBLISHED) return notConfigured(origin);

  const ip = getIp(req, server);
  if (!takeToken(ip)) return json({ error: "too many requests" }, 429, origin, { "Retry-After": "5" });

  // GAS-DRAIN CEILING (M4) — every deploy mints an on-chain Site paid by the
  // deploy wallet's real SUI. A process-global daily cap (keyed by the trusted
  // IP — falls back to a fixed key so an unknown-IP request still counts against
  // the global budget) caps total spend even if the per-IP bucket is evaded by IP
  // rotation. Hit the ceiling → 429 BEFORE any chain/Walrus work.
  if (!deployDailyCeiling.consume(ip ?? "deploy:unknown-ip").ok) {
    return json({ error: "deploy capacity reached, try again later" }, 429, origin, { "Retry-After": "60" });
  }

  // Reject an oversized body up front via Content-Length (the multipart parse
  // would otherwise buffer the whole tar before we could cap it).
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > MAX_BUNDLE_BYTES) return json({ error: "bundle too large" }, 413, origin);

  // ── x402 V2 PAYMENT GATE — is the charge join live? ─────────────────────────
  // When the Deploy treasury (fee_recipient) resolves, every deploy is a one-off
  // $0.50 settlement on the rail FIRST: a payment-less POST /deploy answers 402
  // with the x402 V2 PaymentRequired body (+ PAYMENT-REQUIRED header) BEFORE any
  // auth demand, so a generic agent discovers the price zero-shot. The paid retry
  // carries the signed gasless payment in the X-PAYMENT header. When the gate is
  // OFF (treasury unresolved) the deploy runs un-gated (auth + rate limits + the
  // gas-drain ceiling only) — the documented "abuse mitigation, not billing" mode.
  const gateLive = await chargeGateReady();
  const proto = req.headers.get("x-forwarded-proto");

  // PREMIUM QUOTE: an agent may hint its paying address via `?sender=` so the 402
  // self-describes the discounted $0.10 rate when that address holds an active Deploy
  // subscription. Advisory only — gateDeployPayment RE-checks premium against the
  // RECOVERED payer, so this quote can never under-bill a non-subscriber.
  let premiumQuote = false;
  try {
    const senderHint = new URL(req.url).searchParams.get("sender");
    if (senderHint && SUI_ADDRESS_RE.test(senderHint)) {
      premiumQuote = await hasValidDeploySub(senderHint);
    }
  } catch {
    premiumQuote = false;
  }

  // Answer the x402 V2 402 with the PaymentRequired body + the PAYMENT-REQUIRED
  // header. Returns null when the treasury is unresolved (caller stays un-gated).
  const challenge402 = async (errorOverride?: string): Promise<Response | null> => {
    const body = await deployRequirements(req.url, proto, premiumQuote);
    if (!body) return null;
    if (errorOverride) body.error = errorOverride;
    return json(body, 402, origin, {
      "PAYMENT-REQUIRED": Buffer.from(JSON.stringify(body), "utf8").toString("base64"),
    });
  };

  // The signed gasless x402 payment (b64 PaymentPayload) — the deploy's SOLE
  // authorization. Absent on the discovery shot. The agent signs it ITSELF: with its
  // own Sui key (the Sui-aware door) or its Suize zkLogin session via the MCP (the Suize
  // door). There is no human/relay path — whoever signs the payment owns the site.
  let payHeader = (req.headers.get("X-PAYMENT") ?? req.headers.get("PAYMENT-SIGNATURE") ?? "").trim();

  // ── PAYMENT GATE, leg 1: presence — public price discovery ───────────────────
  // A payment-less POST /deploy answers 402 (the zero-shot entry point), not a 400.
  // No payment → no deploy. The verify runs after input validation, immediately before
  // the paid work.
  if (gateLive && !payHeader) {
    const c = await challenge402();
    if (c) return c;
  }

  // ── parse multipart ────────────────────────────────────────────────────────
  // A caller with NO parsable body and NO payment header is an agent discovering
  // the price — answer the 402 (handled above; here a broken body with no payment is
  // also a fresh challenge). With a payment header present, a broken body is a real
  // client error.
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    if (gateLive && !payHeader) {
      const c = await challenge402();
      if (c) return c;
    }
    return json({ error: "invalid multipart body" }, 400, origin);
  }

  const name = String(form.get("name") ?? "").trim();
  if (!name || name.length > MAX_NAME_LEN) {
    return json({ error: "missing or oversized 'name' field" }, 400, origin);
  }

  // ── AUTHENTICATION = the payment ────────────────────────────────────────────
  // VERIFY (simulate-only — no settle yet) the X-PAYMENT pays the exact $0.50 to the
  // Deploy treasury; the recovered payer IS the on-chain `owner` (whoever pays, owns).
  // There is no separate deploy-auth signature and no client-claimed owner — the
  // payment payload is the private signed authorization. When the gate is OFF (treasury
  // unresolved) the deploy runs un-gated and `owner` is the service wallet (the
  // documented "abuse mitigation, not billing" mode — no real owner attribution).
  let owner: string;
  let verifiedPayment: VerifiedDeployPayment | null = null;
  if (gateLive) {
    try {
      // Pass hasValidDeploySub → a subscriber's payment may carry the $0.10 rate
      // (verified against their on-chain sub); everyone else pays the flat $0.50.
      verifiedPayment = await gateDeployPayment(payHeader, hasValidDeploySub);
    } catch (err) {
      if (err instanceof DeployPaymentError) {
        if (err.challenge) {
          const c = await challenge402(err.message);
          if (c) return c;
        }
        return json({ error: err.message }, err.status, origin);
      }
      throw err;
    }
    owner = verifiedPayment.payer;
  } else {
    owner = serviceAddress();
  }

  const badInput = (message: string, status: number): Response =>
    json({ error: message }, status, origin);

  const file = form.get("site.tar");
  if (!(file instanceof File)) return badInput("missing 'site.tar' file", 400);

  const tarBytes = new Uint8Array(await file.arrayBuffer());
  if (tarBytes.byteLength === 0) return badInput("empty 'site.tar'", 400);
  if (tarBytes.byteLength > MAX_BUNDLE_BYTES) return badInput("bundle too large", 413);

  // ── unpack + validate ────────────────────────────────────────────────────────
  let files: NormalizedFile[];
  try {
    files = normalizeEntries(parseTar(tarBytes));
  } catch (err) {
    if (err instanceof DeployError) return badInput(err.message, err.status);
    return badInput(`unreadable tar: ${(err as Error).message}`, 400);
  }
  if (files.length === 0) return badInput("no files in bundle", 400);
  if (files.length > MAX_FILE_COUNT) {
    return badInput(`too many files (max ${MAX_FILE_COUNT})`, 400);
  }

  // ── deploy receipt (dedup salt) ──────────────────────────────────────────────
  // Inject ONE extra file into every bundle: a tiny JSON receipt whose bytes are
  // UNIQUE per deploy (wall-clock ms + a fresh CSPRNG salt). Identical site bundles
  // would otherwise dedup on Walrus (`alreadyCertified` — no new Blob OBJECT, nothing
  // for the relayer to own/extend); the unique receipt guarantees `newlyCreated` every
  // time. It IS served (at /.suize/deploy.json) — that's fine and documented; it's
  // counted in the manifest/size/file-count like any user file. The reserved path is
  // OURS: a user file at it is dropped first.
  files = files.filter((f) => f.servedPath !== DEPLOY_RECEIPT_PATH);
  const receiptBytes = new TextEncoder().encode(
    // A fresh per-deploy salt (the on-chain digest dedup lives in create_site now, so
    // the receipt only needs to be byte-unique for Walrus, not carry the auth token).
    JSON.stringify({ deployedAt: Date.now(), owner, salt: randomBytes(16).toString("hex") }),
  );
  let receiptId = identifierFor(DEPLOY_RECEIPT_PATH);
  // Defend against an identifier collision after flattening (mirrors normalizeEntries).
  const takenIds = new Set(files.map((f) => f.identifier));
  let rn = 1;
  while (takenIds.has(receiptId)) receiptId = `${identifierFor(DEPLOY_RECEIPT_PATH)}.${rn++}`;
  files.push({ servedPath: DEPLOY_RECEIPT_PATH, identifier: receiptId, data: receiptBytes });

  const totalBytes = files.reduce((n, f) => n + f.data.byteLength, 0);
  if (totalBytes > MAX_BUNDLE_BYTES) return badInput("bundle too large", 413);

  // ── build the quilt parts in-memory (the HTTP publisher takes bytes directly) ─
  try {
    const quiltInputs: QuiltInputFile[] = [];
    // path -> manifest entry (filled with patch ids after the quilt upload).
    const fileMeta: Record<string, { sha256: string; ct: string; size: number }> = {};

    for (const f of files) {
      const ct = contentTypeFor(f.servedPath);
      // The publisher uses the multipart part NAME as the quilt-patch identifier;
      // we send each file under its unique flattened identifier so identifiers are
      // unique + we can map them back to served paths.
      quiltInputs.push({
        servedPath: f.servedPath,
        identifier: f.identifier,
        data: f.data,
        contentType: ct,
      });
      fileMeta[f.servedPath] = {
        sha256: sha256Hex(f.data),
        ct,
        size: f.data.byteLength,
      };
    }

    // ── 0. SETTLE the payment FIRST — before ANY Walrus spend ───────────────────
    // Settle the verified payment (keyless gRPC, idempotent by digest) BEFORE the Walrus
    // upload, so an unsettled/failed payment never burns WAL. A settle that succeeds but
    // then fails at the Walrus/mint steps retries idempotently (the SAME X-PAYMENT
    // re-settles from chain; EDigestUsed has NOT fired, since no Site minted yet). The
    // settled digest threads into create_site's on-chain one-site-per-payment registry.
    // Un-gated mode (no payment) keys the registry on a fresh per-deploy salt.
    const tStart = Date.now();
    const paymentDigest = verifiedPayment
      ? await settleDeployPayment(verifiedPayment)
      : `ungated-${Date.now()}-${randomBytes(8).toString("hex")}`;
    const tSettle = Date.now();

    // ── 1. upload ALL files as one quilt ────────────────────────────────────────
    // The Blob OBJECT is transferred to the service wallet (send_object_to) so the
    // storage extender can later `extend_blob` it; its id is recorded on the Site.
    const { quiltId, patchIds, quiltBlobObject } = await storeQuilt(quiltInputs, serviceAddress());
    const tQuilt = Date.now();

    // ── 2. build the manifest (SPEC §4) ─────────────────────────────────────────
    const manifestFiles: Record<
      string,
      { patch: string; sha256: string; ct: string; size: number }
    > = {};
    for (const f of files) {
      const meta = fileMeta[f.servedPath]!;
      manifestFiles[f.servedPath] = {
        patch: patchIds[f.servedPath]!,
        sha256: meta.sha256,
        ct: meta.ct,
        size: meta.size,
      };
    }
    const spaFallback = manifestFiles["/index.html"] ? "/index.html" : "";
    const manifest = { v: 1, spaFallback, files: manifestFiles };
    const manifestBytes = Buffer.from(JSON.stringify(manifest), "utf8");
    const manifestHashHex = sha256Hex(manifestBytes);

    // ── 3. store the manifest as a Walrus blob ──────────────────────────────────
    const { blobId: manifestBlobId, blobObject: manifestBlobObject } = await storeBlob(
      manifestBytes,
      serviceAddress(),
    );
    const tManifest = Date.now();

    // ── 4. mint the on-chain Site ───────────────────────────────────────────────
    // size_bytes/file_count are the real bundle metrics (computed above when we
    // validated the caps) — recorded on-chain so the read endpoints don't return 0.
    // `paymentDigest` is the one-site-per-payment key: a duplicate aborts EDigestUsed
    // (→ 409) at the mint, the multi-replica-safe consume guard.
    const { siteId, digest } = await createSiteOnChain(
      name,
      owner,
      quiltId,
      manifestBlobId,
      manifestHashHex,
      quiltBlobObject,
      manifestBlobObject,
      totalBytes,
      files.length,
      paymentDigest,
    );
    // Phase timing — surfaces WHERE a slow deploy spends its seconds (Walrus testnet
    // writes are the usual culprit). One line per deploy; cheap + always on.
    const t = (a: number, b: number) => `${((b - a) / 1000).toFixed(1)}s`;
    console.log(
      `[deploy] ${siteId} timing — settle ${t(tStart, tSettle)} · quilt ${t(tSettle, tQuilt)} · manifest ${t(tQuilt, tManifest)} · mint ${t(tManifest, Date.now())} · total ${t(tStart, Date.now())}`,
    );

    // ── 5. respond ──────────────────────────────────────────────────────────────
    const body: DeployResponse = {
      siteId,
      subdomain: subdomainFor(siteId),
      url: urlFor(siteId),
      version: 1,
      digest,
    };

    // ── 6. warm the serving path (fire-and-forget, never blocks the response) ───
    // One GET makes the worker resolve + verify the fresh Site and background-warm
    // every manifest entry into its edge + R2 caches (see services/deploy-worker),
    // so the first real visitor never pays the cold Walrus sliver reconstruct
    // (10s+ observed on testnet).
    void fetch(body.url, { signal: AbortSignal.timeout(30_000) }).catch(() => {});

    return json(body, 200, origin);
  } catch (err) {
    // The deploy died before (or at) the mint. The settled $0.50 is NOT stranded: the
    // payment is idempotent (doSettle re-settles from chain/cache) and the on-chain
    // dedup only consumes the digest when a Site actually mints — so the SAME X-PAYMENT
    // header can retry and re-mint. A settle failure surfaces its own status (402/503);
    // an EDigestUsed mint abort surfaces 409 (already used for a deploy).
    if (err instanceof DeployPaymentError) {
      if (err.challenge) {
        const c = await challenge402(err.message);
        if (c) return c;
      }
      return json({ error: err.message }, err.status, origin);
    }
    if (err instanceof WalrusError) return json({ error: err.message }, err.status, origin);
    if (err instanceof DeployError) return json({ error: err.message }, err.status, origin);
    console.error("[deploy]", (err as Error).message);
    return json({ error: "deploy failed" }, 500, origin);
  }
};

// ---------------------------------------------------------------------------
// Site reads — events for listing, getObject for detail. The DomainRegistry's
// per-site domains are not indexed on the Site object; the dashboard reads them
// from DomainLinked/DomainUnlinked events. For MVP, the detail endpoint surfaces
// the on-chain Site fields; `domains` is computed from events when listing.
// ---------------------------------------------------------------------------

/** SiteCreated event parsedJson — carries size/file-count (Move u64 → string). */
interface SiteCreatedJson {
  site_id?: string;
  owner?: string;
  name?: string;
  size_bytes?: string | number;
  file_count?: string | number;
}

/** Coerce a Move `u64` field (rendered as a string or number by RPC) to a JS number. */
const toNum = (v: unknown): number => {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : 0;
  return Number.isFinite(n) ? n : 0;
};

/** One owned site, distilled to what the storage auto-renewer needs. `sizeBytes` is
 * the SiteCreated event's on-chain `size_bytes` (or 0 if the field was absent — the
 * renewer treats an unreadable size conservatively against its budget, see extend.ts). */
export interface OwnedSite {
  siteId: string;
  sizeBytes: number;
}

/**
 * Every site whose on-chain `owner` == `owner` — the SAME SiteCreated-events-by-owner
 * scan the GET /sites?owner= listing uses, deduped by siteId (a SiteCreated is emitted
 * once per immutable Site, so dedupe is belt-and-suspenders). Pages newest-first up to
 * `maxPages` × 50 events. Used by the per-address storage auto-renewer (extend.ts) to
 * fan out a single owner's subscription across all that owner's sites. The `owner` is
 * compared case-insensitively (events carry the canonical `0x…` form; we lowercase both).
 */
export const sitesForOwner = async (owner: string, maxPages = 10): Promise<OwnedSite[]> => {
  const ownerLc = owner.toLowerCase();
  const out = new Map<string, OwnedSite>();
  let cursor: any = null;
  for (let page = 0; page < maxPages; page++) {
    const events = await suiClient().queryEvents({
      query: { MoveEventType: `${DEPLOY_PACKAGE}::site::SiteCreated` },
      order: "descending",
      cursor,
      limit: 50,
    });
    for (const ev of events.data) {
      const pj = ev.parsedJson as SiteCreatedJson;
      if (!pj?.site_id || String(pj.owner ?? "").toLowerCase() !== ownerLc) continue;
      if (!out.has(pj.site_id)) out.set(pj.site_id, { siteId: pj.site_id, sizeBytes: toNum(pj.size_bytes) });
    }
    if (!events.hasNextPage || events.nextCursor == null) break;
    cursor = events.nextCursor;
  }
  return [...out.values()];
};

const handleListSites = async (req: Request, url: URL, origin: string | null, server?: Server<unknown>): Promise<Response> => {
  if (!DEPLOY_ENABLED || !CHAIN_IDS_PUBLISHED) return notConfigured(origin);
  if (!takeToken(getIp(req, server))) return json({ error: "too many requests" }, 429, origin, { "Retry-After": "1" });

  const ownerFilter = (url.searchParams.get("owner") ?? "").trim();
  if (ownerFilter && !SUI_ADDRESS_RE.test(ownerFilter)) {
    return json({ error: "invalid owner address" }, 400, origin);
  }

  try {
    // Page through SiteCreated events (newest first). Filter by owner client-side
    // (the event carries `owner` in parsedJson — there's no on-chain index by
    // owner, matching SPEC §7 "read SiteCreated events, keep it simple").
    const events = await suiClient().queryEvents({
      query: { MoveEventType: `${DEPLOY_PACKAGE}::site::SiteCreated` },
      order: "descending",
      limit: 50,
    });

    const sites: SiteInfo[] = [];
    for (const ev of events.data) {
      const pj = ev.parsedJson as SiteCreatedJson;
      if (!pj?.site_id) continue;
      if (ownerFilter && pj.owner !== ownerFilter) continue;
      const siteId = pj.site_id;
      sites.push({
        siteId,
        name: pj.name ?? "",
        owner: pj.owner ?? "",
        url: urlFor(siteId),
        // size/fileCount now ride on the SiteCreated event (real on-chain values).
        sizeBytes: toNum(pj.size_bytes),
        fileCount: toNum(pj.file_count),
        createdAtMs: ev.timestampMs ? Number(ev.timestampMs) : 0,
        domains: [],
      });
    }
    return json(sites, 200, origin);
  } catch (err) {
    console.error("[deploy/sites]", (err as Error).message);
    return json({ error: "site listing unavailable" }, 502, origin);
  }
};

const handleGetSite = async (req: Request, siteId: string, origin: string | null, server?: Server<unknown>): Promise<Response> => {
  if (!DEPLOY_ENABLED || !CHAIN_IDS_PUBLISHED) return notConfigured(origin);
  if (!takeToken(getIp(req, server))) return json({ error: "too many requests" }, 429, origin, { "Retry-After": "1" });
  if (!SUI_ADDRESS_RE.test(siteId)) return json({ error: "invalid site id" }, 400, origin);

  try {
    const res = await suiClient().getObject({ id: siteId, options: { showContent: true } });
    const content = res.data?.content;
    if (!content || content.dataType !== "moveObject") {
      return json({ error: "site not found" }, 404, origin);
    }
    const fields = content.fields as Record<string, unknown>;
    const expectedType = `${DEPLOY_PACKAGE}::site::Site`;
    if (content.type !== expectedType) return json({ error: "not a Site object" }, 404, origin);

    // Linked domains + creation timestamp (from the SiteCreated event — the Move
    // struct doesn't store time) + the Walrus storage end-epoch (the binding blob's
    // end, read live; drives the dashboard's expiry/auto-renewal copy).
    const [domains, createdAtMs, storageEndEpoch, subscribed] = await Promise.all([
      domainsForSite(siteId),
      createdAtMsForSite(siteId),
      storageEndForSite(siteId),
      // Sub state through the MERCHANT SDK — drives the dashboard's "subscribed /
      // auto-renewing" copy + the custom-domain unlock affordance. PER-ADDRESS: one
      // active Deploy subscription owned by THIS site's on-chain owner unlocks every
      // site that owner holds, so we read the site owner and check subs.activeFor(owner)
      // (NOT findByRef(siteId) — the sub is no longer per-site). A read blip / unreadable
      // owner degrades to `undefined` (omitted), never a false claim of subscribed.
      (async (): Promise<boolean | undefined> => {
        const subs = await deploySubs();
        if (!subs) return undefined;
        try {
          const owner = await siteOwner(siteId);
          if (!owner || !SUI_ADDRESS_RE.test(owner)) return undefined;
          // VALID terms, not mere existence — a Subscription<Junk> or a $0.01/100yr sub
          // must NOT read subscribed (audit: subs free/underpriced-premium class).
          return (await subs.activeFor(owner)).some(isValidDeploySub);
        } catch {
          return undefined;
        }
      })(),
    ]);

    const info: SiteInfo = {
      siteId,
      name: typeof fields.name === "string" ? fields.name : "",
      owner: typeof fields.owner === "string" ? fields.owner : "",
      url: urlFor(siteId),
      // size_bytes/file_count are real on-chain Site fields (Move u64 → string).
      sizeBytes: toNum(fields.size_bytes),
      fileCount: toNum(fields.file_count),
      createdAtMs,
      domains,
      // Walrus storage lifecycle — the end-epoch + the wall-clock ms it lapses at.
      storageEndEpoch: storageEndEpoch ?? undefined,
      expiresAtMs: storageEndEpoch !== null ? epochToMs(storageEndEpoch) : undefined,
      subscribed,
    };
    return json(info, 200, origin);
  } catch (err) {
    console.error("[deploy/site]", (err as Error).message);
    return json({ error: "site read unavailable" }, 502, origin);
  }
};

/**
 * Creation timestamp (ms) for a site, from its SiteCreated event. The Move struct
 * stores no time; the event's `timestampMs` is the source. We page newest-first
 * and match `site_id` (sites are rare, so the recent window covers the detail view).
 */
const createdAtMsForSite = async (siteId: string): Promise<number> => {
  try {
    let cursor: any = null;
    for (let page = 0; page < 10; page++) {
      const events = await suiClient().queryEvents({
        query: { MoveEventType: `${DEPLOY_PACKAGE}::site::SiteCreated` },
        order: "descending",
        limit: 50,
        cursor,
      });
      for (const ev of events.data) {
        const pj = ev.parsedJson as SiteCreatedJson;
        if (pj?.site_id === siteId) return ev.timestampMs ? Number(ev.timestampMs) : 0;
      }
      if (!events.hasNextPage) break;
      cursor = events.nextCursor ?? null;
    }
  } catch (err) {
    console.error("[deploy/created-at]", (err as Error).message);
  }
  return 0;
};

/** Domains currently linked to a site, from the DomainLinked/DomainUnlinked event log. */
const domainsForSite = async (siteId: string): Promise<string[]> => {
  try {
    const [linked, unlinked] = await Promise.all([
      suiClient().queryEvents({
        query: { MoveEventType: `${DEPLOY_PACKAGE}::domain_registry::DomainLinked` },
        order: "descending",
        limit: 200,
      }),
      suiClient().queryEvents({
        query: { MoveEventType: `${DEPLOY_PACKAGE}::domain_registry::DomainUnlinked` },
        order: "descending",
        limit: 200,
      }),
    ]);
    // Latest event per domain wins (the registry is a Table keyed by domain).
    const latest = new Map<string, { site?: string; linked: boolean; ts: number }>();
    for (const ev of linked.data) {
      const pj = ev.parsedJson as { domain?: string; site_id?: string };
      if (!pj?.domain) continue;
      const ts = ev.timestampMs ? Number(ev.timestampMs) : 0;
      const prev = latest.get(pj.domain);
      if (!prev || ts >= prev.ts) latest.set(pj.domain, { site: pj.site_id, linked: true, ts });
    }
    for (const ev of unlinked.data) {
      const pj = ev.parsedJson as { domain?: string };
      if (!pj?.domain) continue;
      const ts = ev.timestampMs ? Number(ev.timestampMs) : 0;
      const prev = latest.get(pj.domain);
      if (!prev || ts >= prev.ts) latest.set(pj.domain, { linked: false, ts });
    }
    return [...latest.entries()]
      .filter(([, v]) => v.linked && v.site === siteId)
      .map(([domain]) => domain);
  } catch {
    return [];
  }
};

// ---------------------------------------------------------------------------
// Custom-domain linkage. POST /domains issues the challenge; POST /domains?verify=1
// (or { verify: true }) verifies BOTH the ownership TXT AND the routing CNAME, then
// links on-chain. DELETE /domains/:domain unlinks. LINK requires a SITE-OWNER
// SIGNATURE (the recovered signer must == Site.owner) PLUS the DNS-TXT + CNAME proof,
// so a party who controls only the DNS cannot bind the domain to a site they do not
// own (M6). UNLINK requires the SITE-OWNER SIGNATURE ONLY — no DNS proof (you may be
// unlinking precisely because you no longer control the domain's DNS); it is immediate
// (no propagation wait).
//
// TWO-RECORD GATE: verify requires TXT (ownership: `_suize-verify.<domain>` ==
// token) AND CNAME (routing: `<domain>` -> `<base36(siteId)>.<baseDomain>`) — we
// NEVER call link_domain for a domain that won't actually serve. While either is
// missing the response is HTTP 200 `status:"pending"` with `txtOk`/`cnameOk` flags
// and a `detail` naming the missing/propagating record. On a successful link the
// response carries `sslStatus`: the Cloudflare custom-hostname state when the CF
// adapter is on, or `"manual"` when it is off (manual-CNAME mode). See the OPERATOR
// REQUIREMENT note in cloudflare.ts for the CF_API_TOKEN + CF_ZONE_ID + CF-for-SaaS
// setup that enables auto-SSL.
//
// DNS CHALLENGE TOKEN — deterministic, KEYLESS, multi-replica-safe. The TXT value
// the owner publishes to prove control of `domain` for `siteId`.
//
// HISTORY — two past bugs, neither reintroduced:
//  1. It was sha256(deployWalletKey : siteId : domain) — a value DERIVED FROM THE
//     SIGNING KEY, published in DNS → it leaked a function of the secret.
//  2. It was then a RANDOM CSPRNG nonce held in a per-replica in-memory Map — which
//     BREAKS at >1 replica (issue lands on pod A, verify on pod B → no token).
// It is now a deterministic, KEYLESS namespaced hash of PUBLIC identifiers: any
// replica re-derives the same value with NO shared store, and it leaks no key. The
// token NEED NOT be secret — security is the DNS-CONTROL (only the domain's DNS
// holder can publish the TXT) PLUS the owner SIGNATURE on verify (recovered ==
// Site.owner). A guessable token grants nothing: you still cannot edit a domain you
// don't control, nor sign as an owner you aren't. No TTL (a deterministic challenge
// is always valid); freshness lives in the OWNER-SIGNATURE's ts window, not here.
// ---------------------------------------------------------------------------

const txtName = (domain: string): string => `_suize-verify.${domain}`;

/** The TXT value to publish for {siteId, domain} — deterministic + stateless. */
const dnsToken = (siteId: string, domain: string): string =>
  createHash("sha256")
    .update(`suize-deploy-dns:${siteId}:${domain.toLowerCase()}`)
    .digest("hex");

// ── Stateless timestamped owner-signature (domain link/unlink auth) ──────────
// The domain-op authority is a zkLogin personal-message signature over an op-bound,
// TIMESTAMPED message (buildDeployLink/UnlinkAuthMessage(domain, …, ts)). There is NO
// server-issued nonce store (THE PRINCIPLE: no per-replica shared map — the chain is
// the database; this auth is multi-replica-safe with zero coordination). The backend
// accepts a `ts` within a freshness window, reconstructs the exact message, recovers
// the signer, and requires it == Site.owner. A within-window replay by whoever already
// saw the signature is HARMLESS: link/unlink are owner-gated AND idempotent on-chain
// (re-linking a domain already pointed at the owner's site re-asserts the same state;
// the registry's EDomainTaken/EWrongCap block any cross-site grab).
//
// WINDOW SIZING — the owner signs the link ONCE, then the AGENT polls verify (it
// cannot re-sign; it does not hold the owner key) while the TXT + CNAME propagate, so
// that one signature must stay fresh ACROSS DNS PROPAGATION. ±60 min covers the common
// case; a slow zone just means the owner re-signs. Unlink shares the window — it needs
// no propagation, but a longer window there is equally harmless (owner-gated +
// idempotent: re-unlinking an already-unlinked domain is a no-op).
const AUTH_TS_WINDOW_MS = 60 * 60 * 1000; // ±60 min — covers DNS propagation (see above).

/** True iff `ts` (ms epoch, client-supplied) is within the freshness window. */
const tsFresh = (ts: number): boolean =>
  Number.isFinite(ts) && Math.abs(Date.now() - ts) <= AUTH_TS_WINDOW_MS;

/**
 * Recover the Sui address that signed `expectedMessage` as a personal message.
 *
 * REUSES the exact primitive the WS auth uses (`verifyPersonalMessageSignature`
 * from @mysten/sui/verify — zkLogin-aware via the Sui client): it DISPATCHES BY
 * SIGNATURE SCHEME — plain Ed25519, zkLogin, OR a MultiSig signature recovers the
 * MULTISIG public key, whose `.toSuiAddress()` is the multisig address (verified in
 * node_modules: the MultiSig branch reconstructs a MultiSigPublicKey from the embedded
 * member set, validates the threshold over the PersonalMessage-wrapped bytes, and a
 * 1-of-2 sub-account satisfies threshold 1 with the lone agent-member signature). It
 * recovers the signer's public key from the base64 personal-message `signature` over
 * the UTF-8 bytes of `expectedMessage`, and we return `toSuiAddress()`. The caller
 * builds `expectedMessage` from the op params + a client timestamp, so a valid
 * signature here proves the holder of THAT address (an EOA OR a sub-account multisig)
 * authorized THIS exact op.
 *
 * Returns the recovered 0x-address, or null on ANY failure (bad sig, malformed
 * input, wrong message) — the caller maps null to a 403.
 */
const verifyDeployRequester = async (
  expectedMessage: string,
  signature: string,
): Promise<string | null> => {
  try {
    const pk = await verifyPersonalMessageSignature(
      new TextEncoder().encode(expectedMessage),
      signature,
      { client: suiClient() },
    );
    return pk.toSuiAddress();
  } catch (err) {
    console.error("[deploy/auth] verify failed:", (err as Error).message);
    return null;
  }
};

const cnameTarget = (siteId: string): string =>
  `${subdomainFor(siteId)}.${config.deployBaseDomain}`;

/** Trailing-dot-insensitive, case-insensitive hostname compare. */
const sameHost = (a: string, b: string): boolean =>
  a.replace(/\.$/, "").toLowerCase() === b.replace(/\.$/, "").toLowerCase();

/**
 * ROUTING CHECK — confirm the domain actually points at us before we link it
 * on-chain. We must never link a domain that won't serve (the worker resolves the
 * stored string; if DNS doesn't route the host to our edge, the site is dead).
 *
 * Resolve the domain's CNAME and check it matches the `cname` target we instruct.
 * Apex domains can't carry a CNAME, so we fall back to a generic `resolve` (CNAME
 * flattening / ALIAS records surface as an A/AAAA chain there): if the flattened
 * record still resolves to OUR target host, that's a match too. Either source
 * matching `expectedTarget` is sufficient routing proof.
 *
 * Returns true when the domain routes to `expectedTarget`; false when it doesn't
 * yet (NXDOMAIN, still-propagating, or pointed elsewhere).
 */
const cnameRoutesToUs = async (domain: string, expectedTarget: string): Promise<boolean> => {
  // Primary: a literal CNAME record (the common subdomain case).
  try {
    const records = await resolveCname(domain);
    if (records.some((r) => sameHost(r, expectedTarget))) return true;
  } catch {
    /* no CNAME (apex, or not yet published) — fall through to the generic resolve */
  }
  // Fallback: apex / flattened ALIAS. `resolve` follows the chain and may return the
  // target host itself (some resolvers surface the CNAME chain) — match it directly.
  try {
    const records = await resolveDns(domain);
    if (records.some((r) => typeof r === "string" && sameHost(r, expectedTarget))) return true;
  } catch {
    /* still nothing — not routed yet */
  }
  return false;
};

// ── Site-owner authorization (M6/M1) ────────────────────────────────────────
// The on-chain Site has an `owner` address, ALWAYS the cryptographically-recovered
// deployer (POST /deploy is authenticated — no anonymous/service-owned deploy path).
// Linking/unlinking a custom domain to a site must be authorized by that owner —
// DNS control alone is not enough (it would let a DNS holder bind a domain to ANY
// siteId, including one they don't own). The service-owned guard below is a defensive
// belt-and-suspenders for any legacy/pre-auth Site whose owner is the service wallet.
//
// ┌─ CRYPTOGRAPHIC AUTHORITY (this is now ENFORCED) ───────────────────────────┐
// │ `requesterAddress` is NO LONGER client-claimed. It is the address RECOVERED │
// │ by `verifyDeployRequester` from a zkLogin personal-message signature the    │
// │ client made over the EXACT op message (`buildDeployLinkAuthMessage` /       │
// │ `buildDeployUnlinkAuthMessage`) bound to a client `ts` (ms epoch) the        │
// │ backend accepts within a freshness window — STATELESS (no nonce store). The │
// │ client cannot forge an address it does not hold the key for; the recovered  │
// │ address is required to equal `Site.owner` below — a real cryptographic       │
// │ ownership proof, not a UX gate. A within-window replay is owner-gated +      │
// │ on-chain-idempotent (harmless — see the AUTH_TS_WINDOW_MS note above).      │
// └────────────────────────────────────────────────────────────────────────────┘

/** Read the on-chain `owner` address recorded on a Site object, or null if unreadable. */
const siteOwner = async (siteId: string): Promise<string | null> => {
  try {
    const res = await suiClient().getObject({ id: siteId, options: { showContent: true } });
    const content = res.data?.content;
    if (!content || content.dataType !== "moveObject") return null;
    if (content.type !== `${DEPLOY_PACKAGE}::site::Site`) return null;
    const owner = (content.fields as Record<string, unknown>).owner;
    return typeof owner === "string" ? owner : null;
  } catch {
    return null;
  }
};

/**
 * Gate a domain op on site ownership.
 *
 * Returns null when authorized; otherwise a DeployError the caller surfaces.
 * `requesterAddress` is the address that must match the Site's on-chain `owner`.
 *
 * IMPORTANT: this value is the address RECOVERED at the call site from a verified
 * zkLogin personal-message signature (op-bound, ts-fresh within the auth window — see
 * the CRYPTOGRAPHIC AUTHORITY note above), NOT a client-claimed field. The owner
 * compare + 403 below are unchanged from the prior seam; only the source of the
 * address became cryptographic.
 *
 * Service-owned / unowned policy (SAFE DEFAULT): a Site whose `owner` is the
 * service wallet itself (an anonymous deploy that passed no real owner), or whose
 * owner is unreadable, has NO external owner that any requester can match — so an
 * arbitrary requester is REJECTED (403). Only the service/admin path (which signs
 * with the service wallet directly, not via this requester body) may touch those.
 * We reject rather than open these up: an unowned site must not be domain-grabbable
 * by whoever asks first.
 */
const authorizeSiteOwner = async (
  siteId: string,
  requesterAddress: string | undefined,
): Promise<DeployError | null> => {
  const owner = await siteOwner(siteId);
  if (!owner) {
    // Owner unreadable (RPC hiccup or not a Site) — fail closed.
    return new DeployError("site owner unreadable; cannot authorize", 403);
  }
  if (owner === serviceAddress()) {
    // Anonymous / service-owned site: no external owner to match — reject.
    return new DeployError("site is service-owned; not domain-linkable by a requester", 403);
  }
  if (!requesterAddress) {
    return new DeployError("requester address required", 403);
  }
  if (!SUI_ADDRESS_RE.test(requesterAddress)) {
    return new DeployError("invalid requester address", 403);
  }
  if (requesterAddress.toLowerCase() !== owner.toLowerCase()) {
    return new DeployError("requester is not the site owner", 403);
  }
  return null;
};

const linkDomainOnChain = async (siteId: string, domain: string): Promise<string> => {
  // link_domain(v, reg, cap: &SiteAdminCap, site: &Site, domain: String). The
  // SiteAdminCap is owned by the service wallet; we must find it for this site.
  const cap = await findAdminCapForSite(siteId);
  if (!cap) throw new DeployError("SiteAdminCap not found for site (cannot link)", 409);

  const tx = new Transaction();
  tx.moveCall({
    target: PACKAGE_IDS.DEPLOY.TARGETS.LINK_DOMAIN,
    arguments: [
      tx.object(VERSION_OBJECT),
      tx.object(DOMAIN_REGISTRY_OBJECT),
      tx.object(cap),
      tx.object(siteId),
      tx.pure.string(domain),
    ],
  });

  try {
    const res = await suiClient().signAndExecuteTransaction({
      transaction: tx,
      signer: wallet(),
      options: { showEffects: true },
    });
    if (res.effects?.status?.status === "failure") {
      throw new DeployError(`link_domain aborted: ${res.effects.status.error ?? "unknown"}`, 409);
    }
    return res.digest;
  } catch (err) {
    if (err instanceof DeployError) throw err;
    throw new DeployError(`link_domain failed: ${(err as Error).message}`, 502);
  }
};

const unlinkDomainOnChain = async (domain: string): Promise<string> => {
  // unlink_domain(v, reg, cap: &SiteAdminCap, domain: String). We need the cap of
  // the site the domain currently points at.
  const siteId = await siteForDomain(domain);
  if (!siteId) throw new DeployError("domain not linked", 404);
  const cap = await findAdminCapForSite(siteId);
  if (!cap) throw new DeployError("SiteAdminCap not found for linked site", 409);

  const tx = new Transaction();
  tx.moveCall({
    target: PACKAGE_IDS.DEPLOY.TARGETS.UNLINK_DOMAIN,
    arguments: [
      tx.object(VERSION_OBJECT),
      tx.object(DOMAIN_REGISTRY_OBJECT),
      tx.object(cap),
      tx.pure.string(domain),
    ],
  });

  try {
    const res = await suiClient().signAndExecuteTransaction({
      transaction: tx,
      signer: wallet(),
      options: { showEffects: true },
    });
    if (res.effects?.status?.status === "failure") {
      throw new DeployError(`unlink_domain aborted: ${res.effects.status.error ?? "unknown"}`, 502);
    }
    return res.digest;
  } catch (err) {
    if (err instanceof DeployError) throw err;
    throw new DeployError(`unlink_domain failed: ${(err as Error).message}`, 502);
  }
};

/** Which site a domain currently points at (latest DomainLinked not since unlinked). */
const siteForDomain = async (domain: string): Promise<string | null> => {
  try {
    const field = await suiClient().getDynamicFieldObject({
      parentId: DOMAIN_REGISTRY_OBJECT,
      name: { type: "0x1::string::String", value: domain },
    });
    const content = field.data?.content;
    if (content?.dataType === "moveObject") {
      const value = (content.fields as Record<string, unknown>).value;
      if (typeof value === "string") return value;
    }
  } catch {
    /* not found */
  }
  return null;
};

/**
 * Find the service-wallet-owned SiteAdminCap for `siteId`. The cap struct is
 * `SiteAdminCap { id, site_id: ID }`; we page the wallet's owned objects of that
 * type and match `site_id`.
 */
const findAdminCapForSite = async (siteId: string): Promise<string | null> => {
  const capType = `${DEPLOY_PACKAGE}::site::SiteAdminCap`;
  try {
    let cursor: string | null | undefined = undefined;
    for (let page = 0; page < 10; page++) {
      const owned = await suiClient().getOwnedObjects({
        owner: serviceAddress(),
        filter: { StructType: capType },
        options: { showContent: true },
        cursor: cursor ?? null,
      });
      for (const o of owned.data) {
        const content = o.data?.content;
        if (content?.dataType !== "moveObject") continue;
        const sid = (content.fields as Record<string, unknown>).site_id;
        if (sid === siteId) return o.data?.objectId ?? null;
      }
      if (!owned.hasNextPage) break;
      cursor = owned.nextCursor;
    }
  } catch (err) {
    console.error("[deploy/admin-cap]", (err as Error).message);
  }
  return null;
};

// The storage extender (deploy/extend.ts) signs its own extend_blob PTBs with the
// SAME service wallet + RPC client — exported accessors so it never re-derives
// either (one key source: config.deployWalletKey; same lazy singletons).
export {
  suiClient as deploySuiClient,
  wallet as deployWallet,
  serviceAddress as deployServiceAddress,
};

// Cap the JSON body for the domains route — these payloads are tiny (siteId +
// domain + a base64 signature). Reject anything larger before parsing (M6).
const MAX_DOMAINS_BODY_BYTES = 8 * 1024;

const readDomainsBody = async (req: Request): Promise<{ ok: true; body: any } | { ok: false }> => {
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > MAX_DOMAINS_BODY_BYTES) return { ok: false };
  let raw: string;
  try { raw = await req.text(); } catch { return { ok: false }; }
  if (raw.length > MAX_DOMAINS_BODY_BYTES) return { ok: false };
  try { return { ok: true, body: JSON.parse(raw) }; } catch { return { ok: false }; }
};

const handleDomains = async (req: Request, url: URL, origin: string | null, server?: Server<unknown>): Promise<Response> => {
  if (!DEPLOY_ENABLED || !CHAIN_IDS_PUBLISHED) return notConfigured(origin);
  if (!takeToken(getIp(req, server))) return json({ error: "too many requests" }, 429, origin, { "Retry-After": "1" });

  // Body-size cap (M6) — reject oversized/invalid bodies before parsing.
  const parsed = await readDomainsBody(req);
  if (!parsed.ok) return json({ error: "invalid or oversized body" }, 400, origin);
  const body = parsed.body;

  const siteId = String(body?.siteId ?? "").trim();
  const domain = String(body?.domain ?? "").trim().toLowerCase();
  const verify = url.searchParams.get("verify") === "1" || body?.verify === true;

  if (!SUI_ADDRESS_RE.test(siteId)) return json({ error: "invalid siteId" }, 400, origin);
  if (!DOMAIN_RE.test(domain)) return json({ error: "invalid domain" }, 400, origin);

  // SUBSCRIPTION GATE (LOCKED #10) — custom domains are the recurring unlock. PER-ADDRESS:
  // ONE active Deploy subscription owned by the site's on-chain owner unlocks custom
  // domains for ALL that owner's sites. We read the site's on-chain owner, then check the
  // MERCHANT SDK (suizeSubs.activeFor(owner) — NOT findByRef(siteId); the sub is no longer
  // per-site) for any active Deploy-merchant subscription that owner holds. No active sub
  // → 402. Gates BOTH the challenge ISSUE and the verify/link path (the issue step is
  // useless without a sub, and surfacing the wall up front is the clearest UX). The
  // one-off $0.50 deploy + extend stay UNGATED (pay-per-use, not the sub).
  const subs = await deploySubs();
  if (subs) {
    try {
      const owner = await siteOwner(siteId);
      if (!owner || !SUI_ADDRESS_RE.test(owner)) {
        // Owner unreadable — a transient RPC blip OR a non-existent Site. Fail CLOSED,
        // but as a RETRYABLE 503: never tell a genuinely-subscribed owner "you need a
        // sub" on a hiccup (siteOwner swallows RPC errors, so we can't distinguish here;
        // a truly bad siteId keeps 503-ing, which is acceptable). Audit: 402-vs-503.
        return json({ error: "site owner unreadable; retry" }, 503, origin);
      }
      // VALID TERMS, not mere existence: a Subscription<Junk> or a $0.01/100yr sub is
      // "active" yet worthless. isValidDeploySub binds USDC + amount >= price + monthly
      // period (audit: subs free/underpriced-premium class).
      if (!(await subs.activeFor(owner)).some(isValidDeploySub)) {
        return json(
          { error: "custom domains require an active Deploy subscription on your account" },
          402,
          origin,
        );
      }
    } catch (err) {
      // RPC error from activeFor propagates here — fail CLOSED with a retryable 503, not
      // a wrong 402.
      console.error("[deploy/domains] sub gate read failed:", (err as Error).message);
      return json({ error: "subscription state temporarily unavailable; retry" }, 503, origin);
    }
  }

  const cname = cnameTarget(siteId);

  // ── issue the challenge (no verify) ──────────────────────────────────────────
  // UNAUTHENTICATED on purpose: this step writes NOTHING on-chain — it only returns
  // the DNS challenge token (deterministic + keyless — see dnsToken) for the TXT
  // record. The owner gate runs ONLY on verify, where the owner signature is present.
  // No auth nonce is issued: the verify step's signature is STATELESS-timestamped
  // (the client picks its own `ts`).
  if (!verify) {
    const token = dnsToken(siteId, domain);
    const res: DomainChallengeResponse = {
      domain,
      status: "pending",
      txtName: txtName(domain),
      txtValue: token,
      cname,
    };
    return json(res, 200, origin);
  }

  // ── verify path: CRYPTOGRAPHIC OWNER AUTH (op-bound, stateless-timestamped) ────
  // The authority is a zkLogin personal-message signature over the EXACT op
  // message; the recovered address — NOT any client-claimed `requester` — must
  // equal Site.owner. Require { ts, signature }, assert the ts is fresh (else 403
  // stale/skewed), reconstruct the exact message, recover the signer (else 403
  // invalid signature), then gate on owner. No nonce store (THE PRINCIPLE).
  const ts = typeof body?.ts === "number" ? body.ts : Number(body?.ts);
  const signature = typeof body?.signature === "string" ? body.signature.trim() : "";
  if (!Number.isFinite(ts) || !signature) return json({ error: "ts and signature required" }, 403, origin);
  if (!tsFresh(ts)) return json({ error: "stale or skewed timestamp — re-sign with a fresh ts" }, 403, origin);

  const recovered = await verifyDeployRequester(
    buildDeployLinkAuthMessage(domain, siteId, ts),
    signature,
  );
  if (!recovered) return json({ error: "invalid signature" }, 403, origin);

  const authErr = await authorizeSiteOwner(siteId, recovered);
  if (authErr) {
    return json({ error: authErr.message }, authErr.status, origin);
  }

  // ── the TXT challenge token is deterministic — always derivable, no store ─────
  const token = dnsToken(siteId, domain);

  // ── verify BOTH the TXT (ownership) AND the CNAME (routing) ───────────────────
  // We require BOTH before linking on-chain: the TXT proves the requester controls
  // the domain, and the CNAME proves the domain actually routes to us — never link a
  // domain that won't serve. Each is checked independently so the response can tell
  // the caller exactly which record is still missing/propagating (txtOk / cnameOk).
  let txtOk = false;
  let txtDetail = "";
  try {
    const flat = (await resolveTxt(txtName(domain))).map((chunks) => chunks.join(""));
    if (flat.includes(token)) txtOk = true;
    else txtDetail = `TXT ${txtName(domain)} present but does not match the challenge token`;
  } catch (err) {
    // NXDOMAIN / no TXT yet — still pending, not an error.
    txtDetail = `TXT ${txtName(domain)} not found yet (${(err as Error).message})`;
  }

  const cnameOk = await cnameRoutesToUs(domain, cname);
  const cnameDetail = cnameOk ? "" : `CNAME ${domain} -> ${cname} not visible yet (add it / wait for DNS propagation)`;

  if (!txtOk || !cnameOk) {
    // One or both records missing/propagating — surface which, keep it `pending`.
    const detail = [txtDetail, cnameDetail].filter(Boolean).join("; ");
    return json(
      {
        domain,
        status: "pending",
        txtName: txtName(domain),
        txtValue: token,
        cname,
        txtOk,
        cnameOk,
        detail,
      },
      200,
      origin,
    );
  }

  // TXT + CNAME verified, owner signature already proven above — link on-chain.
  // Nothing to burn: the DNS token is deterministic (no store), and EDomainTaken on
  // the registry is the on-chain guard against a duplicate link.
  let digest: string;
  try {
    digest = await linkDomainOnChain(siteId, domain);
  } catch (err) {
    if (err instanceof DeployError) return json({ error: err.message }, err.status, origin);
    throw err;
  }

  // Best-effort auto-SSL via Cloudflare. A failure here does NOT fail the link.
  const ssl = await provisionCustomHostname(domain);

  // SSL state surfaced as `sslStatus` for the dashboard:
  //  - CF off (no token/zone): "manual" — the user CNAMEs + handles SSL themselves.
  //  - CF on: the custom-hostname provisioning state. We read the LIVE state (the
  //    POST result can lag at "pending"); if the read is empty we fall back to the
  //    provision result, then normalise to pending/active/error.
  let sslStatus: DomainChallengeResponse["sslStatus"];
  if (!cloudflareEnabled()) {
    sslStatus = "manual";
  } else {
    const live = await customHostnameSslStatus(domain);
    const raw = live ?? (ssl.provisioned ? ssl.sslStatus : ssl.reason === "error" ? "error" : "pending");
    sslStatus = raw === "active" ? "active" : raw === "error" ? "error" : "pending";
  }

  const res: DomainChallengeResponse & {
    digest: string;
    ssl: typeof ssl;
    instructions?: string;
  } = {
    domain,
    status: "linked",
    txtName: txtName(domain),
    txtValue: token,
    cname,
    txtOk: true,
    cnameOk: true,
    sslStatus,
    digest,
    ssl,
  };
  if (!cloudflareEnabled()) {
    res.instructions = `Add a CNAME: ${domain} -> ${cname} (Cloudflare-for-SaaS not enabled; manual CNAME).`;
  }
  return json(res, 200, origin);
};

const handleDeleteDomain = async (req: Request, domain: string, origin: string | null, server?: Server<unknown>): Promise<Response> => {
  if (!DEPLOY_ENABLED || !CHAIN_IDS_PUBLISHED) return notConfigured(origin);
  if (!takeToken(getIp(req, server))) return json({ error: "too many requests" }, 429, origin, { "Retry-After": "1" });

  const d = domain.trim().toLowerCase();
  if (!DOMAIN_RE.test(d)) return json({ error: "invalid domain" }, 400, origin);

  // AUTHORIZATION (M1) — unlinking was fully UNAUTHENTICATED: anyone could DELETE
  // /domains/<domain> and detach a victim's custom domain (griefing / takeover
  // setup). It now requires the SAME CRYPTOGRAPHIC ownership gate as linking:
  // a zkLogin personal-message signature over the op-bound, STATELESS-timestamped
  // message (buildDeployUnlinkAuthMessage); the RECOVERED address — not a client-
  // claimed field — must equal Site.owner for the site the domain currently points
  // at. A service-owned / unowned site is REJECTED (403), mirroring link.
  const currentSiteId = await siteForDomain(d);
  if (!currentSiteId) return json({ error: "domain not linked" }, 404, origin);

  // DELETE carries { ts, signature } in the (size-capped) JSON body.
  const parsed = await readDomainsBody(req);
  if (!parsed.ok) return json({ error: "invalid or oversized body" }, 400, origin);
  const ts = typeof parsed.body?.ts === "number" ? parsed.body.ts : Number(parsed.body?.ts);
  const signature = typeof parsed.body?.signature === "string" ? parsed.body.signature.trim() : "";
  if (!Number.isFinite(ts) || !signature) return json({ error: "ts and signature required" }, 403, origin);
  if (!tsFresh(ts)) return json({ error: "stale or skewed timestamp — re-sign with a fresh ts" }, 403, origin);

  const recovered = await verifyDeployRequester(
    buildDeployUnlinkAuthMessage(d, ts),
    signature,
  );
  if (!recovered) return json({ error: "invalid signature" }, 403, origin);

  const authErr = await authorizeSiteOwner(currentSiteId, recovered);
  if (authErr) {
    return json({ error: authErr.message }, authErr.status, origin);
  }

  let digest: string;
  try {
    digest = await unlinkDomainOnChain(d);
  } catch (err) {
    if (err instanceof DeployError) return json({ error: err.message }, err.status, origin);
    throw err;
  }

  const cfRemoved = await removeCustomHostname(d);
  return json({ status: "unlinked", domain: d, digest, cfRemoved }, 200, origin);
};

// ---------------------------------------------------------------------------
// POST /sites/:id/extend — a paid one-off $0.50 Walrus-storage EXTEND. Same x402
// V2 first-party gate as a deploy: no payment → 402 (the PaymentRequired body +
// PAYMENT-REQUIRED header); the paid retry carries the signed gasless payment in
// the X-PAYMENT header. The payer MUST be the site owner (payer == owner), so a
// third party can't extend (and pay for) a stranger's site. After the settlement
// the service wallet extends the site's two blobs by config.renewalEpochs.
// ---------------------------------------------------------------------------

const handleExtendSite = async (
  req: Request,
  siteId: string,
  origin: string | null,
  server?: Server<unknown>,
): Promise<Response> => {
  if (!DEPLOY_ENABLED || !CHAIN_IDS_PUBLISHED) return notConfigured(origin);
  if (!takeToken(getIp(req, server))) return json({ error: "too many requests" }, 429, origin, { "Retry-After": "1" });
  if (!SUI_ADDRESS_RE.test(siteId)) return json({ error: "invalid site id" }, 400, origin);

  const gateLive = await chargeGateReady();
  const proto = req.headers.get("x-forwarded-proto");

  const challenge402 = async (errorOverride?: string): Promise<Response | null> => {
    const body = await deployRequirements(req.url, proto);
    if (!body) return null;
    if (errorOverride) body.error = errorOverride;
    return json(body, 402, origin, {
      "PAYMENT-REQUIRED": Buffer.from(JSON.stringify(body), "utf8").toString("base64"),
    });
  };

  // The site must exist + we need its owner (the payer must EQUAL it — a stranger must
  // not extend+pay for your site). A missing/unreadable site is a 404 BEFORE the
  // payment wall (don't make a payer settle for nothing).
  const owner = await siteOwner(siteId);
  if (!owner) return json({ error: "site not found" }, 404, origin);

  // When the gate is OFF (treasury unresolved) the extend runs un-gated — same
  // "abuse mitigation, not billing" mode as the deploy route.
  let verifiedPayment: VerifiedDeployPayment | null = null;
  if (gateLive) {
    const payHeader = (req.headers.get("X-PAYMENT") ?? req.headers.get("PAYMENT-SIGNATURE") ?? "").trim();
    if (!payHeader) {
      const c = await challenge402();
      if (c) return c;
    }
    try {
      verifiedPayment = await gateDeployPayment(payHeader);
    } catch (err) {
      if (err instanceof DeployPaymentError) {
        if (err.challenge) {
          const c = await challenge402(err.message);
          if (c) return c;
        }
        return json({ error: err.message }, err.status, origin);
      }
      throw err;
    }
    // EXTEND-only ownership gate: the recovered payer MUST be the site owner (deploy
    // has no pre-existing owner to compare — owner is the payer; extend does). A
    // stranger paying to extend your site is rejected (their $0.50 is NOT settled — we
    // throw before settleDeployPayment).
    if (verifiedPayment.payer.toLowerCase() !== owner.toLowerCase()) {
      const c = await challenge402("the payment must be signed by the site owner to extend its storage");
      if (c) return c;
      return json({ error: "payer is not the site owner" }, 402, origin);
    }
  }

  // Settled (or un-gated) — extend the site's storage. extendOnce resolves the
  // Walrus package + WAL coin and extends both blobs by config.renewalEpochs.
  try {
    // Settle the verified, owner-signed payment NOW (idempotent by digest), then
    // extend. The extend mints no Site, so there is no on-chain digest registry —
    // a re-presented payment re-settles idempotently and never double-charges.
    if (verifiedPayment) await settleDeployPayment(verifiedPayment);
    const digest = await extendOnce(siteId);
    if (!digest) {
      return json(
        { error: "nothing to extend (storage already near max, or the site has no extendable blobs)" },
        409,
        origin,
      );
    }
    const end = await storageEndForSite(siteId);
    return json(
      { siteId, digest, storageEndEpoch: end, expiresAtMs: end !== null ? epochToMs(end) : null },
      200,
      origin,
    );
  } catch (err) {
    if (err instanceof DeployPaymentError) {
      if (err.challenge) {
        const c = await challenge402(err.message);
        if (c) return c;
      }
      return json({ error: err.message }, err.status, origin);
    }
    console.error("[deploy/extend-site]", (err as Error).message);
    return json({ error: "extend failed" }, 500, origin);
  }
};

// ---------------------------------------------------------------------------
// GET /deploy/wallet-address — the PUBLIC address of the deploy SERVICE WALLET
// (the address that pays create_site gas + the Walrus-extend WAL). PUBLIC: an
// on-chain address is not a secret, and the dashboard's read-only admin panel
// reads its SUI + WAL balances DIRECTLY from chain — it only needs to learn WHICH
// address to read. We also return the WAL coin type so the frontend never hardcodes
// it (single source of truth = config.walCoinType). 503 when the deploy wallet is
// unconfigured (no key → no address). No CHAIN_IDS_PUBLISHED gate: the address +
// its balances exist even before the move package is published.
const handleWalletAddress = (req: Request, origin: string | null, server?: Server<unknown>): Response => {
  if (!DEPLOY_ENABLED) return notConfigured(origin);
  if (!takeToken(getIp(req, server))) return json({ error: "too many requests" }, 429, origin, { "Retry-After": "1" });
  // The dashboard's read-only admin panel reads this address's SUI + WAL balances
  // directly from chain; it only needs `address` + `walCoinType`.
  return json(
    {
      address: serviceAddress(),
      walCoinType: config.walCoinType,
    },
    200,
    origin,
  );
};

// ---------------------------------------------------------------------------
// Readiness + info (mirror the handle module).
// ---------------------------------------------------------------------------

export const deployReady = async (): Promise<boolean> => {
  if (!DEPLOY_ENABLED) return false;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1500);
    try {
      const seq = await suiClient().getLatestCheckpointSequenceNumber({ signal: controller.signal });
      return typeof seq === "string" && seq.length > 0;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return false;
  }
};

export const deployInfo = {
  enabled: DEPLOY_ENABLED,
  // True only when the on-chain ids are real (not the 0x0 placeholders) — i.e.
  // the module can actually mint Sites. The startup log surfaces this.
  chainReady: DEPLOY_ENABLED && CHAIN_IDS_PUBLISHED,
  baseDomain: config.deployBaseDomain,
  epochs: config.deployEpochs,
  cloudflare: cloudflareEnabled(),
  // The CHARGE↔Deploy join (x402 V2, first-party): live only once the Deploy treasury
  // resolves. When off the deploy route runs un-gated (auth + rate limits only). This
  // is the async resolver — the boot log awaits it.
  chargeGateReady: chargeInfo.ready,
  chargePrice: chargeInfo.price,
};

// ---------------------------------------------------------------------------
// Route matcher — returns a Response for any /deploy, /sites, /domains route, or
// null if the path/method isn't ours (so the main server tries the next matcher).
// ---------------------------------------------------------------------------

export const handleDeployRoute = (
  req: Request,
  url: URL,
  origin: string | null,
  server?: Server<unknown>,
): Promise<Response> | null => {
  const path = url.pathname;

  if (req.method === "POST" && path === "/deploy") return handleDeploy(req, origin, server);
  // Deploy storage SUBSCRIPTION — the raw-agent buyer-build helper (the wallet uses its
  // own WS sponsor path). build → sign locally → submit; the buyer mints a subs::create
  // (merchant = Deploy treasury, ref = siteId). Matched BEFORE the generic /deploy arm.
  if (req.method === "POST" && path === "/deploy/subscribe/build") return handleSubscribeBuild(req, origin, server);
  if (req.method === "POST" && path === "/deploy/subscribe/submit") return handleSubscribeSubmit(req, origin, server);
  if (req.method === "GET" && path === "/deploy/wallet-address") return Promise.resolve(handleWalletAddress(req, origin, server));
  if (req.method === "GET" && path === "/sites") return handleListSites(req, url, origin, server);

  // POST /sites/:id/extend — a paid one-off $0.50 Walrus-storage extend. Matched
  // BEFORE GET /sites/:id so the more specific subpath wins.
  if (req.method === "POST" && path.startsWith("/sites/") && path.endsWith("/extend")) {
    const id = decodeURIComponent(path.slice("/sites/".length, path.length - "/extend".length));
    if (id) return handleExtendSite(req, id, origin, server);
  }

  // GET /sites/:id
  if (req.method === "GET" && path.startsWith("/sites/")) {
    const id = decodeURIComponent(path.slice("/sites/".length));
    if (id) return handleGetSite(req, id, origin, server);
  }

  if (req.method === "POST" && path === "/domains") return handleDomains(req, url, origin, server);

  // DELETE /domains/:domain
  if (req.method === "DELETE" && path.startsWith("/domains/")) {
    const d = decodeURIComponent(path.slice("/domains/".length));
    if (d) return handleDeleteDomain(req, d, origin, server);
  }

  return null;
};
