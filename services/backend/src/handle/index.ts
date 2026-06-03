// Handle module — self-custody SuiNS handle issuance (Path B).
//
// Handles are `<name>@suize` (= `<name>.suize.sui` LEAF subnames). The backend
// custodies the `suize.sui` parent NFT (SUINS_PARENT_NFT_ID) and a separate
// issuer key (HANDLE_ISSUER_PRIVATE_KEY). It mints leaf subnames with
// @mysten/suins, signs them as the issuer, and SPONSORS the gas through the
// existing Enoki sponsor (sponsor pays, issuer signs as sender, then execute).
//
// Exposes:
//   GET  /handle/available?name=<name>  -> { available, reason? }
//   GET  /handle/me?address=<addr>      -> { handle|null, suggestedName? }
//   POST /handle/claim { name, address } -> { handle, txDigest }
//
// Redis is the SOURCE OF TRUTH for issued handles (keyed by address, so claim is
// idempotent); the SuiNS reverse record is only a backstop in /me. If the SuiNS
// secrets are NOT configured, every endpoint returns 503 "handle issuance not
// configured" so the rest of the backend (sponsor + waitlist) boots and runs
// fine before the owner finishes the SuiNS setup.
import Redis from "ioredis";
import { EnokiClient } from "@mysten/enoki";
import { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import { SuinsClient, SuinsTransaction } from "@mysten/suins";
import { config } from "../config";
import { json, getIp } from "../http";
import type {
  HandleAvailableResponse,
  HandleMeResponse,
  HandleClaimResponse,
} from "@suize/shared";

// ---------------------------------------------------------------------------
// Configuration gate. The module is "enabled" only when all three SuiNS knobs
// are present. Until then every route short-circuits to a clear 503 — the app
// must run before the owner registers `suize.sui` + custodies the parent NFT.
// ---------------------------------------------------------------------------

const HANDLE_ENABLED =
  Boolean(config.suinsParentNftId) &&
  Boolean(config.handleIssuerKey) &&
  Boolean(config.suinsParentDomain);

const notConfigured = (origin: string | null): Response =>
  json({ error: "handle issuance not configured" }, 503, origin);

// ---------------------------------------------------------------------------
// Name validation — app-level policy, distinct from on-chain availability.
// The BARE label only (the `@suize` suffix is appended server-side). Rules
// mirror the wallet's StepName: lowercase [a-z0-9-], 3–20 chars. `reason` is
// the machine-readable code the onboarding UI maps to its `taken` copy.
// ---------------------------------------------------------------------------

const NAME_RE = /^[a-z0-9-]+$/;
const NAME_MIN = 3;
const NAME_MAX = 20;

// Reserved / abusive labels we never hand out, independent of on-chain state.
const BLOCKLIST = new Set([
  "admin", "root", "support", "help", "suize", "suins", "system", "official",
  "team", "mod", "moderator", "owner", "billing", "abuse", "security", "api",
  "www", "mail", "info", "contact", "null", "undefined", "anonymous",
]);

type NameValidation =
  | { ok: true; label: string }
  | { ok: false; reason: string };

/**
 * Validate the bare label. Returns a `reason` code on failure (drives UI).
 * The contract is "lowercase [a-z0-9-]" — we do NOT silently lowercase, because
 * coercing `Alice`→`alice` would report availability for a label the caller did
 * not type. Mixed case is `bad-charset`; the client must send the bare label.
 */
const validateName = (raw: string): NameValidation => {
  const label = raw.trim();
  if (label.length < NAME_MIN) return { ok: false, reason: "too-short" };
  if (label.length > NAME_MAX) return { ok: false, reason: "too-long" };
  if (!NAME_RE.test(label)) return { ok: false, reason: "bad-charset" };
  // A leading/trailing hyphen is not a clean handle.
  if (label.startsWith("-") || label.endsWith("-")) return { ok: false, reason: "bad-charset" };
  if (BLOCKLIST.has(label)) return { ok: false, reason: "blocklisted" };
  return { ok: true, label };
};

const SUI_ADDRESS_RE = /^0x[0-9a-fA-F]{64}$/;

// ---------------------------------------------------------------------------
// Per-IP / per-address token bucket — same shape as the sponsor module's
// limiter (process-local, no cross-replica coordination needed; Redis
// idempotency + the SuiNS on-chain check are the hard caps). Claims are far
// rarer than sponsor calls, so the bucket is intentionally tight.
// ---------------------------------------------------------------------------

const RATE_LIMIT_CAPACITY = 5;       // burst
const RATE_LIMIT_REFILL_PER_SEC = 1; // sustained
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
  const cutoff = Date.now() - 60_000;
  for (const [k, b] of buckets) if (b.last < cutoff) buckets.delete(k);
}, 60_000).unref?.();

