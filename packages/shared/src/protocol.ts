/**
 * @suize/shared/protocol — the single-WebSocket message protocol.
 *
 * This is the sync point both build tracks (wallet frontend + backend WS server)
 * compile against. It defines ONE thing: the {@link Packet} envelope and every
 * message body that can ride inside it.
 *
 * ── CORE MIRROR (non-negotiable, from WS-PATTERN.md) ─────────────────────────
 *  • A SINGLE WebSocket per authenticated address.
 *  • Auth happens AT the connection: server sends a nonce, client signs it as a
 *    PERSONAL MESSAGE, server verifies with `verifyPersonalMessageSignature`
 *    (`@mysten/sui/verify`) and binds the recovered address to `ws.data`.
 *  • `ws.data` IS the session — RAM-only, dies on disconnect. NO cookies, NO
 *    session store, NO JWT. Once authenticated, the address is trusted for the
 *    life of the socket; messages NEVER re-assert it.
 *  • The wallet goes pure-WS. The backend ADDS this WS server ALONGSIDE the
 *    existing HTTP (`/sponsor`, `/execute`, `/waitlist`, `/handle/*` stay live
 *    for crash + landing). The HTTP wire types in `./index.ts` are untouched.
 *
 * ── ENCODING DECISION: typed discriminated-union JSON envelope ───────────────
 * aresrpg uses binary protobuf because it's a high-frequency game (positions,
 * leaderboards, 59+ message types — bandwidth and fire-and-forget order matter).
 * Suize is a low-frequency RPC wallet: a handful of message types whose payloads
 * are ALREADY defined as TS interfaces in `./index.ts` (base64 strings, digests).
 *
 * So we mirror the *shape* (a Packet `oneof`/discriminated-union) but keep the
 * *framing* pragmatic: each frame is a JSON string of a {@link Packet}, sent via
 * `ws.send(JSON.stringify(packet))` and parsed with `JSON.parse`. This keeps
 * `@suize/shared` zero-runtime-dep (no protobuf codegen toolchain, no `.proto`
 * source competing with these TS types) and lets us REUSE the existing sponsor +
 * Handle* interfaces verbatim instead of re-deriving them in a schema language.
 *
 * If a future high-frequency surface (e.g. live price ticks) makes JSON the
 * bottleneck, swap `encodePacket`/`decodePacket` for protobuf without touching a
 * single message body — the `oneof` shape is identical. YAGNI for now.
 *
 * ── CORRELATION ──────────────────────────────────────────────────────────────
 * aresrpg is fire-and-forget (TCP order only). We add what it lacks: every
 * client→server REQUEST carries a `id` (the caller mints it), and the matching
 * server→server RESPONSE echoes the SAME `id`. The client keeps a
 * `Map<id, {resolve, reject}>` so concurrent RPC calls over the one socket each
 * resolve to their own response. Server PUSH messages carry no `id`.
 */

import type {
  SponsorRequest,
  SponsorResponse,
  ExecuteRequest,
  ExecuteResponse,
  HandleAvailableResponse,
  HandleMeResponse,
  HandleClaimResponse,
} from './index.js';

// ---------------------------------------------------------------------------
// Personal-message auth — the exact string the client signs.
// ---------------------------------------------------------------------------

/**
 * Build the personal-message string the client signs for the auth handshake.
 * The server reconstructs the SAME string from the verified bytes and asserts
 * the embedded nonce matches the challenge it issued (mirrors aresrpg's
 * `message.split('::')` nonce check in `sui.js`).
 *
 *   `Sign into Suize\n\n::{nonce}`
 *
 * The signed bytes are sent base64-encoded in {@link SignatureResponse.bytes},
 * exactly as `verifyPersonalMessageSignature` consumes them (`fromBase64(bytes)`).
 */
export const buildAuthMessage = (nonce: string): string =>
  `Sign into Suize\n\n::${nonce}`;

