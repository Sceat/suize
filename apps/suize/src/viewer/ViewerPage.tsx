// =============================================================================
// The sealed-site VIEWER (#/view/<siteId>, and #/view-dev/<manifestBlobId> in
// dev). Reads the on-chain Site, proves the manifest against its on-chain hash,
// then — after the visitor signs in with their wallet — fetches the site's one
// decryption key, decrypts every file client-side, and renders the result in a
// sandboxed <iframe srcdoc> (allow-scripts only; NEVER allow-same-origin, the
// decrypted site is untrusted). Denial is cryptographic and shown as a clean
// "not on the viewer list" state, never conflated with a network hiccup.
// =============================================================================

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { NoAccessError } from '@mysten/seal'
import { useCurrentAccount, useCurrentClient, useDAppKit } from '@mysten/dapp-kit-react'
import { ConnectButton } from '@mysten/dapp-kit-react/ui'
import { packageIds, WALRUS_DEFAULTS } from '@suize/shared'
import { NETWORK } from '../config'
import { fetchManifest, sha256Hex, type ManifestV2 } from '../seal/manifest'
import { readSite, findAllowlistCap } from '../seal/chain'
import { getSealClient, ensureSessionKey, resetSealSession } from '../seal/seal'
import { unlockSite, type UnlockPhase } from '../seal/decrypt'
import { ViewerBar, ViewerPanel } from './Chrome'
import { navigate } from './router'
import { getDevSigner } from './devSigner'

const AGGREGATOR = WALRUS_DEFAULTS[NETWORK].aggregator
const DEPLOY = packageIds(NETWORK).DEPLOY

type Loaded = { manifest: ManifestV2; allowlistId: string; siteName: string }

type Stage =
  | { s: 'reading' }
  | { s: 'ready'; loaded: Loaded }
  | { s: 'unlocking'; loaded: Loaded; phase: UnlockPhase }
  | { s: 'unlocked'; srcDoc: string; siteName: string; allowlistId: string }
  | { s: 'denied' }
  | { s: 'error'; message: string; retryable: boolean }

const PHASE_TEXT: Record<UnlockPhase, string> = {
  approve: 'Preparing…',
  keys: 'Checking your access…',
  decrypt: 'Decrypting the site…',
  assemble: 'Almost there…',
}

const isDenial = (e: unknown): boolean =>
  e instanceof NoAccessError || /no.?access|not.*have access|not on/i.test((e as Error)?.message ?? '')

