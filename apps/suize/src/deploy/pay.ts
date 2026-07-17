// =============================================================================
// The browser deploy/extend flow — answer the worker's 402, build the gasless
// x402 payment from ITS declared outputs, sign LOCALLY (connected wallet, or a
// dev keypair for the E2E), retry with X-PAYMENT. Byte-for-byte the same rail
// the MCP walks (packages/mcp/src/deploy.ts); the ONLY difference is the signer.
//
// The signer NEVER re-declares amounts: the payment is built from the outputs
// the worker itself returned in the 402, so a wallet can't be tricked into
// crediting anything the merchant didn't ask for (the facilitator re-checks the
// split at verify anyway). The wallet's returned bytes are what we submit, so a
// wallet that re-serializes is honoured — and if it re-gasses, the facilitator's
// gasless guard rejects it cleanly (a 402, never a silent bad charge).
// =============================================================================

import { grpcClient, buildGaslessOutputs, formatUsdc } from '@suize/x402'
import {
  caip2,
  buildDeployUnlinkAuthMessage,
  buildDeployRepointAuthMessage,
  DEPLOY_PRICE_PER_MONTH_USDC,
  DEPLOY_SEALED_MULTIPLIER,
  DOMAIN_PRICE_PER_YEAR_USDC,
} from '@suize/shared'
import { DEPLOY_API, NETWORK } from '../config'

/** The expected price in atomic USDC — the SAME formula the worker charges
 * (@suize/shared constants). One home for the fact; the button and the signing
 * guard both read it. */
export const deployPriceAtomic = (months: number, sealed: boolean): bigint =>
  BigInt(DEPLOY_PRICE_PER_MONTH_USDC) * BigInt(months) * BigInt(sealed ? DEPLOY_SEALED_MULTIPLIER : 1)

/** A pluggable signer: given the unsigned gasless bytes, return the signed bytes
 * (possibly wallet-reserialized) + the signature. Prod = the connected wallet;
 * dev/E2E = a throwaway keypair (see mkKeypairSigner / mkWalletSigner). */
export interface PaySigner {
  address: string
  sign: (unsignedBytesB64: string) => Promise<{ bytes: string; signature: string }>
  /** Personal-message signature (serialized, base64) over the exact bytes — the
   * free owner-signed ops (domain unlink) recover the owner from THIS, there is
   * no payment to recover an identity from. */
  signMessage: (message: Uint8Array) => Promise<string>
}

interface Accepted {
  asset: string
  amount: string
  extra?: { outputs?: { to: string; amount: string }[] }
}
interface Challenge {
  accepts?: Accepted[]
  error?: string
}

export interface DeployResult {
  siteId: string
  url: string
  owner: string
  paidUntilMs: number
  digest: string
  allowlistId?: string
  priceUsdc: string
}

export type Stage = 'quoting' | 'building' | 'signing' | 'publishing'

const asJson = async (res: Response): Promise<Record<string, unknown>> => {
  try {
    return (await res.json()) as Record<string, unknown>
  } catch {
    return { error: `non-JSON response (HTTP ${res.status})` }
  }
}

// ── paid-POST retry (idempotent by payment digest) ───────────────────────────
// A paid POST can answer a non-200 that is NOT "unpaid" but a TRANSIENT post-payment
// failure: a settle/broadcast timeout whose tx may have LANDED, or a worker 5xx.
// Re-sending the SAME X-PAYMENT header is safe — /settle is idempotent by payment
// digest and the worker recovers a minted site by that digest, so a landed payment
// produces its work and never charges twice. We NEVER rebuild or re-sign here.
const POST_RETRIES = 2
const POST_RETRY_MS = 3000
const RETRYABLE_PAID_ERR = /broadcast failed|timeout|timed out|chain read failed|settlement failed|facilitator/i

/** A worker 5xx, or a 402 whose error is a settle/broadcast transient (never a plain
 * unpaid challenge or a terms mismatch — those are terminal for the same header). */
const isRetryablePaidFailure = (status: number, body: Record<string, unknown>): boolean =>
  status >= 500 || (status === 402 && RETRYABLE_PAID_ERR.test(String(body.error ?? '')))

/** Send a signed, paid request; on a transient post-payment failure re-send the
 * IDENTICAL request (same X-PAYMENT) up to POST_RETRIES more times. Re-emits the
 * 'publishing' stage on each retry (reusing the existing stage machinery). */
