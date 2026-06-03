// @suize/backend — single unified backend.
//
// Mounts every module on ONE Bun server / ONE port:
//   - sponsor : POST /sponsor, POST /execute   (Enoki sponsored tx; both apps)
//   - api     : POST /waitlist                  (waitlist / Turnstile)
//   - handle  : WS-ONLY (self-custody SuiNS handle issuance). The public HTTP
//               /handle/* routes were unauthenticated (body-trusted `address`)
//               and are NO LONGER mounted; handle ops run over the authenticated
//               WebSocket (ws/index.ts) where ws.data.address is the verified
//               subject. The module is still imported for readiness/info only.
//   - agent   : (stub, not wired yet)           (wallet AI brain — see src/agent)
//   - shared  : GET /health, GET /ready
//
// All config comes from env via ./config (see .env.example). Secrets are env
// vars only — nothing hardcoded.
import type { Server } from "bun";
import { config } from "./config";
import { corsHeaders, json, text } from "./http";
import { handleSponsorRoute, sponsorReady, sponsorInfo, maskKey } from "./sponsor";
import { handleApiRoute, apiReady, maskRedisUrl } from "./api";
import { handleReady, handleInfo } from "./handle";
import { tryUpgrade, websocketHandler, type WsData } from "./ws";

// Fail fast on missing secrets — same guards the standalone services had.
if (!config.enokiPrivateApiKey) {
  console.error("FATAL: ENOKI_PRIVATE_API_KEY env var is required (sponsor module)");
  process.exit(1);
}
if (!config.turnstileSecret) {
  console.error("FATAL: TURNSTILE_SECRET env var is required (api/waitlist module)");
  process.exit(1);
}
if (config.allowedOrigins.length === 0) {
  console.warn("[backend] WARNING: ALLOWED_ORIGINS is empty — all browser origins will be rejected");
}

// Readiness is reported PER COMPONENT so one dependency's outage doesn't gate the
// other: a Redis outage must not 503 the sponsor, and a Sui-RPC outage must not
// 503 the waitlist. `/ready` returns both statuses (200 only when both are up,
// for an overall probe); `/ready/sponsor` and `/ready/api` each gate ONLY their
// own component so probes/orchestration can target them independently.
// The handle module is OPTIONAL: when its SuiNS secrets are unset it reports
// `false` and is simply omitted from the overall /ready gate (its absence must
// not 503 the sponsor/waitlist). When configured, `/ready/handle` gates it.
const readiness = async (): Promise<{ sponsor: boolean; api: boolean; handle: boolean }> => {
  const [sponsor, api, handle] = await Promise.all([sponsorReady(), apiReady(), handleReady()]);
  return { sponsor, api, handle };
};

Bun.serve({
  port: config.port,
  fetch: async (req, server: Server<WsData>) => {
    const url = new URL(req.url);
    const origin = req.headers.get("origin");

    // ── WebSocket upgrade — the single Enoki-verified socket. Handled FIRST and
    // ALONGSIDE the HTTP routes below (crash + landing keep using /sponsor,
    // /execute, /waitlist over HTTP; handle ops are WS-only). A successful
    // upgrade returns undefined
    // (Bun owns the 101); a bad address returns a 4xx. No CORS preflight: the
    // browser WebSocket handshake is not subject to CORS.
    if (req.method === "GET" && url.pathname === "/ws") {
      return tryUpgrade(req, url, server);
    }

    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }
    if (req.method === "GET" && url.pathname === "/health") {
      return text("ok", 200, origin);
    }
    if (req.method === "GET" && url.pathname === "/ready") {
      // Per-component readiness; the body always reports each status so callers
      // see WHICH dep is down. The handle module only gates the overall 200 when
      // it is CONFIGURED — an unconfigured handle module must not 503 the rest.
      const r = await readiness();
      const handleOk = handleInfo.enabled ? r.handle : true;
      const status = r.sponsor && r.api && handleOk ? 200 : 503;
      return json(r, status, origin);
    }
    if (req.method === "GET" && url.pathname === "/ready/sponsor") {
      // Gates ONLY the sponsor (Sui RPC). Unaffected by a Redis outage.
      const ok = await sponsorReady();
      return json({ sponsor: ok }, ok ? 200 : 503, origin);
    }
    if (req.method === "GET" && url.pathname === "/ready/api") {
      // Gates ONLY the api/waitlist (Redis). Unaffected by a Sui-RPC outage.
      const ok = await apiReady();
      return json({ api: ok }, ok ? 200 : 503, origin);
    }
    if (req.method === "GET" && url.pathname === "/ready/handle") {
      // Gates ONLY the handle module (Redis + SuiNS config). 503 when unconfigured.
      const ok = await handleReady();
      return json({ handle: ok }, ok ? 200 : 503, origin);
    }

    // Try each module's route matcher; first non-null wins.
    const sponsored = handleSponsorRoute(req, url, origin);
    if (sponsored) return sponsored;

    const apiRouted = handleApiRoute(req, url, origin);
    if (apiRouted) return apiRouted;

    // NOTE: the HTTP /handle/* routes are intentionally NOT mounted. They were
    // fully unauthenticated (POST /handle/claim trusted a body `address` with no
    // proof of control → squat/grief; GET /handle/me enumerated ownership). The
    // wallet is now pure-WS, so handle ops are served ONLY over the authenticated
    // socket (ws/index.ts), where ws.data.address is the verified subject. The
    // handle MODULE stays imported for handleReady / handleInfo (the /ready probe
    // + startup log) and handleEnabled (consumed by the WS route) — only the
    // public HTTP surface is removed.

    return json({ error: "not found" }, 404, origin);
  },

  // The single WebSocket transport (auth at upgrade → ws.data session → RPC +
  // pushes). See src/ws/index.ts. Defined on the SAME server/port as the HTTP.
  websocket: websocketHandler,
});

console.log(`[backend] listening on :${config.port}`);
console.log(`[backend] sui rpc: ${config.suiRpcUrl}`);
console.log(`[backend] enoki key: ${maskKey(config.enokiPrivateApiKey)}`);
console.log(`[backend] redis: ${maskRedisUrl(config.redisUrl)}`);
console.log(
  `[backend] sponsor move targets: ${sponsorInfo.allowedMoveTargetCount} ` +
    `(crash=${sponsorInfo.crashTargetCount}, wallet=${sponsorInfo.walletTargetCount})`,
);
console.log(`[backend] allowed origins: ${config.allowedOrigins.join(", ") || "(none)"}`);
console.log(
  `[backend] handle issuance: ${handleInfo.enabled
    ? `enabled (parent=${handleInfo.parentDomain}) — WS-only`
    : "DISABLED (SuiNS not configured)"}`,
);
console.log(
  `[backend] routes: GET /ws (websocket — incl. handle ops), POST /sponsor, ` +
    `POST /execute, POST /waitlist, ` +
    `GET /health, GET /ready, GET /ready/sponsor, GET /ready/api, GET /ready/handle`,
);
