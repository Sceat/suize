// Renewal relayer — the deterministic subscription↔storage cron (NO AI, per
// LOCKED #5: every on-chain amount here is a shared constant or config value).
//
// Each tick (config.renewalTickMs) the relayer reads ONLY chain state:
//   1. page the RenewalRegistry's Table<SubRef, ID> dynamic fields — the full
//      set of subscription↔site joins,
//   2. per entry, read the Subscription dynamic field on the rail Account:
//      MISSING (cancelled on the rail) → cap-sign `unlink_renewal`, move on;
//   3. DUE (now >= last_charged_ms + period_ms) → ONE service-wallet PTB:
//      `account::charge_subscription<USDC>` (permissionless, terms-gated — the
//      on-chain leash, NOT an owner tx) THEN `system::extend_blob` for BOTH of
//      the site's Walrus Blob objects. One PTB = the user is charged IFF the
//      storage extends;
//   4. NOT due but charged-this-period AND a blob ends within
//      config.renewalSafetyEpochs of the current Walrus epoch → EXTEND-ONLY PTB.
//      This branch REPAIRS the griefed-permissionless-charge case:
//      `charge_subscription` is callable by ANYONE, so a third party can fire the
//      due charge in a bare tx (the merchant still gets paid — the terms hold)
//      with no extend attached; the user then paid for a period whose storage
//      never got extended. The cushion notices the near-expiry blob inside an
//      already-paid period and extends it without charging again. Do NOT cut it.
//   5. every extend is CLAMPED so end_epoch - current_epoch <= 50 (Walrus caps a
//      blob at ~53 epochs ahead — we keep margin).
//
// The Walrus PACKAGE is resolved each tick from the System object's `package_id`
// content field (survives Walrus upgrades — never hardcoded beyond the config
// default for the System OBJECT id). The current Walrus epoch is computed from
// genesis math (testnet: 1-day epochs from 2024-10-17T00:00:00Z; mainnet: 14-day
// epochs from 2025-03-25T15:00:24Z).
//
// NON-CUSTODIAL LAW: nothing here is an owner tx. `charge_subscription` is the
// rail's PERMISSIONLESS verb (the owner-approved terms are the leash);
// `unlink_renewal`/`extend_blob` act on service-wallet-owned caps/objects.
//
// Abort handling (per entry, codes from the rail's public abort contract):
//   account 4 (ETooEarly)            → benign race (someone charged first), skip;
//   account 3 (EInsufficientBalance) → warn + skip (retry next tick — the
//                                      renewalEpochs cushion is the grace window);
//   account 6 (ESubscriptionNotFound)→ unlink + continue;
//   no WAL coin                      → error + skip ALL extends this tick.
// One entry's failure never kills the loop (per-entry try/catch), and a slow
// tick never overlaps the next (re-entrancy latch).
import { Transaction } from "@mysten/sui/transactions";
import {
  PACKAGE_IDS,
  DEPLOY_SUB_PRICE_USDC,
  USDC_TYPE,
  type SuiNetwork,
} from "@suize/shared";
import { config } from "../config";
import { parseMoveAbort } from "../move-abort";
import { chargeGateReady } from "../deploy/charge";
import {
  readSubscription,
  siteBlobObjects,
  unlinkRenewalOnChain,
  deploySuiClient,
  deployWallet,
  deployServiceAddress,
} from "../deploy";

// ---------------------------------------------------------------------------
// Gate — same shape as the deploy module: the relayer runs only when the deploy
// service wallet is set, the rail charge gate is live, and the deploy package's
// shared objects are published.
// ---------------------------------------------------------------------------

