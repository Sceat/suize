import { useSuiClient } from '@mysten/dapp-kit'
import { useQuery } from '@tanstack/react-query'
import { fetch_deploy_wallet } from '../api'
import { fetch_balance, SUI_COIN_TYPE } from '../chain'
import { SUI_NETWORK } from '../config'
import { describe_error, EmptyState, IconBack, IconExternal, LoadingState, CopyButton } from '../ui'
import { fmt_id } from '../format'

// ============================================================================
// ADMIN · operational balances — the owner-only read-only panel.
//
// What it is FOR: the owner must keep the deploy SERVICE WALLET topped up or
// Deploy stops working — it pays create_site GAS in SUI and Walrus-extend storage
// in WAL. This panel surfaces both balances at a glance with a "top up when low"
// amber signal, plus a SuiVision deep-link to inspect/fund the address.
//
// READ-ONLY by construction: every figure is public on-chain data read straight
// from the dapp-kit testnet client (no backend, no writes). The handle-gate in
// App.tsx (sceat@suize) is a CONVENIENCE that hides the tab — NOT security: there
// is nothing here to protect (anyone could read these balances from chain).
//
// The service wallet ADDRESS comes from the backend (GET /deploy/wallet-address)
// since the frontend never holds the deploy key; balances are then read on-chain.
// ============================================================================

// SuiVision links — network-aware (mainnet host vs the testnet. subdomain).
const SUIVISION = SUI_NETWORK === 'mainnet' ? 'https://suivision.xyz' : `https://${SUI_NETWORK}.suivision.xyz`
const SUIVISION_ACCOUNT = (addr: string): string => `${SUIVISION}/account/${addr}`
const SUIVISION_COIN = (addr: string, coinType: string): string =>
  `${SUIVISION}/account/${addr}?tab=Coins&coinType=${encodeURIComponent(coinType)}`

// "Top up when low" thresholds, in WHOLE coins (SUI / WAL both 9 decimals). FLAG
// to owner: these are conservative starting points — a deploy's create_site gas is
// a few hundredths of a SUI and an extend is a small WAL amount, so these cover
// many ops of headroom. Tune to the real burn rate once observed.
const SUI_LOW_THRESHOLD = 1 // < 1 SUI → amber
const WAL_LOW_THRESHOLD = 5 // < 5 WAL → amber

// base units (9 decimals) → a trimmed decimal string: "12.34", "0.0512", "0".
const fmt_coin = (base: string, decimals = 9): string => {
  let v: bigint
  try {
    v = BigInt(base)
  } catch {
    return '—'
  }
  const div = 10n ** BigInt(decimals)
  const whole = v / div
  const frac = v % div
  if (frac === 0n) return whole.toString()
  // up to 4 significant fractional digits, trailing zeros stripped
  const fracStr = frac.toString().padStart(decimals, '0').slice(0, 4).replace(/0+$/, '')
  return fracStr ? `${whole.toString()}.${fracStr}` : whole.toString()
}

// whole-coin float for the threshold compare (display-grade, not for money math).
const toWhole = (base: string, decimals = 9): number => {
  try {
    return Number(BigInt(base)) / 10 ** decimals
  } catch {
    return 0
  }
}

interface BalanceRowProps {
  label: string
  hint: string
  symbol: string
  /** base-unit balance string, or null while the address/balance is unresolved. */
  base: string | null
  threshold: number
  href: string
}

const BalanceRow = ({ label, hint, symbol, base, threshold, href }: BalanceRowProps) => {
  const whole = base != null ? toWhole(base) : null
  const low = whole != null && whole < threshold
  return (
    <div className={`dx-bal${low ? ' is-low' : ''}`}>
      <div className="dx-bal__head">
        <span className="dx-bal__label">{label}</span>
        {low ? (
          <span className="dx-tag is-warn">Top up</span>
        ) : whole != null ? (
          <span className="dx-tag is-bull">Healthy</span>
        ) : null}
      </div>
      <div className="dx-bal__amount">
        <span className="dx-bal__num">{base != null ? fmt_coin(base) : '—'}</span>
        <span className="dx-bal__sym">{symbol}</span>
      </div>
      <p className="dx-bal__hint">{hint}</p>
      <a className="dx-bal__link" href={href} target="_blank" rel="noreferrer">
        <IconExternal /> View on SuiVision
      </a>
    </div>
  )
}

