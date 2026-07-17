// POST /extend — buy more months for an EXISTING site.
//
// EXTEND IS OPEN-PAYER (owner decision 2026-07-12): any payer may fund any
// site's extension — it only ever ADDS paid time (a gift-extend is harmless,
// and an agent that rotated keys can still keep its site alive). The rate is
// the site's own: $0.10/month, 2× for sealed sites. The settled payment digest
// is consumed ON-CHAIN by `site::extend_site` through the same registry as
// create_site, so a replayed X-PAYMENT can never extend twice.
//
// Storage is funded INLINE (owner decision 2026-07-13): after settle, the
// service wallet pays WAL to extend the two blobs toward the new paid-through in
// the SAME request. There is no drip-funding cron, so the requested months are
// capped to what Walrus can store in one shot (WALRUS_MAX_EPOCHS_AHEAD epochs); a
// post-settle WAL/gas hiccup never fails the request (chain truth already moved) —
// it returns a `warning` a repeat extend re-drives.

import {
  DEPLOY_MONTH_MS,
  deployPriceUsdc,
  maxDeployMonths,
  WALRUS_EPOCHS,
  WALRUS_IDS,
  WALRUS_MAX_EPOCHS_AHEAD,
  walrusEpochToMs,
  SUI_ADDRESS_RE,
  type SuiNetwork,
} from "@suize/shared";
import { Transaction } from "@mysten/sui/transactions";
import { chargeConfigured, network, type Env } from "./env";
import { json, b64json } from "./http";
import {
  ChainError,
  EDIGEST_USED_STATUS,
  extendSiteOnChain,
  readSite,
  serviceAddress,
  suiClient,
  wallet,
  type SiteState,
} from "./chain";
import { fetchPolicy, gatePayment, settlePayment, quoteRequirements, mint402, PaymentError } from "./payment";

// ── Walrus epoch math (pure: net in, epoch out) ───────────────────────────────

const currentEpoch = (net: SuiNetwork): number => {
  const e = WALRUS_EPOCHS[net];
  return Math.floor((Date.now() - e.genesisMs) / e.durationMs);
};

/** The epoch that COVERS `ms` (a blob ending at this epoch is live at `ms`). */
const epochCovering = (net: SuiNetwork, ms: number): number => {
  const e = WALRUS_EPOCHS[net];
  return Math.ceil((ms - e.genesisMs) / e.durationMs);
};

/**
 * The epochs to add to each of a site's two blobs to fund storage through
 * `paidUntilMs`, clamped to the Walrus one-shot ceiling (`nowEpoch +
 * WALRUS_MAX_EPOCHS_AHEAD`). Pure — the WAL-paying tx is built from it. A blob
 * that is unreadable or already lapsed (end < now) returns 0: a top-up can only
 * EXTEND a live blob, never resurrect an expired one.
 */
export const storageExtendPlan = (
  net: SuiNetwork,
  nowEpoch: number,
  paidUntilMs: number,
  quiltEnd: number | null,
  manifestEnd: number | null,
): { quiltAdd: number; manifestAdd: number } => {
  const target = Math.min(epochCovering(net, paidUntilMs) + 1, nowEpoch + WALRUS_MAX_EPOCHS_AHEAD);
  const add = (end: number | null): number => {
    if (end === null || end < nowEpoch) return 0;
    return Math.max(0, target - end);
  };
  return { quiltAdd: add(quiltEnd), manifestAdd: add(manifestEnd) };
};

/**
 * True when extending a site paid through `paidUntilMs` by `addMs` would push the
 * new paid-through past what Walrus can fund in ONE store (there is no cron
 * backstop). extend_site advances paid_until to max(now, paid_until) + addMs, and
 * a store reaches at most `currentEpoch + WALRUS_MAX_EPOCHS_AHEAD`. Pure, so the
 * route rejects before quoting and a test can assert the boundary.
 */
