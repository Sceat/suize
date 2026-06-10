// MCP module — a BARE remote-MCP (Model Context Protocol) endpoint over the
// Streamable-HTTP transport. STEP 1 of "Deploy with Suize": prove a hosted MCP
// server connects, lists a tool, and calls it. NO auth, NO payment, NO Sui, NO
// session state — just one no-auth tool (`suize_ping`) behind `POST /mcp`.
//
// TRANSPORT CHOICE — hand-rolled JSON-RPC 2.0, NOT the @modelcontextprotocol/sdk:
//   The SDK's StreamableHTTPServerTransport is written against Node's
//   (IncomingMessage, ServerResponse) request model. This backend is a single
//   Bun.serve with a clean route-matcher chain — every module exports
//   `(req, url, origin, server) => Promise<Response> | null` (see deploy/index.ts).
//   Bridging the SDK's Node-stream transport into that Request→Response shape
//   needs a compat shim that fights the existing pattern, for zero benefit at this
//   scope (one tool, three methods, no sessions/SSE). Hand-rolling is ~1 file,
//   zero new deps, and composes perfectly with the matcher chain. The SDK earns
//   its place LATER (sessions, streaming, resources) — YAGNI for the bare probe.
//
// Streamable-HTTP, the minimal viable slice: a client POSTs JSON-RPC 2.0 to /mcp
// with `Accept: application/json, text/event-stream`. For a stateless single-shot
// request/response we reply with a single application/json body (the spec permits
// a JSON response when the server has no stream to push). We do NOT implement the
// optional GET-for-SSE channel or sessions here — this is the bare transport proof.
import type { Server } from "bun";
import { json } from "../http";

// ── Protocol constants ───────────────────────────────────────────────────────
// The MCP revision we negotiate. We echo the client's requested protocolVersion
// when it is a known revision, else fall back to ours (spec-compliant behavior).
const SUPPORTED_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"] as const;
const DEFAULT_PROTOCOL_VERSION = "2025-06-18";

const SERVER_INFO = { name: "suize-mcp", version: "0.1.0" } as const;

// Cap the JSON-RPC body — these payloads are tiny. Reject anything larger before
// parsing (mirrors the deploy module's body-size guard).
const MAX_BODY_BYTES = 64 * 1024;

// ── JSON-RPC 2.0 wire types (the minimal subset we handle) ───────────────────
interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: unknown;
}

type JsonRpcId = string | number | null;

const rpcResult = (id: JsonRpcId, result: unknown) => ({ jsonrpc: "2.0" as const, id, result });
const rpcError = (id: JsonRpcId, code: number, message: string) => ({
  jsonrpc: "2.0" as const,
  id,
  error: { code, message },
});

// JSON-RPC standard error codes.
const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;

// ── The one tool: suize_ping ─────────────────────────────────────────────────
// No auth, no side effects — just proves a tool can be listed and called. Takes an
// optional `name` string; returns a text content greeting.
const SUIZE_PING_TOOL = {
  name: "suize_ping",
  description:
    "Liveness probe for the Suize MCP server. Returns a greeting confirming the " +
    "hosted MCP transport is reachable. Optionally personalizes with `name`.",
  inputSchema: {
    type: "object" as const,
    properties: {
      name: {
        type: "string" as const,
        description: "Optional name to greet.",
      },
    },
    additionalProperties: false,
  },
} as const;

const runSuizePing = (args: unknown): string => {
  const name =
    args && typeof args === "object" && typeof (args as Record<string, unknown>).name === "string"
      ? ((args as Record<string, unknown>).name as string).trim()
      : "";
  return name ? `Suize MCP is live. Hello, ${name}.` : "Suize MCP is live. Hello.";
};

