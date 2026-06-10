import { useCallback, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useSignTransaction, useSuiClient } from '@mysten/dapp-kit'
import type { EventId, SuiJsonRpcClient } from '@mysten/sui/jsonRpc'
import { ACCOUNT_PUBLISHED, PACKAGE_IDS } from '@suize/shared'
import { build_deploy_account, execute_sponsored } from './api'
import { fmt_id } from './format'

// ============================================================================
// RAIL ACCOUNT affordance — the pragmatic dev UX for "which funded Suize rail
// Account pays?". The consumer wallet app owns the REAL flow; here the dashboard
// just needs an Account id for the $0.50 deploy charge + the $19.99/mo storage
// subscription. Two sources, in priority order:
//   1. a pasted Account id, persisted to localStorage (explicit override), or
//   2. on-chain discovery: the NEWEST `account::AccountCreated` event whose
//      `owner` is the connected zkLogin address (bounded look-back, same event
//      pattern as chain.ts uses for domains).
// Plus the one CREATE rung a zkLogin user can't reach any other way: a gasless
// "create rail account" button (sponsored create_account<USDC>, signed locally —
// owner = sender on-chain, so only the user's own session can mint THEIR
// Account). DEPOSIT stays CLI/wallet-side (deposit is permissionless).
// Ids come ONLY from @suize/shared (LOCKED #15); display only — every write the
// id feeds is rebuilt + verified by the backend and signed locally by the user.
// ============================================================================

const RAIL_ACCOUNT_KEY = 'suize-deploy.rail-account'

const ACCOUNT_CREATED_TYPE = `${PACKAGE_IDS.ACCOUNT.PACKAGE}::account::AccountCreated`

// Loose object-id shape (0x + hex). The backend re-validates strictly; this only
// gates the local button so a sloppy paste fails fast, client-side.
const OBJECT_ID_RE = /^0x[0-9a-f]{1,64}$/i

export const is_rail_account_id = (id: string): boolean =>
  OBJECT_ID_RE.test(id.trim())

const load_stored = (): string => {
  try {
    return window.localStorage.getItem(RAIL_ACCOUNT_KEY) ?? ''
  } catch {
    return ''
  }
}

// ---- Discovery ------------------------------------------------------------

interface AccountCreatedJson {
  account_id: string
  owner: string
}

// The connected owner's newest rail Account, recovered from AccountCreated
// events (descending, bounded pages — mirrors chain.ts's domain look-back).
// Null when none found / the rail package isn't published. Never throws to the
// UI — a discovery failure just means "paste an id".
export const discover_rail_account = async (
  client: SuiJsonRpcClient,
  owner: string,
): Promise<string | null> => {
  if (!ACCOUNT_PUBLISHED) return null
  let cursor: EventId | null = null
  for (let pageNo = 0; pageNo < 5; pageNo++) {
    const page = await client.queryEvents({
      query: { MoveEventType: ACCOUNT_CREATED_TYPE },
      order: 'descending',
      cursor,
      limit: 50,
    })
    for (const e of page.data) {
      const j = e.parsedJson as Partial<AccountCreatedJson>
      // Newest-first scan ⇒ the first owner match IS the newest Account.
      if (j.owner === owner && typeof j.account_id === 'string') {
        return j.account_id
      }
    }
    if (!page.hasNextPage || !page.nextCursor) break
    cursor = page.nextCursor
  }
  return null
}

// ---- Hook -------------------------------------------------------------------

export type RailAccountState = {
  /** The effective Account id ('' when none): pasted override, else discovered. */
  account: string
  /** True when `account` is a plausible object id (enables pay/subscribe CTAs). */
  valid: boolean
  /** The raw pasted value (drives the controlled input; '' = use discovery). */
  stored: string
  setStored: (id: string) => void
  /** The newest on-chain AccountCreated match for this owner, when found. */
  discovered: string | null
  discovering: boolean
}

