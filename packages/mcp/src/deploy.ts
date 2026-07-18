// The Suize deploy tools — publish a static site to Walrus by paying the live
// charge door with the LOCAL key. Each tool: read chain / build a payment, sign
// LOCALLY, POST to api.suize.site. The key never leaves the machine; the site's
// on-chain owner is the local key's address (whoever pays, owns).
//
// The deploy/extend flow mirrors the worker's own golden-path (answer the 402,
// build the gasless payment from ITS declared outputs, retry with X-PAYMENT) —
// there is no Suize-specific wire, just x402.

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, join, relative } from 'node:path'
import { createTar } from 'nanotar'
import { fromBase64 } from '@mysten/sui/utils'
import { grpcClient, buildGaslessOutputs, formatUsdc } from '@suize/x402'
import { caip2, maxDeployMonths, deployPriceUsdc, DOMAIN_PRICE_PER_YEAR_USDC } from '@suize/shared'
import { API_URL, GRAPHQL_URL, NETWORK, DEPLOY, USDC_TYPE, SUI_ADDRESS_RE, address, signer } from './config'

export interface DeployArgs {
  dir?: string
  name?: string
  months?: number
  private?: boolean
}
export interface ExtendArgs {
  siteId?: string
  months?: number
}
export interface SiteIdArgs {
  siteId?: string
}

// ── site → tar (walk a directory into an in-memory tar) ──────────────────────

const IGNORE = new Set(['node_modules', '.git', '.DS_Store', '.wrangler', 'dist-ssr'])

const walk = (root: string, dir: string, out: { name: string; data: Uint8Array }[]): void => {
  for (const entry of readdirSync(dir)) {
    if (IGNORE.has(entry)) continue
    const full = join(dir, entry)
    const st = statSync(full)
    if (st.isDirectory()) walk(root, full, out)
    else if (st.isFile()) out.push({ name: relative(root, full), data: new Uint8Array(readFileSync(full)) })
  }
}

const tarOf = (dir: string): { tar: Uint8Array; fileCount: number } => {
  let st
  try {
    st = statSync(dir)
  } catch {
    throw new Error(`No such directory: ${dir}`)
  }
  if (!st.isDirectory()) throw new Error(`Not a directory: ${dir} (point it at your built site folder, e.g. ./dist)`)
  const files: { name: string; data: Uint8Array }[] = []
  walk(dir, dir, files)
  if (files.length === 0) throw new Error(`No files found under ${dir}`)
  return { tar: createTar(files), fileCount: files.length }
}

// ── pay a 402 challenge with the local key → the X-PAYMENT header ─────────────

interface Output {
  to: string
  amount: string
}
interface Accepted {
  asset: string
  amount: string
  extra?: { outputs?: Output[] }
}
interface Challenge {
  accepts?: Accepted[]
  error?: string
}

/**
 * NUMBER WALL guard — the load-bearing money safety on the MCP deploy path. The
 * local key signs BLIND (a CLI/env keypair, no balance-change UI, no human
 * confirm), and the charge door is an env override (SUIZE_API), so a hostile or
 * MITM'd api.suize.site could otherwise quote outputs paying ANY amount to ANY
 * address and we'd sign a bearer X-PAYMENT the attacker submits — draining the
 * key's whole USDC balance. So we NEVER trust the server's number: `expectedAtomic`
 * is derived LOCALLY from @suize/shared (the same fn the worker charges with) from
 * known request params, and the quote must match it EXACTLY before we build/sign.
 * Mirrors the browser guard (apps/suize/src/deploy/pay.ts). Pure + exported for tests.
 */
export const assertQuote = (challenge: Challenge, expectedAtomic: bigint): { accepted: Accepted; outputs: Output[] } => {
  const accepted = challenge.accepts?.[0]
  const outputs = accepted?.extra?.outputs
  if (!accepted || !outputs) {
    throw new Error(`the charge door did not return payment terms${challenge.error ? `: ${challenge.error}` : ''}`)
  }
  // The settlement coin must be the network's native USDC — never a substituted
  // coin type (100000 base units of some other coin could be worth far more).
  if (accepted.asset !== USDC_TYPE) {
    throw new Error(`refusing to sign: the charge door quoted settlement asset ${accepted.asset}, expected ${USDC_TYPE}.`)
  }
  // Both the declared outputs total AND the top-line amount must EQUAL the
  // locally-derived price. A mispriced or tampered 402 fails fast HERE, before
  // the blind signer is ever asked.
  const total = outputs.reduce((sum, o) => sum + BigInt(o.amount), 0n)
  if (total !== expectedAtomic || BigInt(accepted.amount) !== expectedAtomic) {
    throw new Error(
      `refusing to sign — price mismatch: the charge door quoted $${formatUsdc(BigInt(accepted.amount))} ` +
        `(outputs total $${formatUsdc(total)}) but the expected price is $${formatUsdc(expectedAtomic)}.`,
    )
  }
  return { accepted, outputs }
}

