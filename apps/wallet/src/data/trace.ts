/**
 * The wallet's PRIVATE, user-owned, verifiable conversation + action history.
 *
 *   capture → IndexedDB buffer (survives refresh)
 *   flush   → canonical-encode → Seal-encrypt (client-side, OWNER-ONLY policy) →
 *             POST /trace (blind relay → Walrus, blob owned by the user) →
 *             user-signed, gas-sponsored on-chain ANCHOR (the tamper-proof commitment)
 *   restore → read the latest anchor event → fetch the blob → Seal-decrypt → rehydrate
 *   badge   → "✓ N actions · anchored <tx>", rendered from PUBLIC chain data (no decrypt)
 *
 * Encryption is real Mysten **Seal** (threshold IBE): the content is decryptable ONLY
 * by the owner's zkLogin identity — Suize (and the relay) only ever see ciphertext.
 * The on-chain anchor carries the hash + count + epoch (no content), so the verify
 * badge survives even a key-server outage. NUMBER WALL: this is WRITE-ONLY from the
 * brain's view — an action log, never a source the model reads on-chain numbers from.
 */
import { SealClient, SessionKey } from '@mysten/seal';
import { Transaction } from '@mysten/sui/transactions';
import { fromHex } from '@mysten/sui/utils';
import { PACKAGE_IDS, WALRUS_DEFAULTS } from '@suize/shared';
import { NETWORK, API_BASE } from '../lib/env';
import { runSponsored, type SignTransaction, type BuildClient } from './sponsored';

const TRACE_PKG = PACKAGE_IDS.TRACE.PACKAGE;
const AGGREGATOR = WALRUS_DEFAULTS[NETWORK].aggregator;

// Mysten testnet Seal key-server committee (3-of-5; no API key for basic testnet use).
const SEAL_TESTNET_SERVER = '0xb012378c9f3799fb5b1a7083da74a4069e3c3f1c93de0b27212a5799ce1e1e98';
const SEAL_TESTNET_AGGREGATOR = 'https://seal-aggregator-testnet.mystenlabs.com';

/** The personal-message signer shape (dapp-kit useSignPersonalMessage().mutateAsync). */
export type SignPersonalMessage = (args: { message: Uint8Array }) => Promise<{ signature: string }>;

// ── entry + segment shapes ───────────────────────────────────────────────────
export interface TraceEntry {
  seq: number;
  ts: number;
  kind: 'msg' | 'tool' | 'receipt';
  role?: 'user' | 'assistant';
  text?: string;
  /** receipt only — the secondary line (e.g. "$1.50 · done") and whether it FAILED/declined. */
  meta?: string;
  bad?: boolean;
  tool?: string;
  outcome?: 'ok' | 'err';
  txDigest?: string;
}
interface TraceSegment {
  v: 1;
  owner: string;
  entries: TraceEntry[];
}

// ── IndexedDB buffer (one record per owner; survives page close/refresh) ──────
const DB_NAME = 'suize-trace';
const STORE = 'buffer';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'owner' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function readRecord(owner: string): Promise<TraceEntry[]> {
  try {
    const db = await openDb();
    return await new Promise<TraceEntry[]>((resolve) => {
      const tx = db.transaction(STORE, 'readonly');
      const get = tx.objectStore(STORE).get(owner);
      get.onsuccess = () => resolve((get.result?.entries as TraceEntry[]) ?? []);
      get.onerror = () => resolve([]);
    });
  } catch {
    return []; // private mode / quota — degrade to in-memory (the caller keeps state)
  }
}

async function writeRecord(owner: string, entries: TraceEntry[]): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put({ owner, entries });
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    /* private mode — no-op; the in-memory copy in the hook is the fallback */
  }
}

/** Append one entry to the owner's buffer; returns the new full entry list. */
export async function appendTraceEntry(owner: string, entry: Omit<TraceEntry, 'seq'>): Promise<TraceEntry[]> {
  const cur = await readRecord(owner);
  const next: TraceEntry = { ...entry, seq: cur.length };
  const all = [...cur, next];
  await writeRecord(owner, all);
  return all;
}

export async function readTraceBuffer(owner: string): Promise<TraceEntry[]> {
  return readRecord(owner);
}

/** Replace the buffer (used by restore to rehydrate from a decrypted blob). */
export async function setTraceBuffer(owner: string, entries: TraceEntry[]): Promise<void> {
  await writeRecord(owner, entries);
}

// ── canonical encode + sha256 (load-bearing: identical on capture + verify) ───
// Deterministic JSON: recursively sorted keys, no whitespace, integers only. The
// content hash anchored on-chain is sha256 of THIS, so a faithful restore re-hashes
// to the same value (the verify badge), and any tampered byte breaks it.
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`).join(',')}}`;
}

