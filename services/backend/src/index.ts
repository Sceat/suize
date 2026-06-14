// @suize/backend — single unified backend.
//
// Mounts every module on ONE Bun server / ONE port:
//   - sponsor : WS-ONLY (Enoki sponsored tx; both apps). The public HTTP POST
//               /sponsor + POST /execute routes have been REMOVED — sponsorship
//               runs ONLY over the authenticated WebSocket (ws/index.ts), where
//               `sender` is pinned to the verified ws.data.address (never a
//               body-supplied field). The module is still imported for the core
//               (createSponsor/executeSponsor over WS) + readiness/info.
//   - handle  : WS-ONLY (self-custody SuiNS handle issuance, FULLY ON-CHAIN — no
//               Redis). The public HTTP /handle/* routes were unauthenticated
//               (body-trusted `address`) and are NO LONGER mounted; handle ops
//               run over the authenticated WebSocket (ws/index.ts) where
//               ws.data.address is the verified subject. The module is still
//               imported for readiness/info only.
//   - agent   : (stub, not wired yet)           (wallet AI brain — see src/agent)
//   - shared  : GET /health, GET /ready
//
// The waitlist (api) module + its Redis dependency have been REMOVED entirely
// (handles are now on-chain; the landing waitlist moves to its own surface). All
// config comes from env via ./config (see .env.example). Secrets are env vars
// only — nothing hardcoded.
import type { Server } from "bun";
import { config } from "./config";
import { corsHeaders, json, text } from "./http";
import { sponsorReady, sponsorInfo, maskKey } from "./sponsor";
import { handleReady, handleInfo } from "./handle";
import { handleDeployRoute, deployReady, deployInfo } from "./deploy";
import { startStorageCron, storageInfo } from "./deploy/extend";
import { subscribeInfo } from "./deploy/subscribe";
import { handleMcpRoute, mcpInfo } from "./mcp";
import { brainInfo } from "./brain";
import { handleFacilitatorRoute, facilitatorInfo, treasuryReady } from "./facilitator";
import { tryUpgrade, websocketHandler, wsConnectionCount, type WsData } from "./ws";

// Fail fast on missing secrets — same guard the standalone sponsor had.
if (!config.enokiPrivateApiKey) {
  console.error("FATAL: ENOKI_PRIVATE_API_KEY env var is required (sponsor module)");
  process.exit(1);
}
if (config.allowedOrigins.length === 0) {
  console.warn("[backend] WARNING: ALLOWED_ORIGINS is empty — all browser origins will be rejected");
}

// Readiness is reported PER COMPONENT so one dependency's outage doesn't gate the
// other: a Sui-RPC outage must not 503 an unrelated surface. `/ready` returns
// each status (200 only when all up, for an overall probe); `/ready/sponsor` and
// `/ready/handle` each gate ONLY their own component so probes/orchestration can
// target them independently. The handle module is OPTIONAL: when its SuiNS
// secrets are unset it reports `false` and is simply omitted from the overall
// /ready gate (its absence must not 503 the sponsor). When configured,
// `/ready/handle` gates it. NOTHING here touches Redis anymore.
const readiness = async (): Promise<{ sponsor: boolean; handle: boolean; deploy: boolean }> => {
  const [sponsor, handle, deploy] = await Promise.all([sponsorReady(), handleReady(), deployReady()]);
  return { sponsor, handle, deploy };
};