const postPaid = async (
  send: () => Promise<Response>,
  onStage?: (s: Stage) => void,
  delayMs = POST_RETRY_MS,
): Promise<{ res: Response; body: Record<string, unknown> }> => {
  for (let attempt = 0; ; attempt++) {
    const res = await send()
    const body = await asJson(res)
    if (res.status === 200 || attempt >= POST_RETRIES || !isRetryablePaidFailure(res.status, body)) {
      return { res, body }
    }
    await new Promise((r) => setTimeout(r, delayMs))
    onStage?.('publishing')
  }
}

/** Build + sign the gasless payment for a 402 challenge → the X-PAYMENT header.
 * Emits the truthful stages: 'building' around the PTB build, 'signing' from the
 * moment the wallet is actually asked until it returns. */
const payChallenge = async (
  challenge: Challenge,
  signer: PaySigner,
  expectedAtomic: bigint,
  onStage?: (s: Stage) => void,
): Promise<{ header: string; accepted: Accepted }> => {
  const accepted = challenge.accepts?.[0]
  const outputs = accepted?.extra?.outputs
  if (!accepted || !outputs) {
    throw new Error(`the charge door didn't return payment terms${challenge.error ? `: ${challenge.error}` : ''}`)
  }
  // NUMBER WALL guard: the terms we sign must equal the price we showed (both
  // derive from the same @suize/shared constants) — a mispriced or tampered 402
  // fails fast HERE, before any wallet prompt and before the DEV keypair signer
  // (which signs blind). Prod wallets additionally show balance changes.
  const total = outputs.reduce((sum, o) => sum + BigInt(o.amount), 0n)
  if (total !== expectedAtomic || BigInt(accepted.amount) !== expectedAtomic) {
    throw new Error(
      `price mismatch: the server quoted $${formatUsdc(BigInt(accepted.amount))} but the expected price is $${formatUsdc(expectedAtomic)}`,
    )
  }
  onStage?.('building')
  const client = grpcClient(caip2(NETWORK))
  const { bytes: unsigned } = await buildGaslessOutputs({ client, sender: signer.address, asset: accepted.asset, outputs })
  onStage?.('signing')
  const { bytes, signature } = await signer.sign(unsigned)
  const header = btoa(JSON.stringify({ x402Version: 2, accepted, payload: { signature, transaction: bytes } }))
  return { header, accepted }
}

const priceOf = (challenge: Challenge): string => formatUsdc(BigInt(challenge.accepts?.[0]?.amount ?? '0'))

// ── deploy ────────────────────────────────────────────────────────────────────

export async function deploy(opts: {
  signer: PaySigner
  tar: Uint8Array
  name: string
  months: number
  sealed: boolean
  onStage?: (s: Stage) => void
}): Promise<DeployResult> {
  const { signer, tar, name, months, sealed, onStage } = opts
  const query = `months=${months}&sealed=${sealed ? 1 : 0}`

  onStage?.('quoting')
  const disc = await fetch(`${DEPLOY_API}/deploy?${query}`, { method: 'POST' })
  const challenge = (await asJson(disc)) as Challenge
  if (disc.status !== 402) throw new Error(`couldn't get a price (HTTP ${disc.status})${challenge.error ? `: ${challenge.error}` : ''}`)
  const priceUsdc = priceOf(challenge)

  const { header } = await payChallenge(challenge, signer, deployPriceAtomic(months, sealed), onStage)

  const form = new FormData()
  form.append('name', name.slice(0, 64))
  form.append('site.tar', new Blob([tar as unknown as ArrayBuffer]), 'site.tar')

  onStage?.('publishing')
  const { res, body } = await postPaid(
    () => fetch(`${DEPLOY_API}/deploy?${query}`, { method: 'POST', headers: { 'X-PAYMENT': header }, body: form }),
    onStage,
  )
  if (res.status !== 200) throw new Error(`deploy failed (HTTP ${res.status})${body.error ? `: ${body.error}` : ''}`)

  return {
    siteId: String(body.siteId ?? ''),
    url: String(body.url ?? ''),
    owner: String(body.owner ?? signer.address),
    paidUntilMs: typeof body.paidUntilMs === 'number' ? body.paidUntilMs : 0,
    digest: String(body.digest ?? ''),
    allowlistId: typeof body.allowlistId === 'string' ? body.allowlistId : undefined,
    priceUsdc,
  }
}