// ---------------------------------------------------------------------------
// Clients — built lazily on first use so the module imports cleanly even when
// not configured (HANDLE_ENABLED guards every call site before these run).
// ONE instance each, reused across requests.
// ---------------------------------------------------------------------------

let _redis: Redis | null = null;
let _suiClient: SuiJsonRpcClient | null = null;
let _suinsClient: SuinsClient | null = null;
let _enokiClient: EnokiClient | null = null;
let _issuer: Ed25519Keypair | null = null;

const redis = (): Redis => {
  if (!_redis) {
    _redis = new Redis(config.redisUrl, { lazyConnect: false, maxRetriesPerRequest: 3 });
    _redis.on("error", (err) => console.error("[handle/redis]", err.message));
  }
  return _redis;
};

const suiClient = (): SuiJsonRpcClient => {
  if (!_suiClient) _suiClient = new SuiJsonRpcClient({ url: config.suiRpcUrl, network: "testnet" });
  return _suiClient;
};

const suinsClient = (): SuinsClient => {
  if (!_suinsClient) _suinsClient = new SuinsClient({ client: suiClient(), network: "testnet" });
  return _suinsClient;
};

const enokiClient = (): EnokiClient => {
  if (!_enokiClient) _enokiClient = new EnokiClient({ apiKey: config.enokiPrivateApiKey ?? "" });
  return _enokiClient;
};

const issuer = (): Ed25519Keypair => {
  if (!_issuer) _issuer = Ed25519Keypair.fromSecretKey(config.handleIssuerKey!);
  return _issuer;
};

/** Dotted SuiNS form of a bare label: `<label>.<parentDomain>` (e.g. alice.suize.sui). */
const dottedName = (label: string): string => `${label}.${config.suinsParentDomain}`;

/** Display handle: `<label>@<parent-without-.sui>` (e.g. alice@suize). */
const displayHandle = (label: string): string => {
  const parent = (config.suinsParentDomain ?? "").replace(/\.sui$/, "");
  return `${label}@${parent}`;
};

// ---------------------------------------------------------------------------
// Redis schema:
//   handle:addr:<address>  -> JSON { handle, label, dotted, txDigest, ts }  (idempotency key)
//   handle:name:<label>    -> <address>  (reservation / fast taken-check)
// ---------------------------------------------------------------------------

type HandleRecord = {
  handle: string;
  label: string;
  dotted: string;
  txDigest: string;
  ts: number;
};

const addrKey = (address: string) => `handle:addr:${address.toLowerCase()}`;
const nameKey = (label: string) => `handle:name:${label}`;

const getByAddress = async (address: string): Promise<HandleRecord | null> => {
  const raw = await redis().get(addrKey(address));
  if (!raw) return null;
  try { return JSON.parse(raw) as HandleRecord; } catch { return null; }
};

/** True if the label is already reserved/claimed in Redis (by anyone). */
const isReserved = async (label: string): Promise<boolean> => {
  const owner = await redis().get(nameKey(label));
  return owner != null;
};

// ---------------------------------------------------------------------------
// On-chain availability — null record means the leaf has never been minted.
// getNameRecord throws on some not-found paths, so treat throw as "available".
// ---------------------------------------------------------------------------

const isOnChainAvailable = async (label: string): Promise<boolean> => {
  try {
    const rec = await suinsClient().getNameRecord(dottedName(label));
    return rec == null;
  } catch {
    return true;
  }
};

