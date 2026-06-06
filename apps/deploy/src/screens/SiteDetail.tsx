import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { DomainChallengeResponse, SiteInfo } from '@suize/shared'
import { fetch_site, link_domain, unlink_domain } from '../api'
import { fmt_date, fmt_id, site_size, site_files } from '../format'
import {
  CopyButton,
  EmptyState,
  LoadingState,
  describe_error,
  IconBack,
  IconExternal,
  IconPlus,
} from '../ui'

// ============================================================================
// SITE DETAIL — URL + copy, on-chain meta, linked domains with unlink, and the
// "Add domain" flow: POST /domains returns the DNS TXT challenge (name+value)
// + CNAME target the user must add; the backend then verifies + links on-chain.
// All real API calls; graceful states throughout.
// ============================================================================

const ChallengeView = ({
  challenge,
}: {
  challenge: DomainChallengeResponse
}) => (
  <>
    <p className="dx-hint">
      Add these two DNS records at your registrar, then re-check. The backend
      verifies the TXT record proves ownership before linking{' '}
      <b>{challenge.domain}</b> on-chain.
    </p>

    <div className="dx-record">
      <div className="dx-record__type">TXT — ownership challenge</div>
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
      <div className="dx-record__type">CNAME — point your domain</div>
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

    <p className="dx-hint">
      Status: <b>{challenge.status}</b>. Once the TXT record propagates the
      backend completes the on-chain link automatically.
    </p>
  </>
)

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
  const qc = useQueryClient()

  const m = useMutation({
    mutationFn: (d: string) => link_domain(siteId, d.trim().toLowerCase()),
    onSuccess: res => {
      setChallenge(res)
      if (res.status === 'linked') {
        onLinked(`Linked ${res.domain}`)
        void qc.invalidateQueries({ queryKey: ['site', siteId] })
      } else {
        onLinked(`Challenge issued for ${res.domain}`)
      }
    },
    onError: e => onError(describe_error(e).title),
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
        onKeyDown={e => {
          if (e.key === 'Enter' && valid && !m.isPending) m.mutate(domain)
        }}
      />
      <div className="dx-form-actions">
        <button
          type="button"
          className="dx-btn is-accent"
          disabled={!valid || m.isPending}
          onClick={() => m.mutate(domain)}
        >
          {m.isPending ? 'Requesting…' : 'Get DNS records'}
        </button>
      </div>

      {m.isError && (
        <p className="dx-error">{describe_error(m.error).title}</p>
      )}

      {challenge && <ChallengeView challenge={challenge} />}
    </div>
  )
}

const DomainsPanel = ({
  site,
  onUnlinked,
  onError,
}: {
  site: SiteInfo
  onUnlinked: (msg: string) => void
  onError: (msg: string) => void
}) => {
  const qc = useQueryClient()
  const m = useMutation({
    mutationFn: (d: string) => unlink_domain(d),
    onSuccess: (_res, d) => {
      onUnlinked(`Unlinked ${d}`)
      void qc.invalidateQueries({ queryKey: ['site', site.siteId] })
    },
    onError: e => onError(describe_error(e).title),
  })

  return (
    <div className="dx-panel">
      <h2 className="dx-panel__title">Linked domains</h2>
      {site.domains.length === 0 ? (
        <p className="dx-hint">
          No custom domains yet. Your site is always live at its free subdomain
          above. Add a domain below to point your own at it.
        </p>
      ) : (
        site.domains.map(d => (
          <div key={d} className="dx-domain">
            <span className="dx-domain__name">{d}</span>
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
              {m.isPending && m.variables === d ? 'Unlinking…' : 'Unlink'}
            </button>
          </div>
        ))
      )}
    </div>
  )
}

export const SiteDetail = ({
  siteId,
  onBack,
  onLinked,
  onError,
}: {
  siteId: string
  onBack: () => void
  onLinked: (msg: string) => void
  onError: (msg: string) => void
}) => {
  const [adding, setAdding] = useState(false)
  const q = useQuery({
    queryKey: ['site', siteId],
    queryFn: () => fetch_site(siteId),
    retry: false,
  })

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

          <DomainsPanel site={q.data} onUnlinked={onLinked} onError={onError} />

          {adding ? (
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
          )}
        </>
      )}
    </>
  )
}