// ── JSON-RPC method dispatch ─────────────────────────────────────────────────
// Returns a JSON-RPC response object, or null for a NOTIFICATION (a request with
// no `id` — e.g. `notifications/initialized`), which gets a 202 with no body.
const dispatch = (rpc: JsonRpcRequest): object | null => {
  const id: JsonRpcId = rpc.id ?? null;
  const isNotification = rpc.id === undefined || rpc.id === null;

  switch (rpc.method) {
    case "initialize": {
      // Negotiate the protocol version: echo the client's if we support it.
      const requested =
        rpc.params && typeof rpc.params === "object"
          ? (rpc.params as Record<string, unknown>).protocolVersion
          : undefined;
      const protocolVersion =
        typeof requested === "string" &&
        (SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(requested)
          ? requested
          : DEFAULT_PROTOCOL_VERSION;
      return rpcResult(id, {
        protocolVersion,
        // Advertise only what we actually implement: tools (no list-changed
        // notifications, no resources, no prompts).
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
      });
    }

    case "notifications/initialized":
      // Post-initialize handshake notification — acknowledged via 202, no body.
      return null;

    case "ping":
      // MCP utility ping — empty result.
      return rpcResult(id, {});

    case "tools/list":
      return rpcResult(id, { tools: [SUIZE_PING_TOOL] });

    case "tools/call": {
      const params =
        rpc.params && typeof rpc.params === "object" ? (rpc.params as Record<string, unknown>) : {};
      const toolName = typeof params.name === "string" ? params.name : "";
      if (toolName !== SUIZE_PING_TOOL.name) {
        return rpcError(id, INVALID_PARAMS, `unknown tool: ${toolName || "(missing)"}`);
      }
      const textOut = runSuizePing(params.arguments);
      // tools/call results report tool-level failures via `isError`, not a
      // JSON-RPC error. This tool never fails, so isError is always false.
      return rpcResult(id, {
        content: [{ type: "text", text: textOut }],
        isError: false,
      });
    }

    default:
      if (isNotification) return null; // ignore unknown notifications
      return rpcError(id, METHOD_NOT_FOUND, `method not found: ${rpc.method}`);
  }
};

// ── POST /mcp handler ────────────────────────────────────────────────────────
const handleMcpPost = async (req: Request, origin: string | null): Promise<Response> => {
  // Body-size cap before parsing.
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > MAX_BODY_BYTES) {
    return json(rpcError(null, INVALID_REQUEST, "request too large"), 413, origin);
  }

  let raw: string;
  try {
    raw = await req.text();
  } catch {
    return json(rpcError(null, PARSE_ERROR, "could not read body"), 400, origin);
  }
  if (raw.length > MAX_BODY_BYTES) {
    return json(rpcError(null, INVALID_REQUEST, "request too large"), 413, origin);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return json(rpcError(null, PARSE_ERROR, "invalid JSON"), 400, origin);
  }

  // The Streamable-HTTP transport allows a single request OR a batch (array). We
  // handle both; a batch returns an array of responses (notifications omitted).
  const isValidRpc = (v: unknown): v is JsonRpcRequest =>
    !!v && typeof v === "object" && (v as JsonRpcRequest).jsonrpc === "2.0" &&
    typeof (v as JsonRpcRequest).method === "string";

  if (Array.isArray(parsed)) {
    if (parsed.length === 0) {
      return json(rpcError(null, INVALID_REQUEST, "empty batch"), 400, origin);
    }
    const responses: object[] = [];
    for (const item of parsed) {
      if (!isValidRpc(item)) {
        responses.push(rpcError(null, INVALID_REQUEST, "invalid JSON-RPC request"));
        continue;
      }
      const res = dispatch(item);
      if (res) responses.push(res);
    }
    // All-notification batch → 202 with no body (nothing to return).
    if (responses.length === 0) return new Response(null, { status: 202 });
    return json(responses, 200, origin);
  }

  if (!isValidRpc(parsed)) {
    return json(rpcError(null, INVALID_REQUEST, "invalid JSON-RPC request"), 400, origin);
  }

  const res = dispatch(parsed);
  // A notification (no id) gets a 202 Accepted with no body, per the transport.
  if (!res) return new Response(null, { status: 202 });
  return json(res, 200, origin);
};

// ---------------------------------------------------------------------------
// Route matcher — same shape as handleDeployRoute: returns a Response for our
// route, or null if the path/method isn't ours (so the next matcher runs).
//
// `POST /mcp` is the Streamable-HTTP message endpoint. The optional GET-for-SSE
// channel and DELETE-session are not part of this bare probe; a GET /mcp falls
// through to the 404 (no persistent stream to open).
// ---------------------------------------------------------------------------
export const handleMcpRoute = (
  req: Request,
  url: URL,
  origin: string | null,
  _server?: Server<unknown>,
): Promise<Response> | null => {
  if (req.method === "POST" && url.pathname === "/mcp") return handleMcpPost(req, origin);
  return null;
};

export const mcpInfo = {
  endpoint: "/mcp",
  transport: "streamable-http (hand-rolled JSON-RPC 2.0)",
  protocolVersion: DEFAULT_PROTOCOL_VERSION,
  tools: [SUIZE_PING_TOOL.name],
} as const;
