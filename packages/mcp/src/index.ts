// ============================================================================
// @suize/mcp — the LOCAL stdio MCP server. Gives a coding assistant (Claude Code
// / Cursor / Codex) the ability to DEPLOY a static site to Walrus through Suize:
// deploy_site · list_sites · extend_site · site_status. It signs a gasless x402
// payment with a LOCAL key (SUIZE_KEY) and pays the live charge door
// (api.suize.site); the key never leaves the machine, so it is non-custodial by
// construction, and the deployed site's on-chain owner is the local key's address
// (whoever pays, owns). No account, no browser sign-in, no lock-in.
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
import {
  deploySite,
  extendSite,
  listSites,
  siteStatus,
  linkDomain,
  repointDomain,
  domainStatus,
  type DeployArgs,
  type ExtendArgs,
  type SiteIdArgs,
  type DomainArgs,
  type RepointArgs,
} from './deploy'

// ── Protocol constants (kept in lockstep with the backend MCP module) ────────
const SUPPORTED_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'] as const
const DEFAULT_PROTOCOL_VERSION = '2025-06-18'
// __MCP_VERSION__ is injected from package.json at build time (tsup define);
// the typeof guard keeps `bun run src/index.ts` and tests alive without it.
declare const __MCP_VERSION__: string
const SERVER_INFO = {
  name: '@suize/mcp',
  version: typeof __MCP_VERSION__ === 'undefined' ? 'dev' : __MCP_VERSION__,
} as const

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
    name: 'deploy_site',
    description:
      'Deploy a built static site to Walrus through Suize and get a live URL. Point { dir } at your ' +
      'built output folder (e.g. "./dist"). Pays a flat $0.25 per month of hosting from your local ' +
      'Suize key (gasless, non-custodial); { months } buys more up front (default 1; up to what Walrus ' +
      'can fund in one store, about two years on mainnet). ' +
      'Set { private: true } for a Seal-encrypted site only wallets you allow can open (2x the rate). ' +
      'You own the site (the payer is the on-chain owner). Returns the URL + Site ID.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        dir: { type: 'string' as const, description: 'Path to the built static site folder to publish (e.g. "./dist").' },
        name: { type: 'string' as const, description: 'Optional label for the site (defaults to the folder name).' },
        months: { type: 'number' as const, description: 'Months of hosting to prepay (default 1, $0.25/month; up to about two years per payment on mainnet).' },
        private: { type: 'boolean' as const, description: 'Deploy as a private Seal-encrypted site (2x rate). Default false.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'list_sites',
    description:
      'List every site you have deployed (found on-chain by your Suize key\'s address), newest first — ' +
      'each with its name, Site ID, and URL.',
    inputSchema: { type: 'object' as const, properties: {}, additionalProperties: false },
  },
  {
    name: 'extend_site',
    description:
      'Buy more hosting time for a site you deployed. Pass { siteId } (from deploy_site or list_sites) ' +
      'and { months }. Pays $0.25/month (2x for private sites) from your local key.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        siteId: { type: 'string' as const, description: 'The 0x… Site ID to extend.' },
        months: { type: 'number' as const, description: 'Months to add (default 1).' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'site_status',
    description:
      'Show a deployed site\'s current state: URL, owner, size, and how long its hosting is paid through ' +
      '(active or lapsed). Pass { siteId }.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        siteId: { type: 'string' as const, description: 'The 0x… Site ID to inspect.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'link_domain',
    description:
      'Link a custom domain to a site you deployed. First run returns the DNS records to set (TXT + CNAME); ' +
      'once DNS verifies, the same call pays $19.99 for one year from your local Suize key and links the domain ' +
      'on-chain with automatic SSL. Verification and re-runs are free; only the final link charges, and the ' +
      'payment must come from the site owner\'s key.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        siteId: { type: 'string' as const, description: 'The 0x… Site ID to link (from deploy_site or list_sites).' },
        domain: { type: 'string' as const, description: 'The custom domain, e.g. "docs.example.com".' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'repoint_domain',
    description:
      'Move an already-linked custom domain onto another site you own — free, no new charge. Auth is a ' +
      'personal message signed by the key that owns BOTH sites; needs an in-process key (SUIZE_KEY or ' +
      'SUIZE_KEY_FILE), the Sui CLI signer cannot sign personal messages.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        domain: { type: 'string' as const, description: 'The linked custom domain to move.' },
        newSiteId: { type: 'string' as const, description: 'The 0x… Site ID to point the domain at.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'domain_status',
    description:
      'Check a custom domain\'s link state for a site: linked (with SSL state), waiting on DNS (shows the exact ' +
      'records still missing), or verified-but-unlinked. Free, never pays.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        siteId: { type: 'string' as const, description: 'The 0x… Site ID the domain belongs to.' },
        domain: { type: 'string' as const, description: 'The custom domain to check.' },
      },
      additionalProperties: false,
    },
  },
] as const

type ToolArgs = Record<string, unknown>
const TOOL_HANDLERS: Record<string, (args: ToolArgs) => Promise<string>> = {
  deploy_site: args => deploySite(args as DeployArgs),
  list_sites: () => listSites(),
  extend_site: args => extendSite(args as ExtendArgs),
  site_status: args => siteStatus(args as SiteIdArgs),
  link_domain: args => linkDomain(args as DomainArgs),
  repoint_domain: args => repointDomain(args as RepointArgs),
  domain_status: args => domainStatus(args as DomainArgs),
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
// long-running calls (a deploy blocks on the Walrus upload) — JSON-RPC ids keep
// the client matched up, so each line is handled WITHOUT awaiting the previous
// one (a ping must answer while a deploy is in flight).

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
