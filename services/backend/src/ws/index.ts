// ─────────────────────────────────────────────────────────────────────────────
// @suize/backend — the single Enoki-verified WebSocket server.
//
// Mirrors aresrpg's pattern (services/backend ALONGSIDE the existing HTTP, NOT
// replacing it — /sponsor, /execute, /waitlist stay live over HTTP for crash +
// landing; handle ops are WS-ONLY, the unauthenticated /handle/* HTTP routes are
// no longer mounted). ONE WebSocket per address; auth happens AT the connection:
//
//   1. UPGRADE  GET /ws?address=0x… — read + validate the zkLogin address from
//      the query param, KICK any existing socket for that address, then
//      server.upgrade(req, { data: { address, authenticated:false, … } }).
//      NO cookies, NO session store — ws.data IS the session (RAM-only).
//   2. OPEN     mint a nonce, send `signatureRequest`, arm a 30s auth timeout.
//   3. AUTH     on `signatureResponse`, verify with verifyPersonalMessageSignature
//      (@mysten/sui/verify) that the personal message — buildAuthMessage(nonce) —
//      was signed by ws.data.address; assert the embedded ::nonce matches. On
//      success: authenticated=true, send `connectionAccepted`, push the initial
//      BalanceUpdate. On failure/timeout: `connectionRejected` + close (4001/4003).
//   4. ROUTE    authenticated frames go to the EXISTING module cores — sponsor
//      (createSponsor/executeSponsor) and handle (availableCore/meCore/claimCore).
//      /me + /claim use ws.data.address as the trusted subject — the frames carry
//      NO address, so they cannot be spoofed. Any frame before auth is dropped.
//   5. PUSH     a registry (address → socket) backs sendToAddress(...) for the
//      server-initiated BalanceUpdate / AgentActivity / LivechatMessage pushes.
//
// Framing is the shared JSON envelope from `@suize/shared/protocol` (decode
// returns null on drift → drop the frame, don't kill the socket).
// ─────────────────────────────────────────────────────────────────────────────
import type { Server, ServerWebSocket } from "bun";
import { verifyPersonalMessageSignature } from "@mysten/sui/verify";
import { fromBase64 } from "@mysten/sui/utils";
import {
  buildAuthMessage,
  decodePacket,
  encodePacket,
  WS_CLOSE,
  AUTH_TIMEOUT_MS,
  type ClientPacket,
  type ServerPacket,
} from "@suize/shared/protocol";
import { suiClient, createSponsor, executeSponsor, SponsorError } from "../sponsor";
import {
  availableCore,
  meCore,
  claimCore,
  handleEnabled,
  HandleError,
} from "../handle";
import { fetchMainBalanceUpdate } from "./balance";

const SUI_ADDRESS_RE = /^0x[0-9a-fA-F]{64}$/;

// ─────────────────────────────────────────────────────────────────────────────
// ws.data — the session. RAM-only, dies with the socket. No cookie, no store.
// ─────────────────────────────────────────────────────────────────────────────
export interface WsData {
  /** zkLogin address from the connect query param. TRUSTED only after auth. */
  address: string;
  /** Flipped true once the personal-message signature verifies. */
  authenticated: boolean;
  /** The challenge the server issued on open; folded into buildAuthMessage. */
  nonce: string;
  /** Auth-window timer; cleared on auth success or close. */
  authTimeout?: ReturnType<typeof setTimeout>;
  /** Server→browser keepalive ping; cleared on close. */
  pingInterval?: ReturnType<typeof setInterval>;
}

type WsSocket = ServerWebSocket<WsData>;

// ─────────────────────────────────────────────────────────────────────────────
// Connection registry — address → live socket. The ONLY shared state, and it is
// purely in-memory (the WS connection IS the session). Used to (a) enforce one
// socket per address (kick the old one), and (b) route server pushes.
// ─────────────────────────────────────────────────────────────────────────────
const sockets = new Map<string, WsSocket>();

