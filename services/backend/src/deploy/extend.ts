// Walrus storage auto-renewal — the deterministic subscription↔storage extender
// (NO AI, per LOCKED #5: every on-chain amount/epoch here is a shared constant or
// config value). The recurring half of Deploy billing.
//
// ARCHITECTURE (the subs module, push-not-pull): a Deploy storage subscription
// is a `subs::subscription::Subscription<USDC>` the user signs into existence with
// `ref` = a site id. Each period the WALLET (the user's session) pushes one
// period's payment via `subscription::renew` (gas-sponsored) — Suize never holds a
// key and never pulls. This module's ONLY job is to keep that owner's Walrus storage
// extended so it never lapses; it does NOT charge (the subs module already did).
//
// PER-ADDRESS (2026-06-14): one active Deploy subscription owned by an address
// auto-renews the storage of ALL that address's sites — the subscription's `ref` is
// IGNORED for the trigger. The unforgeable binding is the event's `owner` (==
// `ctx.sender()` at create/renew); we enumerate every site whose on-chain owner ==
// that owner and extend each, capping TOTAL renewed bytes at DEPLOY_RENEW_MAX_BYTES
// (a WAL-spend safety bound — see extendForOwner).
//
// TWO TRIGGERS, ONE EXTEND PATH:
//   1. ON-SETTLE HOOK (`notifySettled`) — fired fire-and-forget from the sponsor
//      execute path after a successful sponsored tx. It reads THAT digest's events: any
//      SubscriptionCreated/Renewed whose `merchant` is the Deploy treasury → take the
//      event `owner` and extend ALL of that owner's sites immediately (capped). So a
//      renewal the relayer SPONSORED extends storage in the same beat. (Kept hand-rolled:
//      it targets ONE specific digest, which the poll-based watch can't do.)
//   2. MERCHANT-SDK WATCH (`startStorageCron`) — a long-lived `suizeSubs.watch` over the
//      Deploy-merchant created/renewed/cancelled feeds (polls every config.extendTickMs).
//      created|renewed → extend that owner's sites (the backstop if a hook is missed
//      across a restart or a renewal lands elsewhere); cancelled → a first-class signal
//      (logged; the deleted object stops future extends — suizeSubs reads it inactive).
//      suizeSubs is the SINGLE source of sub STATE — this module no longer hand-rolls
//      queryEvents/getObject for sub state, only the Walrus extend mechanics.
//
// NON-CUSTODIAL LAW: nothing here is an owner tx. `extend_blob` acts on
// service-wallet-owned Walrus Blob objects + a service-wallet WAL coin; the service
// wallet pays the WAL. The Walrus PACKAGE is resolved each pass from the System
// object's `package_id` (survives Walrus upgrades). The current Walrus epoch is
// computed from genesis math (testnet: 1-day epochs; mainnet: 14-day epochs).
import { Transaction } from "@mysten/sui/transactions";
import { PACKAGE_IDS, SUBS_PUBLISHED, DEPLOY_RENEW_MAX_BYTES, WALRUS_EPOCHS, type SuiNetwork } from "@suize/shared";
import { config } from "../config";
import { deploySuiClient, deployWallet, deployServiceAddress, sitesForOwner } from "./index";
import { deployMerchant } from "./payment";
import { deploySubs, hasValidDeploySub } from "./subs-state";

// ---------------------------------------------------------------------------
// Gate — the extender runs only when the deploy service wallet is set AND the subs
// module is published (a `0x0::subscription::*` event type matches nothing).
// ---------------------------------------------------------------------------

const SUBS_PACKAGE: string = PACKAGE_IDS.SUBS.PACKAGE;
const SUB_CREATED_TYPE = `${SUBS_PACKAGE}::subscription::SubscriptionCreated`;
const SUB_RENEWED_TYPE = `${SUBS_PACKAGE}::subscription::SubscriptionRenewed`;
/** Hard ceiling on how far ahead (epochs) a blob may end after an extend — the
 * Walrus max is ~53; 50 keeps margin so a same-epoch race can't abort the PTB. */
const MAX_EPOCHS_AHEAD = 50;

const SUI_ADDRESS_RE = /^0x[0-9a-fA-F]{64}$/;

export const storageEnabled = (): boolean =>
  Boolean(config.deployWalletKey) && SUBS_PUBLISHED && PACKAGE_IDS.DEPLOY.PACKAGE !== "0x0";

// ---------------------------------------------------------------------------
// Walrus epoch math — wall-clock derived (genesis + fixed epoch duration), so a
// pass needs no extra RPC just to know "now" in epochs.
// ---------------------------------------------------------------------------

