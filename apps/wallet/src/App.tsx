import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ConnectButton } from '@mysten/dapp-kit-react/ui'
import { useCurrentAccount, useCurrentWallet, useDAppKit } from '@mysten/dapp-kit-react'
import {
  loadKiosks,
  loadOwnedSections,
  loadReverseName,
  loadTokens,
  type DisplayItem,
  type KioskData,
  type OwnedSections,
  type PlainObject,
  type TokenBalance,
} from './data/wallet'
import { GRAPHQL_URL, NETWORK, suiClient } from './config'
import { copyText } from './lib/copy'
import { formatBalance, messageFromError, middleTruncate, shortType } from './lib/format'
import { displayMatches, objectMatches, tokenMatches } from './lib/search'
import { SendForm } from './components/SendForm'
import {
  CheckIcon,
  ChevronIcon,
  CloseIcon,
  CopyIcon,
  CubeIcon,
  ExternalIcon,
  ImageIcon,
  LogoutIcon,
  PlusIcon,
  RefreshIcon,
  SearchIcon,
  WalletIcon,
} from './components/Icons'

const MOCK_ADDRESS = '0x9036f4be5ca0d0c2b890f12b398c032a00952aa41c2776507db0d018002373a7'

type SectionState<T> =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; data: T }
  | { status: 'error'; error: string }

const idle = { status: 'idle' } as const

function CopyButton({ value, label = 'Copy' }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    await copyText(value)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1600)
  }

  return (
    <button
      className="copy-button"
      type="button"
      onClick={copy}
      aria-label={`${label} full value`}
      title={value}
    >
      {copied ? <CheckIcon width={15} height={15} /> : <CopyIcon width={15} height={15} />}
      <span>{copied ? 'Copied' : label}</span>
    </button>
  )
}

