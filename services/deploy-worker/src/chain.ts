// On-chain writes + object reads for the charge face — the ONLY module that
// holds the service wallet. It signs exactly three verbs (all DeployerCap-gated
// in Move): site::create_site, site::extend_site, allowlist::create_for_owner —
// plus the domain_registry link/unlink (SiteAdminCap-gated) and the Walrus
// system::extend_blob storage top-ups. It NEVER signs payer funds: payments
// settle keyless through the external facilitator (see payment.ts).

import { SuiGrpcClient } from "@mysten/sui/grpc";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import { bcs } from "@mysten/sui/bcs";
import { grpcUrl, packageIds } from "@suize/shared";
import { network, type Env } from "./env";

export class ChainError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ChainError";
  }
}

// ── lazy per-isolate singletons ───────────────────────────────────────────────

let _client: SuiGrpcClient | null = null;
let _clientKey = "";
let _wallet: Ed25519Keypair | null = null;
let _walletKey = "";

export const suiClient = (env: Env): SuiGrpcClient => {
  const net = network(env);
  const url = env.SUI_GRPC_URL || grpcUrl(net);
  const key = `${net}|${url}`;
  if (!_client || _clientKey !== key) {
    _client = new SuiGrpcClient({ network: net, baseUrl: url });
    _clientKey = key;
  }
  return _client;
};

export const wallet = (env: Env): Ed25519Keypair => {
  const key = env.DEPLOY_WALLET_KEY ?? "";
  if (!key) throw new ChainError("deploy wallet not configured", 503);
  if (!_wallet || _walletKey !== key) {
    _wallet = Ed25519Keypair.fromSecretKey(key);
    _walletKey = key;
  }
  return _wallet;
};

export const serviceAddress = (env: Env): string => wallet(env).toSuiAddress();

/** The deploy_sui id block for this worker's network (single source: @suize/shared). */
export const deployIds = (env: Env) => packageIds(network(env)).DEPLOY;

// ── shared execute helper ─────────────────────────────────────────────────────

interface Executed {
  digest: string;
  effects: { changedObjects?: { objectId: string; idOperation?: string }[] } | undefined;
  events: { eventType?: string; json?: unknown }[];
}

/** A version/equivocation conflict on an OWNED input (the DeployerCap or the
 * gas coin) — the service wallet signs from concurrent isolates, so two
 * in-flight PTBs can race the same object version. Retriable: a REBUILD picks
 * up fresh versions. (Known scale limit: heavy concurrent deploy volume wants a
 * Durable-Object write lock; bounded retry absorbs demo-scale bursts.) */
const isVersionConflict = (message: string): boolean =>
  /rejected as invalid|not available for consumption|version.*(conflict|mismatch)|already (locked|used) by/i.test(
    message,
  );

const RETRIES = 3;

/** Sign + execute a service-wallet PTB, REBUILDING on owned-object version
 * conflicts (≤3 attempts, jittered). `build` must return a FRESH Transaction
 * each call — object versions resolve at build time. Throws ChainError: a
 * structural Move abort maps via `abortMap`; anything else is a 502. Exported so
 * the domain link/unlink path (chain-signed via the SiteAdminCap) gets the SAME
 * conflict retry as the mints — otherwise a transient cap/gas version race after
 * a settled $19.99 payment would strand it (correctness hat F1). */