// WALRUS_EPOCHS (genesis + epoch duration per network) is the single source of truth
// in @suize/shared — shared with the deploy dashboard's chain-derived expiry.

export const currentWalrusEpoch = (): number => {
  const e = WALRUS_EPOCHS[config.suiNetwork as SuiNetwork];
  return Math.floor((Date.now() - e.genesisMs) / e.durationMs);
};

/** The wall-clock ms a Walrus epoch BOUNDARY falls at (epoch N starts at this ms).
 * Used to render a site's expiry: a blob ending at epoch N expires at epoch N's start. */
export const epochToMs = (epoch: number): number => {
  const e = WALRUS_EPOCHS[config.suiNetwork as SuiNetwork];
  return e.genesisMs + epoch * e.durationMs;
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
 * (`package_id`) — resolved per pass so a Walrus package upgrade never strands the
 * extender on a stale target.
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
    console.error("[deploy/extend] walrus system read failed:", (err as Error).message);
    return null;
  }
};

/** A Blob object's storage end epoch (`storage.end_epoch`), or null if unreadable. */
export const blobEndEpoch = async (blobObjectId: string): Promise<number | null> => {
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

/**
 * Read a v2 Site's two Walrus Blob OBJECT ids (what `extend_blob` extends).
 * Returns null for a missing/pre-v2 site. MOVED here from deploy/index.ts.
 */
export const siteBlobObjects = async (
  siteId: string,
): Promise<{ quilt: string; manifest: string } | null> => {
  try {
    const res = await deploySuiClient().getObject({ id: siteId, options: { showContent: true } });
    const content = res.data?.content;
    if (!content || content.dataType !== "moveObject") return null;
    if (content.type !== `${PACKAGE_IDS.DEPLOY.PACKAGE}::site::Site`) return null;
    const fields = content.fields as Record<string, unknown>;
    const quilt = fields.quilt_blob_object;
    const manifest = fields.manifest_blob_object;
    if (typeof quilt !== "string" || typeof manifest !== "string") return null;
    if (!SUI_ADDRESS_RE.test(quilt) || !SUI_ADDRESS_RE.test(manifest)) return null;
    return { quilt, manifest };
  } catch {
    return null;
  }
};

/**
 * A v2 Site's self-claimed `owner` address (the deployer tag set at create_site).
 * Returns null for a missing / pre-v2 / non-Site object. Used to render expiry and
 * (historically) to bind a sub to its owner's site; the per-address renewer no longer
 * needs it because it enumerates BY owner (see the F5 note on extendForOwner).
 */
export const siteOwner = async (siteId: string): Promise<string | null> => {
  try {
    const res = await deploySuiClient().getObject({ id: siteId, options: { showContent: true } });
    const content = res.data?.content;
    if (!content || content.dataType !== "moveObject") return null;
    if (content.type !== `${PACKAGE_IDS.DEPLOY.PACKAGE}::site::Site`) return null;
    const owner = (content.fields as Record<string, unknown>).owner;
    return typeof owner === "string" && SUI_ADDRESS_RE.test(owner) ? owner.toLowerCase() : null;
  } catch {
    return null;
  }
};

/**
 * A site's STORAGE END epoch — the binding constraint for expiry: the EARLIER of
 * the two blobs' end epochs (the site is unservable once EITHER blob lapses). Null
 * for a missing/pre-v2 site or an unreadable blob. Drives the read endpoints'
 * storageEndEpoch + expiresAtMs.
 */
export const storageEndForSite = async (siteId: string): Promise<number | null> => {
  const blobs = await siteBlobObjects(siteId);
  if (!blobs) return null;
  const [quiltEnd, manifestEnd] = await Promise.all([
    blobEndEpoch(blobs.quilt),
    blobEndEpoch(blobs.manifest),
  ]);
  if (quiltEnd === null && manifestEnd === null) return null;
  if (quiltEnd === null) return manifestEnd;
  if (manifestEnd === null) return quiltEnd;
  return Math.min(quiltEnd, manifestEnd);
};

/** The service wallet's LARGEST Coin<WAL> — the extend_blob payment coin (one mutable
 * coin input reused for both extends). Null when the wallet holds none. */
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
    console.error("[deploy/extend] WAL coin read failed:", (err as Error).message);
    return null;
  }
};

// ---------------------------------------------------------------------------
// Extend PTB.
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

