import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSignPersonalMessage, useSignTransaction, useSuiClient } from '@mysten/dapp-kit'
import type { DomainChallengeResponse, SiteInfo } from '@suize/shared'
import {
  DEPLOY_EXTEND_PRICE_USDC,
  DEPLOY_SUB_PERIOD_MS,
  DEPLOY_SUB_PRICE_USDC,
  PACKAGE_IDS,
  resolveTreasury,
  buildDeployLinkAuthMessage,
  buildDeployUnlinkAuthMessage,
} from '@suize/shared'
import { suizeSubs, type SubStatus } from '@suize/pay/subs'
import type { PaymentRequired } from '@suize/pay'
import {
  DeployApiError,
  extend_site,
  fetch_site,
  link_domain_issue,
  link_domain_verify,
  settle_challenge,
  unlink_domain,
} from '../api'
import { fetch_site_onchain } from '../chain'
import { openSubscribePopup, walletManageUrl } from '../subscribe-popup'
import { SUI_NETWORK } from '../config'
import { useSuizeHandle } from '../suins'
import { fmt_date, fmt_id, fmt_usdc, site_size, site_files } from '../format'
import {
  CopyButton,
  EmptyState,
  LoadingState,
  describe_error,
  IconBack,
  IconCheck,
  IconExternal,
  IconPlus,
} from '../ui'

// ============================================================================
// SITE DETAIL — URL + copy, on-chain meta, linked domains with unlink, and the
// "Add domain" flow. The page READS DIRECTLY FROM CHAIN (the `Site` object +
// its SiteCreated / Domain* events), so it works with the backend offline. Only
// the WRITES stay on the backend (its service wallet holds the SiteAdminCap):
// POST /domains returns the DNS TXT challenge the backend verifies before it
// links on-chain; DELETE /domains/:domain unlinks. Graceful states throughout.
//
// OWNERSHIP GATE — the domain WRITE controls (add form + unlink buttons) render
// ONLY for the site's owner (viewerAddress === Site.owner, case-insensitive). The
// domain LIST is read-only-visible to everyone; non-owners see an "Owned by
// <name>@suize" line instead of the add form. The gate is presentation only:
// every write is now CRYPTOGRAPHICALLY SIGNED (zkLogin personal message over an
// op-bound, nonce-fresh string) and the backend recovers the signer + requires it
// to equal Site.owner — only the owner can produce a valid signature, so the
// backend is the real authority. The UI gate just hides controls non-owners
// can't use anyway.
// ============================================================================

// A single ✓/✗ DNS-record state pill. `ok === undefined` ⇒ "not checked yet"
// (the initial issue, before the user re-checks) — a neutral dot, not a red ✗.
const RecordCheck = ({ ok }: { ok?: boolean }) => {
  if (ok === undefined)
    return (
      <span className="dx-check is-idle" aria-label="Not checked yet">
        <span className="dx-check__dot" aria-hidden="true" />
        Not checked yet
      </span>
    )
  if (ok)
    return (
      <span className="dx-check is-ok" aria-label="Found">
        <IconCheck size={13} />
        Found
      </span>
    )
  return (
    <span className="dx-check is-bad" aria-label="Not found yet">
      <span className="dx-check__x" aria-hidden="true">
        ✕
      </span>
      Not found yet
    </span>
  )
}

// The linked-state SSL line. `manual` is the honest "CF-for-SaaS off" path — we
// don't pretend to provision; the user proxies/SSLs their own domain.
const SslState = ({
  sslStatus,
}: {
  sslStatus: DomainChallengeResponse['sslStatus']
}) => {
  if (sslStatus === 'active')
    return (
      <span className="dx-ssl is-ok">
        <IconCheck size={13} /> SSL active
      </span>
    )
  if (sslStatus === 'error')
    return (
      <span className="dx-ssl is-bad">
        SSL provisioning failed — re-check or retry shortly.
      </span>
    )
  if (sslStatus === 'manual')
    return (
      <span className="dx-ssl is-idle">
        Point your domain (CNAME) and ensure it's proxied / SSL'd on your side —
        automatic SSL isn't enabled for this deployment.
      </span>
    )
  // pending (or undefined while the cert spins up)
  return (
    <span className="dx-ssl is-pending">
      <span className="spin" aria-hidden="true" /> SSL provisioning…
    </span>
  )
}

