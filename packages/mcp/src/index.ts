// ============================================================================
// @suize/mcp — the LOCAL stdio MCP server. Gives an external assistant (Claude
// Code / Claude Desktop) a Suize agent wallet: pay HTTP 402 merchants, send USDC,
// read balances + receipts, and one-tap kill — all from the user's own zkLogin
// wallet. Auth is the zkLogin popup ONLY (the wallet's /agent-connect page); ALL
// signing is the Enoki zkLogin session, locally — keys never leave the user's
// machine, there is NO raw-keypair signer and NO dev fallback of any kind, and
// the backend never signs the payer leg.
//
// (The source runs under Bun for local dev — `bun run src/index.ts`. The PUBLISHED
// bin is bundled by tsup and runs under node via `#!/usr/bin/env node`.)
//
// TRANSPORT — stdio, per the MCP spec (2025-06-18 "stdio" transport): the
// client launches this process; JSON-RPC 2.0 messages are NEWLINE-DELIMITED
// UTF-8 JSON on stdin/stdout (one message per line, no embedded newlines —
// stdio framing is NOT the LSP Content-Length style, and JSON-RPC batching was
// removed from the spec in 2025-06-18, so a batch is rejected). Anything that
// is not a protocol message goes to STDERR — stdout is the wire.
//
// The JSON-RPC dispatch mirrors services/backend/src/mcp/index.ts (the remote
// Streamable-HTTP probe) — same initialize / tools/list / tools/call shape,
// different transport and a real tool set.
// ============================================================================

import { createInterface } from 'node:readline'
import { authenticate } from './authenticate'
import { suizePay, type PayArgs } from './pay'
import { suizeBalance, suizeReceipts, suizeSubscriptions, suizeKill, type KillArgs } from './reads'

// ── Protocol constants (kept in lockstep with the backend MCP module) ────────
const SUPPORTED_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'] as const
const DEFAULT_PROTOCOL_VERSION = '2025-06-18'
const SERVER_INFO = { name: '@suize/mcp', version: '0.2.1' } as const

// ── JSON-RPC 2.0 wire types ──────────────────────────────────────────────────
interface JsonRpcRequest {
  jsonrpc: '2.0'
  id?: string | number | null
  method: string
  params?: unknown
}
type JsonRpcId = string | number | null

const rpcResult = (id: JsonRpcId, result: unknown) => ({ jsonrpc: '2.0' as const, id, result })
const rpcError = (id: JsonRpcId, code: number, message: string) => ({
  jsonrpc: '2.0' as const,
  id,
  error: { code, message },
})

const PARSE_ERROR = -32700
const INVALID_REQUEST = -32600
const METHOD_NOT_FOUND = -32601
const INVALID_PARAMS = -32602

// ── The wallet tools — descriptions ARE the docs the assistant reads ─────────