/** WebSocket close codes (mirrors aresrpg's convention). */
export const WS_CLOSE = {
  /** Normal closure. */
  NORMAL: 1000,
  /** Client did not answer the signature challenge within the auth window. */
  AUTH_TIMEOUT: 4001,
  /** Same address connected from another device — old socket is kicked. */
  REPLACED: 4002,
  /** Signature invalid / nonce mismatch / auth failed. */
  AUTH_FAILED: 4003,
  /**
   * The signature-verify upstream (fullnode RPC) was unavailable — a TRANSIENT
   * infra failure, NOT a bad credential. Closed WITHOUT a `connectionRejected`
   * packet so the client's backoff reconnect retries a fresh handshake.
   */
  VERIFY_UNAVAILABLE: 4004,
} as const;

/** Seconds the server waits for {@link SignatureResponse} before closing 4001. */
export const AUTH_TIMEOUT_MS = 30_000;

// ===========================================================================
// AUTH messages
// ===========================================================================

/**
 * Server → client, sent immediately on open. `nonce` is a server-minted
 * `crypto.randomUUID()` with a short TTL; the client folds it into the
 * personal message via {@link buildAuthMessage}.
 */
export interface SignatureRequest {
  nonce: string;
}

/**
 * Client → server. The wallet signs {@link buildAuthMessage}(nonce) as a Sui
 * personal message and returns the raw pieces the verifier needs.
 */
export interface SignatureResponse {
  /** base64 of the signed message bytes (verifier: `fromBase64(bytes)`). */
  bytes: string;
  /** base64 personal-message signature from the (Enoki/zkLogin) wallet. */
  signature: string;
}

/**
 * Server → client. Auth succeeded; `address` is the cryptographically verified
 * Sui address now bound to `ws.data`. From here every other message is trusted
 * to come from this address — no message re-sends it.
 */
export interface ConnectionAccepted {
  address: string;
}

/**
 * Server → client. Auth (or the connection) was rejected; the socket then
 * closes with the matching {@link WS_CLOSE} code. `reason` is human-readable.
 */
export interface ConnectionRejected {
  reason: string;
}

// ===========================================================================
// SPONSOR messages — reuse the existing HTTP wire bodies VERBATIM.
// ===========================================================================
//
// The request/response BODIES are exactly the `./index.ts` interfaces
// (SponsorRequest/SponsorResponse/ExecuteRequest/ExecuteResponse). We re-export
// them under WS-namespaced aliases so a reader of this file sees the full
// protocol surface, while the single source of truth stays in `./index.ts`.

export type {
  SponsorRequest as WsSponsorRequest,
  SponsorResponse as WsSponsorResponse,
  ExecuteRequest as WsExecuteRequest,
  ExecuteResponse as WsExecuteResponse,
};

// ===========================================================================
// HANDLE messages — reuse the existing Handle* shapes, minus the trusted address.
// ===========================================================================
//
// Over the WS the authenticated address comes from `ws.data`, so requests do NOT
// carry an address to trust:
//   • HandleAvailableRequest needs only the name (lookup, no auth subject).
//   • HandleMeRequest is parameterless — "me" IS ws.data.address.
//   • HandleClaimRequest carries ONLY the bare label; the backend targets
//     ws.data.address. (The HTTP `HandleClaimRequest` in ./index.ts still has
//     `address` because HTTP has no bound session — that interface stays as-is.)
// Responses are identical to HTTP, re-exported for a complete surface.

/** Client → server. Check whether a bare label is claimable. */
export interface HandleAvailableRequest {
  /** Bare label (lowercase [a-z0-9-], 3–20 chars). */
  name: string;
}

/** Client → server. "Do I (ws.data.address) have a handle yet?" No params. */
export type HandleMeRequest = Record<string, never>;

/**
 * Client → server. Claim `name` for the authenticated address.
 * No `address` field — the backend uses `ws.data.address` (cannot be spoofed).
 */
export interface HandleClaimRequest {
  /** Bare label (lowercase [a-z0-9-], 3–20 chars). */
  name: string;
}

export type {
  HandleAvailableResponse as WsHandleAvailableResponse,
  HandleMeResponse as WsHandleMeResponse,
  HandleClaimResponse as WsHandleClaimResponse,
};

