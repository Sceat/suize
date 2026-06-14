// Stdio smoke test — spawns the REAL binary and speaks newline-delimited
// JSON-RPC 2.0 over its stdin/stdout, exactly like an MCP client would.
// NO fake session, NO key fallback: SUIZE_SESSION_PATH points into an empty
// temp dir, so the session-gated tools must answer "authenticate first".
import { afterAll, beforeAll, expect, test } from 'bun:test'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const pkgDir = join(dirname(fileURLToPath(import.meta.url)), '..')

let child: ChildProcessWithoutNullStreams
let tmp: string
const pending = new Map<number, (msg: Record<string, any>) => void>()
let nextId = 1

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), 'suize-mcp-test-'))
  child = spawn('bun', [join(pkgDir, 'src', 'index.ts')], {
    env: { ...process.env, SUIZE_SESSION_PATH: join(tmp, 'session.json') },
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
  rmSync(tmp, { recursive: true, force: true })
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

test('tools/list exposes the full tool set with sane schemas', async () => {
  const res = await request('tools/list')
  expect(res.error).toBeUndefined()
  const tools = res.result.tools as Array<{ name: string; description: string; inputSchema: any }>
  const names = tools.map(t => t.name)
  expect(names).toEqual([
    'authenticate',
    'suize_pay',
    'suize_balance',
    'suize_receipts',
    'suize_subscriptions',
    'suize_kill',
  ])
  // every description carries the custody line (the docs ARE the descriptions)
  for (const tool of tools) {
    expect(tool.description).toContain("keys never leave the user's machine")
    // every tool advertises an object input schema
    expect(tool.inputSchema.type).toBe('object')
  }
  // the MCP is wallet-only — no Deploy-product tools leak in
  expect(names).not.toContain('suize_deploy')
  expect(names).not.toContain('suize_extend')
  expect(names).not.toContain('suize_subscribe')
})

test('every session-gated tool returns the "authenticate first" error', async () => {
  // suize_pay needs a url or payTo to get past arg validation into the session gate.
  const calls: Array<[string, Record<string, unknown>]> = [
    ['suize_pay', { payTo: '0x' + '1'.repeat(64), amount: '0.50' }],
    ['suize_balance', {}],
    ['suize_receipts', {}],
    ['suize_subscriptions', {}],
    ['suize_kill', {}],
  ]
  for (const [name, args] of calls) {
    const res = await request('tools/call', { name, arguments: args })
    expect(res.error).toBeUndefined()
    expect(res.result.isError).toBe(true)
    expect(res.result.content[0].text).toContain('run the authenticate tool first')
  }
})

test('unknown tool → invalid params; unknown method → method not found; ping pongs', async () => {
  const bad = await request('tools/call', { name: 'nope', arguments: {} })
  expect(bad.error.code).toBe(-32602)
  const missing = await request('definitely/not/a/method')
  expect(missing.error.code).toBe(-32601)
  const pong = await request('ping')
  expect(pong.result).toEqual({})
})
