// =============================================================================
// DEV-ONLY operator tool (#/publish). Publishes a Move package with the CONNECTED
// browser wallet — the owner's mainnet key lives in a wallet extension, not the
// CLI, so this is how `deploy_sui` gets to mainnet. Standard publish PTB, NORMAL
// gas (the wallet pays; nothing here touches the x402/gasless pay path).
//
// The bytecode is built automatically: on mount this fetches
// /__publish/bytecode (a dev-only Vite middleware that runs `sui move build`
// against packages/move-deploy), so the flow is open → Connect → Publish with
// nothing to paste. A collapsed manual paste/file fallback survives for machines
// without the sui CLI. The `import.meta.env.DEV` route gate (viewer/router.ts)
// tree-shakes this whole screen out of every production build.
// =============================================================================

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useCurrentAccount, useCurrentClient, useDAppKit } from '@mysten/dapp-kit-react'
import { ConnectButton } from '@mysten/dapp-kit-react/ui'
import { Transaction } from '@mysten/sui/transactions'
import { NETWORK } from '../config'
import { CopyButton } from '../components/CopyButton'

// The one-liner that produces the input this page eats.
const BUILD_CMD =
  'sui move build --dump-bytecode-as-base64 --path packages/move-deploy > /tmp/deploy_sui.json'

// The shape of `sui move build --dump-bytecode-as-base64`.
interface Bytecode {
  modules: string[]
  dependencies: string[]
  digest?: number[]
}

type ParseResult =
  | { ok: true; value: Bytecode }
  | { ok: false; error: string }

function parseBytecode(text: string): ParseResult {
  const t = text.trim()
  if (!t) return { ok: false, error: '' }
  let json: unknown
  try {
    json = JSON.parse(t)
  } catch (e) {
    return { ok: false, error: 'Not valid JSON: ' + (e as Error).message }
  }
  if (typeof json !== 'object' || json === null || Array.isArray(json))
    return { ok: false, error: 'Expected a JSON object with { modules, dependencies }.' }
  const o = json as Record<string, unknown>
  const modules = o.modules
  const dependencies = o.dependencies
  if (!Array.isArray(modules) || modules.length === 0 || !modules.every((m) => typeof m === 'string'))
    return { ok: false, error: '`modules` must be a non-empty array of base64 strings.' }
  if (
    !Array.isArray(dependencies) ||
    dependencies.length === 0 ||
    !dependencies.every((d) => typeof d === 'string' && /^0x[0-9a-fA-F]+$/.test(d))
  )
    return { ok: false, error: '`dependencies` must be a non-empty array of 0x… addresses.' }
  const digest =
    Array.isArray(o.digest) && o.digest.every((n) => typeof n === 'number') ? (o.digest as number[]) : undefined
  return { ok: true, value: { modules: modules as string[], dependencies: dependencies as string[], digest } }
}

// Human labels for the objects `deploy_sui`'s init functions are known to create,
// matched by type SUFFIX (read from packages/move-deploy/sources). No em-dashes.
const LABELS: Array<[RegExp, string]> = [
  [/::version::Version$/, 'Version · upgrade gate (shared)'],
  [/::version::AdminCap$/, 'AdminCap · version admin (owned by you)'],
  [/::site::SiteDigestRegistry$/, 'SiteDigestRegistry · one-site-per-payment lock (shared)'],
  [/::site::DeployerCap$/, 'DeployerCap · create_site mint authority (owned by you)'],
  [/::domain_registry::DomainRegistry$/, 'DomainRegistry · custom-domain map (shared)'],
  [/::package::UpgradeCap$/, 'UpgradeCap · package upgrade authority (owned by you)'],
]
const labelFor = (type: string): string | null => LABELS.find(([re]) => re.test(type))?.[1] ?? null

