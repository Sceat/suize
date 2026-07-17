// =============================================================================
// The SEALED-SITE DECRYPT PIPELINE — framework-free, the single code path both
// the browser viewer (ViewerPage) and the headless E2E proof run. Given a
// SealClient + a signed SessionKey + a v2 manifest, it: builds the seal_approve
// tx, fetches the site's ONE decryption key (denial surfaces here as
// NoAccessError), then per file fetches the encrypted bytes, VERIFIES their
// sha256 against the manifest, decrypts, and finally assembles a single
// self-contained HTML document (assets inlined as data: URLs) to inject into a
// sandboxed <iframe srcdoc>.
//
// Why inline (not blob: URLs): the viewer renders the untrusted site under
// sandbox="allow-scripts" WITHOUT allow-same-origin, giving the frame an opaque
// origin that cannot read blob: URLs minted by this (parent) origin. data: URLs
// are self-contained and load inside the sandbox; that is the only asset scheme
// that works there.
// =============================================================================

import { SealClient, SessionKey, type SealCompatibleClient } from '@mysten/seal'
import { Transaction } from '@mysten/sui/transactions'
import { fromHex } from '@mysten/sui/utils'
import { SEAL_THRESHOLD } from '@suize/shared'
import { NETWORK } from '../config'
import { mimeFor, sealIdentity, sha256Hex, type ManifestV2 } from './manifest'

/** Progress phases the viewer maps to its status line. */
export type UnlockPhase = 'approve' | 'keys' | 'decrypt' | 'assemble'

export interface UnlockOptions {
  /** The reused per-session SealClient (one per browser session — spike law). */
  seal: SealClient
  /** A SessionKey whose personal-message signature is already set. */
  sessionKey: SessionKey
  /** A Sui client used ONLY to build the seal_approve tx kind bytes. */
  suiClient: SealCompatibleClient
  /** `${pkg}::allowlist::seal_approve`. */
  sealApproveTarget: string
  /** The sealed site's Allowlist object id (0x…). */
  allowlistId: string
  /** The verified v2 manifest. */
  manifest: ManifestV2
  /** Walrus aggregator base URL. */
  aggregator: string
  onPhase?: (phase: UnlockPhase, detail?: string) => void
}

/**
 * Build the `seal_approve(id, allowlist)` transaction-kind bytes the Seal key
 * servers dry-run to authorise a decryption. Exactly the two args the Move fn
 * takes: the full identity (namespace-prefixed) + the shared Allowlist object.
 */
export async function buildApproveTxBytes(
  suiClient: SealCompatibleClient,
  sealApproveTarget: string,
  fullId: string,
  allowlistId: string,
): Promise<Uint8Array> {
  const tx = new Transaction()
  tx.moveCall({
    target: sealApproveTarget,
    arguments: [tx.pure.vector('u8', fromHex(fullId)), tx.object(allowlistId)],
  })
  // onlyTransactionKind: no gas/sender — the key servers only execute the kind.
  return await tx.build({ client: suiClient as never, onlyTransactionKind: true })
}

/** Fetch one file's STORED (encrypted) bytes from Walrus by quilt-patch id. */
async function fetchPatch(aggregator: string, patch: string): Promise<Uint8Array> {
  const res = await fetch(`${aggregator}/v1/blobs/by-quilt-patch-id/${encodeURIComponent(patch)}`)
  if (!res.ok) throw new Error(`file fetch failed (${res.status})`)
  return new Uint8Array(await res.arrayBuffer())
}

/**
 * Decrypt every file of a sealed site and return the fully-assembled entry HTML
 * (a single self-contained document, assets inlined as data: URLs).
 *
 * Throws `NoAccessError` (from @mysten/seal) when the connected wallet is not on
 * the allowlist — the viewer distinguishes that (denied) from a network/key
 * server failure (retry). A sha256 mismatch throws a plain Error (tamper/corrupt).
 */