// ===========================================================================
// ERROR — server → client, the failure channel for a correlated RPC.
// ===========================================================================
//
// The RPC RESPONSE bodies above are the success shapes ONLY (verbatim reuse of
// the HTTP wire types — no `error` field smuggled in). When a request FAILS, the
// server instead emits a single `errorResponse` echoing the request's `id`, so
// the client's `Map<id, {resolve, reject}>` can REJECT that one promise without
// hanging (the gap aresrpg's fire-and-forget model never had to close). This is
// additive: it changes no existing frame, and PUSH frames never use it.

/** Server → client. A correlated RPC request failed; echoes the request `id`. */
export interface ErrorResponse {
  /** The `type` of the request that failed (e.g. `'sponsorRequest'`). */
  requestType: PacketType;
  /** Human-readable, client-safe failure message. */
  message: string;
  /** Optional machine-readable code (e.g. handle `'taken'` / `'bad-charset'`). */
  reason?: string;
}

// ===========================================================================
// PUSH messages — server → client, unsolicited (no `id`).
// ===========================================================================

/** Server → client. The authenticated address's live balance changed. */
export interface BalanceUpdate {
  /** Which balance moved: the user's savings vs the caged agent sandbox. */
  account: 'main' | 'sandbox';
  /** Balance in MIST as a decimal string (BigInt-safe over JSON). */
  balanceMist: string;
  /** Epoch milliseconds the server observed the change. */
  updatedAt: number;
}

/** Server → client. The agent loop did (or attempted) something. */
export interface AgentActivity {
  /** Stable id of the mandate/agent this activity belongs to. */
  agentId: string;
  /** Coarse lifecycle state for the activity badge. */
  status: 'idle' | 'thinking' | 'acting' | 'blocked' | 'revoked';
  /** One-line human-readable narration (the LLM narrates; numbers are deterministic). */
  message: string;
  /** Optional on-chain digest — present for an executed (or VM-aborted) move. */
  txDigest?: string;
  /** Epoch milliseconds. */
  at: number;
}

/** Server → client. A line in the shared livechat feed. */
export interface LivechatMessage {
  /** Display handle (`<name>@suize`) or short address of the sender. */
  from: string;
  /** Message text. */
  text: string;
  /** Epoch milliseconds. */
  at: number;
}

// ===========================================================================
// BRAIN (the wallet AI) — client asks; server streams Claude's narration +
// PROPOSED actions. The brain is KEYLESS + FENCED (CLAUDE.md LOCKED #5, amended
// 2026-06-14): it never signs, never settles, never emits an AUTHORITATIVE
// on-chain number. Every amount it proposes is a SUGGESTION the WALLET re-derives,
// dial-gates, and signs LOCALLY — the number wall + non-custody hold by process
// isolation, not by prompt.
// ===========================================================================

/**
 * One turn of the visible transcript — PLAIN TEXT only. The client flattens any
 * prior tool exchange to its narration text, so the server never receives raw
 * tool_use / tool_result blocks (keeps the wire simple and the history valid).
 */
export interface BrainMessage {
  role: 'user' | 'assistant';
  text: string;
}

/**
 * Client → server. Start a chat turn: the visible transcript. Identity is the
 * verified ws.data.address (never a body field). Carries `id`; the server streams
 * narration chunks + tool-use frames, then a done frame.
 */
export interface BrainChatRequest {
  messages: BrainMessage[];
  /**
   * The user's MemWal memory account id, if they've onboarded memory. NOT a secret:
   * a wrong id simply fails `seal_approve` against the user's server-derived delegate
   * key, so it grants no access — the delegate-key binding is the real auth.
   */
  memwalAccountId?: string;
}

// ── MEMWAL onboarding handshake (RPC) — the wallet asks the backend for the user's
//    DERIVED delegate public key + the on-chain constants, then signs the one-time
//    createAccount + addDelegateKey itself (the delegate PRIVATE key stays server-side).
export type MemwalDelegateRequest = Record<string, never>;
export interface MemwalDelegateResponse {
  /** False when memory is not configured on the backend (the wallet skips onboarding). */
  enabled: boolean;
  /** The user's derived delegate Ed25519 public key (hex) to register on-chain. */
  publicKey?: string;
  /** The Sui address of that delegate key. */
  suiAddress?: string;
  /** The MemWal contract package id + AccountRegistry object id for the setup txs. */
  packageId?: string;
  registryId?: string;
  /** 'testnet' | 'mainnet'. */
  network?: string;
}

