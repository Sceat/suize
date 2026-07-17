// ============================================================================
// @suize/mcp — config. The LOCAL, non-custodial deploy client: it pays the live
// Suize charge door (api.suize.site) with a gasless x402 payment, so a coding
// agent can publish a static site to Walrus in one tool call. The signing key
// NEVER enters this process: by default the Sui CLI keeps the key and Suize just
// asks it to sign.
//
// The signer resolves in this order:
//   SUIZE_KEY        a suiprivkey1… secret key, signed IN-PROCESS (for CI /
//                    self-hosters). Optional override.
//   SUIZE_KEY_FILE   a path to a file containing one (preferred over SUIZE_KEY:
//                    keeps the key out of shell history / process env dumps).
//   (default)        the Sui CLI as an external signer — resolves the alias named
//                    by SUIZE_CLI_ALIAS (default "suize") to an address via
//                    `sui keytool list --json`, then signs each payment with
//                    `sui keytool sign`. The key stays in the CLI keystore; this
//                    process only ever sees the public address + the signature.
//                    Create the key once: `sui client new-address ed25519 suize`.
//   SUIZE_SUI_BIN    the `sui` binary (default: `sui` on PATH).
//   SUIZE_SUI_CONFIG_DIR  the Sui config dir (passed as SUI_CONFIG_DIR to the CLI).
//   SUIZE_NETWORK    mainnet (default, matching the live api.suize.site) | testnet
//                    -- set testnet when SUIZE_API points at a self-hosted testnet instance.
//   SUIZE_API        the charge door (default https://api.suize.site, mainnet).
//   SUIZE_GRAPHQL    the Sui GraphQL endpoint (default: the public per-network one).
//
// Everything on-chain (ids, USDC type, GraphQL url) resolves from @suize/shared
// for the selected network — one source of truth, bundled by tsup into the
// published bin (no runtime workspace dep).
// ============================================================================