export const extendExceedsWalrusCeiling = (
  net: SuiNetwork,
  paidUntilMs: number,
  addMs: number,
  nowMs: number = Date.now(),
): boolean => {
  const e = WALRUS_EPOCHS[net];
  const nowEpoch = Math.floor((nowMs - e.genesisMs) / e.durationMs);
  const projectedEnd = Math.max(nowMs, paidUntilMs) + addMs;
  return epochCovering(net, projectedEnd) > nowEpoch + WALRUS_MAX_EPOCHS_AHEAD;
};

// ── Walrus extend mechanics (service wallet pays WAL) ─────────────────────────

const toNum = (v: unknown): number => {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : 0;
  return Number.isFinite(n) ? n : 0;
};

/** The CURRENT Walrus package id, read from the System object (survives upgrades). */
const resolveWalrusPackage = async (env: Env): Promise<string | null> => {
  try {
    const obj = (
      await suiClient(env).getObject({
        objectId: WALRUS_IDS[network(env)].systemObject,
        include: { json: true },
      })
    ).object;
    const pkg = (obj?.json as Record<string, unknown> | undefined)?.package_id;
    return typeof pkg === "string" && pkg.startsWith("0x") ? pkg : null;
  } catch (err) {
    console.error("[extend] walrus system read failed:", (err as Error).message);
    return null;
  }
};