/** Server → client. One streamed text delta of the assistant's narration. */
export interface BrainChatChunk {
  delta: string;
}

/**
 * Server → client. The agentic loop wants a TOOL run. The WALLET executes it —
 * READS answer instantly from the wallet's own state; WRITES go through the
 * confirm card + dials + LOCAL signing — and replies with a {@link BrainToolResult}.
 * The brain NEVER executes a tool itself: it has no chain access and no key (the
 * number wall + non-custody hold by process isolation). `toolUseId` correlates
 * the result; `input` amounts are SUGGESTIONS the wallet re-derives on the card.
 */
export interface BrainToolUse {
  toolUseId: string;
  tool: string;
  input: Record<string, unknown>;
}

/**
 * Client → server. The wallet's result for one {@link BrainToolUse}, fed back into
 * the loop. `content` is a short plain-text result the model reads; `isError`
 * marks a decline / failure (e.g. the user closed the confirm card, or a dial
 * blocked an auto-spend).
 */
export interface BrainToolResult {
  toolUseId: string;
  content: string;
  isError: boolean;
}

/**
 * Server → client. The turn is complete. `limited` = the strict daily token cap
 * was hit (the chunk carried the work-in-progress notice; no model call was made).
 */
export interface BrainChatDone {
  stopReason: string | null;
  limited?: boolean;
}

// ===========================================================================
// PACKET ENVELOPE — the discriminated union both tracks pattern-match on.
// ===========================================================================
//
// Mirrors aresrpg's `oneof payload` shape: every frame is exactly ONE tagged
// body. `type` is the discriminant; `id` correlates a request to its response.
// JSON on the wire: `{ "type": "...", "id": "...", "data": { ... } }`.

/** Direction-agnostic frame head shared by every variant. */
interface Frame<T extends string, D> {
  type: T;
  /**
   * Correlation id.
   *  • REQUEST (client→server): the caller mints it (e.g. `crypto.randomUUID()`).
   *  • RESPONSE (server→client): echoes the request's id.
   *  • PUSH / one-shot AUTH frames: omitted.
   */
  id?: string;
  data: D;
}

// ── Server → client AUTH frames (auth handshake; `signatureResponse` is the
//    only client→server frame allowed before ConnectionAccepted). ───────────
export type SignatureRequestFrame = Frame<'signatureRequest', SignatureRequest>;
export type SignatureResponseFrame = Frame<'signatureResponse', SignatureResponse>;
export type ConnectionAcceptedFrame = Frame<'connectionAccepted', ConnectionAccepted>;
export type ConnectionRejectedFrame = Frame<'connectionRejected', ConnectionRejected>;

// ── SPONSOR (RPC: request carries `id`, response echoes it) ─────────────────
export type SponsorRequestFrame = Frame<'sponsorRequest', SponsorRequest>;
export type SponsorResponseFrame = Frame<'sponsorResponse', SponsorResponse>;
export type ExecuteRequestFrame = Frame<'executeRequest', ExecuteRequest>;
export type ExecuteResponseFrame = Frame<'executeResponse', ExecuteResponse>;

// ── HANDLE (RPC) ────────────────────────────────────────────────────────────
export type HandleAvailableRequestFrame = Frame<'handleAvailableRequest', HandleAvailableRequest>;
export type HandleAvailableResponseFrame = Frame<'handleAvailableResponse', HandleAvailableResponse>;
export type HandleMeRequestFrame = Frame<'handleMeRequest', HandleMeRequest>;
export type HandleMeResponseFrame = Frame<'handleMeResponse', HandleMeResponse>;
export type HandleClaimRequestFrame = Frame<'handleClaimRequest', HandleClaimRequest>;
export type HandleClaimResponseFrame = Frame<'handleClaimResponse', HandleClaimResponse>;

// ── ERROR (server→client, echoes the failed request's `id`) ─────────────────
export type ErrorResponseFrame = Frame<'errorResponse', ErrorResponse>;