/** Best-effort send of a server frame to a socket (swallows closed-socket throws). */
const sendPacket = (ws: WsSocket, packet: ServerPacket): void => {
  try {
    ws.send(encodePacket(packet));
  } catch {
    // socket already closed
  }
};

/**
 * Push a server→client frame to a given address, if it has a live AUTHENTICATED
 * socket. Returns true if delivered. This is the real push PLUMBING — the agent
 * loop + livechat are stubs, but anything calling sendToAddress reaches the user.
 */
export const sendToAddress = (address: string, packet: ServerPacket): boolean => {
  const ws = sockets.get(address);
  if (!ws || !ws.data.authenticated) return false;
  sendPacket(ws, packet);
  return true;
};

/** How many addresses currently have a live socket (for /ready/diagnostics). */
export const wsConnectionCount = (): number => sockets.size;

// ─────────────────────────────────────────────────────────────────────────────
// RATE LIMIT — per-AUTHENTICATED-address token bucket on costly frames. Same
// shape/intent as the HTTP /sponsor and /handle/claim limiters (sponsor/index.ts,
// handle/index.ts): a process-local bucket is enough to blunt gas-pool drain
// abuse from a single authed socket; Enoki's allow-list + Redis idempotency are
// the hard caps. Keyed by ws.data.address (the verified subject), NOT by socket,
// so a reconnect can't reset the bucket. Burst 5, sustained 2/sec — generous for
// real interactive use (sponsor → sign → execute), tight against a spam loop.
// ─────────────────────────────────────────────────────────────────────────────
const RATE_LIMIT_CAPACITY = 5;       // burst
const RATE_LIMIT_REFILL_PER_SEC = 2; // sustained
type Bucket = { tokens: number; last: number };
const rateBuckets = new Map<string, Bucket>();

const takeToken = (address: string): boolean => {
  const now = Date.now();
  const b = rateBuckets.get(address) ?? { tokens: RATE_LIMIT_CAPACITY, last: now };
  const elapsed = (now - b.last) / 1000;
  b.tokens = Math.min(RATE_LIMIT_CAPACITY, b.tokens + elapsed * RATE_LIMIT_REFILL_PER_SEC);
  b.last = now;
  if (b.tokens < 1) {
    rateBuckets.set(address, b);
    return false;
  }
  b.tokens -= 1;
  rateBuckets.set(address, b);
  return true;
};

// Evict idle buckets so the map can't grow unbounded under address churn.
setInterval(() => {
  const cutoff = Date.now() - 60_000;
  for (const [addr, b] of rateBuckets) if (b.last < cutoff) rateBuckets.delete(addr);
}, 60_000).unref?.();

// ─────────────────────────────────────────────────────────────────────────────
// AUTH — verify the personal-message signature against the bound address.
// Mirrors aresrpg/shared/src/sui.js verify_login_signature EXACTLY:
//   message = utf8(fromBase64(bytes)); [, signedNonce] = message.split('::')
//   pubkey  = await verifyPersonalMessageSignature(fromBase64(bytes), signature, { client })
//   signer  = pubkey.toSuiAddress()
//   assert signedNonce === ws.data.nonce  AND  signer === ws.data.address
// ─────────────────────────────────────────────────────────────────────────────
const verifyAuth = async (
  data: WsData,
  bytes: string,
  signature: string,
): Promise<{ ok: true } | { ok: false; reason: string }> => {
  try {
    const messageBytes = fromBase64(bytes);
    const message = new TextDecoder().decode(messageBytes);
    const [, signedNonce] = message.split("::");

    const publicKey = await verifyPersonalMessageSignature(messageBytes, signature, {
      client: suiClient,
    });
    const signer = publicKey.toSuiAddress();

    // The signed message must carry the exact nonce we issued for this socket.
    if (signedNonce !== data.nonce) {
      return { ok: false, reason: "nonce mismatch" };
    }
    // The recovered signer must be the address bound at upgrade. (zkLogin gives a
    // stable address; a mismatch here means the socket was opened for someone
    // else's address — reject, do NOT fall through like aresrpg's legacy warn.)
    if (signer !== data.address) {
      return { ok: false, reason: "address mismatch" };
    }
    return { ok: true };
  } catch (err) {
    console.error("[ws/auth] verify failed:", (err as Error).message);
    return { ok: false, reason: "invalid signature" };
  }
};

