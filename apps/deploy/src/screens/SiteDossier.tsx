import './dossier.css'
import { useQuery } from '@tanstack/react-query'
import { useSuiClient } from '@mysten/dapp-kit'
import type { SiteInfo } from '@suize/shared'
import { fetch_site } from '../api'
import { fetch_site_onchain } from '../chain'
import { suivisionObject, suivisionAccount, walrusBlobUrl } from '../config'
import { useOwnerIdentity } from '../suins'
import { useDeploySub } from '../plan'
import type { OwnerIdentity } from '../chain'
import { fmt_date, fmt_id, site_size, site_files } from '../format'
import {
  CopyButton,
  EmptyState,
  LoadingState,
  describe_error,
  IconBack,
  IconCheck,
  IconExternal,
} from '../ui'
import { SitePreview, IconShield, IconBox, IconClock } from '../primitives'

// ============================================================================
// SITE DOSSIER — the Walrus PERMANENCE DOSSIER. The site-detail screen that proves
// the Walrus depth: a live browser-framed preview of the REAL site, the on-chain
// overview ledger, the WALRUS STORAGE anchors (quilt + manifest blob/object), the
// INTEGRITY anchor (the on-chain manifest hash re-checked on every byte served by
// the worker), the storage lifetime + plan status, and the linked domains.
//
// READ-ONLY — there are NO actions here. Reads DIRECTLY FROM CHAIN (the immutable
// shared `Site` object + its SiteCreated / Domain* events), so it works with the
// deploy backend offline. Every ACTION (subscribe / extend / cancel / domain
// link/unlink) is the AGENT's job through the Deploy API, never a human button on
// this page: Google-only login means a site is always owned by the agent's
// SUB-ACCOUNT, so there is no human owner to gate writes on. The owner is shown as
// "@mainhandle's agent" when it's a Suize sub-account (resolved on-chain).
// ============================================================================

const DAY_MS = 86_400_000

/** The expiry pill state for a storage window: amber within 14d, red within 3d. */
const expiryTone = (
  expiresAtMs: number | null | undefined,
): 'ok' | 'amber' | 'red' | 'unknown' => {
  if (expiresAtMs == null) return 'unknown'
  const left = expiresAtMs - Date.now()
  if (left <= 3 * DAY_MS) return 'red'
  if (left <= 14 * DAY_MS) return 'amber'
  return 'ok'
}

// A slim deployed → expiry timeline bar. Rendered only when BOTH ends are known
// (a real deployed timestamp + a real expiry); otherwise the caller omits it, so
// nothing is fabricated. The fill marks elapsed time within the window; its tone
// tracks the expiry pill (amber <14d, red <3d left).
const StorageTimeline = ({
  deployedMs,
  expiresAtMs,
  tone,
}: {
  deployedMs: number
  expiresAtMs: number
  tone: 'ok' | 'amber' | 'red'
}) => {
  const now = Date.now()
  const span = expiresAtMs - deployedMs
  // Guard a degenerate/inverted window: nothing meaningful to draw.
  if (!(span > 0)) return null
  const elapsed = Math.min(1, Math.max(0, (now - deployedMs) / span))
  return (
    <div className="sx-timeline" aria-hidden="true">
      <div className="sx-timeline__track">
        <span
          className={`sx-timeline__fill is-${tone}`}
          style={{ width: `${(elapsed * 100).toFixed(1)}%` }}
        />
      </div>
      <div className="sx-timeline__ends">
        <span className="sx-timeline__end">Deployed {fmt_date(deployedMs)}</span>
        <span className="sx-timeline__end">Paid through {fmt_date(expiresAtMs)}</span>
      </div>
    </div>
  )
}

