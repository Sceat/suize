// Stdio smoke test — spawns the REAL binary and speaks newline-delimited
// JSON-RPC 2.0 over its stdin/stdout, exactly like an MCP client would. No key
// is set, so a tool that needs to sign fails fast with the key-setup guidance
// (network-free: list_sites reaches the signer before any fetch).
import { afterAll, beforeAll, expect, test } from 'bun:test'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const pkgDir = join(dirname(fileURLToPath(import.meta.url)), '..')

let child: ChildProcessWithoutNullStreams
const pending = new Map<number, (msg: Record<string, any>) => void>()
let nextId = 1

beforeAll(() => {
  // Explicitly strip any signing key from the inherited env so the no-key gate
  // is what's under test. Point the Sui CLI signer at a binary that does not
  // exist so the fallback fails fast and hermetically (no `sui`, no network) with
  // the install guidance, regardless of the host's own keystore.
  const env = { ...process.env }
  delete env.SUIZE_KEY
  delete env.SUIZE_KEY_FILE
  env.SUIZE_SUI_BIN = join(pkgDir, 'test', '__no_such_sui_binary__')
  child = spawn('bun', [join(pkgDir, 'src', 'index.ts')], {
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  let buffer = ''
  child.stdout.on('data', (chunk: Buffer) => {
    buffer += chunk.toString('utf8')
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.trim()) continue
      const msg = JSON.parse(line) as Record<string, any>
      const settle = pending.get(msg.id)
      if (settle) {
        pending.delete(msg.id)
        settle(msg)
      }
    }
  })
})

afterAll(() => {
  child?.kill()
})

const send = (msg: object): void => {
  child.stdin.write(JSON.stringify(msg) + '\n')
}

const request = (method: string, params?: unknown): Promise<Record<string, any>> => {
  const id = nextId++
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new Error(`no response to ${method} (id ${id}) within 5s`))
    }, 5000)
    pending.set(id, msg => {
      clearTimeout(timer)
      resolve(msg)
    })
    send({ jsonrpc: '2.0', id, method, params })
  })
}

test('initialize negotiates the protocol and advertises tools', async () => {
  const res = await request('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'smoke', version: '0' },
  })
  expect(res.error).toBeUndefined()
  expect(res.result.protocolVersion).toBe('2025-06-18')
  expect(res.result.serverInfo.name).toBe('@suize/mcp')
  expect(res.result.capabilities.tools).toBeDefined()
  // the post-initialize notification must be silently accepted (no reply)
  send({ jsonrpc: '2.0', method: 'notifications/initialized' })
})

test('tools/list exposes the deploy tool set with sane schemas', async () => {
  const res = await request('tools/list')
  expect(res.error).toBeUndefined()
  const tools = res.result.tools as Array<{ name: string; description: string; inputSchema: any }>
  const names = tools.map(t => t.name)
  expect(names).toEqual(['deploy_site', 'list_sites', 'extend_site', 'site_status', 'link_domain', 'repoint_domain', 'domain_status'])
  for (const tool of tools) {
    expect(tool.description.length).toBeGreaterThan(0)
    expect(tool.inputSchema.type).toBe('object')
  }
  // the wallet-era tools are gone
  expect(names).not.toContain('suize_pay')
  expect(names).not.toContain('authenticate')
})

test('a signing tool with no key fails fast with setup guidance (network-free)', async () => {
  // list_sites reaches the signer (address()) before any network call. With no
  // SUIZE_KEY and the CLI binary pointed at a missing path, it must return the
  // actionable Sui-CLI setup guidance, not hang or crash.
  const res = await request('tools/call', { name: 'list_sites', arguments: {} })
  expect(res.error).toBeUndefined()
  expect(res.result.isError).toBe(true)
  const text = res.result.content[0].text as string
  expect(text).toContain('Sui CLI')
  expect(text).toContain('SUIZE_KEY_FILE')
})

test('unknown tool → invalid params; unknown method → method not found; ping pongs', async () => {
  const bad = await request('tools/call', { name: 'nope', arguments: {} })
  expect(bad.error.code).toBe(-32602)
  const missing = await request('definitely/not/a/method')
  expect(missing.error.code).toBe(-32601)
  const pong = await request('ping')
  expect(pong.result).toEqual({})
})