/** Sign + execute an extend PTB with the service wallet; never throws. */
const executeExtend = async (tx: Transaction): Promise<{ ok: boolean; digest?: string; message?: string }> => {
  try {
    const res = await deploySuiClient().signAndExecuteTransaction({
      transaction: tx,
      signer: deployWallet(),
      options: { showEffects: true },
    });
    if (res.effects?.status?.status === "failure") {
      return { ok: false, message: res.effects.status.error ?? "unknown failure" };
    }
    return { ok: true, digest: res.digest };
  } catch (err) {
    return { ok: false, message: (err as Error).message ?? "unknown error" };
  }
};

/**
 * Extend a site's two Walrus blobs by config.renewalEpochs (clamped). ONE service-
 * wallet PTB covering both blobs. Returns the digest, or null when nothing needed
 * extending / WAL is empty / the site is unreadable. Never throws.
 */
const extendSiteStorage = async (siteId: string, walrusPkg: string, walCoinId: string | null): Promise<string | null> => {
  const blobs = await siteBlobObjects(siteId);
  if (!blobs) return null;
  const currentEpoch = currentWalrusEpoch();
  const [quiltEnd, manifestEnd] = await Promise.all([
    blobEndEpoch(blobs.quilt),
    blobEndEpoch(blobs.manifest),
  ]);
  const quiltAdd = clampedExtend(quiltEnd, currentEpoch);
  const manifestAdd = clampedExtend(manifestEnd, currentEpoch);
  if (quiltAdd === 0 && manifestAdd === 0) return null; // nothing extendable
  if (!walCoinId) {
    console.error("[deploy/extend] WAL wallet empty — top up; skipping extend for", siteId);
    return null;
  }
  const tx = new Transaction();
  if (quiltAdd > 0) appendExtend(tx, walrusPkg, blobs.quilt, quiltAdd, walCoinId);
  if (manifestAdd > 0) appendExtend(tx, walrusPkg, blobs.manifest, manifestAdd, walCoinId);
  const res = await executeExtend(tx);
  if (res.ok) {
    console.log(`[deploy/extend] ${siteId}: +${quiltAdd}/+${manifestAdd} epochs ${res.digest}`);
    return res.digest ?? null;
  }
  console.error(`[deploy/extend] ${siteId}: extend failed: ${res.message}`);
  return null;
};

// ---------------------------------------------------------------------------
// Trigger 1 — the on-settle hook. Called fire-and-forget from the sponsor execute
// path after a successful sponsored tx. Reads the tx's events; any Deploy-merchant
// SubscriptionCreated/Renewed → take the event OWNER and extend ALL of that owner's
// sites (capped). The `ref` is IGNORED (the sub is per-address, not per-site).
// ---------------------------------------------------------------------------

/** Re-entrancy latch + a tiny per-site dedupe so a hook + the cron don't double-fire. */
let extending = false;
const recentlyExtended = new Map<string, number>(); // siteId -> ts
const RECENT_TTL_MS = 60_000;

const wasRecentlyExtended = (siteId: string): boolean => {
  const at = recentlyExtended.get(siteId);
  if (at && Date.now() - at < RECENT_TTL_MS) return true;
  return false;
};
const markExtended = (siteId: string): void => {
  recentlyExtended.set(siteId, Date.now());
  // prune
  const cutoff = Date.now() - RECENT_TTL_MS;
  for (const [k, ts] of recentlyExtended) if (ts < cutoff) recentlyExtended.delete(k);
};

/**
 * PER-ADDRESS FAN-OUT (the heart of the per-address subscription). One active Deploy
 * subscription owned by `owner` auto-renews the storage of EVERY site that owner holds,
 * capped at DEPLOY_RENEW_MAX_BYTES (100 GiB) of TOTAL site storage.
 *
 * INHERENTLY F5-SAFE (replaces the old subOwnsSite ref-binding gate): we enumerate
 * sites BY their on-chain `owner` (sitesForOwner — a SiteCreated-events-by-owner scan),
 * so by construction we only ever extend sites the subscription's owner ACTUALLY owns.
 * The old attacker-controlled-`ref` vector (a sub created with `ref` = a stranger's
 * siteId draining service WAL) is GONE: the ref is never read here, and an attacker
 * cannot make `sitesForOwner(attacker)` return someone else's site (the event's `owner`
 * == that site's deployer, unforgeable). The 100 GiB cap is the remaining WAL-spend
 * bound: a malicious owner who deploys 10 TB of their OWN sites must NOT make the
 * service wallet renew all of it for one $19.99 sub.
 *
 * CAP LOGIC: enumerate the owner's sites, sort SOONEST-storage-expiry FIRST (the most
 * urgent renewals win the budget), then accumulate each site's `sizeBytes` and extend
 * while the cumulative total stays <= DEPLOY_RENEW_MAX_BYTES; every site beyond the cap
 * is SKIPPED + logged (never silently dropped). A site whose size is unreadable (0 on
 * the event) is treated CONSERVATIVELY — its bytes still count against the budget (we
 * floor an unknown size at 1 byte so it can never be free), never as 0.
 *
 * Resolves the Walrus package + WAL coin ONCE per owner (cheap; survives an upgrade) and
 * reuses the same WAL coin across every extend. Never throws.
 */