/** A Blob object's storage end epoch, or null if unreadable. */
const blobEndEpoch = async (env: Env, blobObjectId: string): Promise<number | null> => {
  try {
    const obj = (
      await suiClient(env).getObject({ objectId: blobObjectId, include: { json: true } })
    ).object;
    if (!obj?.json) return null;
    const storage = (obj.json as Record<string, unknown>).storage as
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

/** The service wallet's largest Coin<WAL> (the extend payment coin), or null. */
const largestWalCoin = async (env: Env): Promise<string | null> => {
  try {
    const coins = await suiClient(env).listCoins({
      owner: serviceAddress(env),
      coinType: WALRUS_IDS[network(env)].walCoinType,
    });
    let best: { id: string; balance: bigint } | null = null;
    for (const c of coins.objects) {
      const balance = BigInt(c.balance);
      if (balance > 0n && (!best || balance > best.balance)) best = { id: c.objectId, balance };
    }
    return best?.id ?? null;
  } catch (err) {
    console.error("[extend] WAL coin read failed:", (err as Error).message);
    return null;
  }
};

export interface StorageExtendResult {
  /** The extend_blob tx digest, or null when no store was sent. */
  digest: string | null;
  /** Non-null when storage funding was NEEDED but did not complete. There is no
   * cron to retry it — the caller surfaces it and a repeat extend re-drives it. */
  warning: string | null;
}

/**
 * Fund a site's two blobs TOWARD `paidUntilMs` in ONE store (clamped to the
 * Walrus one-shot ceiling). This IS the storage funding — no cron backstop.
 * Never throws: on a WAL/gas hiccup it returns a `warning` (the on-chain
 * paid_until has already moved, so the request must still succeed).
 */
export const extendStorageToward = async (
  env: Env,
  site: Pick<SiteState, "quiltBlobObject" | "manifestBlobObject">,
  paidUntilMs: number,
): Promise<StorageExtendResult> => {
  const net = network(env);
  const nowEpoch = currentEpoch(net);

  const [quiltEnd, manifestEnd] = await Promise.all([
    blobEndEpoch(env, site.quiltBlobObject),
    blobEndEpoch(env, site.manifestBlobObject),
  ]);
  const { quiltAdd, manifestAdd } = storageExtendPlan(net, nowEpoch, paidUntilMs, quiltEnd, manifestEnd);
  if (quiltAdd === 0 && manifestAdd === 0) return { digest: null, warning: null };

  const walrusPkg = await resolveWalrusPackage(env);
  if (!walrusPkg) return { digest: null, warning: "could not resolve the Walrus package to fund storage" };
  const walCoin = await largestWalCoin(env);
  if (!walCoin) {
    console.error("[extend] WAL wallet empty — top up the service wallet");
    return { digest: null, warning: "the deploy service wallet is out of WAL; storage was not funded" };
  }

  const system = WALRUS_IDS[net].systemObject;
  const tx = new Transaction();
  if (quiltAdd > 0) {
    tx.moveCall({
      target: `${walrusPkg}::system::extend_blob`,
      arguments: [tx.object(system), tx.object(site.quiltBlobObject), tx.pure.u32(quiltAdd), tx.object(walCoin)],
    });
  }
  if (manifestAdd > 0) {
    tx.moveCall({
      target: `${walrusPkg}::system::extend_blob`,
      arguments: [tx.object(system), tx.object(site.manifestBlobObject), tx.pure.u32(manifestAdd), tx.object(walCoin)],
    });
  }
  try {
    const res = await suiClient(env).signAndExecuteTransaction({
      transaction: tx,
      signer: wallet(env),
      include: { effects: true },
    });
    const exec = res.Transaction ?? res.FailedTransaction;
    if (!exec.status.success) {
      console.error("[extend] extend_blob failed:", exec.status.error?.message ?? "unknown");
      return { digest: null, warning: "the Walrus storage funding transaction failed" };
    }
    return { digest: exec.digest, warning: null };
  } catch (err) {
    console.error("[extend] extend_blob failed:", (err as Error).message);
    return { digest: null, warning: "the Walrus storage funding transaction failed" };
  }
};

// ── POST /extend ──────────────────────────────────────────────────────────────

const riderFor = (months: number, sealed: boolean, siteId: string): string =>
  `Suize: extend site ${siteId} by ${months} month${months === 1 ? "" : "s"}` +
  `${sealed ? " (private site, 2x rate)" : ""}. Any payer may extend any site — it only ` +
  `adds paid time. Sign the gasless payment and retry the same URL with the X-PAYMENT header.`;

export const handleExtend = async (req: Request, env: Env): Promise<Response> => {
  if (!chargeConfigured(env)) return json({ error: "extend not configured" }, 503);

  const url = new URL(req.url);
  const net = network(env);
  const maxMonths = maxDeployMonths(net);
  let bodyJson: Record<string, unknown> = {};
  try {
    const raw = await req.text();
    if (raw) bodyJson = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    /* query params may still carry everything */
  }

  const siteId = String(bodyJson.site ?? bodyJson.siteId ?? url.searchParams.get("site") ?? "").trim();
  if (!SUI_ADDRESS_RE.test(siteId)) return json({ error: "invalid or missing site id" }, 400);

  const months = Number(bodyJson.months ?? url.searchParams.get("months") ?? "1");
  if (!Number.isInteger(months) || months < 1 || months > maxMonths) {
    return json({ error: `months must be an integer in [1, ${maxMonths}]` }, 400);
  }

  const site = await readSite(env, siteId);
  if (!site) return json({ error: "site not found" }, 404);

  // The one-shot Walrus ceiling (no cron backstop): extend_site advances
  // paid_until to max(now, paid_until) + addMs, and storage can only be funded to
  // currentEpoch + WALRUS_MAX_EPOCHS_AHEAD in one store. If the site is already
  // funded far out, a large extension would move paid_until past what storage can
  // cover — reject BEFORE quoting (extend closer to expiry, or by fewer months).
  const addMs = months * DEPLOY_MONTH_MS;
  if (extendExceedsWalrusCeiling(net, site.paidUntilMs, addMs)) {
    return json(
      { error: `extension would fund storage past the ~${maxMonths}-month one-shot Walrus window; extend closer to expiry or by fewer months` },
      400,
    );
  }

  // STORAGE PREFLIGHT (money-safety) — extend only ADDS time to LIVE Walrus blobs;
  // `extend_blob` cannot resurrect an expired/unrecoverable one (storageExtendPlan
  // returns 0 for a blob with end < now or an unreadable one). If either of the
  // site's two blobs is already lapsed past recovery or unreadable, reject BEFORE
  // quoting/settling — otherwise the payment settles and moves paid_until on-chain
  // while storage can never actually be funded (money taken, site still dead). A
  // transient/unreadable read errs toward rejection (money-safe: the payer retries).
  const nowEpoch = currentEpoch(net);
  const [quiltEnd, manifestEnd] = await Promise.all([
    blobEndEpoch(env, site.quiltBlobObject),
    blobEndEpoch(env, site.manifestBlobObject),
  ]);
  const extendable = (end: number | null): boolean => end !== null && end >= nowEpoch;
  if (!extendable(quiltEnd) || !extendable(manifestEnd)) {
    return json(
      { error: "this site's Walrus storage has lapsed past recovery and can no longer be extended; redeploy the site" },
      400,
    );
  }

  const amount = BigInt(deployPriceUsdc(months, site.sealed));
  const payHeader = (req.headers.get("X-PAYMENT") ?? req.headers.get("PAYMENT-SIGNATURE") ?? "").trim();

  const challenge402 = async (errorOverride?: string): Promise<Response> => {
    const policy = await fetchPolicy(env);
    const body = mint402(env, policy, amount, req.url, riderFor(months, site.sealed, siteId));
    if (errorOverride) body.error = errorOverride;
    return json(body, 402, { "PAYMENT-REQUIRED": b64json(body) });
  };

  /** Shape an extend response. `paidUntilMs` comes from the extend tx's OWN
   * SiteExtended event (a follow-up object read can lag the write); the recovery
   * path (already-consumed digest) re-reads and may briefly lag — acceptable
   * there, the extension is already applied on-chain. */
  const respond = async (digest: string | null, paidUntilMs: number, warning: string | null) => {
    const [qe, me] = await Promise.all([
      blobEndEpoch(env, site.quiltBlobObject),
      blobEndEpoch(env, site.manifestBlobObject),
    ]);
    const end = qe !== null && me !== null ? Math.min(qe, me) : (qe ?? me);
    return json({
      siteId,
      digest,
      paidUntilMs,
      storageEndEpoch: end,
      expiresAtMs: end !== null ? walrusEpochToMs(end, net) : null,
      ...(warning ? { warning } : {}),
    });
  };

  try {
    if (!payHeader) return await challenge402();

    const policy = await fetchPolicy(env);
    const { requirements } = quoteRequirements(env, policy, amount, req.url);
    const verified = await gatePayment(env, payHeader, requirements);

    // Settle (idempotent by digest — a retry of a settled payment re-settles to
    // the same digest), then add the duration on-chain. A replay of the SAME
    // settled payment aborts EDigestUsed — which is the RECOVERY signal: the
    // extension already applied, so return the applied state, never a re-charge.
    const paymentDigest = await settlePayment(env, verified);
    let applied: { digest: string | null; paidUntilMs: number };
    try {
      applied = await extendSiteOnChain(env, siteId, paymentDigest, addMs);
    } catch (err) {
      if (err instanceof ChainError && err.status === EDIGEST_USED_STATUS) {
        // Already extended by this payment — idempotent success with the
        // current on-chain state (best-effort read; the effect is applied).
        const fresh = await readSite(env, siteId);
        applied = { digest: null, paidUntilMs: fresh?.paidUntilMs ?? site.paidUntilMs };
      } else {
        throw err;
      }
    }

    // Fund the Walrus storage toward the new paid-through NOW — this IS the
    // funding (there is no cron). If it fails post-settle the paid_until still
    // moved on-chain (chain truth), so never fail the request: surface a warning
    // and let a repeat extend re-drive it (settle stays idempotent by digest).
    const storage = await extendStorageToward(env, site, applied.paidUntilMs);
    return await respond(applied.digest, applied.paidUntilMs, storage.warning);
  } catch (err) {
    if (err instanceof PaymentError) {
      if (err.challenge) {
        try {
          return await challenge402(err.message);
        } catch {
          /* fall through */
        }
      }
      return json({ error: err.message }, err.status);
    }
    if (err instanceof ChainError) return json({ error: err.message }, err.status);
    console.error("[extend]", (err as Error).message);
    return json({ error: "extend failed" }, 500);
  }
};
