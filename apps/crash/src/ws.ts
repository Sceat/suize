/**
 * The Enoki-verified WebSocket — Crash's gasless sponsor transport.
 *
 * Crash used to sponsor over HTTP (POST /sponsor + /execute). This module moves
 * that onto the SAME authenticated single-socket transport the Suize wallet uses
 * (apps/wallet/src/data/ws.ts): ONE socket per signed-in zkLogin address, with
 * auth happening AT the connection via a PERSONAL-MESSAGE signature. There is NO
 * cookie, NO session store, NO JWT — the verified address lives on the backend's
 * `ws.data` and dies on disconnect. The backend PINS the sponsor `sender` to that
 * verified address, so a socket for A can never sponsor for B.
 *
 * This is a SLIM port of the wallet's transport — Crash only needs sponsor +
 * execute (no handle / balance / agent push surfaces), so those are dropped.
 *
 * ── HANDSHAKE (mirror of the wallet) ─────────────────────────────────────────
 *   1. `connect_ws(address)` opens `${WS_URL}?address=<address>` (query param only;
 *      not trusted yet — the backend marks it `authenticated:false`).
 *   2. Server → `signatureRequest { nonce }`.
 *   3. We sign `buildAuthMessage(nonce)` as a Sui PERSONAL message (NOT a tx) with
 *      the live Enoki zkLogin session and reply `signatureResponse { bytes, signature }`
 *      — the ONLY frame allowed pre-accept.
 *   4. Server verifies via `verifyPersonalMessageSignature`, binds the recovered
 *      address to `ws.data`, and replies `connectionAccepted { address }`
 *      (or `connectionRejected { reason }` → no reconnect).
 *
 * ── CORRELATION ──────────────────────────────────────────────────────────────
 * Every REQUEST carries a `crypto.randomUUID()` `id`; the server echoes it on the
 * RESPONSE; a `Map<id,{resolve,reject}>` lets concurrent RPCs over the one socket
 * each settle independently. A failure travels on the `errorResponse` frame
 * (echoing the same `id`) so the per-id promise REJECTS with the real cause.
 *
 * ── SIGNER BRIDGE ────────────────────────────────────────────────────────────
 * Signing needs the React-bound dapp-kit hook (useSignPersonalMessage). A tiny
 * React effect (see App.tsx) registers a `signPersonalMessage(message)` thunk via
 * `register_signer`, then drives connect/disconnect off the signed-in address.
 */

import { CRASH_NETWORK } from './config'
import {
  buildAuthMessage,
  decodePacket,
  encodePacket,
  type ClientPacket,
  type ServerPacket,
  type Packet,
  type WsSponsorResponse,
  type WsExecuteResponse,
  type ErrorResponse,
} from '@suize/shared/protocol'

// Backend WebSocket URL — the single Enoki-verified transport. Dev points at the
// backend's default local port (services/backend PORT=8080 → ws://localhost:8080/ws);
// prod at wss://api.suize.io/ws. Trailing slash stripped; the `?address=` query
// param is appended at connect time. Mirrors the wallet's lib/env.ts WS_URL.
const WS_URL = (import.meta.env.VITE_WS_URL ?? 'ws://localhost:8080/ws')
  .trim()
  .replace(/\/$/, '')

// ───────────────────────────────────────────────────────────────────────────
// Types
// ───────────────────────────────────────────────────────────────────────────

type WsStatus = 'disconnected' | 'connecting' | 'authenticating' | 'connected'

/** Signs a personal message with the live wallet session; returns base64 pieces. */
type PersonalMessageSigner = (
  message: Uint8Array,
) => Promise<{ bytes: string; signature: string }>

/** A pending RPC awaiting its correlated response. */
interface PendingRpc {
  resolve: (data: unknown) => void
  reject: (error: Error) => void
  timeout: ReturnType<typeof setTimeout>
}

// ───────────────────────────────────────────────────────────────────────────
// Module-scope connection state (mirrors the wallet's file-scope vars).
// ───────────────────────────────────────────────────────────────────────────

let socket: WebSocket | null = null
let status: WsStatus = 'disconnected'

let reconnect_timeout: ReturnType<typeof setTimeout> | null = null
let reconnect_delay = 1000
/** Set when the server explicitly rejected us → suppress reconnect. */
let was_rejected = false
/** Consecutive reconnect attempts; reset on a successful open. Capped so a dead
 *  backend can't pin sponsorship on an infinite retry loop. */
let reconnect_attempts = 0
const MAX_RECONNECT_ATTEMPTS = 8