export const AdminView = ({ onBack }: { onBack: () => void }) => {
  const client = useSuiClient()

  // 1) the deploy service wallet address (+ WAL coin type) from the backend.
  const walletQ = useQuery({
    queryKey: ['deploy-wallet-address'],
    queryFn: fetch_deploy_wallet,
    retry: false,
    staleTime: 60_000,
  })
  const address = walletQ.data?.address ?? null
  const walCoinType = walletQ.data?.walCoinType ?? null

  // 2) the on-chain SUI + WAL balances of that address (refresh every 20s while open).
  const balancesQ = useQuery({
    queryKey: ['deploy-wallet-balances', address, walCoinType],
    enabled: !!address && !!walCoinType,
    refetchInterval: 20_000,
    retry: false,
    queryFn: async () => {
      const [sui, wal] = await Promise.all([
        fetch_balance(client, address as string, SUI_COIN_TYPE),
        fetch_balance(client, address as string, walCoinType as string),
      ])
      return { sui: sui.totalBalance, wal: wal.totalBalance }
    },
  })

  return (
    <>
      <button type="button" className="dx-back" onClick={onBack}>
        <IconBack /> All sites
      </button>

      <div className="dx-pagehead">
        <div>
          <p className="ed-eyebrow">Admin · operations</p>
          <h1 className="dx-pagehead__title">Service wallet balances</h1>
        </div>
      </div>

      <p className="dx-lede" style={{ marginTop: '-8px', marginBottom: 28 }}>
        The deploy service wallet pays for every deploy: <b>SUI</b> for the
        on-chain <code>create_site</code> gas, and <b>WAL</b> for Walrus storage
        (and the auto-renew extends). Keep both topped up or deploys start failing.
        These figures are read live from chain — read-only.
      </p>

      {walletQ.isLoading && <LoadingState label="Resolving the service wallet…" />}

      {walletQ.isError && (
        <EmptyState
          kicker="Unavailable"
          {...describe_error(walletQ.error)}
        />
      )}

      {address && (
        <>
          <div className="dx-panel">
            <div className="dx-row">
              <span className="dx-row__k">Service wallet</span>
              <span className="dx-row__v">
                <code title={address}>{fmt_id(address)}</code>{' '}
                <CopyButton value={address} label="Copy address" />{' '}
                <a
                  className="dx-bal__link"
                  href={SUIVISION_ACCOUNT(address)}
                  target="_blank"
                  rel="noreferrer"
                  style={{ marginLeft: 4 }}
                >
                  <IconExternal /> SuiVision
                </a>
              </span>
            </div>
          </div>

          {balancesQ.isError && (
            <EmptyState
              kicker="Read failed"
              title="Couldn't read balances"
              body="The chain read for SUI / WAL failed. It retries automatically; refresh if it persists."
            />
          )}

          <div className="dx-balgrid">
            <BalanceRow
              label="Gas · SUI"
              symbol="SUI"
              hint="Pays create_site gas for every deploy. When this runs dry, new deploys fail to register on-chain."
              base={balancesQ.data?.sui ?? null}
              threshold={SUI_LOW_THRESHOLD}
              href={SUIVISION_ACCOUNT(address)}
            />
            <BalanceRow
              label="Storage · WAL"
              symbol="WAL"
              hint="Pays Walrus storage on deploy + the auto-renew extends. Empty WAL means sites can't be stored or kept alive."
              base={balancesQ.data?.wal ?? null}
              threshold={WAL_LOW_THRESHOLD}
              href={walCoinType ? SUIVISION_COIN(address, walCoinType) : SUIVISION_ACCOUNT(address)}
            />
          </div>
        </>
      )}
    </>
  )
}