export const handleReady = async (): Promise<boolean> => {
  if (!HANDLE_ENABLED) return false;
  try {
    const result = await Promise.race([
      redis().ping(),
      new Promise<string>((_, reject) => setTimeout(() => reject(new Error("ping timeout")), 1000)),
    ]);
    return result === "PONG";
  } catch {
    return false;
  }
};

/** Whether the handle module is configured (SuiNS secrets present). */
export const handleEnabled = (): boolean => HANDLE_ENABLED;

// ---------------------------------------------------------------------------
// CORE — transport-agnostic handle logic. Both the HTTP route matchers below
// AND the WebSocket server (src/ws) call these. Over WS the `address` is ALWAYS
// `ws.data.address` (the verified session subject) — never a client-supplied
// field — so /me and /claim cannot be spoofed. They throw {@link HandleError}
// (tagged with an HTTP-equivalent status the caller maps to its transport).
// ---------------------------------------------------------------------------

/** A handle failure with the client-safe message, HTTP-equivalent status, optional reason code. */
export class HandleError extends Error {
  constructor(message: string, readonly status: number, readonly reason?: string) {
    super(message);
    this.name = "HandleError";
  }
}

/** Check availability of a bare label. Throws {@link HandleError} only on a backend outage (503). */
export const availableCore = async (rawName: string): Promise<HandleAvailableResponse> => {
  const v = validateName(rawName);
  if (!v.ok) return { available: false, reason: v.reason };

  try {
    if (await isReserved(v.label)) return { available: false, reason: "taken" };
  } catch (err) {
    console.error("[handle/available/redis]", (err as Error).message);
    throw new HandleError("availability check unavailable", 503);
  }

  let onChainFree: boolean;
  try {
    onChainFree = await isOnChainAvailable(v.label);
  } catch (err) {
    console.error("[handle/available/suins]", (err as Error).message);
    throw new HandleError("availability check unavailable", 503);
  }

  return onChainFree ? { available: true } : { available: false, reason: "taken" };
};

/** "Do I (this verified address) have a handle?" Redis first, reverse-record backstop. */
export const meCore = async (address: string): Promise<HandleMeResponse> => {
  if (!SUI_ADDRESS_RE.test(address)) throw new HandleError("invalid address", 400);

  try {
    const rec = await getByAddress(address);
    if (rec) return { handle: rec.handle };
  } catch (err) {
    console.error("[handle/me/redis]", (err as Error).message);
    // Fall through to the on-chain backstop rather than failing hard.
  }

  try {
    const parentSuffix = `.${config.suinsParentDomain}`;
    const { data } = await suiClient().resolveNameServiceNames({ address, format: "dot" });
    const dotted = data.find((n) => n.endsWith(parentSuffix));
    if (dotted) {
      const label = dotted.slice(0, -parentSuffix.length);
      return { handle: displayHandle(label) };
    }
  } catch (err) {
    console.error("[handle/me/reverse]", (err as Error).message);
  }

  return { handle: null };
};

/**
 * Claim `name` for `address`. Over WS `address` is the verified `ws.data.address`.
 * Throws {@link HandleError} (400 bad name, 409 taken, 502/503 backend) — the
 * caller maps `status`/`reason` to its transport.
 */