const RENEWAL_REGISTRY_OBJECT: string = PACKAGE_IDS.DEPLOY.RENEWAL_REGISTRY_OBJECT;
const RAIL_CONFIG_ID: string = PACKAGE_IDS.ACCOUNT.RAIL_CONFIG;
const CHARGE_SUBSCRIPTION_TARGET: string = PACKAGE_IDS.ACCOUNT.TARGETS.CHARGE_SUBSCRIPTION;
/** The system Clock object id — always 0x6 (charge_subscription takes &Clock). */
const CLOCK_ID = "0x6";
/** Hard ceiling on how far ahead (epochs) a blob may end after an extend — the
 * Walrus max is ~53; 50 keeps margin so a same-epoch race can't abort the PTB. */
const MAX_EPOCHS_AHEAD = 50;

const RELAYER_ENABLED: boolean =
  Boolean(config.deployWalletKey) &&
  chargeGateReady() &&
  PACKAGE_IDS.DEPLOY.PACKAGE !== "0x0" &&
  RENEWAL_REGISTRY_OBJECT !== "0x0";

// ---------------------------------------------------------------------------
// Walrus epoch math — wall-clock derived (genesis + fixed epoch duration), so a
// tick needs no extra RPC just to know "now" in epochs.
// ---------------------------------------------------------------------------

const WALRUS_EPOCHS: Record<SuiNetwork, { genesisMs: number; durationMs: number }> = {
  testnet: { genesisMs: Date.parse("2024-10-17T00:00:00Z"), durationMs: 24 * 60 * 60 * 1000 },
  mainnet: { genesisMs: Date.parse("2025-03-25T15:00:24Z"), durationMs: 14 * 24 * 60 * 60 * 1000 },
};

const currentWalrusEpoch = (): number => {
  const e = WALRUS_EPOCHS[config.suiNetwork];
  return Math.floor((Date.now() - e.genesisMs) / e.durationMs);
};

// ---------------------------------------------------------------------------
// Chain reads.
// ---------------------------------------------------------------------------

/** Coerce a Move u64 (string|number over RPC) to a JS number (NaN-safe → 0). */
const toNum = (v: unknown): number => {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : 0;
  return Number.isFinite(n) ? n : 0;
};

/**
 * The CURRENT Walrus package id, read from the System object's content fields
 * (`package_id`) — resolved at tick start so a Walrus package upgrade never
 * strands the relayer on a stale target.
 */
const resolveWalrusPackage = async (): Promise<string | null> => {
  try {
    const res = await deploySuiClient().getObject({
      id: config.walrusSystemObject,
      options: { showContent: true },
    });
    const content = res.data?.content;
    if (!content || content.dataType !== "moveObject") return null;
    const pkg = (content.fields as Record<string, unknown>).package_id;
    return typeof pkg === "string" && pkg.startsWith("0x") ? pkg : null;
  } catch (err) {
    console.error("[relayer] walrus system read failed:", (err as Error).message);
    return null;
  }
};

/** The RenewalRegistry's inner Table UID (its dynamic fields ARE the entries). */
const registryTableId = async (): Promise<string | null> => {
  try {
    const res = await deploySuiClient().getObject({
      id: RENEWAL_REGISTRY_OBJECT,
      options: { showContent: true },
    });
    const content = res.data?.content;
    if (!content || content.dataType !== "moveObject") return null;
    const subs = (content.fields as Record<string, unknown>).subs as
      | { fields?: { id?: { id?: string } } }
      | undefined;
    return subs?.fields?.id?.id ?? null;
  } catch (err) {
    console.error("[relayer] registry read failed:", (err as Error).message);
    return null;
  }
};

interface RenewalEntry {
  accountId: string;
  subKey: number;
  siteId: string;
}

/**
 * Walk the registry table's dynamic fields: each entry's NAME is the
 * SubRef{account_id, sub_key} struct, its field-object VALUE is the site id.
 */