/** The bridged signer + address (registered from React via register_signer). */
let signer: PersonalMessageSigner | null = null
let connect_address: string | null = null

/** In-flight RPCs keyed by their correlation id. */
const pending = new Map<string, PendingRpc>()

/** Per-RPC timeout — a hung request rejects rather than leaking forever. */
const RPC_TIMEOUT_MS = 30_000

/** The retryable "socket isn't ready" message — recognised by App's
 *  is_retryable_sponsor_error so the auto-claim / sweep treat it as transient. */
const NOT_READY_MSG =
  'Sponsorship unavailable — the gas sponsor connection is not ready.'

/** How long an RPC will WAIT for the socket to finish (re)connecting before it
 *  gives up. The handshake is normally sub-second (Enoki signs the auth nonce
 *  silently); this margin only bites during a real reconnect/outage. Kept under
 *  RPC_TIMEOUT_MS so a request never out-waits its own response window. */
const READY_TIMEOUT_MS = 8_000

/** Callers parked until the socket reaches 'connected'. Flushed on accept,
 *  rejected on a terminal close so a write never hangs past a real outage. */
const ready_waiters = new Set<{
  resolve: () => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}>()

/** Wake everyone waiting on the socket — called the instant auth is accepted. */
function flush_ready_waiters(): void {
  for (const w of ready_waiters) {
    clearTimeout(w.timer)
    w.resolve()
  }
  ready_waiters.clear()
}

/** Reject everyone waiting — called when the socket dies with no reconnect left. */
function fail_ready_waiters(reason: string): void {
  for (const w of ready_waiters) {
    clearTimeout(w.timer)
    w.reject(new Error(reason))
  }
  ready_waiters.clear()
}

// ───────────────────────────────────────────────────────────────────────────
// Frame send + RPC correlation
// ───────────────────────────────────────────────────────────────────────────

/** Send a typed client frame over the socket (drops if not OPEN). */
function send_packet(ws: WebSocket | null, packet: ClientPacket): void {
  if (ws?.readyState !== WebSocket.OPEN) {
    console.warn('[ws] packet dropped (not connected):', packet.type)
    return
  }
  try {
    ws.send(encodePacket(packet))
  } catch (error) {
    console.error('[ws] send error:', packet.type, error)
  }
}

/** Reject + clear every in-flight RPC (called on close so callers stop hanging). */
function fail_all_pending(reason: string): void {
  for (const [, rpc] of pending) {
    clearTimeout(rpc.timeout)
    rpc.reject(new Error(reason))
  }
  pending.clear()
}

/**
 * Resolve once the sponsor socket is authenticated + OPEN. If the socket has gone
 * idle (a first call after a give-up, or a drop that hasn't re-armed) we kick a
 * reconnect; if it's mid-handshake we simply wait. Rejects with the retryable
 * not-ready message after READY_TIMEOUT_MS so a durable outage still surfaces
 * instead of hanging. This is what turns the common "fired a write while the WS
 * was still connecting" case from an instant failure into a brief wait-then-send.
 */
function ensure_connected(): Promise<void> {
  if (socket?.readyState === WebSocket.OPEN && status === 'connected') {
    return Promise.resolve()
  }
  // Idle socket — revive it if we still have a signed-in target; without one
  // there is nothing to wait for, so fail fast (e.g. signed out / self-paying).
  if (status === 'disconnected') {
    if (!connect_address) return Promise.reject(new Error(NOT_READY_MSG))
    connect_ws(connect_address)
  }
  return new Promise<void>((resolve, reject) => {
    const waiter = {
      resolve,
      reject,
      timer: setTimeout(() => {
        ready_waiters.delete(waiter)
        reject(new Error(NOT_READY_MSG))
      }, READY_TIMEOUT_MS),
    }
    ready_waiters.add(waiter)
  })
}

/**
 * Send an RPC REQUEST and resolve with its correlated RESPONSE `data`. The caller
 * mints the id; the server echoes it; `handle_message` settles the matching entry.
 * WAITS (up to READY_TIMEOUT_MS) for the socket to finish (re)connecting first, so
 * a write fired during a connect/reconnect window rides it out instead of failing.
 * Rejects on a durable outage, on timeout, or on disconnect.
 */