const ChallengeView = ({
  challenge,
  onVerify,
  verifying,
  verifyLabel,
  verifyError,
}: {
  challenge: DomainChallengeResponse
  onVerify: () => void
  verifying: boolean
  verifyLabel: string
  verifyError: string | null
}) => {
  const linked = challenge.status === 'linked'

  return (
    <>
      {linked ? (
        <p className="dx-hint">
          <b className="dx-linked-mark">
            <IconCheck size={13} /> {challenge.domain} is linked
          </b>{' '}
          on-chain. <SslState sslStatus={challenge.sslStatus} />
        </p>
      ) : (
        <p className="dx-hint">
          Add these two DNS records at your registrar, then click{' '}
          <b>Verify &amp; Link</b> and approve the signature. The backend verifies
          the TXT record proves ownership and the CNAME routes, then links{' '}
          <b>{challenge.domain}</b> on-chain.
        </p>
      )}

      <div className="dx-record">
        <div className="dx-record__head">
          <div className="dx-record__type">① TXT — ownership challenge</div>
          <RecordCheck ok={challenge.txtOk} />
        </div>
        <div className="dx-record__field">
          <span className="dx-record__klabel">Name</span>
          <span className="dx-record__val">{challenge.txtName}</span>
          <CopyButton value={challenge.txtName} label="Copy name" />
        </div>
        <div className="dx-record__field">
          <span className="dx-record__klabel">Value</span>
          <span className="dx-record__val">{challenge.txtValue}</span>
          <CopyButton value={challenge.txtValue} label="Copy value" />
        </div>
      </div>

      <div className="dx-record">
        <div className="dx-record__head">
          <div className="dx-record__type">② CNAME — point your domain</div>
          <RecordCheck ok={challenge.cnameOk} />
        </div>
        <div className="dx-record__field">
          <span className="dx-record__klabel">Name</span>
          <span className="dx-record__val">{challenge.domain}</span>
          <CopyButton value={challenge.domain} label="Copy host" />
        </div>
        <div className="dx-record__field">
          <span className="dx-record__klabel">Target</span>
          <span className="dx-record__val">{challenge.cname}</span>
          <CopyButton value={challenge.cname} label="Copy target" />
        </div>
      </div>

      {!linked && challenge.detail && (
        <p className="dx-hint" aria-live="polite">
          {challenge.detail}
        </p>
      )}

      {verifyError && <p className="dx-error">{verifyError}</p>}

      {!linked && (
        <div className="dx-form-actions">
          <button
            type="button"
            className="dx-btn is-accent"
            disabled={verifying}
            onClick={onVerify}
            aria-busy={verifying}
          >
            {verifying ? (
              <>
                <span className="spin" aria-hidden="true" /> {verifyLabel}
              </>
            ) : (
              'Verify & Link'
            )}
          </button>
        </div>
      )}

      {!linked && (
        <p className="dx-hint">
          DNS can take a few minutes to propagate. Each <b>Verify &amp; Link</b>{' '}
          re-reads your records and asks for a fresh signature — if a record is
          still missing, finish it and click again.
        </p>
      )}
    </>
  )
}

