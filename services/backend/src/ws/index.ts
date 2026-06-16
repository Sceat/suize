// ─────────────────────────────────────────────────────────────────────────────
// @suize/backend — the single Enoki-verified WebSocket server.
//
// Mirrors aresrpg's pattern. Sponsorship (sponsor/execute) AND handle ops are now
// WS-ONLY: both the wallet and crash route them over THIS authenticated socket.
// The public HTTP POST /sponsor + /execute routes and the unauthenticated
// /handle/* routes are no longer mounted. ONE WebSocket per address; auth happens
// AT the connection:
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
import { config } from "../config";
import { suiClient, createSponsor, executeSponsor, SponsorError } from "../sponsor";
import {
  availableCore,
  meCore,
  claimCore,
  handleEnabled,
  HandleError,
} from "../handle";
import { fetchMainBalanceUpdate } from "./balance";
import { handleBrainChat, resolveBrainToolResult, brainAbort } from "../brain";
import { delegateInfoFor } from "../memory";

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
// abuse from a single authed socket; Enoki's allow-list + the on-chain atomic
// leaf-mint are the hard caps. Keyed by ws.data.address (the verified subject), NOT by socket,
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
/**
 * zkLogin signatures verify against the fullnode RPC, so the verify call can fail
 * for INFRA reasons (5xx, timeout, network) that say nothing about the credential.
 * Misclassifying those as "invalid signature" sends `connectionRejected`, which the
 * client honors as PERMANENT (no reconnect) — one fullnode hiccup bricked the
 * session until a reload (seen live 2026-06-10: "Unexpected status code: 504").
 */
const isTransientVerifyError = (err: Error): boolean =>
  /status code|timed? ?out|network|fetch failed|ECONN|EAI_AGAIN|socket/i.test(err.message);

const VERIFY_ATTEMPTS = 3;
const VERIFY_RETRY_DELAY_MS = 400;