const TOOLS = [
  {
    name: 'authenticate',
    description:
      'Connect your Suize wallet to this assistant — opens your browser for a one-time Google sign-in. ' +
      'Run this first; run it again only if a tool reports the session expired.',
    inputSchema: { type: 'object' as const, properties: {}, additionalProperties: false },
  },
  {
    name: 'suize_pay',
    description:
      'Pay USDC from your Suize wallet, gas-free. (A) Pay an HTTP 402 resource: pass { url } (optional ' +
      'method/body); returns the served body + the settlement digest. (B) Send USDC: pass { payTo, amount }. ' +
      'If this returns "CONFIRMATION REQUIRED", show it to the user, then call again with the same ' +
      'arguments plus confirm:true.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        url: { type: 'string' as const, description: 'Shape A: the http(s) URL of the 402 resource to pay + fetch.' },
        method: { type: 'string' as const, description: 'Shape A: HTTP method (default GET).' },
        body: { description: 'Shape A: optional request body (string or JSON) for non-GET methods.' },
        payTo: { type: 'string' as const, description: 'Shape B: the recipient Sui address (0x…64 hex).' },
        amount: {
          type: 'string' as const,
          description: 'Shape B: decimal USDC string, ≤ 6 dp, > 0 — e.g. "0.50".',
        },
        confirm: {
          type: 'boolean' as const,
          description: 'Set true ONLY after the user explicitly approved the exact payment this tool asked to confirm.',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'suize_balance',
    description:
      "Read your Suize wallet's USDC balance and address. Returns { address, network, usdc }.",
    inputSchema: { type: 'object' as const, properties: {}, additionalProperties: false },
  },
  {
    name: 'suize_receipts',
    description:
      "List your Suize wallet's recent USDC payments, newest first — each row { digest, time, amount }.",
    inputSchema: {
      type: 'object' as const,
      properties: {
        limit: { type: 'number' as const, description: 'Max rows to return (1..50, default 10).' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'suize_subscriptions',
    description:
      "List your Suize wallet's subscriptions — each { subscriptionId, merchant, amount, periodMs, paidUntil, isActive }.",
    inputSchema: { type: 'object' as const, properties: {}, additionalProperties: false },
  },
  {
    name: 'suize_kill',
    description:
      "Sweep your wallet's entire USDC balance back to your main wallet and disarm it (clears the local " +
      'session). Returns { swept, digest, destination }. Pass { to } only if no main wallet was set when connecting.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        to: {
          type: 'string' as const,
          description: "The sweep destination (the user's main 0x…64-hex wallet). Required only when no main address was connected.",
        },
      },
      additionalProperties: false,
    },
  },
] as const

type ToolArgs = Record<string, unknown>
const TOOL_HANDLERS: Record<string, (args: ToolArgs) => Promise<string>> = {
  authenticate: () => authenticate(),
  suize_pay: args => suizePay(args as PayArgs),
  suize_balance: () => suizeBalance(),
  suize_receipts: args => suizeReceipts(args),
  suize_subscriptions: () => suizeSubscriptions(),
  suize_kill: args => suizeKill(args as KillArgs),
}

// ── Dispatch (same switch shape as the backend MCP module) ───────────────────
// Returns a response object, or null for a notification (no reply on stdio).
const dispatch = async (rpc: JsonRpcRequest): Promise<object | null> => {
  const id: JsonRpcId = rpc.id ?? null
  const isNotification = rpc.id === undefined || rpc.id === null

  switch (rpc.method) {
    case 'initialize': {
      const requested =
        rpc.params && typeof rpc.params === 'object'
          ? (rpc.params as Record<string, unknown>).protocolVersion
          : undefined
      const protocolVersion =
        typeof requested === 'string' &&
        (SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(requested)
          ? requested
          : DEFAULT_PROTOCOL_VERSION
      return rpcResult(id, {
        protocolVersion,
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
      })
    }

    case 'notifications/initialized':
      return null

    case 'ping':
      return rpcResult(id, {})

    case 'tools/list':
      return rpcResult(id, { tools: TOOLS })

    case 'tools/call': {
      const params =
        rpc.params && typeof rpc.params === 'object' ? (rpc.params as Record<string, unknown>) : {}
      const toolName = typeof params.name === 'string' ? params.name : ''
      const handler = TOOL_HANDLERS[toolName]
      if (!handler) return rpcError(id, INVALID_PARAMS, `unknown tool: ${toolName || '(missing)'}`)
      const args =
        params.arguments && typeof params.arguments === 'object'
          ? (params.arguments as ToolArgs)
          : {}
      // Tool-level failures surface via isError in the RESULT (per MCP), never
      // as a JSON-RPC error — the assistant is supposed to read them.
      try {
        const text = await handler(args)
        return rpcResult(id, { content: [{ type: 'text', text }], isError: false })
      } catch (e) {
        return rpcResult(id, {
          content: [{ type: 'text', text: (e as Error).message || 'tool failed' }],
          isError: true,
        })
      }
    }

    default:
      if (isNotification) return null // ignore unknown notifications, per spec
      return rpcError(id, METHOD_NOT_FOUND, `method not found: ${rpc.method}`)
  }
}

// ── The stdio loop ───────────────────────────────────────────────────────────
// One JSON-RPC message per line. Responses may interleave out of order across
// long-running calls (authenticate blocks on the browser) — JSON-RPC ids keep
// the client matched up, so each line is handled WITHOUT awaiting the previous
// one (a ping must answer while a sign-in is pending).

const writeMessage = (msg: object): void => {
  process.stdout.write(JSON.stringify(msg) + '\n')
}

const isValidRpc = (v: unknown): v is JsonRpcRequest =>
  !!v &&
  typeof v === 'object' &&
  (v as JsonRpcRequest).jsonrpc === '2.0' &&
  typeof (v as JsonRpcRequest).method === 'string'

const handleLine = async (line: string): Promise<void> => {
  const raw = line.trim()
  if (!raw) return
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    writeMessage(rpcError(null, PARSE_ERROR, 'invalid JSON'))
    return
  }
  if (Array.isArray(parsed)) {
    // JSON-RPC batching was removed from MCP in 2025-06-18.
    writeMessage(rpcError(null, INVALID_REQUEST, 'batching is not supported'))
    return
  }
  if (!isValidRpc(parsed)) {
    writeMessage(rpcError(null, INVALID_REQUEST, 'invalid JSON-RPC request'))
    return
  }
  const res = await dispatch(parsed)
  if (res) writeMessage(res)
}

const rl = createInterface({ input: process.stdin, terminal: false })
rl.on('line', line => {
  void handleLine(line)
})
rl.on('close', () => {
  // stdin closed = the client is gone (spec: shutdown by closing the input stream).
  process.exit(0)
})
