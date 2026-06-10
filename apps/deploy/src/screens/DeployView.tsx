import { useCallback, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSignPersonalMessage, useSignTransaction } from '@mysten/dapp-kit'
import {
  buildDeployAuthMessage,
  type DeployQuoteResponse,
  type DeployResponse,
} from '@suize/shared'
import {
  DeployApiError,
  build_deploy_charge,
  deploy_site,
  execute_sponsored,
  get_deploy_quote,
  get_nonce,
} from '../api'
import {
  files_to_pack,
  normalize_entry_path,
  pack_tar,
  total_bytes,
  type PackFile,
} from '../pack'
import { RailAccountField, useRailAccount } from '../rail'
import { fmt_bytes, fmt_id, fmt_usdc } from '../format'
import {
  CopyButton,
  EmptyState,
  describe_error,
  IconBack,
  IconExternal,
  IconPress,
} from '../ui'

// ============================================================================
// DEPLOY (manual) — drag-drop a BUILT static folder (or pick one), pack it into
// a single `site.tar` client-side (src/pack.ts), POST /deploy (the SAME route
// agents use), and show the resulting live URL. For humans testing; the agent
// path POSTs a tar directly. Real upload; honest empty/error states.
//
// PAYMENT — when the CHARGE↔Deploy join is live (GET /deploy/quote returns 200),
// a deploy is a one-off $0.50 `charge` on the rail FIRST: build the sponsored
// charge PTB (backend) → sign the bytes LOCALLY with the zkLogin session
// (useSignTransaction — sponsored TX bytes, not a personal message) → POST
// /execute → deploy WITH chargeDigest. The executed digest persists in
// localStorage until a deploy consumes it, so a transient Walrus failure never
// loses a paid charge. The 2% rail fee is shown UP FRONT (fee transparency is
// the brand) and again in the success receipt. When the gate is off the deploy
// runs un-gated, exactly as before.
// ============================================================================

// The settled-but-unconsumed charge digest. Written after /execute succeeds,
// cleared when a deploy consumes it (success) or the backend 409s it (already
// used). Survives reloads so a paid charge is never stranded by a failed deploy.
const CHARGE_DIGEST_KEY = 'suize-deploy.charge-digest'

const load_charge_digest = (): string => {
  try {
    return window.localStorage.getItem(CHARGE_DIGEST_KEY) ?? ''
  } catch {
    return ''
  }
}

const store_charge_digest = (digest: string): void => {
  try {
    if (digest) window.localStorage.setItem(CHARGE_DIGEST_KEY, digest)
    else window.localStorage.removeItem(CHARGE_DIGEST_KEY)
  } catch {
    /* storage blocked — in-memory state still covers this session */
  }
}

// The rail's inline fee share of a quoted amount (floor — Move integer math).
const quote_fee = (q: DeployQuoteResponse): number =>
  Math.floor((q.amount * q.feeBps) / 10_000)

// Walk a dropped directory entry tree into { file, path } pairs (drag-drop only
// exposes FileSystemEntry; <input webkitdirectory> gives webkitRelativePath).
const read_dir_entry = (
  entry: FileSystemEntry,
  base: string,
  out: { file: File; path: string }[],
): Promise<void> =>
  new Promise(resolve => {
    if (entry.isFile) {
      ;(entry as FileSystemFileEntry).file(f => {
        out.push({ file: f, path: `${base}${entry.name}` })
        resolve()
      }, () => resolve())
      return
    }
    if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader()
      const all: FileSystemEntry[] = []
      const readBatch = () =>
        reader.readEntries(
          batch => {
            if (batch.length === 0) {
              // drain all children, then recurse
              Promise.all(
                all.map(e =>
                  read_dir_entry(e, `${base}${entry.name}/`, out),
                ),
              ).then(() => resolve())
              return
            }
            all.push(...batch)
            readBatch()
          },
          () => resolve(),
        )
      readBatch()
    } else {
      resolve()
    }
  })