export async function unlockSite(opts: UnlockOptions): Promise<string> {
  const { seal, sessionKey, suiClient, sealApproveTarget, allowlistId, manifest, aggregator } = opts
  const phase = (p: UnlockPhase, d?: string) => opts.onPhase?.(p, d)

  const fullId = sealIdentity(allowlistId)

  phase('approve')
  const txBytes = await buildApproveTxBytes(suiClient, sealApproveTarget, fullId, allowlistId)

  // The whole site is encrypted under ONE identity → one key fetch. This is the
  // step that throws NoAccessError when the crypto refuses (wallet not allowed).
  phase('keys')
  await seal.fetchKeys({ ids: [fullId], txBytes, sessionKey, threshold: SEAL_THRESHOLD[NETWORK] })

  // Decrypt every file. Keys are cached now, so these run in parallel; each
  // verifies the STORED bytes' sha256 before decrypting (verify-then-decrypt).
  const paths = Object.keys(manifest.files)
  phase('decrypt', `${paths.length} file${paths.length === 1 ? '' : 's'}`)
  const decrypted = new Map<string, Uint8Array>()
  await Promise.all(
    paths.map(async (path) => {
      const entry = manifest.files[path]
      const stored = await fetchPatch(aggregator, entry.patch)
      const got = await sha256Hex(stored)
      if (got !== entry.sha256.toLowerCase()) {
        throw new Error(`integrity check failed for ${path}`)
      }
      const plain = await seal.decrypt({ data: stored, sessionKey, txBytes })
      decrypted.set(path, plain)
    }),
  )

  phase('assemble')
  return assembleSrcDoc(manifest, decrypted)
}

/**
 * Assemble the sealed site's entry document into ONE self-contained HTML string.
 * Every other file becomes a data: URL, and each `src=`/`href=` reference to a
 * manifest path is rewritten to point at it — so the sandboxed frame needs no
 * network and no same-origin access.
 */
export function assembleSrcDoc(manifest: ManifestV2, files: Map<string, Uint8Array>): string {
  const entryPath = pickEntry(manifest, files)
  const entryBytes = files.get(entryPath)
  if (!entryBytes) throw new Error('entry document missing after decrypt')

  // path (normalised, leading-slash) -> data: URL for every NON-entry asset.
  const dataUrls = new Map<string, string>()
  for (const [path, bytes] of files) {
    if (path === entryPath) continue
    const mime = mimeFor(path, manifest.files[path]?.ct)
    dataUrls.set(normalisePath(path), `data:${mime};base64,${base64(bytes)}`)
  }

  let html = new TextDecoder().decode(entryBytes)
  // Rewrite every src="…"/href="…" that resolves to a known manifest asset.
  html = html.replace(
    /(\b(?:src|href)\s*=\s*)(["'])([^"']*)\2/gi,
    (whole, pre: string, q: string, url: string) => {
      const target = dataUrls.get(normalisePath(url))
      return target ? `${pre}${q}${target}${q}` : whole
    },
  )
  return html
}

/** Choose the entry document: the manifest's spaFallback if present, else any
 *  '/index.html', else the first file. */
function pickEntry(manifest: ManifestV2, files: Map<string, Uint8Array>): string {
  if (manifest.spaFallback && files.has(manifest.spaFallback)) return manifest.spaFallback
  if (files.has('/index.html')) return '/index.html'
  const first = files.keys().next()
  if (first.done) throw new Error('no files in manifest')
  return first.value
}

/** Normalise a referenced URL / manifest path to a comparable key: strip a
 *  leading `./`, ensure a single leading `/`. Leaves absolute/remote URLs
 *  (with a scheme or `//`) untouched so they are never rewritten. */
function normalisePath(p: string): string {
  if (/^[a-z]+:/i.test(p) || p.startsWith('//')) return p // http:, data:, mailto:, protocol-relative
  let s = p.trim()
  s = s.replace(/^\.\//, '')
  if (!s.startsWith('/')) s = '/' + s
  return s
}

/** base64-encode bytes (chunked so large assets don't blow the call stack). */
function base64(bytes: Uint8Array): string {
  let bin = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(bin)
}
