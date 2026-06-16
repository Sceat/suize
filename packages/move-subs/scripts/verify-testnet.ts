// THROWAWAY testnet verification harness for the published `subs::subscription`
// module (packages/move-subs). Proves V1 (sponsored CREATE) · V2 (RENEW window +
// ETooEarly double-charge guard) · V3 (party-object discovery + sponsored renew) ·
// CANCEL end-to-end against REAL testnet with micro amounts.
//
// RUN (from repo root or this dir):
//   cd packages/move-subs && bun run scripts/verify-testnet.ts
//
// Signer = the Sui CLI active address (the publisher → SubsConfig.treasury +
// SubsAdminCap holder in dev). Keys are read from the CLI keystore, NEVER printed.
//
// Enoki sponsorship: read ENOKI_PRIVATE_API_KEY from services/backend/.env. The
// production sponsor allow-list (services/backend/src/sponsor) does NOT yet include
// the subs targets, so this harness sponsors with an EXPLICIT subs allow-list to
// prove the party-object shape is Enoki-sponsorable; it ALSO probes the production
// allow-list to prove the gap is real. Falls back to self-paid gas on any Enoki miss.

import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { SuiJsonRpcClient } from '@mysten/sui/jsonRpc'
import { Transaction } from '@mysten/sui/transactions'
import { fromBase64 } from '@mysten/sui/utils'
import { EnokiClient } from '@mysten/enoki'
import {
  PACKAGE_IDS,
  USDC_TYPE,
  SUBS_MOVE_TARGETS,
  CRASH_MOVE_TARGETS,
  WALLET_MOVE_TARGETS,
  fullnodeUrl,
} from '@suize/shared'

// ── constants ────────────────────────────────────────────────────────────────
const SUBS = PACKAGE_IDS.SUBS
const PKG = SUBS.PACKAGE
const CONFIG_ID = SUBS.CONFIG_OBJECT
// VERSION-GATED (2026-06-15): create/renew/cancel each take `version: &Version` FIRST.
const VERSION_ID = SUBS.VERSION_OBJECT
const CLOCK_ID = '0x6'
const AMOUNT = 50_000n // $0.05 — small enough that fee = the $0.01 floor (10_000)
const EXPECTED_FEE = 10_000n // floor dominates 2% of $0.05 ($0.001)
const NET = AMOUNT - EXPECTED_FEE
const PERIOD_MS = 120_000 // 2-minute demo period
const REF = Array.from(fromHex('74657374')) // "test"
const SUB_TYPE = `${PKG}::subscription::Subscription<${USDC_TYPE}>`
const CREATED_EVT = `${PKG}::subscription::SubscriptionCreated`
const RENEWED_EVT = `${PKG}::subscription::SubscriptionRenewed`
const CANCELLED_EVT = `${PKG}::subscription::SubscriptionCancelled`
const ETooEarly = 0 // abort code in subscription.move

function fromHex(h: string): Uint8Array {
  const out = new Uint8Array(h.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16)
  return out
}

// ── signer (CLI keystore; never printed) ─────────────────────────────────────
const SUI_CONFIG_DIR = join(homedir(), '.sui', 'sui_config')
function loadCliKeypair(): Ed25519Keypair {
  const clientYaml = readFileSync(join(SUI_CONFIG_DIR, 'client.yaml'), 'utf8')
  const active = /active_address:\s*"?(0x[0-9a-fA-F]+)"?/.exec(clientYaml)?.[1]
  const entries = JSON.parse(readFileSync(join(SUI_CONFIG_DIR, 'sui.keystore'), 'utf8')) as string[]
  for (const e of entries) {
    const raw = Buffer.from(e, 'base64')
    if (raw.length !== 33 || raw[0] !== 0x00) continue
    const kp = Ed25519Keypair.fromSecretKey(new Uint8Array(raw.subarray(1)))
    if (!active || kp.toSuiAddress().toLowerCase() === active.toLowerCase()) return kp
  }
  throw new Error('CLI keypair not found')
}

// ── Enoki key from services/backend/.env ─────────────────────────────────────
function loadEnokiKey(): string | undefined {
  try {
    const env = readFileSync(join(import.meta.dir, '..', '..', '..', 'services', 'backend', '.env'), 'utf8')
    const m = /^ENOKI_PRIVATE_API_KEY=(.*)$/m.exec(env)
    const v = m?.[1]?.trim()
    return v && v.length > 0 ? v : undefined
  } catch {
    return undefined
  }
}