/** Assemble the base64 X-PAYMENT header from validated terms + a signature. Pure
 * (no network/key) so the header shape is testable without signing. */
export const encodeHeader = (accepted: Accepted, signature: string, transaction: string): string =>
  btoa(JSON.stringify({ x402Version: 2, accepted, payload: { signature, transaction } }))

const payChallenge = async (challenge: Challenge, expectedAtomic: bigint): Promise<string> => {
  const { accepted, outputs } = assertQuote(challenge, expectedAtomic)
  const client = grpcClient(caip2(NETWORK))
  const { bytes } = await buildGaslessOutputs({ client, sender: address(), asset: accepted.asset, outputs })
  const { signature } = await signer().signTransaction(fromBase64(bytes))
  return encodeHeader(accepted, signature, bytes)
}

const asJson = async (res: Response): Promise<Record<string, unknown>> => {
  try {
    return (await res.json()) as Record<string, unknown>
  } catch {
    return { error: `non-JSON response (HTTP ${res.status})` }
  }
}

// ── paid-POST retry (idempotent by payment digest) ───────────────────────────
// After signing, the charge door can answer a non-200 that is NOT "unpaid" but a
// TRANSIENT post-payment failure: a settle/broadcast timeout whose tx may have
// LANDED on-chain, or a worker 5xx. Re-sending the SAME X-PAYMENT header is safe —
// /settle is idempotent by payment digest and the deploy worker recovers a minted
// site by that digest, so a landed payment produces its work and never charges
// twice. We NEVER rebuild or re-sign a payment here.
const POST_RETRIES = 2
const POST_RETRY_MS = 3000
const RETRYABLE_PAID_ERR = /broadcast failed|timeout|timed out|chain read failed|settlement failed|facilitator/i

/** A worker 5xx, or a 402 whose error is a settle/broadcast transient (never a plain
 * unpaid challenge or a terms mismatch — those are terminal for the same header). */
const isRetryablePaidFailure = (status: number, body: Record<string, unknown>): boolean =>
  status >= 500 || (status === 402 && RETRYABLE_PAID_ERR.test(String(body.error ?? '')))

/** Send a signed, paid request; on a transient post-payment failure re-send the
 * IDENTICAL request (same X-PAYMENT) up to `retries` more times, `delayMs` apart.
 * Exported with an injectable delay so tests stay fast. */
export const postPaid = async (
  send: () => Promise<Response>,
  delayMs = POST_RETRY_MS,
  retries = POST_RETRIES,
): Promise<{ res: Response; body: Record<string, unknown> }> => {
  for (let attempt = 0; ; attempt++) {
    const res = await send()
    const body = await asJson(res)
    if (res.status === 200 || attempt >= retries || !isRetryablePaidFailure(res.status, body)) {
      return { res, body }
    }
    await new Promise((r) => setTimeout(r, delayMs))
  }
}

// ── deploy_site ──────────────────────────────────────────────────────────────