const extendForOwner = async (owner: string): Promise<void> => {
  const ownerLc = owner.toLowerCase();
  if (!SUI_ADDRESS_RE.test(ownerLc)) return;

  let sites: { siteId: string; sizeBytes: number }[];
  try {
    sites = await sitesForOwner(ownerLc);
  } catch (err) {
    console.error(`[deploy/extend] sitesForOwner(${ownerLc}) failed:`, (err as Error).message);
    return;
  }
  if (sites.length === 0) return;

  // Sort soonest-expiry FIRST so the cap budget protects the most urgent storage. A
  // site with an unreadable storage end sorts LAST (Infinity) — it isn't urgent.
  const ends = await Promise.all(sites.map((s) => storageEndForSite(s.siteId)));
  const ranked = sites
    .map((s, i) => ({ ...s, end: ends[i] }))
    .sort((a, b) => (a.end ?? Infinity) - (b.end ?? Infinity));

  const walrusPkg = await resolveWalrusPackage();
  if (!walrusPkg) {
    console.error("[deploy/extend] cannot resolve the Walrus package — skipping owner fan-out");
    return;
  }
  const walCoinId = await largestWalCoin();

  let cumulativeBytes = 0;
  for (const s of ranked) {
    // Conservative size: an unreadable/0 size still consumes budget (floor at 1 byte)
    // so a 0-tagged site can never be a free pass past the cap.
    const cost = s.sizeBytes > 0 ? s.sizeBytes : 1;
    if (cumulativeBytes + cost > DEPLOY_RENEW_MAX_BYTES) {
      console.log(
        `[deploy/extend] owner ${ownerLc}: site ${s.siteId} (${s.sizeBytes} bytes) skipped — beyond the ${DEPLOY_RENEW_MAX_BYTES}-byte auto-renew cap`,
      );
      continue;
    }
    cumulativeBytes += cost;
    if (wasRecentlyExtended(s.siteId)) continue;
    const d = await extendSiteStorage(s.siteId, walrusPkg, walCoinId);
    if (d) markExtended(s.siteId);
  }
};

/**
 * Fire-and-forget: a sponsored tx just executed — if it carried a Deploy storage
 * subscription create/renew, extend ALL of that subscription owner's sites now (capped).
 * Reads the tx's events, filters to Deploy-merchant subs events, takes each unique
 * OWNER (== ctx.sender(), unforgeable), and fans out. Swallows every error (it is a
 * best-effort side-effect; the safety cron is the backstop). Never throws to its caller.
 */
export const notifySettled = async (digest: string): Promise<void> => {
  if (!storageEnabled() || !digest) return;
  try {
    const merchant = await deployMerchant();
    if (!merchant) return;
    const merchantLc = merchant.toLowerCase();

    const full = await deploySuiClient().waitForTransaction({
      digest,
      options: { showEvents: true },
    });
    const events = full.events ?? [];
    // Collect the unique sub OWNERS — the unforgeable per-address binding (ref ignored).
    const owners = new Set<string>();
    for (const ev of events) {
      if (ev.type !== SUB_CREATED_TYPE && ev.type !== SUB_RENEWED_TYPE) continue;
      const pj = ev.parsedJson as { merchant?: string; owner?: string } | undefined;
      if (!pj || String(pj.merchant ?? "").toLowerCase() !== merchantLc) continue;
      const owner = String(pj.owner ?? "").toLowerCase();
      if (SUI_ADDRESS_RE.test(owner)) owners.add(owner);
    }
    // BIND TERMS before spending WAL: a Deploy-merchant event is necessary but NOT
    // sufficient — only an owner with a VALID sub (USDC + amount >= price + monthly
    // period) gets storage renewed. Otherwise a Subscription<Junk> / a $0.01-100yr sub
    // would make the service wallet burn WAL (audit: subs underpriced-premium amplifier).
    for (const owner of owners) {
      if (!(await hasValidDeploySub(owner))) {
        console.log(`[deploy/extend] notifySettled: owner ${owner} has no VALID Deploy sub — skipping renew`);
        continue;
      }
      await extendForOwner(owner);
    }
  } catch (err) {
    console.error("[deploy/extend] notifySettled failed:", (err as Error).message);
  }
};

