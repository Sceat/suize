// Deploy module — "Suize Deploy" (Vercel for Sui). The ORCHESTRATION BRAIN.
//
// POST /deploy is ALWAYS AUTHENTICATED — there is NO anonymous deploy. Every
// deployer Google-logs-in (the dashboard via zkLogin, the future MCP via OAuth → a
// Suize wallet) and signs a single-use server nonce (buildDeployAuthMessage). The
// on-chain `owner` is ALWAYS the cryptographically-recovered signer — there is no
// client-claimed `owner` field and no service-wallet fallback, so a caller can only
// ever set THEMSELVES as the owner.
//
// An authenticated deployer POSTs a built static site as a tar (+ nonce + signature);
// this module:
//   0. requires { nonce, signature }, verifies the signature recovers an address
//      (verifyPersonalMessageSignature — zkLogin OR plain Ed25519) over the live
//      nonce, burns the nonce, and uses the recovered address as `owner`,
//   1. unpacks the tar in-memory, enforcing size + file-count caps,
//   2. uploads ALL files as ONE Walrus quilt via the HTTP publisher (the publisher
//      pays WAL; the deploy wallet only pays the on-chain create_site gas),
//   3. builds a manifest JSON (path -> {patch, sha256, ct, size}), stores it as a
//      Walrus blob, computes its sha256,
//   4. mints a FRESH on-chain `deploy_sui::site::Site` (signed by the deploy
//      service wallet — NOT Enoki-sponsored; the agent signs nothing), with the
//      recovered deployer as `owner`,
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
  SUIZE_DEPLOY_MERCHANT,
  DEPLOY_SUB_PRICE_USDC,
  buildDeployAuthMessage,
  buildDeployLinkAuthMessage,
  buildDeployUnlinkAuthMessage,
  buildDeployRenewalLinkAuthMessage,
  buildDeployRenewalUnlinkAuthMessage,
} from "@suize/shared";
import type {
  DeployResponse,
  SiteInfo,
  DomainChallengeResponse,
  DeployNonceResponse,
  DeployRenewalLinkRequest,
  DeployRenewalUnlinkRequest,
  DeployRenewalResponse,
} from "@suize/shared";
import { config } from "../config";
import { json, getIp } from "../http";
import { parseMoveAbort } from "../move-abort";
import { deployDailyCeiling } from "../quota";
import { encodeObjectIdToBase36 } from "./base36";
import { contentTypeFor } from "./content-type";
import { storeQuilt, storeBlob, WalrusError, type QuiltInputFile } from "./walrus";
import {
  chargeGateReady,
  chargeGateReason,
  deployQuote,
  buildDeployCharge,
  buildDeploySubscribe,
  buildDeployAccountCreate,
  executeDeployCharge,
  reserveDeployCharge,
  commitDeployCharge,
  releaseDeployCharge,
  ChargeError,
  SponsorError,
  chargeInfo,
} from "./charge";
import type { DeployChargeRequest } from "@suize/shared";
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
const CHARGE_LEDGER_OBJECT: string = PACKAGE_IDS.DEPLOY.CHARGE_LEDGER_OBJECT;
const RENEWAL_REGISTRY_OBJECT: string = PACKAGE_IDS.DEPLOY.RENEWAL_REGISTRY_OBJECT;
const ACCOUNT_PACKAGE: string = PACKAGE_IDS.ACCOUNT.PACKAGE;
const CHAIN_IDS_PUBLISHED =
  DEPLOY_PACKAGE !== "0x0" &&
  VERSION_OBJECT !== "0x0" &&
  DOMAIN_REGISTRY_OBJECT !== "0x0" &&
  CHARGE_LEDGER_OBJECT !== "0x0" &&
  RENEWAL_REGISTRY_OBJECT !== "0x0";

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
// service wallet (for later domain/renewal ops). When the charge gate is live the
// SAME PTB appends `charge_ledger::record_charge` — the paid digest is burned
// on-chain ATOMICALLY with the Site mint (Table key uniqueness = the replay
// physics; it holds across restarts/replicas, unlike the in-memory sets). We
// parse the created Site object id out of objectChanges.
// ---------------------------------------------------------------------------

// The LedgerCap (`charge_ledger::LedgerCap`) owned by the deploy service wallet —
// the only authority that may record charge digests (front-run-recording guard;
// see charge_ledger.move). Discovered once via getOwnedObjects and cached, exactly
// like the per-site SiteAdminCap discovery below (the cap never moves).
let _ledgerCapId: string | null = null;