export function canonicalSegment(owner: string, entries: TraceEntry[]): string {
  const seg: TraceSegment = { v: 1, owner, entries };
  return canonical(seg);
}

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return new Uint8Array(digest);
}

const toHexStr = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

// ── Seal ──────────────────────────────────────────────────────────────────────
let _seal: SealClient | null = null;
function sealClient(suiClient: ConstructorParameters<typeof SealClient>[0]['suiClient']): SealClient {
  if (!_seal) {
    _seal = new SealClient({
      suiClient,
      serverConfigs: [{ objectId: SEAL_TESTNET_SERVER, aggregatorUrl: SEAL_TESTNET_AGGREGATOR, weight: 1 }],
      verifyKeyServers: false,
    });
  }
  return _seal;
}

/** The Seal identity = the owner's 32-byte address (owner-only policy: seal_approve
 *  asserts the requester's address == this id). */
function idHex(owner: string): string {
  return owner.replace(/^0x/, '').toLowerCase();
}

/** Encrypt a plaintext segment to the owner's identity. No user signature needed. */
export async function encryptHistory(
  plaintext: Uint8Array,
  owner: string,
  suiClient: ConstructorParameters<typeof SealClient>[0]['suiClient'],
): Promise<Uint8Array> {
  const { encryptedObject } = await sealClient(suiClient).encrypt({
    threshold: 1, // one decentralized committee server (internally 3-of-5)
    packageId: TRACE_PKG,
    id: idHex(owner),
    data: plaintext,
  });
  return encryptedObject;
}

/** Create + sign a Seal SessionKey (one personal-message signature, 10-min TTL).
 *  Required only to DECRYPT (restore) — encryption needs none. */
export async function createTraceSessionKey(
  owner: string,
  suiClient: Parameters<typeof SessionKey.create>[0]['suiClient'],
  signPersonalMessage: SignPersonalMessage,
): Promise<SessionKey> {
  const sk = await SessionKey.create({ address: owner, packageId: TRACE_PKG, ttlMin: 10, suiClient });
  const { signature } = await signPersonalMessage({ message: sk.getPersonalMessage() });
  // MUST await — in @mysten/seal this is async (it network-verifies the sig before
  // arming the key); without the await, decrypt races ahead and throws "signature not set".
  await sk.setPersonalMessageSignature(signature);
  return sk;
}

/** Decrypt a Seal ciphertext for the owner (needs an initialized SessionKey). */
export async function decryptHistory(
  ciphertext: Uint8Array,
  owner: string,
  sessionKey: SessionKey,
  suiClient: BuildClient,
): Promise<Uint8Array> {
  const tx = new Transaction();
  tx.moveCall({
    target: `${TRACE_PKG}::trace::seal_approve`,
    arguments: [tx.pure.vector('u8', fromHex(idHex(owner)))],
  });
  const txBytes = await tx.build({ client: suiClient, onlyTransactionKind: true });
  return sealClient(suiClient as ConstructorParameters<typeof SealClient>[0]['suiClient']).decrypt({
    data: ciphertext,
    sessionKey,
    txBytes,
  });
}

// ── /trace relay upload (blind; binds the sig to sha256(ciphertext)+ts) ───────
export async function uploadTrace(
  ciphertext: Uint8Array,
  signPersonalMessage: SignPersonalMessage,
): Promise<string> {
  const ts = Date.now();
  const hashHex = toHexStr(await sha256(ciphertext));
  const message = `suize-trace:${hashHex}:${ts}`;
  const { signature } = await signPersonalMessage({ message: new TextEncoder().encode(message) });
  const res = await fetch(`${API_BASE}/trace`, {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream', 'x-trace-ts': String(ts), 'x-trace-sig': signature },
    body: ciphertext as BodyInit,
  });
  if (!res.ok) throw new Error(`trace upload failed (${res.status})`);
  const { blobId } = (await res.json()) as { blobId: string };
  if (!blobId) throw new Error('trace upload: no blobId');
  return blobId;
}

// ── on-chain anchor ───────────────────────────────────────────────────────────
export function buildAnchorTx(blobId: string, contentHash: Uint8Array, count: number): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: PACKAGE_IDS.TRACE.TARGETS.ANCHOR,
    arguments: [
      tx.pure.vector('u8', Array.from(new TextEncoder().encode(blobId))),
      tx.pure.vector('u8', Array.from(contentHash)),
      tx.pure.u64(count),
    ],
  });
  return tx;
}

export interface AnchorRecord {
  blobId: string;
  contentHashHex: string;
  count: number;
  digest: string;
}

