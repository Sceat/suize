/**
 * GET /unfurl?url=<website> — server-side OpenGraph/meta unfurl for the Business
 * Profile form. A merchant pastes their site; the browser can't read its <head>
 * (CORS), so the backend fetches it and returns { title, description, image } from
 * the page's og:* / <meta name=description> / <title>. Read-only; stores nothing.
 *
 * SSRF-GUARDED (this endpoint fetches a USER-SUPPLIED URL on the server):
 *   - http(s) only;
 *   - every DNS-resolved IP must be PUBLIC — private / loopback / link-local / CGNAT /
 *     cloud-metadata (169.254.169.254) ranges are rejected, for the literal-IP host AND
 *     for every redirect hop (redirects are followed MANUALLY and re-validated);
 *   - a hard request timeout + a response-size cap + a redirect-depth cap;
 *   - only text/html bodies are parsed; per-IP + global daily rate limits.
 * Residual TOCTOU (DNS may re-resolve between check and fetch) is accepted: the
 * payload is only meta-tag strings, and the common SSRF targets are IP-blocked.
 */
import type { Server } from "bun";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { getIp, json } from "../http";
import { createDailyCeiling } from "../quota";

const TIMEOUT_MS = 6_000;
const MAX_BYTES = 512 * 1024;
const MAX_REDIRECTS = 4;
const HEAD_SCAN = 200_000; // meta tags live in <head>

// generous global cap; modest per-IP (each call hits the public internet for a user).
const limiter = createDailyCeiling({ globalMax: 5_000, perKeyMax: 150 });

export function handleUnfurlRoute(
  req: Request,
  url: URL,
  origin: string | null,
  server?: Server<unknown>,
): Response | Promise<Response> | null {
  if (req.method !== "GET" || url.pathname !== "/unfurl") return null;
  return route(req, url, origin, server);
}

async function route(
  req: Request,
  url: URL,
  origin: string | null,
  server?: Server<unknown>,
): Promise<Response> {
  const ip = getIp(req, server);
  if (!ip) return json({ error: "no client ip" }, 400, origin); // fail closed
  if (!limiter.consume(ip).ok) return json({ error: "rate limited" }, 429, origin);

  const target = (url.searchParams.get("url") ?? "").trim();
  let parsed: URL;
  try {
    parsed = new URL(target);
  } catch {
    return json({ error: "bad url" }, 400, origin);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return json({ error: "url must be http(s)" }, 400, origin);
  }

  try {
    const html = await safeFetchHtml(parsed, 0);
    if (html == null) return json({ title: "", description: "", image: "" }, 200, origin);
    return json(parseMeta(html, parsed), 200, origin);
  } catch (e) {
    return json({ error: (e as Error).message || "unfurl failed" }, 502, origin);
  }
}

/** Fetch HTML with SSRF guards: validate host IPs are public, follow redirects
 *  manually (re-validating each hop), enforce timeout + size cap, parse only HTML. */
async function safeFetchHtml(target: URL, depth: number): Promise<string | null> {
  if (depth > MAX_REDIRECTS) throw new Error("too many redirects");
  await assertPublicHost(target.hostname);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(target.toString(), {
      method: "GET",
      redirect: "manual",
      signal: ctrl.signal,
      headers: {
        "User-Agent": "SuizeBot/1.0 (+https://suize.io)",
        Accept: "text/html,application/xhtml+xml",
      },
    });

    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) return null;
      const next = new URL(loc, target);
      if (next.protocol !== "http:" && next.protocol !== "https:") throw new Error("bad redirect scheme");
      return safeFetchHtml(next, depth + 1);
    }
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.includes("text/html") && !ct.includes("application/xhtml")) return null;
    return await readCapped(res, MAX_BYTES);
  } finally {
    clearTimeout(timer);
  }
}

async function readCapped(res: Response, max: number): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return await res.text();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value && value.length) {
      chunks.push(value);
      total += value.length;
      if (total >= max) {
        await reader.cancel().catch(() => {});
        break;
      }
    }
  }
  const out = new Uint8Array(Math.min(total, max));
  let off = 0;
  for (const c of chunks) {
    if (off >= out.length) break;
    const slice = c.subarray(0, out.length - off);
    out.set(slice, off);
    off += slice.length;
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(out);
}

/** Reject any hostname whose resolved address(es) include a non-public IP. */
async function assertPublicHost(hostname: string): Promise<void> {
  const lit = isIP(hostname);
  const addrs = lit
    ? [{ address: hostname }]
    : await lookup(hostname, { all: true }).catch(() => []);
  if (addrs.length === 0) throw new Error("dns: no address");
  for (const a of addrs) {
    if (!isPublicIp(a.address)) throw new Error("blocked: non-public address");
  }
}

function isPublicIp(ip: string): boolean {
  const fam = isIP(ip);
  if (fam === 4) return isPublicV4(ip);
  if (fam === 6) return isPublicV6(ip);
  return false;
}

function isPublicV4(ip: string): boolean {
  const p = ip.split(".").map((n) => Number(n));
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a, b, c] = p;
  if (a === 0 || a === 10 || a === 127) return false; // this-net · private · loopback
  if (a === 169 && b === 254) return false; // link-local + cloud metadata (169.254.169.254)
  if (a === 172 && b >= 16 && b <= 31) return false; // private
  if (a === 192 && b === 168) return false; // private
  if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT
  if (a === 192 && b === 0 && c === 0) return false; // IETF protocol assignments
  if (a >= 224) return false; // multicast + reserved + broadcast
  return true;
}

function isPublicV6(ip: string): boolean {
  const x = ip.toLowerCase().split("%")[0]; // strip any zone id
  if (x === "::1" || x === "::") return false; // loopback · unspecified
  if (/^fe[89ab]/.test(x)) return false; // link-local fe80::/10
  if (/^f[cd]/.test(x)) return false; // unique-local fc00::/7
  const mapped = x.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/); // IPv4-mapped
  if (mapped) return isPublicV4(mapped[1]);
  return true;
}

/** Pull og:* / name=description / <title>, resolving a relative og:image. */
function parseMeta(html: string, base: URL): { title: string; description: string; image: string } {
  const head = html.slice(0, HEAD_SCAN);
  const pick = (prop: string): string => {
    const tag = head.match(
      new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]*>`, "i"),
    )?.[0];
    if (!tag) return "";
    return decodeEntities(tag.match(/content=["']([^"']*)["']/i)?.[1] ?? "").trim();
  };
  const title = pick("og:title") || decodeEntities(head.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] ?? "").trim();
  const description = pick("og:description") || pick("description") || pick("twitter:description");
  let image = pick("og:image") || pick("twitter:image");
  if (image) {
    try {
      image = new URL(image, base).toString();
    } catch {
      /* leave a malformed image url as-is — the client validates on load */
    }
  }
  return {
    title: title.slice(0, 300),
    // byte-capped under the on-chain MAX_DESC_LEN (512) so the mint never aborts.
    description: capBytes(description, 480),
    image: image.slice(0, 600),
  };
}

/** Trim a string to at most `maxBytes` UTF-8 bytes without splitting a codepoint. */
function capBytes(s: string, maxBytes: number): string {
  const enc = new TextEncoder();
  if (enc.encode(s).length <= maxBytes) return s;
  let lo = 0;
  let hi = s.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (enc.encode(s.slice(0, mid)).length <= maxBytes) lo = mid;
    else hi = mid - 1;
  }
  return s.slice(0, lo).trimEnd();
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, d) => {
      try {
        return String.fromCodePoint(Number(d));
      } catch {
        return "";
      }
    });
}
