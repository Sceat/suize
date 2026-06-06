import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Transaction } from '@mysten/sui/transactions'
import { fetch_vault_summary, type VaultSummary } from './api'
import {
  build_redeem_lp_tx,
  build_supply_tx,
  fetch_dusdc_coins,
  fetch_plp_coins,
  type ReadClient,
} from './sui'
import { DUSDC_SCALE } from './config'
import { dusdc_to_usd, fmt_amount, fmt_pct, fmt_usd } from './format'

// The TVL hero is the SINGLE LARGEST number on the page (e05's blue dominant
// figure). It must read like the target — WHOLE dollars, comma-grouped, NO cents
// ("$1,009,547"), never the raw 2-decimal fmt_usd ("$1009547.17"). Mirrors e05's fmtUsd.
const fmt_usd_whole = (units: bigint): string =>
  '$' + Math.round(Number(units) / Number(DUSDC_SCALE)).toLocaleString('en-US')

// dUSDC value (1e6 base units) of `shares` PLP at the live share price.
const shares_to_dusdc = (shares: bigint, share_price: number): bigint =>
  BigInt(Math.round(Number(shares) * share_price))

// What fraction of the whole vault a position of `shares` represents.
const ownership_frac = (shares: bigint, total_supply: number): number => {
  if (total_supply <= 0) return 0
  return Math.min(1, Number(shares) / total_supply)
}

type HouseBusy = null | 'supply' | 'redeem'

// The view-model + actions the e05 footer + deposit sheet need. ALL the
// data-fetching + the router::supply / redeem_lp write LOGIC is preserved
// verbatim from the old HouseMode.tsx — only its JSX was dropped (the footer is
// now drawn by the ported e05 design).
export type HouseVM = {
  tvlStr: string
  sharePriceStr: string
  shareChgStr: string
  yieldStr: string
  yieldUnit: string
  projFromStr: string
  projEarnStr: string
  projTierStr: string
  utilizationStr: string
  yourStakeStr: string | null
  ctaLabel: string
  hasPosition: boolean
  walletDusdcUsd: number | null
  // The user's REAL stake value (shares × live share price), e.g. "$5.00" — the
  // PROMINENT house number while holding, labeled "Your stake". null otherwise.
  positionValueStr: string | null
  supplyBusy: boolean
  redeemBusy: boolean
  canSupply: (usd: number) => boolean
  error: string | null
  // Epoch ms of the last SUCCESSFUL supply (0 if none this session). The e05
  // layer closes the deposit sheet when this changes — there is NO success toast.
  supplyDoneAt: number
}

export type HouseActions = {
  supply: (usd: number) => void
  redeem: () => void
}

