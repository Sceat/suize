// Deploy module — "Suize Deploy" (Vercel for Sui). The ORCHESTRATION BRAIN.
//
// An agent (or the dashboard) POSTs a built static site as a tar; this module:
//   1. unpacks it in-memory, enforcing size + file-count caps,
//   2. uploads ALL files as ONE Walrus quilt via the HTTP publisher (the publisher
//      pays WAL; the deploy wallet only pays the on-chain create_site gas),
//   3. builds a manifest JSON (path -> {patch, sha256, ct, size}), stores it as a
//      Walrus blob, computes its sha256,
//   4. mints a FRESH on-chain `deploy_sui::site::Site` (signed by the deploy
//      service wallet — NOT Enoki-sponsored; the agent signs nothing),
//   5. returns { siteId, subdomain: base36(siteId), url, version: 1, digest }.
//
// Every deploy mints a NEW immutable Site (new id -> new URL) — there is no
// overwrite path, which is what makes the OPEN route safe. Custom domains are
// linked via a DNS-TXT challenge + on-chain `domain_registry::link_domain`, with
// an optional Cloudflare-for-SaaS auto-SSL adapter.
//
// 503s cleanly (like the handle module) when DEPLOY_WALLET_PRIVATE_KEY is unset,
// so the rest of the backend boots before the deploy wallet is provisioned.
import { createHash, randomBytes } from "node:crypto";
import { resolveTxt } from "node:dns/promises";
import type { Server } from "bun";
import { parseTar, type ParsedTarFileItem } from "nanotar";
import { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import { fromBase64 } from "@mysten/sui/utils";
import { verifyPersonalMessageSignature } from "@mysten/sui/verify";
import { PACKAGE_IDS } from "@suize/shared";
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
import {
  cloudflareEnabled,
  provisionCustomHostname,
  removeCustomHostname,
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
const DEPLOY_PACKAGE = PACKAGE_IDS.DEPLOY.PACKAGE;
const VERSION_OBJECT = PACKAGE_IDS.DEPLOY.VERSION_OBJECT;
const DOMAIN_REGISTRY_OBJECT = PACKAGE_IDS.DEPLOY.DOMAIN_REGISTRY_OBJECT;
const CHAIN_IDS_PUBLISHED =
  DEPLOY_PACKAGE !== "0x0" &&
  VERSION_OBJECT !== "0x0" &&
  DOMAIN_REGISTRY_OBJECT !== "0x0";

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
  if (!_suiClient) _suiClient = new SuiJsonRpcClient({ url: config.suiRpcUrl, network: "testnet" });
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
// service wallet inside the Move fn (for future domain ops). We parse the created
// Site object id out of objectChanges.
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
  sizeBytes: number,
  fileCount: number,
): Promise<CreatedSite> => {
  const tx = new Transaction();
  const manifestHashBytes = Uint8Array.from(Buffer.from(manifestHashHex, "hex"));

  // create_site(v: &Version, name: String, owner: address, quilt_id: String,
  //   manifest_blob_id: String, manifest_hash: vector<u8>, size_bytes: u64,
  //   file_count: u64, ctx): SiteAdminCap
  // size_bytes/file_count are recorded on-chain so the read endpoints surface
  // real metrics (no off-chain manifest fetch needed). The returned cap is
  // transferred to the sender inside the move fn (SPEC §3: "returns SiteAdminCap
  // to the caller (service wallet)"), so we don't capture the return value here —
  // the wallet receives it as an owned object.
  tx.moveCall({
    target: PACKAGE_IDS.DEPLOY.TARGETS.CREATE_SITE,
    arguments: [
      tx.object(VERSION_OBJECT),
      tx.pure.string(name),
      tx.pure.address(owner),
      tx.pure.string(quiltId),
      tx.pure.string(manifestBlobId),
      tx.pure.vector("u8", manifestHashBytes),
      tx.pure.u64(sizeBytes),
      tx.pure.u64(fileCount),
    ],
  });

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

  // Confirm finality before we hand back a URL the worker will immediately read.
  try {
    await suiClient().waitForTransaction({ digest: res.digest });
  } catch {
    // Non-fatal: the tx is already executed; the worker's RPC read may just lag a
    // moment. We still return the id.
  }

  return { siteId: created.objectId, digest: res.digest };
};

// ---------------------------------------------------------------------------
// POST /deploy — the one-call deploy flow.
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

  const ownerRaw = String(form.get("owner") ?? "").trim();
  let owner = serviceAddress();
  if (ownerRaw) {
    if (!SUI_ADDRESS_RE.test(ownerRaw)) return json({ error: "invalid owner address" }, 400, origin);
    owner = ownerRaw;
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
  const totalBytes = files.reduce((n, f) => n + f.data.byteLength, 0);
  if (totalBytes > MAX_BUNDLE_BYTES) return json({ error: "bundle too large" }, 413, origin);

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
    const { quiltId, patchIds } = await storeQuilt(quiltInputs);

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
    const manifestBlobId = await storeBlob(manifestBytes);

    // ── 4. mint the on-chain Site ───────────────────────────────────────────────
    // size_bytes/file_count are the real bundle metrics (computed above when we
    // validated the caps) — recorded on-chain so the read endpoints don't return 0.
    const { siteId, digest } = await createSiteOnChain(
      name,
      owner,
      quiltId,
      manifestBlobId,
      manifestHashHex,
      totalBytes,
      files.length,
    );

    // ── 5. respond ──────────────────────────────────────────────────────────────
    const body: DeployResponse = {
      siteId,
      subdomain: subdomainFor(siteId),
      url: urlFor(siteId),
      version: 1,
      digest,
    };
    return json(body, 200, origin);
  } catch (err) {
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
// (or { verify: true }) verifies the TXT + links on-chain. DELETE /domains/:domain
// unlinks. Both link AND unlink require proof of control via the SAME DNS-TXT
// challenge, plus link requires a SITE-OWNER SIGNATURE so a party who controls only
// the DNS cannot bind the domain to a site they do not own (M6).
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

const cnameTarget = (siteId: string): string =>
  `${subdomainFor(siteId)}.${config.deployBaseDomain}`;

// ── Site-owner authorization (M6/M1) ────────────────────────────────────────
// The on-chain Site has an `owner` address. Linking/unlinking a custom domain to a
// site must be authorized by that owner — DNS control alone is not enough (it would
// let a DNS holder bind a domain to ANY siteId, including one they don't own). The
// caller proves control of the owner address by signing a deterministic challenge
// message with their wallet (same personal-message scheme as the WS auth). A site
// minted WITHOUT an explicit owner (owner == the service wallet) is service-managed
// and skips the owner-signature gate (there is no external owner to authorize).

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

/** The exact message the site owner must sign to authorize a domain op. */
const ownerAuthMessage = (action: "link" | "unlink", siteId: string, domain: string): string =>
  `suize-deploy:${action}:${siteId}:${domain.toLowerCase()}`;

/**
 * Verify `signature` is a valid personal-message signature over
 * ownerAuthMessage(...) by `expectedOwner`. Mirrors the WS auth verify
 * (verifyPersonalMessageSignature recovers the signer; we assert it equals the
 * Site's on-chain owner). Returns true on a verified owner signature.
 */
const verifyOwnerSignature = async (
  expectedOwner: string,
  message: string,
  signatureB64: string,
): Promise<boolean> => {
  try {
    const bytes = new TextEncoder().encode(message);
    const pubkey = await verifyPersonalMessageSignature(bytes, signatureB64, { client: suiClient() });
    return pubkey.toSuiAddress() === expectedOwner;
  } catch {
    return false;
  }
};

/**
 * Gate a domain op on site ownership. Returns null when authorized (or when the
 * site is service-owned, i.e. no external owner to authorize); otherwise a
 * DeployError the caller surfaces. `signature` is the caller-supplied personal
 * message signature over ownerAuthMessage(action, siteId, domain).
 */
const authorizeSiteOwner = async (
  action: "link" | "unlink",
  siteId: string,
  domain: string,
  signature: string | undefined,
): Promise<DeployError | null> => {
  const owner = await siteOwner(siteId);
  // A site with no readable owner, or owned by the service wallet itself, has no
  // external owner to authorize — these are service-managed and pass through.
  if (!owner || owner === serviceAddress()) return null;
  if (!signature) {
    return new DeployError("site-owner signature required", 401);
  }
  const ok = await verifyOwnerSignature(owner, ownerAuthMessage(action, siteId, domain), signature);
  if (!ok) return new DeployError("invalid site-owner signature", 403);
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
  // Optional site-owner signature (base64) over ownerAuthMessage("link", …).
  const signature = typeof body?.signature === "string" ? body.signature : undefined;

  if (!SUI_ADDRESS_RE.test(siteId)) return json({ error: "invalid siteId" }, 400, origin);
  if (!DOMAIN_RE.test(domain)) return json({ error: "invalid domain" }, 400, origin);

  const cname = cnameTarget(siteId);

  // SITE-OWNER AUTHORIZATION (M6) — checked on BOTH issue + verify so an attacker
  // who controls only the DNS can never bind the domain to a site they don't own.
  // A service-owned site (no external owner) passes through. We surface the exact
  // message the owner must sign so the client can prompt the wallet.
  const authErr = await authorizeSiteOwner("link", siteId, domain, signature);
  if (authErr) {
    return json(
      { error: authErr.message, signMessage: ownerAuthMessage("link", siteId, domain) },
      authErr.status,
      origin,
    );
  }

  // ── issue the challenge (no verify) ──────────────────────────────────────────
  // Mint a FRESH RANDOM nonce (never derived from the signing key) and persist it
  // server-side; the caller publishes it as the TXT value.
  if (!verify) {
    const token = issueChallenge(siteId, domain);
    const res: DomainChallengeResponse = {
      domain,
      status: "pending",
      txtName: txtName(domain),
      txtValue: token,
      cname,
    };
    return json(res, 200, origin);
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

  // ── verify the TXT, then link on-chain ───────────────────────────────────────
  let txtRecords: string[][];
  try {
    txtRecords = await resolveTxt(txtName(domain));
  } catch (err) {
    // NXDOMAIN / no TXT yet — still pending, not an error.
    return json(
      {
        domain,
        status: "pending",
        txtName: txtName(domain),
        txtValue: token,
        cname,
        detail: `TXT not found yet (${(err as Error).message})`,
      },
      200,
      origin,
    );
  }

  const flat = txtRecords.map((chunks) => chunks.join(""));
  if (!flat.includes(token)) {
    return json(
      {
        domain,
        status: "pending",
        txtName: txtName(domain),
        txtValue: token,
        cname,
        detail: "TXT record does not match the challenge",
      },
      200,
      origin,
    );
  }

  // TXT + owner both verified — link on-chain, then burn the single-use challenge.
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
  // setup). It now requires the SAME proof of control as linking: a site-owner
  // signature for the site the domain currently points at. The owner signs
  // ownerAuthMessage("unlink", <currentSiteId>, <domain>); the signature is passed
  // in the `x-site-owner-signature` header (DELETE bodies are unreliable). A
  // service-owned site (no external owner) passes through, mirroring link.
  const currentSiteId = await siteForDomain(d);
  if (!currentSiteId) return json({ error: "domain not linked" }, 404, origin);

  const signature = req.headers.get("x-site-owner-signature") ?? undefined;
  const authErr = await authorizeSiteOwner("unlink", currentSiteId, d, signature);
  if (authErr) {
    return json(
      { error: authErr.message, signMessage: ownerAuthMessage("unlink", currentSiteId, d) },
      authErr.status,
      origin,
    );
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