const AddDomainForm = ({
  siteId,
  onLinked,
  onError,
}: {
  siteId: string
  onLinked: (msg: string) => void
  onError: (msg: string) => void
}) => {
  const [domain, setDomain] = useState('')
  const [challenge, setChallenge] = useState<DomainChallengeResponse | null>(
    null,
  )
  // Sub-phase of the verify step so the button can read "Signing…" (waiting on
  // the wallet) vs "Verifying…" (backend re-reading DNS + linking on-chain).
  const [verifyPhase, setVerifyPhase] = useState<'idle' | 'signing' | 'verifying'>(
    'idle',
  )
  const qc = useQueryClient()
  const { mutateAsync: signPersonalMessage } = useSignPersonalMessage()

  // Apply a fresh challenge/verify response: store it, toast, and on a completed
  // link invalidate the site query so the new domain lands in DomainsPanel.
  const apply = (res: DomainChallengeResponse, fromVerify: boolean) => {
    setChallenge(res)
    if (res.status === 'linked') {
      onLinked(`Linked ${res.domain}`)
      void qc.invalidateQueries({ queryKey: ['site', siteId] })
    } else if (!fromVerify) {
      onLinked(`Challenge issued for ${res.domain}`)
    }
  }

  // ISSUE — the initial "Get DNS records" (verify=0, UNAUTHENTICATED ⇒ no DNS
  // read, no signature). The response carries the `nonce` we'll sign on verify.
  const issue = useMutation({
    mutationFn: (d: string) =>
      link_domain_issue(siteId, d.trim().toLowerCase()),
    onSuccess: res => apply(res, false),
    onError: e => onError(describe_error(e).title),
  })

  // VERIFY & LINK — explicit, user-initiated, SIGNED. Stamp a fresh client `ts` →
  // sign buildDeployLinkAuthMessage(domain, siteId, ts) with the zkLogin signer →
  // POST verify=1 with { ts, signature }. The backend re-reads DNS (txtOk/cnameOk),
  // recovers the signer == Site.owner + checks `ts` is fresh, and links on-chain +
  // provisions SSL once both records pass. STATELESS — no server nonce fetch.
  const verify = useMutation({
    mutationFn: async () => {
      const d = domain.trim().toLowerCase()
      const ts = Date.now()
      const message = new TextEncoder().encode(
        buildDeployLinkAuthMessage(d, siteId, ts),
      )
      setVerifyPhase('signing')
      const { signature } = await signPersonalMessage({ message })
      setVerifyPhase('verifying')
      return link_domain_verify(siteId, d, ts, signature)
    },
    onSuccess: res => apply(res, true),
    // Settled (success OR error/cancel) → drop back to idle so the button resets.
    onSettled: () => setVerifyPhase('idle'),
    // Errors (incl. a rejected/cancelled wallet signature) surface inline in the
    // ChallengeView (verifyError) — not a global toast — so the records +
    // checklist stay in view while the user fixes DNS or retries.
  })

  const valid = /^([a-z0-9-]+\.)+[a-z]{2,}$/i.test(domain.trim())

  return (
    <div className="dx-panel">
      <h2 className="dx-panel__title">Add a custom domain</h2>
      <label className="dx-label" htmlFor="domain-input">
        Domain
      </label>
      <input
        id="domain-input"
        className="dx-field"
        type="text"
        inputMode="url"
        autoCapitalize="none"
        spellCheck={false}
        placeholder="example.com"
        value={domain}
        onChange={e => setDomain(e.target.value)}
        disabled={!!challenge}
        onKeyDown={e => {
          if (e.key === 'Enter' && valid && !issue.isPending && !challenge)
            issue.mutate(domain)
        }}
      />
      {!challenge && (
        <div className="dx-form-actions">
          <button
            type="button"
            className="dx-btn is-accent"
            disabled={!valid || issue.isPending}
            onClick={() => issue.mutate(domain)}
          >
            {issue.isPending ? 'Requesting…' : 'Get DNS records'}
          </button>
        </div>
      )}

      {issue.isError && (
        <p className="dx-error">{describe_error(issue.error).title}</p>
      )}

      {challenge && (
        <ChallengeView
          challenge={challenge}
          onVerify={() => verify.mutate()}
          verifying={verify.isPending}
          verifyLabel={verifyPhase === 'signing' ? 'Signing…' : 'Verifying…'}
          verifyError={
            verify.isError ? describe_error(verify.error).title : null
          }
        />
      )}
    </div>
  )
}

// ============================================================================
// STORAGE — the Deploy storage lifecycle (LOCKED #10). A site's Walrus blobs have
// a finite paid storage window; this panel surfaces the live expiry and the two
// ways to keep it alive:
//   • SUBSCRIBE ($19.99/mo, per-ACCOUNT) — ONE plan owned by the site owner unlocks
//     custom domains for ALL their sites and auto-renews ALL their storage so nothing
//     expires (capped at 100 GB total). The wallet's visible /confirm-subscribe popup
//     builds + signs + submits the subs::subscription::create tx ITSELF (display =
//     build; the create ref is still the site id — wire-unchanged), and the backend's
//     extender fans out across the owner's sites each period (the on-settle hook + the
//     safety cron). Active state is read straight off the chain via @suize/pay/subs
//     `activeFor(owner)` — no Suize store, no per-site sub.
//   • EXTEND ONCE ($0.50) — a one-off paid extend via the x402 V2 gate (the SAME
//     gasless settle as a deploy: POST /sites/:id/extend with no payment → 402 →
//     settle the challenge → retry with X-PAYMENT). The agent re-402 path is
//     documented in the Agents view.
// ON-CHAIN LAW (subs module): create stamps paid_until_ms = now + period, so the
// FIRST renewal lands one full period after subscribing; renewals then recur
// silently — the cancel (in the wallet) is the kill switch.
// ============================================================================

