// Tests for the signer resolution in src/config.ts. The default path uses the
// `sui` CLI as an EXTERNAL signer: the key never enters this process. Coverage:
//   (a) findCliAlias — pure parsing of `sui keytool list --json` (deterministic)
//   (b) SUIZE_KEY wins over the CLI path (deterministic, no `sui`)
//   (c) missing `sui` binary → install guidance (deterministic, no `sui`)
//   (d) real CLI sign round-trip in a sandboxed SUI_CONFIG_DIR (needs `sui`)
//   (e) alias absent / non-ed25519 → actionable errors (needs `sui`)
//
// config.ts caches the resolved signer in a module singleton, so each scenario
// imports the module through a unique query string to get fresh state (Bun busts
// its module cache on the query).
import { afterEach, beforeEach, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Ed25519Keypair, Ed25519PublicKey } from '@mysten/sui/keypairs/ed25519'
import { Transaction } from '@mysten/sui/transactions'
import { fromBase64, toBase58 } from '@mysten/sui/utils'
import { findCliAlias } from '../src/config'

const CONFIG_TS = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'config.ts')

// Is a working `sui` CLI on PATH? Round-trip + keystore tests need it; the rest
// don't. Guarded tests skip cleanly on CI without the CLI.
const HAS_SUI = spawnSync('sui', ['--version'], { encoding: 'utf8' }).status === 0
const cliTest = HAS_SUI ? test : test.skip

const ENV_KEYS = ['SUIZE_KEY', 'SUIZE_KEY_FILE', 'SUIZE_SUI_CONFIG_DIR', 'SUIZE_CLI_ALIAS', 'SUIZE_SUI_BIN'] as const
let saved: Record<string, string | undefined>
const sandboxes: string[] = []
let caseId = 0

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map(k => [k, process.env[k]]))
  for (const k of ENV_KEYS) delete process.env[k]
})
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
  while (sandboxes.length) rmSync(sandboxes.pop()!, { recursive: true, force: true })
})

/** Fresh, uncached config module (each call = new singleton state). */
const freshConfig = () => import(`${CONFIG_TS}?case=${++caseId}`) as Promise<typeof import('../src/config')>

/** A sandboxed Sui config dir: minimal client.yaml + empty keystore/aliases so
 * `sui keytool`/`client` run non-interactively against it. */
const makeSandbox = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'suize-cli-'))
  sandboxes.push(dir)
  writeFileSync(
    join(dir, 'client.yaml'),
    `keystore:\n  File: ${join(dir, 'sui.keystore')}\n` +
      'envs:\n  - alias: testnet\n    rpc: "https://fullnode.testnet.sui.io:443"\n    ws: ~\n    basic_auth: ~\n' +
      'active_env: testnet\nactive_address: ~\n',
  )
  writeFileSync(join(dir, 'sui.keystore'), '[]')
  writeFileSync(join(dir, 'sui.aliases'), '[]')
  return dir
}

/** Create a key of the given scheme + alias in the sandbox; return its address.
 * Never logs stdout (it carries the recovery phrase). */
const newAddress = (dir: string, scheme: 'ed25519' | 'secp256k1', alias: string): string => {
  const r = spawnSync('sui', ['client', 'new-address', scheme, alias, '--json'], {
    encoding: 'utf8',
    env: { ...process.env, SUI_CONFIG_DIR: dir },
  })
  if (r.status !== 0) throw new Error(`new-address failed (exit ${r.status})`)
  return (JSON.parse(r.stdout) as { address: string }).address
}

/** The alias's ed25519 public key from the sandbox keystore. */
const publicKeyOf = (dir: string, alias: string): Ed25519PublicKey => {
  const r = spawnSync('sui', ['keytool', 'list', '--json'], {
    encoding: 'utf8',
    env: { ...process.env, SUI_CONFIG_DIR: dir },
  })
  const entry = (JSON.parse(r.stdout) as Array<{ alias: string; publicBase64Key: string }>).find(k => k.alias === alias)!
  return new Ed25519PublicKey(fromBase64(entry.publicBase64Key).slice(1)) // strip flag byte
}

/** Well-formed TransactionData bytes, built offline (no network, no real coins). */
const fixtureTxBytes = async (sender: string): Promise<Uint8Array> => {
  const tx = new Transaction()
  tx.setSender(sender)
  tx.setGasPrice(1000n)
  tx.setGasBudget(2_000_000n)
  tx.setGasPayment([{ objectId: '0x'.padEnd(66, '2'), version: '1', digest: toBase58(new Uint8Array(32).fill(7)) }])
  return tx.build()
}

// ── (a) pure parsing, deterministic ──────────────────────────────────────────