// View-ONLY storage status — the live Walrus window + whether THIS site's account
// auto-renews. Subscribe / extend / cancel are AGENT operations through the Deploy
// API, never on this human view: Google-only login means the site is always owned
// by the agent's sub-account, so there is no human owner to act here.
const StoragePanel = ({
  site,
  expiresAtMs,
}: {
  site: SiteInfo
  /** The site's storage expiry (from the backend's /sites/:id read), or null. */
  expiresAtMs: number | null
}) => {
  // The site's account plan (owner = the agent sub-account) — shared chain read.
  const { sub, active } = useDeploySub(site.owner)

  const tone = expiryTone(expiresAtMs)
  // Pill copy + tone class for the live storage state.
  const pillClass =
    tone === 'red'
      ? 'sx-expiry is-red'
      : tone === 'amber'
        ? 'sx-expiry is-amber'
        : tone === 'ok'
          ? 'sx-expiry is-ok'
          : 'sx-expiry is-unknown'

  return (
    <div className="dx-panel sx-panel">
      <h2 className="dx-panel__title">
        <IconClock size={14} /> Storage lifetime
      </h2>

      {/* Live storage window — a pill (amber <14d, red <3d) over an optional
          deployed → expiry timeline (drawn only when both ends are real). */}
      <div className="sx-expiry-row">
        <span className="dx-row__k">Walrus storage</span>
        <span className={pillClass}>
          {expiresAtMs == null
            ? 'Window unknown'
            : tone === 'red'
              ? `Expires ${fmt_date(expiresAtMs)} · very soon`
              : tone === 'amber'
                ? `Expires ${fmt_date(expiresAtMs)} · soon`
                : `Expires ${fmt_date(expiresAtMs)}`}
        </span>
      </div>
      {expiresAtMs == null ? (
        <p className="dx-hint">
          The backend reads the live Walrus storage window — try again shortly.
        </p>
      ) : (
        tone !== 'unknown' &&
        site.createdAtMs > 0 && (
          <StorageTimeline
            deployedMs={site.createdAtMs}
            expiresAtMs={expiresAtMs}
            tone={tone}
          />
        )
      )}

      {active && sub ? (
        <p className="dx-hint">
          <b className="dx-linked-mark">
            <IconCheck size={13} /> Auto-renewal on
          </b>{' '}
          — this account's plan auto-renews the Walrus storage of every site it owns;
          paid through <b>{fmt_date(sub.paidUntilMs)}</b>.
        </p>
      ) : (
        <p className="dx-hint">
          No auto-renewal on this site's account — storage lapses at the date above
          unless extended. Your agent can subscribe or extend it through the Deploy
          API to keep it permanent.
        </p>
      )}
    </div>
  )
}

// Read-ONLY linked-domain list. Linking / unlinking a custom domain is an AGENT
// operation through the Deploy API (POST/DELETE /domains; the agent relays the DNS
// records to its human) — there is no human action on this view.
const DomainsPanel = ({ site }: { site: SiteInfo }) => {
  return (
    <div className="dx-panel sx-panel">
      <h2 className="dx-panel__title">Linked domains</h2>
      {site.domains.length === 0 ? (
        <p className="dx-hint">
          No custom domains yet. This site is always live at its free subdomain
          above. Custom domains are linked by your agent through the Deploy API.
        </p>
      ) : (
        site.domains.map(d => (
          <div key={d} className="dx-domain">
            <span className="dx-domain__name">{d}</span>
          </div>
        ))
      )}
    </div>
  )
}

// A site owner as a HUMAN label: their own `@handle` / hex, OR — when the owner is
// a Suize agent sub-account — the human MAIN member as "<handle>’s agent". `id` is
// null while resolving → falls back to the truncated owner address.
const OwnerLabel = ({ owner, id }: { owner: string; id: OwnerIdentity | null }) => {
  if (id?.kind === 'agent') {
    return <b>{id.mainHandle ? `${id.mainHandle}’s agent` : 'a Suize agent'}</b>
  }
  return <b>{id?.kind === 'direct' && id.handle ? id.handle : fmt_id(owner)}</b>
}

// For non-owners (incl. logged-out): in place of the add-domain form, a small
// "Owned by <name>@suize" line. Resolves site.owner to a human identity — a
// person, or a person's Suize agent — falling back to the truncated address.
// Display only — never gates anything.
const OwnedByLine = ({ owner }: { owner: string }) => {
  const id = useOwnerIdentity(owner)
  return (
    <p className="dx-hint" title={owner}>
      Owned by <OwnerLabel owner={owner} id={id} />. Only the owner can add or
      remove custom domains.
    </p>
  )
}

// ---- Dossier-local presentation helpers -------------------------------------

