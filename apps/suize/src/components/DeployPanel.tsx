// The publish form — pick a folder, name it, choose months + privacy, pay the
// gasless x402 charge with the connected wallet (or the dev keypair), get a live
// URL. The price is the worker's OWN 402 amount, shown on the confirm button; no
// number here is invented (the facilitator re-checks the split at settle).

import { useRef, useState } from 'react'
import { formatUsdc } from '@suize/x402'
import { maxDeployMonths, SEAL_KEY_SERVERS } from '@suize/shared'
import type { PaySigner } from '../deploy/pay'
import type { Stage } from '../deploy/pay'
import { deploy, deployPriceAtomic, type DeployResult } from '../deploy/pay'
import { filesFromDataTransfer, tarFromFiles, type TarResult } from '../deploy/tar'
import { NETWORK } from '../config'

const STAGE_LABEL: Record<Stage, string> = {
  quoting: 'Reading the price…',
  building: 'Preparing the payment…',
  signing: 'Waiting for your wallet…',
  publishing: 'Publishing to Walrus…',
}

// Month presets, filtered to what Walrus can fund in one store on this network
// (the single source of truth in @suize/shared). Mainnet keeps [1,3,6,12,24];
// testnet's fast epochs collapse it to [1]. Always non-empty (1 always fits).
const MONTHS = [1, 3, 6, 12, 24].filter((m) => m <= maxDeployMonths(NETWORK))

const monthLabel = (m: number): string => (m === 24 ? '2 yr' : m === 12 ? '1 yr' : `${m} mo`)