test('findCliAlias parses `sui keytool list --json` output', () => {
  // Shape captured from a real `sui keytool list --json` (2026-07-12).
  const listing = JSON.stringify([
    { alias: 'winn-cto', suiAddress: '0x0ae4', publicBase64Key: 'ACXZ', keyScheme: 'ed25519', flag: 0 },
    { alias: 'suize', suiAddress: '0x171a', publicBase64Key: 'ADvY', keyScheme: 'ed25519', flag: 0 },
    { alias: 'legacy-secp', suiAddress: '0xbeef', publicBase64Key: 'AQMf', keyScheme: 'secp256k1', flag: 1 },
  ])
  expect(findCliAlias(listing, 'suize')).toEqual({ suiAddress: '0x171a', keyScheme: 'ed25519' })
  expect(findCliAlias(listing, 'legacy-secp')).toEqual({ suiAddress: '0xbeef', keyScheme: 'secp256k1' })
  expect(findCliAlias(listing, 'not-here')).toBeNull()
  expect(findCliAlias('[]', 'suize')).toBeNull()
})

// ── (b) SUIZE_KEY wins, deterministic ────────────────────────────────────────

test('SUIZE_KEY signs in-process and wins over the CLI path', async () => {
  const envKp = Ed25519Keypair.generate()
  process.env.SUIZE_KEY = envKp.getSecretKey() // suiprivkey1…
  process.env.SUIZE_SUI_BIN = '/nonexistent/sui-should-not-be-invoked' // fails loudly if the CLI is consulted

  const { address, signer } = await freshConfig()
  expect(address()).toBe(envKp.toSuiAddress())
  const bytes = await fixtureTxBytes(envKp.toSuiAddress())
  const { signature } = await signer().signTransaction(bytes)
  expect(await envKp.getPublicKey().verifyTransaction(bytes, signature)).toBe(true)
})

// ── (c) missing `sui` binary, deterministic ──────────────────────────────────

test('missing sui binary → actionable install guidance', async () => {
  process.env.SUIZE_SUI_BIN = '/nonexistent/sui-not-installed'
  const { signer } = await freshConfig()
  let msg = ''
  try {
    signer()
    throw new Error('expected signer() to throw')
  } catch (e) {
    msg = (e as Error).message
  }
  expect(msg).toContain('Sui CLI')
  expect(msg).toContain('SUIZE_KEY_FILE')
})

// ── (d) real CLI external-signer round-trip ──────────────────────────────────

cliTest('resolves the aliased address and signs via the Sui CLI (verifiable)', async () => {
  const dir = makeSandbox()
  const addr = newAddress(dir, 'ed25519', 'suize')
  const pubKey = publicKeyOf(dir, 'suize')
  process.env.SUIZE_SUI_CONFIG_DIR = dir

  const { address, signer } = await freshConfig()
  expect(address()).toBe(addr)

  const bytes = await fixtureTxBytes(addr)
  const { signature } = await signer().signTransaction(bytes)
  // The CLI's suiSignature verifies as a transaction signature (matching intent).
  expect(await pubKey.verifyTransaction(bytes, signature)).toBe(true)
  expect(pubKey.toSuiAddress()).toBe(addr)
})

cliTest('honors SUIZE_CLI_ALIAS for a non-default alias', async () => {
  const dir = makeSandbox()
  const addr = newAddress(dir, 'ed25519', 'deploybot')
  process.env.SUIZE_SUI_CONFIG_DIR = dir
  process.env.SUIZE_CLI_ALIAS = 'deploybot'

  const { address } = await freshConfig()
  expect(address()).toBe(addr)
})

// ── (e) alias absent / non-ed25519 → actionable errors ───────────────────────

cliTest('absent alias → actionable no-key setup guidance', async () => {
  const dir = makeSandbox() // empty keystore, no "suize" alias
  process.env.SUIZE_SUI_CONFIG_DIR = dir

  const { signer } = await freshConfig()
  let msg = ''
  try {
    signer()
    throw new Error('expected signer() to throw')
  } catch (e) {
    msg = (e as Error).message
  }
  expect(msg.toLowerCase()).toContain('no signing key')
  expect(msg).toContain('sui client new-address ed25519 suize')
  expect(msg).toContain('gasless')
  expect(msg).toContain('SUIZE_KEY_FILE')
})

cliTest('alias present but non-ed25519 → names the scheme mismatch', async () => {
  const dir = makeSandbox()
  newAddress(dir, 'secp256k1', 'suize')
  process.env.SUIZE_SUI_CONFIG_DIR = dir

  const { signer } = await freshConfig()
  let msg = ''
  try {
    signer()
    throw new Error('expected signer() to throw')
  } catch (e) {
    msg = (e as Error).message
  }
  expect(msg).toContain('ed25519 only')
})