const client = new SuiJsonRpcClient({ url: fullnodeUrl('testnet'), network: 'testnet' })
const signer = loadCliKeypair()
const sender = signer.toSuiAddress()
const enokiKey = loadEnokiKey()
const enoki = enokiKey ? new EnokiClient({ apiKey: enokiKey }) : null

const log = (...a: unknown[]) => console.log(...a)
const usdc = async (owner: string) => BigInt((await client.getBalance({ owner, coinType: USDC_TYPE })).totalBalance)

/**
 * Try to Enoki-sponsor a transaction-kind. Returns the executed digest, or null
 * (with a logged reason) if sponsorship is unavailable / rejected — the caller
 * then falls back to self-paid gas. `allowedTargets` lets us prove BOTH the
 * production-allow-list gap and the (explicit) subs-allow-list success.
 */
async function trySponsor(
  tx: Transaction,
  allowedTargets: string[],
  label: string,
): Promise<string | null> {
  if (!enoki) {
    log(`  [sponsor:${label}] no Enoki key — self-paid fallback`)
    return null
  }
  try {
    const kindBytes = await tx.build({ client, onlyTransactionKind: true })
    const sponsored = await enoki.createSponsoredTransaction({
      network: 'testnet',
      transactionKindBytes: Buffer.from(kindBytes).toString('base64'),
      sender,
      allowedAddresses: [sender],
      allowedMoveCallTargets: allowedTargets,
    })
    // The USER signs the sponsored bytes locally (non-custodial law).
    const { signature } = await signer.signTransaction(fromBase64(sponsored.bytes))
    const exec = await enoki.executeSponsoredTransaction({ digest: sponsored.digest, signature })
    await client.waitForTransaction({ digest: exec.digest })
    return exec.digest
  } catch (err) {
    log(`  [sponsor:${label}] REJECTED → ${(err as Error).message}; self-paid fallback`)
    return null
  }
}

/** Self-paid execution (the publisher pays its own gas). */
async function selfPaid(tx: Transaction) {
  return client.signAndExecuteTransaction({
    transaction: tx,
    signer,
    options: { showEffects: true, showEvents: true },
  })
}