// ── PUSH (server→client, no `id`) ───────────────────────────────────────────
export type BalanceUpdateFrame = Frame<'balanceUpdate', BalanceUpdate>;
export type AgentActivityFrame = Frame<'agentActivity', AgentActivity>;
export type LivechatMessageFrame = Frame<'livechatMessage', LivechatMessage>;

// ── BRAIN (agentic loop: brainChatRequest carries `id`; the server streams
//    chunk + toolUse frames echoing it; the client replies toolResult; done ends) ─
export type BrainChatRequestFrame = Frame<'brainChatRequest', BrainChatRequest>;
export type BrainChatChunkFrame = Frame<'brainChatChunk', BrainChatChunk>;
export type BrainToolUseFrame = Frame<'brainToolUse', BrainToolUse>;
export type BrainToolResultFrame = Frame<'brainToolResult', BrainToolResult>;
export type BrainChatDoneFrame = Frame<'brainChatDone', BrainChatDone>;

// ── MEMWAL (RPC: request carries `id`, response echoes it) ───────────────────
export type MemwalDelegateRequestFrame = Frame<'memwalDelegateRequest', MemwalDelegateRequest>;
export type MemwalDelegateResponseFrame = Frame<'memwalDelegateResponse', MemwalDelegateResponse>;

/** Frames a client may SEND to the server. */
export type ClientPacket =
  | SignatureResponseFrame
  | SponsorRequestFrame
  | ExecuteRequestFrame
  | HandleAvailableRequestFrame
  | HandleMeRequestFrame
  | HandleClaimRequestFrame
  | BrainChatRequestFrame
  | BrainToolResultFrame
  | MemwalDelegateRequestFrame;

/** Frames the server may SEND to the client. */
export type ServerPacket =
  | SignatureRequestFrame
  | ConnectionAcceptedFrame
  | ConnectionRejectedFrame
  | SponsorResponseFrame
  | ExecuteResponseFrame
  | HandleAvailableResponseFrame
  | HandleMeResponseFrame
  | HandleClaimResponseFrame
  | ErrorResponseFrame
  | BalanceUpdateFrame
  | AgentActivityFrame
  | LivechatMessageFrame
  | BrainChatChunkFrame
  | BrainToolUseFrame
  | BrainChatDoneFrame
  | MemwalDelegateResponseFrame;

/** Any frame on the wire, either direction. The full `oneof`. */
export type Packet = ClientPacket | ServerPacket;

/** Every discriminant string, for exhaustive switch handling on the server. */
export type PacketType = Packet['type'];

// ---------------------------------------------------------------------------
// Encoding helpers — the ONLY place the JSON framing lives. Swap the bodies
// here (and nothing else) if a future surface demands protobuf.
// ---------------------------------------------------------------------------

/** Serialize a packet for `ws.send(...)`. */
export const encodePacket = (packet: Packet): string => JSON.stringify(packet);

/**
 * Decode UTF-8 bytes to a string without depending on `TextDecoder` (keeps
 * `@suize/shared` lib-free / runtime-agnostic). Bun delivers WS text frames as
 * `string`; this binary branch is purely defensive for non-string frames.
 */
const bytesToUtf8 = (raw: ArrayBuffer | Uint8Array): string => {
  const bytes = raw instanceof Uint8Array ? raw : new Uint8Array(raw);
  let result = '';
  for (let i = 0; i < bytes.length; i += 1) result += String.fromCharCode(bytes[i]!);
  // Promote raw bytes to a proper UTF-8 string (handles multi-byte JSON content).
  return decodeURIComponent(escape(result));
};

/**
 * Parse an inbound frame. Returns `null` on malformed JSON or a missing/blank
 * `type` (proto drift) so callers drop the frame instead of throwing — mirrors
 * aresrpg's "skip unknown oneof case, don't kill the socket" stance.
 */
export const decodePacket = (raw: string | ArrayBuffer | Uint8Array): Packet | null => {
  try {
    const text = typeof raw === 'string' ? raw : bytesToUtf8(raw);
    const parsed = JSON.parse(text) as Partial<Packet>;
    if (!parsed || typeof parsed.type !== 'string' || !parsed.type) return null;
    return parsed as Packet;
  } catch {
    return null;
  }
};