const listRenewals = async (tableId: string): Promise<RenewalEntry[]> => {
  const out: RenewalEntry[] = [];
  try {
    let cursor: string | null | undefined = null;
    for (let page = 0; page < 50; page++) {
      const fields = await deploySuiClient().getDynamicFields({
        parentId: tableId,
        cursor: cursor ?? null,
      });
      for (const f of fields.data) {
        const ref = f.name?.value as { account_id?: string; sub_key?: string | number } | undefined;
        const accountId = typeof ref?.account_id === "string" ? ref.account_id : null;
        const subKey = ref?.sub_key !== undefined ? toNum(ref.sub_key) : null;
        if (!accountId || subKey === null || !f.objectId) continue;

        // The entry's value (the site id) lives on the field OBJECT.
        const entry = await deploySuiClient().getObject({
          id: f.objectId,
          options: { showContent: true },
        });
        const content = entry.data?.content;
        if (!content || content.dataType !== "moveObject") continue;
        const siteId = (content.fields as Record<string, unknown>).value;
        if (typeof siteId !== "string") continue;

        out.push({ accountId, subKey, siteId });
      }
      if (!fields.hasNextPage) break;
      cursor = fields.nextCursor;
    }
  } catch (err) {
    console.error("[relayer] registry paging failed:", (err as Error).message);
  }
  return out;
};

/** A Blob object's storage end epoch (`storage.end_epoch`), or null if unreadable. */
const blobEndEpoch = async (blobObjectId: string): Promise<number | null> => {
  try {
    const res = await deploySuiClient().getObject({
      id: blobObjectId,
      options: { showContent: true },
    });
    const content = res.data?.content;
    if (!content || content.dataType !== "moveObject") return null;
    const storage = (content.fields as Record<string, unknown>).storage as
      | { fields?: Record<string, unknown> }
      | Record<string, unknown>
      | undefined;
    const f = ((storage as { fields?: Record<string, unknown> })?.fields ?? storage) as
      | Record<string, unknown>
      | undefined;
    const end = f?.end_epoch;
    return end !== undefined ? toNum(end) : null;
  } catch {
    return null;
  }
};

/** The service wallet's LARGEST Coin<WAL> — the extend_blob payment coin (one
 * mutable coin input reused for both extends). Null when the wallet holds none. */
const largestWalCoin = async (): Promise<string | null> => {
  try {
    const coins = await deploySuiClient().getCoins({
      owner: deployServiceAddress(),
      coinType: config.walCoinType,
    });
    let best: { id: string; balance: bigint } | null = null;
    for (const c of coins.data) {
      const balance = BigInt(c.balance);
      if (balance > 0n && (!best || balance > best.balance)) {
        best = { id: c.coinObjectId, balance };
      }
    }
    return best?.id ?? null;
  } catch (err) {
    console.error("[relayer] WAL coin read failed:", (err as Error).message);
    return null;
  }
};

// ---------------------------------------------------------------------------
// PTB building + execution.
// ---------------------------------------------------------------------------

/** Epochs to add so the blob never exceeds MAX_EPOCHS_AHEAD past `currentEpoch`.
 * 0 = nothing to do (already near max, or expired — extend can't resurrect). */
const clampedExtend = (endEpoch: number | null, currentEpoch: number): number => {
  if (endEpoch === null) return 0;
  const ahead = endEpoch - currentEpoch;
  if (ahead < 0) return 0; // expired — extend_blob would abort; nothing to repair
  return Math.max(0, Math.min(config.renewalEpochs, MAX_EPOCHS_AHEAD - ahead));
};

/** Append one `system::extend_blob(system, blob, epochs, payment)` call. */
const appendExtend = (
  tx: Transaction,
  walrusPkg: string,
  blobObjectId: string,
  epochs: number,
  walCoinId: string,
): void => {
  tx.moveCall({
    target: `${walrusPkg}::system::extend_blob`,
    arguments: [
      tx.object(config.walrusSystemObject),
      tx.object(blobObjectId),
      tx.pure.u32(epochs),
      tx.object(walCoinId),
    ],
  });
};

type ExecResult =
  | { ok: true; digest: string }
  | { ok: false; abort: { module: string; code: number } | null; message: string };

