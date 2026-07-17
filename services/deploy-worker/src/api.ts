// The charge API — served on API_HOST (api.suize.site; deploy.suize.io is an
// optional future alias, see wrangler.toml) plus the base-domain apex paths,
// while every other host stays the site-serving face. Four doors, all x402-priced
// except unlink:
//
//   POST   /deploy            multipart {name, site.tar} + ?months=&sealed=  → 402 → site
//   POST   /extend            {site, months} (query or JSON)                 → 402 → more time
//   POST   /domains[?verify=1] {siteId, domain}                              → challenge / 402 → link
//   POST   /domains/repoint   {domain, newSiteId, ts, signature}            → owner-signed move (free)
//   DELETE /domains/<domain>  {ts, signature}                                → owner-signed unlink
//   GET    /health            liveness + config state

import { network, chargeConfigured, type Env } from "./env";
import { json, preflight } from "./http";
import { handleDeploy } from "./publish";
import { handleExtend } from "./extend";
import { handleDomains, handleUnlink, handleRepoint } from "./domains";
import { handleDnsAssist } from "./dns-assist";
import { handlePreview } from "./preview";

/** True when this hostname is the charge API (localhost always is, for dev). */
export const isApiHost = (hostname: string, env: Env): boolean => {
  const h = hostname.toLowerCase();
  if (h === "localhost" || h === "127.0.0.1") return true;
  const api = (env.API_HOST ?? "").toLowerCase();
  return Boolean(api) && h === api;
};

/** API paths also answer on the BASE-DOMAIN APEX (a dead 404 surface otherwise) —
 * one memorable door (`suize.site/deploy`) beside the dedicated API host. Site
 * subdomains are NEVER matched here, so site files can't be shadowed. */
export const isApiPath = (pathname: string): boolean =>
  pathname === "/health" ||
  pathname === "/preview" ||
  pathname === "/deploy" ||
  pathname === "/extend" ||
  pathname === "/domains" ||
  pathname.startsWith("/domains/");

export const handleApi = async (req: Request, env: Env): Promise<Response> => {
  if (req.method === "OPTIONS") return preflight();
  const url = new URL(req.url);
  const path = url.pathname;

  if (req.method === "GET" && path === "/health") {
    return json({ ok: true, network: network(env), charge: chargeConfigured(env) });
  }
  if (req.method === "GET" && path === "/preview") return handlePreview(req, env);
  if (req.method === "POST" && path === "/deploy") return handleDeploy(req, env);
  if (req.method === "POST" && path === "/extend") return handleExtend(req, env);
  if (req.method === "POST" && path === "/domains/assist") return handleDnsAssist(req, env);
  if (req.method === "POST" && path === "/domains/repoint") return handleRepoint(req, env);
  if (req.method === "POST" && path === "/domains") return handleDomains(req, env);
  if (req.method === "DELETE" && path.startsWith("/domains/")) {
    const d = decodeURIComponent(path.slice("/domains/".length));
    if (d) return handleUnlink(req, env, d);
  }

  return json(
    {
      error:
        "not found — POST /deploy, POST /extend, POST /domains (?verify=1), POST /domains/repoint, DELETE /domains/<domain>, GET /preview?site=<0x…>, GET /health",
    },
    404,
  );
};
