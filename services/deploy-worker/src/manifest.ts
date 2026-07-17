// The site manifest — the path → Walrus-patch map whose sha256 lives on the
// on-chain `Site` (`manifest_hash`). ONE shape, two versions:
//   v1 — public site: entries describe the ORIGINAL file bytes.
//   v2 — sealed site: `sealed: true` + `allowlistId`; every file's stored bytes
//        are Seal-encrypted, and `sha256`/`size` describe the STORED (encrypted)
//        bytes — the serve/viewer integrity checks hash what they fetched.
// Written by the publish path; read by the serving face and the suize.io viewer.

export interface ManifestEntry {
  /** Walrus quilt patch id for this file (the stored bytes). */
  patch: string;
  /** Lowercase hex sha256 of the STORED bytes (encrypted bytes on a sealed site). */
  sha256: string;
  /** Content-Type of the ORIGINAL file (what a viewer renders after decrypt). */
  ct: string;
  /** STORED byte length. */
  size: number;
}

export interface Manifest {
  v: number;
  /** Path served for unmatched extensionless routes (SPA fallback). */
  spaFallback: string;
  files: Record<string, ManifestEntry>;
  /** v2 (sealed) only. */
  sealed?: boolean;
  /** v2 (sealed) only — the on-chain allowlist gating decryption. */
  allowlistId?: string;
}

export interface ManifestInput {
  servedPath: string;
  storedSha256: string;
  ct: string;
  storedSize: number;
  patch: string;
}

export const buildManifest = (
  files: ManifestInput[],
  sealed: { allowlistId: string } | null,
): Manifest => {
  const map: Record<string, ManifestEntry> = {};
  for (const f of files) {
    map[f.servedPath] = { patch: f.patch, sha256: f.storedSha256, ct: f.ct, size: f.storedSize };
  }
  const spaFallback = map['/index.html'] ? '/index.html' : '';
  return sealed
    ? { v: 2, sealed: true, allowlistId: sealed.allowlistId, spaFallback, files: map }
    : { v: 1, spaFallback, files: map };
};