async function main() {
  log('═══ subs::subscription testnet verification ═══')
  log('package    :', PKG)
  log('config     :', CONFIG_ID)
  log('signer     :', sender)
  log('USDC (sender):', (await usdc(sender)).toString())
  log('Enoki key  :', enoki ? 'present' : 'ABSENT (self-paid only)')
  log('CREATE tgt :', SUBS.TARGETS.CREATE)

  const merchant = Ed25519Keypair.fromSecretKey(new Uint8Array(randomBytes(32))).toSuiAddress()
  const treasuryBefore = await usdc(sender) // sender == SubsConfig.treasury in dev
  log('\nmerchant (fresh):', merchant)

  // ─────────────────────────────────────────────────────────────────────────
  // V1 — sponsored CREATE (coin-held USDC via the CoinWithBalance intent).
  // ─────────────────────────────────────────────────────────────────────────
  log('\n── V1: CREATE ──────────────────────────────────────────────')

  // First PROBE the PRE-SUBS production sponsor allow-list (CRASH+WALLET, no subs)
  // to empirically prove the gap subs filled. Build a throwaway create tx for the
  // probe. (Production now includes SUBS once published — this probe is historical.)
  if (enoki) {
    const probe = new Transaction()
    probe.setSender(sender)
    probe.moveCall({
      target: SUBS.TARGETS.CREATE,
      typeArguments: [USDC_TYPE],
      arguments: [
        probe.object(VERSION_ID),
        probe.object(CONFIG_ID),
        probe.pure.address(merchant),
        probe.pure.u64(AMOUNT),
        probe.pure.u64(PERIOD_MS),
        probe.pure.vector('u8', REF),
        probe.balance({ type: USDC_TYPE, balance: AMOUNT }),
        probe.object(CLOCK_ID),
      ],
    })
    try {
      const kind = await probe.build({ client, onlyTransactionKind: true })
      await enoki!.createSponsoredTransaction({
        network: 'testnet',
        transactionKindBytes: Buffer.from(kind).toString('base64'),
        sender,
        allowedAddresses: [sender],
        allowedMoveCallTargets: [...CRASH_MOVE_TARGETS, ...WALLET_MOVE_TARGETS],
      })
      log('  [probe] PRE-SUBS allow-list (CRASH+WALLET) ACCEPTED subs::create — UNEXPECTED')
    } catch (err) {
      log('  [probe] PRE-SUBS allow-list (CRASH+WALLET) REJECTED subs::create (expected gap):')
      log('          ', (err as Error).message)
    }
  }

  // Now the REAL create — sponsored with an explicit subs allow-list.
  const createTx = new Transaction()
  createTx.setSender(sender)
  createTx.moveCall({
    target: SUBS.TARGETS.CREATE,
    typeArguments: [USDC_TYPE],
    arguments: [
      createTx.object(VERSION_ID),
      createTx.object(CONFIG_ID),
      createTx.pure.address(merchant),
      createTx.pure.u64(AMOUNT),
      createTx.pure.u64(PERIOD_MS),
      createTx.pure.vector('u8', REF),
      createTx.balance({ type: USDC_TYPE, balance: AMOUNT }),
      createTx.object(CLOCK_ID),
    ],
  })

  let createDigest = await trySponsor(createTx, SUBS_MOVE_TARGETS, 'create')
  let createdEvent: any
  let createSponsored = createDigest !== null

  if (createDigest) {
    // Sponsored path executed — fetch events from the digest.
    const tx = await client.getTransactionBlock({
      digest: createDigest,
      options: { showEvents: true, showEffects: true },
    })
    createdEvent = (tx.events ?? []).find((e) => e.type === CREATED_EVT)
  } else {
    // Self-paid fallback (rebuild — a sponsored-and-failed tx can't be reused).
    const tx2 = new Transaction()
    tx2.moveCall({
      target: SUBS.TARGETS.CREATE,
      typeArguments: [USDC_TYPE],
      arguments: [
        tx2.object(CONFIG_ID),
        tx2.pure.address(merchant),
        tx2.pure.u64(AMOUNT),
        tx2.pure.u64(PERIOD_MS),
        tx2.pure.vector('u8', REF),
        tx2.balance({ type: USDC_TYPE, balance: AMOUNT }),
        tx2.object(CLOCK_ID),
      ],
    })
    const res = await selfPaid(tx2)
    createDigest = res.digest
    await client.waitForTransaction({ digest: createDigest })
    createdEvent = (res.events ?? []).find((e) => e.type === CREATED_EVT)
  }

  log(`  CREATE digest : ${createDigest}  (${createSponsored ? 'SPONSORED' : 'self-paid'})`)
  if (!createdEvent) throw new Error('no SubscriptionCreated event')
  const cj = createdEvent.parsedJson as {
    subscription_id: string
    owner: string
    merchant: string
    amount: string
    period_ms: string
    paid_until_ms: string
    fee: string
    ref: number[]
  }
  log('  SubscriptionCreated:', JSON.stringify(cj))
  const subId = cj.subscription_id
  assert(cj.owner.toLowerCase() === sender.toLowerCase(), 'created.owner == sender')
  assert(cj.merchant.toLowerCase() === merchant.toLowerCase(), 'created.merchant == merchant')
  assert(BigInt(cj.amount) === AMOUNT, 'created.amount == AMOUNT')
  assert(BigInt(cj.period_ms) === BigInt(PERIOD_MS), 'created.period_ms == PERIOD_MS')
  assert(BigInt(cj.fee) === EXPECTED_FEE, `created.fee == floor ${EXPECTED_FEE}`)
  const paidUntil1 = BigInt(cj.paid_until_ms)

  // merchant got NET, treasury (== sender) net effect = -NET (it is also the payer).
  const merchantBal = await usdc(merchant)
  log(`  merchant USDC : ${merchantBal} (expect NET ${NET})`)
  assert(merchantBal === NET, `merchant received NET ${NET}`)
  const treasuryAfter = await usdc(sender)
  log(`  sender(=treasury+payer) delta: ${treasuryAfter - treasuryBefore} (expect -NET ${-NET})`)
  // sender paid AMOUNT, received FEE back (it is the treasury) → net -NET. Gas is
  // gasless/sponsored OR self-paid SUI (different coin), so USDC delta is exactly -NET.
  assert(treasuryAfter - treasuryBefore === -NET, 'sender USDC delta == -NET (payer is also treasury)')

  // The Party object itself.
  const obj = await client.getObject({ id: subId, options: { showOwner: true, showType: true, showContent: true } })
  log('  getObject.owner:', JSON.stringify(obj.data?.owner))
  log('  getObject.type :', obj.data?.type)
  const ownerKind = obj.data?.owner ? Object.keys(obj.data.owner)[0] : '(none)'
  log(`  → ownership kind string: ${ownerKind}`)

  // ─────────────────────────────────────────────────────────────────────────
  // V3a — party-object DISCOVERY. Does getOwnedObjects return it?
  // ─────────────────────────────────────────────────────────────────────────
  log('\n── V3a: getOwnedObjects discovery ──────────────────────────')
  const owned = await client.getOwnedObjects({
    owner: sender,
    filter: { StructType: SUB_TYPE },
    options: { showType: true, showOwner: true },
  })
  log(`  getOwnedObjects(filter Subscription<USDC>) → ${owned.data.length} object(s)`)
  for (const o of owned.data) log('    ', o.data?.objectId, JSON.stringify(o.data?.owner))
  const foundByOwned = owned.data.some((o) => o.data?.objectId === subId)
  log(`  found our sub via getOwnedObjects: ${foundByOwned}`)
  if (!foundByOwned) {
    // Fallback: event-based discovery (queryEvents by the Created event type).
    log('  → getOwnedObjects did NOT surface the party object; proving event-based discovery:')
    const evs = await client.queryEvents({
      query: { MoveEventType: CREATED_EVT },
      order: 'descending',
      limit: 25,
    })
    const mine = evs.data.filter((e) => (e.parsedJson as any)?.owner?.toLowerCase() === sender.toLowerCase())
    log(`     queryEvents(SubscriptionCreated) → ${evs.data.length} total, ${mine.length} owned by sender`)
    const hit = mine.find((e) => (e.parsedJson as any)?.subscription_id === subId)
    log(`     our subId discoverable via events: ${!!hit}`)
    assert(!!hit, 'sub discoverable via SubscriptionCreated events')
  }

  // ─────────────────────────────────────────────────────────────────────────
  // V2 — RENEW after the period clock advances (window is 24h → immediately ok).
  // ─────────────────────────────────────────────────────────────────────────
  log('\n── V2: RENEW (after ~90s) ──────────────────────────────────')
  log('  waiting ~90s so wall-clock advances within the period…')
  await sleep(90_000)

  const renewTx = buildRenew(subId)
  let renewDigest = await trySponsor(renewTx, SUBS_MOVE_TARGETS, 'renew')
  const renewSponsored = renewDigest !== null
  let renewedEvent: any
  if (renewDigest) {
    const tx = await client.getTransactionBlock({ digest: renewDigest, options: { showEvents: true } })
    renewedEvent = (tx.events ?? []).find((e) => e.type === RENEWED_EVT)
  } else {
    const res = await selfPaid(buildRenew(subId))
    renewDigest = res.digest
    await client.waitForTransaction({ digest: renewDigest })
    renewedEvent = (res.events ?? []).find((e) => e.type === RENEWED_EVT)
  }
  log(`  RENEW digest : ${renewDigest}  (${renewSponsored ? 'SPONSORED' : 'self-paid'})`)
  if (!renewedEvent) throw new Error('no SubscriptionRenewed event')
  const rj = renewedEvent.parsedJson as { paid_until_ms: string; fee: string; amount: string }
  log('  SubscriptionRenewed:', JSON.stringify(rj))
  const paidUntil2 = BigInt(rj.paid_until_ms)
  log(`  paid_until: ${paidUntil1} → ${paidUntil2} (Δ ${paidUntil2 - paidUntil1})`)
  // renew advances by exactly one period from max(paid_until, now). Since we
  // renewed EARLY (within window, not lapsed), base = old paid_until, so the
  // advance is EXACTLY PERIOD_MS.
  assert(paidUntil2 - paidUntil1 === BigInt(PERIOD_MS), 'renew advanced paid_until by EXACTLY one period')

  // V2b — ETooEarly guard. NOTE (live-clock physics): with a 2-min PERIOD_MS the
  // renew window (24h) is FAR wider than the period, so a SECOND immediate renew on
  // the 2-min sub does NOT abort — it just advances another exact period (the window
  // logic, re-asserted below). The brief's "immediate second renew → ETooEarly"
  // premise only holds when paid_until is >24h ahead of now, which a 2-min period
  // can't reach without ~720 renews. To prove the guard on a LIVE clock we use a
  // dedicated LONG-period sub: create it (paid_until = now + 90d), then renew
  // IMMEDIATELY — `now + 24h < paid_until` ⇒ the renew MUST abort ETooEarly. (The
  // 17 move unit tests cover the same-period double-renew abort with a mock clock.)

  // First: confirm the 2-min sub's second renew SUCCEEDS within the window (the
  // physically-correct behavior — NOT an abort) and advances another exact period.
  log('\n── V2b-i: 2nd renew on 2-min sub is WITHIN 24h window → succeeds ──')
  {
    const res = await selfPaid(buildRenew(subId))
    await client.waitForTransaction({ digest: res.digest })
    const ev = (res.events ?? []).find((e) => e.type === RENEWED_EVT)
    const pu3 = BigInt((ev!.parsedJson as { paid_until_ms: string }).paid_until_ms)
    log(`  2nd renew digest: ${res.digest}; paid_until ${paidUntil2} → ${pu3} (Δ ${pu3 - paidUntil2})`)
    assert(res.effects?.status?.status === 'success', '2nd in-window renew SUCCEEDS (not ETooEarly)')
    assert(pu3 - paidUntil2 === BigInt(PERIOD_MS), '2nd renew advanced paid_until by EXACTLY one period')
  }

  // Now: the guard itself — a LONG-period sub renewed immediately MUST abort ETooEarly.
  log('\n── V2b-ii: long-period sub, immediate renew → ETooEarly ────')
  const LONG_PERIOD_MS = 90 * 24 * 60 * 60 * 1000 // 90 days — > the 24h window
  const longCreate = new Transaction()
  longCreate.moveCall({
    target: SUBS.TARGETS.CREATE,
    typeArguments: [USDC_TYPE],
    arguments: [
      longCreate.object(VERSION_ID),
      longCreate.object(CONFIG_ID),
      longCreate.pure.address(merchant),
      longCreate.pure.u64(AMOUNT),
      longCreate.pure.u64(LONG_PERIOD_MS),
      longCreate.pure.vector('u8', REF),
      longCreate.balance({ type: USDC_TYPE, balance: AMOUNT }),
      longCreate.object(CLOCK_ID),
    ],
  })
  const longRes = await selfPaid(longCreate)
  await client.waitForTransaction({ digest: longRes.digest })
  const longEv = (longRes.events ?? []).find((e) => e.type === CREATED_EVT)
  const longSubId = (longEv!.parsedJson as { subscription_id: string }).subscription_id
  log(`  long-period sub created: ${longSubId} (period ${LONG_PERIOD_MS}ms, digest ${longRes.digest})`)

  let abortSurfaced = false
  let abortDetail = ''
  try {
    const res = await selfPaid(buildRenew(longSubId))
    if (res.effects?.status?.status !== 'success') {
      abortSurfaced = true
      abortDetail = JSON.stringify(res.effects?.status)
    }
  } catch (err) {
    abortSurfaced = true
    abortDetail = (err as Error).message
  }
  log(`  immediate renew aborted: ${abortSurfaced}`)
  log(`  abort detail: ${abortDetail}`)
  assert(abortSurfaced, 'immediate renew on a >24h-ahead sub ABORTED (ETooEarly guard)')
  assert(
    abortDetail.includes(`${ETooEarly}`) &&
      (abortDetail.includes('subscription') || abortDetail.includes('MoveAbort')),
    `abort references ETooEarly code ${ETooEarly}`,
  )

  // ─────────────────────────────────────────────────────────────────────────
  // V3b — was the renew sponsorable? (party-object input under Enoki.)
  // ─────────────────────────────────────────────────────────────────────────
  log('\n── V3b: sponsored party-object renew ───────────────────────')
  if (renewSponsored) {
    log('  ✓ Enoki ACCEPTED the party-object-input renew tx (digest above).')
  } else {
    log('  ⚠ renew was NOT sponsored (self-paid fallback) — see flags for the reason.')
  }

  // ─────────────────────────────────────────────────────────────────────────
  // CANCEL — destroy the sub; confirm Cancelled event + object gone.
  // ─────────────────────────────────────────────────────────────────────────
  log('\n── CANCEL ──────────────────────────────────────────────────')
  const cancelTx = new Transaction()
  cancelTx.moveCall({
    target: SUBS.TARGETS.CANCEL,
    typeArguments: [USDC_TYPE],
    arguments: [cancelTx.object(VERSION_ID), cancelTx.object(subId)],
  })
  let cancelDigest = await trySponsor(cancelTx, SUBS_MOVE_TARGETS, 'cancel')
  const cancelSponsored = cancelDigest !== null
  let cancelledEvent: any
  if (cancelDigest) {
    const tx = await client.getTransactionBlock({ digest: cancelDigest, options: { showEvents: true } })
    cancelledEvent = (tx.events ?? []).find((e) => e.type === CANCELLED_EVT)
  } else {
    const tx2 = new Transaction()
    tx2.moveCall({
      target: SUBS.TARGETS.CANCEL,
      typeArguments: [USDC_TYPE],
      arguments: [tx2.object(VERSION_ID), tx2.object(subId)],
    })
    const res = await selfPaid(tx2)
    cancelDigest = res.digest
    await client.waitForTransaction({ digest: cancelDigest })
    cancelledEvent = (res.events ?? []).find((e) => e.type === CANCELLED_EVT)
  }
  log(`  CANCEL digest : ${cancelDigest}  (${cancelSponsored ? 'SPONSORED' : 'self-paid'})`)
  if (!cancelledEvent) throw new Error('no SubscriptionCancelled event')
  log('  SubscriptionCancelled:', JSON.stringify(cancelledEvent.parsedJson))

  const gone = await client.getObject({ id: subId, options: { showContent: true } })
  log('  getObject after cancel:', JSON.stringify({ error: gone.error, data: gone.data ? 'PRESENT' : null }))
  assert(!!gone.error || gone.data === null, 'subscription object DELETED after cancel')

  // Clean up the V2b-ii long-period probe sub (self-paid — just housekeeping).
  log('\n── CANCEL (long-period probe sub) ──────────────────────────')
  const cancelLong = new Transaction()
  cancelLong.moveCall({
    target: SUBS.TARGETS.CANCEL,
    typeArguments: [USDC_TYPE],
    arguments: [cancelLong.object(VERSION_ID), cancelLong.object(longSubId)],
  })
  const longCancelRes = await selfPaid(cancelLong)
  await client.waitForTransaction({ digest: longCancelRes.digest })
  log(`  long-sub CANCEL digest: ${longCancelRes.digest}`)
  const longGone = await client.getObject({ id: longSubId, options: { showContent: true } })
  assert(!!longGone.error || longGone.data === null, 'long-period probe sub DELETED after cancel')

  // ─────────────────────────────────────────────────────────────────────────
  log('\n═══ DIGEST LEDGER ═══')
  log('CREATE :', createDigest, createSponsored ? '(sponsored)' : '(self-paid)')
  log('RENEW  :', renewDigest, renewSponsored ? '(sponsored)' : '(self-paid)')
  log('CANCEL :', cancelDigest, cancelSponsored ? '(sponsored)' : '(self-paid)')
  log('subId  :', subId)
  log('ownerKind:', ownerKind)
  log('foundByGetOwnedObjects:', foundByOwned)
  log('\nALL ASSERTIONS PASSED ✓')
}

function buildRenew(subId: string): Transaction {
  const tx = new Transaction()
  tx.setSender(sender)
  tx.moveCall({
    target: SUBS.TARGETS.RENEW,
    typeArguments: [USDC_TYPE],
    arguments: [
      tx.object(VERSION_ID),
      tx.object(subId),
      tx.object(CONFIG_ID),
      tx.balance({ type: USDC_TYPE, balance: AMOUNT }),
      tx.object(CLOCK_ID),
    ],
  })
  return tx
}

function assert(cond: boolean, label: string) {
  if (!cond) throw new Error(`ASSERT FAILED: ${label}`)
  log(`  ✓ ${label}`)
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

main().catch((e) => {
  console.error('\n✗ VERIFICATION FAILED:', e)
  process.exit(1)
})