export function ViewerPage({ siteId, devManifestBlobId }: { siteId?: string; devManifestBlobId?: string }) {
  const account = useCurrentAccount()
  const client = useCurrentClient()
  const dAppKit = useDAppKit()
  // DEV-only: a keypair signer selected via ?dev-key= (tree-shaken in prod), so
  // the E2E can drive the flow without a wallet extension. Falls back to the
  // connected wallet everywhere.
  const dev = useMemo(() => getDevSigner(), [])
  const signerAddress = dev?.address ?? account?.address ?? null

  const [stage, setStage] = useState<Stage>({ s: 'reading' })
  const [canManage, setCanManage] = useState(false)
  // Guard against overlapping unlocks / stale async writes after navigation.
  const runId = useRef(0)

  // The allowlist behind the current stage (once the manifest is known) — drives
  // both the cap check and the Manage link, across ready/unlocking/unlocked.
  const activeAllowlistId =
    stage.s === 'ready' || stage.s === 'unlocking'
      ? stage.loaded.allowlistId
      : stage.s === 'unlocked'
        ? stage.allowlistId
        : null

  // ── Load: read the Site + fetch & verify the manifest ──────────────────────
  const load = useCallback(async () => {
    const my = ++runId.current
    setStage({ s: 'reading' })
    setCanManage(false)
    try {
      let loaded: Loaded
      if (devManifestBlobId) {
        const { manifest } = await fetchManifest(AGGREGATOR, devManifestBlobId)
        loaded = { manifest, allowlistId: manifest.allowlistId, siteName: 'Preview' }
      } else if (siteId) {
        const site = await readSite(client as never, siteId)
        if (!site.sealed) {
          if (my === runId.current)
            setStage({ s: 'error', message: 'This site is public — open it directly.', retryable: false })
          return
        }
        const { manifest, raw } = await fetchManifest(AGGREGATOR, site.manifestBlobId)
        // The on-chain hash is the authority: prove the fetched manifest is the
        // exact one the owner published before trusting any patch id in it.
        if (site.manifestHashHex) {
          const got = await sha256Hex(raw)
          if (got !== site.manifestHashHex.toLowerCase()) {
            if (my === runId.current)
              setStage({ s: 'error', message: 'This site failed its integrity check.', retryable: false })
            return
          }
        }
        loaded = { manifest, allowlistId: manifest.allowlistId, siteName: site.name || 'Private site' }
      } else {
        setStage({ s: 'error', message: 'No site specified.', retryable: false })
        return
      }
      if (my === runId.current) setStage({ s: 'ready', loaded })
    } catch (e) {
      if (my !== runId.current) return
      const notFound = (e as Error)?.message === 'not-found'
      setStage({
        s: 'error',
        message: notFound ? "We couldn't find that site." : "We couldn't reach the site. Check your connection.",
        retryable: !notFound,
      })
    }
  }, [siteId, devManifestBlobId, client])

  useEffect(() => {
    void load()
  }, [load])

  // A wallet switch invalidates any cached key material + manage rights.
  useEffect(() => {
    resetSealSession()
    setCanManage(false)
    setStage((prev) => (prev.s === 'unlocked' || prev.s === 'denied' ? { s: 'reading' } : prev))
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signerAddress])

  // Once we know the allowlist + connected wallet, surface a Manage link only
  // when that wallet actually holds the AllowlistCap for this list.
  useEffect(() => {
    if (!activeAllowlistId || !signerAddress) {
      setCanManage(false)
      return
    }
    let live = true
    findAllowlistCap(client as never, signerAddress, NETWORK, activeAllowlistId)
      .then((cap) => live && setCanManage(!!cap))
      .catch(() => live && setCanManage(false))
    return () => {
      live = false
    }
  }, [activeAllowlistId, signerAddress, client])

  // ── Unlock: session key → key fetch → decrypt → render ─────────────────────
  const unlock = useCallback(async () => {
    if (stage.s !== 'ready' || !signerAddress) return
    const my = ++runId.current
    const loaded = stage.loaded
    setStage({ s: 'unlocking', loaded, phase: 'approve' })
    try {
      const sessionKey = await ensureSessionKey({
        address: signerAddress,
        packageId: DEPLOY.PACKAGE,
        suiClient: client as never,
        sign: dev?.sign ?? (async (message) => (await dAppKit.signPersonalMessage({ message })).signature),
      })
      const srcDoc = await unlockSite({
        seal: getSealClient(client as never),
        sessionKey,
        suiClient: client as never,
        sealApproveTarget: DEPLOY.TARGETS.SEAL_APPROVE,
        allowlistId: loaded.allowlistId,
        manifest: loaded.manifest,
        aggregator: AGGREGATOR,
        onPhase: (phase) =>
          my === runId.current && setStage((s) => (s.s === 'unlocking' ? { ...s, phase } : s)),
      })
      if (my === runId.current)
        setStage({ s: 'unlocked', srcDoc, siteName: loaded.siteName, allowlistId: loaded.allowlistId })
    } catch (e) {
      if (my !== runId.current) return
      if (isDenial(e)) {
        setStage({ s: 'denied' })
      } else {
        // Re-enter 'ready' so Retry re-attempts the unlock without re-reading.
        setStage({ s: 'error', message: "We couldn't unlock the site. Please try again.", retryable: true })
      }
    }
  }, [stage, signerAddress, client, dAppKit, dev])

  const manageLink =
    canManage && activeAllowlistId ? (
      <a
        className="vbar__link mono"
        href={`#/access/${activeAllowlistId}`}
        onClick={(e) => {
          e.preventDefault()
          navigate(`#/access/${activeAllowlistId}`)
        }}
      >
        Manage viewer list →
      </a>
    ) : null

  // ── Render ─────────────────────────────────────────────────────────────────
  if (stage.s === 'unlocked') {
    return (
      <div className="vshell">
        <ViewerBar status={stage.siteName} tone="ok" right={manageLink ?? undefined} />
        <iframe className="vsite" title={stage.siteName} srcDoc={stage.srcDoc} sandbox="allow-scripts" />
      </div>
    )
  }

  let body: ReactNode
  if (stage.s === 'reading') {
    body = (
      <ViewerPanel kicker="Private site" title="Opening…">
        <p className="vspin">Reading the site from Sui and Walrus.</p>
      </ViewerPanel>
    )
  } else if (stage.s === 'error') {
    body = (
      <ViewerPanel
        kicker="Private site"
        title={stage.message}
        actions={
          stage.retryable ? (
            <button className="btn btn--primary" onClick={() => void load()}>
              Try again
            </button>
          ) : (
            <a className="btn btn--ghost" href="#/">
              Back to Suize
            </a>
          )
        }
      />
    )
  } else if (stage.s === 'denied') {
    body = (
      <ViewerPanel
        kicker="Private site"
        title="This site is private."
        actions={
          <a className="btn btn--ghost" href="#/">
            Back to Suize
          </a>
        }
      >
        <p>
          Your wallet isn’t on this site’s viewer list, so it stays sealed. If you think it should be,
          ask the owner to add you.
        </p>
      </ViewerPanel>
    )
  } else if (stage.s === 'unlocking') {
    body = (
      <ViewerPanel kicker="Private site" title="Unlocking…">
        <p className="vspin">{PHASE_TEXT[stage.phase]}</p>
      </ViewerPanel>
    )
  } else {
    // ready — awaiting sign-in / the unlock click
    body = (
      <ViewerPanel
        kicker="Private site"
        title={signerAddress ? 'This site is private.' : 'Sign in to view this private site.'}
        actions={
          signerAddress ? (
            <button className="btn btn--primary" onClick={() => void unlock()}>
              Unlock site
            </button>
          ) : (
            <ConnectButton />
          )
        }
      >
        <p>
          Only wallets on this site’s viewer list can open it. It decrypts on your device — nobody
          else, including us, can read a byte.
        </p>
      </ViewerPanel>
    )
  }

  const status =
    stage.s === 'reading'
      ? 'Opening…'
      : stage.s === 'unlocking'
        ? PHASE_TEXT[stage.phase]
        : stage.s === 'denied'
          ? 'Private'
          : ''
  const tone = stage.s === 'unlocking' ? 'work' : stage.s === 'denied' ? 'deny' : 'muted'

  return (
    <div className="vshell">
      <ViewerBar status={status} tone={tone} right={manageLink ?? undefined} />
      {body}
    </div>
  )
}
