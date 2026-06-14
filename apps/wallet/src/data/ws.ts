/**
 * The single Enoki-verified WebSocket — the wallet's ONE data transport.
 *
 * Mirrors aresrpg's `ws/index.ts`: a single socket per signed-in zkLogin address,
 * authenticated AT the connection via a PERSONAL-MESSAGE signature. There is NO
 * cookie, NO session store, NO JWT — the verified address lives on the backend's
 * `ws.data` and dies on disconnect. The wallet is pure-WS; every former HTTP call
 * (handle availability / me / claim, sponsor, execute) now rides this socket.
 *
 * ── HANDSHAKE (mirror of WS-PATTERN.md §1.1–1.3) ─────────────────────────────
 *   1. `connect(address)` opens `${WS_URL}?address=<address>` (query param only;
 *      not trusted yet — the backend marks it `authenticated:false`).
 *   2. Server → `signatureRequest { nonce }`.
 *   3. We sign `buildAuthMessage(nonce)` as a Sui PERSONAL message (NOT a tx) with
 *      the live dapp-kit/Enoki session and reply `signatureResponse { bytes, signature }`
 *      — the ONLY frame allowed pre-accept.
 *   4. Server verifies via `verifyPersonalMessageSignature`, binds the recovered
 *      address to `ws.data`, and replies `connectionAccepted { address }`
 *      (or `connectionRejected { reason }` → no reconnect).
 *
 * ── CORRELATION (the thing aresrpg lacks) ────────────────────────────────────
 * aresrpg is fire-and-forget over TCP order. We mint a `crypto.randomUUID()` `id`
 * per REQUEST; the server echoes it on the RESPONSE; a `Map<id,{resolve,reject}>`
 * lets concurrent RPCs over the one socket each settle independently. PUSH frames
 * (balance / agent / livechat) carry no `id` and route to subscriber sets instead.
 *
 * ── SIGNER BRIDGE ────────────────────────────────────────────────────────────
 * The store is non-React but signing needs the React-bound dapp-kit hook. A tiny
 * React effect (`useWsLifecycle`) registers the current address + a
 * `signPersonalMessage(message)` thunk into the store, then drives connect/disconnect
 * off the auth status — exactly the seam aresrpg gets "for free" from its zustand
 * `use_auth` store.
 */

import { useSyncExternalStore } from 'react';
import type { SuiNetwork } from '@suize/shared';
import {
  buildAuthMessage,
  decodePacket,
  encodePacket,
  type ClientPacket,
  type Packet,
  type ServerPacket,
  type WsHandleClaimResponse,
  type WsSponsorResponse,
  type WsExecuteResponse,
  type BalanceUpdate,
  type AgentActivity,
  type LivechatMessage,
  type ErrorResponse,
} from '@suize/shared/protocol';
import { WS_URL } from '../lib/env';

// ───────────────────────────────────────────────────────────────────────────
// Types
// ───────────────────────────────────────────────────────────────────────────

export type WsStatus = 'disconnected' | 'connecting' | 'authenticating' | 'connected';

/** Signs a personal message with the live wallet session; returns base64 pieces. */
type PersonalMessageSigner = (
  message: Uint8Array,
) => Promise<{ bytes: string; signature: string }>;

