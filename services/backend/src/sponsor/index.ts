// Sponsor module — Enoki sponsored-transaction backend.
// Folded from the standalone `suize-sponsor` service. Exposes:
//   POST /sponsor  ({ network, transactionKindBytes, sender } -> { bytes, digest })
//   POST /execute  ({ digest, signature } -> { digest })
// plus a readiness probe (`sponsorReady`) used by the shared /ready endpoint.
// CORS / json / client-IP now come from the shared ../http layer.
import { EnokiClient } from "@mysten/enoki";
import { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import { CRASH_MOVE_TARGETS, WALLET_MOVE_TARGETS } from "@suize/shared";
import type { SponsorRequest, SponsorResponse, ExecuteRequest, ExecuteResponse } from "@suize/shared";
import { config } from "../config";
import { json, getIp } from "../http";

const ENOKI_PRIVATE_API_KEY = config.enokiPrivateApiKey;

// Only the SUFFIX is shown; the secret never hits the logs.
export const maskKey = (key: string) => (key.length <= 6 ? "***" : `***${key.slice(-4)}`);

// ---------------------------------------------------------------------------
// Server-side move-call allow-list. Enoki refuses to sponsor any transaction
// that calls a target outside this set — the abuse guard against draining the
// gas pool with arbitrary move calls. These are public on-chain ids.
//
// The target lists are the SINGLE SOURCE OF TRUTH in @suize/shared:
//   - CRASH_MOVE_TARGETS  : the 7 live `…::router::*` targets (testnet).
//   - WALLET_MOVE_TARGETS : the live wallet targets (mandate/vault/swap/navi) —
//     the wallet Move package IS published to testnet; @suize/shared pins them.
// The effective allow-list is the union of both apps' targets.
// ---------------------------------------------------------------------------

const ALLOWED_MOVE_TARGETS: string[] = [...CRASH_MOVE_TARGETS, ...WALLET_MOVE_TARGETS];

// ---------------------------------------------------------------------------

const SUI_ADDRESS_RE = /^0x[0-9a-fA-F]{64}$/;
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;
const MAX_BODY_BYTES = 128 * 1024; // 128 KiB — kind-bytes + signatures are tiny.

// In-memory per-IP token bucket. The service is stateless and small, so a
// process-local limiter is enough to blunt gas-pool drain abuse; it does NOT
// coordinate across replicas (acceptable — Enoki's allow-list is the hard cap).
const RATE_LIMIT_CAPACITY = 5;       // burst
const RATE_LIMIT_REFILL_PER_SEC = 2; // sustained
type Bucket = { tokens: number; last: number };
const buckets = new Map<string, Bucket>();

const takeToken = (ip: string | null): boolean => {
  if (!ip) return true;
  const now = Date.now();
  const b = buckets.get(ip) ?? { tokens: RATE_LIMIT_CAPACITY, last: now };
  const elapsed = (now - b.last) / 1000;
  b.tokens = Math.min(RATE_LIMIT_CAPACITY, b.tokens + elapsed * RATE_LIMIT_REFILL_PER_SEC);
  b.last = now;
  if (b.tokens < 1) {
    buckets.set(ip, b);
    return false;
  }
  b.tokens -= 1;
  buckets.set(ip, b);
  return true;
};

// Evict idle buckets so the map can't grow unbounded under IP churn.
setInterval(() => {
  const cutoff = Date.now() - 60_000;
  for (const [ip, b] of buckets) if (b.last < cutoff) buckets.delete(ip);
}, 60_000).unref?.();

// Enoki client + Sui RPC client. If the key is missing the app refuses to boot
// (see src/index.ts), so by the time these run the key is present.
const enokiClient = new EnokiClient({ apiKey: ENOKI_PRIVATE_API_KEY ?? "" });
// Exported so the WS server (src/ws/balance) reuses the SAME RPC client for the
// initial getBalance push — one client, one place, no second config.
export const suiClient = new SuiJsonRpcClient({ url: config.suiRpcUrl, network: "testnet" });

// Reject oversized bodies up front (Content-Length), then guard again on the
// parsed string length in case the header lies.
const readBody = async (req: Request): Promise<{ ok: true; body: any } | { ok: false }> => {
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > MAX_BODY_BYTES) return { ok: false };
  let body: string;
  try { body = await req.text(); } catch { return { ok: false }; }
  if (body.length > MAX_BODY_BYTES) return { ok: false };
  try { return { ok: true, body: JSON.parse(body) }; } catch { return { ok: false }; }
};

export const sponsorReady = async (): Promise<boolean> => {
  if (!ENOKI_PRIVATE_API_KEY) return false;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1000);
    try {
      const seq = await suiClient.getLatestCheckpointSequenceNumber({ signal: controller.signal });
      return typeof seq === "string" && seq.length > 0;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return false;
  }
};

// ---------------------------------------------------------------------------
// CORE — the Enoki calls, transport-agnostic. Both the HTTP route matchers
// below AND the WebSocket server (src/ws) call these so the sponsorship logic
// lives in EXACTLY one place. They validate the wire contract and either return
// the shared response type or throw `SponsorError` (a tagged, client-safe error
// the caller maps to its own transport: HTTP status vs WS error frame).
// ---------------------------------------------------------------------------

/** A validation/Enoki failure with the client-safe message + HTTP-equivalent status. */
export class SponsorError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "SponsorError";
  }
}