const findLedgerCap = async (): Promise<string | null> => {
  if (_ledgerCapId) return _ledgerCapId;
  try {
    const owned = await suiClient().getOwnedObjects({
      owner: serviceAddress(),
      filter: { StructType: `${DEPLOY_PACKAGE}::charge_ledger::LedgerCap` },
      limit: 1,
    });
    const id = owned.data[0]?.data?.objectId ?? null;
    if (id) _ledgerCapId = id;
    return id;
  } catch (err) {
    console.error("[deploy/ledger-cap]", (err as Error).message);
    return null;
  }
};

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
  chargeDigest: string | null,
): Promise<CreatedSite> => {
  const tx = new Transaction();
  const manifestHashBytes = Uint8Array.from(Buffer.from(manifestHashHex, "hex"));

  // create_site(v: &Version, name: String, owner: address, quilt_id: String,
  //   manifest_blob_id: String, manifest_hash: vector<u8>, quilt_blob_object: ID,
  //   manifest_blob_object: ID, size_bytes: u64, file_count: u64, ctx): SiteAdminCap
  // The two blob OBJECT ids (owned by the service wallet via send_object_to) are
  // recorded on-chain so the renewal relayer knows WHICH Walrus objects to extend.
  // size_bytes/file_count are recorded so the read endpoints surface real metrics.
  const cap = tx.moveCall({
    target: PACKAGE_IDS.DEPLOY.TARGETS.CREATE_SITE,
    arguments: [
      tx.object(VERSION_OBJECT),
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

  // CHARGE gate live → burn the paid digest ON-CHAIN in the same PTB (atomic with
  // the mint: no Site without the burn, no burn without the Site). The fresh cap
  // result from create_site proves which site the digest paid for.
  if (chargeDigest) {
    const ledgerCap = await findLedgerCap();
    if (!ledgerCap) {
      // Retryable (503): the reservation is RELEASED by the caller's catch — the
      // paid digest stays valid for a retry once the cap is reachable.
      throw new DeployError("deploy LedgerCap not found on the service wallet (cannot record charge)", 503);
    }
    tx.moveCall({
      target: PACKAGE_IDS.DEPLOY.TARGETS.RECORD_CHARGE,
      arguments: [
        tx.object(VERSION_OBJECT),
        tx.object(CHARGE_LEDGER_OBJECT),
        tx.object(ledgerCap),
        cap,
        tx.pure.string(chargeDigest),
      ],
    });
  }

  // create_site RETURNS the SiteAdminCap (composable style — it does NOT transfer it
  // internally), so the PTB must take ownership or it fails resolution with
  // UnusedValueWithoutDrop. Send it to the deploy service wallet (the signer), which
  // holds the cap for later domain/renewal ops.
  tx.transferObjects([cap], wallet().toSuiAddress());

  // charge_ledger abort 0 (EChargeAlreadyUsed) = the digest is burned ON-CHAIN for
  // good (it already bought a Site, possibly via another replica / before a restart).
  // Surfaced as ChargeError 409 so handleDeploy COMMITS — never releases — the
  // in-memory reservation: a retry with this digest can never succeed.
  const duplicateCharge = (error: string): ChargeError | null => {
    const abort = parseMoveAbort(error);
    return abort?.module === "charge_ledger" && abort.code === 0
      ? new ChargeError("charge already used for a deploy (recorded on-chain)", 409)
      : null;
  };

  let res;
  try {
    res = await suiClient().signAndExecuteTransaction({
      transaction: tx,
      signer: wallet(),
      options: { showObjectChanges: true, showEffects: true },
    });
  } catch (err) {
    const dup = duplicateCharge((err as Error).message ?? "");
    if (dup) throw dup;
    throw new DeployError(`create_site failed: ${(err as Error).message}`, 502);
  }

  if (res.effects?.status?.status === "failure") {
    const dup = duplicateCharge(res.effects.status.error ?? "");
    if (dup) throw dup;
    throw new DeployError(`create_site aborted: ${res.effects.status.error ?? "unknown"}`, 502);
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
// POST /deploy — the one-call deploy flow. ALWAYS AUTHENTICATED.
//
// Every deploy MUST carry { nonce, signature } multipart fields: the deployer
// (Google-logged-in → a Suize wallet) signs a single-use server nonce
// (buildDeployAuthMessage) and the backend recovers the signer address via
// verifyPersonalMessageSignature (zkLogin OR plain Ed25519). The recovered address
// IS the on-chain `owner` — there is no client-claimed `owner` field and no
// service-wallet fallback, so a caller can only ever set THEMSELVES as owner.
// Missing/invalid auth → 401, no anonymous deploy.
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

  // ── parse multipart ────────────────────────────────────────────────────────
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return json({ error: "invalid multipart body" }, 400, origin);
  }

  const name = String(form.get("name") ?? "").trim();
  if (!name || name.length > MAX_NAME_LEN) {
    return json({ error: "missing or oversized 'name' field" }, 400, origin);
  }

  // ── AUTHENTICATION (REQUIRED) ────────────────────────────────────────────────
  // There is NO anonymous deploy. The deployer signs a single-use server nonce
  // (buildDeployAuthMessage) with their Suize wallet; `owner` is ALWAYS the
  // recovered signer — never client-claimed, never the service wallet. A deploy
  // can't bind to a siteId (it doesn't exist until create_site), so the message
  // proves only the signer + the fresh nonce, which means a caller can only ever
  // set THEMSELVES as owner. Missing/invalid → 401.
  const nonce = String(form.get("nonce") ?? "").trim();
  const signature = String(form.get("signature") ?? "").trim();
  if (!nonce || !signature || !authNonceLive(nonce)) {
    return json({ error: "deploy requires a signed-in deployer" }, 401, origin);
  }
  const recovered = await verifyDeployRequester(buildDeployAuthMessage(nonce), signature);
  if (!recovered) {
    return json({ error: "deploy requires a signed-in deployer" }, 401, origin);
  }
  burnAuthNonce(nonce); // single-use: replay-resistant once the deploy is attempted.
  const owner = recovered;

  // ── PAYMENT GATE, leg 1: presence (the CHARGE↔Deploy join) ──────────────────
  // A deploy is a one-off $0.50 `charge` on the rail. When the join is LIVE (the
  // `account` package is published AND the Deploy merchant is pinned), the deploy
  // REQUIRES a `chargeDigest` multipart field — the executed charge tx the caller
  // settled via POST /deploy/charge → POST /execute. The cheap presence check runs
  // here (402 + quote before any tar work); the on-chain verification + single-use
  // RESERVATION runs after input validation, immediately before the paid work, so
  // an input-rejected deploy never strands a reservation. No payment → no deploy.
  //
  // When the join is NOT live yet (pre-publish / merchant unpinned), the deploy
  // runs un-gated (auth + rate limits + the gas-drain ceiling only) — the documented
  // "abuse mitigation, not billing" mode. The moment the two ids are set in
  // @suize/shared, this gate lights up with zero further code change.
  let chargeDigest: string | null = null;
  if (chargeGateReady()) {
    chargeDigest = String(form.get("chargeDigest") ?? "").trim();
    if (!chargeDigest) {
      // 402-shaped: the caller must settle the quote first.
      return json(
        { error: "payment required", quote: deployQuote() },
        402,
        origin,
      );
    }
  }

  const file = form.get("site.tar");
  if (!(file instanceof File)) return json({ error: "missing 'site.tar' file" }, 400, origin);

  const tarBytes = new Uint8Array(await file.arrayBuffer());
  if (tarBytes.byteLength === 0) return json({ error: "empty 'site.tar'" }, 400, origin);
  if (tarBytes.byteLength > MAX_BUNDLE_BYTES) return json({ error: "bundle too large" }, 413, origin);

  // ── unpack + validate ────────────────────────────────────────────────────────
  let files: NormalizedFile[];
  try {
    files = normalizeEntries(parseTar(tarBytes));
  } catch (err) {
    if (err instanceof DeployError) return json({ error: err.message }, err.status, origin);
    return json({ error: `unreadable tar: ${(err as Error).message}` }, 400, origin);
  }
  if (files.length === 0) return json({ error: "no files in bundle" }, 400, origin);
  if (files.length > MAX_FILE_COUNT) {
    return json({ error: `too many files (max ${MAX_FILE_COUNT})` }, 400, origin);
  }

  // ── deploy receipt (dedup salt) ──────────────────────────────────────────────
  // Inject ONE extra file into every bundle: a tiny JSON receipt whose bytes are
  // UNIQUE per deploy (wall-clock ms + the single-use auth nonce). Identical site
  // bundles would otherwise dedup on Walrus (`alreadyCertified` — no new Blob
  // OBJECT, nothing for the relayer to own/extend); the unique receipt guarantees
  // `newlyCreated` every time. It IS served (at /.suize/deploy.json) — that's fine
  // and documented; it's counted in the manifest/size/file-count like any user
  // file. The reserved path is OURS: a user file at it is dropped first.
  files = files.filter((f) => f.servedPath !== DEPLOY_RECEIPT_PATH);
  const receiptBytes = new TextEncoder().encode(
    JSON.stringify({ deployedAt: Date.now(), owner, nonce }),
  );
  let receiptId = identifierFor(DEPLOY_RECEIPT_PATH);
  // Defend against an identifier collision after flattening (mirrors normalizeEntries).
  const takenIds = new Set(files.map((f) => f.identifier));
  let rn = 1;
  while (takenIds.has(receiptId)) receiptId = `${identifierFor(DEPLOY_RECEIPT_PATH)}.${rn++}`;
  files.push({ servedPath: DEPLOY_RECEIPT_PATH, identifier: receiptId, data: receiptBytes });

  const totalBytes = files.reduce((n, f) => n + f.data.byteLength, 0);
  if (totalBytes > MAX_BUNDLE_BYTES) return json({ error: "bundle too large" }, 413, origin);

  // ── PAYMENT GATE, leg 2: verify + RESERVE the charge (single-use) ────────────
  // Last stop before the paid work. The digest is reserved (in-flight) here,
  // COMMITTED only after the Site mints, and RELEASED in the catch below — so a
  // transient Walrus/mint failure never burns a paid charge, and two concurrent
  // deploys can't ride one digest.
  if (chargeDigest) {
    const chargeErr = await reserveDeployCharge(chargeDigest, owner);
    if (chargeErr) {
      return json({ error: chargeErr.message, quote: deployQuote() }, chargeErr.status, origin);
    }
  }

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

    // ── 1. upload ALL files as one quilt ────────────────────────────────────────
    // The Blob OBJECT is transferred to the service wallet (send_object_to) so the
    // renewal relayer can later `extend_blob` it; its id is recorded on the Site.
    const { quiltId, patchIds, quiltBlobObject } = await storeQuilt(quiltInputs, serviceAddress());

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

    // ── 4. mint the on-chain Site (+ burn the charge digest in the same PTB) ────
    // size_bytes/file_count are the real bundle metrics (computed above when we
    // validated the caps) — recorded on-chain so the read endpoints don't return 0.
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
      chargeDigest,
    );

    // The Site exists on-chain — the paid charge is now spent for good. Commit
    // BEFORE anything else can throw, or a post-mint failure would release a
    // digest that already bought a live Site (free second deploy).
    if (chargeDigest) commitDeployCharge(chargeDigest);

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
    // The deploy died before (or at) the mint. Two distinct outcomes for the paid
    // charge: a ChargeError 409 from record_charge means the digest is burned
    // ON-CHAIN for good (it already bought a Site) — COMMIT it so no retry loops on
    // a dead digest; anything else hands the paid charge back so the caller can
    // retry with the same digest. No-op if already committed.
    if (chargeDigest) {
      if (err instanceof ChargeError && err.status === 409) commitDeployCharge(chargeDigest);
      else releaseDeployCharge(chargeDigest);
    }
    if (err instanceof WalrusError) return json({ error: err.message }, err.status, origin);
    if (err instanceof DeployError) return json({ error: err.message }, err.status, origin);
    if (err instanceof ChargeError) return json({ error: err.message }, err.status, origin);
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

    // Linked domains for this site + the creation timestamp (from the SiteCreated
    // event — the Move struct doesn't store time; the event's timestampMs does).
    const [domains, createdAtMs] = await Promise.all([
      domainsForSite(siteId),
      createdAtMsForSite(siteId),
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
// links on-chain. DELETE /domains/:domain unlinks. Both link AND unlink require proof
// of control via the SAME DNS-TXT challenge, plus link requires a SITE-OWNER SIGNATURE
// so a party who controls only the DNS cannot bind the domain to a site they do not
// own (M6).
//
// TWO-RECORD GATE: verify requires TXT (ownership: `_suize-verify.<domain>` ==
// nonce) AND CNAME (routing: `<domain>` -> `<base36(siteId)>.<baseDomain>`) — we
// NEVER call link_domain for a domain that won't actually serve. While either is
// missing the response is HTTP 200 `status:"pending"` with `txtOk`/`cnameOk` flags
// and a `detail` naming the missing/propagating record. On a successful link the
// response carries `sslStatus`: the Cloudflare custom-hostname state when the CF
// adapter is on, or `"manual"` when it is off (manual-CNAME mode). See the OPERATOR
// REQUIREMENT note in cloudflare.ts for the CF_API_TOKEN + CF_ZONE_ID + CF-for-SaaS
// setup that enables auto-SSL.
//
// DNS-NONCE (was a security bug): the TXT challenge used to be
// sha256(deployWalletKey : siteId : domain) — a PUBLIC value DERIVED FROM THE
// SIGNING KEY. Publishing it in DNS (its entire purpose) leaked a function of the
// secret to the world. It is now a RANDOM per-request nonce, generated with a CSPRNG
// and persisted server-side (challengeStore), never derived from any secret.
// ---------------------------------------------------------------------------

const txtName = (domain: string): string => `_suize-verify.${domain}`;

// ── Random-nonce challenge store ────────────────────────────────────────────
// A CSPRNG nonce per {siteId, domain}, persisted in-memory until verified or it
// expires. Stateless determinism is GONE on purpose — the old scheme leaked a
// function of the signing key. A process restart simply invalidates pending
// challenges (the caller re-requests one). Keyed by `<siteId>:<domain>`.
const CHALLENGE_TTL_MS = 60 * 60 * 1000; // 1h to publish the TXT and verify.
interface PendingChallenge {
  token: string;
  expires: number;
}
const challengeStore = new Map<string, PendingChallenge>();

const challengeKey = (siteId: string, domain: string): string =>
  `${siteId}:${domain.toLowerCase()}`;

/** Mint + persist a fresh random challenge token for {siteId, domain}. */
const issueChallenge = (siteId: string, domain: string): string => {
  const token = randomBytes(24).toString("hex"); // 192-bit, unguessable
  challengeStore.set(challengeKey(siteId, domain), {
    token,
    expires: Date.now() + CHALLENGE_TTL_MS,
  });
  return token;
};

/** The currently-valid (non-expired) challenge token for {siteId, domain}, or null. */
const currentChallenge = (siteId: string, domain: string): string | null => {
  const key = challengeKey(siteId, domain);
  const c = challengeStore.get(key);
  if (!c) return null;
  if (c.expires < Date.now()) {
    challengeStore.delete(key);
    return null;
  }
  return c.token;
};

// Sweep expired challenges so the map can't grow unbounded.
setInterval(() => {
  const now = Date.now();
  for (const [k, c] of challengeStore) if (c.expires < now) challengeStore.delete(k);
}, CHALLENGE_TTL_MS).unref?.();

// ── Auth-nonce store (single-use, replay-resistant) ─────────────────────────
// A CSPRNG nonce minted by GET /auth/nonce (or piggy-backed on the link ISSUE
// response), persisted in-memory with a short TTL until it is BURNED on the first
// successful verify. The domain-op authority is a zkLogin personal-message
// signature that BINDS this nonce to the exact op (link/unlink + params); the
// nonce being single-use means a captured signature can never be replayed after
// the op lands. Mirrors `challengeStore`'s mint/lookup/sweep shape.
const AUTH_NONCE_TTL_MS = 5 * 60 * 1000; // 5 min to sign + submit.
const authNonceStore = new Map<string, number>(); // nonce -> expires (ms)

/** Mint + persist a fresh single-use auth nonce (192-bit hex). */
const issueAuthNonce = (): string => {
  const nonce = randomBytes(24).toString("hex");
  authNonceStore.set(nonce, Date.now() + AUTH_NONCE_TTL_MS);
  return nonce;
};

/** True iff `nonce` is live (known + unexpired). Lazily evicts an expired entry. */
const authNonceLive = (nonce: string): boolean => {
  const expires = authNonceStore.get(nonce);
  if (expires === undefined) return false;
  if (expires < Date.now()) {
    authNonceStore.delete(nonce);
    return false;
  }
  return true;
};

/** Burn a nonce (single-use) after a successful verify. */
const burnAuthNonce = (nonce: string): void => {
  authNonceStore.delete(nonce);
};

// Sweep expired auth nonces so the map can't grow unbounded.
setInterval(() => {
  const now = Date.now();
  for (const [n, expires] of authNonceStore) if (expires < now) authNonceStore.delete(n);
}, AUTH_NONCE_TTL_MS).unref?.();

/**
 * Recover the Sui address that signed `expectedMessage` as a personal message.
 *
 * REUSES the exact primitive the WS auth uses (`verifyPersonalMessageSignature`
 * from @mysten/sui/verify — zkLogin-aware via the Sui client): it recovers the
 * signer's public key from the base64 personal-message `signature` over the UTF-8
 * bytes of `expectedMessage`, and we return `toSuiAddress()`. The caller builds
 * `expectedMessage` from the op params + the server-issued nonce, so a valid
 * signature here proves the holder of THAT address authorized THIS exact op.
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
// │ `buildDeployUnlinkAuthMessage`) bound to a server-issued single-use nonce.  │
// │ The client cannot forge an address it does not hold the key for, and the    │
// │ op-bound + nonce-fresh message makes a captured signature non-replayable    │
// │ against a different op or after the nonce is burned. The recovered address  │
// │ is then required to equal `Site.owner` below — a real cryptographic         │
// │ ownership proof, not a UX gate.                                             │
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
 * zkLogin personal-message signature (op-bound, nonce-fresh, single-use — see the
 * CRYPTOGRAPHIC AUTHORITY note above), NOT a client-claimed field. The owner
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

// ---------------------------------------------------------------------------
// Renewal join (subscription ↔ site) — the on-chain reads + the cap-signed
// RenewalRegistry writes behind POST/DELETE /deploy/renewal and the relayer.
//
// The registry (`renewal_registry::RenewalRegistry`) maps SubRef{account_id,
// sub_key} -> site id; the relayer walks it each tick to know which site's
// Walrus storage a due subscription renews. Linking is gated THREE ways: (a)
// the signer must be the rail Account.owner (verified on-chain — closes the
// steal-a-stranger's-subscription hole: without it, any site owner could point
// their site at someone ELSE's subscription and drain that stranger's Account
// every period), (b) the subscription's on-chain terms must actually fund the
// Deploy renewal (payee == the Deploy merchant, period_cap >= the price), and
// (c) the site must be a v2 Site carrying its Walrus Blob OBJECT ids (a pre-v2
// site has nothing the relayer could extend).
// ---------------------------------------------------------------------------

/** Read the rail `Account<USDC>`'s `owner` address, or null if unreadable/not an Account. */
const accountOwner = async (accountId: string): Promise<string | null> => {
  try {
    const res = await suiClient().getObject({ id: accountId, options: { showContent: true } });
    const content = res.data?.content;
    if (!content || content.dataType !== "moveObject") return null;
    if (!content.type.startsWith(`${ACCOUNT_PACKAGE}::account::Account<`)) return null;
    const owner = (content.fields as Record<string, unknown>).owner;
    return typeof owner === "string" ? owner : null;
  } catch {
    return null;
  }
};

/** The on-chain terms of a rail subscription (the relayer's due/cancelled source). */
export interface SubscriptionTerms {
  payee: string;
  periodCap: number;
  periodMs: number;
  lastChargedMs: number;
}

/**
 * Read the `Subscription` dynamic field keyed by `subKey` (a raw `u64`) on the
 * rail Account. Returns null when the field is missing (never created OR
 * cancelled — `cancel_subscription` removes the df) or unreadable. EXPORTED for
 * the relayer (its cancelled-check + due-check both read this).
 */
export const readSubscription = async (
  accountId: string,
  subKey: number,
): Promise<SubscriptionTerms | null> => {
  try {
    const field = await suiClient().getDynamicFieldObject({
      parentId: accountId,
      name: { type: "u64", value: String(subKey) },
    });
    const content = field.data?.content;
    if (!content || content.dataType !== "moveObject") return null;
    // The df object is Field<u64, Subscription>; `value` carries the struct
    // (rendered as { type, fields } or flat depending on RPC) — read both shapes.
    const value = (content.fields as Record<string, unknown>).value as
      | { fields?: Record<string, unknown> }
      | Record<string, unknown>
      | undefined;
    const f = ((value as { fields?: Record<string, unknown> })?.fields ?? value) as
      | Record<string, unknown>
      | undefined;
    if (!f || typeof f.payee !== "string") return null;
    return {
      payee: f.payee,
      periodCap: toNum(f.period_cap),
      periodMs: toNum(f.period_ms),
      lastChargedMs: toNum(f.last_charged_ms),
    };
  } catch {
    return null;
  }
};

/**
 * Read a v2 Site's two Walrus Blob OBJECT ids (what `extend_blob` extends).
 * Returns null for a missing/pre-v2 site. EXPORTED for the relayer.
 */
export const siteBlobObjects = async (
  siteId: string,
): Promise<{ quilt: string; manifest: string } | null> => {
  try {
    const res = await suiClient().getObject({ id: siteId, options: { showContent: true } });
    const content = res.data?.content;
    if (!content || content.dataType !== "moveObject") return null;
    if (content.type !== `${DEPLOY_PACKAGE}::site::Site`) return null;
    const fields = content.fields as Record<string, unknown>;
    const quilt = fields.quilt_blob_object;
    const manifest = fields.manifest_blob_object;
    if (typeof quilt !== "string" || typeof manifest !== "string") return null;
    if (!SUI_ADDRESS_RE.test(quilt) || !SUI_ADDRESS_RE.test(manifest)) return null;
    return { quilt, manifest };
  } catch {
    return null;
  }
};

/**
 * The site id the subscription `{accountId, subKey}` currently renews, from the
 * RenewalRegistry's `Table<SubRef, ID>` (read the registry → its table UID → the
 * SubRef-keyed dynamic field). Null when not linked.
 */
const renewalSiteFor = async (accountId: string, subKey: number): Promise<string | null> => {
  try {
    // The Table's dynamic fields hang off the TABLE's UID, not the registry's.
    const reg = await suiClient().getObject({
      id: RENEWAL_REGISTRY_OBJECT,
      options: { showContent: true },
    });
    const content = reg.data?.content;
    if (!content || content.dataType !== "moveObject") return null;
    const subs = (content.fields as Record<string, unknown>).subs as
      | { fields?: { id?: { id?: string } } }
      | undefined;
    const tableId = subs?.fields?.id?.id;
    if (!tableId) return null;

    const field = await suiClient().getDynamicFieldObject({
      parentId: tableId,
      name: {
        type: `${DEPLOY_PACKAGE}::renewal_registry::SubRef`,
        value: { account_id: accountId, sub_key: String(subKey) },
      },
    });
    const fieldContent = field.data?.content;
    if (fieldContent?.dataType === "moveObject") {
      const value = (fieldContent.fields as Record<string, unknown>).value;
      if (typeof value === "string") return value;
    }
  } catch {
    /* not linked */
  }
  return null;
};

/** Service-wallet-signed `link_renewal` (cap↔site binding is the on-chain auth). */
const linkRenewalOnChain = async (
  siteId: string,
  accountId: string,
  subKey: number,
): Promise<string> => {
  const cap = await findAdminCapForSite(siteId);
  if (!cap) throw new DeployError("SiteAdminCap not found for site (cannot link renewal)", 409);

  // Abort mapping: renewal_registry 0 = ERenewalTaken (sub already funds a site) → 409.
  const taken = (error: string): DeployError | null => {
    const abort = parseMoveAbort(error);
    return abort?.module === "renewal_registry" && abort.code === 0
      ? new DeployError("subscription already linked to a site (unlink it first)", 409)
      : null;
  };

  const tx = new Transaction();
  tx.moveCall({
    target: PACKAGE_IDS.DEPLOY.TARGETS.LINK_RENEWAL,
    arguments: [
      tx.object(VERSION_OBJECT),
      tx.object(RENEWAL_REGISTRY_OBJECT),
      tx.object(cap),
      tx.object(siteId),
      tx.pure.id(accountId),
      tx.pure.u64(subKey),
    ],
  });

  try {
    const res = await suiClient().signAndExecuteTransaction({
      transaction: tx,
      signer: wallet(),
      options: { showEffects: true },
    });
    if (res.effects?.status?.status === "failure") {
      const err = taken(res.effects.status.error ?? "");
      if (err) throw err;
      throw new DeployError(`link_renewal aborted: ${res.effects.status.error ?? "unknown"}`, 502);
    }
    return res.digest;
  } catch (err) {
    if (err instanceof DeployError) throw err;
    const dup = taken((err as Error).message ?? "");
    if (dup) throw dup;
    throw new DeployError(`link_renewal failed: ${(err as Error).message}`, 502);
  }
};

/**
 * Service-wallet-signed `unlink_renewal` for the subscription's CURRENT site
 * (read from the registry — the cap must be the linked site's own, per the Move
 * EWrongCap gate). EXPORTED for the relayer (it unlinks cancelled subs).
 */
export const unlinkRenewalOnChain = async (
  accountId: string,
  subKey: number,
): Promise<string> => {
  const siteId = await renewalSiteFor(accountId, subKey);
  if (!siteId) throw new DeployError("renewal not linked", 404);
  const cap = await findAdminCapForSite(siteId);
  if (!cap) throw new DeployError("SiteAdminCap not found for linked site", 409);

  // Abort mapping: renewal_registry 2 = ENoSuchRenewal (raced an earlier unlink) → 404.
  const missing = (error: string): DeployError | null => {
    const abort = parseMoveAbort(error);
    return abort?.module === "renewal_registry" && abort.code === 2
      ? new DeployError("renewal not linked", 404)
      : null;
  };

  const tx = new Transaction();
  tx.moveCall({
    target: PACKAGE_IDS.DEPLOY.TARGETS.UNLINK_RENEWAL,
    arguments: [
      tx.object(VERSION_OBJECT),
      tx.object(RENEWAL_REGISTRY_OBJECT),
      tx.object(cap),
      tx.pure.id(accountId),
      tx.pure.u64(subKey),
    ],
  });

  try {
    const res = await suiClient().signAndExecuteTransaction({
      transaction: tx,
      signer: wallet(),
      options: { showEffects: true },
    });
    if (res.effects?.status?.status === "failure") {
      const err = missing(res.effects.status.error ?? "");
      if (err) throw err;
      throw new DeployError(`unlink_renewal aborted: ${res.effects.status.error ?? "unknown"}`, 502);
    }
    return res.digest;
  } catch (err) {
    if (err instanceof DeployError) throw err;
    const gone = missing((err as Error).message ?? "");
    if (gone) throw gone;
    throw new DeployError(`unlink_renewal failed: ${(err as Error).message}`, 502);
  }
};

// The relayer signs its own charge_subscription/extend_blob PTBs with the SAME
// service wallet + RPC client — exported accessors so it never re-derives either
// (one key source: config.deployWalletKey; same lazy singletons).
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

  const cname = cnameTarget(siteId);

  // ── issue the challenge (no verify) ──────────────────────────────────────────
  // UNAUTHENTICATED on purpose: this step writes NOTHING on-chain — it only mints
  // DNS/nonce material. We mint (a) a FRESH RANDOM DNS challenge token (never
  // derived from the signing key) for the TXT record AND (b) a FRESH single-use
  // AUTH nonce the caller must SIGN (buildDeployLinkAuthMessage) for the verify
  // step. The owner gate runs ONLY on verify, where the signature is present.
  if (!verify) {
    const token = issueChallenge(siteId, domain);
    const nonce = issueAuthNonce();
    const res: DomainChallengeResponse = {
      domain,
      status: "pending",
      txtName: txtName(domain),
      txtValue: token,
      cname,
      nonce,
    };
    return json(res, 200, origin);
  }

  // ── verify path: CRYPTOGRAPHIC OWNER AUTH (op-bound, nonce-fresh, single-use) ──
  // The authority is a zkLogin personal-message signature over the EXACT op
  // message; the recovered address — NOT any client-claimed `requester` — must
  // equal Site.owner. Require { nonce, signature }, assert the nonce is live (else
  // 403 stale/unknown), reconstruct the exact message, recover the signer (else
  // 403 invalid signature), burn the nonce, then gate on owner.
  const nonce = typeof body?.nonce === "string" ? body.nonce.trim() : "";
  const signature = typeof body?.signature === "string" ? body.signature.trim() : "";
  if (!nonce || !signature) return json({ error: "nonce and signature required" }, 403, origin);
  if (!authNonceLive(nonce)) return json({ error: "stale or unknown nonce" }, 403, origin);

  const recovered = await verifyDeployRequester(
    buildDeployLinkAuthMessage(domain, siteId, nonce),
    signature,
  );
  if (!recovered) return json({ error: "invalid signature" }, 403, origin);
  burnAuthNonce(nonce); // single-use: replay-resistant once the op is attempted.

  const authErr = await authorizeSiteOwner(siteId, recovered);
  if (authErr) {
    return json({ error: authErr.message }, authErr.status, origin);
  }

  // ── verify path: there must be an outstanding (non-expired) challenge ─────────
  const token = currentChallenge(siteId, domain);
  if (!token) {
    return json(
      {
        domain,
        status: "pending",
        txtName: txtName(domain),
        txtValue: "",
        cname,
        detail: "no active challenge — request one first (POST /domains without verify)",
      },
      409,
      origin,
    );
  }

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
    else txtDetail = `TXT ${txtName(domain)} present but does not match the challenge nonce`;
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

  // TXT + CNAME verified, owner signature already proven above — link on-chain,
  // then burn the single-use DNS challenge (the auth nonce is already burned).
  let digest: string;
  try {
    digest = await linkDomainOnChain(siteId, domain);
  } catch (err) {
    if (err instanceof DeployError) return json({ error: err.message }, err.status, origin);
    throw err;
  }
  challengeStore.delete(challengeKey(siteId, domain));

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
  // a zkLogin personal-message signature over the op-bound, nonce-fresh message
  // (buildDeployUnlinkAuthMessage); the RECOVERED address — not a client-claimed
  // field — must equal Site.owner for the site the domain currently points at. A
  // service-owned / unowned site is REJECTED (403), mirroring link.
  const currentSiteId = await siteForDomain(d);
  if (!currentSiteId) return json({ error: "domain not linked" }, 404, origin);

  // DELETE carries { nonce, signature } in the (size-capped) JSON body.
  const parsed = await readDomainsBody(req);
  if (!parsed.ok) return json({ error: "invalid or oversized body" }, 400, origin);
  const nonce = typeof parsed.body?.nonce === "string" ? parsed.body.nonce.trim() : "";
  const signature = typeof parsed.body?.signature === "string" ? parsed.body.signature.trim() : "";
  if (!nonce || !signature) return json({ error: "nonce and signature required" }, 403, origin);
  if (!authNonceLive(nonce)) return json({ error: "stale or unknown nonce" }, 403, origin);

  const recovered = await verifyDeployRequester(
    buildDeployUnlinkAuthMessage(d, nonce),
    signature,
  );
  if (!recovered) return json({ error: "invalid signature" }, 403, origin);
  burnAuthNonce(nonce);

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
// CHARGE↔Deploy join routes — the 402 quote + the sponsored-charge builder.
//
// POST /deploy/quote  -> the 402-shaped price the caller settles before a deploy.
// POST /deploy/charge -> build + Enoki-sponsor the $0.50 `charge` PTB for the
//                        caller's Account; the caller signs `bytes` locally and
//                        executes via the existing POST /execute path, then passes
//                        the resulting digest to POST /deploy as `chargeDigest`.
//
// Both 503 with a precise reason until the join is live (account published + Deploy
// merchant pinned) — mirrors the deploy module's 0x0-package gate. The actual chain
// write (the charge) is signed by the CALLER's local zkLogin session; the backend
// NEVER signs an owner tx — it only builds the sponsored bytes.
// ---------------------------------------------------------------------------

const chargeNotReady = (origin: string | null): Response =>
  json({ error: chargeGateReason() }, 503, origin);

const handleDeployQuote = (req: Request, origin: string | null, server?: Server<unknown>): Response => {
  if (!takeToken(getIp(req, server))) return json({ error: "too many requests" }, 429, origin, { "Retry-After": "1" });
  if (!chargeGateReady()) return chargeNotReady(origin);
  return json(deployQuote(), 200, origin);
};

const handleDeployCharge = async (req: Request, origin: string | null, server?: Server<unknown>): Promise<Response> => {
  if (!takeToken(getIp(req, server))) return json({ error: "too many requests" }, 429, origin, { "Retry-After": "1" });
  if (!chargeGateReady()) return chargeNotReady(origin);

  const parsed = await readDomainsBody(req); // reuses the size-capped JSON reader
  if (!parsed.ok) return json({ error: "invalid or oversized body" }, 400, origin);
  const body = parsed.body as Partial<DeployChargeRequest>;

  try {
    const res = await buildDeployCharge({
      account: String(body?.account ?? ""),
      sender: String(body?.sender ?? ""),
      memo: typeof body?.memo === "string" ? body.memo : undefined,
    });
    return json(res, 200, origin);
  } catch (err) {
    // ChargeError (bad input / gate) and SponsorError (Enoki/quota) both carry a
    // client-safe message + HTTP-equivalent status. Anything else is a 500.
    if (err instanceof ChargeError) return json({ error: err.message }, err.status, origin);
    if (err instanceof SponsorError) return json({ error: err.message }, err.status, origin);
    console.error("[deploy/charge]", (err as Error).message);
    return json({ error: "could not build deploy charge" }, 500, origin);
  }
};

// POST /execute — submit { digest, signature } for the sponsored charge the caller
// signed locally. The minimal HTTP execute slice the join needs (the full SPEC §6
// HTTP-only sponsor transport is a separate refactor). Gated like the rest of the
// join; SponsorError maps to its own status.
const handleExecute = async (req: Request, origin: string | null, server?: Server<unknown>): Promise<Response> => {
  if (!takeToken(getIp(req, server))) return json({ error: "too many requests" }, 429, origin, { "Retry-After": "1" });
  if (!chargeGateReady()) return chargeNotReady(origin);

  const parsed = await readDomainsBody(req);
  if (!parsed.ok) return json({ error: "invalid or oversized body" }, 400, origin);

  try {
    const res = await executeDeployCharge({
      digest: typeof parsed.body?.digest === "string" ? parsed.body.digest : undefined,
      signature: typeof parsed.body?.signature === "string" ? parsed.body.signature : undefined,
    });
    return json(res, 200, origin);
  } catch (err) {
    if (err instanceof ChargeError) return json({ error: err.message }, err.status, origin);
    if (err instanceof SponsorError) return json({ error: err.message }, err.status, origin);
    console.error("[deploy/execute]", (err as Error).message);
    return json({ error: "could not execute charge" }, 500, origin);
  }
};

// POST /deploy/subscribe — build + Enoki-sponsor the `create_subscription` PTB
// for the caller's Account (the $19.99/mo Deploy subscription terms). The CALLER
// signs locally + submits via POST /execute; the backend never signs this owner
// tx. Gated like the other charge endpoints.
const handleDeploySubscribe = async (req: Request, origin: string | null, server?: Server<unknown>): Promise<Response> => {
  if (!takeToken(getIp(req, server))) return json({ error: "too many requests" }, 429, origin, { "Retry-After": "1" });
  if (!chargeGateReady()) return chargeNotReady(origin);

  const parsed = await readDomainsBody(req); // reuses the size-capped JSON reader
  if (!parsed.ok) return json({ error: "invalid or oversized body" }, 400, origin);

  try {
    const res = await buildDeploySubscribe({
      account: String(parsed.body?.account ?? ""),
      sender: String(parsed.body?.sender ?? ""),
    });
    return json(res, 200, origin);
  } catch (err) {
    if (err instanceof ChargeError) return json({ error: err.message }, err.status, origin);
    if (err instanceof SponsorError) return json({ error: err.message }, err.status, origin);
    console.error("[deploy/subscribe]", (err as Error).message);
    return json({ error: "could not build subscription" }, 500, origin);
  }
};

// POST /deploy/account — build + Enoki-sponsor the `create_account<USDC>` PTB for
// a zkLogin user with NO rail Account yet (the first rung: the CLI can't sign for
// a zkLogin address, and `create_account` sets owner = sender). The CALLER signs
// locally + submits via POST /execute; the Account id comes from the executed
// tx's AccountCreated event. Gated + rate-limited like the other builders.
const handleDeployAccountCreate = async (req: Request, origin: string | null, server?: Server<unknown>): Promise<Response> => {
  if (!takeToken(getIp(req, server))) return json({ error: "too many requests" }, 429, origin, { "Retry-After": "1" });
  if (!chargeGateReady()) return chargeNotReady(origin);

  const parsed = await readDomainsBody(req); // reuses the size-capped JSON reader
  if (!parsed.ok) return json({ error: "invalid or oversized body" }, 400, origin);

  try {
    const res = await buildDeployAccountCreate(String(parsed.body?.sender ?? ""));
    return json(res, 200, origin);
  } catch (err) {
    if (err instanceof ChargeError) return json({ error: err.message }, err.status, origin);
    if (err instanceof SponsorError) return json({ error: err.message }, err.status, origin);
    console.error("[deploy/account]", (err as Error).message);
    return json({ error: "could not build account creation" }, 500, origin);
  }
};

// ---------------------------------------------------------------------------
// POST /deploy/renewal — link a rail subscription to a site's storage renewal.
// DELETE /deploy/renewal — unlink it.
//
// Same cryptographic authority shape as the domain ops (op-bound message + a
// single-use server nonce, signer recovered server-side) PLUS the on-chain
// checks documented at the renewal-join helpers above. LINK authority is the
// rail Account.owner ONLY (their money); UNLINK is accepted from the
// Account.owner (stop my sub renewing) OR the Site.owner (stop renewing my
// site) — both ends of the join may sever it, neither can forge the other.
// ---------------------------------------------------------------------------

/** Coerce a body subKey (number or numeric string) to a non-negative integer, or null. */
const parseSubKey = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
};

const handleRenewalLink = async (req: Request, origin: string | null, server?: Server<unknown>): Promise<Response> => {
  if (!DEPLOY_ENABLED || !CHAIN_IDS_PUBLISHED) return notConfigured(origin);
  if (!takeToken(getIp(req, server))) return json({ error: "too many requests" }, 429, origin, { "Retry-After": "1" });
  if (!chargeGateReady()) return chargeNotReady(origin);

  const parsed = await readDomainsBody(req);
  if (!parsed.ok) return json({ error: "invalid or oversized body" }, 400, origin);
  const body = parsed.body as Partial<DeployRenewalLinkRequest>;

  const siteId = String(body?.siteId ?? "").trim();
  const accountId = String(body?.accountId ?? "").trim();
  const subKey = parseSubKey(body?.subKey);
  if (!SUI_ADDRESS_RE.test(siteId)) return json({ error: "invalid siteId" }, 400, origin);
  if (!SUI_ADDRESS_RE.test(accountId)) return json({ error: "invalid accountId" }, 400, origin);
  if (subKey === null) return json({ error: "invalid subKey" }, 400, origin);

  // ── cryptographic auth (op-bound, nonce-fresh, single-use) ──────────────────
  const nonce = typeof body?.nonce === "string" ? body.nonce.trim() : "";
  const signature = typeof body?.signature === "string" ? body.signature.trim() : "";
  if (!nonce || !signature) return json({ error: "nonce and signature required" }, 403, origin);
  if (!authNonceLive(nonce)) return json({ error: "stale or unknown nonce" }, 403, origin);

  const recovered = await verifyDeployRequester(
    buildDeployRenewalLinkAuthMessage(siteId, accountId, subKey, nonce),
    signature,
  );
  if (!recovered) return json({ error: "invalid signature" }, 403, origin);
  burnAuthNonce(nonce);

  // ── on-chain check 1: the signer owns the Account being debited ─────────────
  // THE critical gate: only the person whose Account pays each period can
  // authorize the join (a site owner can never renew on a stranger's sub).
  const owner = await accountOwner(accountId);
  if (!owner) return json({ error: "rail Account not found" }, 404, origin);
  if (owner.toLowerCase() !== recovered.toLowerCase()) {
    return json({ error: "signer is not the Account owner" }, 403, origin);
  }

  // ── on-chain check 2: the subscription's terms actually fund Deploy ─────────
  const sub = await readSubscription(accountId, subKey);
  if (!sub) return json({ error: "subscription not found on the Account" }, 404, origin);
  if (sub.payee.toLowerCase() !== SUIZE_DEPLOY_MERCHANT.toLowerCase()) {
    return json({ error: "subscription payee is not the Deploy merchant" }, 400, origin);
  }
  if (sub.periodCap < DEPLOY_SUB_PRICE_USDC) {
    return json({ error: "subscription period cap is below the Deploy price" }, 400, origin);
  }

  // ── on-chain check 3: a v2 Site carrying its Walrus Blob OBJECT ids ──────────
  const blobs = await siteBlobObjects(siteId);
  if (!blobs) {
    return json(
      { error: "site has no Walrus blob objects (pre-v2 site — redeploy to enable renewal)" },
      400,
      origin,
    );
  }

  let digest: string;
  try {
    digest = await linkRenewalOnChain(siteId, accountId, subKey);
  } catch (err) {
    if (err instanceof DeployError) return json({ error: err.message }, err.status, origin);
    throw err;
  }

  const res: DeployRenewalResponse = { siteId, accountId, subKey, digest };
  return json(res, 200, origin);
};

const handleRenewalUnlink = async (req: Request, origin: string | null, server?: Server<unknown>): Promise<Response> => {
  if (!DEPLOY_ENABLED || !CHAIN_IDS_PUBLISHED) return notConfigured(origin);
  if (!takeToken(getIp(req, server))) return json({ error: "too many requests" }, 429, origin, { "Retry-After": "1" });

  const parsed = await readDomainsBody(req);
  if (!parsed.ok) return json({ error: "invalid or oversized body" }, 400, origin);
  const body = parsed.body as Partial<DeployRenewalUnlinkRequest>;

  const accountId = String(body?.accountId ?? "").trim();
  const subKey = parseSubKey(body?.subKey);
  if (!SUI_ADDRESS_RE.test(accountId)) return json({ error: "invalid accountId" }, 400, origin);
  if (subKey === null) return json({ error: "invalid subKey" }, 400, origin);

  const nonce = typeof body?.nonce === "string" ? body.nonce.trim() : "";
  const signature = typeof body?.signature === "string" ? body.signature.trim() : "";
  if (!nonce || !signature) return json({ error: "nonce and signature required" }, 403, origin);
  if (!authNonceLive(nonce)) return json({ error: "stale or unknown nonce" }, 403, origin);

  const recovered = await verifyDeployRequester(
    buildDeployRenewalUnlinkAuthMessage(accountId, subKey, nonce),
    signature,
  );
  if (!recovered) return json({ error: "invalid signature" }, 403, origin);
  burnAuthNonce(nonce);

  // The join must exist (also resolves which site — and so which Site.owner —
  // may sever it alongside the Account.owner).
  const siteId = await renewalSiteFor(accountId, subKey);
  if (!siteId) return json({ error: "renewal not linked" }, 404, origin);

  const [aOwner, sOwner] = await Promise.all([accountOwner(accountId), siteOwner(siteId)]);
  const r = recovered.toLowerCase();
  const authorized =
    (aOwner && aOwner.toLowerCase() === r) || (sOwner && sOwner.toLowerCase() === r);
  if (!authorized) {
    return json({ error: "signer is neither the Account owner nor the Site owner" }, 403, origin);
  }

  let digest: string;
  try {
    digest = await unlinkRenewalOnChain(accountId, subKey);
  } catch (err) {
    if (err instanceof DeployError) return json({ error: err.message }, err.status, origin);
    throw err;
  }

  const res: DeployRenewalResponse = { siteId, accountId, subKey, digest };
  return json(res, 200, origin);
};

// ---------------------------------------------------------------------------
// GET /auth/nonce — issue a single-use, short-TTL auth nonce the client signs
// (op-bound, via the shared message builders) for a link-verify / unlink op. The
// nonce is the freshness factor that makes a captured signature non-replayable.
// Rate-limited like the other read ops; writes nothing.
// ---------------------------------------------------------------------------

const handleAuthNonce = (req: Request, origin: string | null, server?: Server<unknown>): Response => {
  if (!DEPLOY_ENABLED || !CHAIN_IDS_PUBLISHED) return notConfigured(origin);
  if (!takeToken(getIp(req, server))) return json({ error: "too many requests" }, 429, origin, { "Retry-After": "1" });
  const res: DeployNonceResponse = { nonce: issueAuthNonce() };
  return json(res, 200, origin);
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
  // The CHARGE↔Deploy join: live only when the rail package is published AND the
  // Deploy merchant address is pinned. When false the deploy route runs un-gated
  // (auth + rate limits only — "abuse mitigation, not billing").
  chargeGate: chargeInfo.enabled,
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

  // CHARGE↔Deploy join — the 402 quote + the sponsored-charge builder. Matched
  // BEFORE the bare /deploy so the more specific subpaths win.
  if ((req.method === "POST" || req.method === "GET") && path === "/deploy/quote") {
    return Promise.resolve(handleDeployQuote(req, origin, server));
  }
  if (req.method === "POST" && path === "/deploy/charge") return handleDeployCharge(req, origin, server);
  // The minimal HTTP execute slice the join needs (not the full SPEC §6 transport).
  if (req.method === "POST" && path === "/execute") return handleExecute(req, origin, server);

  // Subscription leg — the sponsored create_account/create_subscription builders
  // + the on-chain subscription↔site renewal join the relayer reads.
  if (req.method === "POST" && path === "/deploy/account") return handleDeployAccountCreate(req, origin, server);
  if (req.method === "POST" && path === "/deploy/subscribe") return handleDeploySubscribe(req, origin, server);
  if (req.method === "POST" && path === "/deploy/renewal") return handleRenewalLink(req, origin, server);
  if (req.method === "DELETE" && path === "/deploy/renewal") return handleRenewalUnlink(req, origin, server);

  if (req.method === "POST" && path === "/deploy") return handleDeploy(req, origin, server);
  if (req.method === "GET" && path === "/auth/nonce") return Promise.resolve(handleAuthNonce(req, origin, server));
  if (req.method === "GET" && path === "/sites") return handleListSites(req, url, origin, server);

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