export function DeployPanel({ signer, onDeployed }: { signer: PaySigner; onDeployed: (r: DeployResult) => void }) {
  const fileRef = useRef<HTMLInputElement>(null)
  // Sync re-entry latch: React state updates are async, so a fast double-click
  // could fire two payments before `busy` re-renders. The ref latches instantly.
  const inFlight = useRef(false)
  const [tar, setTar] = useState<TarResult | null>(null)
  const [name, setName] = useState('')
  const [months, setMonths] = useState<number>(1)
  const [sealed, setSealed] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [stage, setStage] = useState<Stage | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<DeployResult | null>(null)
  // `sealed` is a form field that keeps ticking after publish (e.g. "Publish
  // another"); the done card needs the value AS PAID, so it's captured alongside
  // the result rather than read live off the form.
  const [doneSealed, setDoneSealed] = useState(false)

  const busy = stage !== null
  // The price shown = the merchant's own constant (@suize/shared); pay.ts asserts
  // the 402's declared terms equal this exact figure before anything is signed.
  const price = formatUsdc(deployPriceAtomic(months, sealed))

  const onPick = async (files: FileList | File[] | null) => {
    setError(null)
    if (!files || files.length === 0) return
    try {
      const arr = Array.from(files)
      const built = await tarFromFiles(arr)
      setTar(built)
      if (!name) {
        const first =
          (arr[0] as File & { webkitRelativePath?: string; suizePath?: string }).suizePath ||
          (arr[0] as File & { webkitRelativePath?: string }).webkitRelativePath ||
          ''
        const folder = first.includes('/') ? first.slice(0, first.indexOf('/')) : ''
        setName(folder || 'site')
      }
    } catch (e) {
      setTar(null)
      setError((e as Error).message)
    }
  }

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    if (busy) return
    void onPick(await filesFromDataTransfer(e.dataTransfer))
  }

  const publish = async () => {
    if (!tar || inFlight.current) return
    inFlight.current = true
    setError(null)
    setResult(null)
    try {
      const r = await deploy({ signer, tar: tar.tar, name: name.trim() || 'site', months, sealed, onStage: setStage })
      setDoneSealed(sealed)
      setResult(r)
      onDeployed(r)
      // reset the picker so a second deploy starts clean
      setTar(null)
      if (fileRef.current) fileRef.current.value = ''
    } catch (e) {
      const msg = (e as Error)?.message ?? 'Something went wrong.'
      setError(/reject|denied|cancel/i.test(msg) ? 'You cancelled the payment.' : msg)
    } finally {
      inFlight.current = false
      setStage(null)
    }
  }

  if (result) {
    return (
      <div className="dpanel dpanel--done">
        <div className="dpanel__marker">
          <span className="dpanel__no mono">No —</span>
          <span className="dpanel__eyebrow">Off the press</span>
          <span className="dpanel__hair" />
        </div>
        <h3 className="dpanel__title">{doneSealed ? 'Your private site is ready.' : result.url ? 'Your site is live.' : 'Published.'}</h3>
        {doneSealed ? (
          <a className="dpanel__url mono" href={`#/view/${result.siteId}`}>
            Open it ↗
          </a>
        ) : result.url ? (
          <a className="dpanel__url mono" href={result.url} target="_blank" rel="noopener noreferrer">
            {result.url.replace(/^https?:\/\//, '')} ↗
          </a>
        ) : (
          <p className="dpanel__body">Private site published. Open it from the list below.</p>
        )}
        <button className="btn btn--ghost" onClick={() => setResult(null)}>
          Publish another
        </button>
      </div>
    )
  }

  return (
    <div className="dpanel">
      <div className="dpanel__marker">
        <span className="dpanel__no mono">No —</span>
        <span className="dpanel__eyebrow">File a new edition</span>
        <span className="dpanel__hair" />
      </div>

      <input
        ref={fileRef}
        className="dpanel__file"
        type="file"
        multiple
        onChange={(e) => void onPick(e.target.files)}
        {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
      />

      <div
        className={`dropzone${tar ? ' dropzone--ready' : ''}${dragOver ? ' dropzone--drag' : ''}`}
        role="button"
        tabIndex={0}
        onClick={() => fileRef.current?.click()}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && fileRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => void onDrop(e)}
      >
        {tar ? (
          <>
            <b className="dropzone__count">{tar.fileCount} files</b>
            <span className="dropzone__hint mono">{(tar.totalBytes / 1024).toFixed(0)} KB · click to change</span>
          </>
        ) : (
          <>
            <b className="dropzone__count">Drop your site folder</b>
            <span className="dropzone__hint">or click to browse. A built static site with an index.html at its root.</span>
          </>
        )}
      </div>

      <div className="dfield">
        <label className="dfield__label" htmlFor="dp-name">
          Name
        </label>
        <input
          id="dp-name"
          className="dfield__input"
          value={name}
          maxLength={64}
          placeholder="my-site"
          spellCheck={false}
          onChange={(e) => setName(e.target.value)}
        />
      </div>

      <div className="dfield">
        <span className="dfield__label">Run it for</span>
        <div className="segmented">
          {MONTHS.map((m) => (
            <button
              key={m}
              className={`segmented__opt${months === m ? ' is-on' : ''}`}
              onClick={() => setMonths(m)}
              type="button"
            >
              {monthLabel(m)}
            </button>
          ))}
        </div>
      </div>

      {/* The Private (Seal) toggle shows wherever a verified key-server committee
          exists for this network; populating SEAL_KEY_SERVERS in @suize/shared is
          what unlocks a network. An empty list hides the toggle so `sealed` stays
          false and a deploy is never charged the 2x sealed price for a private
          site that would fail after payment. */}
      {SEAL_KEY_SERVERS[NETWORK].length > 0 && (
        <button
          className={`statusrow${sealed ? ' statusrow--on' : ''}`}
          type="button"
          onClick={() => setSealed((s) => !s)}
          aria-pressed={sealed}
        >
          <span className="statusrow__dot" />
          <span className="statusrow__label">Private</span>
          <span className="statusrow__note">{sealed ? 'Only wallets you allow can open it' : 'Anyone with the link can open it'}</span>
        </button>
      )}

      {error && <p className="dmsg dmsg--err">{error}</p>}

      <button className="btn btn--primary dpanel__go" disabled={!tar || busy} onClick={() => void publish()}>
        {busy ? STAGE_LABEL[stage as Stage] : tar ? `Pay $${price} and publish` : 'Choose a folder first'}
      </button>
      <p className="dpanel__foot mono">Gasless USDC · you sign locally · whoever pays, owns</p>
    </div>
  )
}
