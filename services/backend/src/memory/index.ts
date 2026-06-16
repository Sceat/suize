// ─────────────────────────────────────────────────────────────────────────────
// THE WALLET MEMORY — "it remembers you", via MemWal (Walrus's agent-memory SDK).
//
// MemWal stores Seal-encrypted, semantically-searchable memories on Walrus, owned
// on-chain by the user. DEFAULT mode: the MemWal relayer does embed + Seal + Walrus
// and SEES PLAINTEXT in transit (owner-accepted 2026-06-14; the privacy upgrade —
// `MemWalManual` / a self-hosted embedder so the relayer sees only ciphertext — is
// the documented IMPROVE-LATER).
//
// STATELESS BY CONSTRUCTION (our laws): the per-user delegate key is DERIVED via
// HKDF from ONE backend master secret + the user's address — no per-user secret
// store, deterministic across replicas. The `accountId` is supplied by the wallet
// (NOT a secret: a wrong one simply fails `seal_approve` against the user's derived
// delegate key, granting no access). The user's zkLogin wallet authorizes the
// delegate ONCE (createAccount + addDelegateKey at onboarding).
//
// NOT A MONEY PATH: the delegate key authorizes MEMORY only — it never signs,
// settles, or sponsors a payment, so the brain's money-fence is unaffected. Memory
// is BEST-EFFORT: every call swallows errors (returns empty / no-ops) so a relayer
// or chain hiccup can NEVER block a payment or break a chat turn.
// ─────────────────────────────────────────────────────────────────────────────
import { hkdfSync } from "node:crypto";
import { MemWal } from "@mysten-incubation/memwal";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { toHex } from "@mysten/sui/utils";
import { config } from "../config";

/** Memory is enabled only when the master key + the MemWal contract ids are all set. */
export const memoryEnabled = (): boolean =>
  Boolean(config.memwalMasterKey && config.memwalPackageId && config.memwalRegistryId);

export const memoryInfo = {
  enabled: memoryEnabled(),
  relayer: config.memwalRelayerUrl,
  namespace: config.memwalNamespace,
} as const;

// HKDF a per-user 32-byte Ed25519 seed from the master secret + the user's address.
// Deterministic (same address → same delegate, on every replica), never stored.
const enc = (s: string) => new TextEncoder().encode(s);
function deriveDelegate(address: string): { keyHex: string; publicKeyHex: string; suiAddress: string } {
  const seed = new Uint8Array(
    hkdfSync("sha256", enc(config.memwalMasterKey!), enc(address.toLowerCase()), enc("suize-memwal-delegate-v1"), 32),
  );
  const kp = Ed25519Keypair.fromSecretKey(seed);
  return {
    keyHex: toHex(seed),
    publicKeyHex: toHex(kp.getPublicKey().toRawBytes()),
    suiAddress: kp.toSuiAddress(),
  };
}

/**
 * The onboarding handshake payload: the user's derived delegate PUBLIC key + the
 * on-chain constants the wallet needs to `createAccount` + `addDelegateKey`. The
 * delegate PRIVATE key never leaves the backend (it's re-derived on demand).
 */
export function delegateInfoFor(address: string): {
  enabled: boolean;
  publicKey?: string;
  suiAddress?: string;
  packageId?: string;
  registryId?: string;
  network?: string;
} {
  if (!memoryEnabled()) return { enabled: false };
  const d = deriveDelegate(address);
  return {
    enabled: true,
    publicKey: d.publicKeyHex,
    suiAddress: d.suiAddress,
    packageId: config.memwalPackageId,
    registryId: config.memwalRegistryId,
    network: config.suiNetwork,
  };
}

// Memory is BEST-EFFORT and must NEVER stall a chat turn: recall is on the response
// path, so it's hard-capped; remember is fire-and-forget but still time-boxed so a
// hung relayer can't pile up dangling promises.
const RECALL_TIMEOUT_MS = 2_500;
const REMEMBER_TIMEOUT_MS = 8_000;

/** Resolve to `fallback` if `p` hasn't settled within `ms` (a hung relayer can't block). */
function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(fallback), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      () => {
        clearTimeout(t);
        resolve(fallback);
      },
    );
  });
}

// Cache the MemWal client per (address, accountId) — construction is cheap but this
// avoids re-deriving the key each turn. Per-replica; harmless to rebuild.
const clients = new Map<string, MemWal>();
function clientFor(address: string, accountId: string): MemWal {
  const cacheKey = `${address.toLowerCase()}:${accountId}`;
  let mw = clients.get(cacheKey);
  if (!mw) {
    const d = deriveDelegate(address);
    mw = MemWal.create({
      key: d.keyHex,
      accountId,
      serverUrl: config.memwalRelayerUrl,
      namespace: config.memwalNamespace,
    });
    clients.set(cacheKey, mw);
  }
  return mw;
}

/**
 * Best-effort semantic recall — the things the agent remembers relevant to `query`.
 * Returns short fact strings (or [] on ANY failure / when memory is off / no account).
 */
export async function recall(address: string, accountId: string | undefined, query: string): Promise<string[]> {
  if (!memoryEnabled() || !accountId || !query.trim()) return [];
  const run = clientFor(address, accountId)
    .recall({ query, topK: 8, maxDistance: 0.7 })
    .then((res) => (res.results ?? []).map((r) => r.text).filter((t) => typeof t === "string" && t.trim()).slice(0, 8))
    .catch((err) => {
      console.error("[memory] recall failed:", (err as Error).message);
      return [] as string[];
    });
  return withTimeout(run, RECALL_TIMEOUT_MS, [] as string[]);
}

/**
 * Best-effort store: `analyze` lets the relayer extract the MEMORABLE facts from the
 * text and store each (trivial messages yield nothing). Fire-and-forget — never await
 * this on the response path.
 */
export async function remember(address: string, accountId: string | undefined, text: string): Promise<void> {
  if (!memoryEnabled() || !accountId || !text.trim()) return;
  const run = clientFor(address, accountId)
    .analyze(text)
    .then(() => undefined)
    .catch((err) => {
      console.error("[memory] remember failed:", (err as Error).message);
    });
  await withTimeout(run, REMEMBER_TIMEOUT_MS, undefined);
}
