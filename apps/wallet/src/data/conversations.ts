/**
 * CHAT HISTORY — a local-first, multi-conversation archive in IndexedDB.
 *
 * The wallet keeps ONE live conversation in the existing trace path (IndexedDB buffer →
 * Seal-encrypted → Walrus → on-chain anchor — see data/trace.ts). This module sits ON TOP
 * of that: it archives EVERY conversation (each with its own id + derived title) so the
 * history sidebar can list them and switch between them. The ACTIVE conversation continues
 * to anchor to Walrus via trace; the archive is the local index of all of them.
 *
 * Keyed by `${owner}::${id}` so two Google logins on one browser never collide. Pure
 * IndexedDB (survives refresh); degrades to no-op in private mode (the in-memory state in
 * the panel is the fallback). No secrets here — the encrypted Walrus copy is the durable one.
 */

/** One chat turn — the serializable subset of the panel's `Turn` (no functions). */
export interface ChatTurn {
  who: 'you' | 'ai';
  text: string;
  kind?: 'receipt';
  meta?: string;
  bad?: boolean;
  thoughtSec?: number;
}

/** A stored conversation. */
export interface ChatRecord {
  key: string; // `${owner}::${id}` — the IndexedDB key
  owner: string;
  id: string;
  title: string;
  turns: ChatTurn[];
  updatedAt: number;
}

/** The lightweight shape the sidebar renders. */
export interface ChatMeta {
  id: string;
  title: string;
  updatedAt: number;
}

const DB_NAME = 'suize-chats';
const STORE = 'chats';

const keyOf = (owner: string, id: string) => `${owner.toLowerCase()}::${id}`;

/** A fresh conversation id. (App runtime — crypto.randomUUID is fine here.) */
export const newChatId = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `c-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        const os = req.result.createObjectStore(STORE, { keyPath: 'key' });
        os.createIndex('owner', 'owner', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Derive a human title from the first real user line; fall back to "New chat". */
function deriveTitle(turns: ChatTurn[]): string {
  const first = turns.find((t) => t.who === 'you' && t.text.trim());
  const raw = (first?.text ?? '').replace(/\s+/g, ' ').trim();
  if (!raw) return 'New chat';
  return raw.length > 42 ? `${raw.slice(0, 41)}…` : raw;
}

/** Every conversation for `owner`, newest-first (metadata only). */
export async function listChats(owner: string): Promise<ChatMeta[]> {
  if (!owner) return [];
  try {
    const db = await openDb();
    return await new Promise<ChatMeta[]>((resolve) => {
      const tx = db.transaction(STORE, 'readonly');
      const idx = tx.objectStore(STORE).index('owner');
      const req = idx.getAll(owner.toLowerCase());
      req.onsuccess = () => {
        const rows = (req.result as ChatRecord[]) ?? [];
        resolve(
          rows
            .map((r) => ({ id: r.id, title: r.title, updatedAt: r.updatedAt }))
            .sort((a, b) => b.updatedAt - a.updatedAt),
        );
      };
      req.onerror = () => resolve([]);
    });
  } catch {
    return [];
  }
}

/** The turns of one conversation (empty if absent). */
export async function loadChat(owner: string, id: string): Promise<ChatTurn[]> {
  if (!owner || !id) return [];
  try {
    const db = await openDb();
    return await new Promise<ChatTurn[]>((resolve) => {
      const tx = db.transaction(STORE, 'readonly');
      const get = tx.objectStore(STORE).get(keyOf(owner, id));
      get.onsuccess = () => resolve(((get.result as ChatRecord | undefined)?.turns as ChatTurn[]) ?? []);
      get.onerror = () => resolve([]);
    });
  } catch {
    return [];
  }
}

/** Upsert a conversation (re-derives the title + bumps updatedAt). Empty turns are
 *  not persisted — a brand-new, never-used chat leaves no row until the user speaks. */
export async function saveChat(owner: string, id: string, turns: ChatTurn[]): Promise<void> {
  if (!owner || !id) return;
  const clean = turns.filter((t) => t.text.trim() || t.kind === 'receipt');
  if (clean.length === 0) return;
  try {
    const db = await openDb();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, 'readwrite');
      const rec: ChatRecord = {
        key: keyOf(owner, id),
        owner: owner.toLowerCase(),
        id,
        title: deriveTitle(clean),
        turns: clean,
        updatedAt: Date.now(),
      };
      tx.objectStore(STORE).put(rec);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    /* private mode — the panel keeps the in-memory copy */
  }
}

/** Forget one conversation. */
export async function deleteChat(owner: string, id: string): Promise<void> {
  if (!owner || !id) return;
  try {
    const db = await openDb();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(keyOf(owner, id));
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    /* no-op */
  }
}

// ── active-chat pointer (a UI pointer, localStorage is fine per the prefs law) ──
const ACTIVE_KEY = (owner: string) => `suize:chat:active:${owner.toLowerCase()}`;

export function getActiveChatId(owner: string): string | null {
  if (!owner) return null;
  try {
    return localStorage.getItem(ACTIVE_KEY(owner));
  } catch {
    return null;
  }
}

export function setActiveChatId(owner: string, id: string): void {
  if (!owner) return;
  try {
    localStorage.setItem(ACTIVE_KEY(owner), id);
  } catch {
    /* private mode */
  }
}