/** Sign + execute a relayer PTB with the service wallet; never throws. */
const execute = async (tx: Transaction): Promise<ExecResult> => {
  try {
    const res = await deploySuiClient().signAndExecuteTransaction({
      transaction: tx,
      signer: deployWallet(),
      options: { showEffects: true },
    });
    if (res.effects?.status?.status === "failure") {
      const message = res.effects.status.error ?? "unknown failure";
      return { ok: false, abort: parseMoveAbort(message), message };
    }
    return { ok: true, digest: res.digest };
  } catch (err) {
    const message = (err as Error).message ?? "unknown error";
    return { ok: false, abort: parseMoveAbort(message), message };
  }
};

// ---------------------------------------------------------------------------
// The per-entry decision (steps 2–5 of the module doc).
// ---------------------------------------------------------------------------

interface TickContext {
  walrusPkg: string;
  walCoinId: string | null;
  currentEpoch: number;
}

const tag = (e: RenewalEntry): string => `${e.accountId}#${e.subKey} -> ${e.siteId}`;

const processEntry = async (e: RenewalEntry, ctx: TickContext): Promise<void> => {
  // ── cancelled on the rail? the join is dead — drop it ───────────────────────
  const sub = await readSubscription(e.accountId, e.subKey);
  if (!sub) {
    console.log(`[relayer] ${tag(e)}: subscription cancelled — unlinking`);
    await unlinkRenewalOnChain(e.accountId, e.subKey);
    return;
  }

  const blobs = await siteBlobObjects(e.siteId);
  if (!blobs) {
    console.warn(`[relayer] ${tag(e)}: site blobs unreadable — skipping`);
    return;
  }
  const [quiltEnd, manifestEnd] = await Promise.all([
    blobEndEpoch(blobs.quilt),
    blobEndEpoch(blobs.manifest),
  ]);
  const quiltAdd = clampedExtend(quiltEnd, ctx.currentEpoch);
  const manifestAdd = clampedExtend(manifestEnd, ctx.currentEpoch);

  const due = Date.now() >= sub.lastChargedMs + sub.periodMs;

  if (due) {
    // Extends ride the SAME PTB as the charge — user charged IFF storage extends.
    if (!ctx.walCoinId) return; // WAL-empty already logged once for the tick
    if (quiltAdd === 0 && manifestAdd === 0) {
      // Nothing extendable (near-max or expired): charging now would take money
      // without delivering storage — wait for a tick where the extend is real.
      console.warn(`[relayer] ${tag(e)}: due but no extendable storage — skipping charge`);
      return;
    }
    const tx = new Transaction();
    // charge_subscription<USDC>(account, config: &RailConfig, sub_key, amount, clock)
    // PERMISSIONLESS — the on-chain Subscription terms (fixed payee + period cap +
    // Clock gate) are the leash; the amount is the shared constant, never computed.
    tx.moveCall({
      target: CHARGE_SUBSCRIPTION_TARGET,
      typeArguments: [USDC_TYPE],
      arguments: [
        tx.object(e.accountId),
        tx.object(RAIL_CONFIG_ID),
        tx.pure.u64(e.subKey),
        tx.pure.u64(BigInt(DEPLOY_SUB_PRICE_USDC)),
        tx.object(CLOCK_ID),
      ],
    });
    if (quiltAdd > 0) appendExtend(tx, ctx.walrusPkg, blobs.quilt, quiltAdd, ctx.walCoinId);
    if (manifestAdd > 0) appendExtend(tx, ctx.walrusPkg, blobs.manifest, manifestAdd, ctx.walCoinId);

    const res = await execute(tx);
    if (res.ok) {
      console.log(`[relayer] ${tag(e)}: charged + extended (+${quiltAdd}/+${manifestAdd} epochs) ${res.digest}`);
      return;
    }
    if (res.abort?.module === "account") {
      if (res.abort.code === 4) return; // ETooEarly — someone charged first this period; benign
      if (res.abort.code === 3) {
        console.warn(`[relayer] ${tag(e)}: insufficient Account balance — retrying next tick`);
        return;
      }
      if (res.abort.code === 6) {
        console.log(`[relayer] ${tag(e)}: subscription gone (ESubscriptionNotFound) — unlinking`);
        await unlinkRenewalOnChain(e.accountId, e.subKey);
        return;
      }
    }
    console.error(`[relayer] ${tag(e)}: charge+extend failed: ${res.message}`);
    return;
  }

  // ── not due: the charged-this-period repair branch (step 4) ──────────────────
  // A blob ending within the safety cushion while the period is already PAID
  // means the paid charge never extended storage (the griefed-permissionless-
  // charge case) — extend WITHOUT charging.
  const quiltNear = quiltEnd !== null && quiltEnd - ctx.currentEpoch <= config.renewalSafetyEpochs && quiltAdd > 0;
  const manifestNear = manifestEnd !== null && manifestEnd - ctx.currentEpoch <= config.renewalSafetyEpochs && manifestAdd > 0;
  if (!quiltNear && !manifestNear) return;
  if (!ctx.walCoinId) return; // WAL-empty already logged once for the tick

  const tx = new Transaction();
  if (quiltNear) appendExtend(tx, ctx.walrusPkg, blobs.quilt, quiltAdd, ctx.walCoinId);
  if (manifestNear) appendExtend(tx, ctx.walrusPkg, blobs.manifest, manifestAdd, ctx.walCoinId);

  const res = await execute(tx);
  if (res.ok) {
    console.log(`[relayer] ${tag(e)}: extend-only repair (+${quiltNear ? quiltAdd : 0}/+${manifestNear ? manifestAdd : 0} epochs) ${res.digest}`);
  } else {
    console.error(`[relayer] ${tag(e)}: extend-only failed: ${res.message}`);
  }
};

