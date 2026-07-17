// Content-type detection by file extension — the manifest records a `ct` per
// file so the serving face can stream the right `Content-Type` without a
// per-request sniff. Unknown extensions fall back to `application/octet-stream`.
// (Ported verbatim from the retired backend's deploy/content-type.ts.)

const BY_EXT: Record<string, string> = {
  html: "text/html",
  htm: "text/html",
  css: "text/css",
  js: "text/javascript",
  mjs: "text/javascript",
  cjs: "text/javascript",
  json: "application/json",
  map: "application/json",
  xml: "application/xml",
  txt: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
  wasm: "application/wasm",
  // images
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  svg: "image/svg+xml",
  ico: "image/x-icon",
  webp: "image/webp",
  avif: "image/avif",
  bmp: "image/bmp",
  // fonts
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  otf: "font/otf",
  eot: "application/vnd.ms-fontobject",
  // media
  mp4: "video/mp4",
  webm: "video/webm",
  mp3: "audio/mpeg",
  ogg: "audio/ogg",
  wav: "audio/wav",
  // misc web
  pdf: "application/pdf",
  webmanifest: "application/manifest+json",
};

/** Media type for a path, by extension. Falls back to application/octet-stream. */
export const contentTypeFor = (path: string): string => {
  const dot = path.lastIndexOf(".");
  if (dot < 0) return "application/octet-stream";
  const ext = path.slice(dot + 1).toLowerCase();
  return BY_EXT[ext] ?? "application/octet-stream";
};
