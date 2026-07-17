// Walrus HTTP adapter — stores via a Walrus publisher over plain HTTP (no CLI,
// no in-process encoder). The publisher encodes + signs the storage txs + pays
// the WAL for the store; this worker only PUTs bytes. `send_object_to` transfers
// the on-chain `Blob` OBJECT to the service wallet, which is what lets a paid
// /extend later `system::extend_blob` it; `permanent=true` makes the blob
// non-deletable — part of the trust story: not even Suize can remove your bytes
// before they expire. (Ported from the retired backend's deploy/walrus.ts;
// verified publisher contract unchanged.)

import { mintPublisherJwt } from "./jwt";

/** Binds a store PUT to the publisher's native JWT auth. Absent ⇒ no header
 * (the public testnet publisher path stays untouched). `epochs`/`sendObjectTo`
 * are bound INTO the token so a leak can't be replayed against other terms. */
interface PublisherAuth {
  secret: string;
  epochs: number;
  sendObjectTo: string;
}

export interface QuiltInputFile {
  /** The path served by the worker (manifest key), e.g. "/index.html". */
  servedPath: string;
  /** The quilt-patch identifier — the multipart part field name. Unique per file. */
  identifier: string;
  /** File bytes AS STORED (Seal-encrypted for a sealed site). */
  data: Uint8Array;
  /** Media type for the part. */
  contentType: string;
}

export interface QuiltUploadResult {
  quiltId: string;
  /** The on-chain Walrus `Blob` OBJECT id (owned by `sendObjectTo`) — the
   * storage-extension target. */
  quiltBlobObject: string;
  endEpoch: number;
  /** servedPath -> Walrus quilt patch id. */
  patchIds: Record<string, string>;
}

export interface BlobUploadResult {
  blobId: string;
  blobObject: string;
  endEpoch: number;
}

export class WalrusError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "WalrusError";
  }
}

interface BlobObjectJson {
  id?: string;
  blobId?: string;
  storage?: { endEpoch?: number };
}

interface BlobStoreResult {
  newlyCreated?: { blobObject?: BlobObjectJson };
  alreadyCertified?: { blobId?: string };
}

interface StoreQuiltJson {
  blobStoreResult?: BlobStoreResult;
  storedQuiltBlobs?: { identifier?: string; quiltPatchId?: string }[];
}

// /v1/blobs returns the BlobStoreResult shape DIRECTLY; /v1/quilts wraps it.
interface StoreBlobJson extends BlobStoreResult {
  blobStoreResult?: BlobStoreResult;
}

/**
 * REQUIRES `newlyCreated`: an `alreadyCertified` response means the publisher
 * dedup'd to an existing blob and created/transferred NO object — nothing a
 * paid extend could ever top up. The unique per-deploy receipt salt makes dedup
 * impossible, so a hit here is a hard 502, not a success.
 */
const newlyCreatedBlob = (
  r: BlobStoreResult | undefined,
  tag: string,
): { blobId: string; objectId: string; endEpoch: number } => {
  if (r?.alreadyCertified) {
    throw new WalrusError(`${tag}: walrus dedup hit (alreadyCertified) — receipt salt missing?`, 502);
  }
  const obj = r?.newlyCreated?.blobObject;
  if (!obj?.blobId || !obj?.id) {
    throw new WalrusError(`${tag}: missing newlyCreated blob id/object in publisher output`, 502);
  }
  return { blobId: obj.blobId, objectId: obj.id, endEpoch: Number(obj.storage?.endEpoch ?? 0) };
};

const HTTP_TIMEOUT_MS = 5 * 60 * 1000; // encoding + storing a bundle is not instant

const putJson = async <T>(
  url: string,
  body: BodyInit,
  tag: string,
  auth?: PublisherAuth,
): Promise<T> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);

  // Mint a FRESH single-use token per PUT (unique jti) when the secret is set.
  const headers = auth
    ? { Authorization: `Bearer ${await mintPublisherJwt(auth.secret, auth.epochs, auth.sendObjectTo)}` }
    : undefined;

  let res: Response;
  try {
    res = await fetch(url, { method: "PUT", body, headers, signal: controller.signal });
  } catch (err) {
    const reason = (err as Error).name === "AbortError" ? "timed out" : (err as Error).message;
    throw new WalrusError(`${tag}: publisher unreachable (${reason})`, 503);
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).trim().slice(0, 300);
    throw new WalrusError(`${tag}: publisher ${res.status}${detail ? `: ${detail}` : ""}`, 502);
  }

  try {
    return (await res.json()) as T;
  } catch (err) {
    throw new WalrusError(`${tag}: unparseable publisher JSON: ${(err as Error).message}`, 502);
  }
};

const storeQuery = (epochs: number, sendObjectTo: string): string =>
  `epochs=${epochs}&permanent=true&send_object_to=${encodeURIComponent(sendObjectTo)}`;

/** Upload all site files as ONE Walrus quilt (each multipart part's FIELD NAME
 * is its quilt-patch identifier). Throws {@link WalrusError} on failure. */
export const storeQuilt = async (
  publisherUrl: string,
  files: QuiltInputFile[],
  epochs: number,
  sendObjectTo: string,
  jwtSecret?: string,
): Promise<QuiltUploadResult> => {
  if (files.length === 0) throw new WalrusError("no files to store", 400);

  const form = new FormData();
  for (const f of files) {
    form.append(
      f.identifier,
      new Blob([f.data as unknown as ArrayBuffer], { type: f.contentType }),
      f.identifier,
    );
  }

  const url = `${publisherUrl}/v1/quilts?${storeQuery(epochs, sendObjectTo)}`;
  const auth = jwtSecret ? { secret: jwtSecret, epochs, sendObjectTo } : undefined;
  const parsed = await putJson<StoreQuiltJson>(url, form, "store-quilt", auth);

  const { blobId: quiltId, objectId: quiltBlobObject, endEpoch } = newlyCreatedBlob(
    parsed.blobStoreResult,
    "store-quilt",
  );

  const byIdentifier = new Map<string, string>();
  for (const b of parsed.storedQuiltBlobs ?? []) {
    if (b.identifier && b.quiltPatchId) byIdentifier.set(b.identifier, b.quiltPatchId);
  }

  const patchIds: Record<string, string> = {};
  for (const f of files) {
    const patch = byIdentifier.get(f.identifier);
    if (!patch) {
      throw new WalrusError(
        `store-quilt: no patch id for "${f.servedPath}" (identifier "${f.identifier}")`,
        502,
      );
    }
    patchIds[f.servedPath] = patch;
  }

  return { quiltId, quiltBlobObject, endEpoch, patchIds };
};

/** Store a single blob (the manifest JSON). Throws {@link WalrusError}. */
export const storeBlob = async (
  publisherUrl: string,
  bytes: Uint8Array,
  epochs: number,
  sendObjectTo: string,
  jwtSecret?: string,
): Promise<BlobUploadResult> => {
  const url = `${publisherUrl}/v1/blobs?${storeQuery(epochs, sendObjectTo)}`;
  const auth = jwtSecret ? { secret: jwtSecret, epochs, sendObjectTo } : undefined;
  const parsed = await putJson<StoreBlobJson>(url, bytes as BodyInit, "store", auth);
  const { blobId, objectId: blobObject, endEpoch } = newlyCreatedBlob(
    parsed.blobStoreResult ?? parsed,
    "store",
  );
  return { blobId, blobObject, endEpoch };
};