const SUB_PERIOD_DAYS = Math.round(DEPLOY_SUB_PERIOD_MS / 86_400_000)
/** $19.99 as the decimal SubscribeTerms amount. */
const SUB_PRICE_DECIMAL = (DEPLOY_SUB_PRICE_USDC / 1e6).toFixed(2)

const DAY_MS = 86_400_000

/** The expiry pill state for a storage window: amber within 14d, red within 3d. */
const expiryTone = (expiresAtMs: number | null | undefined): 'ok' | 'amber' | 'red' | 'unknown' => {
  if (expiresAtMs == null) return 'unknown'
  const left = expiresAtMs - Date.now()
  if (left <= 3 * DAY_MS) return 'red'
  if (left <= 14 * DAY_MS) return 'amber'
  return 'ok'
}

const StoragePanel = ({
  site,
  expiresAtMs,
  owner,
  onOk,
  onError,
}: {
  site: SiteInfo
  /** The site's storage expiry (from the backend's /sites/:id read), or null. */
  expiresAtMs: number | null
  /** The viewer's connected address (== Site.owner — the panel is owner-gated). */
  owner: string
  onOk: (msg: string) => void
  onError: (msg: string) => void
}) => {
  const qc = useQueryClient()
  const client = useSuiClient()
  const { mutateAsync: signTransaction } = useSignTransaction()

  // The Deploy merchant = the Suize treasury, RESOLVED LIVE from `treasury@suize` (the
  // single source of truth; no hardcoded address). Subscribe/read are gated on it.
  const treasuryQ = useQuery({
    queryKey: ['suize-treasury', SUI_NETWORK],
    queryFn: () => resolveTreasury(client),
    staleTime: Infinity,
  })
  const merchant = treasuryQ.data ?? null

  // Active subscription for THIS ACCOUNT, read straight off the chain (per-address —
  // one plan owned by the site owner covers every site they own). We read the owner's
  // active plans and surface the first; the create ref stays the siteId (wire-unchanged).
  const subQ = useQuery({
    queryKey: ['sub', owner, merchant],
    enabled: Boolean(merchant) && Boolean(owner),
    queryFn: async (): Promise<SubStatus | null> =>
      (
        await suizeSubs({
          merchant: merchant as string,
          network: SUI_NETWORK,
          subsPackage: PACKAGE_IDS.SUBS.PACKAGE,
        }).activeFor(owner)
      )[0] ?? null,
    staleTime: 30_000,
    retry: false,
  })
  const sub = subQ.data ?? null

  // SUBSCRIBE — open the wallet's visible /confirm-subscribe popup with the terms.
  // The popup builds + signs + submits the create tx itself (display = build).
  const subscribe = useMutation({
    mutationFn: async () => {
      if (!merchant) throw new Error('Treasury not resolved yet — try again in a moment.')
      const res = await openSubscribePopup({
        merchant,
        amount: SUB_PRICE_DECIMAL,
        periodMs: DEPLOY_SUB_PERIOD_MS,
        ref: site.siteId, // the on-chain join: ref = the site id (the extender decodes it)
        label: site.name || 'Suize Deploy site',
      })
      if (!res.ok) {
        if (res.cancelled) throw new Error('Subscription cancelled.')
        throw new Error(res.error || 'Could not set up the subscription.')
      }
      return res.digest
    },
    onSuccess: () => {
      onOk('Storage auto-renewal is on')
      // The chain takes a beat to index; refetch shortly to flip the panel.
      setTimeout(() => void qc.invalidateQueries({ queryKey: ['sub', site.siteId] }), 2_000)
    },
    onError: e => onError(describe_error(e).title),
  })

  // EXTEND ONCE ($0.50) — the x402 V2 in-app flow: POST /sites/:id/extend with no
  // payment → 402 → settle the challenge (build gasless → sign locally → X-PAYMENT)
  // → retry. The payer must be the site owner (enforced on-chain-verified).
  const extend = useMutation({
    mutationFn: async (): Promise<string> => {
      // Probe to discover the 402 challenge (an empty X-PAYMENT triggers the 402).
      try {
        const r = await extend_site(site.siteId, '')
        return r.digest // un-gated path (charge gate off)
      } catch (e) {
        if (!(e instanceof DeployApiError) || e.status !== 402) throw e
        const challenge = e.body as PaymentRequired | undefined
        if (!challenge?.accepts?.length) throw e
        const { header } = await settle_challenge(challenge, owner, bytes =>
          signTransaction({ transaction: bytes }),
        )
        const r = await extend_site(site.siteId, header)
        return r.digest
      }
    },
    onSuccess: () => {
      onOk('Storage extended')
      void qc.invalidateQueries({ queryKey: ['site', site.siteId] })
      void qc.invalidateQueries({ queryKey: ['site-storage', site.siteId] })
    },
    onError: e => onError(describe_error(e).title),
  })

  const tone = expiryTone(expiresAtMs)

  return (
    <div className="dx-panel">
      <h2 className="dx-panel__title">Storage</h2>

      {/* Expiry line — amber <14d, red <3d. */}
      <div className="dx-rows" style={{ marginBottom: 14 }}>
        <div className="dx-row">
          <span className="dx-row__k">Walrus storage</span>
          <span
            className={`dx-row__v${tone === 'red' ? ' dx-error' : ''}`}
            style={tone === 'amber' ? { color: 'var(--warn, #b8860b)' } : undefined}
          >
            {expiresAtMs == null
              ? 'Storage window unknown (the backend reads it live — try again shortly).'
              : `Expires ${fmt_date(expiresAtMs)}${
                  tone === 'red' ? ' — expiring very soon' : tone === 'amber' ? ' — expiring soon' : ''
                }`}
          </span>
        </div>
      </div>

      {sub?.active ? (
        <>
          <p className="dx-hint">
            <b className="dx-linked-mark">
              <IconCheck size={13} /> Auto-renewal on
            </b>{' '}
            — your plan auto-renews the Walrus storage of all your sites and unlocks
            custom domains. Renewals recur silently; paid through{' '}
            <b>{fmt_date(sub.paidUntilMs)}</b>.
          </p>
          <div className="dx-rows">
            <div className="dx-row">
              <span className="dx-row__k">Plan</span>
              <span className="dx-row__v tnum">
                {fmt_usdc(DEPLOY_SUB_PRICE_USDC)} / {SUB_PERIOD_DAYS} days
              </span>
            </div>
            <div className="dx-row">
              <span className="dx-row__k">Subscription</span>
              <span className="dx-row__v" title={sub.subscriptionId}>
                {fmt_id(sub.subscriptionId)}
              </span>
            </div>
          </div>
          <div className="dx-form-actions">
            {/* STUB(deploy): cancel-on-chain (subs::subscription::cancel) is not a
                /confirm-subscribe popup mode yet — the user cancels in the wallet's
                own subscriptions surface. Deep-link added when the wallet ships a
                manage-subs route. */}
            <a
              className="dx-btn is-danger"
              href={walletManageUrl()}
              target="_blank"
              rel="noreferrer"
            >
              Cancel in wallet
            </a>
          </div>
        </>
      ) : (
        <>
          <p className="dx-hint">
            Keep your sites permanent. One subscription —{' '}
            <b>{fmt_usdc(DEPLOY_SUB_PRICE_USDC)}/mo</b> — covers your whole account:
            Suize auto-renews the Walrus storage of all your sites so they never expire
            and unlocks custom domains for every one; cancel anytime. The first renewal
            charge lands one full period ({SUB_PERIOD_DAYS} days) after subscribing —
            that's on-chain law, not policy.
          </p>
          <div className="dx-form-actions">
            <button
              type="button"
              className="dx-btn is-accent"
              disabled={subscribe.isPending}
              onClick={() => subscribe.mutate()}
            >
              {subscribe.isPending
                ? 'Approve in wallet…'
                : `Subscribe — ${fmt_usdc(DEPLOY_SUB_PRICE_USDC)}/mo`}
            </button>
            <button
              type="button"
              className="dx-btn"
              disabled={extend.isPending}
              onClick={() => extend.mutate()}
              title="One-off storage extension — no subscription"
            >
              {extend.isPending ? 'Extending…' : `Extend once — $${DEPLOY_EXTEND_PRICE_USDC}`}
            </button>
          </div>
        </>
      )}
      {(subscribe.isError || extend.isError) && (
        <p className="dx-error">
          {describe_error(subscribe.error ?? extend.error).title}
        </p>
      )}
    </div>
  )
}

