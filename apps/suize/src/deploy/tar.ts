// =============================================================================
// Folder → tar, in the browser. A <input webkitdirectory> (or a drop) yields
// File objects carrying webkitRelativePath ("dist/index.html"); we strip the one
// shared top-level folder so the archive is rooted at the site (index.html at
// root), exactly like the MCP's directory walk. Pure client-side — the bytes go
// straight into the multipart deploy.
// =============================================================================

import { createTar } from 'nanotar'

const IGNORE = new Set(['node_modules', '.git', '.DS_Store', '.wrangler', 'dist-ssr', 'Thumbs.db'])

/** Drag-dropped files carry no webkitRelativePath; the drop traversal below tags
 * each File with the path it walked instead. */
type PathedFile = File & { webkitRelativePath?: string; suizePath?: string }

const pathOf = (f: File): string =>
  ((f as PathedFile).suizePath || (f as PathedFile).webkitRelativePath || f.name).replace(/\\/g, '/')

/** Should this file be dropped from the archive? */
const ignored = (path: string): boolean => path.split('/').some((seg) => IGNORE.has(seg))

/** The common leading folder shared by every path, if any (so we can strip it). */
const commonRoot = (paths: string[]): string => {
  const firsts = paths.map((p) => (p.includes('/') ? p.slice(0, p.indexOf('/')) : ''))
  const first = firsts[0]
  return first && firsts.every((f) => f === first) ? first + '/' : ''
}

export interface TarResult {
  tar: Uint8Array
  fileCount: number
  totalBytes: number
  /** The site-relative paths that went in (for a pre-publish preview). */
  files: string[]
}

/** Build a tar from a set of browser Files. Throws with an actionable message if
 * empty or missing an entry document. */
export async function tarFromFiles(fileList: File[]): Promise<TarResult> {
  const kept = fileList.filter((f) => !ignored(pathOf(f)))
  if (kept.length === 0) throw new Error('No files to publish — pick a folder with your built site (e.g. dist/).')

  const root = commonRoot(kept.map(pathOf))
  const entries: { name: string; data: Uint8Array }[] = []
  const names: string[] = []
  let totalBytes = 0

  for (const f of kept) {
    const rel = pathOf(f).slice(root.length)
    if (!rel) continue
    const data = new Uint8Array(await f.arrayBuffer())
    entries.push({ name: rel, data })
    names.push(rel)
    totalBytes += data.byteLength
  }
  if (entries.length === 0) throw new Error('No files to publish after filtering.')
  // The entry page must sit at the archive ROOT (a nested dist/index.html means
  // the user picked the project folder — the paid site would 404 at /).
  if (!names.some((n) => /^index\.html?$/i.test(n))) {
    throw new Error(
      'No index.html at the folder root. Pick your built site folder itself (e.g. dist/), not the project around it.',
    )
  }

  return { tar: createTar(entries), fileCount: entries.length, totalBytes, files: names.sort() }
}

// ── drag-and-drop → File[] (directory traversal) ─────────────────────────────

const fileOf = (entry: FileSystemFileEntry): Promise<File> =>
  new Promise((resolve, reject) => entry.file(resolve, reject))

/** readEntries returns batches (Chrome caps at 100) — drain until empty. */
const allEntries = async (dir: FileSystemDirectoryEntry): Promise<FileSystemEntry[]> => {
  const reader = dir.createReader()
  const out: FileSystemEntry[] = []
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject))
    if (batch.length === 0) return out
    out.push(...batch)
  }
}

const walkEntry = async (entry: FileSystemEntry, path: string, out: File[]): Promise<void> => {
  if (entry.isFile) {
    const f = (await fileOf(entry as FileSystemFileEntry)) as PathedFile
    f.suizePath = path + entry.name
    out.push(f)
  } else if (entry.isDirectory) {
    if (IGNORE.has(entry.name)) return
    for (const child of await allEntries(entry as FileSystemDirectoryEntry)) {
      await walkEntry(child, `${path}${entry.name}/`, out)
    }
  }
}

/** Files from a drop event — folders are walked recursively, each File tagged
 * with its relative path so tarFromFiles roots the archive correctly. */
export async function filesFromDataTransfer(dt: DataTransfer): Promise<File[]> {
  const out: File[] = []
  const entries = Array.from(dt.items)
    .map((item) => (item.kind === 'file' ? item.webkitGetAsEntry?.() : null))
    .filter((e): e is FileSystemEntry => e != null)
  if (entries.length === 0) return Array.from(dt.files) // browsers without entry support: flat files
  for (const entry of entries) await walkEntry(entry, '', out)
  return out
}