export const executeWithRetry = async (
  env: Env,
  build: () => Transaction,
  tag: string,
  abortMap?: Record<string, Record<string, { message: string; status: number }>>,
): Promise<Executed> => {
  let lastMessage = "unknown";
  for (let attempt = 0; attempt < RETRIES; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, 300 + Math.random() * 700));
    }
    let res;
    try {
      res = await suiClient(env).signAndExecuteTransaction({
        transaction: build(),
        signer: wallet(env),
        include: { effects: true, events: true },
      });
    } catch (err) {
      lastMessage = decodeURIComponent((err as Error).message ?? "");
      // A Move abort can surface HERE, not only on a FailedTransaction: the gRPC
      // client SIMULATES while resolving/building and THROWS on an abort —
      // live-proven shape: "Transaction resolution failed: MoveAbort in 1st
      // command, abort code: 0, in '0x…::site::create_site'". Map it through the
      // same table so EDigestUsed (the recovery signal) is a 409 on BOTH paths.
      const m = lastMessage.match(/MoveAbort.*?abort code:\s*(\d+).*?'(?:0x[0-9a-fA-F]+::)?(\w+)::\w+'/i);
      if (m) {
        const mapped = abortMap?.[m[2]]?.[m[1]];
        if (mapped) throw new ChainError(mapped.message, mapped.status);
        console.error(`[chain] ${tag} aborted (resolution), raw:`, lastMessage.slice(0, 300));
        throw new ChainError(`${tag} aborted: ${lastMessage}`, 502);
      }
      if (isVersionConflict(lastMessage)) continue;
      throw new ChainError(`${tag} failed: ${lastMessage}`, 502);
    }
    const exec = res.Transaction ?? res.FailedTransaction;
    if (!exec.status.success) {
      const err = exec.status.error;
      if (err?.$kind === "MoveAbort") {
        // Match defensively: the module may render bare ("site") or qualified
        // ("0x…::site"); the abort code as number/bigint/string.
        const mod = String(err.MoveAbort.location?.module ?? "").split("::").pop() ?? "";
        const code = String(err.MoveAbort.abortCode ?? "");
        const mapped = abortMap?.[mod]?.[code];
        if (mapped) throw new ChainError(mapped.message, mapped.status);
      }
      // Unmapped failure — log the RAW structure so an operator (and the next
      // debugging session) sees the true shape, not a lossy message.
      console.error(`[chain] ${tag} aborted, raw error:`, JSON.stringify(err));
      throw new ChainError(`${tag} aborted: ${err?.message ?? "unknown"}`, 502);
    }
    return {
      digest: exec.digest,
      effects: exec.effects ?? undefined,
      events: (exec.events ?? []) as Executed["events"],
    };
  }
  throw new ChainError(`${tag} failed after ${RETRIES} attempts (object contention): ${lastMessage}`, 503);
};

// The site-module aborts every charge path must surface precisely (abort codes
// are the package's public contract — site.move).
/** site.move abort codes → HTTP. Code 0 (EDigestUsed) is a RECOVERY signal, not a
 * dead end — the route catches the 409 and returns the already-created site
 * (siteIdByDigest). Code 1 (EZeroDuration) can't happen from a route (months ≥ 1). */
export const EDIGEST_USED_STATUS = 409;
const SITE_ABORTS = (): Record<string, Record<string, { message: string; status: number }>> => ({
  site: {
    "0": { message: "payment already used for this site operation", status: EDIGEST_USED_STATUS },
    "1": { message: "extension duration must be positive", status: 400 },
  },
});

// ── create_site ───────────────────────────────────────────────────────────────

export interface CreateSiteArgs {
  name: string;
  owner: string;
  quiltId: string;
  manifestBlobId: string;
  manifestHashHex: string;
  quiltBlobObject: string;
  manifestBlobObject: string;
  sizeBytes: number;
  fileCount: number;
  paidUntilMs: number;
  sealed: boolean;
  /** The settled payment digest — the on-chain one-site-per-payment key. */
  paymentDigest: string;
}

const hexToBytes = (hex: string): Uint8Array => {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
};

export const createSiteOnChain = async (
  env: Env,
  a: CreateSiteArgs,
): Promise<{ siteId: string; digest: string }> => {
  const ids = deployIds(env);
  const build = () => {
    const tx = new Transaction();
    const cap = tx.moveCall({
      target: ids.TARGETS.CREATE_SITE,
      arguments: [
        tx.object(ids.DEPLOYER_CAP_OBJECT),
        tx.object(ids.VERSION_OBJECT),
        tx.object(ids.SITE_DIGEST_REGISTRY_OBJECT),
        tx.pure.vector("u8", new TextEncoder().encode(a.paymentDigest)),
        tx.pure.string(a.name),
        tx.pure.address(a.owner),
        tx.pure.string(a.quiltId),
        tx.pure.string(a.manifestBlobId),
        tx.pure.vector("u8", hexToBytes(a.manifestHashHex)),
        tx.pure.id(a.quiltBlobObject),
        tx.pure.id(a.manifestBlobObject),
        tx.pure.u64(a.sizeBytes),
        tx.pure.u64(a.fileCount),
        tx.pure.u64(a.paidUntilMs),
        tx.pure.bool(a.sealed),
      ],
    });
    // create_site RETURNS the SiteAdminCap — the service wallet custodies it for
    // later domain ops (composable-return style; unconsumed it fails resolution).
    tx.transferObjects([cap], serviceAddress(env));
    return tx;
  };

  const exec = await executeWithRetry(env, build, "create_site", SITE_ABORTS());

  // The minted Site id comes from the SiteCreated event in THIS tx — never from
  // a follow-up object read (a fresh shared object may not be indexed yet; the
  // event is deterministic and already in the execution result).
  const eventType = `${ids.PACKAGE}::site::SiteCreated`;
  let siteId: string | null = null;
  for (const ev of exec.events) {
    if (ev.eventType !== eventType) continue;
    const id = (ev.json as { site_id?: string } | undefined)?.site_id;
    if (typeof id === "string") {
      siteId = id;
      break;
    }
  }
  if (!siteId) throw new ChainError("create_site: SiteCreated event missing from tx", 502);

  // Bounded, non-fatal finality wait: the mint already succeeded — throwing here
  // would report failure for a live Site (and strand a charge that paid for it).
  try {
    await suiClient(env).waitForTransaction({ digest: exec.digest, timeout: 15_000 });
  } catch {
    console.warn(`[charge] create_site ${exec.digest} not indexed after 15s — URL may 404 briefly`);
  }

  return { siteId, digest: exec.digest };
};