const DomainsPanel = ({
  site,
  isOwner,
  onUnlinked,
  onError,
}: {
  site: SiteInfo
  isOwner: boolean
  onUnlinked: (msg: string) => void
  onError: (msg: string) => void
}) => {
  const qc = useQueryClient()
  const { mutateAsync: signPersonalMessage } = useSignPersonalMessage()
  // Which domain row is mid-sign, so only its button reads "Signing…".
  const [signing, setSigning] = useState<string | null>(null)
  const m = useMutation({
    // UNLINK is CRYPTOGRAPHICALLY SIGNED — stamp a fresh client `ts` → sign
    // buildDeployUnlinkAuthMessage(domain, ts) with the zkLogin signer → DELETE with
    // { ts, signature }. The backend recovers signer == Site.owner + checks `ts` is
    // fresh. Only the owner can produce a valid signature. STATELESS — no nonce fetch.
    mutationFn: async (d: string) => {
      const ts = Date.now()
      const message = new TextEncoder().encode(
        buildDeployUnlinkAuthMessage(d, ts),
      )
      setSigning(d)
      const { signature } = await signPersonalMessage({ message })
      setSigning(null)
      return unlink_domain(d, ts, signature)
    },
    onSuccess: (_res, d) => {
      onUnlinked(`Unlinked ${d}`)
      void qc.invalidateQueries({ queryKey: ['site', site.siteId] })
    },
    // Surfaces a rejected/cancelled signature as an inline error toast; reset the
    // signing flag so the button label recovers from "Signing…".
    onError: e => onError(describe_error(e).title),
    onSettled: () => setSigning(null),
  })

  return (
    <div className="dx-panel">
      <h2 className="dx-panel__title">Linked domains</h2>
      {site.domains.length === 0 ? (
        <p className="dx-hint">
          No custom domains yet. This site is always live at its free subdomain
          above.{isOwner ? ' Add a domain below to point your own at it.' : ''}
        </p>
      ) : (
        site.domains.map(d => (
          <div key={d} className="dx-domain">
            <span className="dx-domain__name">{d}</span>
            {isOwner && (
              <button
                type="button"
                className="dx-btn is-danger is-sm"
                disabled={m.isPending}
                onClick={() => {
                  if (
                    window.confirm(
                      `Unlink ${d}? The domain will stop resolving to this site.`,
                    )
                  )
                    m.mutate(d)
                }}
              >
                {m.isPending && m.variables === d
                  ? signing === d
                    ? 'Signing…'
                    : 'Unlinking…'
                  : 'Unlink'}
              </button>
            )}
          </div>
        ))
      )}
    </div>
  )
}