// Minimal read surface over the connected client — useCurrentClient's narrowed
// type doesn't surface these, so we cast (same pattern as AccessPage).
interface ChangedObject {
  objectId: string
  idOperation: 'Unknown' | 'None' | 'Created' | 'Deleted'
  outputState: string
}
interface TxData {
  digest: string
  effects: { changedObjects: ChangedObject[] } | null
  objectTypes?: Record<string, string>
}
interface TxResult {
  Transaction?: TxData
  FailedTransaction?: TxData
}
interface GasUsed {
  computationCost: string
  storageCost: string
  storageRebate: string
}
interface SimData {
  effects: {
    status: { success: boolean; error: { message: string } | null }
    gasUsed: GasUsed
    changedObjects: ChangedObject[]
  } | null
  objectTypes?: Record<string, string>
}
interface PublishClient {
  waitForTransaction: (input: {
    digest: string
    include: { effects: true; objectTypes: true }
  }) => Promise<TxResult>
  simulateTransaction: (input: {
    transaction: Uint8Array
    include: { effects: true; objectTypes: true }
  }) => Promise<{ Transaction?: SimData; FailedTransaction?: SimData }>
}

// The ONE publish PTB, shared by the dry run and the real publish: publish the
// modules, hand the returned UpgradeCap to the sender. NORMAL gas — the
// connected wallet pays.
function buildPublishTx(sender: string, bc: Bytecode): Transaction {
  const tx = new Transaction()
  tx.setSenderIfNotSet(sender)
  const [upgradeCap] = tx.publish({ modules: bc.modules, dependencies: bc.dependencies })
  tx.transferObjects([upgradeCap], sender)
  return tx
}

const formatSui = (mist: bigint): string => {
  const s = (Number(mist) / 1e9).toFixed(6).replace(/0+$/, '').replace(/\.$/, '')
  return `${s} SUI`
}

/** One object the dry run says WILL be created (no ids — those are only final
 *  after real execution; the type is what the operator pre-flights). */
interface PreCreate {
  type: string
  label: string | null
}
type Preflight =
  | { status: 'idle' }
  | { status: 'running' }
  | { status: 'ok'; gasMist: bigint; creates: PreCreate[] }
  | { status: 'error'; raw: string }

interface ObjRow {
  key: string
  type: string
  objectId: string
  label: string | null
}
interface PublishResult {
  txDigest: string
  packageId: string | null
  rows: ObjRow[]
}

const short = (a: string) => `${a.slice(0, 10)}…${a.slice(-6)}`