import { homedir } from 'node:os'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import { spawnSync, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { toBase64 } from '@mysten/sui/utils'
import { graphqlUrl, packageIds, resolveNetwork, USDC_TYPES, type SuiNetwork } from '@suize/shared'

const execFileAsync = promisify(execFile)

const env = (k: string): string => (process.env[k] ?? '').trim()

// Default MAINNET: the hosted api.suize.site is a mainnet charge door, so a
// coding agent with zero config must build a mainnet payment against it. Set
// SUIZE_NETWORK=testnet (with SUIZE_API pointed at a self-hosted testnet
// instance) to override for self-hosters / CI.
export const NETWORK: SuiNetwork = resolveNetwork(env('SUIZE_NETWORK') || env('SUI_NETWORK') || 'mainnet')

/** The charge door. api.suize.site serves mainnet; SUIZE_API overrides for a
 * self-hosted / testnet instance. */
export const API_URL: string = (env('SUIZE_API') || 'https://api.suize.site').replace(/\/+$/, '')

export const GRAPHQL_URL: string = env('SUIZE_GRAPHQL') || graphqlUrl(NETWORK)

/** The deploy_sui id block for this network (SiteCreated event type, Site type). */
export const DEPLOY = packageIds(NETWORK).DEPLOY

/** The settlement coin type (native USDC) for this network. */
export const USDC_TYPE: string = USDC_TYPES[NETWORK]

export const SUI_ADDRESS_RE = /^0x[0-9a-fA-F]{64}$/

// ── the signer (the key never enters this process) ───────────────────────────

/** What deploy.ts needs to pay: the on-chain address (owner of every site it
 * deploys) and a way to sign the gasless payment transaction. Two impls:
 * an in-process keypair (SUIZE_KEY*) or the Sui CLI as an external signer. */
export interface Signer {
  address(): string
  signTransaction(bytes: Uint8Array): Promise<{ signature: string }>
}

const cliAlias = (): string => env('SUIZE_CLI_ALIAS') || 'suize'
const suiBin = (): string => env('SUIZE_SUI_BIN') || 'sui'

/** Child env for the Sui CLI: pass SUIZE_SUI_CONFIG_DIR through as SUI_CONFIG_DIR. */
const cliEnv = (): NodeJS.ProcessEnv => {
  const dir = env('SUIZE_SUI_CONFIG_DIR')
  return dir ? { ...process.env, SUI_CONFIG_DIR: dir } : process.env
}

/** Pure: find an alias in `sui keytool list --json` output. Exported for tests. */
export const findCliAlias = (
  listingJson: string,
  alias: string,
): { suiAddress: string; keyScheme: string } | null => {
  const listing = JSON.parse(listingJson) as Array<{ alias?: unknown; suiAddress?: unknown; keyScheme?: unknown }>
  const m = Array.isArray(listing) ? listing.find(k => k?.alias === alias) : undefined
  return m && typeof m.suiAddress === 'string'
    ? { suiAddress: m.suiAddress, keyScheme: String(m.keyScheme ?? '') }
    : null
}

/** Build the external Sui-CLI signer, or null when the alias isn't present in
 * the keystore (the caller falls through to the setup guidance). Throws when the
 * `sui` binary is missing or the alias is a non-ed25519 scheme. Never handles
 * key material — only the public address flows through here. */
const cliSigner = (): Signer | null => {
  const alias = cliAlias()
  const bin = suiBin()

  const listed = spawnSync(bin, ['keytool', 'list', '--json'], { encoding: 'utf8', env: cliEnv() })
  if (listed.error) {
    if ((listed.error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(
        `The Sui CLI (\`${bin}\`) was not found. Install it (https://docs.sui.io/references/cli) so Suize can ` +
          'sign with your CLI-held key, or set SUIZE_KEY_FILE to a file holding a suiprivkey1… key. If the ' +
          'binary lives outside PATH, point SUIZE_SUI_BIN at it.',
      )
    }
    throw new Error(`Could not run the Sui CLI (\`${bin}\`): ${listed.error.message}`)
  }
  if (listed.status !== 0) {
    // Never surface the CLI's stderr verbatim — keep any keystore detail out of the message.
    throw new Error(`\`${bin} keytool list\` failed (exit ${listed.status}). Check your Sui CLI configuration.`)
  }

  let key: { suiAddress: string; keyScheme: string } | null
  try {
    key = findCliAlias(listed.stdout, alias)
  } catch {
    throw new Error('Could not parse the Sui CLI key listing (`sui keytool list --json`).')
  }
  if (!key) return null // alias not in the keystore → setup guidance

  if (key.keyScheme.toLowerCase() !== 'ed25519') {
    throw new Error(
      `The Sui CLI alias "${alias}" is a ${key.keyScheme || 'non-ed25519'} key, but Suize signs with ed25519 ` +
        `only. Create a dedicated one with \`sui client new-address ed25519 ${alias}\`, point SUIZE_CLI_ALIAS ` +
        'at an ed25519 alias, or set SUIZE_KEY_FILE to a file holding a suiprivkey1… key.',
    )
  }

  const addr = key.suiAddress
  return {
    address: () => addr,
    // Sign the gasless payment via the CLI. The tx bytes are public payment data
    // (passed as argv), never key material; the CLI's default intent is the
    // transaction intent {scope:0,version:0,app_id:0}, so its suiSignature
    // (flag||sig||pubkey base64) is exactly what x402 payload.signature carries.
    signTransaction: async bytes => {
      const data = toBase64(bytes)
      let stdout: string
      try {
        const out = await execFileAsync(
          bin,
          ['keytool', 'sign', '--address', addr, '--data', data, '--json'],
          { env: cliEnv(), maxBuffer: 1 << 20 },
        )
        stdout = out.stdout
      } catch (e) {
        // Strip the child's stderr entirely — surface only a scrubbed message.
        throw new Error(`The Sui CLI failed to sign the payment (\`${bin} keytool sign\`, exit ${(e as { code?: unknown }).code ?? '?'}).`)
      }
      let parsed: { suiSignature?: unknown }
      try {
        parsed = JSON.parse(stdout)
      } catch {
        throw new Error('Could not parse the Sui CLI signature output.')
      }
      if (typeof parsed.suiSignature !== 'string' || !parsed.suiSignature) {
        throw new Error('The Sui CLI returned no signature.')
      }
      return { signature: parsed.suiSignature }
    },
  }
}

let _signer: Signer | null = null

/** The signer. Resolution order: SUIZE_KEY → SUIZE_KEY_FILE (in-process) → the
 * Sui CLI external signer (zero-config). Throws a clear, actionable error when
 * nothing resolves (the assistant relays it to the user). */
export const signer = (): Signer => {
  if (_signer) return _signer

  // 1) SUIZE_KEY  2) SUIZE_KEY_FILE — an explicitly configured key signs in-process.
  const inline = env('SUIZE_KEY')
  const fromFile = env('SUIZE_KEY_FILE') ? readFileSync(env('SUIZE_KEY_FILE'), 'utf8').trim() : ''
  const raw = inline || fromFile
  if (raw) {
    let kp: Ed25519Keypair
    try {
      kp = Ed25519Keypair.fromSecretKey(raw)
    } catch (e) {
      throw new Error(
        `The key from SUIZE_KEY/SUIZE_KEY_FILE is not a valid Sui secret key (expected suiprivkey1…): ${(e as Error).message}`,
      )
    }
    _signer = { address: () => kp.toSuiAddress(), signTransaction: b => kp.signTransaction(b) }
    return _signer
  }

  // 3) the Sui CLI external signer (default: alias "suize").
  const cli = cliSigner()
  if (cli) {
    _signer = cli
    return _signer
  }

  // 4) nothing found → one actionable setup message (no key material, ever).
  const fundingHint =
    NETWORK === 'mainnet'
      ? 'Fund that address with real USDC on Sui mainnet.'
      : 'Fund that address with USDC on Sui testnet (get some at https://faucet.circle.com, pick Sui testnet).'
  throw new Error(
    `No signing key found. Suize signs each deploy with a key the Sui CLI keeps on your machine — Suize only ` +
      `asks it to sign. Create a dedicated key with \`sui client new-address ed25519 ${cliAlias()}\` and the ` +
      `MCP uses it automatically. ${fundingHint} The rail is gasless, so you need NO SUI, only USDC. ` +
      'Alternatively set SUIZE_KEY_FILE to a file holding a suiprivkey1… key.',
  )
}

/** The signer's Sui address — also the on-chain owner of everything it deploys. */
export const address = (): string => signer().address()

/** Reserved scratch dir (~/.suize). */
export const HOME_DIR = join(homedir(), '.suize')