export const claimCore = async (rawName: string, address: string): Promise<HandleClaimResponse> => {
  if (!SUI_ADDRESS_RE.test(address)) throw new HandleError("invalid address", 400);

  const v = validateName(rawName);
  if (!v.ok) throw new HandleError("invalid name", 400, v.reason);
  const label = v.label;

  // Idempotency by address — a retry returns the same handle, never re-mints.
  try {
    const existing = await getByAddress(address);
    if (existing) return { handle: existing.handle, txDigest: existing.txDigest };
  } catch (err) {
    console.error("[handle/claim/redis-read]", (err as Error).message);
    throw new HandleError("storage unavailable", 503);
  }

  // Availability — Redis reservation, then on-chain leaf record.
  try {
    if (await isReserved(label)) throw new HandleError("name taken", 409, "taken");
  } catch (err) {
    if (err instanceof HandleError) throw err;
    console.error("[handle/claim/reserve-check]", (err as Error).message);
    throw new HandleError("storage unavailable", 503);
  }
  try {
    if (!(await isOnChainAvailable(label))) throw new HandleError("name taken", 409, "taken");
  } catch (err) {
    if (err instanceof HandleError) throw err;
    console.error("[handle/claim/suins-check]", (err as Error).message);
    throw new HandleError("availability check unavailable", 503);
  }

  // Reserve the label (SET NX) BEFORE minting so two concurrent claims for the
  // same label can't both reach the chain. Loser of the race gets 409.
  try {
    const reserved = await redis().set(nameKey(label), address.toLowerCase(), "EX", 120, "NX");
    if (reserved === null) throw new HandleError("name taken", 409, "taken");
  } catch (err) {
    if (err instanceof HandleError) throw err;
    console.error("[handle/claim/reserve]", (err as Error).message);
    throw new HandleError("storage unavailable", 503);
  }

  // ISSUE — build the leaf-subname PTB, sponsor it, issuer signs as sender.
  let txDigest: string;
  try {
    txDigest = await issueLeafSubname(label, address);
  } catch (err) {
    console.error("[handle/claim/issue]", (err as Error).message);
    try { await releaseReservation(label, address); } catch { /* best-effort */ }
    throw new HandleError("issuance failed", 502);
  }

  // Persist the final record (source of truth) + pin the reservation.
  const handle = displayHandle(label);
  const record: HandleRecord = {
    handle,
    label,
    dotted: dottedName(label),
    txDigest,
    ts: Date.now(),
  };
  try {
    const r = redis();
    await r.set(addrKey(address), JSON.stringify(record));
    await r.set(nameKey(label), address.toLowerCase()); // drop the TTL — permanent now
  } catch (err) {
    console.error("[handle/claim/persist]", (err as Error).message);
  }

  return { handle, txDigest };
};

// ---------------------------------------------------------------------------
// GET /handle/available?name=<name>
// ---------------------------------------------------------------------------

const handleAvailable = async (req: Request, url: URL, origin: string | null): Promise<Response> => {
  if (!HANDLE_ENABLED) return notConfigured(origin);

  if (!takeToken(getIp(req))) {
    return json({ error: "too many requests" }, 429, origin, { "Retry-After": "1" });
  }

  try {
    const res = await availableCore(url.searchParams.get("name") ?? "");
    return json(res, 200, origin);
  } catch (err) {
    if (err instanceof HandleError) return json({ error: err.message, reason: err.reason }, err.status, origin);
    throw err;
  }
};

// ---------------------------------------------------------------------------
// GET /handle/me?address=<addr>
// Redis lookup first (source of truth), then a reverse-record backstop.
// `address` is taken from a verified zkLogin session or a validated query param.
// ---------------------------------------------------------------------------

const handleMe = async (req: Request, url: URL, origin: string | null): Promise<Response> => {
  if (!HANDLE_ENABLED) return notConfigured(origin);

  if (!takeToken(getIp(req))) {
    return json({ error: "too many requests" }, 429, origin, { "Retry-After": "1" });
  }

  // HTTP has no bound session — the address is a validated query param. (Over WS
  // meCore is fed ws.data.address, the verified subject.)
  try {
    const res = await meCore((url.searchParams.get("address") ?? "").trim());
    return json(res, 200, origin);
  } catch (err) {
    if (err instanceof HandleError) return json({ error: err.message, reason: err.reason }, err.status, origin);
    throw err;
  }
};

// ---------------------------------------------------------------------------
// POST /handle/claim { name, address }
//   1. validate body + authz (address must be a well-formed zkLogin address)
//   2. idempotency: if this address already claimed, return the existing handle
//   3. validate name + availability (Redis reservation + on-chain) else 409
//   4. reserve the label in Redis (race guard) before minting
//   5. ISSUE: build createLeafSubName PTB, sponsor via Enoki (sponsor pays gas,
//      issuer signs as sender), execute
//   6. persist {address, handle, txDigest}; return
// ---------------------------------------------------------------------------