Bun.serve({
  port: config.port,
  // A deploy is a long synchronous surface — two Walrus publisher PUTs (quilt +
  // manifest, ~16s) plus the on-chain Site mint (~4s), ~20s total with no bytes
  // flowing to the client. Bun's default 10s idleTimeout would close that idle
  // connection mid-deploy (the tunnel then 502s). 200s headroom (max 255); the WS
  // keeps itself alive via its own 30s server ping, fast HTTP surfaces are unaffected.
  idleTimeout: 200,
  fetch: async (req, server: Server<WsData>) => {
    const url = new URL(req.url);
    const origin = req.headers.get("origin");

    // ── WebSocket upgrade — the single Enoki-verified socket. Handled FIRST.
    // Sponsorship (sponsor/execute) AND handle ops are now WS-ONLY: both the
    // wallet and crash route them over this authenticated socket, so the only
    // remaining HTTP surfaces below are readiness probes + the deploy module. A
    // successful upgrade returns undefined (Bun owns the 101); a bad address
    // returns a 4xx. No CORS preflight: the browser WebSocket handshake is not
    // subject to CORS.
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
      // The deploy module is OPTIONAL too: when DEPLOY_WALLET_PRIVATE_KEY is unset
      // it reports false and must NOT 503 the rest of the backend. It only gates
      // the overall 200 when configured.
      const deployOk = deployInfo.enabled ? r.deploy : true;
      const status = r.sponsor && handleOk && deployOk ? 200 : 503;
      return json(r, status, origin);
    }
    if (req.method === "GET" && url.pathname === "/ready/sponsor") {
      // Gates ONLY the sponsor (Sui RPC).
      const ok = await sponsorReady();
      return json({ sponsor: ok }, ok ? 200 : 503, origin);
    }
    if (req.method === "GET" && url.pathname === "/ready/handle") {
      // Gates ONLY the handle module (SuiNS config + RPC reachability). 503 when
      // unconfigured. No Redis dependency anymore.
      const ok = await handleReady();
      return json({ handle: ok }, ok ? 200 : 503, origin);
    }
    if (req.method === "GET" && url.pathname === "/ready/deploy") {
      // Gates ONLY the deploy module (deploy wallet configured + Sui RPC reachable).
      // 503 when DEPLOY_WALLET_PRIVATE_KEY is unset.
      const ok = await deployReady();
      return json({ deploy: ok }, ok ? 200 : 503, origin);
    }
    if (req.method === "GET" && url.pathname === "/ready/ws") {
      // Gates ONLY the WebSocket transport. wsConnectionCount() being callable
      // proves the ws module imported AND websocketHandler is wired into this
      // server (a broken /ws layer can't satisfy this). No Redis/SuiNS dep — this
      // is a pure liveness check of the socket plumbing, never the count value.
      let wsOk: boolean;
      try {
        wsOk = typeof wsConnectionCount() === "number";
      } catch {
        wsOk = false;
      }
      return json({ ws: wsOk }, wsOk ? 200 : 503, origin);
    }
    if (req.method === "GET" && url.pathname === "/ready/serve") {
      // SERVING readiness — the gate the k8s readinessProbe targets. 200 only when
      // the request-serving surfaces are up: sponsor (Sui RPC) AND the WS transport.
      // CRUCIALLY excludes suins/handle so a SuiNS blip can NOT pull /sponsor + /ws
      // out of rotation. Reuses sponsorReady().
      const sponsor = await sponsorReady();
      let ws: boolean;
      try {
        ws = typeof wsConnectionCount() === "number";
      } catch {
        ws = false;
      }
      const status = sponsor && ws ? 200 : 503;
      return json({ sponsor, ws }, status, origin);
    }

    // Try each module's route matcher; first non-null wins. `server` is threaded
    // through so the modules can resolve the real socket-peer IP (server.requestIP)
    // when the trusted cf-connecting-ip header is absent — see http.ts getIp.
    //
    // NOTE: the sponsor module has NO HTTP route matcher anymore — POST /sponsor +
    // POST /execute were removed (sponsorship is WS-only; see the ws upgrade above).

    // MCP module — POST /mcp (Streamable-HTTP JSON-RPC: initialize/tools/list/
    // tools/call). No-auth bare transport probe; placed BEFORE deploy. Returns
    // null for non-/mcp paths so the matcher chain continues.
    const mcp = handleMcpRoute(req, url, origin, server);
    if (mcp) return mcp;

    // Facilitator module — x402 V2 'exact', KEYLESS: POST /verify, POST /settle,
    // GET /supported, POST /build, GET /terms, GET /tx, POST /checkout. Payments
    // settle by broadcasting the payer's signed gasless send_funds PTB over gRPC —
    // no Enoki, no account.move. `server` is threaded for the per-IP limiter.
    const facilitated = handleFacilitatorRoute(req, url, origin, server);
    if (facilitated) return facilitated;

    // Deploy module — POST /deploy, GET /sites[/:id], POST /domains,
    // DELETE /domains/:domain. 503s cleanly when the deploy wallet is unconfigured.
    const deployed = handleDeployRoute(req, url, origin, server);
    if (deployed) return deployed;

    // NOTE: the waitlist (POST /waitlist) route has been REMOVED with the api
    // module. The LIVE landing page that posts to /waitlist will 404 until the
    // landing redo points it elsewhere — this is intended (handles are on-chain
    // now; the waitlist is decoupled from this backend).
    //
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
console.log(`[backend] sui network: ${config.suiNetwork}`);
console.log(`[backend] sui rpc: ${config.suiRpcUrl}${config.suiRpcUrls.length > 1 ? ` (+${config.suiRpcUrls.length - 1} fallback)` : ""}`);
console.log(`[backend] enoki key: ${maskKey(config.enokiPrivateApiKey)}`);
console.log(
  `[backend] sponsor move targets: ${sponsorInfo.allowedMoveTargetCount} ` +
    `(crash=${sponsorInfo.crashTargetCount}, ` +
    (sponsorInfo.subsPublished
      ? `subs=${sponsorInfo.subsTargetCount} [SUBS LIVE]`
      : `subs=0 [unpublished]`) +
    `; account.move RETIRED — x402 V2 settles keyless)`,
);
console.log(`[backend] allowed origins: ${config.allowedOrigins.join(", ") || "(none)"}`);
console.log(
  `[backend] handle issuance: ${handleInfo.enabled
    ? `enabled (parent=${handleInfo.parentDomain}) — WS-only`
    : "DISABLED (SuiNS not configured)"}`,
);
{
  const chargeLive = deployInfo.enabled ? await deployInfo.chargeGateReady() : false;
  console.log(
    `[backend] deploy: ${deployInfo.enabled
      ? `enabled (base=${deployInfo.baseDomain}, epochs=${deployInfo.epochs}, ` +
        `cf=${deployInfo.cloudflare ? "on" : "off"})` +
        (deployInfo.chainReady ? "" : " — WAITING ON deploy_sui PUBLISH (placeholder on-chain ids)") +
        (chargeLive
          ? ` — CHARGE GATE LIVE (x402 V2, $${deployInfo.chargePrice}/deploy)`
          : " — charge gate OFF (treasury unresolved; un-gated deploys)")
      : "DISABLED (DEPLOY_WALLET_PRIVATE_KEY not set)"}`,
  );
}
console.log(
  `[backend] mcp: POST ${mcpInfo.endpoint} (${mcpInfo.transport}, ` +
    `protocol=${mcpInfo.protocolVersion}, tools=[${mcpInfo.tools.join(", ")}])`,
);
console.log(
  `[backend] brain (wallet AI): ${brainInfo.enabled
    ? `ON over WS (brainChatRequest — FENCED/keyless, model=${brainInfo.model}, ` +
      `cap=${brainInfo.dailyTokenMax} tok/user/day; narrates + PROPOSES, never signs)`
    : "OFF (ANTHROPIC_API_KEY not set — brain frame returns not-configured)"}`,
);
{
  const treasuryOk = await treasuryReady();
  console.log(
    `[backend] facilitator (x402 V2 'exact', ${facilitatorInfo.network}): ` +
      `${facilitatorInfo.routes.join(", ")} ` +
      `(merchants=${facilitatorInfo.merchantCount}, treasury=${facilitatorInfo.treasuryName} ` +
      `${treasuryOk ? "RESOLVED" : "unresolved — fee-tier paths 503"})`,
  );
}

// The Walrus storage extender — the deterministic subscription↔storage backstop, now
// driven by the MERCHANT SDK (suizeSubs.watch over the Deploy-merchant sub lifecycle;
// the subs module CHARGES push/user-signed, this just keeps a PAID site's storage
// extended). Enabled only when the deploy wallet is set AND the subs module is published;
// a no-op start otherwise (the rest of the backend is unaffected). Async (it resolves the
// treasury to construct suizeSubs) — fire-and-forget; never blocks boot, never throws.
void startStorageCron().catch((err) =>
  console.error("[backend] storage extender start failed:", (err as Error).message),
);
console.log(
  `[backend] storage extender: ${storageInfo.enabled
    ? `ON (suizeSubs.watch poll=${storageInfo.tickMs}ms, extend=${storageInfo.extendEpochs} epochs, ` +
      `safety=${storageInfo.safetyEpochs} epochs; + on-settle hook per sponsored renewal)`
    : "OFF (deploy wallet unset or subs module unpublished)"}`,
);
console.log(
  `[backend] deploy subscriptions: ${subscribeInfo.enabled
    ? `ON (POST /deploy/subscribe/build·/submit — merchant SDK suizeSubs; ` +
      `$${(subscribeInfo.amount / 1e6).toFixed(2)}/${Math.round(subscribeInfo.periodMs / 86_400_000)}d)`
    : "OFF (deploy wallet unset or subs module unpublished)"}`,
);

console.log(
  `[backend] routes: GET /ws (websocket — incl. sponsor/execute + handle ops), ` +
    `POST /mcp, POST /verify, POST /settle, GET /supported, POST /build, ` +
    `GET /terms, GET /tx, POST /checkout, ` +
    `POST /deploy, POST /deploy/subscribe/build, POST /deploy/subscribe/submit, ` +
    `GET /sites, GET /sites/:id, POST /sites/:id/extend, ` +
    `POST /domains, DELETE /domains/:domain, ` +
    `GET /health, GET /ready, GET /ready/serve, GET /ready/sponsor, ` +
    `GET /ready/handle, GET /ready/deploy, GET /ready/ws`,
);