// One ledger row in a dossier panel — a key, a dotted leader (via .dx-row), and a
// value. `mono` typesets the value as a chain id/hash. Reuses the .dx-row family.
const LedgerRow = ({
  k,
  children,
}: {
  k: string
  children: React.ReactNode
}) => (
  <div className="dx-row">
    <span className="dx-row__k">{k}</span>
    <span className="dx-row__v">{children}</span>
  </div>
)

// The serif name + mono live URL (copy + external) hero column, beside the
// browser-framed live preview.
const OwnerName = ({ owner }: { owner: string }) => {
  const id = useOwnerIdentity(owner)
  const label =
    id?.kind === 'agent'
      ? id.mainHandle
        ? `${id.mainHandle}’s agent`
        : 'Suize agent'
      : id?.kind === 'direct' && id.handle
        ? id.handle
        : fmt_id(owner)
  return (
    <a
      href={suivisionAccount(owner)}
      target="_blank"
      rel="noreferrer"
      title={owner}
    >
      {label}
    </a>
  )
}

export const SiteDossier = ({
  siteId,
  onBack,
}: {
  siteId: string
  onBack: () => void
}) => {
  const client = useSuiClient()

  const q = useQuery({
    queryKey: ['site', siteId],
    queryFn: () => fetch_site_onchain(client, siteId),
    retry: false,
  })
  // The on-chain read has no storage lifecycle; the backend's /sites/:id computes
  // the live Walrus storage end-epoch + expiresAtMs. A separate, non-blocking query
  // (the dossier works without it; the Storage card just shows "unknown").
  const storageQ = useQuery({
    queryKey: ['site-storage', siteId],
    queryFn: () => fetch_site(siteId),
    staleTime: 60_000,
    retry: false,
  })
  const expiresAtMs = storageQ.data?.expiresAtMs ?? null

  return (
    <>
      <button type="button" className="dx-back" onClick={onBack}>
        <IconBack /> All sites
      </button>

      {q.isLoading && <LoadingState label="Loading the dossier…" />}
      {q.isError && <EmptyState {...describe_error(q.error)} />}

      {q.isSuccess && (
        <>
          {/* HERO — a live browser-framed preview beside the edition lockup. */}
          <header className="sx-hero ed-stream">
            <figure className="sx-viewport">
              <div className="sx-viewport__bar">
                <span className="sx-viewport__lamps" aria-hidden="true">
                  <span /><span /><span />
                </span>
                <span className="sx-viewport__host mono">
                  {q.data.url.replace(/^https?:\/\//, '')}
                </span>
              </div>
              <a
                className="sx-viewport__screen"
                href={q.data.url}
                target="_blank"
                rel="noreferrer"
                aria-label={`Open ${q.data.name || 'this site'} in a new tab`}
              >
                <SitePreview url={q.data.url} eager aspect="16 / 9" />
              </a>
            </figure>

            <div className="sx-lockup">
              <p className="ed-eyebrow">Permanence dossier</p>
              <h1 className="sx-title">{q.data.name || 'Untitled site'}</h1>

              <a
                className="sx-url"
                href={q.data.url}
                target="_blank"
                rel="noreferrer"
              >
                <span className="sx-url__text mono">
                  {q.data.url.replace(/^https?:\/\//, '')}
                </span>
              </a>
              <span className="sx-url__copy">
                <CopyButton value={q.data.url} label="Copy URL" />
              </span>

              <div className="sx-hero__seal">
                <span className="sx-seal">
                  <IconShield size={13} /> Integrity-verified on Walrus
                </span>
              </div>

              <div className="sx-hero__actions">
                <a
                  className="dx-btn is-accent"
                  href={q.data.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  <IconExternal /> Visit
                </a>
              </div>
            </div>
          </header>

          {/* OVERVIEW — the on-chain Site record as a broadsheet ledger. */}
          <section className="dx-panel sx-panel">
            <h2 className="dx-panel__title">Overview</h2>
            <div className="dx-rows">
              <LedgerRow k="Live URL">
                <a href={q.data.url} target="_blank" rel="noreferrer">
                  {q.data.url.replace(/^https?:\/\//, '')}
                </a>{' '}
                <CopyButton value={q.data.url} label="Copy URL" />
              </LedgerRow>
              <LedgerRow k="Site id">
                <a
                  href={suivisionObject(q.data.siteId)}
                  target="_blank"
                  rel="noreferrer"
                  title={q.data.siteId}
                >
                  {fmt_id(q.data.siteId)}
                </a>{' '}
                <CopyButton value={q.data.siteId} label="Copy id" />
              </LedgerRow>
              <LedgerRow k="Owner">
                <OwnerName owner={q.data.owner} />
              </LedgerRow>
              <LedgerRow k="Size">{site_size(q.data.sizeBytes, q.data.fileCount)}</LedgerRow>
              <LedgerRow k="Files">{site_files(q.data.sizeBytes, q.data.fileCount)}</LedgerRow>
              <LedgerRow k="Version">{q.data.version}</LedgerRow>
              <LedgerRow k="Created">{fmt_date(q.data.createdAtMs)}</LedgerRow>
            </div>
          </section>

          {/* WALRUS STORAGE — the differentiator: the quilt + manifest anchors. */}
          <section className="dx-panel sx-panel">
            <h2 className="dx-panel__title">
              <IconBox size={14} /> Walrus storage
            </h2>
            <div className="dx-rows">
              <LedgerRow k="Quilt id">
                <span className="mono" title={q.data.quiltId}>
                  {q.data.quiltId ? fmt_id(q.data.quiltId) : '—'}
                </span>{' '}
                {q.data.quiltId && (
                  <CopyButton value={q.data.quiltId} label="Copy quilt id" />
                )}
              </LedgerRow>
              <LedgerRow k="Manifest blob">
                {q.data.manifestBlobId ? (
                  <>
                    <span className="mono" title={q.data.manifestBlobId}>
                      {fmt_id(q.data.manifestBlobId)}
                    </span>{' '}
                    <CopyButton
                      value={q.data.manifestBlobId}
                      label="Copy manifest blob id"
                    />{' '}
                    <a
                      href={walrusBlobUrl(q.data.manifestBlobId)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      View manifest
                    </a>
                  </>
                ) : (
                  '—'
                )}
              </LedgerRow>
              <LedgerRow k="Quilt blob object">
                {q.data.quiltBlobObject ? (
                  <a
                    href={suivisionObject(q.data.quiltBlobObject)}
                    target="_blank"
                    rel="noreferrer"
                    title={q.data.quiltBlobObject}
                  >
                    {fmt_id(q.data.quiltBlobObject)}
                  </a>
                ) : (
                  '—'
                )}
              </LedgerRow>
              <LedgerRow k="Manifest blob object">
                {q.data.manifestBlobObject ? (
                  <a
                    href={suivisionObject(q.data.manifestBlobObject)}
                    target="_blank"
                    rel="noreferrer"
                    title={q.data.manifestBlobObject}
                  >
                    {fmt_id(q.data.manifestBlobObject)}
                  </a>
                ) : (
                  '—'
                )}
              </LedgerRow>
            </div>
            <p className="dx-hint">
              The site's files live on Walrus as one <b>quilt</b> plus a{' '}
              <b>manifest</b> blob — the manifest maps each path to its quilt patch.
            </p>
          </section>

          {/* INTEGRITY — the on-chain manifest hash, the serve-time anchor. */}
          <section className="dx-panel sx-panel sx-integrity">
            <h2 className="dx-panel__title">
              <IconShield size={14} /> Integrity
            </h2>
            <div className="sx-anchor">
              <span className="sx-anchor__k">Integrity anchor</span>
              <code className="sx-anchor__hash mono">
                {q.data.manifestHashHex
                  ? `0x${q.data.manifestHashHex}`
                  : '—'}
              </code>
              {q.data.manifestHashHex && (
                <CopyButton
                  value={`0x${q.data.manifestHashHex}`}
                  label="Copy integrity anchor"
                />
              )}
            </div>
            <p className="dx-hint sx-integrity__note">
              <span className="sx-integrity__seal">
                <IconShield size={13} />
              </span>
              Every byte served is re-hashed against this on-chain anchor at request
              time — a mismatch is never served.
            </p>
          </section>

          {/* STORAGE LIFETIME — view-only: the live Walrus window + whether this
              site's account auto-renews. Subscribe/extend are agent-via-API. */}
          <StoragePanel site={q.data} expiresAtMs={expiresAtMs} />

          {/* DOMAINS — read-only list; linking is an agent-via-API operation. */}
          <DomainsPanel site={q.data} />

          <OwnedByLine owner={q.data.owner} />
        </>
      )}
    </>
  )
}