// ── extend ──────────────────────────────────────────────────────────────────────

export async function extend(opts: {
  signer: PaySigner
  siteId: string
  months: number
  /** Sealed sites price at 2x on extend too (the on-chain billing bit). */
  sealed: boolean
  onStage?: (s: Stage) => void
}): Promise<{ paidUntilMs: number; priceUsdc: string; digest: string }> {
  const { signer, siteId, months, sealed, onStage } = opts

  onStage?.('quoting')
  const disc = await fetch(`${DEPLOY_API}/extend?site=${siteId}&months=${months}`, { method: 'POST' })
  const challenge = (await asJson(disc)) as Challenge
  if (disc.status === 404) throw new Error('site not found')
  if (disc.status !== 402) throw new Error(`couldn't get a price (HTTP ${disc.status})${challenge.error ? `: ${challenge.error}` : ''}`)
  const priceUsdc = priceOf(challenge)

  const { header } = await payChallenge(challenge, signer, deployPriceAtomic(months, sealed), onStage)

  onStage?.('publishing')
  const { res, body } = await postPaid(
    () => fetch(`${DEPLOY_API}/extend?site=${siteId}&months=${months}`, { method: 'POST', headers: { 'X-PAYMENT': header } }),
    onStage,
  )
  if (res.status !== 200) throw new Error(`extend failed (HTTP ${res.status})${body.error ? `: ${body.error}` : ''}`)
  return {
    paidUntilMs: typeof body.paidUntilMs === 'number' ? body.paidUntilMs : 0,
    priceUsdc,
    digest: String(body.digest ?? ''),
  }
}

// ── custom domains ──────────────────────────────────────────────────────────────
//
//   POST   /domains            {siteId, domain}  → the DNS challenge (free)
//   POST   /domains?verify=1   {siteId, domain}  → DNS checked (free) → 402 → pay → linked
//   DELETE /domains/<domain>   {ts, signature}   → owner-signed unlink (free)
//
// The worker prices a link at exactly ONE year (there is no month knob), so the
// NUMBER WALL expectation is the flat per-year constant.

/** The custom-domain price in atomic USDC: one year, the worker's only unit. */
export const domainPriceAtomic = (): bigint => BigInt(DOMAIN_PRICE_PER_YEAR_USDC)

/** The DNS records the worker challenges with (deterministic per site+domain). */
export interface DomainChallenge {
  domain: string
  txtName: string
  txtValue: string
  cname: string
}

/** A free verify probe: how the DNS looks from the worker's own resolver. */
export type DomainVerify =
  /** One or both records aren't visible yet. */
  | { status: 'pending'; txtOk: boolean; cnameOk: boolean; detail: string }
  /** DNS is green — the worker answered 402; paying links it. */
  | { status: 'ready' }
  /** Already linked to this site (idempotent — no second charge). */
  | { status: 'linked' }

export interface DomainLinked {
  status: 'linked'
  digest: string
  /** 'active' | 'pending' | 'manual' | 'error' — the auto-SSL provisioning state. */
  sslStatus?: string
  /** Present when sslStatus is 'manual'. */
  instructions?: string
}

export type DomainLinkOutcome = DomainLinked | { status: 'pending'; txtOk: boolean; cnameOk: boolean; detail: string }

const postDomains = (body: { siteId: string; domain: string }, verify: boolean, payment?: string): Promise<Response> =>
  fetch(`${DEPLOY_API}/domains${verify ? '?verify=1' : ''}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(payment ? { 'X-PAYMENT': payment } : {}) },
    body: JSON.stringify(body),
  })

const pendingOf = (body: Record<string, unknown>): { status: 'pending'; txtOk: boolean; cnameOk: boolean; detail: string } => ({
  status: 'pending',
  txtOk: body.txtOk === true,
  cnameOk: body.cnameOk === true,
  detail: String(body.detail ?? ''),
})

/** The free challenge: which TXT + CNAME to set for `domain` → `siteId`. */
export async function domainChallenge(siteId: string, domain: string): Promise<DomainChallenge> {
  const res = await postDomains({ siteId, domain }, false)
  const body = await asJson(res)
  if (res.status !== 200) {
    throw new Error(`couldn't get the DNS records (HTTP ${res.status})${body.error ? `: ${body.error}` : ''}`)
  }
  return {
    domain: String(body.domain ?? domain),
    txtName: String(body.txtName ?? ''),
    txtValue: String(body.txtValue ?? ''),
    cname: String(body.cname ?? ''),
  }
}

