// Shared HTTP helpers. Both the sponsor and api modules used identical CORS +
// JSON + client-IP logic; it's collapsed here so there is ONE CORS policy for
// the whole backend, driven by config.allowedOrigins.
import { config } from "./config";

export const corsHeaders = (origin: string | null): Record<string, string> => {
  const base: Record<string, string> = {
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
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

export const getIp = (req: Request): string | null => {
  const cf = req.headers.get("cf-connecting-ip");
  if (cf) return cf;
  const xff = req.headers.get("x-forwarded-for");
  return xff ? xff.split(",")[0]!.trim() : null;
};
