// Shared HTTP helpers. Both the sponsor and api modules used identical CORS +
// JSON + client-IP logic; it's collapsed here so there is ONE CORS policy for
// the whole backend, driven by config.allowedOrigins.
import type { Server } from "bun";
import { config } from "./config";

export const corsHeaders = (origin: string | null): Record<string, string> => {
  const base: Record<string, string> = {
    "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
    // `mcp-session-id`, `mcp-protocol-version` + `authorization` are added for the
    // MCP Streamable-HTTP transport (an MCP client sends these on /mcp); the rest
    // of the backend ignores them. `mcp-session-id` is also EXPOSED below so a
    // browser-side MCP client can read a server-assigned session id.
    "Access-Control-Allow-Headers": "Content-Type, mcp-session-id, mcp-protocol-version, authorization",
    "Access-Control-Expose-Headers": "mcp-session-id",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
  if (origin && config.allowedOrigins.includes(origin)) {
    base["Access-Control-Allow-Origin"] = origin;
  }
  return base;
};

export const json = (
  body: unknown,
  status: number,
  origin: string | null,
  extra: Record<string, string> = {},
): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(origin), ...extra },
  });

export const text = (
  body: string,
  status: number,
  origin: string | null,
): Response =>
  new Response(body, {
    status,
    headers: { "Content-Type": "text/plain", ...corsHeaders(origin) },
  });

// Client IP for rate-limiting. We are fronted by the TRUSTED Cloudflare tunnel,
// which sets `cf-connecting-ip` to the real client IP. We trust ONLY that header.
// We NEVER trust client-supplied `x-forwarded-for` — an attacker can set it to any
// value to rotate "identities" and dodge the per-IP limiter. If the trusted header
// is absent (direct hit / misconfig), we fall back to the raw socket peer address
// via `server.requestIP(req)`. When even that is unavailable the caller MUST treat
// a null IP as untrusted and FAIL CLOSED (deny), never allow — see takeToken.
export const getIp = (req: Request, server?: Server<unknown>): string | null => {
  const cf = req.headers.get("cf-connecting-ip");
  if (cf) return cf.trim();
  // No trusted CF header — fall back to the real socket peer (never client XFF).
  try {
    const addr = server?.requestIP(req);
    if (addr?.address) return addr.address;
  } catch {
    // requestIP can throw for an already-consumed/edge request — fall through.
  }
  return null;
};