/** A pending RPC awaiting its correlated response. */
interface PendingRpc {
  resolve: (data: unknown) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

// ── server-push subscriber registries (outside the store; pure fan-out) ──────
type BalanceListener = (update: BalanceUpdate) => void;
type AgentListener = (activity: AgentActivity) => void;
type LivechatListener = (message: LivechatMessage) => void;

const balanceListeners = new Set<BalanceListener>();
const agentListeners = new Set<AgentListener>();
const livechatListeners = new Set<LivechatListener>();

/** Subscribe to server BalanceUpdate pushes. Returns an unsubscribe fn. */
export function onBalanceUpdate(fn: BalanceListener): () => void {
  balanceListeners.add(fn);
  return () => balanceListeners.delete(fn);
}

/** Subscribe to server AgentActivity pushes. Returns an unsubscribe fn. */
export function onAgentActivity(fn: AgentListener): () => void {
  agentListeners.add(fn);
  return () => agentListeners.delete(fn);
}

/** Subscribe to server LivechatMessage pushes. Returns an unsubscribe fn. */
export function onLivechatMessage(fn: LivechatListener): () => void {
  livechatListeners.add(fn);
  return () => livechatListeners.delete(fn);
}

// ───────────────────────────────────────────────────────────────────────────
// Module-scope connection state (mirrors aresrpg's file-scope reconnect vars).
// ───────────────────────────────────────────────────────────────────────────

let reconnect_timeout: ReturnType<typeof setTimeout> | null = null;
let reconnect_delay = 1000;
/** Set when the server explicitly rejected/replaced us → suppress reconnect. */
let was_rejected = false;
/** Consecutive reconnect attempts; reset on a successful open. Capped so a dead
 *  backend can't pin the login on an infinite "signing you in" spinner. */
let reconnect_attempts = 0;
/** After this many consecutive failures we stop cleanly and leave the socket
 *  closed (status 'disconnected') so the app-level safety net can redirect. */
const MAX_RECONNECT_ATTEMPTS = 8;

/** The bridged signer + address (registered by `useWsLifecycle` from React). */
let signer: PersonalMessageSigner | null = null;
let connect_address: string | null = null;

/** In-flight RPCs keyed by their correlation id. */
const pending = new Map<string, PendingRpc>();

/** Per-RPC timeout — a hung request rejects rather than leaking forever. */
const RPC_TIMEOUT_MS = 30_000;

/**
 * The reactive slice React subscribes to. `connect`/`disconnect` are stable module
 * functions exposed via `use_ws.getState()` for the (non-React) lifecycle bridge.
 */
interface WsState {
  status: WsStatus;
  ws: WebSocket | null;
  /** the verified address the backend bound to `ws.data` (echoed on accept). */
  address: string | null;
}

// ───────────────────────────────────────────────────────────────────────────
// Minimal external store (useSyncExternalStore) — no zustand dependency. The
// wallet has zero zustand elsewhere (pure React hooks + this isolated data seam),
// so a 20-line store keeps the dep graph flat while mirroring aresrpg's store
// SHAPE (status/ws/address + connect/disconnect + a React subscription hook).
// ───────────────────────────────────────────────────────────────────────────

let state: WsState = { status: 'disconnected', ws: null, address: null };
const subscribers = new Set<() => void>();

/** Shallow-merge a partial into state and notify React subscribers. */
function setState(partial: Partial<WsState>): void {
  state = { ...state, ...partial };
  for (const fn of subscribers) fn();
}

function getState(): WsState {
  return state;
}

function subscribe(fn: () => void): () => void {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

/**
 * React selector hook + imperative store handle, in one object (mirrors zustand's
 * `use_ws((s)=>...)` for components AND `use_ws.getState()` for non-React callers).
 *
 *   • `use_ws((s) => s.status)` — subscribe to a reactive slice in a component.
 *   • `use_ws.getState()`       — read the current snapshot outside React.
 *   • `use_ws.connect(addr)` / `use_ws.disconnect()` — drive the connection.
 */
interface UseWs {
  <T>(selector: (s: WsState) => T): T;
  getState: () => WsState;
  connect: (address: string) => void;
  disconnect: () => void;
}

const useWsHook = (<T>(selector: (s: WsState) => T): T =>
  useSyncExternalStore(
    subscribe,
    () => selector(state),
    () => selector(state),
  )) as UseWs;
useWsHook.getState = getState;
// `connect`/`disconnect` are assigned just below their definitions.

export const use_ws: UseWs = useWsHook;

// ───────────────────────────────────────────────────────────────────────────
// Frame send + RPC correlation
// ───────────────────────────────────────────────────────────────────────────

/** Send a typed client frame over the socket (drops if not OPEN — mirrors aresrpg). */
function sendPacket(ws: WebSocket | null, packet: ClientPacket): void {
  if (ws?.readyState !== WebSocket.OPEN) {
    console.warn('[ws] packet dropped (not connected):', packet.type);
    return;
  }
  try {
    ws.send(encodePacket(packet));
  } catch (error) {
    console.error('[ws] send error:', packet.type, error);
  }
}

/**
 * Reject + clear every in-flight RPC (called on close so callers stop hanging).
 */
function failAllPending(reason: string): void {
  for (const [, rpc] of pending) {
    clearTimeout(rpc.timeout);
    rpc.reject(new Error(reason));
  }
  pending.clear();
}

/**
 * Wait for the socket to reach 'connected', kicking a fresh connect when it's down.
 * The heal path for "the socket died while the app sat open" (laptop sleep, an
 * exhausted backoff, a server-side transient auth failure): a user action is fresh
 * intent, so it earns a fresh connection attempt instead of an instant fail.
 */
function ensureConnected(timeoutMs = 6_000): Promise<boolean> {
  if (state.status === 'connected') return Promise.resolve(true);
  if (state.status === 'disconnected' && connect_address) {
    reconnect_attempts = 0; // fresh intent → fresh retry budget
    connect(connect_address);
  }
  return new Promise((resolve) => {
    const done = (ok: boolean) => {
      clearTimeout(timer);
      unsubscribe();
      resolve(ok);
    };
    const timer = setTimeout(() => done(state.status === 'connected'), timeoutMs);
    const unsubscribe = subscribe(() => {
      if (state.status === 'connected') done(true);
    });
  });
}

/**
 * Send an RPC REQUEST and resolve with its correlated RESPONSE `data`. The caller
 * mints the id; the server echoes it; `handleMessage` settles the matching entry.
 * A down socket is healed first (see `ensureConnected`); rejects only if the heal
 * times out, on RPC timeout, or on disconnect.
 */
async function request<Res>(build: (id: string) => ClientPacket): Promise<Res> {
  if (!(await ensureConnected())) {
    throw new Error('Reconnecting — try again in a moment.');
  }
  const { ws } = use_ws.getState();
  if (!ws) throw new Error('Reconnecting — try again in a moment.');
  const id = crypto.randomUUID();
  return new Promise<Res>((resolve, reject) => {
    const timeout = setTimeout(() => {
      pending.delete(id);
      reject(new Error('Request timed out.'));
    }, RPC_TIMEOUT_MS);
    pending.set(id, {
      resolve: (data) => resolve(data as Res),
      reject,
      timeout,
    });
    sendPacket(ws, build(id));
  });
}

/** Settle a correlated RPC response (resolve the matching pending entry). */
function settle(id: string | undefined, data: unknown): void {
  if (!id) return;
  const rpc = pending.get(id);
  if (!rpc) return;
  pending.delete(id);
  clearTimeout(rpc.timeout);
  rpc.resolve(data);
}

/** Reject a correlated RPC with the server's real error message (the `errorResponse` channel). */
function settleError(id: string | undefined, message: string): void {
  if (!id) return;
  const rpc = pending.get(id);
  if (!rpc) return;
  pending.delete(id);
  clearTimeout(rpc.timeout);
  rpc.reject(new Error(message));
}

// ───────────────────────────────────────────────────────────────────────────
// Inbound message dispatch
// ───────────────────────────────────────────────────────────────────────────

async function handleMessage(packet: ServerPacket, ws: WebSocket): Promise<void> {
  switch (packet.type) {
    // ── AUTH ────────────────────────────────────────────────────────────────
    case 'signatureRequest': {
      if (!signer) {
        console.error('[ws] no signer registered — cannot answer auth challenge');
        was_rejected = true;
        ws.close();
        return;
      }
      try {
        const message = new TextEncoder().encode(buildAuthMessage(packet.data.nonce));
        const { bytes, signature } = await signer(message);
        // The ONLY client frame allowed before connectionAccepted.
        sendPacket(ws, { type: 'signatureResponse', data: { bytes, signature } });
      } catch (error) {
        // User rejected the signature or the session is gone — don't loop on it.
        console.error('[ws] personal-message signing failed:', error);
        was_rejected = true;
        ws.close();
      }
      return;
    }

    case 'connectionAccepted': {
      reconnect_delay = 1000;
      setState({ status: 'connected', address: packet.data.address });
      return;
    }

    case 'connectionRejected': {
      // Explicit rejection — do NOT reconnect (mirrors aresrpg's was_kicked).
      console.warn('[ws] connection rejected:', packet.data.reason);
      was_rejected = true;
      failAllPending(`Connection rejected: ${packet.data.reason}`);
      // Belt-and-suspenders: close client-side too (the backend already closes us,
      // but don't depend on it — an un-closed socket would never trigger onclose).
      ws.close();
      return;
    }

    // ── RPC responses (correlated by id) ─────────────────────────────────────
    case 'sponsorResponse':
    case 'executeResponse':
    case 'handleClaimResponse': {
      settle(packet.id, packet.data);
      return;
    }

    // ── RPC failure channel — reject the pending promise with the REAL message ─
    // The backend emits `errorResponse` echoing the failed request's id on every
    // sponsor/execute/handle failure. Without this case the promise would leak to
    // the 30s RPC timeout and reject with a generic "Request timed out." instead of
    // the honest cause (name taken, no route, sponsor rejection, …).
    case 'errorResponse': {
      const err = packet.data as ErrorResponse;
      settleError(packet.id, err.message || 'Request failed.');
      return;
    }

    // ── PUSH (no id) ──────────────────────────────────────────────────────────
    case 'balanceUpdate': {
      for (const fn of balanceListeners) fn(packet.data);
      return;
    }
    case 'agentActivity': {
      for (const fn of agentListeners) fn(packet.data);
      return;
    }
    case 'livechatMessage': {
      for (const fn of livechatListeners) fn(packet.data);
      return;
    }

    // ── Unknown / future frame — drop it (proto-drift stance; never kill the socket). ──
    default: {
      console.warn('[ws] dropped unknown frame:', (packet as { type?: string }).type);
      return;
    }
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Connection lifecycle (mirrors aresrpg's connect()/disconnect()/onclose backoff).
// ───────────────────────────────────────────────────────────────────────────

/**
 * Open the single WS to the backend with the signed-in address as the connect
 * query param (not trusted yet — the backend marks it authenticated:false and
 * challenges it). No-op if already connecting/authenticating/open.
 */
function connect(address: string): void {
  if (state.status === 'connecting' || state.status === 'authenticating') return;
  if (state.ws?.readyState === WebSocket.OPEN) return;

  if (reconnect_timeout) {
    clearTimeout(reconnect_timeout);
    reconnect_timeout = null;
  }
  if (!WS_URL) {
    console.error('[ws] VITE_WS_URL is not configured — cannot connect.');
    return;
  }

  connect_address = address;
  was_rejected = false;

  const ws = new WebSocket(`${WS_URL}?address=${address}`);
  setState({ status: 'connecting', ws, address: null });

  // Bound the open+auth handshake before tearing down (a silently-stalled upgrade).
  const connect_timeout = setTimeout(() => {
    if (ws.readyState !== WebSocket.OPEN) ws.close();
  }, 10_000);

  ws.onopen = () => {
    clearTimeout(connect_timeout);
    // The transport reached the server — reset backoff AND the attempt cap so a
    // post-open drop (auth/network) still gets the full retry budget afresh.
    reconnect_delay = 1000;
    reconnect_attempts = 0;
    // Server sends `signatureRequest` next; we move to 'connected' on accept.
    setState({ status: 'authenticating' });
  };

  ws.onmessage = (event) => {
    // Bun delivers WS text frames as strings; decode drops malformed/unknown
    // frames (returns null) — never kills the socket (aresrpg's proto-drift stance).
    const packet = decodePacket(event.data as string) as Packet | null;
    if (!packet) return;
    void handleMessage(packet as ServerPacket, ws);
  };

  ws.onerror = () => {
    // onclose fires right after — reconnect is handled there.
  };

  ws.onclose = () => {
    clearTimeout(connect_timeout);
    failAllPending('Connection closed.');
    setState({ status: 'disconnected', ws: null, address: null });

    if (was_rejected) {
      was_rejected = false;
      return; // explicit rejection/replacement → no reconnect
    }

    // Reconnect on ANY non-rejected close while a connect target is set — including
    // a FIRST-connect failure (refused/timed-out, where onopen never fired and status
    // stayed 'connecting'). `was_rejected` is the SOLE suppressor; `connect_address`
    // is cleared only on explicit disconnect / sign-out.
    if (!connect_address) return;

    // Cap consecutive failures so a dead backend can't pin the login on a permanent
    // "signing you in" spinner: after the cap we stop cleanly and leave the socket
    // closed (status 'disconnected') for the app-level safety net to redirect.
    if (reconnect_attempts >= MAX_RECONNECT_ATTEMPTS) {
      console.warn(
        `[ws] giving up after ${reconnect_attempts} reconnect attempts — backend unreachable.`,
      );
      reconnect_attempts = 0;
      reconnect_delay = 1000;
      return;
    }

    // Exponential backoff reconnect (1s → 30s); reset on a successful open (onopen).
    reconnect_attempts += 1;
    reconnect_timeout = setTimeout(() => {
      reconnect_timeout = null;
      if (connect_address) connect(connect_address);
    }, reconnect_delay);
    reconnect_delay = Math.min(reconnect_delay * 2, 30_000);
  };
}

/** Close the socket and suppress reconnect (explicit sign-out / teardown). */
function disconnect(): void {
  if (reconnect_timeout) {
    clearTimeout(reconnect_timeout);
    reconnect_timeout = null;
  }
  reconnect_delay = 1000;
  reconnect_attempts = 0; // fresh retry budget for the next sign-in
  connect_address = null;
  was_rejected = true; // suppress the reconnect onclose would otherwise queue
  failAllPending('Disconnected.');
  state.ws?.close();
  setState({ status: 'disconnected', ws: null, address: null });
}

// ── Self-heal on wake. A laptop sleep or network drop can kill the socket after
// the backoff budget is spent; returning to the tab or regaining network is
// user-grade intent, so it kicks a fresh connect while a signed-in target exists.
// Module-scope: registered exactly once per page.
if (typeof window !== 'undefined') {
  const kick = () => {
    if (connect_address && state.status === 'disconnected') {
      reconnect_attempts = 0;
      connect(connect_address);
    }
  };
  window.addEventListener('online', kick);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) kick();
  });
}

// Expose the imperative controls on the hook object so the (non-React) lifecycle
// bridge calls `use_ws.getState().connect(...)` / `.disconnect()` — same ergonomics
// as the zustand store it replaces, without the dependency.
use_ws.connect = connect;
use_ws.disconnect = disconnect;

// ───────────────────────────────────────────────────────────────────────────
// Signer / lifecycle bridge — registered from React.
// ───────────────────────────────────────────────────────────────────────────

/**
 * Register (or clear) the personal-message signer the auth handshake uses. Called
 * by `useWsLifecycle` with the dapp-kit `useSignPersonalMessage` thunk. Passing
 * `null` clears it (on sign-out).
 */
export function registerSigner(fn: PersonalMessageSigner | null): void {
  signer = fn;
}

// ───────────────────────────────────────────────────────────────────────────
// RPC senders — the data layer (suins.ts / useHome) calls THESE, not fetch().
// ───────────────────────────────────────────────────────────────────────────

/**
 * WS RPC: claim `name` for the authenticated address. No address is sent — the
 * backend targets `ws.data.address`, so a claim cannot be spoofed.
 */
export function wsHandleClaim(name: string): Promise<WsHandleClaimResponse> {
  return request<WsHandleClaimResponse>((id) => ({
    type: 'handleClaimRequest',
    id,
    data: { name },
  }));
}

/** WS RPC: sponsor the given tx-KIND bytes for the authenticated sender. */
export function wsSponsor(opts: {
  network: SuiNetwork;
  transactionKindBytes: string;
  sender: string;
}): Promise<WsSponsorResponse> {
  return request<WsSponsorResponse>((id) => ({
    type: 'sponsorRequest',
    id,
    data: {
      network: opts.network,
      transactionKindBytes: opts.transactionKindBytes,
      sender: opts.sender,
    },
  }));
}

/** WS RPC: submit the user's signature over the sponsored bytes; backend pays gas. */
export function wsExecute(opts: {
  digest: string;
  signature: string;
}): Promise<WsExecuteResponse> {
  return request<WsExecuteResponse>((id) => ({
    type: 'executeRequest',
    id,
    data: { digest: opts.digest, signature: opts.signature },
  }));
}