/** Reject a still-unauthenticated socket: tell the client why, then close. */
const reject = (ws: WsSocket, code: number, reason: string): void => {
  sendPacket(ws, { type: "connectionRejected", data: { reason } });
  try {
    ws.close(code, reason);
  } catch {
    // socket already closed
  }
};

const handleSignatureResponse = async (ws: WsSocket, frame: ClientPacket): Promise<void> => {
  if (ws.data.authenticated) return; // already in; ignore a duplicate
  if (frame.type !== "signatureResponse") return;

  const { bytes, signature } = frame.data;
  if (typeof bytes !== "string" || typeof signature !== "string") {
    reject(ws, WS_CLOSE.AUTH_FAILED, "malformed signatureResponse");
    return;
  }

  const result = await verifyAuth(ws.data, bytes, signature);
  if (!result.ok) {
    reject(ws, WS_CLOSE.AUTH_FAILED, result.reason);
    return;
  }

  // ── Authenticated. Bind it, stop the auth timer, accept, push initial state. ──
  ws.data.authenticated = true;
  if (ws.data.authTimeout) {
    clearTimeout(ws.data.authTimeout);
    ws.data.authTimeout = undefined;
  }
  sendPacket(ws, { type: "connectionAccepted", data: { address: ws.data.address } });

  // Real on-chain read: push the address's current SUI balance. A transient RPC
  // failure returns null — we simply skip the push (auth still succeeded).
  const balance = await fetchMainBalanceUpdate(ws.data.address);
  if (balance) sendPacket(ws, { type: "balanceUpdate", data: balance });
};

// ─────────────────────────────────────────────────────────────────────────────
// ROUTE — authenticated RPC frames → existing module cores. Each maps the core's
// tagged error (SponsorError / HandleError) onto a typed RESPONSE frame so the
// client's per-id promise resolves with a clean result either way. The response
// ALWAYS echoes the request's `id` for correlation.
// ─────────────────────────────────────────────────────────────────────────────
// Costly frames gated by the per-address token bucket. A read-only handleMe and
// the pre-auth signatureResponse are exempt; everything that touches Enoki / the
// gas pool / SuiNS RPC is rate-limited so one authed socket can't spam a drain.
const RATE_LIMITED: ReadonlySet<ClientPacket["type"]> = new Set([
  "sponsorRequest",
  "executeRequest",
  "handleAvailableRequest",
  "handleClaimRequest",
]);