// ---------------------------------------------------------------------------
// Trigger 2 — the MERCHANT-SDK watch (the single source of sub STATE). Per the owner
// directive, the safety path no longer HAND-ROLLS the chain reads (the old
// listDeploySubs queryEvents + subPaidUntil getObject DUPLICATED exactly what
// @suize/pay's suizeSubs already does). Instead a long-lived `suizeSubs.watch` polls the
// Deploy-merchant SubscriptionCreated / SubscriptionRenewed / SubscriptionCancelled
// feeds:
//   - created | renewed → extend ALL of that sub OWNER's sites (per-address fan-out,
//     capped — see extendForOwner). This is the BACKSTOP to the on-settle hook (a
//     renewal sponsored elsewhere, or a hook missed across a restart, still gets
//     repaired within pollMs). The `ref` is IGNORED for the trigger.
//   - cancelled → a FIRST-CLASS signal (today there was NO cancel handling — a cancelled
//     sub only silently stopped being re-extended). We log it; the deleted object
//     naturally stops any future extend (suizeSubs/isActive read it as inactive).
// The Walrus extend MECHANICS (extendSiteStorage / blob math) are UNCHANGED — only the
// sub-state reads come from suizeSubs and the trigger keys on the owner, not the ref.
// ---------------------------------------------------------------------------

/** The live suizeSubs.watch handle (so a re-init/stop is possible). */
let watchHandle: { stop: () => void } | null = null;

export const storageInfo = {
  enabled: storageEnabled(),
  tickMs: config.extendTickMs,
  extendEpochs: config.renewalEpochs,
  safetyEpochs: config.renewalSafetyEpochs,
};

/**
 * Start the storage backstop — a suizeSubs.watch over the Deploy-merchant subscription
 * lifecycle (no-op when the gate is closed). Replaces the old hand-rolled safety cron:
 * suizeSubs is now the SINGLE source of sub state (which subs exist, active/cancelled),
 * and this module keeps only the Walrus extend mechanics. Idempotent (a second call
 * stops the prior watch first). Polls every config.extendTickMs.
 */
export const startStorageCron = async (): Promise<void> => {
  if (!storageEnabled()) return;
  const subs = await deploySubs();
  if (!subs) {
    console.error("[deploy/extend] watch: suizeSubs unavailable (treasury unresolved) — backstop not started");
    return;
  }
  if (watchHandle) watchHandle.stop();
  watchHandle = subs.watch(
    async (e) => {
      // `extending` serializes the extend leg so a burst of events never overlaps a
      // slow extend (mirrors the old cron latch).
      if (e.kind === "cancelled") {
        console.log(`[deploy/extend] watch: subscription ${e.subscriptionId} (owner ${e.owner}) CANCELLED — that owner's storage no longer auto-renews`);
        return;
      }
      // created | renewed → fan out across ALL of this owner's sites (capped). The ref
      // is IGNORED; the owner is the per-address trigger.
      const owner = e.owner.toLowerCase();
      if (!SUI_ADDRESS_RE.test(owner)) return;
      // Same term-binding as the on-settle hook: only a VALID sub (USDC + amount >=
      // price + monthly period) renews storage — never bare merchant+owner.
      if (!(await hasValidDeploySub(owner))) {
        console.log(`[deploy/extend] watch: owner ${owner} has no VALID Deploy sub — skipping renew`);
        return;
      }
      if (extending) return;
      extending = true;
      try {
        await extendForOwner(owner);
      } catch (err) {
        console.error(`[deploy/extend] watch entry owner ${owner}: ${(err as Error).message}`);
      } finally {
        extending = false;
      }
    },
    { pollMs: config.extendTickMs },
  );
};

/**
 * EXTEND-ON-DEMAND — the POST /sites/:id/extend path (a paid one-off $0.50 storage
 * extend). The payment is gated by the caller (deploy/index.ts via gateDeployPayment);
 * here we just do the extend after the settlement. Resolves the Walrus package + WAL
 * coin, extends the two blobs, returns the digest (or null if nothing to extend).
 */
export const extendOnce = async (siteId: string): Promise<string | null> => {
  if (!storageEnabled()) return null;
  const walrusPkg = await resolveWalrusPackage();
  if (!walrusPkg) return null;
  const walCoinId = await largestWalCoin();
  const d = await extendSiteStorage(siteId, walrusPkg, walCoinId);
  if (d) markExtended(siteId);
  return d;
};