async function request<Res>(build: (id: string) => ClientPacket): Promise<Res> {
  await ensure_connected()
  const ws = socket
  // A close could land between ready and send — surface as the retryable not-ready.
  if (ws?.readyState !== WebSocket.OPEN) throw new Error(NOT_READY_MSG)
  const id = crypto.randomUUID()
  return new Promise<Res>((resolve, reject) => {
    const timeout = setTimeout(() => {
      pending.delete(id)
      reject(new Error('Sponsorship request timed out.'))
    }, RPC_TIMEOUT_MS)
    pending.set(id, {
      resolve: data => resolve(data as Res),
      reject,
      timeout,
    })
    send_packet(ws, build(id))
  })
}

/** Settle a correlated RPC response (resolve the matching pending entry). */
function settle(id: string | undefined, data: unknown): void {
  if (!id) return
  const rpc = pending.get(id)
  if (!rpc) return
  pending.delete(id)
  clearTimeout(rpc.timeout)
  rpc.resolve(data)
}

/** Reject a correlated RPC with the server's real error message + machine-readable
 *  `reason` (e.g. 'tx-would-revert' | 'sponsor-unavailable') attached to the Error,
 *  so callers can resolve a doomed tx terminally vs retry a transient outage. */
function settle_error(
  id: string | undefined,
  message: string,
  reason?: string,
): void {
  if (!id) return
  const rpc = pending.get(id)
  if (!rpc) return
  pending.delete(id)
  clearTimeout(rpc.timeout)
  const error = new Error(message) as Error & { reason?: string }
  if (reason) error.reason = reason
  rpc.reject(error)
}

// ───────────────────────────────────────────────────────────────────────────
// Inbound message dispatch
// ───────────────────────────────────────────────────────────────────────────

