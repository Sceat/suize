// HTTP helpers for the Worker: JSON + CORS, the client IP, and a BEST-EFFORT
// per-isolate rate guard.
//
// This is a public, credential-free API (merchants call /verify + /settle server-side;
// no cookies, no auth) so CORS is fully open — there is nothing to protect with an
// origin allow-list. Real rate limiting is the operator's job at the edge: attach a
// Cloudflare WAF / rate-limiting rule (see README). The in-code guard below is only a
// cheap per-isolate backstop — an isolate is one of many and is recycled, so it is NOT
// a real limiter and must never be relied on as one.

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

/** A JSON Response with open CORS. */
export const json = (
  body: unknown,
  status = 200,
  extra: Record<string, string> = {},
): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS, ...extra },
  });

/** The CORS preflight response. */
export const preflight = (): Response => new Response(null, { status: 204, headers: CORS });

/** The real client IP — Cloudflare sets `cf-connecting-ip` at the edge (always present
 * in production). Null locally / off-Cloudflare. We never trust client `x-forwarded-for`. */
export const getIp = (req: Request): string | null =>
  req.headers.get("cf-connecting-ip")?.trim() ?? null;

// ── best-effort per-isolate guard (NOT a real rate limiter — see the file header) ──
const WINDOW_MS = 10_000;
const MAX_PER_WINDOW = 120; // generous — the edge WAF is the real control
const HITS = new Map<string, { n: number; win: number }>();

/** Cheap fixed-window check. Fails OPEN on a null IP (best-effort; production always has
 * cf-connecting-ip, and a local dev hit should never be blocked). */
export const rateOk = (ip: string | null): boolean => {
  if (!ip) return true;
  const now = Date.now();
  const e = HITS.get(ip);
  if (!e || now - e.win > WINDOW_MS) {
    HITS.set(ip, { n: 1, win: now });
    if (HITS.size > 5_000) for (const [k, v] of HITS) if (now - v.win > WINDOW_MS) HITS.delete(k);
    return true;
  }
  e.n += 1;
  return e.n <= MAX_PER_WINDOW;
};