export function PublishPage() {
  const account = useCurrentAccount()
  const client = useCurrentClient()
  const dAppKit = useDAppKit()

  const [raw, setRaw] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<PublishResult | null>(null)
  // execErr: null | { cancelled } | { raw } — a wallet reject reads friendly,
  // anything else dumps raw (operator tool: verbose is correct).
  const [execErr, setExecErr] = useState<{ cancelled: true } | { raw: string } | null>(null)
  // Auto-build state: the dev Vite middleware compiles the Move package for us.
  const [autoStatus, setAutoStatus] = useState<'loading' | 'ok' | 'error'>('loading')
  const [autoError, setAutoError] = useState<string | null>(null)
  // Pre-flight dry run: gates the publish button. Only a clean dry run enables it.
  const [preflight, setPreflight] = useState<Preflight>({ status: 'idle' })

  const parsed = useMemo(() => parseBytecode(raw), [raw])
  const isMainnet = NETWORK === 'mainnet'
  const canPublish = !!account && parsed.ok && !busy && preflight.status === 'ok'

  // Dry-run the exact publish PTB whenever wallet + bytecode are both ready
  // (and again on Rebuild — new `raw` — or account switch). Build against the
  // live client (resolves the sender's real gas coins), then simulate the bytes;
  // gas + would-be-created objects come back from the node without signing.
  useEffect(() => {
    const sender = account?.address
    if (!sender || !parsed.ok) {
      setPreflight({ status: 'idle' })
      return
    }
    let stale = false
    setPreflight({ status: 'running' })
    void (async () => {
      try {
        const tx = buildPublishTx(sender, parsed.value)
        const bytes = await tx.build({ client: client as never })
        const sim = await (client as unknown as PublishClient).simulateTransaction({
          transaction: bytes,
          include: { effects: true, objectTypes: true },
        })
        if (stale) return
        const t = sim.Transaction ?? sim.FailedTransaction
        const eff = t?.effects
        if (!eff) throw new Error('Dry run returned no effects.')
        if (!eff.status.success)
          throw new Error(eff.status.error?.message ?? JSON.stringify(eff.status.error))
        const gasMist =
          BigInt(eff.gasUsed.computationCost) +
          BigInt(eff.gasUsed.storageCost) -
          BigInt(eff.gasUsed.storageRebate)
        const types = t?.objectTypes ?? {}
        const creates: PreCreate[] = eff.changedObjects
          .filter((c) => c.idOperation === 'Created')
          .map((c) => {
            const type =
              c.outputState === 'PackageWrite'
                ? 'deploy_sui (package)'
                : (types[c.objectId] ?? '(dynamic field)')
            return { type, label: labelFor(type) }
          })
        setPreflight({ status: 'ok', gasMist, creates })
      } catch (e) {
        if (!stale) setPreflight({ status: 'error', raw: (e as Error)?.message ?? String(e) })
      }
    })()
    return () => {
      stale = true
    }
  }, [account?.address, parsed, client])

  // Build (or rebuild) the bytecode via the dev-only middleware and populate.
  const buildBytecode = useCallback(async () => {
    setAutoStatus('loading')
    setAutoError(null)
    try {
      const r = await fetch('/__publish/bytecode')
      const text = await r.text()
      if (!r.ok) {
        let msg = text
        try {
          msg = (JSON.parse(text) as { error?: string }).error ?? text
        } catch {
          /* non-JSON body — show as-is */
        }
        setAutoError(msg)
        setAutoStatus('error')
        return
      }
      setRaw(text)
      setAutoStatus('ok')
    } catch (e) {
      setAutoError((e as Error)?.message ?? String(e))
      setAutoStatus('error')
    }
  }, [])

  useEffect(() => {
    void buildBytecode()
  }, [buildBytecode])

  const loadFile = (file: File | null | undefined) => {
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => setRaw(typeof reader.result === 'string' ? reader.result : '')
    reader.readAsText(file)
  }

  const publish = async () => {
    if (!account || !parsed.ok) return
    setBusy(true)
    setExecErr(null)
    setResult(null)
    try {
      const sender = account.address
      // The SAME PTB the dry run just cleared.
      const tx = buildPublishTx(sender, parsed.value)

      const exec = (await dAppKit.signAndExecuteTransaction({ transaction: tx })) as TxResult
      const digest = (exec.Transaction ?? exec.FailedTransaction)?.digest
      if (!digest) throw new Error('Execution returned no transaction digest.')

      // The exec result carries effects but not the objectId→type map; re-read
      // with objectTypes so every created object gets a real Move type label.
      const full = await (client as unknown as PublishClient).waitForTransaction({
        digest,
        include: { effects: true, objectTypes: true },
      })
      const t = full.Transaction ?? full.FailedTransaction
      const changed = t?.effects?.changedObjects ?? []
      const types = t?.objectTypes ?? {}
      const packageId = changed.find((c) => c.outputState === 'PackageWrite')?.objectId ?? null
      const rows: ObjRow[] = changed
        .filter((c) => c.idOperation === 'Created' && c.objectId !== packageId)
        .map((c) => {
          const type = types[c.objectId] ?? '(type unavailable)'
          return { key: type.split('::').pop() ?? c.objectId.slice(0, 8), type, objectId: c.objectId, label: labelFor(type) }
        })
      setResult({ txDigest: digest, packageId, rows })
    } catch (e) {
      const msg = (e as Error)?.message ?? String(e)
      setExecErr(/reject|denied|cancel/i.test(msg) ? { cancelled: true } : { raw: msg })
    } finally {
      setBusy(false)
    }
  }

  const summaryJson = result
    ? JSON.stringify(
        {
          network: NETWORK,
          packageId: result.packageId,
          txDigest: result.txDigest,
          objects: Object.fromEntries(result.rows.map((r) => [r.key, r.objectId])),
        },
        null,
        2,
      )
    : ''

  return (
    <div className="pub">
      <div className="pub__in">
        <header className="pub__head">
          <a className="pub__mark" href="#/">
            Suize
          </a>
          <span className="pub__tag mono">operator · publish move package</span>
        </header>

        <div className={`pub-net ${isMainnet ? 'pub-net--danger' : ''}`}>
          <span className="pub-net__lbl">Active network</span>
          <span className="pub-net__val mono">{NETWORK}</span>
          {isMainnet && (
            <span className="pub-net__warn">You are publishing to MAINNET with real gas.</span>
          )}
        </div>

        <section className="pub-block">
          <span className="pub-block__no mono">01 / wallet</span>
          {account ? (
            <div className="pub-conn">
              <span className="pub-conn__ok mono">connected</span>
              <span className="pub-conn__addr mono">{short(account.address)}</span>
              <CopyButton text={account.address} />
              <span className="pub-conn__spacer" />
              <ConnectButton />
            </div>
          ) : (
            <div className="pub-conn">
              <span className="pub-conn__no mono">no wallet connected</span>
              <span className="pub-conn__spacer" />
              <ConnectButton />
            </div>
          )}
        </section>

        <section className="pub-block">
          <span className="pub-block__no mono">02 / bytecode</span>

          {autoStatus === 'loading' && (
            <p className="pub-note mono">Building deploy_sui… (first build can take ~30s)</p>
          )}
          {autoStatus === 'ok' && parsed.ok && (
            <div className="pub-built">
              <span className="pub-built__ok mono">Built deploy_sui</span>
              <span className="pub-built__meta mono">
                {parsed.value.modules.length} modules · deps [{parsed.value.dependencies.join(', ')}]
                {parsed.value.digest ? ` · digest ${parsed.value.digest.length}b` : ''}
              </span>
              <span className="pub-conn__spacer" />
              <button className="btn btn--ghost pub-rebuild" onClick={() => void buildBytecode()}>
                Rebuild
              </button>
            </div>
          )}
          {autoStatus === 'error' && (
            <details className="pub-err" open>
              <summary className="mono">Auto-build failed. Paste bytecode manually below.</summary>
              <pre className="pub-err__pre mono">{autoError}</pre>
            </details>
          )}

          <details className="pub-manual" open={autoStatus === 'error'}>
            <summary className="mono">or paste bytecode JSON manually</summary>
            <p className="pub-note">Produce the input on a machine with the sui CLI, then paste it (or load the file).</p>
            <div className="cmd">
              <span className="cmd__ps">$</span>
              <span className="cmd__txt">{BUILD_CMD}</span>
              <CopyButton text={BUILD_CMD} />
            </div>
            <textarea
              className="pub-input mono"
              spellCheck={false}
              placeholder='{"modules":["oRzr…"],"dependencies":["0x1","0x2"],"digest":[…]}'
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
            />
            <label className="pub-file">
              <input
                type="file"
                accept="application/json,.json"
                onChange={(e) => loadFile(e.target.files?.[0])}
              />
              <span className="mono">load .json file</span>
            </label>
          </details>

          {raw.trim() !== '' && !parsed.ok && parsed.error && (
            <p className="pub-msg pub-msg--err mono">{parsed.error}</p>
          )}
        </section>

        <section className="pub-block">
          <span className="pub-block__no mono">03 / dry run</span>
          {preflight.status === 'idle' && (
            <p className="pub-note mono">
              {account
                ? 'Waiting for bytecode. The dry run starts automatically.'
                : 'Connect a wallet to run the pre-flight dry run against ' + NETWORK + '.'}
            </p>
          )}
          {preflight.status === 'running' && (
            <p className="pub-note mono">Dry-running the publish against {NETWORK}…</p>
          )}
          {preflight.status === 'ok' && (
            <div className="pub-pre">
              <div className="pub-pre__gas">
                <span className="pub-pre__gaslbl">Estimated gas</span>
                <span className="pub-pre__gasval mono">{formatSui(preflight.gasMist)}</span>
                <span className="pub-pre__gasmist mono">{preflight.gasMist.toString()} MIST</span>
              </div>
              <div className="pub-pre__list">
                {preflight.creates.map((c, i) => (
                  <div className="pub-pre__row" key={i}>
                    <span className="pub-pre__mk mono">+</span>
                    <span className="pub-pre__label">{c.label ?? c.type.split('::').pop()}</span>
                    <span className="pub-pre__type mono">{c.type}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {preflight.status === 'error' && (
            <details className="pub-err" open>
              <summary className="mono">Dry run failed. Publish is disabled.</summary>
              <pre className="pub-err__pre mono">{preflight.raw}</pre>
            </details>
          )}
        </section>

        <section className="pub-block">
          <span className="pub-block__no mono">04 / publish</span>
          <button
            className={`btn ${isMainnet ? 'btn--danger' : 'btn--primary'} pub-go`}
            disabled={!canPublish}
            onClick={() => void publish()}
          >
            {busy
              ? 'Publishing…'
              : isMainnet
                ? 'Publish to MAINNET (real gas)'
                : `Publish to ${NETWORK}`}
          </button>
          {!account && <p className="pub-msg mono">Connect the publisher wallet first.</p>}
          {account && preflight.status !== 'ok' && !busy && (
            <p className="pub-msg mono">Enabled after a clean dry run.</p>
          )}

          {execErr && 'cancelled' in execErr && <p className="pub-msg mono">You cancelled.</p>}
          {execErr && 'raw' in execErr && (
            <details className="pub-err" open>
              <summary className="mono">Publish failed</summary>
              <pre className="pub-err__pre mono">{execErr.raw}</pre>
            </details>
          )}
        </section>

        {result && (
          <section className="pub-block">
            <span className="pub-block__no mono">05 / created</span>

            <div className="pub-row pub-row--head">
              <div className="pub-row__label">Package id</div>
              <div className="pub-row__id">
                <span className="pub-row__val mono">{result.packageId ?? '(not found)'}</span>
                {result.packageId && <CopyButton text={result.packageId} />}
              </div>
            </div>
            <div className="pub-row pub-row--head">
              <div className="pub-row__label">Transaction digest</div>
              <div className="pub-row__id">
                <span className="pub-row__val mono">{result.txDigest}</span>
                <CopyButton text={result.txDigest} />
              </div>
            </div>

            {result.rows.map((r) => (
              <div className="pub-row" key={r.objectId}>
                <div className="pub-row__label">{r.label ?? r.key}</div>
                <div className="pub-row__type mono">{r.type}</div>
                <div className="pub-row__id">
                  <span className="pub-row__val mono">{r.objectId}</span>
                  <CopyButton text={r.objectId} />
                </div>
              </div>
            ))}
            {result.rows.length === 0 && (
              <p className="pub-msg mono">No created objects reported (the type map may still be indexing).</p>
            )}

            <div className="pub-all">
              <div className="pub-all__bar">
                <span className="pub-all__lbl mono">copy all as JSON (for @suize/shared)</span>
                <CopyButton text={summaryJson} />
              </div>
              <pre className="pub-all__pre mono">{summaryJson}</pre>
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
