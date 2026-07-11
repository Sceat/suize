// ============================================================================
// Read tools + the kill switch — direct-to-chain against the session's network.
// Ledger reads (balance, owned objects) go over gRPC; the agent's tx history (an
// indexer-style query gRPC does not serve) goes over Sui GraphQL RPC. suize_balance
// / suize_receipts / suize_subscriptions never sign; suize_kill is the ONE
// read-file tool that signs (a full-balance sweep home).
// ============================================================================

import { publicKeyFromSuiBytes } from '@mysten/sui/verify'
import { grpcClient, graphqlQuery } from './chain'
import { formatUsdc, SUBS_PACKAGES, SUI_ADDRESS_RE, USDC_TYPES } from './config'
import { clearSession, requireSession, subaccountFor } from './session'

// ── suize_balance — the agent's spendable SUB-ACCOUNT + its USDC, printed first ─
// Funds live in the 1-of-2 sub-account multisig {MAIN, AGENT} (deposit = the hard
// cap). We lead with THAT address (the one the wallet's Agent card asks the user to
// fund) + its balance. With no MAIN member connected there is no multisig → the
// agent spends its own bare address, which we report instead.

export const suizeBalance = async (): Promise<string> => {
  const session = requireSession()
  const subaccount = subaccountFor(session)
  const address = subaccount?.address ?? session.address
  let totalBalance: string
  try {
    const { balance } = await grpcClient(session.network).getBalance({
      owner: address,
      coinType: USDC_TYPES[session.network],
    })
    totalBalance = balance.balance // total spendable = coin objects + Address Balance
  } catch {
    throw new Error('could not read the balance — check your connection and retry')
  }
  return JSON.stringify(
    {
      address,
      hint: subaccount
        ? `This is your agent's sub-account — fund it from your main wallet; its balance is the hard cap the agent can spend.`
        : `This is your agent's own address — fund it from your main wallet to give the agent USDC to spend.`,
      network: session.network,
      usdc: formatUsdc(BigInt(totalBalance)),
    },
    null,
    2,
  )
}

// ── suize_receipts — the agent's recent USDC SPENDS, from its own tx history ──
// VANILLA x402: payments are plain `send_funds` transfers, NOT a rail `Paid` event
// (account.move is dead). So we read the agent's OWN transactions over GraphQL
// (transactions filtered by `sentAddress`) and keep the rows whose net USDC change is
// NEGATIVE (an outgoing payment). We report exactly how far we searched so the
// assistant can never over-claim an empty history it never reached.

// GraphQL BalanceChange: `{ amount, coinType { repr }, owner { address } }`.
type BalanceChange = { amount: string; coinType?: { repr: string }; owner?: { address?: string } }

const toBig = (v: unknown): bigint => {
  try {
    return typeof v === 'string' || typeof v === 'number' ? BigInt(v) : 0n
  } catch {
    return 0n
  }
}

const RECEIPTS_PAGE = 50
const RECEIPTS_MAX_PAGES = 5 // ≤ 250 tx scanned per call

// The agent's own transaction history — an indexer-style read the node's gRPC does
// not serve, so it runs over Sui GraphQL RPC. `sentAddress` = the FromAddress filter;
// each tx carries its `effects.balanceChanges` (the signed USDC deltas we tally).
const TX_HISTORY_QUERY = `query($addr: SuiAddress!, $last: Int!, $before: String) {
  transactions(filter: { sentAddress: $addr }, last: $last, before: $before) {
    pageInfo { hasPreviousPage startCursor }
    nodes {
      digest
      effects {
        timestamp
        balanceChanges { nodes { amount coinType { repr } owner { address } } }
      }
    }
  }
}`

type TxHistoryPage = {
  transactions: {
    pageInfo: { hasPreviousPage: boolean; startCursor: string | null }
    nodes: Array<{
      digest: string
      effects: { timestamp: string | null; balanceChanges: { nodes: BalanceChange[] } } | null
    }>
  }
}