/** Read the owner's latest TraceAnchored event (max count) — the head pointer + badge. */
export async function fetchLatestAnchor(
  owner: string,
  suiClient: { queryEvents: (args: unknown) => Promise<{ data: Array<{ parsedJson?: unknown; id: { txDigest: string } }> }> },
): Promise<AnchorRecord | null> {
  try {
    const res = await suiClient.queryEvents({
      // Scope to the OWNER's own anchors (a sponsored anchor keeps the user as sender),
      // so a busy GLOBAL anchor stream can never bury this user's latest anchor.
      query: { All: [{ MoveEventType: `${TRACE_PKG}::trace::TraceAnchored` }, { Sender: owner }] },
      limit: 50,
      order: 'descending',
    });
    let best: AnchorRecord | null = null;
    for (const ev of res.data) {
      const j = ev.parsedJson as { owner?: string; blob_id?: number[]; content_hash?: number[]; count?: string } | undefined;
      if (!j || j.owner?.toLowerCase() !== owner.toLowerCase()) continue;
      const count = Number(j.count ?? 0);
      if (best && count <= best.count) continue;
      best = {
        blobId: new TextDecoder().decode(Uint8Array.from(j.blob_id ?? [])),
        contentHashHex: toHexStr(Uint8Array.from(j.content_hash ?? [])),
        count,
        digest: ev.id.txDigest,
      };
    }
    return best;
  } catch {
    return null;
  }
}

/** Fetch a Walrus blob by id from the public aggregator. */
export async function fetchTraceBlob(blobId: string): Promise<Uint8Array> {
  const res = await fetch(`${AGGREGATOR}/v1/blobs/${blobId}`);
  if (!res.ok) throw new Error(`walrus read failed (${res.status})`);
  return new Uint8Array(await res.arrayBuffer());
}

// ── flush: encrypt → upload → anchor (the whole write path) ───────────────────
export interface FlushResult {
  digest: string;
  count: number;
  contentHashHex: string;
  blobId: string;
}

/**
 * Encrypt the current buffer, store it, and anchor a fresh commitment on-chain.
 * Returns null when there's nothing to anchor. Throws on a real failure (the caller
 * treats it as a non-fatal "pending" — never blocks chat).
 */
export async function flushAndAnchor(opts: {
  owner: string;
  suiClient: BuildClient & ConstructorParameters<typeof SealClient>[0]['suiClient'];
  signPersonalMessage: SignPersonalMessage;
  signTransaction: SignTransaction;
}): Promise<FlushResult | null> {
  const { owner, suiClient, signPersonalMessage, signTransaction } = opts;
  const entries = await readTraceBuffer(owner);
  if (entries.length === 0) return null;

  const plaintext = new TextEncoder().encode(canonicalSegment(owner, entries));
  const contentHash = await sha256(plaintext);
  const ciphertext = await encryptHistory(plaintext, owner, suiClient);
  const blobId = await uploadTrace(ciphertext, signPersonalMessage);

  const digest = await runSponsored({
    tx: buildAnchorTx(blobId, contentHash, entries.length),
    owner,
    client: suiClient,
    signTransaction,
  });
  return { digest, count: entries.length, contentHashHex: toHexStr(contentHash), blobId };
}

/**
 * Cross-device / cold-cache restore: pull the latest anchored history from chain →
 * Walrus, decrypt with the owner's Seal SessionKey (signed SILENTLY by the live
 * zkLogin session — no popup, same path as silent-renew), verify the decrypted bytes
 * hash to the on-chain commitment, and return the entries. Called ONLY when the chain
 * is AHEAD of the local buffer (a fresh device or a cleared cache), so the common
 * same-device path never decrypts and never signs.
 */
export async function restoreFromChain(opts: {
  owner: string;
  anchor: AnchorRecord;
  suiClient: Parameters<typeof SessionKey.create>[0]['suiClient'];
  signPersonalMessage: SignPersonalMessage;
}): Promise<TraceEntry[] | null> {
  const { owner, anchor, suiClient, signPersonalMessage } = opts;
  const ciphertext = await fetchTraceBlob(anchor.blobId);
  const sessionKey = await createTraceSessionKey(owner, suiClient, signPersonalMessage);
  const plaintext = await decryptHistory(ciphertext, owner, sessionKey, suiClient as BuildClient);
  // Integrity: the decrypted plaintext MUST hash to the on-chain commitment, or we
  // refuse it (a swapped/tampered blob can never silently replace your history).
  if (toHexStr(await sha256(plaintext)) !== anchor.contentHashHex) {
    throw new Error('history hash mismatch — not restoring');
  }
  const seg = JSON.parse(new TextDecoder().decode(plaintext)) as { entries?: TraceEntry[] };
  return seg.entries ?? null;
}
