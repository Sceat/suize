// Minimal facilitator-only boot harness for the x402 E2E.
//
// WHY THIS EXISTS: a facilitator suite wants a SEEDED SUIZE_MERCHANTS env + NO deploy
// wallet / mcp / ws in the graph — a tight, fast surface mounting ONLY the
// facilitator route (the unit under test) + /health. The full backend (src/index.ts)
// boots fine now (the Phase-C deploy rewrite landed), but this keeps the fee-tier
// facilitator/tier3 suites independent of the deploy module's wallet + Walrus setup.
//
// It is byte-identical in BEHAVIOR to how src/index.ts mounts the facilitator:
// same handleFacilitatorRoute, same json/getIp/corsHeaders, same server threading.
import type { Server } from "bun";
import { config } from "../../src/config";
import { corsHeaders, text } from "../../src/http";
import { handleFacilitatorRoute } from "../../src/facilitator";

if (!config.enokiPrivateApiKey) {
  // The facilitator settle path is KEYLESS, but ./fees → ../sponsor constructs an
  // EnokiClient at import; an empty key is fine for that (it's never called here).
  console.warn("[harness] no ENOKI key — fine: the x402 facilitator settle is keyless");
}

Bun.serve({
  port: config.port,
  idleTimeout: 200,
  fetch: async (req, server: Server<unknown>) => {
    const url = new URL(req.url);
    const origin = req.headers.get("origin");
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(origin) });
    if (req.method === "GET" && url.pathname === "/health") return text("ok", 200, origin);
    const facilitated = handleFacilitatorRoute(req, url, origin, server);
    if (facilitated) return facilitated;
    return new Response(JSON.stringify({ error: "not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
    });
  },
});

console.log(`[harness] facilitator-only backend on :${config.port}`);
