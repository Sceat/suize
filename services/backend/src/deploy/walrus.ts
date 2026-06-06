// Walrus HTTP adapter — uploads via plain HTTP against a Walrus publisher (no
// CLI, no in-process WASM encoder). The publisher does the encoding + signs the
// storage txs + pays WAL itself; the backend just PUTs bytes. On the PUBLIC
// testnet publisher the operator pays the WAL — the deploy wallet only needs a
// little SUI for the on-chain create_site gas (see .env.example). Pointing
// `walrusPublisherUrl` at a self-hosted publisher (mainnet) is the only change
// needed there — this exact code serves both.
//
// Verified contract (live testnet publisher):
//   - quilt: PUT <publisher>/v1/quilts?epochs=<N>, multipart/form-data, ONE part
//     per file where the part FIELD NAME == the file's quilt identifier (with a
//     `;type=<mime>`). 200 + JSON { blobStoreResult, storedQuiltBlobs[] }.
//   - blob (manifest): PUT <publisher>/v1/blobs?epochs=<N>, raw bytes body.
//     200 + JSON { blobStoreResult }.
//   - On a re-store of identical bytes the top-level key is `alreadyCertified`
//     instead of `newlyCreated` — both carry the blob id.
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
  /** servedPath -> Walrus quilt patch id. */
  patchIds: Record<string, string>;
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
// blobStoreResult.{newlyCreated|alreadyCertified}; per-patch ids are in
// `storedQuiltBlobs[]` keyed by `identifier`. We tolerate either store outcome.
// ---------------------------------------------------------------------------

interface BlobStoreResult {
  newlyCreated?: { blobObject?: { blobId?: string } };
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

interface StoreBlobJson {
  blobStoreResult?: BlobStoreResult;
}

/** Pull the root blob id out of a blobStoreResult (newlyCreated OR alreadyCertified). */
const rootBlobId = (r: BlobStoreResult | undefined): string | undefined =>
  r?.newlyCreated?.blobObject?.blobId ?? r?.alreadyCertified?.blobId;

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

/**
 * Upload all site files as ONE Walrus quilt. Each file becomes a multipart part
 * whose FIELD NAME is its quilt-patch identifier (the publisher uses the part
 * name as the identifier and echoes it back in `storedQuiltBlobs`). We map each
 * identifier back to its served path here. Returns the root quilt id + per-served-
 * path patch ids. Throws {@link WalrusError} on a network failure (503) or a
 * store failure (502).
 *
 * @param files the files to store (servedPath + unique identifier + bytes + mime)
 */
export const storeQuilt = async (files: QuiltInputFile[]): Promise<QuiltUploadResult> => {
  if (files.length === 0) throw new WalrusError("no files to store", 400);

  const form = new FormData();
  for (const f of files) {
    // Part field name == the quilt identifier; `type` sets the part's media type.
    form.append(f.identifier, new Blob([f.data as BlobPart], { type: f.contentType }), f.identifier);
  }

  const url = `${config.walrusPublisherUrl}/v1/quilts?epochs=${config.deployEpochs}`;
  const parsed = await putJson<StoreQuiltJson>(url, form, "store-quilt");

  const quiltId = rootBlobId(parsed.blobStoreResult);
  if (!quiltId) throw new WalrusError("store-quilt: missing root quilt id in publisher output", 502);

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

  return { quiltId, patchIds };
};

/**
 * Store a single blob (the manifest JSON) and return its Walrus blob id. Used
 * for the path->patch manifest the worker reads. Throws {@link WalrusError}.
 */
export const storeBlob = async (bytes: Uint8Array): Promise<string> => {
  const url = `${config.walrusPublisherUrl}/v1/blobs?epochs=${config.deployEpochs}`;
  const parsed = await putJson<StoreBlobJson>(url, bytes as BlobPart, "store");
  const blobId = rootBlobId(parsed.blobStoreResult);
  if (!blobId) throw new WalrusError("store: missing blob id in publisher output", 502);
  return blobId;
};