// EnokiClientError carries the ACTUAL failure reason in `code` + `errors[]` (and
// sometimes a nested `cause`), NOT in `.message` (which is just "Bad Request").
// The previous catch logged only `.message`, so the real reason — most often a
// server-side dry-run MoveAbort (e.g. a cash_out/redeem against a stale/wrong
// reconstructed position) surfacing as a generic Enoki 400 -> our 502 — was
// silently dropped, leaving the client toast useless ("sponsor 502"). Pull the
// detail out, log it in full, and fold the first `errors[].message` into the
// client-facing message so the toast is actionable.
type EnokiErrorShape = {
  code?: unknown;
  errors?: Array<{ message?: unknown }> | undefined;
  cause?: unknown;
};

const enokiFailure = (tag: string, err: unknown, fallback: string): SponsorError => {
  const e = err as Error & EnokiErrorShape;
  const detail =
    e?.errors?.[0]?.message != null ? String(e.errors[0].message) : undefined;
  console.error(`[${tag}]`, {
    message: e?.message,
    code: e?.code,
    detail,
    cause: e?.cause,
  });
  // Append the real reason to the client message when we have one, so the toast
  // is actionable instead of an opaque "sponsorship failed".
  const message = detail ? `${fallback}: ${detail}` : fallback;
  return new SponsorError(message, 502);
};

/**
 * Validate + create an Enoki-sponsored transaction. Throws {@link SponsorError}
 * on bad input (400) or an Enoki failure (502). The `sender` is the trusted
 * subject — over WS it MUST be `ws.data.address` (never a client-supplied field).
 */
export const createSponsor = async (input: Partial<SponsorRequest>): Promise<SponsorResponse> => {
  const network = typeof input?.network === "string" ? input.network : "";
  const transactionKindBytes = typeof input?.transactionKindBytes === "string" ? input.transactionKindBytes : "";
  const sender = typeof input?.sender === "string" ? input.sender : "";

  if (network !== "testnet") throw new SponsorError("unsupported network (testnet only)", 400);
  if (!SUI_ADDRESS_RE.test(sender)) throw new SponsorError("invalid sender address", 400);
  if (!transactionKindBytes || !BASE64_RE.test(transactionKindBytes)) {
    throw new SponsorError("invalid transactionKindBytes", 400);
  }

  // Restrict the address allow-list to the sender so the sponsored tx cannot
  // move funds to a third party.
  const allowedAddresses = [sender];

  try {
    const result = await enokiClient.createSponsoredTransaction({
      network: network as SponsorRequest["network"],
      transactionKindBytes,
      sender,
      allowedAddresses,
      allowedMoveCallTargets: ALLOWED_MOVE_TARGETS,
    });
    return { bytes: result.bytes, digest: result.digest };
  } catch (err) {
    throw enokiFailure("sponsor", err, "sponsorship failed");
  }
};

/**
 * Validate + execute a previously sponsored transaction. Throws
 * {@link SponsorError} on bad input (400) or an Enoki failure (502).
 */
export const executeSponsor = async (input: Partial<ExecuteRequest>): Promise<ExecuteResponse> => {
  const digest = typeof input?.digest === "string" ? input.digest.trim() : "";
  const signature = typeof input?.signature === "string" ? input.signature.trim() : "";

  if (!digest) throw new SponsorError("missing digest", 400);
  if (!signature) throw new SponsorError("missing signature", 400);

  try {
    const result = await enokiClient.executeSponsoredTransaction({ digest, signature });
    return { digest: result.digest };
  } catch (err) {
    throw enokiFailure("execute", err, "execution failed");
  }
};

const handleSponsor = async (req: Request, origin: string | null): Promise<Response> => {
  const ip = getIp(req);
  if (!takeToken(ip)) return json({ error: "too many requests" }, 429, origin, { "Retry-After": "1" });

  const parsed = await readBody(req);
  if (!parsed.ok) return json({ error: "invalid or oversized body" }, 400, origin);

  try {
    const res = await createSponsor(parsed.body);
    return json(res, 200, origin);
  } catch (err) {
    if (err instanceof SponsorError) return json({ error: err.message }, err.status, origin);
    throw err;
  }
};

const handleExecute = async (req: Request, origin: string | null): Promise<Response> => {
  const ip = getIp(req);
  if (!takeToken(ip)) return json({ error: "too many requests" }, 429, origin, { "Retry-After": "1" });

  const parsed = await readBody(req);
  if (!parsed.ok) return json({ error: "invalid or oversized body" }, 400, origin);

  try {
    const res = await executeSponsor(parsed.body);
    return json(res, 200, origin);
  } catch (err) {
    if (err instanceof SponsorError) return json({ error: err.message }, err.status, origin);
    throw err;
  }
};

/**
 * Route matcher for the sponsor module. Returns a Response for POST /sponsor and
 * POST /execute, or null if the path/method is not ours (so the main server can
 * try the next module).
 */
export const handleSponsorRoute = (
  req: Request,
  url: URL,
  origin: string | null,
): Promise<Response> | null => {
  if (req.method === "POST" && url.pathname === "/sponsor") return handleSponsor(req, origin);
  if (req.method === "POST" && url.pathname === "/execute") return handleExecute(req, origin);
  return null;
};

export const sponsorInfo = {
  allowedMoveTargetCount: ALLOWED_MOVE_TARGETS.length,
  crashTargetCount: CRASH_MOVE_TARGETS.length,
  walletTargetCount: WALLET_MOVE_TARGETS.length,
};