export const suizeReceipts = async (args: { limit?: unknown }): Promise<string> => {
  const session = requireSession()
  const wanted = Math.min(50, Math.max(1, Math.floor(Number(args.limit ?? 10)) || 10))
  const usdc = USDC_TYPES[session.network]
  const me = session.address.toLowerCase()

  const receipts: Array<{ digest: string; time: string | null; amount: string }> = []
  let before: string | null = null
  let scanned = 0
  let pages = 0
  let exhausted = false

  try {
    while (receipts.length < wanted && pages < RECEIPTS_MAX_PAGES) {
      const resp: TxHistoryPage = await graphqlQuery<TxHistoryPage>(session.network, TX_HISTORY_QUERY, {
        addr: session.address,
        last: RECEIPTS_PAGE,
        before,
      })
      const transactions = resp.transactions
      const nodes = transactions?.nodes ?? []
      pages++
      scanned += nodes.length
      // A GraphQL page arrives oldest→newest; reverse it so we report newest-first.
      for (const tx of [...nodes].reverse()) {
        const changes = tx.effects?.balanceChanges?.nodes ?? []
        // Net USDC change for THIS address on this tx (sum across coin entries).
        let net = 0n
        for (const c of changes) {
          if (c.coinType?.repr !== usdc) continue
          if ((c.owner?.address ?? '').toLowerCase() !== me) continue
          net += toBig(c.amount)
        }
        if (net >= 0n) continue // not an outgoing USDC payment — skip
        receipts.push({
          digest: tx.digest,
          time: tx.effects?.timestamp ?? null, // GraphQL yields an ISO timestamp
          amount: formatUsdc(-net), // the USDC that left the wallet
        })
        if (receipts.length >= wanted) break
      }
      const pageInfo = transactions?.pageInfo
      if (!pageInfo?.hasPreviousPage || !pageInfo.startCursor) {
        exhausted = true
        break
      }
      before = pageInfo.startCursor
    }
  } catch {
    throw new Error('could not read the transaction history — check your connection and retry')
  }

  // HONESTY: a search capped before the stream ran out is the most-recent slice,
  // NOT proof of an empty history — say so, so the assistant never over-claims.
  const cappedShort = !exhausted && receipts.length < wanted
  return JSON.stringify(
    {
      address: session.address,
      network: session.network,
      count: receipts.length,
      receipts,
      ...(cappedShort
        ? { searched: `the most recent ${scanned} transactions (search capped — older payments may exist)` }
        : {}),
    },
    null,
    2,
  )
}

// ── suize_subscriptions — the agent's on-chain Subscription<USDC> objects ─────
// Each subscription is a Party-owned object (see packages/move-subs). We list the
// ones the agent owns with paid_until + is_active, so the assistant can answer
// "what am I subscribed to / when does it renew?".

type SubFields = {
  merchant?: string
  amount?: string | number
  period_ms?: string | number
  paid_until_ms?: string | number
  ref?: string
}

// The subset of gRPC `listOwnedObjects` we read (`include: { json: true }` → the
// Move struct fields on `json`). A local structural type both documents what we use
// and keeps TSC from over-inferring through the SDK's deep conditional Object type.
type OwnedObjectsPage = {
  objects: Array<{ objectId: string; json?: Record<string, unknown> | null }>
  hasNextPage: boolean
  cursor: string | null
}

export const suizeSubscriptions = async (): Promise<string> => {
  const session = requireSession()
  const pkg = SUBS_PACKAGES[session.network]
  if (pkg === '0x0') {
    throw new Error(`subscriptions are not published on ${session.network} yet — none to read`)
  }
  const usdc = USDC_TYPES[session.network]
  const subType = `${pkg}::subscription::Subscription<${usdc}>`
  const client = grpcClient(session.network)

  const now = Date.now()
  const subs: Array<{
    subscriptionId: string
    merchant: string
    amount: string
    periodMs: number
    paidUntil: string | null
    isActive: boolean
    ref: string
  }> = []

  try {
    let cursor: string | null = null
    for (let page = 0; page < 5; page++) {
      const owned: OwnedObjectsPage = await client.listOwnedObjects({
        owner: session.address,
        type: subType,
        cursor,
        limit: 50,
        include: { json: true },
      })
      for (const o of owned.objects) {
        const f = (o.json ?? undefined) as SubFields | undefined
        if (!f) continue
        const paidUntil = Number(f.paid_until_ms ?? 0)
        subs.push({
          subscriptionId: o.objectId,
          merchant: f.merchant ?? '',
          amount: formatUsdc(toBig(f.amount)),
          periodMs: Number(f.period_ms ?? 0),
          paidUntil: paidUntil ? new Date(paidUntil).toISOString() : null,
          isActive: now < paidUntil,
          ref: typeof f.ref === 'string' ? f.ref : '',
        })
      }
      if (!owned.hasNextPage || !owned.cursor) break
      cursor = owned.cursor
    }
  } catch {
    throw new Error('could not read the subscriptions — check your connection and retry')
  }

  return JSON.stringify(
    { address: session.address, network: session.network, count: subs.length, subscriptions: subs },
    null,
    2,
  )
}

