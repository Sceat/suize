// =============================================================================
// The custom-domain desk of a filed edition — a compact expandable row under the
// card footer. Challenge (free) → the exact DNS records → verify (free) → pay
// one year via the SAME x402 rail deploys ride (pay.ts guards the 402 against
// the @suize/shared per-year constant before anything is signed) → linked.
// Unlink is the free owner-signed personal message (the shared auth builder).
//
// Which domains point at a site is read from chain: the registry maps
// domain → site, so the reverse read folds the DomainLinked/DomainUnlinked
// event feed — ONE module-cached sweep for the whole dashboard, exactly how
// sites.ts folds SiteExtended. No off-chain store.
// =============================================================================

import { useEffect, useRef, useState } from 'react'
import { formatUsdc } from '@suize/x402'
import { graphqlUrl, packageIds } from '@suize/shared'
import { DEPLOY_API, NETWORK } from '../config'
import {
  domainChallenge,
  domainPriceAtomic,
  linkDomain,
  repointDomain,
  unlinkDomain,
  verifyDomain,
  type DomainChallenge,
  type PaySigner,
  type Stage,
} from '../deploy/pay'

const GRAPHQL_URL = graphqlUrl(NETWORK)
const DEPLOY_PACKAGE = packageIds(NETWORK).DEPLOY.PACKAGE

/** A full 0x-prefixed 32-byte Sui object id — the shape a target site id must match. */
const SITE_ID_RE = /^0x[0-9a-fA-F]{64}$/

// ── linked-domain fold (module cache: one sweep serves every card) ────────────

const EVENTS_QUERY = `query($type: String!, $before: String) {
  events(last: 50, before: $before, filter: { type: $type }) {
    pageInfo { hasPreviousPage startCursor }
    nodes { timestamp contents { json } }
  }
}`

interface EventNode {
  timestamp?: string | null
  contents?: { json?: Record<string, unknown> | null } | null
}

interface EventsPage {
  events?: { pageInfo?: { hasPreviousPage?: boolean; startCursor?: string | null }; nodes?: EventNode[] } | null
}

const collect = async (type: string, maxPages = 4): Promise<EventNode[]> => {
  const acc: EventNode[] = []
  let before: string | null = null
  for (let p = 0; p < maxPages; p++) {
    const res = await fetch(GRAPHQL_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: EVENTS_QUERY, variables: { type, before } }),
    })
    if (!res.ok) throw new Error(`Sui GraphQL HTTP ${res.status}`)
    const body = (await res.json()) as { data?: EventsPage; errors?: { message?: string }[] }
    if (body.errors?.length) throw new Error(body.errors[0]?.message ?? 'graphql error')
    const conn = body.data?.events
    for (const n of conn?.nodes ?? []) acc.push(n)
    if (!conn?.pageInfo?.hasPreviousPage || !conn.pageInfo.startCursor) break
    before = conn.pageInfo.startCursor
  }
  return acc
}

/** siteId → its currently linked domains: replay the link/unlink feed oldest →
 * newest; the latest event per domain wins (the registry holds one site per
 * domain, so this fold IS the table's reverse index). */
async function loadLinked(): Promise<Map<string, string[]>> {
  if (DEPLOY_PACKAGE === '0x0') return new Map()
  const [linked, unlinked] = await Promise.all([
    collect(`${DEPLOY_PACKAGE}::domain_registry::DomainLinked`),
    collect(`${DEPLOY_PACKAGE}::domain_registry::DomainUnlinked`),
  ])
  const ts = (n: EventNode): number => {
    const t = n.timestamp ? Date.parse(n.timestamp) : 0
    return Number.isFinite(t) ? t : 0
  }
  const feed: { at: number; domain: string; siteId: string | null }[] = []
  for (const n of linked) {
    const j = n.contents?.json as { domain?: string; site_id?: string } | undefined
    if (j?.domain && j.site_id) feed.push({ at: ts(n), domain: j.domain, siteId: j.site_id })
  }
  for (const n of unlinked) {
    const j = n.contents?.json as { domain?: string } | undefined
    if (j?.domain) feed.push({ at: ts(n), domain: j.domain, siteId: null })
  }
  feed.sort((a, b) => a.at - b.at)
  const byDomain = new Map<string, string | null>()
  for (const e of feed) byDomain.set(e.domain, e.siteId)
  const bySite = new Map<string, string[]>()
  for (const [domain, siteId] of byDomain) {
    if (!siteId) continue
    bySite.set(siteId, [...(bySite.get(siteId) ?? []), domain])
  }
  return bySite
}

