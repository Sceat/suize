// Walrus HTTP adapter — uploads via plain HTTP against a Walrus publisher (no
// CLI, no in-process WASM encoder). The publisher does the encoding + signs the
// storage txs + pays WAL itself; the backend just PUTs bytes. On the PUBLIC
// testnet publisher the operator pays the WAL — the deploy wallet only needs a
// little SUI for the on-chain create_site gas (see .env.example). Pointing
// `walrusPublisherUrl` at a self-hosted publisher (mainnet) is the only change
// needed there — this exact code serves both.
//
// Verified contract (live testnet publisher):
//   - quilt: PUT <publisher>/v1/quilts?epochs=<N>&permanent=true&send_object_to=<addr>,
//     multipart/form-data, ONE part per file where the part FIELD NAME == the file's
//     quilt identifier (with a `;type=<mime>`). 200 + JSON
//     { blobStoreResult, storedQuiltBlobs[] }.
//   - blob (manifest): PUT <publisher>/v1/blobs?epochs=<N>&permanent=true&send_object_to=
//     <addr>, raw bytes body. 200 + JSON with `newlyCreated|alreadyCertified` at the TOP
//     LEVEL — NOT wrapped in `blobStoreResult` the way /v1/quilts is (the two endpoints
//     differ; verified live).
//   - `send_object_to=<addr>` makes the publisher TRANSFER the on-chain Walrus `Blob`
//     OBJECT to <addr> (the deploy service wallet) — owning the object is what lets the
//     renewal relayer later call `system::extend_blob` on it. `permanent=true` makes it
//     non-deletable. `newlyCreated.blobObject` then carries the object `id` + the
//     `storage.endEpoch`.
//   - On a re-store of identical bytes the top-level key is `alreadyCertified` instead
//     of `newlyCreated` — NO new object exists then (nothing to own/extend), so we treat
//     it as a HARD 502: the deploy module salts every bundle with a unique per-deploy
//     receipt file, so a dedup hit can only mean that salt went missing.
import { config } from "../config";

/** A single file to include in the quilt — its quilt identifier + bytes + mime. */
export interface QuiltInputFile {
  /** The path served by the worker (manifest key), e.g. "/index.html". */
  servedPath: string;
  /** The quilt-patch identifier — the multipart part field name. Unique per file. */
  identifier: string;
  /** File bytes. */
  data: Uint8Array;
  /** Media type for the part (e.g. "text/html"). */
  contentType: string;
}

/** Result of a quilt upload: the root quilt blob id + per-served-path patch id. */
export interface QuiltUploadResult {
  /** Walrus root quilt blob id (the on-chain `quilt_id`). */
  quiltId: string;
  /** The on-chain Walrus `Blob` OBJECT id (transferred to `sendObjectTo`) — what
   * the relayer extends via `system::extend_blob`. */
  quiltBlobObject: string;
  /** The Walrus epoch the quilt's storage currently ends at. */
  endEpoch: number;
  /** servedPath -> Walrus quilt patch id. */
  patchIds: Record<string, string>;
}

/** Result of a single-blob (manifest) upload. */
export interface BlobUploadResult {
  /** Walrus blob id (the on-chain `manifest_blob_id`). */
  blobId: string;
  /** The on-chain Walrus `Blob` OBJECT id (transferred to `sendObjectTo`). */
  blobObject: string;
  /** The Walrus epoch the blob's storage currently ends at. */
  endEpoch: number;
}

/** Raised when the publisher is unreachable / errors — caller maps to 503/502. */
export class WalrusError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "WalrusError";
  }
}

// ---------------------------------------------------------------------------
// Publisher JSON shapes. The root quilt/blob id lives in
// blobStoreResult.newlyCreated; per-patch ids are in `storedQuiltBlobs[]` keyed
// by `identifier`. `alreadyCertified` (dedup hit, no new object) is a HARD error
// here — see the module doc.
// ---------------------------------------------------------------------------

interface BlobObjectJson {
  /** The on-chain Walrus `Blob` OBJECT id (transferred via `send_object_to`). */
  id?: string;
  blobId?: string;
  storage?: { endEpoch?: number };
}

interface BlobStoreResult {
  newlyCreated?: { blobObject?: BlobObjectJson };
  alreadyCertified?: { blobId?: string };
}

interface StoredQuiltBlob {
  identifier?: string;
  quiltPatchId?: string;
}

interface StoreQuiltJson {
  blobStoreResult?: BlobStoreResult;
  storedQuiltBlobs?: StoredQuiltBlob[];
}

// /v1/blobs returns the BlobStoreResult shape DIRECTLY (newlyCreated|alreadyCertified
// at the top level); /v1/quilts wraps it in `blobStoreResult`. Accept both.
interface StoreBlobJson extends BlobStoreResult {
  blobStoreResult?: BlobStoreResult;
}