// ── extend_site ───────────────────────────────────────────────────────────────

/** The shared Clock object (0x6) — extend_site reads `now` to extend from
 * max(now, paid_until), so a lapsed site still gets the full purchased time. */
const CLOCK_OBJECT = "0x6";

export const extendSiteOnChain = async (
  env: Env,
  siteId: string,
  paymentDigest: string,
  addMs: number,
): Promise<{ digest: string; paidUntilMs: number }> => {
  const ids = deployIds(env);
  const build = () => {
    const tx = new Transaction();
    tx.moveCall({
      target: ids.TARGETS.EXTEND_SITE,
      arguments: [
        tx.object(ids.DEPLOYER_CAP_OBJECT),
        tx.object(ids.VERSION_OBJECT),
        tx.object(ids.SITE_DIGEST_REGISTRY_OBJECT),
        tx.pure.vector("u8", new TextEncoder().encode(paymentDigest)),
        tx.object(siteId),
        tx.object(CLOCK_OBJECT),
        tx.pure.u64(addMs),
      ],
    });
    return tx;
  };
  const exec = await executeWithRetry(env, build, "extend_site", SITE_ABORTS());

  // The new paid-through comes from the SiteExtended EVENT in THIS tx — a
  // follow-up object read can lag the write (live-proven: the first E2E response
  // showed the PRE-extend value; the event is the authoritative truth).
  const eventType = `${ids.PACKAGE}::site::SiteExtended`;
  for (const ev of exec.events) {
    if (ev.eventType !== eventType) continue;
    const ms = Number((ev.json as { paid_until_ms?: string | number } | undefined)?.paid_until_ms ?? 0);
    if (Number.isFinite(ms) && ms > 0) return { digest: exec.digest, paidUntilMs: ms };
  }
  throw new ChainError("extend_site: SiteExtended event missing from tx", 502);
};

/**
 * A gRPC "not found" — the GENUINE "this digest was never registered" answer of a
 * dynamic-field read. Sui's gRPC throws a plain `Error: Object 0x… not found` for
 * a missing field (live-verified against testnet), with no status code, so the
 * message is the only signal. ANY OTHER read failure (transport/timeout/5xx) is
 * INDETERMINATE and must NOT be read as "no prior site" (money-hat: that would let
 * a replayed payment re-store/re-mint) — those fail CLOSED.
 */
const isNotFound = (err: unknown): boolean => {
  const e = err as { code?: unknown; message?: unknown } | null;
  if (e && (e.code === 5 || e.code === "NOT_FOUND" || e.code === "not_found")) return true;
  return /not\s*found|does not exist/i.test(String(e?.message ?? err ?? ""));
};

/**
 * The site id a settled payment digest already minted/extended, if any — read
 * from the SiteDigestRegistry's `used` Table (digest→ID), whose entries hang off
 * the TABLE'S INNER UID (same pattern as the DomainRegistry). The recovery path
 * uses this after an already-consumed retry aborts EDigestUsed: the payer's
 * money already bought a site; return it rather than 409-ing. The Table key is
 * the digest STRING's UTF-8 bytes (exactly what create_site/extend_site consumed).
 *
 * FAIL-CLOSED on an RPC read fault (money-hat): a `null` from here is the pre-store
 * "no prior site → safe to mint" signal, so it must mean a DEFINITIVE miss, never a
 * transient read error. A registry-object read failure, or a dynamic-field read
 * failure that is NOT a genuine not-found, THROWS (retryable ChainError) so the
 * caller stops rather than double-storing/double-minting a replayed payment.
 */