// ---------------------------------------------------------------------------
// The tick loop.
// ---------------------------------------------------------------------------

let ticking = false;

const tick = async (): Promise<void> => {
  if (ticking) return; // a slow tick never overlaps the next
  ticking = true;
  try {
    const tableId = await registryTableId();
    if (!tableId) return;
    const entries = await listRenewals(tableId);
    if (entries.length === 0) return;

    const walrusPkg = await resolveWalrusPackage();
    if (!walrusPkg) {
      console.error("[relayer] cannot resolve the current Walrus package — skipping tick");
      return;
    }
    const walCoinId = await largestWalCoin();
    if (!walCoinId) {
      console.error("[relayer] WAL wallet empty — top up (skipping all extends this tick)");
    }
    const ctx: TickContext = { walrusPkg, walCoinId, currentEpoch: currentWalrusEpoch() };

    // Sequential on purpose: every PTB reuses the same gas + WAL coin objects, so
    // parallel entries would race their object versions and abort each other.
    for (const e of entries) {
      try {
        await processEntry(e, ctx);
      } catch (err) {
        // Per-entry isolation — one bad entry never kills the loop.
        console.error(`[relayer] ${tag(e)}: ${(err as Error).message}`);
      }
    }
  } catch (err) {
    console.error("[relayer] tick failed:", (err as Error).message);
  } finally {
    ticking = false;
  }
};

// ---------------------------------------------------------------------------
// Mounting + info (consumed by src/index.ts for the startup log).
// ---------------------------------------------------------------------------

export const relayerInfo = {
  enabled: RELAYER_ENABLED,
  tickMs: config.renewalTickMs,
  extendEpochs: config.renewalEpochs,
  safetyEpochs: config.renewalSafetyEpochs,
  subPeriodMs: config.deploySubPeriodMs,
};

/** Start the renewal loop (no-op when the gate is closed). Runs one immediate
 * pass (demo-friendly), then every config.renewalTickMs. */
export const startRenewalRelayer = (): void => {
  if (!RELAYER_ENABLED) return;
  setInterval(() => void tick(), config.renewalTickMs).unref?.();
  void tick();
};
