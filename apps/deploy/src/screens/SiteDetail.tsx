import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  useSignPersonalMessage,
  useSignTransaction,
  useSuiClient,
} from '@mysten/dapp-kit'
import type { DomainChallengeResponse, SiteInfo } from '@suize/shared'
import {
  DEPLOY_SUB_PERIOD_CAP,
  DEPLOY_SUB_PERIOD_MS,
  DEPLOY_SUB_PRICE_USDC,
  PACKAGE_IDS,
  buildDeployLinkAuthMessage,
  buildDeployRenewalLinkAuthMessage,
  buildDeployRenewalUnlinkAuthMessage,
  buildDeployUnlinkAuthMessage,
} from '@suize/shared'
import {
  build_deploy_subscribe,
  execute_sponsored,
  get_nonce,
  link_domain_issue,
  link_domain_verify,
  link_renewal,
  unlink_domain,
  unlink_renewal,
} from '../api'
import { fetch_site_onchain } from '../chain'
import { RailAccountField, useRailAccount } from '../rail'
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

  // VERIFY & LINK — explicit, user-initiated, SIGNED. Fetch a fresh single-use
  // nonce → sign buildDeployLinkAuthMessage(domain, siteId, nonce) with the
  // zkLogin signer → POST verify=1 with { nonce, signature }. The backend re-reads
  // DNS (txtOk/cnameOk), recovers the signer == Site.owner, and links on-chain +
  // provisions SSL once both records pass. Each click signs fresh (nonce is burned
  // server-side per verify) — that is expected, surfaced in the hint copy.
  const verify = useMutation({
    mutationFn: async () => {
      const d = domain.trim().toLowerCase()
      const { nonce } = await get_nonce()
      const message = new TextEncoder().encode(
        buildDeployLinkAuthMessage(d, siteId, nonce),
      )
      setVerifyPhase('signing')
      const { signature } = await signPersonalMessage({ message })
      setVerifyPhase('verifying')
      return link_domain_verify(siteId, d, nonce, signature)
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
// STORAGE AUTO-RENEWAL — the Deploy subscription (LOCKED #10): $19.99/mo on the
// rail auto-renews this site's Walrus storage + unlocks custom domains. Flow:
//   subscribe: POST /deploy/subscribe { account, sender } → sign the SPONSORED
//   bytes LOCALLY as a TRANSACTION (zkLogin, useSignTransaction) → POST /execute
//   → read SubscriptionCreated off the executed tx (sub_key) → sign
//   buildDeployRenewalLinkAuthMessage as a PERSONAL MESSAGE (the domain-link
//   pattern) → POST /deploy/renewal.
// State lives in localStorage ({accountId, subKey, digest} after linking) — a
// cheap honest mirror; the on-chain RenewalRegistry is the real record. A sub
// that settled but failed to LINK persists separately so a retry finishes the
// link WITHOUT creating (and paying) a second subscription.
// ON-CHAIN LAW: create_subscription stamps last_charged_ms = NOW, so the FIRST
// renewal charge lands one full period (30 days) AFTER subscribing; renewals
// then recur silently — the per-period cap + cancel are the leash.
// ============================================================================

type RenewalLink = { accountId: string; subKey: number; digest: string }
type PendingSub = { accountId: string; subKey: number }

const renewal_key = (siteId: string) => `suize-deploy.renewal.${siteId}`
const pending_sub_key = (siteId: string) => `suize-deploy.renewal-pending.${siteId}`

const load_json = <T,>(key: string): T | null => {
  try {
    const raw = window.localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

const store_json = (key: string, value: unknown): void => {
  try {
    if (value == null) window.localStorage.removeItem(key)
    else window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* storage blocked — in-memory state still covers this session */
  }
}

const SUBSCRIPTION_CREATED_TYPE = `${PACKAGE_IDS.ACCOUNT.PACKAGE}::account::SubscriptionCreated`

const SUB_PERIOD_DAYS = Math.round(DEPLOY_SUB_PERIOD_MS / 86_400_000)

const RenewalPanel = ({
  siteId,
  owner,
  onOk,
  onError,
}: {
  siteId: string
  /** The viewer's connected address (== Site.owner — the panel is owner-gated). */
  owner: string
  onOk: (msg: string) => void
  onError: (msg: string) => void
}) => {
  const client = useSuiClient()
  const rail = useRailAccount(owner)
  const { mutateAsync: signTransaction } = useSignTransaction()
  const { mutateAsync: signPersonalMessage } = useSignPersonalMessage()
  const [link, setLink] = useState<RenewalLink | null>(() =>
    load_json<RenewalLink>(renewal_key(siteId)),
  )
  const [pending, setPending] = useState<PendingSub | null>(() =>
    load_json<PendingSub>(pending_sub_key(siteId)),
  )
  const [phase, setPhase] = useState<
    'idle' | 'building' | 'signing' | 'settling' | 'linking'
  >('idle')

  const subscribe = useMutation({
    mutationFn: async (): Promise<RenewalLink> => {
      // Resume a created-but-unlinked subscription first — NEVER subscribe (and
      // charge a second monthly leash) twice for one site.
      let sub = load_json<PendingSub>(pending_sub_key(siteId))
      if (!sub) {
        if (!rail.valid) {
          throw new Error(
            'A funded rail Account id is required to subscribe.',
          )
        }
        setPhase('building')
        const built = await build_deploy_subscribe({
          account: rail.account,
          sender: owner,
        })
        setPhase('signing')
        // Sponsored TX bytes — signed VERBATIM by the local zkLogin session.
        const { signature } = await signTransaction({ transaction: built.bytes })
        setPhase('settling')
        const executed = await execute_sponsored({
          digest: built.digest,
          signature,
        })
        // The sub_key comes from the SubscriptionCreated event on the executed tx.
        const full = await client.waitForTransaction({
          digest: executed.digest,
          options: { showEvents: true },
        })
        const ev = (full.events ?? []).find(
          e => e.type === SUBSCRIPTION_CREATED_TYPE,
        )
        const json = (ev?.parsedJson ?? {}) as {
          account_id?: string
          sub_key?: string | number
        }
        if (json.sub_key == null) {
          throw new Error(
            'Subscription settled but its SubscriptionCreated event was not found — retry to finish linking.',
          )
        }
        sub = { accountId: rail.account, subKey: Number(json.sub_key) }
        store_json(pending_sub_key(siteId), sub)
        setPending(sub)
      }

      // Link the subscription to THIS site's renewal — the domain-link signing
      // pattern (fresh nonce + op-bound personal message).
      setPhase('linking')
      const { nonce } = await get_nonce()
      const message = new TextEncoder().encode(
        buildDeployRenewalLinkAuthMessage(siteId, sub.accountId, sub.subKey, nonce),
      )
      const { signature } = await signPersonalMessage({ message })
      const res = await link_renewal({
        siteId,
        accountId: sub.accountId,
        subKey: sub.subKey,
        nonce,
        signature,
      })
      store_json(pending_sub_key(siteId), null)
      return { accountId: res.accountId, subKey: res.subKey, digest: res.digest }
    },
    onSuccess: l => {
      store_json(renewal_key(siteId), l)
      setLink(l)
      setPending(null)
      onOk('Storage auto-renewal is on')
    },
    onError: e => onError(describe_error(e).title),
    onSettled: () => setPhase('idle'),
  })

  const cancel = useMutation({
    mutationFn: async () => {
      if (!link) throw new Error('No active renewal to cancel.')
      const { nonce } = await get_nonce()
      const message = new TextEncoder().encode(
        buildDeployRenewalUnlinkAuthMessage(link.accountId, link.subKey, nonce),
      )
      const { signature } = await signPersonalMessage({ message })
      return unlink_renewal({
        accountId: link.accountId,
        subKey: link.subKey,
        nonce,
        signature,
      })
    },
    onSuccess: () => {
      store_json(renewal_key(siteId), null)
      setLink(null)
      onOk('Auto-renewal cancelled')
    },
    onError: e => onError(describe_error(e).title),
  })

  if (link) {
    return (
      <div className="dx-panel">
        <h2 className="dx-panel__title">Storage auto-renewal</h2>
        <p className="dx-hint">
          <b className="dx-linked-mark">
            <IconCheck size={13} /> Auto-renewal linked
          </b>{' '}
          — Suize renews this site's Walrus storage on your subscription.
          Renewals recur silently once approved; the first charge lands one full
          period ({SUB_PERIOD_DAYS} days) after you subscribed.
        </p>
        <div className="dx-rows">
          <div className="dx-row">
            <span className="dx-row__k">Plan</span>
            <span className="dx-row__v tnum">
              {fmt_usdc(DEPLOY_SUB_PRICE_USDC)} / {SUB_PERIOD_DAYS} days
              (on-chain per-period cap {fmt_usdc(DEPLOY_SUB_PERIOD_CAP)})
            </span>
          </div>
          <div className="dx-row">
            <span className="dx-row__k">Rail account</span>
            <span className="dx-row__v" title={link.accountId}>
              {fmt_id(link.accountId)}
            </span>
          </div>
          <div className="dx-row">
            <span className="dx-row__k">Subscription</span>
            <span className="dx-row__v tnum">#{link.subKey}</span>
          </div>
          <div className="dx-row">
            <span className="dx-row__k">Link digest</span>
            <span className="dx-row__v" title={link.digest}>
              {fmt_id(link.digest)}{' '}
              <CopyButton value={link.digest} label="Copy digest" />
            </span>
          </div>
        </div>
        <div className="dx-form-actions">
          <button
            type="button"
            className="dx-btn is-danger"
            disabled={cancel.isPending}
            onClick={() => {
              if (
                window.confirm(
                  'Cancel auto-renewal? Suize stops renewing this site\'s Walrus storage; the site stays live until its current storage period ends. The subscription itself stays on your rail Account — cancel it there to remove the leash entirely.',
                )
              )
                cancel.mutate()
            }}
          >
            {cancel.isPending ? 'Cancelling…' : 'Cancel auto-renewal'}
          </button>
        </div>
        {cancel.isError && (
          <p className="dx-error">{describe_error(cancel.error).title}</p>
        )}
      </div>
    )
  }

  return (
    <div className="dx-panel">
      <h2 className="dx-panel__title">Storage auto-renewal</h2>
      <p className="dx-hint">
        Subscribe for <b>{fmt_usdc(DEPLOY_SUB_PRICE_USDC)}/mo</b> — auto-renews
        this site's Walrus storage so it never expires + unlocks custom domains;
        cancel anytime. The subscription is an on-chain leash: each period can
        debit at most {fmt_usdc(DEPLOY_SUB_PERIOD_CAP)}, and the FIRST renewal
        charge happens one full period ({SUB_PERIOD_DAYS} days) after
        subscribing — that's on-chain law, not policy.
      </p>
      {pending ? (
        <p className="dx-hint" title={pending.accountId}>
          Your subscription (<b className="tnum">#{pending.subKey}</b> on
          Account {fmt_id(pending.accountId)}) is settled on-chain but not yet
          linked to this site — finish the link below (a signature, no new
          charge).
        </p>
      ) : (
        <RailAccountField rail={rail} idPrefix="renewal" owner={owner} />
      )}
      <div className="dx-form-actions">
        <button
          type="button"
          className="dx-btn is-accent"
          disabled={subscribe.isPending || (!pending && !rail.valid)}
          onClick={() => subscribe.mutate()}
        >
          {phase === 'building'
            ? 'Building subscription…'
            : phase === 'signing'
              ? 'Approve in wallet…'
              : phase === 'settling'
                ? 'Settling…'
                : phase === 'linking'
                  ? 'Linking renewal…'
                  : pending
                    ? 'Finish linking'
                    : `Subscribe — ${fmt_usdc(DEPLOY_SUB_PRICE_USDC)}/mo`}
        </button>
      </div>
      {subscribe.isError && (
        <p className="dx-error">{describe_error(subscribe.error).title}</p>
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
    // UNLINK is CRYPTOGRAPHICALLY SIGNED — fetch a fresh nonce → sign
    // buildDeployUnlinkAuthMessage(domain, nonce) with the zkLogin signer → DELETE
    // with { nonce, signature }. The backend recovers signer == Site.owner. Only
    // the owner can produce a valid signature, so the backend is the authority.
    mutationFn: async (d: string) => {
      const { nonce } = await get_nonce()
      const message = new TextEncoder().encode(
        buildDeployUnlinkAuthMessage(d, nonce),
      )
      setSigning(d)
      const { signature } = await signPersonalMessage({ message })
      setSigning(null)
      return unlink_domain(d, nonce, signature)
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

          {/* Storage auto-renewal — owner-only (same gate as the domain writes:
              presentation only; the backend verifies every signature). */}
          {isOwner && viewerAddress && (
            <RenewalPanel
              siteId={siteId}
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