export const siteIdByDigest = async (env: Env, paymentDigest: string): Promise<string | null> => {
  const ids = deployIds(env);

  // 1) The registry object → its `used` Table inner UID. This shared object ALWAYS
  //    exists; a read FAILURE here is a transient RPC fault, never "no prior site"
  //    — fail CLOSED (throw) so a replay can't be mis-read as fresh and re-mint.
  let parent: string | null;
  try {
    const reg = (
      await suiClient(env).getObject({ objectId: ids.SITE_DIGEST_REGISTRY_OBJECT, include: { json: true } })
    ).object;
    const used = (reg?.json as Record<string, unknown> | undefined)?.used as { id?: string } | undefined;
    parent = typeof used?.id === "string" ? used.id : null;
  } catch (err) {
    throw new ChainError(`digest registry unreadable: ${(err as Error).message}`, 503);
  }
  if (!parent) return null; // read OK, no `used` table → genuinely nothing registered

  // 2) The digest→site dynamic field. A genuine MISS (this digest never minted)
  //    throws "…not found" → null (the common fresh-deploy case). ANY OTHER error
  //    is indeterminate → fail CLOSED (throw) so a replay never re-stores/re-mints.
  try {
    const key = bcs.vector(bcs.u8()).serialize(Array.from(new TextEncoder().encode(paymentDigest))).toBytes();
    const field = await suiClient(env).getDynamicField({
      parentId: parent,
      name: { type: "vector<u8>", bcs: key },
    });
    const valueBcs = field.dynamicField?.value?.bcs;
    return valueBcs && valueBcs.length > 0 ? bcs.Address.parse(valueBcs) : null;
  } catch (err) {
    if (isNotFound(err)) return null;
    throw new ChainError(`digest lookup failed: ${(err as Error).message}`, 503);
  }
};

// ── allowlist::create_for_owner (sealed deploys) ──────────────────────────────

export const createAllowlistOnChain = async (
  env: Env,
  owner: string,
): Promise<{ allowlistId: string; digest: string }> => {
  const ids = deployIds(env);
  const build = () => {
    const tx = new Transaction();
    tx.moveCall({
      target: ids.TARGETS.ALLOWLIST_CREATE,
      arguments: [
        tx.object(ids.DEPLOYER_CAP_OBJECT),
        tx.object(ids.VERSION_OBJECT),
        tx.pure.address(owner),
      ],
    });
    return tx;
  };
  const exec = await executeWithRetry(env, build, "create_allowlist");

  const eventType = `${ids.PACKAGE}::allowlist::AllowlistCreated`;
  for (const ev of exec.events) {
    if (ev.eventType !== eventType) continue;
    const id = (ev.json as { allowlist_id?: string } | undefined)?.allowlist_id;
    if (typeof id === "string") return { allowlistId: id, digest: exec.digest };
  }
  throw new ChainError("create_allowlist: AllowlistCreated event missing", 502);
};

// ── Site reads (the charge face needs owner / sealed / paid_until / blobs) ────

export interface SiteState {
  owner: string;
  sealed: boolean;
  paidUntilMs: number;
  quiltBlobObject: string;
  manifestBlobObject: string;
  sizeBytes: number;
}

const toNum = (v: unknown): number => {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : 0;
  return Number.isFinite(n) ? n : 0;
};

/** Read a Site's charge-relevant fields, or null when missing / not a Site. */
export const readSite = async (env: Env, siteId: string): Promise<SiteState | null> => {
  const ids = deployIds(env);
  try {
    const obj = (await suiClient(env).getObject({ objectId: siteId, include: { json: true } })).object;
    if (!obj?.json || obj.type !== `${ids.PACKAGE}::site::Site`) return null;
    const f = obj.json as Record<string, unknown>;
    if (typeof f.owner !== "string") return null;
    return {
      owner: f.owner.toLowerCase(),
      sealed: f.sealed === true,
      paidUntilMs: toNum(f.paid_until_ms),
      quiltBlobObject: String(f.quilt_blob_object ?? ""),
      manifestBlobObject: String(f.manifest_blob_object ?? ""),
      sizeBytes: toNum(f.size_bytes),
    };
  } catch {
    return null;
  }
};