// For non-owners (incl. logged-out): in place of the add-domain form, a small
// "Owned by <name>@suize" line. Resolves site.owner to its Suize handle, falling
// back to the truncated address. Display only — never gates anything.
const OwnedByLine = ({ owner }: { owner: string }) => {
  const handle = useSuizeHandle(owner)
  return (
    <p className="dx-hint" title={owner}>
      Owned by <b>{handle ?? fmt_id(owner)}</b>. Only the owner can add or remove
      custom domains.
    </p>
  )
}

export const SiteDetail = ({
  siteId,
  viewerAddress,
  onBack,
  onLinked,
  onError,
}: {
  siteId: string
  viewerAddress: string | null
  onBack: () => void
  onLinked: (msg: string) => void
  onError: (msg: string) => void
}) => {
  const [adding, setAdding] = useState(false)
  const client = useSuiClient()
  const q = useQuery({
    queryKey: ['site', siteId],
    queryFn: () => fetch_site_onchain(client, siteId),
    retry: false,
  })
  // The on-chain read has no storage lifecycle; the backend's /sites/:id computes
  // the live Walrus storage end-epoch + expiresAtMs. A separate, non-blocking query
  // (the detail page works without it; the Storage card just shows "unknown").
  const storageQ = useQuery({
    queryKey: ['site-storage', siteId],
    queryFn: () => fetch_site(siteId),
    staleTime: 60_000,
    retry: false,
  })
  const expiresAtMs = storageQ.data?.expiresAtMs ?? null

  // Owner gate: case-insensitive match of the viewer against the site's on-chain
  // owner address. Logged-out (viewerAddress null) ⇒ never owner. Presentation
  // gate only — every write is signed and the backend recovers the signer +
  // requires it to equal Site.owner (the signature is the real authority).
  const isOwner =
    !!viewerAddress &&
    !!q.data?.owner &&
    viewerAddress.toLowerCase() === q.data.owner.toLowerCase()

  return (
    <>
      <button type="button" className="dx-back" onClick={onBack}>
        <IconBack /> All sites
      </button>

      {q.isLoading && <LoadingState label="Loading site…" />}
      {q.isError && <EmptyState {...describe_error(q.error)} />}

      {q.isSuccess && (
        <>
          <div className="dx-pagehead">
            <div>
              <p className="ed-eyebrow">Site detail</p>
              <h1 className="dx-pagehead__title">
                {q.data.name || 'Untitled site'}
              </h1>
            </div>
            <a
              className="dx-btn is-accent"
              href={q.data.url}
              target="_blank"
              rel="noreferrer"
            >
              <IconExternal /> Visit
            </a>
          </div>

          <div className="dx-panel">
            <h2 className="dx-panel__title">Overview</h2>
            <div className="dx-rows">
              <div className="dx-row">
                <span className="dx-row__k">Live URL</span>
                <span className="dx-row__v">
                  <a href={q.data.url} target="_blank" rel="noreferrer">
                    {q.data.url.replace(/^https?:\/\//, '')}
                  </a>{' '}
                  <CopyButton value={q.data.url} label="Copy URL" />
                </span>
              </div>
              <div className="dx-row">
                <span className="dx-row__k">Site id</span>
                <span className="dx-row__v" title={q.data.siteId}>
                  {fmt_id(q.data.siteId)}{' '}
                  <CopyButton value={q.data.siteId} label="Copy id" />
                </span>
              </div>
              <div className="dx-row">
                <span className="dx-row__k">Size</span>
                <span className="dx-row__v">
                  {site_size(q.data.sizeBytes, q.data.fileCount)}
                </span>
              </div>
              <div className="dx-row">
                <span className="dx-row__k">Files</span>
                <span className="dx-row__v">
                  {site_files(q.data.sizeBytes, q.data.fileCount)}
                </span>
              </div>
              <div className="dx-row">
                <span className="dx-row__k">Owner</span>
                <span className="dx-row__v" title={q.data.owner}>
                  {fmt_id(q.data.owner)}
                </span>
              </div>
              <div className="dx-row">
                <span className="dx-row__k">Created</span>
                <span className="dx-row__v">{fmt_date(q.data.createdAtMs)}</span>
              </div>
            </div>
          </div>

          <DomainsPanel
            site={q.data}
            isOwner={isOwner}
            onUnlinked={onLinked}
            onError={onError}
          />

          {/* Storage — expiry + subscribe (wallet popup) / extend-once (x402).
              Owner-only (same gate as the domain writes: presentation only; every
              write is signed and the payer must equal the site owner on-chain). */}
          {isOwner && viewerAddress && (
            <StoragePanel
              site={q.data}
              expiresAtMs={expiresAtMs}
              owner={viewerAddress}
              onOk={onLinked}
              onError={onError}
            />
          )}

          {isOwner && viewerAddress ? (
            adding ? (
              <AddDomainForm
                siteId={siteId}
                onLinked={onLinked}
                onError={onError}
              />
            ) : (
              <button
                type="button"
                className="dx-btn is-accent"
                onClick={() => setAdding(true)}
              >
                <IconPlus /> Add domain
              </button>
            )
          ) : (
            <OwnedByLine owner={q.data.owner} />
          )}
        </>
      )}
    </>
  )
}