export const useRailAccount = (owner: string | null): RailAccountState => {
  const client = useSuiClient()
  const [stored, setStoredState] = useState<string>(load_stored)

  const setStored = useCallback((id: string) => {
    setStoredState(id)
    try {
      if (id.trim()) window.localStorage.setItem(RAIL_ACCOUNT_KEY, id.trim())
      else window.localStorage.removeItem(RAIL_ACCOUNT_KEY)
    } catch {
      /* storage blocked — the in-memory state still works for this session */
    }
  }, [])

  const discovery = useQuery({
    queryKey: ['rail-account', owner],
    enabled: !!owner && !stored.trim() && ACCOUNT_PUBLISHED,
    staleTime: 60_000,
    retry: false,
    queryFn: () => discover_rail_account(client, owner!),
  })

  const discovered = discovery.data ?? null
  const account = stored.trim() || discovered || ''

  return {
    account,
    valid: is_rail_account_id(account),
    stored,
    setStored,
    discovered,
    discovering: discovery.isFetching,
  }
}

// ---- Field ------------------------------------------------------------------

// The shared input + status hint + the gasless create rung. `idPrefix` keeps
// label/input ids unique when the field appears on more than one screen;
// `owner` (the connected zkLogin address) arms the create button.
export const RailAccountField = ({
  rail,
  idPrefix,
  owner,
}: {
  rail: RailAccountState
  idPrefix: string
  owner: string | null
}) => {
  const pasted = rail.stored.trim()
  const client = useSuiClient()
  const { mutateAsync: signTransaction } = useSignTransaction()

  // Sponsored create_account<USDC>: build (backend) → sign LOCALLY (zkLogin) →
  // execute → read the Account id off the AccountCreated event → adopt it.
  const create = useMutation({
    mutationFn: async (): Promise<string> => {
      if (!owner) throw new Error('Sign in with Google first.')
      const built = await build_deploy_account({ sender: owner })
      const { signature } = await signTransaction({ transaction: built.bytes })
      const executed = await execute_sponsored({
        digest: built.digest,
        signature,
      })
      const full = await client.waitForTransaction({
        digest: executed.digest,
        options: { showEvents: true },
      })
      const ev = (full.events ?? []).find(
        e => e.type === ACCOUNT_CREATED_TYPE,
      )
      const json = (ev?.parsedJson ?? {}) as { account_id?: string }
      if (!json.account_id) {
        throw new Error(
          'Account created but its AccountCreated event was not found — re-open this screen or paste the id manually.',
        )
      }
      rail.setStored(json.account_id)
      return json.account_id
    },
  })

  return (
    <>
      <label className="dx-label" htmlFor={`${idPrefix}-rail-account`}>
        Rail account
      </label>
      <input
        id={`${idPrefix}-rail-account`}
        className="dx-field"
        type="text"
        inputMode="text"
        autoCapitalize="none"
        spellCheck={false}
        placeholder="0x… your funded Suize rail Account id"
        value={rail.stored}
        onChange={e => rail.setStored(e.target.value)}
      />
      {pasted && !is_rail_account_id(pasted) && (
        <p className="dx-error">
          That doesn't look like an object id (<code>0x…</code> hex).
        </p>
      )}
      {!pasted && rail.discovering && (
        <p className="dx-hint">Looking for your rail Account on-chain…</p>
      )}
      {!pasted && !rail.discovering && rail.discovered && (
        <p className="dx-hint" title={rail.discovered}>
          Using your on-chain Account <b>{fmt_id(rail.discovered)}</b> (newest
          AccountCreated for this address). Paste a different id to override.
        </p>
      )}
      {!pasted && !rail.discovering && !rail.discovered && (
        <>
          <p className="dx-hint">
            No rail Account found for this address. Create one below (gasless,
            signed by your session), then fund it with testnet USDC
            (<code>account::deposit</code> is permissionless — CLI or wallet),
            or paste an existing Account id above.
          </p>
          <button
            type="button"
            className="dx-btn is-sm"
            disabled={!owner || create.isPending}
            onClick={() => create.mutate()}
          >
            {create.isPending ? 'Creating…' : 'Create rail account'}
          </button>
          {create.isError && (
            <p className="dx-error">{(create.error as Error).message}</p>
          )}
        </>
      )}
    </>
  )
}
