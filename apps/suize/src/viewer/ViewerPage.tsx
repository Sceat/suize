// =============================================================================
// The sealed-site VIEWER (#/view/<siteId>, and #/view-dev/<manifestBlobId> in
// dev). Reads the on-chain Site, proves the manifest against its on-chain hash,
// then — after the visitor connects their wallet — fetches the site's one
// decryption key, decrypts every file client-side, and renders the result in a
// sandboxed <iframe srcdoc> (allow-scripts only; NEVER allow-same-origin, the
// decrypted site is untrusted).
//
// The gate is a full-viewport VAULT DOOR: no navbar, no card chrome. One action
// in the happy path — connect — which immediately chains the unlock (session-key
// signature → key fetch → decrypt). Denial is cryptographic (NoAccessError) and
// shown as a dignified "does not have access", NEVER conflated with a transient
// failure (network / key-server), which keeps its own retryable state.
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
import { HeroShader } from '../HeroShader'
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

const NOTE = 'Encrypted on Walrus. Only wallets on its on-chain list can open it.'

// The single-line progress copy for the unlock chain (mono, no big spinners).
const PHASE_TEXT: Record<UnlockPhase, string> = {
  approve: 'opening a secure session…',
  keys: 'checking your wallet on the list…',
  decrypt: 'decrypting locally…',
  assemble: 'assembling the site…',
}

// Progress anchors per phase; the bar creeps gently toward the anchor so the
// wait always reads as movement (the anchors are real, the creep is cosmetic).
const PHASE_PCT: Record<UnlockPhase, number> = { approve: 30, keys: 55, decrypt: 85, assemble: 96 }

// A denial is a Seal *cryptographic refusal* — the NoAccessError class, nothing
// else. instanceof is the primary signal; constructor/name checks survive a copy
// of @mysten/seal crossing a bundle boundary. A transient failure (network, a
// key-server timeout, a rejected signature) is NEVER a denial: it must not be
// mistaken for "you're not on the list".
const isDenial = (e: unknown): boolean => {
  if (e instanceof NoAccessError) return true
  const err = e as { name?: string; message?: string; constructor?: { name?: string } } | null
  if (err?.constructor?.name === 'NoAccessError' || err?.name === 'NoAccessError') return true
  // The SDK's denial carries name "Error", and minification mangles the class
  // name in production bundles: the message is the stable signal.
  return /does not have access/i.test(err?.message ?? '')
}

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
  // The site name is shown by the vault door across every state (reading, denied,
  // error) — hoisted out of the stage so a denial/error still names the door.
  const [siteName, setSiteName] = useState<string | null>(null)
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
      if (my === runId.current) {
        setSiteName(loaded.siteName)
        setStage({ s: 'ready', loaded })
      }
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
      // Always surface the underlying error for diagnosis — the two user-facing
      // states below deliberately hide it.
      console.error('[viewer] unlock failed', e)
      if (isDenial(e)) {
        setStage({ s: 'denied' })
      } else {
        setStage({ s: 'error', message: "We couldn't unlock the site. Try again.", retryable: true })
      }
    }
  }, [stage, signerAddress, client, dAppKit, dev])

  // Fewer steps: the instant a Site is ready AND a wallet is present, chain the
  // unlock automatically — no separate "Unlock" button in the happy path. Keyed
  // on stage.s so it fires once per entry into 'ready' (a denial/error stays put,
  // so it never auto-retries; retry re-reads, which lands back here).
  useEffect(() => {
    if (stage.s === 'ready' && signerAddress) void unlock()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage.s, signerAddress])

  const switchWallet = useCallback(() => {
    void dAppKit.disconnectWallet().catch(() => {})
  }, [dAppKit])

  const manageLink =
    canManage && activeAllowlistId ? (
      <a
        className="vchip__link mono"
        href={`#/access/${activeAllowlistId}`}
        onClick={(e) => {
          e.preventDefault()
          navigate(`#/access/${activeAllowlistId}`)
        }}
      >
        Manage list →
      </a>
    ) : null

  // ── Unlocked: the decrypted site fills the viewport, a lone floating chip is
  // the only chrome (home + name, and the manage link when the wallet owns it).
  if (stage.s === 'unlocked') {
    return (
      <div className="vsite-shell">
        <div className="vchip mono">
          <a className="vchip__home" href="#/" aria-label="Back to Suize">
            Suize
          </a>
          <span className="vchip__sep" aria-hidden="true">
            /
          </span>
          <span className="vchip__name">{stage.siteName}</span>
          {manageLink}
        </div>
        <iframe className="vsite" title={stage.siteName} srcDoc={stage.srcDoc} sandbox="allow-scripts" />
      </div>
    )
  }

  // ── The vault door (reading / connecting / unlocking / denied / error) ──────
  const s = stage.s
  const connected = !!signerAddress
  // 'busy' = the unlock chain is running (or about to, the frame between ready
  // and the auto-unlock firing) — one calm progress line, no button.
  const busy = s === 'reading' || s === 'unlocking' || (s === 'ready' && connected)
  const progress =
    s === 'reading'
      ? 'reading the site from Sui and Walrus…'
      : s === 'unlocking'
        ? PHASE_TEXT[stage.phase]
        : PHASE_TEXT.approve

  let line: ReactNode
  let action: ReactNode = null
  if (s === 'denied') {
    line = <p className="vault__deny">This wallet does not have access.</p>
    action = (
      <button className="btn btn--ghost" onClick={switchWallet}>
        Switch wallet
      </button>
    )
  } else if (s === 'error') {
    line = <p className="vault__note">{stage.message}</p>
    action = stage.retryable ? (
      <>
        <button className="btn btn--primary" onClick={() => void load()}>
          Try again
        </button>
        <button className="btn btn--ghost" onClick={switchWallet}>
          Switch wallet
        </button>
      </>
    ) : (
      <a className="btn btn--ghost" href="#/">
        Back to Suize
      </a>
    )
  } else {
    line = <p className="vault__note">{NOTE}</p>
    action = busy ? (
      <div className="vault__busy">
      <div className="vault__bar" aria-hidden="true">
        <span
          className="vault__bar-fill"
          style={{ width: `${s === 'reading' ? 12 : s === 'unlocking' ? PHASE_PCT[stage.phase] : PHASE_PCT.approve}%` }}
        />
      </div>
      <p className="vault__progress mono">
        <span className="vault__spin" aria-hidden="true" />
        {progress}
      </p>
      </div>
    ) : (
      // ready + not connected → the one action: connect (auto-chains the unlock).
      <ConnectButton />
    )
  }

  return (
    <div className="vault">
      <HeroShader />
      <main className="vault__stage">
        <span className="vault__kicker mono">Private site</span>
        <h1 className="vault__name">{siteName ?? 'Private site'}</h1>
        {line}
        <div className="vault__act">{action}</div>
      </main>
      <footer className="vault__foot mono">served by Suize · decrypted in your browser</footer>
    </div>
  )
}