/** The free DNS check: a bare verify POST. The worker checks DNS FIRST and only
 * mints the 402 once both records are green — so a 402 here MEANS "verified". */
export async function verifyDomain(siteId: string, domain: string): Promise<DomainVerify> {
  const res = await postDomains({ siteId, domain }, true)
  const body = await asJson(res)
  if (res.status === 402) return { status: 'ready' }
  if (res.status !== 200) throw new Error(`couldn't check DNS (HTTP ${res.status})${body.error ? `: ${body.error}` : ''}`)
  if (body.status === 'linked') return { status: 'linked' }
  return pendingOf(body)
}

/** Pay one year and link. Re-probes at click time: a fresh bare verify POST →
 * expect the 402 (its terms are bound to {op, domain, siteId}, so the settled
 * payment can never link anything else) → pay → retry with X-PAYMENT. A 200
 * 'pending' at either step means DNS flapped — returned free, nothing signed. */
export async function linkDomain(opts: {
  signer: PaySigner
  siteId: string
  domain: string
  onStage?: (s: Stage) => void
}): Promise<DomainLinkOutcome> {
  const { signer, siteId, domain, onStage } = opts

  onStage?.('quoting')
  const disc = await postDomains({ siteId, domain }, true)
  const discBody = await asJson(disc)
  if (disc.status === 200 && discBody.status === 'linked') return { status: 'linked', digest: String(discBody.digest ?? '') }
  if (disc.status === 200) return pendingOf(discBody)
  if (disc.status !== 402) throw new Error(`couldn't get a price (HTTP ${disc.status})${discBody.error ? `: ${discBody.error}` : ''}`)

  const { header } = await payChallenge(discBody as Challenge, signer, domainPriceAtomic(), onStage)

  onStage?.('publishing')
  const { res, body } = await postPaid(() => postDomains({ siteId, domain }, true, header), onStage)
  if (res.status !== 200) throw new Error(`link failed (HTTP ${res.status})${body.error ? `: ${body.error}` : ''}`)
  if (body.status !== 'linked') return pendingOf(body)
  return {
    status: 'linked',
    digest: String(body.digest ?? ''),
    sslStatus: typeof body.sslStatus === 'string' ? body.sslStatus : undefined,
    instructions: typeof body.instructions === 'string' ? body.instructions : undefined,
  }
}

/** The free owner-signed unlink: sign the EXACT shared auth message (the worker
 * reconstructs it byte-for-byte and recovers the signer, ±60 min freshness). */
export async function unlinkDomain(opts: { signer: PaySigner; domain: string }): Promise<{ digest: string }> {
  const { signer, domain } = opts
  const ts = Date.now()
  const signature = await signer.signMessage(new TextEncoder().encode(buildDeployUnlinkAuthMessage(domain, ts)))
  const res = await fetch(`${DEPLOY_API}/domains/${encodeURIComponent(domain)}`, {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ts, signature }),
  })
  const body = await asJson(res)
  if (res.status !== 200) throw new Error(`unlink failed (HTTP ${res.status})${body.error ? `: ${body.error}` : ''}`)
  return { digest: String(body.digest ?? '') }
}

/** Free owner-signed RE-POINT: move a paid custom domain onto another site the
 * SAME owner controls — no new yearly fee. Signs the shared repoint auth message;
 * the worker requires the signer to own BOTH the current site and `newSiteId`.
 * `digest` is null on the idempotent no-op (already pointed there). */
export async function repointDomain(opts: {
  signer: PaySigner
  domain: string
  newSiteId: string
}): Promise<{ siteId: string; previousSiteId: string; digest: string | null }> {
  const { signer, domain, newSiteId } = opts
  const ts = Date.now()
  const signature = await signer.signMessage(new TextEncoder().encode(buildDeployRepointAuthMessage(domain, newSiteId, ts)))
  const res = await fetch(`${DEPLOY_API}/domains/repoint`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ domain, newSiteId, ts, signature }),
  })
  const body = await asJson(res)
  if (res.status !== 200) throw new Error(`move failed (HTTP ${res.status})${body.error ? `: ${body.error}` : ''}`)
  return {
    siteId: String(body.siteId ?? newSiteId),
    previousSiteId: String(body.previousSiteId ?? ''),
    digest: typeof body.digest === 'string' ? body.digest : null,
  }
}
