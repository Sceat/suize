// =============================================================================
// #/sites — "PAGE TWO OF THE DISPATCH" (owner-picked variant C, 2026-07-12).
// The connected wallet's dashboard reads as the second page of the same
// broadsheet the front page opens: running header, page-two masthead, dateline,
// each owned site a FILED EDITION (dossier marker + serif headline + byline +
// og-preview cut), the publish form the composing desk. Everything chain-derived
// from the wallet address (fetchOwnedSites); no off-chain store.
// =============================================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useCurrentAccount, useDAppKit } from '@mysten/dapp-kit-react'
import { ConnectButton } from '@mysten/dapp-kit-react/ui'
import { Folio } from './Folio'
import { DeployPanel } from './DeployPanel'
import { DomainRow } from './DomainRow'
import { fetchOwnedSites, type OwnedSite } from '../deploy/sites'
import { fetchSitePreview, type SitePreview } from '../deploy/preview'
import { extend } from '../deploy/pay'
import { mkKeypairSigner, mkWalletSigner } from '../deploy/signer'
import type { PaySigner } from '../deploy/pay'
import { explorerObject, explorerTx, dateLabel } from '../deploy/util'
import { getDevSigner } from '../viewer/devSigner'
import { navigate } from '../viewer/router'

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`

export function MySites() {
  const account = useCurrentAccount()
  const dAppKit = useDAppKit()
  const dev = useMemo(() => getDevSigner(), [])

  const address = dev?.address ?? account?.address ?? null
  const signer: PaySigner | null = useMemo(() => {
    if (dev) return mkKeypairSigner(dev.keypair)
    if (account)
      return mkWalletSigner(
        account.address,
        (args) => dAppKit.signTransaction(args),
        (args) => dAppKit.signPersonalMessage(args),
      )
    return null
  }, [dev, account, dAppKit])

  const [sites, setSites] = useState<OwnedSite[] | null>(null)
  const [error, setError] = useState(false)
  // Monotonic run token: on an address switch two fetches can race, and the
  // LAST-resolved (not last-requested) would win — only the newest run may land.
  const runRef = useRef(0)

  const refresh = useCallback(async () => {
    if (!address) {
      setSites(null)
      return
    }
    const run = ++runRef.current
    setError(false)
    try {
      const rows = await fetchOwnedSites(address)
      if (runRef.current === run) setSites(rows)
    } catch {
      if (runRef.current === run) setError(true)
    }
  }, [address])

  useEffect(() => {
    setSites(null) // address changed: show loading, never the previous wallet's list
    void refresh()
  }, [refresh])

  return (
    <>
      <Folio />
      <main className="wrap dash">
        <header className="dash__head">
          <div className="dash__runhead">
            <span className="dash__paper">The Suize Dispatch</span>
            <span className="dash__folio">Page Two · Your Desk</span>
          </div>
          <div className="dash__band">
            <h1 className="dash__title">My sites</h1>
            <p className="dash__standfirst">Every edition you have filed to Walrus, resolved from your address alone.</p>
          </div>
          <div className="dash__rule" />
          <div className="dash__rule--thin" />
          {address && (
            <div className="dash__dateline">
              <span className="dash__datelabel">Filed under</span>
              <span className="dash__addr mono">
                {dev ? 'dev · ' : ''}
                {short(address)}
              </span>
            </div>
          )}
        </header>

        {!address ? (
          <div className="dash__gate">
            <span className="dash__gatekicker">Subscriber access</span>
            <p className="dash__gatemsg">Connect your wallet to file new sites and manage the editions you own.</p>
            <ConnectButton />
            <p className="dash__gatenote">Your sites resolve from your address. Nothing to sign up for.</p>
          </div>
        ) : (
          <div className="dash__grid">
            <section className="dash__deploy">{signer && <DeployPanel signer={signer} onDeployed={() => void refresh()} />}</section>

            <section className="dash__list">
              {sites === null && !error && <p className="dash__loading">Reading the wire…</p>}
              {error && <p className="dmsg dmsg--err">Couldn’t read your sites. Check your connection and retry.</p>}
              {sites && sites.length === 0 && (
                <article className="filed filed--empty">
                  <div className="filed__marker">
                    <span className="filed__no mono">No 00</span>
                    <span className="filed__kicker">Awaiting copy</span>
                    <span className="filed__hair" />
                  </div>
                  <h3 className="filed__name">Nothing filed yet.</h3>
                  <p className="filed__standfirst">File your first edition on the desk to the left, or point an agent at this address.</p>
                </article>
              )}
              {sites &&
                sites.map((s, i) => (
                  <SiteCard key={s.siteId} index={i} site={s} signer={signer} onChanged={() => void refresh()} />
                ))}
            </section>
          </div>
        )}
      </main>
    </>
  )
}

function SiteCard({ index, site, signer, onChanged }: { index: number; site: OwnedSite; signer: PaySigner | null; onChanged: () => void }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  // The site's linked custom domains, reported up by DomainRow (chain-derived).
  const [customDomains, setCustomDomains] = useState<string[]>([])
  // Sync latch — a fast double-click must never fire two payments (state is async).
  const inFlight = useRef(false)

  // The og cut: fetched once per site (module cache), only for servable sites.
  const [preview, setPreview] = useState<SitePreview | null>(null)
  useEffect(() => {
    if (site.sealed || site.lapsed) return
    let alive = true
    void fetchSitePreview(site.siteId).then((p) => {
      if (alive) setPreview(p)
    })
    return () => {
      alive = false
    }
  }, [site.siteId, site.sealed, site.lapsed])

  const doExtend = async () => {
    if (!signer || inFlight.current) return
    inFlight.current = true
    setErr(null)
    setBusy(true)
    try {
      await extend({ signer, siteId: site.siteId, months: 1, sealed: site.sealed })
      await new Promise((r) => setTimeout(r, 900)) // chain lags a beat behind settle
      onChanged()
    } catch (e) {
      const msg = (e as Error)?.message ?? ''
      setErr(/reject|denied|cancel/i.test(msg) ? 'You cancelled the payment.' : "Couldn’t extend. Try again.")
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  const no = `No ${String(index + 1).padStart(2, '0')}`
  const kicker = site.lapsed ? 'Off the wire' : site.sealed ? 'Sealed edition' : 'Public edition'

  return (
    <article className={`filed${site.sealed ? ' filed--sealed' : ''}${site.lapsed ? ' filed--lapsed' : ''}`}>
      <div className="filed__marker">
        <span className="filed__no mono">{no}</span>
        <span className="filed__kicker">{kicker}</span>
        <span className="filed__hair" />
        <span className={`filed__ttl${site.lapsed ? ' is-lapsed' : ''}`}>{site.untilLabel}</span>
      </div>

      <div className="filed__body">
        <div className="filed__copy">
          <h3 className="filed__name">{site.name}</h3>

          {site.sealed ? (
            <span className="filed__host filed__host--sealed">Sealed · wallet-gated</span>
          ) : (
            <a className="filed__host" href={site.url} target="_blank" rel="noopener noreferrer">
              {site.host}
            </a>
          )}
          {customDomains.map((d) => (
            <a key={d} className="filed__host filed__host--custom" href={`https://${d}`} target="_blank" rel="noopener noreferrer">
              {d}
            </a>
          ))}

          {preview?.description && <p className="filed__desc">{preview.description}</p>}

          <p className="filed__byline">
            <span>Filed {dateLabel(site.createdAtMs)}</span>
            <span className="filed__sep">·</span>
            <span>{site.sizeLabel}</span>
            <span className="filed__sep">·</span>
            <span>{site.fileCount || '—'} files</span>
            <span className="filed__sep">·</span>
            <span>Paid through {site.paidThrough}</span>
          </p>
        </div>

        {preview?.image && (
          <figure className="filed__cut">
            <img src={preview.image} alt="" />
          </figure>
        )}
      </div>

      {err && <p className="dmsg dmsg--err">{err}</p>}

      <div className="filed__foot">
        {site.sealed ? (
          <button className="btn btn--ghost" onClick={() => navigate(`/view/${site.siteId}`)}>
            Open
          </button>
        ) : (
          <a className="btn btn--ghost" href={site.url} target="_blank" rel="noopener noreferrer">
            Visit ↗
          </a>
        )}
        <button className="btn btn--primary" disabled={busy || !signer} onClick={() => void doExtend()}>
          {busy ? 'Extending…' : site.lapsed ? 'Relist +1 mo' : 'Extend +1 mo'}
        </button>
        <span className="filed__ends">
          {site.receiptDigest && (
            <a className="filed__end" href={explorerTx(site.receiptDigest)} target="_blank" rel="noopener noreferrer">
              receipt ↗
            </a>
          )}
          <a className="filed__end" href={explorerObject(site.siteId)} target="_blank" rel="noopener noreferrer">
            on chain ↗
          </a>
        </span>
      </div>

      <DomainRow siteId={site.siteId} signer={signer} onDomains={setCustomDomains} />
    </article>
  )
}