// ── suize_kill — the loss-proof sweep ─────────────────────────────────────────
// The kill switch: send the agent's ENTIRE sub-account USDC balance back to the
// user's MAIN wallet in one gasless transfer, then the session is cleared so the
// agent can no longer spend. The sweep runs FROM the 1-of-2 sub-account multisig
// {MAIN, AGENT}, signed by the AGENT member alone (the agent sweeps ITSELF home; the
// human can also sweep via the wallet with the MAIN member). Destination = the MAIN
// address, derived from the session's `mainPubKey` (the multisig's other member);
// when the wallet's /agent-connect did NOT post one, an explicit `to` arg is REQUIRED
// (a sweep with no home is worse than no sweep). Idempotent: a zero-balance wallet is
// a no-op. NEVER a partial sweep — it is all-or-nothing.

const GASLESS_MIN_UNITS = 10_000n // ~$0.01 — below this the gasless send is unreliable

export interface KillArgs {
  /** Explicit sweep destination — REQUIRED only when the session has no mainPubKey. */
  to?: unknown
}

export const suizeKill = async (args: KillArgs): Promise<string> => {
  const session = requireSession()

  // The spendable balance lives in the sub-account multisig (when a MAIN member was
  // connected); a bare-address session sweeps its own address.
  const subaccount = subaccountFor(session)
  const source = subaccount?.address ?? session.address

  // Resolve the destination: the MAIN address derived from the session's mainPubKey
  // (the multisig's other member — RESOLVED: the page now posts mainPubKey, so the
  // sweep home is no longer a stub), else the explicit `to` arg.
  let destination = session.mainPubKey
    ? publicKeyFromSuiBytes(session.mainPubKey).toSuiAddress()
    : undefined
  let usedArg = false
  if (!destination) {
    const arg = typeof args.to === 'string' ? args.to.trim() : ''
    if (!SUI_ADDRESS_RE.test(arg)) {
      // The session carries no mainPubKey (an older / main-wallet-unaware connect),
      // so there is no derivable home — the user MUST pass an explicit `to` so a
      // sweep can never go nowhere.
      throw new Error(
        'no sweep destination — your connect session has no main address, so suize_kill needs an explicit ' +
          '"to" (your main wallet 0x…64-hex address). Pass it ONLY after confirming it is YOUR wallet.',
      )
    }
    destination = arg
    usedArg = true
  }

  // Read the full sub-account USDC balance.
  let balanceUnits: bigint
  try {
    const { balance } = await grpcClient(session.network).getBalance({
      owner: source,
      coinType: USDC_TYPES[session.network],
    })
    balanceUnits = BigInt(balance.balance)
  } catch {
    throw new Error('could not read the balance to sweep — check your connection and retry')
  }

  // Idempotent: nothing to sweep → a clean no-op (and clear the session anyway, so
  // a kill always leaves the agent unable to spend).
  if (balanceUnits === 0n) {
    clearSession()
    return JSON.stringify(
      { swept: '0', destination, network: session.network, note: 'agent wallet was already empty — session cleared, agent disarmed' },
      null,
      2,
    )
  }

  // STUB(kill-dust): below the gasless minimum the Address-Balance send is
  // unreliable; an Enoki-sponsored fallback would cover it, but the MCP must NOT
  // bake Enoki sponsoring in (custody/dep law). Surface the dust honestly — the
  // user can sweep it from the wallet app — and still clear the session.
  if (balanceUnits < GASLESS_MIN_UNITS) {
    clearSession()
    return JSON.stringify(
      {
        swept: '0',
        dust: formatUsdc(balanceUnits),
        destination,
        network: session.network,
        note:
          'balance is below the gasless minimum (~$0.01) — too small to sweep gaslessly from here; ' +
          'sweep the dust from the Suize wallet app. Session cleared, agent disarmed.',
      },
      null,
      2,
    )
  }

  // Sweep the FULL balance home through the shared direct-transfer path. A kill is
  // an explicit emergency action, so the dial is auto-approved (the user already
  // invoked it; a confirm prompt would defeat the point). Lazy-import the x402
  // client so the read tools' import graph stays light when kill is never called.
  const { directTransfer, makeConfirmGate } = await import('./x402-client')
  const receipt = await directTransfer(session, destination, balanceUnits, makeConfirmGate({ kind: 'auto' }, true))

  // Swept — disarm the agent (clear the local session). The signer used the live
  // session above; clearing after the broadcast can't strand the in-flight tx.
  clearSession()
  return JSON.stringify(
    {
      swept: formatUsdc(balanceUnits),
      digest: receipt.transaction,
      destination,
      ...(usedArg ? { destinationSource: 'explicit arg' } : { destinationSource: 'your connected main wallet' }),
      network: session.network,
      note: 'agent balance swept home and the session cleared — the agent can no longer spend',
    },
    null,
    2,
  )
}