function AccountMenu({ address, suinsName }: { address: string; suinsName: string | null }) {
  const wallet = useCurrentWallet()
  const dAppKit = useDAppKit()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onDoc(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const accounts = wallet?.accounts ?? []

  async function addAccount() {
    if (!wallet) return
    setBusy(true)
    try {
      // dapp-kit v2 flow: re-invoke connect on the SAME wallet to authorize an
      // additional account (Slush and other multi-account wallets prompt here).
      await dAppKit.connectWallet({ wallet })
      setOpen(false)
    } catch {
      // wallet dismissed / does not support multi-account — leave menu open.
    } finally {
      setBusy(false)
    }
  }

  function switchTo(account: (typeof accounts)[number]) {
    dAppKit.switchAccount({ account })
    setOpen(false)
  }

  async function disconnect() {
    setOpen(false)
    await dAppKit.disconnectWallet()
  }

  const label = suinsName ?? middleTruncate(address, 6, 4)

  return (
    <div className="account-menu" ref={ref}>
      <button
        className="account-trigger"
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        <span className="account-dot" aria-hidden="true" />
        <span className="account-label mono">{label}</span>
        <ChevronIcon width={15} height={15} className={open ? 'chev chev-open' : 'chev'} />
      </button>

      {open ? (
        <div className="account-pop glass-panel" role="menu">
          <div className="account-pop-head">
            <span className="eyebrow">Connected</span>
            {suinsName ? <strong>{suinsName}</strong> : null}
            <span className="account-full mono">{middleTruncate(address, 12, 10)}</span>
          </div>

          {accounts.length > 1 ? (
            <div className="account-list">
              {accounts.map((account) => (
                <button
                  key={account.address}
                  className={`account-item${account.address === address ? ' is-active' : ''}`}
                  type="button"
                  onClick={() => switchTo(account)}
                >
                  <span className="account-dot" aria-hidden="true" />
                  <span className="mono">{middleTruncate(account.address, 8, 6)}</span>
                </button>
              ))}
            </div>
          ) : null}

          <button
            className="account-action"
            type="button"
            onClick={addAccount}
            disabled={busy || !wallet}
          >
            <PlusIcon width={16} height={16} />
            <span>{busy ? 'Opening wallet…' : 'Add account'}</span>
          </button>
          <button className="account-action account-danger" type="button" onClick={disconnect}>
            <LogoutIcon width={16} height={16} />
            <span>Disconnect</span>
          </button>
        </div>
      ) : null}
    </div>
  )
}

function SectionHeader({
  icon,
  title,
  total,
  shown,
  searching,
  ready,
}: {
  icon: React.ReactNode
  title: string
  total: number
  shown: number
  searching: boolean
  ready: boolean
}) {
  return (
    <div className="section-heading">
      <span className="section-icon">{icon}</span>
      <h2>{title}</h2>
      {ready ? (
        <span className="count-badge mono">
          {searching ? `${shown} / ${total}` : total}
        </span>
      ) : null}
    </div>
  )
}

function SectionStatus({
  state,
  disconnected,
  label,
  onRetry,
}: {
  state: SectionState<unknown>
  disconnected: string
  label: string
  onRetry: () => void
}) {
  if (state.status === 'idle') {
    return (
      <div className="section-state">
        <span className="state-orb" />
        <p>{disconnected}</p>
      </div>
    )
  }
  if (state.status === 'loading') {
    return (
      <div className="skeleton-list" aria-label={`Loading ${label}`}>
        <span />
        <span />
        <span />
      </div>
    )
  }
  if (state.status === 'error') {
    return (
      <div className="section-state section-error" role="alert">
        <p>{state.error}</p>
        <button type="button" onClick={onRetry}>
          Try again
        </button>
      </div>
    )
  }
  return null
}

function NoMatch({ label }: { label: string }) {
  return <p className="no-match">No matching {label}.</p>
}

function CoinMark({ token }: { token: TokenBalance }) {
  const [failed, setFailed] = useState(false)
  if (token.iconUrl && !failed) {
    return (
      <img
        className="coin-mark coin-image"
        src={token.iconUrl}
        alt=""
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
      />
    )
  }
  return <span className="coin-mark coin-fallback">{token.symbol.slice(0, 1).toUpperCase()}</span>
}

function TokenRow({
  token,
  onSent,
}: {
  token: TokenBalance
  onSent: (digest: string, coinType: string, amount?: bigint) => void
}) {
  return (
    <article className="token-row">
      <div className="token-row-main">
        <CoinMark token={token} />
        <div className="token-identity">
          <strong>{token.symbol}</strong>
          <span className="token-name" title={token.coinType}>
            {token.name}
          </span>
        </div>
        <div className="token-amount">
          <strong className="mono">{formatBalance(token.balance, token.decimals)}</strong>
          <span className="mono">{token.symbol}</span>
        </div>
        <div className="token-send">
          <SendForm
            target={{
              kind: 'token',
              coinType: token.coinType,
              balance: token.balance,
              decimals: token.decimals,
              symbol: token.symbol,
            }}
            onSent={(digest, amount) => onSent(digest, token.coinType, amount)}
          />
        </div>
      </div>
    </article>
  )
}

function TokensSection({
  state,
  items,
  searching,
  onRefresh,
  onSent,
}: {
  state: SectionState<TokenBalance[]>
  items: TokenBalance[]
  searching: boolean
  onRefresh: () => void
  onSent: (digest: string, coinType: string, amount?: bigint) => void
}) {
  const total = state.status === 'ready' ? state.data.length : 0
  return (
    <section className="glass-panel wallet-section" id="tokens">
      <SectionHeader
        icon={<WalletIcon />}
        title="Tokens"
        total={total}
        shown={items.length}
        searching={searching}
        ready={state.status === 'ready'}
      />
      <SectionStatus
        state={state}
        disconnected="Connect your wallet to load token balances."
        label="tokens"
        onRetry={onRefresh}
      />
      {state.status === 'ready' ? (
        total === 0 ? (
          <div className="section-state">
            <p>No nonzero token balances found.</p>
          </div>
        ) : searching && items.length === 0 ? (
          <NoMatch label="tokens" />
        ) : (
          <div className="token-list">
            {items.map((token) => (
              <TokenRow token={token} key={token.coinType} onSent={onSent} />
            ))}
          </div>
        )
      ) : null}
    </section>
  )
}

function AssetImage({ item }: { item: DisplayItem }) {
  const [failed, setFailed] = useState(false)
  if (item.imageUrl && !failed) {
    return (
      <img
        src={item.imageUrl}
        alt=""
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
      />
    )
  }
  return (
    <div className="asset-placeholder" aria-label="No image available">
      <ImageIcon width={26} height={26} />
      <span>No image</span>
    </div>
  )
}

function AssetCard({
  item,
  kiosk = false,
  onSent,
}: {
  item: DisplayItem
  kiosk?: boolean
  onSent?: (digest: string, objectId: string) => void
}) {
  return (
    <article className="asset-card">
      <div className="asset-media">
        <AssetImage item={item} />
        {kiosk ? <span className="kiosk-tag">In kiosk</span> : null}
      </div>
      <div className="asset-body">
        <div className="asset-copy">
          <h3 title={item.name}>{item.name}</h3>
          <p title={item.type}>{item.collection}</p>
        </div>
        {kiosk ? (
          <div
            className="custody-note"
            title="Kiosk items remain in kiosk custody and are view-only here."
          >
            View only in kiosk
          </div>
        ) : item.publicTransfer && onSent ? (
          <SendForm
            target={{ kind: 'object', objectId: item.objectId, label: item.name }}
            onSent={(digest) => onSent(digest, item.objectId)}
            compact
          />
        ) : (
          <button
            className="unavailable-action"
            type="button"
            disabled
            title="This object's type does not allow public transfer."
          >
            View only
          </button>
        )}
      </div>
    </article>
  )
}

function NftsSection({
  state,
  items,
  searching,
  onRefresh,
  onSent,
}: {
  state: SectionState<OwnedSections>
  items: DisplayItem[]
  searching: boolean
  onRefresh: () => void
  onSent: (digest: string, objectId: string) => void
}) {
  const total = state.status === 'ready' ? state.data.nfts.length : 0
  return (
    <section className="glass-panel wallet-section" id="nfts">
      <SectionHeader
        icon={<ImageIcon />}
        title="NFTs"
        total={total}
        shown={items.length}
        searching={searching}
        ready={state.status === 'ready'}
      />
      <SectionStatus
        state={state}
        disconnected="Connect your wallet to load displayed objects."
        label="NFTs"
        onRetry={onRefresh}
      />
      {state.status === 'ready' ? (
        total === 0 ? (
          <div className="section-state">
            <p>No owned objects with Display metadata found.</p>
          </div>
        ) : searching && items.length === 0 ? (
          <NoMatch label="NFTs" />
        ) : (
          <div className="asset-grid">
            {items.map((item) => (
              <AssetCard item={item} key={item.objectId} onSent={onSent} />
            ))}
          </div>
        )
      ) : null}
    </section>
  )
}

function KioskSection({
  state,
  items,
  searching,
  onRefresh,
}: {
  state: SectionState<KioskData>
  items: DisplayItem[]
  searching: boolean
  onRefresh: () => void
}) {
  const total = state.status === 'ready' ? state.data.items.length : 0
  return (
    <section className="glass-panel wallet-section kiosk-section" id="kiosk">
      <SectionHeader
        icon={<CubeIcon />}
        title="Kiosk"
        total={total}
        shown={items.length}
        searching={searching}
        ready={state.status === 'ready'}
      />
      <SectionStatus
        state={state}
        disconnected="Connect your wallet to find owned kiosks."
        label="kiosk items"
        onRetry={onRefresh}
      />
      {state.status === 'ready' ? (
        state.data.kioskCount === 0 ? (
          <div className="section-state">
            <p>No owned kiosks found.</p>
          </div>
        ) : total === 0 ? (
          <div className="section-state">
            <p>No items in your owned kiosks.</p>
          </div>
        ) : searching && items.length === 0 ? (
          <NoMatch label="kiosk items" />
        ) : (
          <div className="asset-grid kiosk-grid">
            {items.map((item) => (
              <AssetCard item={item} kiosk key={item.objectId} />
            ))}
          </div>
        )
      ) : null}
    </section>
  )
}

function ObjectRow({
  object,
  onSent,
}: {
  object: PlainObject
  onSent: (digest: string, objectId: string) => void
}) {
  return (
    <div className="object-row">
      <div className="object-cell object-type">
        <span className="mobile-label">Type</span>
        <span className="type-value mono" title={object.type}>
          {shortType(object.type)}
        </span>
        <CopyButton value={object.type} label="Copy type" />
      </div>
      <div className="object-cell object-id">
        <span className="mobile-label">Object ID</span>
        <span className="mono" title={object.objectId}>
          {middleTruncate(object.objectId, 10, 8)}
        </span>
        <CopyButton value={object.objectId} label="Copy ID" />
      </div>
      <div className="object-action">
        {object.publicTransfer ? (
          <SendForm
            target={{ kind: 'object', objectId: object.objectId, label: shortType(object.type) }}
            onSent={(digest) => onSent(digest, object.objectId)}
            compact
          />
        ) : (
          <button
            className="unavailable-action"
            type="button"
            disabled
            title="This object's type does not allow public transfer."
          >
            View only
          </button>
        )}
      </div>
    </div>
  )
}

function ObjectsSection({
  state,
  items,
  searching,
  onRefresh,
  onSent,
}: {
  state: SectionState<OwnedSections>
  items: PlainObject[]
  searching: boolean
  onRefresh: () => void
  onSent: (digest: string, objectId: string) => void
}) {
  const total = state.status === 'ready' ? state.data.objects.length : 0
  return (
    <section className="glass-panel wallet-section" id="objects">
      <SectionHeader
        icon={<CubeIcon />}
        title="Objects"
        total={total}
        shown={items.length}
        searching={searching}
        ready={state.status === 'ready'}
      />
      <SectionStatus
        state={state}
        disconnected="Connect your wallet to load typed objects."
        label="objects"
        onRetry={onRefresh}
      />
      {state.status === 'ready' ? (
        total === 0 ? (
          <div className="section-state">
            <p>No other owned objects found.</p>
          </div>
        ) : searching && items.length === 0 ? (
          <NoMatch label="objects" />
        ) : (
          <div className="object-table">
            <div className="object-table-head" aria-hidden="true">
              <span>Type</span>
              <span>Object ID</span>
              <span>Action</span>
            </div>
            {items.map((object) => (
              <ObjectRow object={object} key={object.objectId} onSent={onSent} />
            ))}
          </div>
        )
      ) : null}
    </section>
  )
}

function SummaryStat({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="summary-stat">
      <span className="summary-value mono">{value ?? '—'}</span>
      <span className="summary-label">{label}</span>
    </div>
  )
}

export function App() {
  const params = new URLSearchParams(window.location.search)
  const mockEnabled = import.meta.env.DEV && params.get('mock') === '1'

  const account = useCurrentAccount()
  const address = account?.address ?? (mockEnabled ? MOCK_ADDRESS : null)

  const [tokens, setTokens] = useState<SectionState<TokenBalance[]>>(idle)
  const [owned, setOwned] = useState<SectionState<OwnedSections>>(idle)
  const [kiosks, setKiosks] = useState<SectionState<KioskData>>(idle)
  const [suinsName, setSuinsName] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [lastDigest, setLastDigest] = useState<string | null>(null)
  const [query, setQuery] = useState(params.get('q') ?? '')

  const refresh = useCallback(() => setReloadKey((value) => value + 1), [])

  useEffect(() => {
    if (!mockEnabled) return
    let cancelled = false
    void import('./dev/mock').then(({ buildMock }) => {
      if (cancelled) return
      const mock = buildMock()
      setTokens({ status: 'ready', data: mock.tokens })
      setOwned({ status: 'ready', data: mock.owned })
      setKiosks({ status: 'ready', data: mock.kiosks })
      setSuinsName(mock.suinsName)
    })
    return () => {
      cancelled = true
    }
  }, [mockEnabled])

  useEffect(() => {
    if (mockEnabled) return
    if (!address) {
      setTokens(idle)
      setOwned(idle)
      setKiosks(idle)
      setSuinsName(null)
      setLastDigest(null)
      return
    }

    const controller = new AbortController()
    const { signal } = controller
    setTokens({ status: 'loading' })
    setOwned({ status: 'loading' })
    setKiosks({ status: 'loading' })

    loadTokens(suiClient, address, signal).then(
      (data) => setTokens({ status: 'ready', data }),
      (error) => {
        if (!signal.aborted) setTokens({ status: 'error', error: messageFromError(error) })
      },
    )
    loadOwnedSections(GRAPHQL_URL, address, signal).then(
      (data) => setOwned({ status: 'ready', data }),
      (error) => {
        if (!signal.aborted) setOwned({ status: 'error', error: messageFromError(error) })
      },
    )
    loadKiosks(suiClient, GRAPHQL_URL, address, signal).then(
      (data) => setKiosks({ status: 'ready', data }),
      (error) => {
        if (!signal.aborted) setKiosks({ status: 'error', error: messageFromError(error) })
      },
    )
    loadReverseName(GRAPHQL_URL, address, signal).then(setSuinsName, () => {
      if (!signal.aborted) setSuinsName(null)
    })
    return () => controller.abort()
  }, [address, reloadKey, mockEnabled])

  function scheduleRefresh() {
    if (mockEnabled) return
    window.setTimeout(refresh, 1800)
  }

  function tokenSent(digest: string, coinType: string, amount?: bigint) {
    setLastDigest(digest)
    if (amount) {
      setTokens((current) => {
        if (current.status !== 'ready') return current
        return {
          status: 'ready',
          data: current.data
            .map((token) =>
              token.coinType === coinType
                ? { ...token, balance: (BigInt(token.balance) - amount).toString() }
                : token,
            )
            .filter((token) => BigInt(token.balance) > 0n),
        }
      })
    }
    scheduleRefresh()
  }

  function objectSent(digest: string, objectId: string) {
    setLastDigest(digest)
    setOwned((current) => {
      if (current.status !== 'ready') return current
      return {
        status: 'ready',
        data: {
          nfts: current.data.nfts.filter((item) => item.objectId !== objectId),
          objects: current.data.objects.filter((item) => item.objectId !== objectId),
        },
      }
    })
    scheduleRefresh()
  }

  const searching = query.trim().length > 0

  const filteredTokens = useMemo(
    () => (tokens.status === 'ready' ? tokens.data.filter((t) => tokenMatches(t, query)) : []),
    [tokens, query],
  )
  const filteredNfts = useMemo(
    () => (owned.status === 'ready' ? owned.data.nfts.filter((n) => displayMatches(n, query)) : []),
    [owned, query],
  )
  const filteredObjects = useMemo(
    () =>
      owned.status === 'ready' ? owned.data.objects.filter((o) => objectMatches(o, query)) : [],
    [owned, query],
  )
  const filteredKioskItems = useMemo(
    () =>
      kiosks.status === 'ready' ? kiosks.data.items.filter((i) => displayMatches(i, query)) : [],
    [kiosks, query],
  )

  const tokenCount = tokens.status === 'ready' ? tokens.data.length : null
  const nftCount = owned.status === 'ready' ? owned.data.nfts.length : null
  const objectCount = owned.status === 'ready' ? owned.data.objects.length : null
  const kioskCount = kiosks.status === 'ready' ? kiosks.data.items.length : null

  const totalItems =
    (tokenCount ?? 0) + (nftCount ?? 0) + (objectCount ?? 0) + (kioskCount ?? 0)
  const totalMatches =
    filteredTokens.length +
    filteredNfts.length +
    filteredObjects.length +
    filteredKioskItems.length

  const resultLabel = searching
    ? `${totalMatches} ${totalMatches === 1 ? 'result' : 'results'}`
    : tokens.status === 'ready'
      ? `${totalItems} items`
      : 'Loading…'

  const refreshing =
    tokens.status === 'loading' || owned.status === 'loading' || kiosks.status === 'loading'

  return (
    <div className="app-shell">
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />
      <div className="ambient ambient-three" />
      <div className="grain" aria-hidden="true" />

      <main>
        <header className="app-header glass-panel">
          <div className="header-row">
            <a className="brand" href="./" aria-label="Suize wallet home">
              <span className="brand-mark">S</span>
              <span className="brand-word">suize</span>
              <span className="brand-slash">/</span>
              <span>wallet</span>
            </a>
            <div className="header-controls">
              <span className="net-chip">
                <span className="net-dot" />
                {NETWORK === 'mainnet' ? 'Sui mainnet' : 'Sui testnet'}
              </span>
              {address ? (
                <AccountMenu address={address} suinsName={suinsName} />
              ) : (
                <ConnectButton>Connect wallet</ConnectButton>
              )}
            </div>
          </div>

          {address ? (
            <div className="identity-row">
              <div className="identity-main">
                {suinsName ? <strong className="suins-name">{suinsName}</strong> : null}
                <span className="address-line mono" title={address}>
                  {middleTruncate(address, 20, 16)}
                </span>
                <CopyButton value={address} label="Copy" />
              </div>
              <div className="asset-summary">
                <SummaryStat label="Tokens" value={tokenCount} />
                <SummaryStat label="NFTs" value={nftCount} />
                <SummaryStat label="Kiosk" value={kioskCount} />
                <SummaryStat label="Objects" value={objectCount} />
              </div>
            </div>
          ) : (
            <div className="welcome">
              <h1>Find any asset. Send in a click.</h1>
              <p className="hero-lede">
                One clear view of every token, collectable, kiosk, and capability object you own.
                Search across all of them at once, then send with your wallet in control.
              </p>
              <div className="connect-prompt">
                <span className="prompt-icon">
                  <WalletIcon width={21} height={21} />
                </span>
                <div>
                  <strong>Your keys stay in your wallet</strong>
                  <span>Every send is reviewed and signed there.</span>
                </div>
              </div>
            </div>
          )}
        </header>

        {address ? (
          <div className="search-bar glass-panel">
            <span className="search-icon">
              <SearchIcon width={19} height={19} />
            </span>
            <input
              className="search-input"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search tokens, NFTs, objects, or 0x…"
              autoComplete="off"
              spellCheck={false}
              aria-label="Search all assets"
            />
            {query ? (
              <button
                className="search-clear"
                type="button"
                onClick={() => setQuery('')}
                aria-label="Clear search"
              >
                <CloseIcon width={16} height={16} />
              </button>
            ) : null}
            <span className="search-count mono">{resultLabel}</span>
            <button
              className="refresh-button"
              type="button"
              onClick={refresh}
              disabled={refreshing}
              aria-label="Refresh wallet data"
            >
              <RefreshIcon width={16} height={16} />
            </button>
          </div>
        ) : null}

        {lastDigest ? (
          <div className="transaction-notice glass-panel" role="status" aria-live="polite">
            <span className="notice-check">
              <CheckIcon width={17} height={17} />
            </span>
            <div>
              <strong>Transaction submitted</strong>
              <a
                href={`https://suiscan.xyz/mainnet/tx/${lastDigest}`}
                target="_blank"
                rel="noreferrer"
              >
                {middleTruncate(lastDigest, 10, 9)} <ExternalIcon width={13} height={13} />
              </a>
            </div>
            <button
              type="button"
              onClick={() => setLastDigest(null)}
              aria-label="Dismiss transaction notice"
            >
              <CloseIcon width={17} height={17} />
            </button>
          </div>
        ) : null}

        {address ? (
          <div className="sections">
            <TokensSection
              state={tokens}
              items={filteredTokens}
              searching={searching}
              onRefresh={refresh}
              onSent={tokenSent}
            />
            <div className="section-pair">
              <NftsSection
                state={owned}
                items={filteredNfts}
                searching={searching}
                onRefresh={refresh}
                onSent={objectSent}
              />
              <KioskSection
                state={kiosks}
                items={filteredKioskItems}
                searching={searching}
                onRefresh={refresh}
              />
            </div>
            <ObjectsSection
              state={owned}
              items={filteredObjects}
              searching={searching}
              onRefresh={refresh}
              onSent={objectSent}
            />
          </div>
        ) : null}

        <footer>
          <span>Suize wallet</span>
          <span>Reads from Sui {NETWORK}</span>
          {address ? <span>{refreshing ? 'Refreshing wallet data' : 'Wallet data loaded'}</span> : null}
        </footer>
      </main>
    </div>
  )
}