// ============================================================================
// useHouse — the "Be the House" liquidity-provider LOGIC, as a headless hook.
// ----------------------------------------------------------------------------
// Reuses the parent's gasless write path (signAndExecute) and read client so a
// supply / redeem_lp is sponsored exactly like a bet. Owns its OWN data:
//   - vault summary (TVL, share price, utilization) from fetch_vault_summary
//   - the user's PLP position from getCoins(coinType=PLP)
//   - the user's spendable dUSDC from getCoins(coinType=DUSDC)
// All numbers are real (chain/indexer). On a write we reconcile by re-reading
// after the tx confirms. `on_balance_change` refreshes the shared BET balance.
// ============================================================================
export function useHouse({
  address,
  client,
  signAndExecute,
  on_balance_change,
}: {
  address: string | null
  client: ReadClient
  signAndExecute: (args: {
    transaction: Transaction
  }) => Promise<{ digest: string }>
  on_balance_change: () => void
}): { vm: HouseVM; actions: HouseActions } {
  const [vault, set_vault] = useState<VaultSummary | null>(null)

  const [shares, set_shares] = useState<bigint | null>(null)
  const [plp_coin_ids, set_plp_coin_ids] = useState<string[]>([])
  const [wallet_dusdc, set_wallet_dusdc] = useState<bigint | null>(null)
  const [dusdc_coin_ids, set_dusdc_coin_ids] = useState<string[]>([])

  const [busy, set_busy] = useState<HouseBusy>(null)
  const [error, set_error] = useState<string | null>(null)
  // Epoch timestamp bumped on each SUCCESSFUL supply. The e05 layer watches this
  // to CLOSE the deposit sheet (UX item I) — there is NO success toast anymore;
  // all house state lives in the house section.
  const [supply_done_at, set_supply_done_at] = useState<number>(0)

  // ----- live vault summary (every 15s) — REAL house data --------------------
  const load_vault = useCallback(async () => {
    try {
      const v = await fetch_vault_summary()
      set_vault(v)
    } catch {
      // keep last known vault summary; the next poll retries
    }
  }, [])

  useEffect(() => {
    load_vault()
    const id = setInterval(load_vault, 15_000)
    return () => clearInterval(id)
  }, [load_vault])

  // ----- the user's PLP position + spendable wallet dUSDC --------------------
  const refresh_position = useCallback(async () => {
    if (!address) {
      set_shares(null)
      set_plp_coin_ids([])
      set_wallet_dusdc(null)
      set_dusdc_coin_ids([])
      return
    }
    try {
      const [plp, dusdc] = await Promise.all([
        fetch_plp_coins(client, address),
        fetch_dusdc_coins(client, address),
      ])
      set_shares(plp.shares)
      set_plp_coin_ids(plp.coin_ids)
      set_wallet_dusdc(dusdc.total)
      set_dusdc_coin_ids(dusdc.coin_ids)
    } catch {
      // keep last known; the next poll retries
    }
  }, [address, client])

  useEffect(() => {
    refresh_position()
  }, [refresh_position])

  // ----- derived display ------------------------------------------------------
  const share_price = vault?.plp_share_price ?? 1
  const position_value =
    shares != null ? shares_to_dusdc(shares, share_price) : null
  const ownership =
    shares != null && vault != null
      ? ownership_frac(shares, vault.plp_total_supply)
      : 0

  const has_position = (shares ?? 0n) > 0n

  const supply_units_of = useCallback((usd: number): bigint => {
    if (!Number.isFinite(usd) || usd <= 0) return 0n
    return BigInt(Math.round(usd * Number(DUSDC_SCALE)))
  }, [])

  const can_supply = useCallback(
    (usd: number): boolean => {
      const units = supply_units_of(usd)
      return (
        address != null &&
        units > 0n &&
        wallet_dusdc != null &&
        units <= wallet_dusdc &&
        dusdc_coin_ids.length > 0 &&
        busy === null
      )
    },
    [address, wallet_dusdc, dusdc_coin_ids, busy, supply_units_of],
  )

  // ----- BECOME THE HOUSE (supply dUSDC -> PLP) ------------------------------
  const supply = useCallback(
    async (usd: number) => {
      set_error(null)
      if (!address) {
        set_error('Sign in first.')
        return
      }
      const supply_units = supply_units_of(usd)
      if (supply_units <= 0n) {
        set_error('Enter an amount to supply.')
        return
      }
      if ((wallet_dusdc ?? 0n) < supply_units || dusdc_coin_ids.length === 0) {
        set_error('Not enough dUSDC in your wallet — add test funds below.')
        return
      }
      set_busy('supply')
      try {
        const tx = build_supply_tx({
          amount: supply_units,
          dusdc_coin_ids,
        })
        const res = await signAndExecute({ transaction: tx })
        await wait_for(client, res.digest)
        // NO success toast (UX item J): ALL house state — your stake, share price,
        // withdraw — lives in the house section, which refreshes below. The sheet
        // is closed by the e05 layer off the `supplyDoneAt` epoch bumped here.
        await Promise.all([refresh_position(), load_vault()])
        set_supply_done_at(Date.now())
        on_balance_change()
      } catch (e) {
        set_error(`Supply failed: ${(e as Error).message}`)
        refresh_position()
      } finally {
        set_busy(null)
      }
    },
    [
      address,
      wallet_dusdc,
      dusdc_coin_ids,
      signAndExecute,
      client,
      refresh_position,
      load_vault,
      on_balance_change,
      supply_units_of,
    ],
  )

  // ----- CASH OUT OF THE HOUSE (burn ALL PLP -> dUSDC) -----------------------
  const redeem_all = useCallback(async () => {
    set_error(null)
    if (!address || shares == null || shares <= 0n) return
    if (plp_coin_ids.length === 0) {
      set_error('No house position to cash out.')
      return
    }
    set_busy('redeem')
    try {
      const tx = build_redeem_lp_tx({
        shares,
        plp_coin_ids,
      })
      const res = await signAndExecute({ transaction: tx })
      await wait_for(client, res.digest)
      // NO success toast (UX item J) — the house section reflects the now-empty
      // position after the refresh below.
      await Promise.all([refresh_position(), load_vault()])
      on_balance_change()
    } catch (e) {
      set_error(`Cash out failed: ${(e as Error).message}`)
      refresh_position()
    } finally {
      set_busy(null)
    }
  }, [
    address,
    shares,
    plp_coin_ids,
    signAndExecute,
    client,
    refresh_position,
    load_vault,
    on_balance_change,
  ])

  // The REAL, on-chain yield — NOTHING invented or projected.
  // PLP share price starts at $1.0000 and ticks UP as the house pockets the
  // spread players lose. All-time LP return = (share_price − 1)·100, straight
  // from the live vault summary. NOT annualized (no inception ts; owner forbids
  // any invented APY). 4 decimals so an early tiny accrual is still visible.
  const return_pct = (share_price - 1) * 100
  const return_str = `${return_pct >= 0 ? '+' : ''}${return_pct.toFixed(
    Math.abs(return_pct) >= 1 ? 2 : 4,
  )}%`

  const tvl_str =
    vault != null ? fmt_usd_whole(BigInt(Math.round(vault.vault_value))) : null
  // PROJECTION (NON-holders only): "if you deposited $X → earn $Y" — based on the
  // user's DEPOSITABLE funds (their wallet dUSDC, which is what `supply` actually
  // spends), NOT the betting wallet (manager+wallet). It is a clearly-labeled
  // projection of depositable funds; the e05 layer only shows it when the user
  // holds NO house position.
  const depositable = wallet_dusdc != null ? dusdc_to_usd(wallet_dusdc) : 0
  const proj_earn = depositable * (return_pct / 100)
  const proj_earn_str = `${proj_earn >= 0 ? '+' : ''}$${fmt_amount(proj_earn)}`
  const cta_label = has_position ? 'Add to the house' : 'Become the house'
  // The user's REAL stake value = shares × the live share price (dUSDC). This is
  // the prominent house number while HOLDING (labeled "Your stake"), NOT the
  // betting wallet balance. Exposed once as `positionValueStr` (the deposit sheet
  // + the "Your stake" block both read it).
  const position_value_str = has_position ? fmt_usd(position_value ?? 0n) : null

  const vm: HouseVM = useMemo(
    () => ({
      tvlStr: tvl_str ?? '…',
      sharePriceStr: vault != null ? `$${share_price.toFixed(4)}` : '—',
      shareChgStr:
        vault != null ? `Share price $${share_price.toFixed(4)} · live` : ' ',
      yieldStr: vault != null ? return_str : '—',
      yieldUnit: 'all-time',
      // Projection FROM the user's depositable wallet funds (non-holders only).
      projFromStr: `Deposit $${Math.round(depositable).toLocaleString('en-US')}`,
      projEarnStr: proj_earn_str,
      projTierStr: `${return_pct >= 0 ? '+' : ''}$${fmt_amount(1000 * (return_pct / 100))}`,
      utilizationStr: vault != null ? fmt_pct(vault.utilization, 1) : '—',
      yourStakeStr: has_position
        ? `${fmt_usd(position_value ?? 0n)} · ${fmt_pct(ownership, 2)}`
        : null,
      ctaLabel: cta_label,
      hasPosition: has_position,
      walletDusdcUsd: wallet_dusdc != null ? dusdc_to_usd(wallet_dusdc) : null,
      positionValueStr: position_value_str,
      supplyBusy: busy === 'supply',
      redeemBusy: busy === 'redeem',
      canSupply: can_supply,
      error,
      supplyDoneAt: supply_done_at,
    }),
    [
      tvl_str,
      vault,
      share_price,
      return_str,
      depositable,
      proj_earn_str,
      return_pct,
      has_position,
      position_value,
      ownership,
      position_value_str,
      cta_label,
      wallet_dusdc,
      busy,
      can_supply,
      error,
      supply_done_at,
    ],
  )

  return { vm, actions: { supply, redeem: redeem_all } }
}

// devInspect-only ReadClient has no waitForTransaction; the parent's full client
// does. The client passed in IS the dapp-kit SuiClient, so the method exists.
const wait_for = (client: ReadClient, digest: string): Promise<unknown> =>
  (
    client as unknown as {
      waitForTransaction: (a: { digest: string }) => Promise<unknown>
    }
  ).waitForTransaction({ digest })
