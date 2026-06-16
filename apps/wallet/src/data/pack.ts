// Client-side TAR packing — turn in-memory files into the single `site.tar` the
// deploy backend's POST /deploy expects. A pure, dependency-free ustar writer
// (copied verbatim from apps/deploy/src/pack.ts — the agent only ever packs one
// in-memory index.html, so this is the minimal subset: pack_tar + its helpers).
// Standard POSIX ustar 512-byte records; `tar -xf` and the backend reader unpack
// them faithfully.

/** A file to pack, with its POSIX-relative path (e.g. "index.html"). */
export type PackFile = {
  path: string;
  bytes: Uint8Array;
};

const BLOCK = 512;

const write_str = (buf: Uint8Array, offset: number, str: string, len: number): void => {
  const bytes = new TextEncoder().encode(str);
  for (let i = 0; i < len; i += 1) buf[offset + i] = i < bytes.length ? bytes[i]! : 0;
};

const write_octal = (buf: Uint8Array, offset: number, value: number, len: number): void => {
  const oct = value.toString(8).padStart(len - 1, '0');
  write_str(buf, offset, oct, len - 1);
  buf[offset + len - 1] = 0;
};

const make_header = (path: string, size: number): Uint8Array => {
  const h = new Uint8Array(BLOCK);
  let name = path;
  let prefix = '';
  if (new TextEncoder().encode(path).length > 100) {
    const slash = path.lastIndexOf('/');
    if (slash > 0) {
      prefix = path.slice(0, slash);
      name = path.slice(slash + 1);
    }
  }
  write_str(h, 0, name, 100);
  write_octal(h, 100, 0o644, 8);
  write_octal(h, 108, 0, 8);
  write_octal(h, 116, 0, 8);
  write_octal(h, 124, size, 12);
  write_octal(h, 136, Math.floor(Date.now() / 1000), 12);
  for (let i = 148; i < 156; i += 1) h[i] = 0x20;
  h[156] = 0x30; // typeflag '0' = regular file
  write_str(h, 257, 'ustar', 6);
  write_str(h, 263, '00', 2);
  write_str(h, 345, prefix, 155);
  let sum = 0;
  for (let i = 0; i < BLOCK; i += 1) sum += h[i]!;
  write_octal(h, 148, sum, 7);
  h[154] = 0x20;
  return h;
};

const pad_to_block = (n: number): number => Math.ceil(n / BLOCK) * BLOCK;

const buffer_of = (u: Uint8Array): ArrayBuffer => {
  if (u.byteOffset === 0 && u.byteLength === u.buffer.byteLength) return u.buffer as ArrayBuffer;
  return u.slice().buffer as ArrayBuffer;
};

/** Pack files into a single ustar TAR Blob. Throws on empty input. */
export const pack_tar = (files: PackFile[]): Blob => {
  if (files.length === 0) throw new Error('No files to pack');
  const parts: ArrayBuffer[] = [];
  for (const f of files) {
    parts.push(buffer_of(make_header(f.path, f.bytes.length)));
    parts.push(buffer_of(f.bytes));
    const pad = pad_to_block(f.bytes.length) - f.bytes.length;
    if (pad > 0) parts.push(new ArrayBuffer(pad));
  }
  parts.push(new ArrayBuffer(BLOCK * 2)); // end-of-archive
  return new Blob(parts, { type: 'application/x-tar' });
};