/**
 * Pull the freshly-created blob's id + OBJECT id + storage end epoch out of a
 * blobStoreResult. REQUIRES `newlyCreated`: an `alreadyCertified` response means
 * the publisher dedup'd to an existing blob and created/transferred NO object —
 * the relayer could never extend that storage. With the unique per-deploy receipt
 * file salting every bundle, dedup must never happen; treat it as a hard 502.
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

// ---------------------------------------------------------------------------
// HTTP — a generous timeout (encoding+storing a bundle is not instant), an
// AbortController ceiling so a wedged publisher can't hang a request forever,
// and a single place that maps transport/HTTP errors onto WalrusError.
// ---------------------------------------------------------------------------

const HTTP_TIMEOUT_MS = 5 * 60 * 1000; // 5 min — storing a bundle is not instant.

/** PUT a body to the publisher and parse the JSON result. Maps failures to WalrusError. */
const putJson = async <T>(url: string, body: BodyInit, tag: string): Promise<T> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(url, { method: "PUT", body, signal: controller.signal });
  } catch (err) {
    // Network failure / abort — the publisher is unreachable or wedged. 503 so the
    // caller surfaces it as "Walrus unavailable" (mirrors the old missing-CLI 503).
    const reason = (err as Error).name === "AbortError" ? "timed out" : (err as Error).message;
    throw new WalrusError(`${tag}: publisher unreachable (${reason})`, 503);
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    // The publisher's real reason is in the body (e.g. funding / rate-limit); surface
    // its tail so the operator sees it. 502 — the upstream store failed.
    const detail = (await res.text().catch(() => "")).trim().slice(0, 300);
    throw new WalrusError(`${tag}: publisher ${res.status}${detail ? `: ${detail}` : ""}`, 502);
  }

  try {
    return (await res.json()) as T;
  } catch (err) {
    throw new WalrusError(`${tag}: unparseable publisher JSON: ${(err as Error).message}`, 502);
  }
};

/** Shared query string: storage duration + permanent + transfer the Blob OBJECT
 * to the deploy service wallet so the relayer can `extend_blob` it later. */
const storeQuery = (sendObjectTo: string): string =>
  `epochs=${config.deployEpochs}&permanent=true&send_object_to=${encodeURIComponent(sendObjectTo)}`;

/**
 * Upload all site files as ONE Walrus quilt. Each file becomes a multipart part
 * whose FIELD NAME is its quilt-patch identifier (the publisher uses the part
 * name as the identifier and echoes it back in `storedQuiltBlobs`). We map each
 * identifier back to its served path here. Returns the root quilt id + the Blob
 * OBJECT id (owned by `sendObjectTo`) + the storage end epoch + per-served-path
 * patch ids. Throws {@link WalrusError} on a network failure (503), a store
 * failure (502), or a dedup hit (502 — see {@link newlyCreatedBlob}).
 *
 * @param files        the files to store (servedPath + unique identifier + bytes + mime)
 * @param sendObjectTo the address that receives the on-chain `Blob` object (the
 *                     deploy service wallet — passed in to keep this module
 *                     dependency-light; deploy/index.ts owns the wallet)
 */
export const storeQuilt = async (
  files: QuiltInputFile[],
  sendObjectTo: string,
): Promise<QuiltUploadResult> => {
  if (files.length === 0) throw new WalrusError("no files to store", 400);

  const form = new FormData();
  for (const f of files) {
    // Part field name == the quilt identifier; `type` sets the part's media type.
    form.append(f.identifier, new Blob([f.data as BlobPart], { type: f.contentType }), f.identifier);
  }

  const url = `${config.walrusPublisherUrl}/v1/quilts?${storeQuery(sendObjectTo)}`;
  const parsed = await putJson<StoreQuiltJson>(url, form, "store-quilt");

  const { blobId: quiltId, objectId: quiltBlobObject, endEpoch } = newlyCreatedBlob(
    parsed.blobStoreResult,
    "store-quilt",
  );

  // identifier -> patchId from storedQuiltBlobs.
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

/**
 * Store a single blob (the manifest JSON) and return its Walrus blob id + Blob
 * OBJECT id (owned by `sendObjectTo`) + storage end epoch. Used for the
 * path->patch manifest the worker reads. Throws {@link WalrusError}.
 */
export const storeBlob = async (
  bytes: Uint8Array,
  sendObjectTo: string,
): Promise<BlobUploadResult> => {
  const url = `${config.walrusPublisherUrl}/v1/blobs?${storeQuery(sendObjectTo)}`;
  const parsed = await putJson<StoreBlobJson>(url, bytes as BlobPart, "store");
  // /v1/blobs puts newlyCreated|alreadyCertified at the TOP level (no wrapper);
  // /v1/quilts wraps it. Read the wrapper if present, else the object itself.
  const { blobId, objectId: blobObject, endEpoch } = newlyCreatedBlob(
    parsed.blobStoreResult ?? parsed,
    "store",
  );
  return { blobId, blobObject, endEpoch };
};