export const DeployView = ({
  owner,
  canSignIn,
  connecting,
  onSignIn,
  onBack,
  onOpen,
  onError,
  onDeployed,
}: {
  owner: string | null
  canSignIn: boolean
  connecting: boolean
  onSignIn: () => void
  onBack: () => void
  onOpen: (siteId: string) => void
  onError: (msg: string) => void
  onDeployed: (msg: string) => void
}) => {
  const [files, setFiles] = useState<PackFile[]>([])
  const [name, setName] = useState('')
  const [over, setOver] = useState(false)
  const [result, setResult] = useState<DeployResponse | null>(null)
  // The payment receipt shown with the success state (digest + the fee split
  // from the quote). Null on an un-gated deploy.
  const [receipt, setReceipt] = useState<{
    digest: string
    quote: DeployQuoteResponse
  } | null>(null)
  // Deploy phases. The three charge phases only occur when the gate is live:
  // 'charging' (backend builds the sponsored PTB) → 'signing-charge' (wallet
  // prompt over the sponsored TX bytes) → 'settling' (POST /execute). Then the
  // existing 'signing' (deploy auth personal message) → 'deploying' (Walrus).
  const [phase, setPhase] = useState<
    'idle' | 'charging' | 'signing-charge' | 'settling' | 'signing' | 'deploying'
  >('idle')
  // A settled charge waiting to be consumed (mirrors localStorage for render).
  const [storedCharge, setStoredCharge] = useState<string>(load_charge_digest)
  // A 402 from POST /deploy carries the authoritative quote — it overrides the
  // quote query (covers "gate flipped on after the page loaded").
  const [quote402, setQuote402] = useState<DeployQuoteResponse | null>(null)
  const dirInput = useRef<HTMLInputElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const qc = useQueryClient()
  const { mutateAsync: signPersonalMessage } = useSignPersonalMessage()
  const { mutateAsync: signTransaction } = useSignTransaction()
  const rail = useRailAccount(owner)

  // The charge gate: 200 → the quote (payment step renders), null → gate off /
  // unknown (un-gated path; a live gate still surfaces via the 402 fallback).
  const quoteQ = useQuery({
    queryKey: ['deploy-quote'],
    queryFn: get_deploy_quote,
    staleTime: 60_000,
    retry: false,
  })
  const quote = quote402 ?? quoteQ.data ?? null

  const ingest = useCallback(
    async (picked: { file: File; path: string }[]) => {
      const packed = await files_to_pack(picked)
      // Guess a default name from the dropped root folder if none typed.
      if (packed.length > 0) {
        const firstRaw = picked[0]?.path ?? ''
        const root = firstRaw.replace(/\\/g, '/').split('/')[0]
        setName(prev => prev || root || 'my-site')
      }
      setFiles(packed)
      setResult(null)
    },
    [],
  )

  const onDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault()
      setOver(false)
      const items = Array.from(e.dataTransfer.items)
      const out: { file: File; path: string }[] = []
      const entries = items
        .map(it => it.webkitGetAsEntry?.())
        .filter((x): x is FileSystemEntry => Boolean(x))
      if (entries.length > 0) {
        await Promise.all(entries.map(en => read_dir_entry(en, '', out)))
      } else {
        // Fallback: plain files with no directory structure.
        for (const f of Array.from(e.dataTransfer.files))
          out.push({ file: f, path: f.name })
      }
      await ingest(out)
    },
    [ingest],
  )

  const onPickDir = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const list = Array.from(e.target.files ?? [])
      await ingest(
        list.map(f => ({
          file: f,
          // webkitdirectory carries the folder path on webkitRelativePath.
          path:
            (f as File & { webkitRelativePath?: string }).webkitRelativePath ||
            f.name,
        })),
      )
    },
    [ingest],
  )

  const onPickFiles = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const list = Array.from(e.target.files ?? [])
      // Picked loose files have no folder wrapper; keep their bare names but DON'T
      // strip a segment (normalize would otherwise drop the only segment).
      await ingest(list.map(f => ({ file: f, path: `root/${f.name}` })))
    },
    [ingest],
  )

  // Deploy is SIGNED — there is no anonymous deploy. When the charge gate is
  // live, PAYMENT comes first (one tap covers pay + deploy): POST /deploy/charge
  // { account, sender } → sign the sponsored bytes LOCALLY as a TRANSACTION →
  // POST /execute → persist the executed digest. Then the existing flow: fresh
  // nonce → sign buildDeployAuthMessage(nonce) as a personal message → POST the
  // tar with { nonce, signature, chargeDigest }. The backend recovers the signer
  // AS the on-chain owner AND verifies the charge settled (single-use). A
  // settled-but-unconsumed digest (e.g. a failed Walrus upload) is reused on the
  // next attempt — no double charge. 409 ⇒ the digest was already consumed:
  // clear it + re-quote; a fresh 402 surfaces the backend's reason verbatim.
  const m = useMutation({
    mutationFn: async (): Promise<{
      res: DeployResponse
      paid: { digest: string; quote: DeployQuoteResponse } | null
    }> => {
      const tar = pack_tar(files)

      // ── payment leg (charge gate live only) ─────────────────────────────
      let chargeDigest = load_charge_digest()
      if (quote && !chargeDigest) {
        if (!owner || !rail.valid) {
          throw new Error(
            'A funded rail Account id is required to pay the deploy charge.',
          )
        }
        setPhase('charging')
        const built = await build_deploy_charge({
          account: rail.account,
          sender: owner,
        })
        setPhase('signing-charge')
        // Sponsored TX bytes — signed VERBATIM by the local zkLogin session.
        const { signature } = await signTransaction({ transaction: built.bytes })
        setPhase('settling')
        const executed = await execute_sponsored({
          digest: built.digest,
          signature,
        })
        chargeDigest = executed.digest
        store_charge_digest(chargeDigest)
        setStoredCharge(chargeDigest)
      }
      const paid =
        quote && chargeDigest ? { digest: chargeDigest, quote } : null

      // ── deploy leg ───────────────────────────────────────────────────────
      const { nonce } = await get_nonce()
      const message = new TextEncoder().encode(buildDeployAuthMessage(nonce))
      setPhase('signing')
      const { signature } = await signPersonalMessage({ message })
      setPhase('deploying')
      try {
        const res = await deploy_site({
          name: name.trim() || 'my-site',
          site_tar: tar,
          nonce,
          signature,
          charge_digest: chargeDigest || undefined,
        })
        return { res, paid }
      } catch (e) {
        if (e instanceof DeployApiError && e.status === 409) {
          // The digest was consumed by another deploy — drop it + re-quote so
          // the next tap pays a fresh charge.
          store_charge_digest('')
          setStoredCharge('')
          void qc.invalidateQueries({ queryKey: ['deploy-quote'] })
        }
        if (e instanceof DeployApiError && e.status === 402) {
          // The gate is live (maybe newer than our quote query) — adopt the
          // quote the 402 carries so the payment step renders; the error body
          // (the backend's reason) surfaces inline below.
          const q = (e.body as { quote?: DeployQuoteResponse } | undefined)
            ?.quote
          if (q) setQuote402(q)
          // A 402 that rejected a digest we DID send (failed/too-old/wrong-owner
          // charge) means that digest is definitively unusable — drop it so the
          // next tap pays a fresh charge instead of looping on the dead one.
          if (chargeDigest) {
            store_charge_digest('')
            setStoredCharge('')
          }
        }
        throw e
      }
    },
    onSuccess: ({ res, paid }) => {
      if (paid) {
        // The deploy consumed the charge — never offer the digest again.
        store_charge_digest('')
        setStoredCharge('')
      }
      setResult(res)
      setReceipt(paid)
      onDeployed(`Deployed → ${res.subdomain}`)
      void qc.invalidateQueries({ queryKey: ['sites'] })
    },
    onError: e => onError(describe_error(e).title),
    onSettled: () => setPhase('idle'),
  })

  const size = total_bytes(files)
  const hasIndex = files.some(f => normalize_entry_path(f.path) === 'index.html')

  return (
    <>
      <button type="button" className="dx-back" onClick={onBack}>
        <IconBack /> All sites
      </button>

      <div className="dx-pagehead">
        <div>
          <p className="ed-eyebrow">Manual deploy</p>
          <h1 className="dx-pagehead__title">Deploy a site</h1>
        </div>
      </div>

      {result ? (
        <div className="dx-panel">
          <h2 className="dx-panel__title">Deployed</h2>
          <EmptyState
            kicker="Site deployed"
            title="Your site is live"
            body={
              <>
                It's served from Walrus at the free subdomain below. Each deploy
                is immutable — a re-deploy creates a fresh site at a new URL.
              </>
            }
          />
          <div className="dx-rows" style={{ marginTop: 16 }}>
            <div className="dx-row">
              <span className="dx-row__k">Live URL</span>
              <span className="dx-row__v">
                <a href={result.url} target="_blank" rel="noreferrer">
                  {result.url.replace(/^https?:\/\//, '')}
                </a>{' '}
                <CopyButton value={result.url} label="Copy URL" />
              </span>
            </div>
            <div className="dx-row">
              <span className="dx-row__k">Subdomain</span>
              <span className="dx-row__v">{result.subdomain}</span>
            </div>
            <div className="dx-row">
              <span className="dx-row__k">Version</span>
              <span className="dx-row__v">{result.version}</span>
            </div>
            <div className="dx-row">
              <span className="dx-row__k">Tx digest</span>
              <span className="dx-row__v" title={result.digest}>
                {result.digest.slice(0, 10)}…{' '}
                <CopyButton value={result.digest} label="Copy digest" />
              </span>
            </div>
          </div>

          {receipt && (
            <>
              <div className="ed-sep" style={{ margin: '20px 0 12px' }}>
                <span className="ed-sep__label">Payment receipt</span>
                <span className="ed-sep__line" />
              </div>
              <div className="dx-rows">
                <div className="dx-row">
                  <span className="dx-row__k">Charge</span>
                  <span className="dx-row__v tnum">
                    {fmt_usdc(receipt.quote.amount)} USDC — one-off, settled
                    on-chain
                  </span>
                </div>
                <div className="dx-row">
                  <span className="dx-row__k">Merchant</span>
                  <span className="dx-row__v" title={receipt.quote.merchant}>
                    {fmt_id(receipt.quote.merchant)} (Deploy by Suize) —{' '}
                    <span className="tnum">
                      {fmt_usdc(receipt.quote.amount - quote_fee(receipt.quote))}
                    </span>{' '}
                    net
                  </span>
                </div>
                <div className="dx-row">
                  <span className="dx-row__k">Rail fee</span>
                  <span className="dx-row__v tnum">
                    {(receipt.quote.feeBps / 100).toFixed(0)}% ·{' '}
                    {fmt_usdc(quote_fee(receipt.quote))} — taken inline, emitted
                    in the on-chain receipt event
                  </span>
                </div>
                <div className="dx-row">
                  <span className="dx-row__k">Charge digest</span>
                  <span className="dx-row__v" title={receipt.digest}>
                    {receipt.digest.slice(0, 10)}…{' '}
                    <CopyButton value={receipt.digest} label="Copy digest" />
                  </span>
                </div>
              </div>
            </>
          )}

          <div className="dx-form-actions">
            <a
              className="dx-btn is-accent"
              href={result.url}
              target="_blank"
              rel="noreferrer"
            >
              <IconExternal /> Visit site
            </a>
            <button
              type="button"
              className="dx-btn"
              onClick={() => onOpen(result.siteId)}
            >
              Open detail
            </button>
            <button
              type="button"
              className="dx-btn is-ghost"
              onClick={() => {
                setResult(null)
                setReceipt(null)
                setFiles([])
                setName('')
              }}
            >
              Deploy another
            </button>
          </div>
        </div>
      ) : (
        <div className="dx-panel">
          <label className="dx-label" htmlFor="site-name">
            Site name
          </label>
          <input
            id="site-name"
            className="dx-field"
            type="text"
            placeholder="my-site"
            value={name}
            onChange={e => setName(e.target.value)}
            style={{ marginBottom: 18 }}
          />

          <div
            className={`dx-drop${over ? ' is-over' : ''}`}
            onDragOver={e => {
              e.preventDefault()
              setOver(true)
            }}
            onDragLeave={() => setOver(false)}
            onDrop={onDrop}
            onClick={() => dirInput.current?.click()}
            role="button"
            tabIndex={0}
            onKeyDown={e => {
              if (e.key === 'Enter' || e.key === ' ')
                dirInput.current?.click()
            }}
          >
            <span className="dx-drop__plate" aria-hidden="true">
              <IconPress />
            </span>
            <p className="dx-drop__title">Drop your site</p>
            <p className="dx-drop__body">
              Drop your pre-built static output (e.g. <code>dist/</code> or{' '}
              <code>build/</code>) here. No build step runs — we deploy exactly
              what you drop. Click to pick a folder instead.
            </p>
            <div className="dx-form-actions" onClick={e => e.stopPropagation()}>
              <button
                type="button"
                className="dx-btn is-sm"
                onClick={() => dirInput.current?.click()}
              >
                Pick folder
              </button>
              <button
                type="button"
                className="dx-btn is-sm"
                onClick={() => fileInput.current?.click()}
              >
                Pick files
              </button>
            </div>
          </div>

          {/* hidden inputs: a directory picker + a loose-file picker */}
          <input
            ref={dirInput}
            type="file"
            // @ts-expect-error — webkitdirectory is a non-standard but widely
            // supported attribute for picking a whole folder.
            webkitdirectory=""
            directory=""
            multiple
            hidden
            onChange={onPickDir}
          />
          <input
            ref={fileInput}
            type="file"
            multiple
            hidden
            onChange={onPickFiles}
          />

          {files.length > 0 && (
            <>
              <div className="ed-sep" style={{ margin: '20px 0 12px' }}>
                <span className="ed-sep__label">Files to deploy</span>
                <span className="ed-sep__line" />
                <span className="dx-pagehead__count tnum">
                  {files.length} file{files.length === 1 ? '' : 's'} ·{' '}
                  {fmt_bytes(size)}
                </span>
              </div>
              <div className="dx-filelist">
                {files.map(f => (
                  <div key={f.path} className="dx-filerow">
                    <span className="dx-filerow__path">/{f.path}</span>
                    <span className="dx-filerow__size">
                      {fmt_bytes(f.bytes.length)}
                    </span>
                  </div>
                ))}
              </div>

              {!hasIndex && (
                <p className="dx-error">
                  No <code>index.html</code> at the root — most static hosts
                  serve that by default. Make sure you dropped the folder
                  contents, not its parent.
                </p>
              )}

              {!owner && (
                <p className="dx-hint" style={{ marginTop: 18 }}>
                  Every deploy is signed by your Suize wallet — the signature is
                  the authority, so there's no anonymous deploy. Sign in to
                  deploy this site.
                </p>
              )}

              {/* PAYMENT STEP — the $0.50 one-off rail charge, fee shown up
                  front (transparency is the brand). Renders only when the
                  charge gate is live. A settled-but-unconsumed charge (from a
                  previously failed deploy) is reused — no double charge. */}
              {owner && quote && (
                <>
                  <div className="ed-sep" style={{ margin: '20px 0 12px' }}>
                    <span className="ed-sep__label">Payment</span>
                    <span className="ed-sep__line" />
                    <span className="dx-pagehead__count tnum">
                      {fmt_usdc(quote.amount)} per deploy
                    </span>
                  </div>
                  {storedCharge ? (
                    <p className="dx-hint" title={storedCharge}>
                      A settled {fmt_usdc(quote.amount)} charge is ready (
                      <code>{storedCharge.slice(0, 10)}…</code>) — this deploy
                      uses it; you won't be charged again.
                    </p>
                  ) : (
                    <>
                      <div className="dx-rows" style={{ marginBottom: 14 }}>
                        <div className="dx-row">
                          <span className="dx-row__k">Price</span>
                          <span className="dx-row__v tnum">
                            {fmt_usdc(quote.amount)} USDC —{' '}
                            {quote.description || 'one-off, charged on the rail'}
                          </span>
                        </div>
                        <div className="dx-row">
                          <span className="dx-row__k">Merchant</span>
                          <span className="dx-row__v" title={quote.merchant}>
                            {fmt_id(quote.merchant)} (Deploy by Suize)
                          </span>
                        </div>
                        <div className="dx-row">
                          <span className="dx-row__k">Rail fee</span>
                          <span className="dx-row__v tnum">
                            {(quote.feeBps / 100).toFixed(0)}% ·{' '}
                            {fmt_usdc(quote_fee(quote))} of the price — taken
                            inline, visible in the receipt
                          </span>
                        </div>
                      </div>
                      <RailAccountField rail={rail} idPrefix="deploy" owner={owner} />
                    </>
                  )}
                </>
              )}

              <div className="dx-form-actions">
                {owner ? (
                  <button
                    type="button"
                    className="dx-btn is-accent"
                    disabled={
                      m.isPending || (!!quote && !storedCharge && !rail.valid)
                    }
                    onClick={() => m.mutate()}
                  >
                    {phase === 'charging'
                      ? 'Building charge…'
                      : phase === 'signing-charge'
                        ? 'Approve payment…'
                        : phase === 'settling'
                          ? 'Settling charge…'
                          : phase === 'signing'
                            ? 'Signing…'
                            : phase === 'deploying'
                              ? 'Deploying…'
                              : quote && !storedCharge
                                ? `Pay ${fmt_usdc(quote.amount)} & deploy`
                                : 'Deploy to Walrus'}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="dx-btn is-accent"
                    disabled={!canSignIn || connecting}
                    onClick={onSignIn}
                    title={
                      canSignIn
                        ? 'Sign in to deploy'
                        : 'Sign-in is unavailable (Enoki not configured)'
                    }
                  >
                    {connecting && <span className="spin" aria-hidden="true" />}
                    {connecting ? 'Signing in…' : 'Sign in to deploy'}
                  </button>
                )}
                <button
                  type="button"
                  className="dx-btn is-ghost"
                  disabled={m.isPending}
                  onClick={() => setFiles([])}
                >
                  Clear
                </button>
              </div>

              {m.isError && (
                <p className="dx-error">{describe_error(m.error).title}</p>
              )}
            </>
          )}
        </div>
      )}
    </>
  )
}