const verifyAuth = async (
  data: WsData,
  expectedNonce: string,
  bytes: string,
  signature: string,
): Promise<{ ok: true } | { ok: false; reason: string; transient?: boolean }> => {
  let messageBytes: Uint8Array;
  let signedNonce: string | undefined;
  try {
    messageBytes = fromBase64(bytes);
    [, signedNonce] = new TextDecoder().decode(messageBytes).split("::");
  } catch {
    return { ok: false, reason: "malformed auth payload" };
  }

  // Verify with a short retry budget for infra-flavored failures only; a genuine
  // bad signature throws a non-transient error and exits on the first attempt.
  let signer: string | null = null;
  for (let attempt = 1; attempt <= VERIFY_ATTEMPTS; attempt += 1) {
    try {
      const publicKey = await verifyPersonalMessageSignature(messageBytes, signature, {
        client: suiClient,
      });
      signer = publicKey.toSuiAddress();
      break;
    } catch (err) {
      const error = err as Error;
      const transient = isTransientVerifyError(error);
      console.error(
        `[ws/auth] verify failed (attempt ${attempt}/${VERIFY_ATTEMPTS}, ${transient ? "transient" : "credential"}):`,
        error.message,
      );
      if (!transient) return { ok: false, reason: "invalid signature" };
      if (attempt === VERIFY_ATTEMPTS) {
        return { ok: false, reason: "verification temporarily unavailable", transient: true };
      }
      await new Promise((r) => setTimeout(r, VERIFY_RETRY_DELAY_MS));
    }
  }
  if (!signer) return { ok: false, reason: "invalid signature" };

  // The signed message must carry the exact nonce we issued for this socket.
  // `expectedNonce` is the value BURNED from ws.data before this call, so a
  // replayed second attempt (which sees data.nonce === "") can never match.
  // An empty expectedNonce (already-burned) is itself a hard reject.
  if (!expectedNonce || signedNonce !== expectedNonce) {
    return { ok: false, reason: "nonce mismatch" };
  }
  // The recovered signer must be the address bound at upgrade. (zkLogin gives a
  // stable address; a mismatch here means the socket was opened for someone
  // else's address — reject, do NOT fall through like aresrpg's legacy warn.)
  if (signer !== data.address) {
    return { ok: false, reason: "address mismatch" };
  }
  return { ok: true };
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

  // BURN the nonce: single-use. We capture it, then clear ws.data.nonce so that a
  // SECOND signatureResponse — even one carrying a valid signature over the same
  // nonce — verifies against "" and is rejected ("nonce mismatch"). This closes
  // the replay window for a FAILED first attempt (the duplicate guard above only
  // covers a SUCCESSFUL first attempt, where authenticated is already true).
  const expectedNonce = ws.data.nonce;
  ws.data.nonce = "";

  const result = await verifyAuth(ws.data, expectedNonce, bytes, signature);
  if (!result.ok) {
    if (result.transient) {
      // Infra hiccup, NOT a bad credential: close WITHOUT `connectionRejected`
      // (that packet means "permanent — don't come back" to the client). A plain
      // close lands in the client's backoff reconnect → fresh handshake, fresh nonce.
      try {
        ws.close(WS_CLOSE.VERIFY_UNAVAILABLE, result.reason);
      } catch {
        // socket already closed
      }
      return;
    }
    reject(ws, WS_CLOSE.AUTH_FAILED, result.reason);
    return;
  }

  // ── Authenticated. Bind it, stop the auth timer, accept, push initial state. ──
  ws.data.authenticated = true;
  if (ws.data.authTimeout) {
    clearTimeout(ws.data.authTimeout);
    ws.data.authTimeout = undefined;
  }

  // SINGLE-SOCKET ENFORCEMENT — now, AFTER proof of address control (H2). We only
  // evict an EXISTING AUTHENTICATED socket for the same address; an unauthenticated
  // incumbent (a half-open connect that never signed) is left alone — it will die on
  // its own auth timeout. Crucially, this means a newcomer can never kick a session
  // it hasn't out-authenticated, and an UNAUTH newcomer can never kick an AUTH
  // incumbent. The registry only ever holds AUTHENTICATED sockets (we register
  // below), so any socket found here is already authenticated.
  const incumbent = sockets.get(ws.data.address);
  if (incumbent && incumbent !== ws) {
    const old = incumbent.data;
    if (old.authTimeout) clearTimeout(old.authTimeout);
    if (old.pingInterval) clearInterval(old.pingInterval);
    sendPacket(incumbent, { type: "connectionRejected", data: { reason: "connected from another device" } });
    try {
      incumbent.close(WS_CLOSE.REPLACED, "connected from another device");
    } catch {
      // socket already closed
    }
  }
  // This authenticated socket is now THE socket for the address (push routing +
  // single-device). Registering only authenticated sockets keeps an unauthenticated
  // probe from ever clobbering a live session's registry slot.
  sockets.set(ws.data.address, ws);

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
  "brainChatRequest",
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
        // Claim targets the verified session address — un-spoofable. The response
        // now ALSO carries the sponsored setDefault (set_reverse_lookup) bytes +
        // digest the wallet must sign (user's zkLogin signer) and execute via the
        // existing executeRequest path, so the reverse record is set on-chain (a
        // leaf subname does not auto-set it). Forwarded verbatim on the same frame.
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

    case "brainChatRequest": {
      // The wallet AI. The brain is KEYLESS + FENCED (CLAUDE.md LOCKED #5): it
      // streams narration + PROPOSED actions over this socket and NEVER signs or
      // settles. Identity is the verified ws.data.address (never a frame field);
      // the wallet executes every proposal locally. `send` is bound here so the
      // brain module never imports the socket — it only emits frames.
      await handleBrainChat(address, id, frame.data, (packet) => sendPacket(ws, packet));
      return;
    }

    case "brainToolResult": {
      // The wallet's result for an in-flight brainToolUse — resume the agentic
      // loop. NOT rate-limited: it's a continuation of a turn, not a new spend.
      // Bound to the VERIFIED ws.data.address (never a frame field) so one socket
      // can never resolve another user's in-flight tool (F2); content is clamped
      // server-side (F1).
      resolveBrainToolResult(address, frame.data.toolUseId, frame.data.content, frame.data.isError);
      return;
    }

    case "memwalDelegateRequest": {
      // The wallet asks for its DERIVED MemWal delegate pubkey + the on-chain
      // constants to run the one-time memory onboarding (createAccount +
      // addDelegateKey). The delegate PRIVATE key stays server-side; identity is the
      // verified ws.data.address (never a frame field). A cheap read — not rate-limited.
      sendPacket(ws, { type: "memwalDelegateResponse", id, data: delegateInfoFor(address) });
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
  // Origin allow-list — mirror the HTTP CORS stance (config.allowedOrigins, see
  // http.ts): an Origin that is present but NOT allow-listed is a cross-site
  // socket attempt (CSWSH) — reject the upgrade with 403. A request with NO
  // Origin (native / non-browser clients) is allowed, matching CORS, which only
  // gates browser-supplied Origins. Checked BEFORE the address format.
  const origin = req.headers.get("origin");
  if (origin && !config.allowedOrigins.includes(origin)) {
    return new Response("forbidden origin", { status: 403 });
  }

  const address = url.searchParams.get("address") ?? "";
  if (!SUI_ADDRESS_RE.test(address)) {
    return new Response("invalid address format", { status: 400 });
  }

  // SECURITY: we do NOT evict any existing socket for this address HERE. The
  // `address` is an UNVERIFIED query param at upgrade time — an attacker who knows
  // a victim's public zkLogin address could otherwise open `/ws?address=<victim>`
  // and instantly kick the victim's authenticated session WITHOUT ever proving
  // control of the address (a pre-auth denial-of-service). The newcomer is admitted
  // UNAUTHENTICATED; single-socket eviction happens only AFTER it proves control of
  // the address (handleSignatureResponse), and only ever evicts ANOTHER
  // AUTHENTICATED socket for the same address. See the registry note in `open`.
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
    // We do NOT register the socket here — the address→socket registry now holds
    // ONLY authenticated sockets (set in handleSignatureResponse after proof of
    // control). An unauthenticated socket that clobbered the registry slot could
    // be used to kick a live authenticated session before ever signing (H2), so it
    // stays out of the map until it authenticates. Until then it is a transient,
    // anonymous, auth-window-bounded connection.

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
    // address. The registry holds only authenticated sockets, so an unauthenticated
    // socket closing is a no-op here (it was never registered) — it therefore can
    // never evict the authenticated incumbent's slot. This still guards the race
    // where a replaced socket's close fires after its successor took the slot.
    if (sockets.get(address) === ws) {
      sockets.delete(address);
      // This socket was the live incumbent — unwind any in-flight brain turn it
      // owned. Guarded by the same incumbent check so a replaced socket's late
      // close can never abort the successor's turn.
      brainAbort(address);
    }
  },
};