export const deploySite = async (args: DeployArgs): Promise<string> => {
  const dir = (args.dir ?? '').trim()
  if (!dir) throw new Error('Pass { dir } — the path to your built static site folder (e.g. "./dist").')
  const max = maxDeployMonths(NETWORK)
  const months = Number.isInteger(args.months) ? (args.months as number) : 1
  if (months < 1 || months > max) throw new Error(`months must be a whole number from 1 to ${max} (the most hosting one payment can fund).`)
  const priv = args.private === true
  const { tar, fileCount } = tarOf(dir)
  const name = (args.name ?? (basename(dir) || 'site')).slice(0, 64)
  const query = `months=${months}&sealed=${priv ? 1 : 0}`

  // 1. discover the price (402).
  const disc = await fetch(`${API_URL}/deploy?${query}`, { method: 'POST' })
  const challenge = (await asJson(disc)) as Challenge
  if (disc.status !== 402) throw new Error(`unexpected charge-door response (${disc.status}): ${challenge.error ?? ''}`)
  const priceUsdc = formatUsdc(BigInt(challenge.accepts?.[0]?.amount ?? '0'))

  // 2. pay it locally + submit the bundle. The price is derived LOCALLY from the
  //    request params (months + private flag the user passed) — never the server's.
  const header = await payChallenge(challenge, BigInt(deployPriceUsdc(months, priv)))
  const form = new FormData()
  form.append('name', name)
  form.append('site.tar', new Blob([tar as unknown as ArrayBuffer]), 'site.tar')
  const { res, body } = await postPaid(() =>
    fetch(`${API_URL}/deploy?${query}`, { method: 'POST', headers: { 'X-PAYMENT': header }, body: form }),
  )
  if (res.status !== 200) {
    throw new Error(
      `deploy failed (${res.status}): ${body.error ?? JSON.stringify(body).slice(0, 200)}. ` +
        `the payment may have already settled; re-run deploy_site with the same inputs to finish safely ` +
        `(the rail is idempotent by payment digest and will not charge twice).`,
    )
  }

  const paidUntil = typeof body.paidUntilMs === 'number' ? new Date(body.paidUntilMs).toDateString() : 'unknown'
  const lines = [
    `Deployed "${name}" (${fileCount} files) for $${priceUsdc} — paid ${months} month${months === 1 ? '' : 's'}.`,
    `  URL:     ${body.url}`,
    `  Site ID: ${body.siteId}`,
    `  Owner:   ${address()} (you — whoever pays, owns)`,
    `  Paid through: ${paidUntil}`,
  ]
  if (priv) {
    lines.push(
      `  Private (Seal-encrypted): only wallets you add to its viewer list can open it.`,
      `  Allowlist: ${body.allowlistId ?? '(see the site dashboard)'}`,
    )
  }
  lines.push(`  Extend anytime: extend_site with this Site ID.`)
  return lines.join('\n')
}

// ── extend_site ────────────────────────────────────────────────────────────────

export const extendSite = async (args: ExtendArgs): Promise<string> => {
  const siteId = (args.siteId ?? '').trim()
  if (!SUI_ADDRESS_RE.test(siteId)) throw new Error('Pass { siteId } — the 0x… id from deploy_site or list_sites.')
  const max = maxDeployMonths(NETWORK)
  const months = Number.isInteger(args.months) ? (args.months as number) : 1
  if (months < 1 || months > max) throw new Error(`months must be a whole number from 1 to ${max}.`)

  // The extend price depends on the site's on-chain `sealed` bit (sealed = 2x,
  // exactly what the worker charges). Read it from CHAIN so the local price guard
  // is independent of the (env-overridable) charge door.
  const sealed = (await readSiteJson(siteId)).sealed === true

  const disc = await fetch(`${API_URL}/extend?site=${siteId}&months=${months}`, { method: 'POST' })
  const challenge = (await asJson(disc)) as Challenge
  if (disc.status === 404) throw new Error('site not found (check the Site ID).')
  if (disc.status !== 402) throw new Error(`unexpected charge-door response (${disc.status}): ${challenge.error ?? ''}`)
  const priceUsdc = formatUsdc(BigInt(challenge.accepts?.[0]?.amount ?? '0'))

  const header = await payChallenge(challenge, BigInt(deployPriceUsdc(months, sealed)))
  const { res, body } = await postPaid(() =>
    fetch(`${API_URL}/extend?site=${siteId}&months=${months}`, { method: 'POST', headers: { 'X-PAYMENT': header } }),
  )
  if (res.status !== 200) {
    throw new Error(
      `extend failed (${res.status}): ${body.error ?? JSON.stringify(body).slice(0, 200)}. ` +
        `the payment may have already settled; re-run extend_site with the same inputs to finish safely ` +
        `(the rail is idempotent by payment digest and will not charge twice).`,
    )
  }
  const paidUntil = typeof body.paidUntilMs === 'number' ? new Date(body.paidUntilMs).toDateString() : 'unknown'
  return `Extended ${siteId} by ${months} month${months === 1 ? '' : 's'} for $${priceUsdc}. Paid through: ${paidUntil}.`
}

// ── list_sites (chain-derived by the local key's address) ────────────────────

interface SiteRow {
  siteId: string
  name: string
  createdAtMs: number
  sealed: boolean
}

const EVENTS_QUERY = `query($type: String!, $before: String) {
  events(last: 50, before: $before, filter: { type: $type }) {
    pageInfo { hasPreviousPage startCursor }
    nodes { timestamp contents { json } }
  }
}`

