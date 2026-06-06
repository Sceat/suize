// ============================================================================
// Client-side TAR packing — turn the files a human drag-drops (a built static
// folder) into the single `site.tar` the backend's POST /deploy expects (SPEC
// §2/§7). Pure, dependency-free ustar writer (no JSZip / no tar-stream): the
// browser File API + a couple of typed-array helpers are all we need, and it
// keeps the bundle lean (the agent path POSTs a tar directly; this is the human
// fallback in the dashboard).
//
// We emit standard POSIX ustar 512-byte-block records, which `tar -xf` and any
// server-side tar reader unpack faithfully (path, size, content-type-agnostic
// bytes). Paths are normalized to forward slashes with NO leading slash so the
// backend's manifest keys come out as "/index.html" after it re-prefixes.
// ============================================================================

// A file picked from a directory, with its path RELATIVE to the chosen root.
export type PackFile = {
  // POSIX-style relative path, e.g. "index.html" or "assets/app.123.js".
  path: string
  bytes: Uint8Array
}

const BLOCK = 512

// Encode a string into a fixed-width, NUL-padded byte field (ustar header).
const write_str = (
  buf: Uint8Array,
  offset: number,
  str: string,
  len: number,
): void => {
  const bytes = new TextEncoder().encode(str)
  for (let i = 0; i < len; i += 1) {
    buf[offset + i] = i < bytes.length ? bytes[i] : 0
  }
}

// Encode an octal number into a fixed-width, NUL-terminated field (ustar).
const write_octal = (
  buf: Uint8Array,
  offset: number,
  value: number,
  len: number,
): void => {
  // ustar octal fields are `len-1` octal digits + a trailing NUL (or space).
  const oct = value.toString(8).padStart(len - 1, '0')
  write_str(buf, offset, oct, len - 1)
  buf[offset + len - 1] = 0
}

// Build the 512-byte ustar header for one regular file.
const make_header = (path: string, size: number): Uint8Array => {
  const h = new Uint8Array(BLOCK)
  // ustar splits long names into name[100] + prefix[155]; keep paths short by
  // construction (static-site paths), and split if a path exceeds 100 bytes.
  let name = path
  let prefix = ''
  if (new TextEncoder().encode(path).length > 100) {
    const slash = path.lastIndexOf('/')
    if (slash > 0) {
      prefix = path.slice(0, slash)
      name = path.slice(slash + 1)
    }
  }
  write_str(h, 0, name, 100) // name
  write_octal(h, 100, 0o644, 8) // mode
  write_octal(h, 108, 0, 8) // uid
  write_octal(h, 116, 0, 8) // gid
  write_octal(h, 124, size, 12) // size
  write_octal(h, 136, Math.floor(Date.now() / 1000), 12) // mtime
  // checksum field (148, 8): filled with spaces while computing, then written.
  for (let i = 148; i < 156; i += 1) h[i] = 0x20
  h[156] = 0x30 // typeflag '0' = regular file
  write_str(h, 257, 'ustar', 6) // magic "ustar\0"
  write_str(h, 263, '00', 2) // version "00"
  write_str(h, 345, prefix, 155) // prefix

  // checksum = sum of all header bytes (with the checksum field as spaces).
  let sum = 0
  for (let i = 0; i < BLOCK; i += 1) sum += h[i]
  write_octal(h, 148, sum, 7) // 6 octal digits + NUL
  h[154] = 0x20 // trailing space per ustar convention
  return h
}

// Round a byte length up to the next 512-block boundary.
const pad_to_block = (n: number): number => Math.ceil(n / BLOCK) * BLOCK

// Pack the picked files into a single ustar TAR Blob. Empty `files` throws so
// the caller can show a clear "nothing to deploy" error instead of POSTing an
// empty bundle.
export const pack_tar = (files: PackFile[]): Blob => {
  if (files.length === 0) throw new Error('No files to pack')
  // Push the backing ArrayBuffers (each view owns its full, exact-length buffer)
  // so the BlobPart type is the unambiguous `ArrayBuffer` — sidesteps the strict
  // `Uint8Array<ArrayBufferLike>` vs `ArrayBufferView<ArrayBuffer>` mismatch.
  const parts: ArrayBuffer[] = []
  for (const f of files) {
    parts.push(buffer_of(make_header(f.path, f.bytes.length)))
    parts.push(buffer_of(f.bytes))
    const pad = pad_to_block(f.bytes.length) - f.bytes.length
    if (pad > 0) parts.push(new ArrayBuffer(pad))
  }
  // Two zero blocks mark end-of-archive.
  parts.push(new ArrayBuffer(BLOCK * 2))
  return new Blob(parts, { type: 'application/x-tar' })
}

// Extract the exact ArrayBuffer a Uint8Array view spans. A view from
// `new Uint8Array(n)` or `new Uint8Array(await blob.arrayBuffer())` owns its
// whole buffer, but a sliced/offset view might not — copy in that case so we
// never include stray neighbouring bytes.
const buffer_of = (u: Uint8Array): ArrayBuffer => {
  if (u.byteOffset === 0 && u.byteLength === u.buffer.byteLength) {
    return u.buffer as ArrayBuffer
  }
  return u.slice().buffer as ArrayBuffer
}

// Total uncompressed bytes across the picked files (the size we display + the
// size the backend will store on Walrus, modulo tar block padding).
export const total_bytes = (files: PackFile[]): number =>
  files.reduce((acc, f) => acc + f.bytes.length, 0)

// Normalize a webkitRelativePath / dropped-entry path to a POSIX-relative path:
// forward slashes, no leading slash, and STRIP the top-level folder segment so
// "dist/index.html" deploys as "index.html" (the site root is the picked dir).
export const normalize_entry_path = (raw: string): string => {
  const clean = raw.replace(/\\/g, '/').replace(/^\/+/, '')
  const slash = clean.indexOf('/')
  // Drop the single top wrapper dir (the chosen folder name) when present.
  return slash >= 0 ? clean.slice(slash + 1) : clean
}

// Read a list of browser File objects (each carrying a relative path) into
// PackFiles. `path_of` extracts the relative path from a File (webkitRelativePath
// for <input webkitdirectory>, or a precomputed map for drag-dropped entries).
export const files_to_pack = async (
  files: { file: File; path: string }[],
): Promise<PackFile[]> => {
  const out: PackFile[] = []
  for (const { file, path } of files) {
    const norm = normalize_entry_path(path || file.name)
    if (!norm) continue // skip the bare folder entry
    const buf = new Uint8Array(await file.arrayBuffer())
    out.push({ path: norm, bytes: buf })
  }
  return out
}