async function handle_message(packet: ServerPacket, ws: WebSocket): Promise<void> {
  switch (packet.type) {
    // ── AUTH ────────────────────────────────────────────────────────────────
    case 'signatureRequest': {
      if (!signer) {
        // The signer effect hasn't (re)registered yet — a transient ordering race
        // (e.g. a signPersonalMessage identity change cleared it for a tick), NOT a
        // server rejection. Close WITHOUT was_rejected so onclose reconnects and
        // re-runs the handshake once the signer is back. Bounded by the reconnect
        // cap, so a genuinely never-registered signer still can't loop forever.
        console.warn('[ws] no signer yet — closing to reconnect + retry handshake')
        ws.close()
        return
      }
      try {
        const message = new TextEncoder().encode(
          buildAuthMessage(packet.data.nonce),
        )
        const { bytes, signature } = await signer(message)
        // The ONLY client frame allowed before connectionAccepted.
        send_packet(ws, {
          type: 'signatureResponse',
          data: { bytes, signature },
        })
      } catch (error) {
        // User rejected the signature or the session is gone — don't loop on it.
        console.error('[ws] personal-message signing failed:', error)
        was_rejected = true
        ws.close()
      }
      return
    }

    case 'connectionAccepted': {
      reconnect_delay = 1000
      status = 'connected'
      // Release every write parked in ensure_connected — they can send now.
      flush_ready_waiters()
      return
    }

    case 'connectionRejected': {
      // Explicit rejection — do NOT reconnect.
      console.warn('[ws] connection rejected:', packet.data.reason)
      was_rejected = true
      fail_all_pending(`Connection rejected: ${packet.data.reason}`)
      fail_ready_waiters(`Connection rejected: ${packet.data.reason}`)
      ws.close()
      return
    }

    // ── RPC responses (correlated by id) ─────────────────────────────────────
    case 'sponsorResponse':
    case 'executeResponse': {
      settle(packet.id, packet.data)
      return
    }

    // ── RPC failure channel — reject the pending promise with the REAL message ─
    case 'errorResponse': {
      const err = packet.data as ErrorResponse
      settle_error(
        packet.id,
        err.message || 'Sponsorship request failed.',
        err.reason,
      )
      return
    }

    // ── PUSH / unknown frames — Crash subscribes to none; drop them. ──────────
    default:
      return
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Connection lifecycle (mirrors the wallet's connect/disconnect/onclose backoff).
// ───────────────────────────────────────────────────────────────────────────

/**
 * Open the single WS with the signed-in address as the connect query param (not
 * trusted yet — the backend challenges it). No-op if already connecting/open.
 */
export function connect_ws(address: string): void {
  if (status === 'connecting' || status === 'authenticating') return
  if (socket?.readyState === WebSocket.OPEN) return

  if (reconnect_timeout) {
    clearTimeout(reconnect_timeout)
    reconnect_timeout = null
  }
  if (!WS_URL) {
    console.error('[ws] VITE_WS_URL is not configured — cannot connect.')
    return
  }

  connect_address = address
  was_rejected = false

  const ws = new WebSocket(`${WS_URL}?address=${address}`)
  socket = ws
  status = 'connecting'

  // Bound the open+auth handshake before tearing down (a silently-stalled upgrade).
  const connect_timeout = setTimeout(() => {
    if (ws.readyState !== WebSocket.OPEN) ws.close()
  }, 10_000)

  ws.onopen = () => {
    clearTimeout(connect_timeout)
    // The transport reached the server — reset backoff AND the attempt cap so a
    // post-open drop still gets the full retry budget afresh.
    reconnect_delay = 1000
    reconnect_attempts = 0
    // Server sends `signatureRequest` next; we move to 'connected' on accept.
    status = 'authenticating'
  }

  ws.onmessage = event => {
    const packet = decodePacket(event.data as string) as Packet | null
    if (!packet) return
    void handle_message(packet as ServerPacket, ws)
  }

  ws.onerror = () => {
    // onclose fires right after — reconnect is handled there.
  }

  ws.onclose = () => {
    clearTimeout(connect_timeout)
    fail_all_pending('Connection closed.')
    socket = null
    status = 'disconnected'

    if (was_rejected) {
      was_rejected = false
      fail_ready_waiters(NOT_READY_MSG) // terminal → don't make writes wait it out
      return // explicit rejection → no reconnect
    }

    // No target (signed out mid-connect) → nothing to reconnect to.
    if (!connect_address) {
      fail_ready_waiters(NOT_READY_MSG)
      return
    }

    if (reconnect_attempts >= MAX_RECONNECT_ATTEMPTS) {
      console.warn(
        `[ws] giving up after ${reconnect_attempts} reconnect attempts — backend unreachable.`,
      )
      reconnect_attempts = 0
      reconnect_delay = 1000
      fail_ready_waiters(NOT_READY_MSG) // exhausted → release parked writes
      return
    }

    // Exponential backoff reconnect (1s → 30s); reset on a successful open.
    reconnect_attempts += 1
    reconnect_timeout = setTimeout(() => {
      reconnect_timeout = null
      if (connect_address) connect_ws(connect_address)
    }, reconnect_delay)
    reconnect_delay = Math.min(reconnect_delay * 2, 30_000)
  }
}

/** Close the socket and suppress reconnect (explicit sign-out / teardown). */
export function disconnect_ws(): void {
  if (reconnect_timeout) {
    clearTimeout(reconnect_timeout)
    reconnect_timeout = null
  }
  reconnect_delay = 1000
  reconnect_attempts = 0 // fresh retry budget for the next sign-in
  connect_address = null
  was_rejected = true // suppress the reconnect onclose would otherwise queue
  fail_all_pending('Disconnected.')
  socket?.close()
  socket = null
  status = 'disconnected'
}

// ───────────────────────────────────────────────────────────────────────────
// Signer bridge — registered from React (App.tsx).
// ───────────────────────────────────────────────────────────────────────────

/**
 * Register (or clear) the personal-message signer the auth handshake uses. Called
 * from React with the dapp-kit `useSignPersonalMessage` thunk. Passing `null`
 * clears it (on sign-out).
 */
export function register_signer(fn: PersonalMessageSigner | null): void {
  signer = fn
}

// ───────────────────────────────────────────────────────────────────────────
// RPC senders — the gasless write path (sponsor.ts) calls THESE, not fetch().
// ───────────────────────────────────────────────────────────────────────────

/** WS RPC: sponsor the given tx-KIND bytes for the authenticated sender. */
export function ws_sponsor(opts: {
  transactionKindBytes: string
  sender: string
}): Promise<WsSponsorResponse> {
  return request<WsSponsorResponse>(id => ({
    type: 'sponsorRequest',
    id,
    data: {
      // Crash is network-PINNED to testnet (LOCKED #11); the backend's sponsor
      // guard additionally allows 'testnet' even after a suite-wide mainnet flip.
      network: CRASH_NETWORK,
      transactionKindBytes: opts.transactionKindBytes,
      // The backend OVERRIDES this with the verified ws.data.address, so a socket
      // for A can never sponsor for B. We still send the signed-in address to keep
      // the wire body identical to the wallet's.
      sender: opts.sender,
    },
  }))
}

/** WS RPC: submit the user's signature over the sponsored bytes; backend pays gas. */
export function ws_execute(opts: {
  digest: string
  signature: string
}): Promise<WsExecuteResponse> {
  return request<WsExecuteResponse>(id => ({
    type: 'executeRequest',
    id,
    data: { digest: opts.digest, signature: opts.signature },
  }))
}