const graphql = async <T>(query: string, variables: Record<string, unknown>): Promise<T> => {
  const res = await fetch(GRAPHQL_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  })
  if (!res.ok) throw new Error(`Sui GraphQL HTTP ${res.status}`)
  const body = (await res.json()) as { data?: T; errors?: { message?: string }[] }
  if (body.errors?.length) throw new Error(`Sui GraphQL error: ${body.errors[0]?.message ?? 'query error'}`)
  return body.data as T
}

interface EventsData {
  events?: {
    pageInfo?: { hasPreviousPage?: boolean; startCursor?: string | null }
    nodes?: { timestamp?: string | null; contents?: { json?: Record<string, unknown> | null } | null }[]
  } | null
}

const sitesForOwner = async (owner: string, maxPages = 8): Promise<SiteRow[]> => {
  if (DEPLOY.PACKAGE === '0x0') return []
  const ownerLc = owner.toLowerCase()
  const type = `${DEPLOY.PACKAGE}::site::SiteCreated`
  const rows = new Map<string, SiteRow>()
  let before: string | null = null
  for (let page = 0; page < maxPages; page++) {
    const data: EventsData = await graphql<EventsData>(EVENTS_QUERY, { type, before })
    const conn = data.events
    for (const n of conn?.nodes ?? []) {
      const j = (n.contents?.json ?? {}) as { site_id?: string; owner?: string; name?: string; sealed?: boolean }
      if (!j.site_id || String(j.owner ?? '').toLowerCase() !== ownerLc) continue
      if (!rows.has(j.site_id)) {
        rows.set(j.site_id, {
          siteId: j.site_id,
          name: j.name ?? '',
          createdAtMs: n.timestamp ? Date.parse(n.timestamp) : 0,
          sealed: j.sealed === true,
        })
      }
    }
    if (!conn?.pageInfo?.hasPreviousPage || !conn.pageInfo.startCursor) break
    before = conn.pageInfo.startCursor
  }
  return [...rows.values()].sort((a, b) => b.createdAtMs - a.createdAtMs)
}

export const listSites = async (): Promise<string> => {
  const owner = address()
  const sites = await sitesForOwner(owner)
  if (sites.length === 0) return `No sites deployed yet by ${owner}. Use deploy_site to publish one.`
  const lines = sites.map(
    (s) =>
      `• ${s.name || '(unnamed)'}${s.sealed ? ' 🔒' : ''} — ${s.siteId}\n    https://${subdomainOf(s.siteId)}.suize.site` +
      (s.createdAtMs ? `  ·  deployed ${new Date(s.createdAtMs).toDateString()}` : ''),
  )
  return `${sites.length} site${sites.length === 1 ? '' : 's'} owned by ${owner}:\n${lines.join('\n')}`
}

// ── site read (one home for the on-chain Site object) ────────────────────────

interface SiteJson {
  owner?: string
  name?: string
  sealed?: boolean
  paid_until_ms?: string | number
  size_bytes?: string | number
  file_count?: string | number
}

/** Read a live Site object's fields from chain (throws a clear 'site not found'
 * when the id isn't a Site of the current deploy package). `site_status` renders
 * it; `extend_site` prices from its `sealed` bit (the price guard must derive
 * from chain truth, not the env-overridable charge door). */
const readSiteJson = async (siteId: string): Promise<SiteJson> => {
  const type = `${DEPLOY.PACKAGE}::site::Site`
  const data = await graphql<{
    object?: { asMoveObject?: { contents?: { type?: { repr?: string } | null; json?: Record<string, unknown> } | null } | null } | null
  }>(`query($id: SuiAddress!) { object(address: $id) { asMoveObject { contents { type { repr } json } } } }`, { id: siteId })
  const c = data.object?.asMoveObject?.contents
  if (!c?.json || c.type?.repr !== type) throw new Error('site not found (check the Site ID).')
  return c.json as SiteJson
}

// ── site_status ────────────────────────────────────────────────────────────────

