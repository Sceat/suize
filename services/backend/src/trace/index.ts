// POST /trace — the BLIND, STATELESS relay for the wallet's encrypted history.
//
// The wallet Seal-encrypts a history segment CLIENT-SIDE, signs a personal message
// over `suize-trace:<sha256(ciphertext)>:<ts>`, and POSTs the OPAQUE ciphertext here.
// This module:
//   1. recovers the signer (zkLogin-aware `verifyPersonalMessageSignature`),
//   2. binds the signature to the exact bytes (sha256) → blocks payload-swap,
//   3. rate-limits per verified signer (gas/WAL-drain backstop),
//   4. stores the ciphertext on Walrus with the on-chain `Blob` OBJECT owned by the
//      SIGNER (user-owned), the service publisher paying the WAL,
//   5. returns the `blobId`.
//
// It NEVER decrypts (it holds no key, the bytes are opaque Seal ciphertext), keeps
// NO per-user state (stateless, multi-replica safe — the chain anchor is the index),
// and imports NEITHER the signer NOR the brain. The number wall is untouched.
//
// OPTIONS preflight is handled by the GLOBAL handler in index.ts (which returns the
// shared CORS headers, incl. x-trace-*), so this route only handles POST.
import { createHash } from "node:crypto";
import { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import { verifyPersonalMessageSignature } from "@mysten/sui/verify";
import { config } from "../config";
import { json, text } from "../http";
import { storeBlob } from "../deploy/walrus";
import { createDailyCeiling } from "../quota";

/** Hard ceiling on a single history segment — bounds WAL spend + the tx-kind size. */
const MAX_TRACE_BYTES = 256 * 1024;
/** Signature freshness window (tight — this is an upload nonce, not a deploy). */
const TS_WINDOW_MS = 2 * 60 * 1000;

let _client: SuiJsonRpcClient | null = null;
const sui = (): SuiJsonRpcClient => {
  if (!_client) _client = new SuiJsonRpcClient({ url: config.suiRpcUrl, network: config.suiNetwork });
  return _client;
};

// Per-verified-signer + global daily cap on trace uploads (a jailbroken client
// can't STEAL, but could loop cheap uploads to burn WAL — this blunts it).
const traceDailyCeiling = createDailyCeiling({ globalMax: 5_000, perKeyMax: 300 });

const sha256hex = (b: Uint8Array): string => createHash("sha256").update(b).digest("hex");

/** Whether the verify failure is an INFRA error (RPC unreachable/timeout) rather than
 *  a genuine bad signature — an infra blip must NOT masquerade as a credential reject
 *  (the documented WS-brick lesson: transient errors ride their own channel). */
const isInfraError = (m: string): boolean =>
  /fetch|network|timeout|econn|enotfound|getaddrinfo|socket|503|504|unavailable|aborted/i.test(m);

/**
 * Route handler for `POST /trace`. Returns null when the path isn't ours (so the
 * matcher falls through), else the (async) Response — mirrors `handleChargeRoute`.
 */
export const handleTraceRoute = (
  req: Request,
  url: URL,
  origin: string | null,
): Promise<Response> | null => {
  if (url.pathname !== "/trace") return null;
  if (req.method !== "POST") return Promise.resolve(text("method not allowed", 405, origin));

  return (async (): Promise<Response> => {
    const ts = Number(req.headers.get("x-trace-ts") ?? "");
    const sig = req.headers.get("x-trace-sig") ?? "";
    if (!sig || !Number.isFinite(ts)) return json({ error: "missing auth" }, 400, origin);
    if (Math.abs(Date.now() - ts) > TS_WINDOW_MS) return json({ error: "stale request" }, 401, origin);

    // Pre-gate on the declared length BEFORE materializing the body (DoS — never read a
    // huge body into memory just to reject it).
    const declared = Number(req.headers.get("content-length") ?? "");
    if (Number.isFinite(declared) && declared > MAX_TRACE_BYTES) {
      return json({ error: "payload too large" }, 413, origin);
    }

    let buf: Uint8Array;
    try {
      buf = new Uint8Array(await req.arrayBuffer());
    } catch {
      return json({ error: "bad body" }, 400, origin);
    }
    if (buf.length === 0) return json({ error: "empty body" }, 400, origin);
    if (buf.length > MAX_TRACE_BYTES) return json({ error: "payload too large" }, 413, origin);

    // The signature is over sha256(THESE bytes) + ts — so a relay/man-in-the-middle
    // can neither swap the payload nor forge another user's upload.
    const msg = `suize-trace:${sha256hex(buf)}:${ts}`;
    let owner: string;
    try {
      const pk = await verifyPersonalMessageSignature(new TextEncoder().encode(msg), sig, { client: sui() });
      owner = pk.toSuiAddress();
    } catch (e) {
      const m = (e as Error).message ?? "";
      if (isInfraError(m)) {
        console.error("[trace] verify infra error:", m);
        return json({ error: "verification temporarily unavailable" }, 503, origin);
      }
      return json({ error: "bad signature" }, 403, origin);
    }

    const gate = traceDailyCeiling.consume(owner);
    if (!gate.ok) return json({ error: "rate limited" }, 429, origin);

    try {
      // send_object_to = owner → the user owns the on-chain Walrus Blob (user-owned
      // history); the deploy publisher wallet pays the WAL. We store opaque ciphertext.
      const { blobId } = await storeBlob(buf, owner);
      return json({ blobId }, 200, origin);
    } catch (e) {
      console.error("[trace] store failed:", (e as Error).message);
      return json({ error: "store failed" }, 502, origin);
    }
  })();
};