const handleClaim = async (req: Request, origin: string | null): Promise<Response> => {
  if (!HANDLE_ENABLED) return notConfigured(origin);

  const ip = getIp(req);
  if (!takeToken(ip)) {
    return json({ error: "too many requests" }, 429, origin, { "Retry-After": "1" });
  }

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "invalid json" }, 400, origin); }

  const address = typeof body?.address === "string" ? body.address.trim() : "";
  const rawName = typeof body?.name === "string" ? body.name : "";

  // Authz: HTTP has no bound session, so the claim carries a concrete zkLogin
  // address. The frontend passes its own verified address; a malformed/foreign
  // one is rejected in claimCore. We rate-limit per-address to blunt squatting.
  // (Over WS, the WS server feeds claimCore ws.data.address — no address field.)
  if (!SUI_ADDRESS_RE.test(address)) return json({ error: "invalid address" }, 400, origin);
  if (!takeToken(`addr:${address.toLowerCase()}`)) {
    return json({ error: "too many requests" }, 429, origin, { "Retry-After": "1" });
  }

  try {
    const res = await claimCore(rawName, address);
    return json(res, 200, origin);
  } catch (err) {
    if (err instanceof HandleError) return json({ error: err.message, reason: err.reason }, err.status, origin);
    throw err;
  }
};

/** Release a pre-mint reservation iff it still belongs to this address. */
const releaseReservation = async (label: string, address: string): Promise<void> => {
  const r = redis();
  const owner = await r.get(nameKey(label));
  if (owner === address.toLowerCase()) await r.del(nameKey(label));
};

/**
 * Build + sponsor + sign + execute a LEAF subname mint targeting `address`.
 *
 * Flow (the standard Enoki gas-station pattern, issuer = sender):
 *   - build `onlyTransactionKind` bytes for the createLeafSubName move call
 *   - createSponsoredTransaction (sponsor sets gas owner/payment, returns full
 *     tx bytes + digest) — restricted to the single SuiNS leaf-create target
 *   - issuer signs the sponsored bytes (authorizes the parent NFT it owns)
 *   - executeSponsoredTransaction with the issuer signature
 * Returns the executed tx digest.
 */
const issueLeafSubname = async (label: string, address: string): Promise<string> => {
  const tx = new Transaction();
  const st = new SuinsTransaction(suinsClient(), tx);
  st.createLeafSubName({
    parentNft: config.suinsParentNftId!,
    name: dottedName(label),
    targetAddress: address,
  });

  // onlyTransactionKind bytes — the sponsor supplies the gas object/owner.
  const kindBytes = await tx.build({ client: suiClient(), onlyTransactionKind: true });
  const transactionKindBytes = Buffer.from(kindBytes).toString("base64");

  const issuerKp = issuer();
  const sender = issuerKp.toSuiAddress();

  // The leaf-create move call lives in the SuiNS subnames package; read it off
  // the SuinsClient config so we never hardcode the SuiNS package id. The
  // recipient of the leaf target is the USER, so we do NOT pin allowedAddresses
  // (that guard is for the public /sponsor route, where recipient == sender).
  const subNamesPkg = suinsClient().config.subNamesPackageId;
  const allowedMoveCallTargets = subNamesPkg ? [`${subNamesPkg}::subdomains::new_leaf`] : undefined;

  const sponsored = await enokiClient().createSponsoredTransaction({
    network: "testnet",
    transactionKindBytes,
    sender,
    allowedMoveCallTargets,
  });

  const { signature } = await issuerKp.signTransaction(
    Buffer.from(sponsored.bytes, "base64"),
  );

  const executed = await enokiClient().executeSponsoredTransaction({
    digest: sponsored.digest,
    signature,
  });
  return executed.digest;
};

// ---------------------------------------------------------------------------

/**
 * Route matcher for the handle module. Returns a Response for the three handle
 * endpoints, or null if the path/method is not ours (so the main server can try
 * the next matcher / fall through to 404).
 */
export const handleHandleRoute = (
  req: Request,
  url: URL,
  origin: string | null,
): Promise<Response> | null => {
  if (req.method === "GET" && url.pathname === "/handle/available") return handleAvailable(req, url, origin);
  if (req.method === "GET" && url.pathname === "/handle/me") return handleMe(req, url, origin);
  if (req.method === "POST" && url.pathname === "/handle/claim") return handleClaim(req, origin);
  return null;
};

export const handleInfo = {
  enabled: HANDLE_ENABLED,
  parentDomain: config.suinsParentDomain ?? null,
};