export const siteStatus = async (args: SiteIdArgs): Promise<string> => {
  const siteId = (args.siteId ?? '').trim()
  if (!SUI_ADDRESS_RE.test(siteId)) throw new Error('Pass { siteId } — the 0x… id from deploy_site or list_sites.')
  const f = await readSiteJson(siteId)
  const paidUntil = Number(f.paid_until_ms ?? 0)
  const now = Date.now()
  const status = paidUntil > now ? `active until ${new Date(paidUntil).toDateString()}` : paidUntil > 0 ? `LAPSED (was paid through ${new Date(paidUntil).toDateString()} — extend to restore)` : 'unknown'
  return [
    `${f.name || '(unnamed)'}${f.sealed ? ' 🔒 private' : ''}`,
    `  URL:    https://${subdomainOf(siteId)}.suize.site`,
    `  Owner:  ${f.owner ?? 'unknown'}`,
    `  Size:   ${f.file_count ?? '?'} files, ${f.size_bytes ?? '?'} bytes`,
    `  Hosting: ${status}`,
  ].join('\n')
}

// ── base36 subdomain codec (byte-identical to the worker's util.ts) ──────────

const BASE36_WIDTH = 50
const subdomainOf = (siteId: string): string => {
  const hex = siteId.startsWith('0x') ? siteId.slice(2) : siteId
  return BigInt('0x' + hex).toString(36).padStart(BASE36_WIDTH, '0')
}

// ── custom domains: link_domain + domain_status ──────────────────────────────
// Thin client over the worker's POST /domains contract:
//   POST /domains?verify=1 {siteId, domain} → 200 pending (DNS records to set)
//   | 200 linked (idempotent) | 402 once DNS is green → pay → linked.
// Verifies and re-checks are FREE; only a green-DNS unlinked domain mints a 402.

export interface DomainArgs {
  siteId?: string
  domain?: string
}

const DOMAIN_RE = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/

interface DomainProbe {
  status?: string
  txtName?: string
  txtValue?: string
  cname?: string
  txtOk?: boolean
  cnameOk?: boolean
  detail?: string
  sslStatus?: string
  digest?: string
  instructions?: string
  error?: string
}

const domainArgs = (args: DomainArgs): { siteId: string; domain: string } => {
  const siteId = (args.siteId ?? '').trim()
  const domain = (args.domain ?? '').trim().toLowerCase()
  if (!SUI_ADDRESS_RE.test(siteId)) {
    throw new Error('Pass { siteId } — the 0x… id of the site to link (from deploy_site or list_sites).')
  }
  if (!DOMAIN_RE.test(domain)) throw new Error('Pass { domain } — the custom domain, e.g. "docs.example.com".')
  return { siteId, domain }
}

