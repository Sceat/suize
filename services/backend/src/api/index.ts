// API module — waitlist / Turnstile endpoint (the live api.suize.io logic).
// Folded from the standalone `suize-api` service. Exposes:
//   POST /waitlist ({ email, intent?, source?, turnstileToken } -> { ok, alreadyOnList })
// plus a readiness probe (`apiReady`) used by the shared /ready endpoint.
// CORS / json / client-IP now come from the shared ../http layer.
import Redis from "ioredis";
import { config } from "../config";
import { json, getIp } from "../http";

const TURNSTILE_SECRET = config.turnstileSecret;

export const maskRedisUrl = (url: string) => url.replace(/(:\/\/[^:]*:)[^@]+(@)/, "$1***$2");

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_SEC = 60;

const redis = new Redis(config.redisUrl, { lazyConnect: false, maxRetriesPerRequest: 3 });
redis.on("error", (err) => console.error("[redis]", err.message));
redis.on("connect", () => console.log("[redis] connected"));

const verifyTurnstile = async (token: string, ip: string | null): Promise<boolean> => {
  const form = new FormData();
  form.append("secret", TURNSTILE_SECRET!);
  form.append("response", token);
  if (ip) form.append("remoteip", ip);
  const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST", body: form,
  });
  const data = (await res.json()) as { success?: boolean };
  return data.success === true;
};

const rateLimit = async (ip: string | null): Promise<{ ok: boolean; retryAfter: number }> => {
  if (!ip) return { ok: true, retryAfter: 0 };
  const key = `rl:waitlist:${ip}`;
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, RATE_LIMIT_WINDOW_SEC);
  if (count > RATE_LIMIT_MAX) {
    const ttl = await redis.ttl(key);
    return { ok: false, retryAfter: ttl > 0 ? ttl : RATE_LIMIT_WINDOW_SEC };
  }
  return { ok: true, retryAfter: 0 };
};

export const apiReady = async (): Promise<boolean> => {
  try {
    const result = await Promise.race([
      redis.ping(),
      new Promise<string>((_, reject) => setTimeout(() => reject(new Error("ping timeout")), 1000)),
    ]);
    return result === "PONG";
  } catch {
    return false;
  }
};

const handleWaitlist = async (req: Request, origin: string | null): Promise<Response> => {
  let body: any;
  try { body = await req.json(); } catch { return json({ error: "invalid json" }, 400, origin); }

  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const intent = typeof body?.intent === "string" ? body.intent.slice(0, 500) : "";
  const source = typeof body?.source === "string" ? body.source.slice(0, 100) : "";
  const turnstileToken = typeof body?.turnstileToken === "string" ? body.turnstileToken : "";

  if (!email || email.length > 320 || !EMAIL_RE.test(email)) {
    return json({ error: "invalid email" }, 400, origin);
  }
  if (!turnstileToken) return json({ error: "missing turnstile token" }, 400, origin);

  const ip = getIp(req);

  const rl = await rateLimit(ip);
  if (!rl.ok) return json({ error: "too many requests" }, 429, origin, { "Retry-After": String(rl.retryAfter) });

  let ok: boolean;
  try {
    ok = await verifyTurnstile(turnstileToken, ip);
  } catch (err) {
    console.error("[turnstile]", (err as Error).message);
    return json({ error: "captcha service unreachable" }, 503, origin);
  }
  if (!ok) return json({ error: "captcha failed" }, 403, origin);

  const ts = Date.now();
  const payload = JSON.stringify({
    intent, source, ip, ua: (req.headers.get("user-agent") ?? "").slice(0, 400), ts,
  });

  let alreadyOnList = false;
  try {
    // SET NX returns null when the key already exists — preserves the original signup record.
    const setResult = await redis.set(`waitlist:${email}`, payload, "NX");
    if (setResult === null) {
      alreadyOnList = true;
    } else {
      const zResult = await redis.zadd("waitlist:_index", ts, email);
      if (zResult === null) throw new Error("zadd returned null");
    }
  } catch (err) {
    console.error("[redis-set]", (err as Error).message);
    return json({ error: "storage unavailable" }, 503, origin);
  }

  return json({ ok: true, alreadyOnList }, 200, origin);
};

/**
 * Route matcher for the api module. Returns a Response for POST /waitlist, or
 * null if the path/method is not ours.
 */
export const handleApiRoute = (
  req: Request,
  url: URL,
  origin: string | null,
): Promise<Response> | null => {
  if (req.method === "POST" && url.pathname === "/waitlist") return handleWaitlist(req, origin);
  return null;
};