const route = async (ws: WsSocket, frame: ClientPacket): Promise<void> => {
  const id = frame.id;
  const address = ws.data.address; // the TRUSTED subject — never from the frame

  // RATE LIMIT — gate costly frames before any Enoki/RPC work. Over-limit gets a
  // clean errorResponse (echoing `id` + the frame type as `requestType`) so the
  // client's per-id promise rejects, rather than the socket being killed.
  if (RATE_LIMITED.has(frame.type) && !takeToken(address)) {
    sendPacket(ws, {
      type: "errorResponse",
      id,
      data: { requestType: frame.type, message: "too many requests — slow down", reason: "rate-limited" },
    });
    return;
  }

  switch (frame.type) {
    case "signatureResponse":
      // Pre-auth only; once authenticated a duplicate is ignored by the guard.
      return;

    case "sponsorRequest": {
      try {
        // SECURITY: force the verified session address as the sponsor `sender`.
        // ws.data.address is the ONLY trusted identity — NEVER the client body.
        // Overriding `sender` last means a socket for A can never sponsor for B
        // (createSponsor pins allowedAddresses=[sender], so funds + gas are
        // bound to the authenticated address regardless of what the frame claims).
        const data = await createSponsor({ ...frame.data, sender: address });
        sendPacket(ws, { type: "sponsorResponse", id, data });
      } catch (err) {
        const message = err instanceof SponsorError ? err.message : "sponsorship failed";
        // Failures travel on the dedicated errorResponse frame (echoing `id`) so
        // the client's per-id promise REJECTS cleanly — never on the success body.
        sendPacket(ws, { type: "errorResponse", id, data: { requestType: "sponsorRequest", message } });
      }
      return;
    }

    case "executeRequest": {
      try {
        // ExecuteRequest carries NO sender — only { digest, signature }. The
        // sender was already pinned to ws.data.address at sponsor time (see the
        // sponsorRequest override above), and Enoki executes against that exact
        // sponsored digest. A socket for A therefore cannot execute a transaction
        // whose sender is B: it would need B's sponsored digest AND B's signature.
        const data = await executeSponsor(frame.data);
        sendPacket(ws, { type: "executeResponse", id, data });
      } catch (err) {
        const message = err instanceof SponsorError ? err.message : "execution failed";
        sendPacket(ws, { type: "errorResponse", id, data: { requestType: "executeRequest", message } });
      }
      return;
    }

    case "handleAvailableRequest": {
      if (!handleEnabled()) {
        sendPacket(ws, {
          type: "errorResponse",
          id,
          data: { requestType: "handleAvailableRequest", message: "handle issuance not configured", reason: "not-configured" },
        });
        return;
      }
      try {
        // availableCore returns {available:false, reason} as a NORMAL result for
        // a taken/invalid name — that's the UI's answer, not an error. Only a
        // backend outage throws (→ errorResponse below).
        const data = await availableCore(frame.data?.name ?? "");
        sendPacket(ws, { type: "handleAvailableResponse", id, data });
      } catch (err) {
        const message = err instanceof HandleError ? err.message : "availability check unavailable";
        sendPacket(ws, { type: "errorResponse", id, data: { requestType: "handleAvailableRequest", message } });
      }
      return;
    }

    case "handleMeRequest": {
      if (!handleEnabled()) {
        // Match HTTP best-effort: unconfigured/failed lookups read as "no handle".
        sendPacket(ws, { type: "handleMeResponse", id, data: { handle: null } });
        return;
      }
      try {
        // "me" === the verified session address, NOT a client-supplied field.
        const data = await meCore(address);
        sendPacket(ws, { type: "handleMeResponse", id, data });
      } catch (err) {
        console.error("[ws/handleMe]", (err as Error).message);
        sendPacket(ws, { type: "handleMeResponse", id, data: { handle: null } });
      }
      return;
    }

    case "handleClaimRequest": {
      if (!handleEnabled()) {
        sendPacket(ws, {
          type: "errorResponse",
          id,
          data: { requestType: "handleClaimRequest", message: "handle issuance not configured", reason: "not-configured" },
        });
        return;
      }
      try {
        // Claim targets the verified session address — un-spoofable.
        const data = await claimCore(frame.data?.name ?? "", address);
        sendPacket(ws, { type: "handleClaimResponse", id, data });
        // The claim mutated on-chain state for this address; nudge a fresh balance.
        const balance = await fetchMainBalanceUpdate(address);
        if (balance) sendPacket(ws, { type: "balanceUpdate", data: balance });
      } catch (err) {
        const message = err instanceof HandleError ? err.message : "claim failed";
        const reason = err instanceof HandleError ? err.reason : undefined;
        sendPacket(ws, { type: "errorResponse", id, data: { requestType: "handleClaimRequest", message, reason } });
      }
      return;
    }

    default: {
      // Exhaustiveness guard — a new ClientPacket variant must be handled here.
      const _exhaustive: never = frame;
      void _exhaustive;
      return;
    }
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// UPGRADE — the HTTP-side interception. Called from src/index.ts's fetch for
// GET /ws. Returns a Response on rejection, or undefined when the upgrade
// succeeded (Bun requires the fetch handler to return undefined in that case).
// ─────────────────────────────────────────────────────────────────────────────
export const tryUpgrade = (
  req: Request,
  url: URL,
  server: Server<WsData>,
): Response | undefined => {
  const address = url.searchParams.get("address") ?? "";
  if (!SUI_ADDRESS_RE.test(address)) {
    return new Response("invalid address format", { status: 400 });
  }

  // One socket per address: kick any existing connection (single-device).
  const existing = sockets.get(address);
  if (existing) {
    const old = existing.data;
    if (old.authTimeout) clearTimeout(old.authTimeout);
    if (old.pingInterval) clearInterval(old.pingInterval);
    sendPacket(existing, { type: "connectionRejected", data: { reason: "connected from another device" } });
    try {
      existing.close(WS_CLOSE.REPLACED, "connected from another device");
    } catch {
      // socket already closed
    }
    sockets.delete(address);
  }

  const data: WsData = { address, authenticated: false, nonce: crypto.randomUUID() };
  const ok = server.upgrade(req, { data });
  if (ok) return undefined; // Bun handles the 101; do NOT return a Response.
  return new Response("websocket upgrade failed", { status: 500 });
};

// ─────────────────────────────────────────────────────────────────────────────
// The Bun WebSocket handler object — passed to Bun.serve({ websocket }).
// ─────────────────────────────────────────────────────────────────────────────
export const websocketHandler = {
  // 2 min — kills a truly dead socket that stopped answering pings.
  idleTimeout: 120,

  open(ws: WsSocket) {
    // Register BEFORE issuing the challenge so a racing re-connect for the same
    // address sees this socket and can kick it.
    sockets.set(ws.data.address, ws);

    // Issue the auth challenge: the nonce was minted at upgrade and lives in
    // ws.data; the client folds it into buildAuthMessage(nonce) and signs it.
    sendPacket(ws, { type: "signatureRequest", data: { nonce: ws.data.nonce } });

    // 30s to answer with signatureResponse, else close 4001.
    ws.data.authTimeout = setTimeout(() => {
      if (!ws.data.authenticated) {
        reject(ws, WS_CLOSE.AUTH_TIMEOUT, "authentication timeout");
      }
    }, AUTH_TIMEOUT_MS);

    // Server→browser keepalive; the browser auto-pongs (no app frame needed).
    ws.data.pingInterval = setInterval(() => {
      try {
        ws.ping();
      } catch {
        // socket already closed
      }
    }, 30_000);
  },

  async message(ws: WsSocket, message: string | Buffer) {
    const frame = decodePacket(message as string | Uint8Array);
    if (!frame) return; // malformed / unknown type — drop, don't kill the socket

    // Only a server-bound CLIENT frame is valid inbound. A server frame echoed
    // back (or a frame with no client handler) is ignored.
    const client = frame as ClientPacket;

    // Pre-auth gate: the ONLY frame allowed before authentication is the
    // signature response. Everything else is dropped until accepted.
    if (!ws.data.authenticated) {
      if (client.type === "signatureResponse") {
        try {
          await handleSignatureResponse(ws, client);
        } catch (err) {
          console.error("[ws/auth] handler error:", (err as Error).message);
          reject(ws, WS_CLOSE.AUTH_FAILED, "auth error");
        }
      }
      return;
    }

    try {
      await route(ws, client);
    } catch (err) {
      // A handler-level throw must not take down the socket; log + keep alive.
      console.error("[ws/route] handler error:", (err as Error).message);
    }
  },

  close(ws: WsSocket) {
    const { address, authTimeout, pingInterval } = ws.data;
    if (authTimeout) clearTimeout(authTimeout);
    if (pingInterval) clearInterval(pingInterval);
    // Only clear the registry if THIS socket is still the active one for the
    // address (guards the race where an old socket's close fires after a new
    // socket has already replaced it in the map).
    if (sockets.get(address) === ws) sockets.delete(address);
  },
};