let cache: Promise<Map<string, string[]>> | null = null

const linkedDomains = (): Promise<Map<string, string[]>> => {
  if (!cache) {
    cache = loadLinked().catch(() => {
      cache = null // an outage must not pin an empty answer forever
      return new Map<string, string[]>()
    })
  }
  return cache
}

const invalidateLinked = (): void => {
  cache = null
}

// ── the row ───────────────────────────────────────────────────────────────────

const STAGE_LABEL: Record<Stage, string> = {
  quoting: 'Reading the price…',
  building: 'Preparing the payment…',
  signing: 'Waiting for your wallet…',
  publishing: 'Linking your domain…',
}

export function DomainRow({ siteId, signer, onDomains }: {
  siteId: string
  signer: PaySigner | null
  /** Reports the linked domains up to the card (shown on its host line). */
  onDomains: (domains: string[]) => void
}) {
  const [domains, setDomains] = useState<string[] | null>(null)
  const [open, setOpen] = useState(false)
  const [input, setInput] = useState('')
  const [ch, setCh] = useState<DomainChallenge | null>(null)
  const [check, setCheck] = useState<{ txtOk: boolean; cnameOk: boolean; detail: string } | null>(null)
  const [ready, setReady] = useState(false)
  const [stage, setStage] = useState<Stage | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [armed, setArmed] = useState<string | null>(null)
  // Re-point: the linked domain being moved to another owned site + the target id.
  const [moving, setMoving] = useState<string | null>(null)
  const [moveTarget, setMoveTarget] = useState('')
  // Cloudflare "add the records for me": the token lives in component state ONLY,
  // is cleared the instant the call fires (success OR failure), never persisted,
  // never put in the URL.
  const [cfToken, setCfToken] = useState('')
  const [assisting, setAssisting] = useState(false)
  // Sync latch — a fast double-click must never fire two payments (state is async).
  const inFlight = useRef(false)

  useEffect(() => {
    let alive = true
    void linkedDomains().then((m) => {
      if (!alive) return
      const d = m.get(siteId) ?? []
      setDomains(d)
      onDomains(d)
    })
    return () => {
      alive = false
    }
    // onDomains is a useState setter at the call site — identity-stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteId])

  const refresh = async () => {
    invalidateLinked()
    const d = (await linkedDomains()).get(siteId) ?? []
    setDomains(d)
    onDomains(d)
  }

  const getRecords = async () => {
    const domain = input.trim().toLowerCase()
    if (!domain || inFlight.current) return
    inFlight.current = true
    setErr(null)
    setCheck(null)
    setReady(false)
    setCfToken('')
    setBusy(true)
    try {
      setCh(await domainChallenge(siteId, domain))
    } catch (e) {
      setCh(null)
      setErr((e as Error).message)
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  const doVerify = async () => {
    if (!ch || inFlight.current) return
    inFlight.current = true
    setErr(null)
    setBusy(true)
    try {
      const v = await verifyDomain(siteId, ch.domain)
      if (v.status === 'ready') {
        setReady(true)
        setCheck({ txtOk: true, cnameOk: true, detail: '' })
      } else if (v.status === 'linked') {
        setCh(null)
        setOpen(false)
        await refresh()
      } else {
        setReady(false)
        setCheck(v)
      }
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  // Cloudflare users: create BOTH records in their own zone via a scoped token,
  // then re-use the SAME verify action so the row advances toward pay on its own.
  const doAssist = async () => {
    const token = cfToken.trim()
    if (!ch || !token || assisting || busy || stage !== null) return
    setErr(null)
    setAssisting(true)
    setCfToken('') // captured; never persisted, never left in the field
    try {
      const res = await fetch(`${DEPLOY_API}/domains/assist`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ siteId, domain: ch.domain, cfToken: token }),
      })
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
      if (res.status !== 200) {
        setErr(String(body.error ?? 'Could not add the records. Add them manually, then verify.'))
        return
      }
      setNote(`Records added to your ${String(body.zone ?? 'Cloudflare')} zone.`)
    } catch {
      setErr('Could not reach Cloudflare. Add the records manually, then verify.')
      return
    } finally {
      setAssisting(false)
    }
    // Records live at Cloudflare — run the exact verify the manual flow uses, so
    // (DNS-propagation willing) the row lands directly on the pay state.
    await doVerify()
  }

  const doPay = async () => {
    if (!ch || !signer || inFlight.current) return
    inFlight.current = true
    setErr(null)
    try {
      const r = await linkDomain({ signer, siteId, domain: ch.domain, onStage: setStage })
      if (r.status === 'pending') {
        setReady(false)
        setCheck(r)
        setErr('DNS stopped matching. Check the records and verify again.')
      } else {
        if (r.sslStatus === 'manual' && r.instructions) setNote(r.instructions)
        setCh(null)
        setCheck(null)
        setReady(false)
        setInput('')
        setOpen(false)
        await refresh()
      }
    } catch (e) {
      const msg = (e as Error)?.message ?? ''
      setErr(/reject|denied|cancel/i.test(msg) ? 'You cancelled the payment.' : msg || 'Could not link. Try again.')
    } finally {
      inFlight.current = false
      setStage(null)
    }
  }

  const doUnlink = async (domain: string) => {
    if (!signer || inFlight.current) return
    // Two clicks on purpose: relinking costs a fresh year, a misclick must not.
    if (armed !== domain) {
      setArmed(domain)
      return
    }
    inFlight.current = true
    setErr(null)
    setArmed(null)
    setBusy(true)
    try {
      await unlinkDomain({ signer, domain })
      setNote(null)
      await refresh()
    } catch (e) {
      const msg = (e as Error)?.message ?? ''
      setErr(/reject|denied|cancel/i.test(msg) ? 'You cancelled the signature.' : msg || 'Could not unlink. Try again.')
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  // Move a paid domain onto ANOTHER site the wallet owns — free (the yearly
  // reservation is already paid). The worker requires the signer to own BOTH this
  // site and the target; on success the domain leaves this card for the target.
  const doRepoint = async (domain: string) => {
    if (!signer || inFlight.current) return
    const target = moveTarget.trim()
    if (!SITE_ID_RE.test(target)) {
      setErr('Enter a valid site ID (0x…) you own.')
      return
    }
    if (target.toLowerCase() === siteId.toLowerCase()) {
      setErr('The domain is already on this site. Pick a different one you own.')
      return
    }
    inFlight.current = true
    setErr(null)
    setBusy(true)
    try {
      await repointDomain({ signer, domain, newSiteId: target })
      setMoving(null)
      setMoveTarget('')
      setNote(null)
      await refresh()
    } catch (e) {
      const msg = (e as Error)?.message ?? ''
      setErr(/reject|denied|cancel/i.test(msg) ? 'You cancelled the signature.' : msg || 'Could not move the domain. Try again.')
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  if (domains === null) return null // resolving; the row appears once known

  return (
    <div className="domrow">
      <div className="domrow__bar">
        {domains.map((d) => (
          <span key={d} className="domrow__linked">
            <span className="domrow__dname mono">{d}</span>
            {moving === d ? (
              <>
                <input
                  className="domrow__input mono"
                  value={moveTarget}
                  placeholder="0x… another site you own"
                  spellCheck={false}
                  autoCapitalize="none"
                  autoComplete="off"
                  onChange={(e) => setMoveTarget(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && void doRepoint(d)}
                />
                <button
                  className="domrow__act"
                  type="button"
                  disabled={busy || stage !== null || !SITE_ID_RE.test(moveTarget.trim())}
                  onClick={() => void doRepoint(d)}
                >
                  Move here
                </button>
                <button
                  className="domrow__act"
                  type="button"
                  onClick={() => {
                    setMoving(null)
                    setMoveTarget('')
                    setErr(null)
                  }}
                >
                  Cancel
                </button>
              </>
            ) : (
              <>
                <button
                  className="domrow__act"
                  type="button"
                  disabled={busy || stage !== null || !signer}
                  onClick={() => {
                    setMoving(d)
                    setMoveTarget('')
                    setArmed(null)
                    setErr(null)
                  }}
                >
                  Move
                </button>
                <button
                  className="domrow__act"
                  type="button"
                  disabled={busy || stage !== null || !signer}
                  onClick={() => void doUnlink(d)}
                >
                  {armed === d ? 'Confirm unlink' : 'Unlink'}
                </button>
                {armed === d && (
                  <button className="domrow__act" type="button" onClick={() => setArmed(null)}>
                    Keep it
                  </button>
                )}
              </>
            )}
          </span>
        ))}
        {domains.length === 0 && (
          <button
            className="domrow__act"
            type="button"
            aria-expanded={open}
            onClick={() => {
              setOpen(!open)
              setErr(null)
            }}
          >
            {open ? 'Close' : 'Custom domain'}
          </button>
        )}
      </div>

      {open && domains.length === 0 && (
        <div className="domrow__panel">
          <div className="domrow__form">
            <input
              className="domrow__input mono"
              value={input}
              placeholder="news.yourdomain.com"
              spellCheck={false}
              autoCapitalize="none"
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void getRecords()}
            />
            <button className="btn btn--ghost" type="button" disabled={busy || stage !== null || !input.trim()} onClick={() => void getRecords()}>
              {ch ? 'Change domain' : 'Get DNS records'}
            </button>
          </div>

          {ch && (
            <>
              <p className="domrow__hint">Add both records at your DNS provider, then verify. Propagation can take a few minutes.</p>
              <div className="domrec">
                <RecordLine type="TXT" name={ch.txtName} value={ch.txtValue} ok={check ? check.txtOk : null} />
                <RecordLine type="CNAME" name={ch.domain} value={ch.cname} ok={check ? check.cnameOk : null} />
              </div>
              {check && !ready && check.detail && <p className="dmsg dmsg--err">{check.detail}</p>}
              <div className="domrow__go">
                <button className="btn btn--ghost" type="button" disabled={busy || assisting || stage !== null} onClick={() => void doVerify()}>
                  {busy ? 'Checking DNS…' : 'Verify DNS'}
                </button>
                {ready && (
                  <button className="btn btn--primary" type="button" disabled={stage !== null || assisting || !signer} onClick={() => void doPay()}>
                    {stage ? STAGE_LABEL[stage] : `Pay $${formatUsdc(domainPriceAtomic())}/yr and link`}
                  </button>
                )}
              </div>

              <div className="domassist">
                <p className="domassist__lead">On Cloudflare? Add both records for you.</p>
                <div className="domrow__form">
                  <input
                    className="domrow__input mono"
                    type="password"
                    value={cfToken}
                    placeholder="Cloudflare API token"
                    spellCheck={false}
                    autoCapitalize="none"
                    autoComplete="off"
                    onChange={(e) => setCfToken(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && void doAssist()}
                  />
                  <button
                    className="btn btn--ghost"
                    type="button"
                    disabled={assisting || busy || stage !== null || !cfToken.trim()}
                    onClick={() => void doAssist()}
                  >
                    {assisting ? 'Adding records…' : 'Add records via Cloudflare'}
                  </button>
                </div>
                <p className="domassist__note">
                  <a href="https://dash.cloudflare.com/profile/api-tokens" target="_blank" rel="noopener noreferrer">
                    Create a token scoped to just this zone with DNS edit permission.
                  </a>{' '}
                  It is used once to add the records and never stored.
                </p>
              </div>
            </>
          )}
        </div>
      )}

      {err && <p className="dmsg dmsg--err">{err}</p>}
      {note && <p className="dmsg">{note}</p>}
    </div>
  )
}

function RecordLine({ type, name, value, ok }: { type: string; name: string; value: string; ok: boolean | null }) {
  return (
    <div className="domrec__row">
      <span className="domrec__type mono">{type}</span>
      <span className="domrec__vals">
        <span className="domrec__name mono">{name}</span>
        <span className="domrec__val mono">{value}</span>
      </span>
      <span className="domrec__side">
        {ok !== null && <span className={`domrec__state mono${ok ? ' is-ok' : ''}`}>{ok ? 'found' : 'waiting'}</span>}
        <CopyBtn text={value} />
      </span>
    </div>
  )
}

function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      className="domrec__copy"
      type="button"
      aria-live="polite"
      onClick={() => {
        navigator.clipboard?.writeText(text)
        setCopied(true)
        window.setTimeout(() => setCopied(false), 1400)
      }}
    >
      {copied ? 'Copied' : 'Copy'}
    </button>
  )
}