const domainsPost = (siteId: string, domain: string, verify: boolean, header?: string): Promise<Response> =>
  fetch(`${API_URL}/domains${verify ? '?verify=1' : ''}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(header ? { 'X-PAYMENT': header } : {}) },
    body: JSON.stringify({ siteId, domain }),
  })

const recordsBlock = (domain: string, p: DomainProbe): string =>
  [
    'Set these DNS records at your provider, then run the same tool again (re-checks are free):',
    `  TXT    ${p.txtName}  =  ${p.txtValue}${p.txtOk === false ? '   (not visible yet)' : p.txtOk ? '   (ok)' : ''}`,
    `  CNAME  ${domain}  ->  ${p.cname}${p.cnameOk === false ? '   (not visible yet)' : p.cnameOk ? '   (ok)' : ''}`,
    '  (zone apex: flattened A records pointing at the CNAME target are accepted)',
  ].join('\n')

/** FREE pre-charge guard: what site does the on-chain registry already hold for
 * this domain? Stops link_domain from paying a year of service into an
 * EDomainTaken abort when the domain belongs to someone else's site.
 * Best-effort: any read fault returns null and the server-side gates still
 * protect the flow (mainnet-only; the fallback RPC host is a mainnet node). */
const registryHolder = async (domain: string): Promise<string | null> => {
  if (NETWORK !== 'mainnet') return null
  try {
    const registry = DEPLOY.DOMAIN_REGISTRY_OBJECT
    if (!registry || registry === '0x0') return null
    const gq = await fetch(GRAPHQL_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: 'query($id: SuiAddress!) { object(address: $id) { asMoveObject { contents { json } } } }',
        variables: { id: registry },
      }),
      signal: AbortSignal.timeout(5000),
    })
    const json = (await gq.json()) as {
      data?: { object?: { asMoveObject?: { contents?: { json?: { domains?: { id?: string } } } | null } | null } | null }
    }
    const table = json.data?.object?.asMoveObject?.contents?.json?.domains?.id
    if (typeof table !== 'string') return null
    const rpc = await fetch('https://sui-rpc.publicnode.com', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'suix_getDynamicFieldObject',
        params: [table, { type: '0x1::string::String', value: domain }],
      }),
      signal: AbortSignal.timeout(5000),
    })
    const value = ((await rpc.json()) as { result?: { data?: { content?: { fields?: { value?: unknown } } | null } | null } })
      .result?.data?.content?.fields?.value
    return typeof value === 'string' && value.startsWith('0x') ? value : null
  } catch {
    return null
  }
}

export const linkDomain = async (args: DomainArgs): Promise<string> => {
  const { siteId, domain } = domainArgs(args)
  const yearly = BigInt(DOMAIN_PRICE_PER_YEAR_USDC)

  // 0. free on-chain guard — never pay into a domain someone else holds, and
  //    short-circuit a domain this site already owns (repointed domains keep
  //    serving even after the original TXT record is gone).
  const holder = await registryHolder(domain)
  if (holder === siteId) {
    return `${domain} is already linked on-chain to ${siteId} — https://${domain}. No charge.`
  }
  if (holder) {
    throw new Error(
      `${domain} is already linked on-chain to site ${holder} — not charging. ` +
        'If that site is yours, repoint or unlink it from the suize.io dashboard first.',
    )
  }

  // 1. free verify probe: DNS state, idempotent-linked, or a 402 once green.
  const probe = await domainsPost(siteId, domain, true)
  const body = (await asJson(probe)) as DomainProbe & Challenge

  if (probe.status === 200 && body.status === 'linked') {
    return `${domain} is already linked to ${siteId} — https://${domain} (SSL: ${body.sslStatus ?? 'active'}). No charge.`
  }
  if (probe.status === 200 && body.status === 'pending') {
    return [
      `Domain link for ${domain} is waiting on DNS.`,
      recordsBlock(domain, body),
      `The $${formatUsdc(yearly)}/year charge happens only after both records verify.`,
    ].join('\n')
  }
  if (probe.status !== 402) {
    throw new Error(`domain link failed (${probe.status}): ${body.error ?? JSON.stringify(body).slice(0, 200)}`)
  }

  // 2. DNS green → pay the op-bound quote (guard: exactly the shared yearly price).
  const header = await payChallenge(body, yearly)
  const { res, body: out } = await postPaid(() => domainsPost(siteId, domain, true, header))
  const linked = out as DomainProbe
  if (res.status !== 200) {
    throw new Error(
      `domain link failed (${res.status}): ${linked.error ?? JSON.stringify(out).slice(0, 200)}. ` +
        'If the payment settled, re-run link_domain with the same inputs — the flow is idempotent by payment digest and will not charge twice.',
    )
  }
  return [
    `Linked ${domain} -> ${siteId} for $${formatUsdc(yearly)} (one year of custom-domain service).`,
    `  URL:    https://${domain}`,
    linked.digest ? `  Digest: ${linked.digest}` : '',
    `  SSL:    ${linked.sslStatus ?? 'provisioning'}${linked.instructions ? `\n  ${linked.instructions}` : ''}`,
  ]
    .filter(Boolean)
    .join('\n')
}

export const domainStatus = async (args: DomainArgs): Promise<string> => {
  const { siteId, domain } = domainArgs(args)
  // The on-chain registry is the truth for LINKED (DNS probes can lag or carry a
  // stale site-bound TXT after a repoint); the DNS probe covers the pending states.
  const holder = await registryHolder(domain)
  if (holder === siteId) return `${domain} is LINKED on-chain to ${siteId} — https://${domain}.`
  if (holder) return `${domain} is linked on-chain to a DIFFERENT site: ${holder}.`
  const probe = await domainsPost(siteId, domain, true) // free: no payment is ever attached
  const body = (await asJson(probe)) as DomainProbe
  if (probe.status === 402) {
    return [
      `DNS for ${domain} is verified, the domain is NOT linked yet.`,
      `Linking costs $${formatUsdc(BigInt(DOMAIN_PRICE_PER_YEAR_USDC))} for one year: run link_domain { siteId, domain }.`,
    ].join('\n')
  }
  if (body.status === 'linked') return `${domain} is LINKED to ${siteId} — https://${domain} (SSL: ${body.sslStatus ?? 'active'}).`
  if (body.status === 'pending') {
    return [`${domain} is NOT linked yet; DNS records incomplete.`, recordsBlock(domain, body)].join('\n')
  }
  throw new Error(`domain status failed (${probe.status}): ${body.error ?? JSON.stringify(body).slice(0, 200)}`)
}
